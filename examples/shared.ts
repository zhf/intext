import { createIntext, SchemaField } from "../src/index";

// Minimal OpenAI-compatible client using fetch with the shape: openai.chat.completions.create(args)
export function createOpenAIClient(apiKey: string, baseURL = "https://api.openai.com/v1") {
  return {
    chat: {
      completions: {
        create: async (args: Record<string, any>) => {
          const resp = await fetch(`${baseURL}/chat/completions`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(args),
          });
          if (!resp.ok) {
            const txt = await resp.text();
            throw new Error(`LLM error: ${resp.status} ${txt}`);
          }
          return resp.json();
        },
      },
    },
  };
}

// Get environment variables safely
export function getEnvVars() {
  return {
    apiKey: (globalThis as any)?.process?.env?.OPENAI_API_KEY,
    baseURL: (globalThis as any)?.process?.env?.OPENAI_BASE_URL,
  };
}

// Create intext instance with default configuration
export function createIntextInstance(apiKey?: string, baseURL?: string) {
  const { apiKey: envApiKey, baseURL: envBaseURL } = getEnvVars();
  
  const openai = createOpenAIClient(apiKey || envApiKey, baseURL || envBaseURL);
  
  return createIntext({
    openai,
    clientParams: {
      model: "gpt-4o-mini",
      temperature: 0,
    },
    defaultRequestParams: { stream: false },
  });
}