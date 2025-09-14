import { createIntextInstance } from "./shared";
import { SchemaField } from "../src/index";

(async () => {
  const intext = createIntextInstance();

  const schema: SchemaField = {
    type: "object",
    properties: {
      issue: {
        type: "string",
        description: "one-sentence summary of the core dispute"
      },
      next_moves: {
        type: "array",
        description: "list of actions with task and due date",
        items: {
          type: "object",
          properties: {
            task: {
              type: "string"
            },
            due: {
              type: "string"
            }
          }
        }
      }
    }
  };

  const text = `
  Participant A: I think we should delay payment until milestone 2.
  Participant B: No, we need to keep the original payment schedule otherwise cashflow suffers.
  Action: Finance to send invoice and confirm dates. Owner: Finance, Due: 2025-09-10.
  `;

  const res = await intext.extract(text, { schema, chunkTokens: 50, overlapTokens: 10, concurrency: 2, debug: true });
  console.log(JSON.stringify(res, null, 2));
})();
