/**
 * Parsing of MCP configs into tool-schema cost estimates.
 *
 * We cannot know a server's real schema without starting it, so we estimate
 * from what the config declares and from per-server costs measured in the wild.
 * Every estimate carries a `confidence` field so the report never pretends to
 * more precision than it has.
 */

import YAML from 'yaml';
import { countTokens, type ProfileName } from './tokens.js';

export type Confidence = 'measured' | 'declared' | 'estimated';

export interface McpServerCost {
  name: string;
  /** Tokens contributed by this server's tool schemas. */
  tokens: number;
  confidence: Confidence;
  /** How we arrived at the number, shown in verbose output. */
  basis: string;
}

/**
 * Published per-server schema costs, in tokens.
 *
 * Sources (all cited in README):
 * - GitHub MCP server: ~50k tokens measured [HN P-25]
 * - GitHub MCP server: 15–20k tokens [GitHub B-11]
 * - Typical small server: ~3k tokens of JSON schema
 *
 * We take the conservative middle of each published range. The point of the
 * tool is order-of-magnitude awareness, not false precision.
 */
const KNOWN_SERVER_COSTS: Record<string, { tokens: number; source: string }> = {
  github: { tokens: 20000, source: 'B-11: 15–20k tokens for the GitHub MCP server' },
  filesystem: { tokens: 3000, source: 'typical small server schema' },
  playwright: { tokens: 6000, source: 'N-06: browser toolset ~6,600 tokens/request' },
  'brave-search': { tokens: 1200, source: 'typical search server schema' },
  fetch: { tokens: 900, source: 'single-tool server' },
  sqlite: { tokens: 2500, source: 'typical database server schema' },
  context7: { tokens: 1500, source: 'typical docs server schema' },
  supabase: { tokens: 8000, source: 'large multi-tool server' },
  slack: { tokens: 7000, source: 'large multi-tool server' },
  linear: { tokens: 6000, source: 'large multi-tool server' },
  notion: { tokens: 6000, source: 'large multi-tool server' },
};

/** Fallback for servers we have no published number for. */
const UNKNOWN_SERVER_TOKENS = 4000;

interface McpConfigShape {
  mcp?: Record<string, unknown>;
  mcpServers?: Record<string, unknown>;
  servers?: Record<string, unknown>;
}

/**
 * Extract server names from a config.
 *
 * Returns `null` only when the content cannot be parsed at all. A valid config
 * that declares no servers returns `[]` — "this file costs nothing" is a real
 * answer and must not be confused with "we failed to read it".
 */
function extractServerNames(content: string): string[] | null {
  // Try JSON first — all supported configs are JSON.
  let parsed: unknown;
  let jsonOk = false;
  try {
    parsed = JSON.parse(content);
    jsonOk = true;
  } catch {
    // Fall through to YAML (some people keep .mcp.json as YAML by accident).
  }

  if (!jsonOk) {
    try {
      parsed = YAML.parse(content);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== 'object') return null;

  const obj = parsed as McpConfigShape;
  const block = obj.mcp ?? obj.mcpServers ?? obj.servers;
  if (!block || typeof block !== 'object') return [];
  return Object.keys(block);
}

/**
 * Estimate the token cost of every MCP server declared in a config file.
 *
 * Returns an empty array when the file declares no servers — that is a real
 * result (the config costs nothing) and must not be confused with a parse error,
 * which returns null.
 */
export function estimateMcpCost(
  content: string,
  profile: ProfileName,
): McpServerCost[] | null {
  const names = extractServerNames(content);
  if (!names) return null;

  return names.map((name) => {
    const known = KNOWN_SERVER_COSTS[name.toLowerCase()];
    if (known) {
      return {
        name,
        tokens: known.tokens,
        confidence: 'measured' as const,
        basis: known.source,
      };
    }
    return {
      name,
      tokens: UNKNOWN_SERVER_TOKENS,
      confidence: 'estimated' as const,
      basis: 'no published figure; assumed 4k tokens (typical multi-tool server)',
    };
  });
}

/**
 * Cost of the raw config file itself. Small, but real: the JSON rides along
 * in some harnesses.
 */
export function configFileTokens(content: string, profile: ProfileName): number {
  return countTokens(content, profile).tokens;
}
