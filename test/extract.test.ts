/* eslint-disable @typescript-eslint/no-explicit-any */
import { createIntext, SchemaField } from "../src/index";
import { createMockOpenAI } from "./mock-openai";

async function run() {
  const openai = createMockOpenAI();

  const intext = createIntext({
    openai,
    clientParams: { model: "mock-model", temperature: 0 },
    defaultRequestParams: { stream: false },
  });

  const schema: SchemaField = {
    type: "object",
    properties: {
      issue: { type: "string", description: "one-sentence summary" },
      next_moves: {
        type: "array",
        description: "list of actions",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
          },
        },
      },
      status: {
        type: "string",
        description: "overall outcome",
        enum: ["open", "closed"],
      },
    },
  };

  const text = `This is CHUNK1 with some details.\nAnd here is CHUNK2 with other details.`;

  const res = await intext.extract(text, {
    schema,
    chunkTokens: 5,
    overlapTokens: 0,
    concurrency: 2,
    debug: false,
  });

  if (res.json.issue !== "Combined issue from chunks") {
    throw new Error(`Expected merged issue to be 'Combined issue from chunks' but got: ${res.json.issue}`);
  }
  if (!Array.isArray(res.json.next_moves)) {
    throw new Error(`Expected next_moves to be an array but got: ${typeof res.json.next_moves}`);
  }
  const texts = res.json.next_moves.map((x: any) => x.text);
  if (!(texts.includes("Do X") && texts.includes("Do Y"))) {
    throw new Error(`Expected next_moves to include Do X and Do Y, got: ${JSON.stringify(texts)}`);
  }
  if (res.json.status !== "closed") {
    throw new Error(`Expected status to be 'closed' but got: ${res.json.status}`);
  }
  const chunkStatuses = res.metadata.rawChunkResults.map((x) => x.parsed.status);
  if (!(chunkStatuses.includes(null) && chunkStatuses.includes("closed"))) {
    throw new Error(`Expected chunk statuses to include null and "closed", got: ${JSON.stringify(chunkStatuses)}`);
  }

  console.log("All tests passed");
}

run().catch((e) => {
  console.error(e);
  // @ts-ignore
  process.exit(1);
});
