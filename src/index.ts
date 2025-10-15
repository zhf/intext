/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * intext - minimal reference implementation
 * - minimal dependencies
 * - sliding window chunking (word-based token approximation)
 * - user-provided OpenAI-compatible client instance (chat.completions.create)
 */

import { buildChunks, defaultTokenizer, Chunk } from './chunking';

export type { Chunk };


type SchemaEnumValue = string | number | boolean | null;

type BaseSchemaNode = {
  description?: string;
  enum?: SchemaEnumValue[];
};

export type StringSchemaNode = BaseSchemaNode & {
  type: "string";
};

export type NumberSchemaNode = BaseSchemaNode & {
  type: "number";
};

export type BooleanSchemaNode = BaseSchemaNode & {
  type: "boolean";
};

export type ArraySchemaNode = BaseSchemaNode & {
  type: "array";
  items: SchemaNode;
};

export type ObjectSchemaNode = BaseSchemaNode & {
  type: "object";
  properties: Record<string, SchemaNode>;
  required?: string[];
};

export type SchemaNode = StringSchemaNode | NumberSchemaNode | BooleanSchemaNode | ArraySchemaNode | ObjectSchemaNode;

export type SchemaField = ObjectSchemaNode;

export type ExtractOptions = {
  schema: SchemaField;
  chunkTokens?: number;    // tokens per chunk (approx by words). default 1500
  overlapTokens?: number;  // overlap tokens (words). default 300
  concurrency?: number;    // how many parallel LLM calls. default 3
  tokenizer?: (text: string) => string[]; // optional custom tokenizer: returns tokens (words)
  llmCallOptions?: Record<string, any>; // passed-through to the client
  debug?: boolean; // enable debug logging
};



export type ChunkResult = {
  chunkId: number;
  parsed: Record<string, any>; // keys -> extracted values (or null)
  raw?: string; // raw LLM output
};

export type ExtractResult = {
  json: Record<string, any>;
  metadata: {
    chunkCount: number;
    perFieldProvenance: Record<string, { sourceChunks: number[] }>;
    rawChunkResults: ChunkResult[];
  };
};

/**
 * Signature of a minimal OpenAI-compatible client instance.
 * Must expose chat.completions.create(args) -> Promise<any>.
 */
export type OpenAICompatibleClient = {
  chat: {
    completions: {
      create: (args: Record<string, any>) => Promise<any>;
    };
  };
};

export type ClientPreferredParams = {
  model: string;
  temperature?: number;
  max_tokens?: number;
  [key: string]: any;
};

export type IntextInstance = {
  extract: (text: string, opts: ExtractOptions) => Promise<ExtractResult>;
};

// Debug logging helper
function debugLog(message: string, debugEnabled: boolean) {
  if (debugEnabled) {
    console.log(`[intext debug] ${message}`);
  }
}

function formatEnumValues(values: SchemaEnumValue[]): string {
  return values.map((value) => JSON.stringify(value)).join(", ");
}

function describeField(fieldId: string, field: SchemaNode): string {
  const hints: string[] = [];
  if (field.description) {
    hints.push(field.description);
  }
  if (field.enum && field.enum.length) {
    hints.push(`allowed values: ${formatEnumValues(field.enum)}`);
  } else if (field.type === "array" && field.items.enum && field.items.enum.length) {
    hints.push(`allowed item values: ${formatEnumValues(field.items.enum)}`);
  }

  const hint = hints.length ? ` Hint: ${hints.join("; ")}` : "";
  return `- "${fieldId}" (${field.type})${hint}`;
}

/**
 * Factory to create the intext extractor.
 * Must be provided an OpenAI client instance and preferred params.
 */
export function createIntext(params: { openai: OpenAICompatibleClient; clientParams: ClientPreferredParams; defaultRequestParams?: Record<string, any> }) {
  const { openai, clientParams, defaultRequestParams } = params;

  // chunking utilities are imported from './chunking'

  function buildPromptForChunk(chunk: Chunk, schema: SchemaField) {
    // Build a focused extraction prompt that asks the LLM to return JSON only.
    const fieldInstr = Object.entries(schema.properties)
      .map(([fieldId, field]) => describeField(fieldId, field))
      .join("\n");

    const prompt = `You are a JSON extractor. Given the CHUNK of meeting/transcript text, extract the following fields and return EXACTLY valid JSON and nothing else.

FIELDS:
${fieldInstr}

For each field:
- if absent, return null.
- string: return a short human-readable string.
- array: return a JSON array (possibly empty).
- object: return a JSON object or null.
- number/boolean: return appropriate JSON types.

Also include for each field an optional "_confidence_<fieldId>" numeric value between 0.0 and 1.0 representing the model's confidence (if you can estimate), otherwise you may omit it.

CHUNK:
"""${chunk.text}"""
`;
    return prompt;
  }


  // Build final reduction prompt: include schema and all chunk results, ask for final JSON object only
  function buildFinalReductionPrompt(
    chunkResults: ChunkResult[],
    schema: SchemaField
  ): string {
    // Compact chunk results to only non-null fields and limit long arrays
    const compacted: Array<{ id: number; data: Record<string, any> }> = chunkResults.map((cr) => {
      const data: Record<string, any> = {};
      for (const [k, v] of Object.entries(cr.parsed)) {
        if (v === null || v === undefined) continue;
        if (Array.isArray(v)) {
          data[k] = v.slice(0, 12);
        } else if (typeof v === "object") {
          data[k] = v;
        } else {
          data[k] = v;
        }
      }
      return { id: cr.chunkId, data };
    });

    const schemaJson = JSON.stringify(schema, null, 2);

    let prompt = `You are a JSON reducer. Given the SCHEMA and the per-chunk extraction results, produce the final JSON object that conforms to the SCHEMA. Return EXACTLY valid JSON and nothing else.\n\n`;
    prompt += `SCHEMA (JSON Schema-like, target shape):\n${schemaJson}\n\n`;
    prompt += `CHUNK RESULTS (only non-null fields shown):\n`;
    compacted.forEach((cr, idx) => {
      prompt += `\nChunk ${idx + 1} (ID: ${cr.id}):\n`;
      prompt += JSON.stringify(cr.data, null, 2);
      prompt += `\n`;
    });

    prompt += `\nINSTRUCTIONS:\n` +
      `- Produce a single JSON object that matches the SCHEMA.\n` +
      `- Merge information from all chunks.\n` +
      `- Arrays: deduplicate semantically; if items are objects, prefer merging by keys like id/text/task/action/name/title when present.\n` +
      `- Strings: produce concise summaries without duplicates.\n` +
      `- Objects: merge properties; prefer most recent or most specific info when conflicts arise.\n` +
      `- If a field is absent in all chunks, either omit it or set it to null.\n` +
      `- Output ONLY the final JSON object; no commentary.`;

    return prompt;
  }

  async function extract(text: string, opts: ExtractOptions): Promise<ExtractResult> {
    const {
      schema,
      chunkTokens = 1500,
      overlapTokens = 300,
      concurrency = 3,
      tokenizer = defaultTokenizer,
      llmCallOptions = {},
      debug = false,
    } = opts;

    if (!schema) {
      throw new Error("schema is required");
    }

    debugLog(`Starting extraction with ${chunkTokens} chunk tokens, ${overlapTokens} overlap tokens, and ${concurrency} concurrency`, debug);

    // 1. chunk
    const chunks = buildChunks(text, chunkTokens, overlapTokens, tokenizer);
    debugLog(`Built ${chunks.length} chunks`, debug);

    // 2. per-chunk extraction (processed with concurrency), collect all results
    const rawResults: ChunkResult[] = [];
    // simple concurrency manager
    let pointer = 0;
    async function worker() {
      while (true) {
        const idx = pointer++;
        if (idx >= chunks.length) break;
        const chunk = chunks[idx];
        const prompt = buildPromptForChunk(chunk, schema);
        let rawRespStr: string;
        try {
          debugLog(`Processing chunk ${chunk.id}`, debug);
          const packageDefaults = { stream: false, ...(defaultRequestParams || {}) } as Record<string, any>;
          const requestBody = {
            ...packageDefaults,
            ...clientParams,
            ...llmCallOptions,
            // enforce required fields
            model: clientParams.model,
            messages: [{ role: "user", content: prompt }],
          } as Record<string, any>;
          // Default to JSON response format unless caller already specified
          if (!requestBody.response_format) {
            requestBody.response_format = { type: "json_object" };
          }
          debugLog(`Sending request for chunk ${chunk.id} with model ${requestBody.model}`, debug);
          const resp = await openai.chat.completions.create(requestBody);
          rawRespStr = resp?.choices?.[0]?.message?.content ?? "";
          debugLog(`Received response for chunk ${chunk.id} (${rawRespStr.length} characters)`, debug);
        } catch (e) {
          debugLog(`Error processing chunk ${chunk.id}: ${e}`, debug);
          rawRespStr = "";
        }
        // With JSON response format, content should be valid JSON
        let parsed: any = {};
        try {
          parsed = rawRespStr ? JSON.parse(rawRespStr) : {};
        } catch {
          parsed = {};
        }
        debugLog(`Parsed JSON for chunk ${chunk.id}: ${JSON.stringify(parsed)}`, debug);
        // Normalize parsed to expected schema keys (absent -> null)
        const normalized: Record<string, any> = {};
        for (const [fieldId, field] of Object.entries(schema.properties)) {
          const hasField = Object.prototype.hasOwnProperty.call(parsed, fieldId);
          let value = hasField ? parsed[fieldId] : null;

          if (field.enum && value !== null && value !== undefined) {
            const matchesEnum = field.enum.some((allowed) => Object.is(allowed, value as SchemaEnumValue));
            if (!matchesEnum) {
              value = null;
            }
          }

          if (field.type === "array" && Array.isArray(value)) {
            const itemEnum = field.items.enum;
            if (itemEnum && itemEnum.length && field.items.type !== "object" && field.items.type !== "array") {
              value = value.filter((entry: unknown) =>
                itemEnum.some((allowed) => Object.is(allowed, entry as SchemaEnumValue))
              );
            }
          }

          normalized[fieldId] = value === undefined ? null : value;
        }
        const cr: ChunkResult = { chunkId: chunk.id, parsed: normalized, raw: rawRespStr };
        rawResults.push(cr);
      }
    }

    // spawn workers
    const workers: Promise<void>[] = [];
    const wcount = Math.max(1, Math.min(concurrency, chunks.length));
    debugLog(`Spawning ${wcount} workers for processing`, debug);
    for (let i = 0; i < wcount; i++) workers.push(worker());
    await Promise.all(workers);

    // ensure rawResults ordered by chunkId
    rawResults.sort((a, b) => a.chunkId - b.chunkId);

    // 3. Perform final reduction using all chunk results + schema; expect final JSON
    const reductionPrompt = buildFinalReductionPrompt(rawResults, schema);
    const packageDefaults = { stream: false, ...(defaultRequestParams || {}) } as Record<string, any>;
    const requestBody = {
      ...packageDefaults,
      ...clientParams,
      ...llmCallOptions,
      model: clientParams.model,
      messages: [{ role: "user", content: reductionPrompt }],
    } as Record<string, any>;
    // Default to JSON response format unless caller already specified
    if (!requestBody.response_format) {
      requestBody.response_format = { type: "json_object" };
    }
    debugLog(`Sending final reduction request with ${rawResults.length} chunk results`, true);
    debugLog(`Final reduction prompt:\n${reductionPrompt}\n`, true);

    let finalJson: Record<string, any> = {};
    try {
      const resp = await openai.chat.completions.create(requestBody);
      const rawRespStr = resp?.choices?.[0]?.message?.content ?? "";
      debugLog(`Received final reduction response:\n${rawRespStr}\n`, true);
      let parsed: any = null;
      try {
        parsed = rawRespStr ? JSON.parse(rawRespStr) : null;
      } catch {
        parsed = null;
      }
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        finalJson = parsed as Record<string, any>;
      } else {
        debugLog(`Final reduction did not return a JSON object; falling back to empty result`, true);
        finalJson = {};
      }
    } catch (error) {
      debugLog(`Error in final reduction: ${error}`, true);
      finalJson = {};
    }

    // Build provenance by mapping non-null field appearances to contributing chunk IDs
    const provenance: Record<string, { sourceChunks: number[] }> = {};
    for (const fieldId of Object.keys(schema.properties)) {
      const sourceChunks = rawResults
        .filter(r => r.parsed[fieldId] !== null && r.parsed[fieldId] !== undefined)
        .map(r => r.chunkId);
      provenance[fieldId] = { sourceChunks };
    }

    debugLog(`Extraction complete. Final result: ${JSON.stringify(finalJson)}`, debug);
    return {
      json: finalJson,
      metadata: {
        chunkCount: chunks.length,
        perFieldProvenance: provenance,
        rawChunkResults: rawResults,
      },
    };
  }

  return {
    extract,
  } as IntextInstance;
}
