/* eslint-disable @typescript-eslint/no-explicit-any */
// Chunking utilities: tokenizer and sliding-window chunk builder
import { segmentIntoTokens } from 'token-estimator';

export type Chunk = {
  id: number;
  text: string;
  startChar: number;
  endChar: number;
  tokens: string[]; // tokenized words
};

// Default tokenizer powered by token-estimator
export function defaultTokenizer(text: string): string[] {
  // Use token-estimator to segment into tokens, exclude pure whitespace tokens
  const tokens = segmentIntoTokens(text);
  return tokens
    .filter(t => t.category !== 'whitespace')
    .map(t => t.text);
}

export function buildChunks(
  text: string,
  chunkTokens: number,
  overlapTokens: number,
  tokenizer: (t: string) => string[]
): Chunk[] {
  const tokens = tokenizer(text);
  if (tokens.length === 0) return [];

  // Build mapping from token index -> character indices in original text
  // We'll find each token's start index by progressively searching from previous end.
  const tokenCharPositions: { start: number; end: number }[] = [];
  let searchIdx = 0;
  for (const tok of tokens) {
    const found = text.indexOf(tok, searchIdx);
    if (found === -1) {
      // fallback: approximate by advancing
      tokenCharPositions.push({ start: searchIdx, end: Math.min(searchIdx + tok.length, text.length) });
      searchIdx += tok.length;
    } else {
      tokenCharPositions.push({ start: found, end: found + tok.length });
      searchIdx = found + tok.length;
    }
  }

  const chunks: Chunk[] = [];
  let i = 0;
  let chunkId = 0;
  while (i < tokens.length) {
    const startToken = i;
    const endToken = Math.min(i + chunkTokens, tokens.length);
    const chunkTokensSlice = tokens.slice(startToken, endToken);
    const startChar = tokenCharPositions[startToken].start;
    const endChar = tokenCharPositions[endToken - 1].end;
    chunks.push({
      id: chunkId++,
      text: text.slice(startChar, endChar),
      startChar,
      endChar,
      tokens: chunkTokensSlice,
    });
    // advance i by chunkTokens - overlapTokens to create sliding window
    const step = Math.max(1, chunkTokens - overlapTokens);
    i += step; // ensure progress and respect overlap
  }
  return chunks;
}
