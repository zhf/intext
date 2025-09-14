# Intext Examples

This directory contains example usage patterns for the Intext library.

## Files

- `shared.ts` - Shared utilities and helper functions
- `example.ts` - Basic example demonstrating core functionality
- `meeting-analysis.ts` - Example analyzing meeting transcripts for disputes and action items

## Setup

Before running examples, make sure you have:

1. Set your OpenAI API key as an environment variable:
   ```bash
   export OPENAI_API_KEY=your_api_key_here
   ```

2. Optionally set a custom base URL:
   ```bash
   export OPENAI_BASE_URL=https://api.openai.com/v1
   ```

## Running Examples

### Basic Example
```bash
npx ts-node examples/basic-example.ts
```

This demonstrates the core extraction functionality with a simple dispute scenario.

### Meeting Analysis Example
```bash
npx ts-node examples/meeting-analysis.ts
```

This analyzes the meeting transcript file to extract:
- Issues of dispute
- Next moves/action items
- Team members involved
- Timeline impact

The meeting transcript file should be located at `meeting-transcript.txt` in the project root.

## Schema Configuration

Examples demonstrate different schema configurations:

- `issue` - String fields for dispute summaries
- `next_moves` - Array fields for action items
- `team_members_involved` - Array fields for participant lists
- `timeline_impact` - String fields for impact analysis

## Processing Options

Examples show different processing configurations:

- `chunkTokens` - Size of text chunks for processing
- `overlapTokens` - Overlap between chunks to maintain context
- `concurrency` - Number of parallel processing operations
- `debug` - Enable debug logging

## Aggregation

Examples aggregate per-chunk results using a single final reduction prompt that includes your JSON schema and all per-chunk results. The LLM returns the final JSON object directly. You can inspect `metadata.rawChunkResults` for per-chunk outputs and `metadata.perFieldProvenance` for contributing chunk IDs.