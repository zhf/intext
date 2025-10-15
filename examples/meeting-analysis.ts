import { createIntextInstance } from "./shared";
import { SchemaField } from "../src/index";
import { readFileSync } from "fs";

(async () => {
  const intext = createIntextInstance();

  // Define schema for extracting dispute information from meeting transcripts
  const schema: SchemaField = {
    type: "object",
    properties: {
      issues_of_dispute: {
        type: "array",
        description: "technical disagreements, resource allocation conflicts, or timeline disputes mentioned in the meeting",
        items: {
          type: "object",
          properties: {
            text: { type: "string" }
          }
        }
      },
      next_moves: {
        type: "array",
        description: "specific action items with owners and deadlines mentioned in the meeting",
        items: {
          type: "object",
          properties: {
            text: { type: "string" }
          }
        }
      },
      team_members_involved: {
        type: "array",
        description: "names and roles of team members participating in the discussion",
        items: {
          type: "object",
          properties: {
            name: { type: "string" }
          }
        }
      },
      timeline_impact: {
        type: "string",
        description: "summary of how disputes affect project timeline and deadlines"
      },
      project_status: {
        type: "string",
        description: "overall health of the project as decided in the meeting",
        enum: ["on_track", "at_risk", "blocked"]
      }
    }
  };

  try {
    // Read the meeting transcript file
    const transcript = readFileSync("examples/meeting-transcript.txt", "utf8");

    console.log("Extracting information from meeting transcript...");

    const res = await intext.extract(transcript, {
      schema,
      chunkTokens: 500,
      overlapTokens: 50,
      concurrency: 8,
      debug: true,
    });

    console.log("\n=== Extracted Information ===");
    console.log(JSON.stringify(res, null, 2));

    // Print specific sections for better readability
    console.log("\n=== Issues of Dispute ===");
    if (Array.isArray(res.json.issues_of_dispute)) {
      res.json.issues_of_dispute.forEach((item: any, index: number) => {
        const text = typeof item === "string" ? item : (item?.text ?? JSON.stringify(item));
        console.log(`${index + 1}. ${text}`);
      });
    } else {
      console.log("No issues identified");
    }

    console.log("\n=== Next Moves ===");
    if (Array.isArray(res.json.next_moves)) {
      res.json.next_moves.forEach((item: any, index: number) => {
        if (typeof item === "string") {
          console.log(`${index + 1}. ${item}`);
        } else {
          const action = item?.action ?? item?.action_item ?? item?.task ?? item?.text ?? "(action)";
          const owner = item?.owner ?? item?.assignee ?? item?.by ?? null;
          const deadline = item?.deadline ?? item?.due ?? item?.due_date ?? null;
          const parts = [action, owner ? `owner: ${owner}` : null, deadline ? `due: ${deadline}` : null].filter(Boolean);
          console.log(`${index + 1}. ${parts.join(" | ")}`);
        }
      });
    } else {
      console.log("No next moves identified");
    }

    console.log("\n=== Team Members Involved ===");
    if (Array.isArray(res.json.team_members_involved)) {
      res.json.team_members_involved.forEach((item: any, index: number) => {
        if (typeof item === "string") {
          console.log(`${index + 1}. ${item}`);
        } else {
          const name = item?.name ?? item?.member ?? item?.text ?? "(name)";
          const role = item?.role ?? null;
          console.log(`${index + 1}. ${name}${role ? ` — ${role}` : ""}`);
        }
      });
    } else {
      console.log("No team members identified");
    }

    console.log(`\n=== Timeline Impact ===`);
    console.log(res.json.timeline_impact || "No timeline impact identified");

    console.log(`\n=== Project Status ===`);
    console.log(res.json.project_status || "No status recorded");

  } catch (error) {
    console.error("Error reading transcript file:", error);
    console.log("Make sure meeting-transcript.txt is in the root directory");
  }
})();
