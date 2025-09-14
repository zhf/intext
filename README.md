# intext

`intext` — a minimal TypeScript library to extract structured JSON from arbitrarily long text using:

- sliding-window chunking (word-based by default)
- per‑chunk extraction prompts to your LLM client
- a single, schema‑aware final reduction that returns the final JSON object

No runtime dependencies. You bring an OpenAI‑compatible client (object exposing `chat.completions.create(args)`).

---

## Table of contents

1. Overview
2. Install
3. Quickstart
4. Example OpenAI client
5. API Reference
6. Chunking & tuning
7. Aggregation (final reduction)
8. Examples
9. Tests & build
10. Security & privacy
11. License

---

## 1 — Overview

`intext` helps you extract fields (you define the fields) from long documents by:

- tokenizing / chunking the text with a sliding window
- sending per‑chunk extraction prompts to your provided LLM client
- parsing and normalizing per‑chunk results
- aggregating them with a final schema‑aware reduction (LLM returns the final JSON object)
- returning final JSON plus provenance (which chunks contributed to each field)

Key ideas:

- Minimal runtime dependencies (zero)
- You provide the LLM client; `intext` never calls external APIs directly
- Schema‑driven: you tell `intext` what to extract using a simple JSON‑Schema‑like object

---

## 2 — Install

After publishing to npm:

```bash
npm install intext
# or
pnpm add intext
yarn add intext
```

During local development, use the source directly or `npm pack`.

---

## 3 — Quickstart

```ts
import { createIntext, SchemaField } from "intext"; // or from "./src/index" in this repo

// Minimal OpenAI‑compatible client
function createOpenAIClient(apiKey: string, baseURL = "https://api.openai.com/v1") {
  return {
    chat: {
      completions: {
        create: async (args: Record<string, any>) => {
          const res = await fetch(`${baseURL}/chat/completions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(args),
          });
          if (!res.ok) throw new Error(`LLM error ${res.status}`);
          return res.json();
        },
      },
    },
  };
}

// Create an intext instance
const openai = createOpenAIClient(process.env.OPENAI_API_KEY!);
const intext = createIntext({
  openai,
  clientParams: { model: "gpt-4o", temperature: 0 },
  // optional library‑level defaults, e.g. { stream: false }
  // defaultRequestParams: { stream: false },
});

// Define a JSON‑Schema‑like target object shape
const schema: SchemaField = {
  type: "object",
  properties: {
    issue: { type: "string", description: "one‑sentence summary" },
    next_moves: {
      type: "array",
      description: "list of actions",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          owner: { type: "string" },
          due: { type: "string" },
        },
      },
    },
  },
};

const longText = `...very long transcript...`;

const result = await intext.extract(longText, {
  schema,
  chunkTokens: 1500,
  overlapTokens: 300,
  concurrency: 3,
  // per‑call overrides take precedence over clientParams/defaultRequestParams
  // llmCallOptions: { temperature: 0.2 },
});

console.log(JSON.stringify(result.json, null, 2));
console.log(result.metadata.perFieldProvenance);
```

---

## 4 — Example OpenAI client

A copy‑ready client using `fetch` (Node >= 18 or compatible runtimes):

```ts
export function createOpenAIClient(apiKey: string, baseURL = "https://api.openai.com/v1") {
  return {
    chat: {
      completions: {
        create: async (args: Record<string, any>) => {
          const r = await fetch(`${baseURL}/chat/completions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(args),
          });
          if (!r.ok) {
            const t = await r.text();
            throw new Error(`OpenAI error ${r.status}: ${t}`);
          }
          return r.json();
        },
      },
    },
  };
}
```

---

## 5 — API Reference

### `createIntext(params) => { extract }`

Parameters:

- `openai: OpenAICompatibleClient`
  - Must expose `chat.completions.create(args) => Promise<any>`
- `clientParams: ClientPreferredParams`
  - e.g., `{ model: string; temperature?: number; max_tokens?: number; ... }`
- `defaultRequestParams?: Record<string, any>`
  - Optional library‑level defaults merged into every request

Returns an object with:

- `extract(text: string, opts: ExtractOptions): Promise<ExtractResult>`

### Types

```ts
export type SchemaField = {
  type: "object";
  properties: {
    [key: string]: {
      type: "string" | "array" | "object" | "number" | "boolean";
      description?: string;
      items?: SchemaField;
      properties?: Record<string, SchemaField>;
    };
  };
  required?: string[];
};

export type ExtractOptions = {
  schema: SchemaField;
  chunkTokens?: number;    // default 1500
  overlapTokens?: number;  // default 300
  concurrency?: number;    // default 3
  tokenizer?: (text: string) => string[];
  llmCallOptions?: Record<string, any>;
  debug?: boolean;
};

export type ExtractResult = {
  json: Record<string, any>;
  metadata: {
    chunkCount: number;
    perFieldProvenance: Record<string, { sourceChunks: number[] }>;
    rawChunkResults: Array<{ chunkId: number; parsed: Record<string, any>; raw?: string }>;
  };
};

export type OpenAICompatibleClient = {
  chat: { completions: { create: (args: Record<string, any>) => Promise<any> } };
};

export type ClientPreferredParams = {
  model: string;
  temperature?: number;
  max_tokens?: number;
  [key: string]: any;
};
```

---

## 6 — Chunking & tuning

- Default tokenizer is word‑based (`text.split(/\s+/)`). Bring your own tokenizer for exact model tokens.
- Defaults: `chunkTokens = 1500`, `overlapTokens = 300`.
- Overlap ensures items cut across boundaries are seen at least once fully.
- For lower latency, reduce chunk size or increase `concurrency` (watch cost).

---

## 7 — Aggregation (final reduction)

`intext` aggregates per‑chunk results using a single final reduction prompt that includes your JSON schema and all per‑chunk results. The LLM returns ONLY the final JSON object. The library returns that JSON and provenance (which chunks contributed non‑null values per field).

You can implement your own aggregation externally by consuming `metadata.rawChunkResults`.

---

## 8 — Examples

This repo includes runnable examples:

- `examples/basic-example.ts`
- `examples/meeting-analysis.ts`

Run with:

```bash
npm run examples:basic
npm run examples:meeting
```

Make sure `OPENAI_API_KEY` is set in your environment.

---

## 9 — Tests & build

Run tests:

```bash
npm test
```

Build the library (emits to `dist/`):

```bash
npm run build
```

---

## 10 — Security & privacy

- `intext` does not call the network by itself — you provide the client.
- Handle API keys securely and respect data governance policies.
- Consider redaction pre‑tokenization if sending sensitive text to external services.

---

## 11 — License

MIT
