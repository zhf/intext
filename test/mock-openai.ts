/* eslint-disable @typescript-eslint/no-explicit-any */
// Mock OpenAI-compatible client for tests
// Exposes chat.completions.create(args)

export function createMockOpenAI() {
  return {
    chat: {
      completions: {
        create: async (args: Record<string, any>) => {
          const content: string = args?.messages?.[0]?.content ?? "";

          // Final reduction prompt branch: new prompt starts with this phrase
          if (content.startsWith("You are a JSON reducer")) {
            const finalJson = {
              issue: "Combined issue from chunks",
              next_moves: [ { text: "Do X" }, { text: "Do Y" } ],
              status: "closed"
            };
            return {
              choices: [
                { message: { content: JSON.stringify(finalJson) } }
              ]
            };
          }

          // Per-chunk extraction branch: detect which chunk by its text content
          let issue = null as string | null;
          let nextMoves: any[] | null = null;
          if (content.includes("CHUNK1")) {
            issue = "Issue A";
            nextMoves = [{ text: "Do X" }];
            return {
              choices: [
                { message: { content: JSON.stringify({ issue, next_moves: nextMoves, status: "unknown" }) } }
              ]
            };
          } else if (content.includes("CHUNK2")) {
            issue = "Issue B";
            nextMoves = [{ text: "Do Y" }];
            return {
              choices: [
                { message: { content: JSON.stringify({ issue, next_moves: nextMoves, status: "closed" }) } }
              ]
            };
          } else {
            // default minimal response
            issue = null;
            nextMoves = [];
          }

          const perChunk = { issue, next_moves: nextMoves, status: null };
          return {
            choices: [
              { message: { content: JSON.stringify(perChunk) } }
            ]
          };
        },
      },
    },
  };
}
