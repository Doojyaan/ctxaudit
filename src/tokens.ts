/**
 * Token counting with swappable profiles.
 *
 * Why profiles instead of one tokenizer: different providers ship different
 * BPE vocabularies. Reporting a single number with no provenance is how people
 * end up 30% off. We pick a profile, name it in the output, and let the user
 * override it.
 */

import { getEncoding, type Tiktoken } from 'js-tiktoken';

export type ProfileName = 'o200k' | 'cl100k' | 'heuristic';

export interface Profile {
  name: ProfileName;
  label: string;
  /** Rough accuracy note surfaced in reports so numbers are never naked. */
  note: string;
}

export const PROFILES: Record<ProfileName, Profile> = {
  o200k: {
    name: 'o200k',
    label: 'o200k_base',
    note: 'GPT-4o / o-series vocab. Closest available proxy for most modern models.',
  },
  cl100k: {
    name: 'cl100k',
    label: 'cl100k_base',
    note: 'GPT-4 / GPT-3.5 vocab. Underestimates on some newer tokenizers.',
  },
  heuristic: {
    name: 'heuristic',
    label: 'chars/4 heuristic',
    note: 'No vocab needed. Fast, offline, ±20% on prose. Use only as a fallback.',
  },
};

export const DEFAULT_PROFILE: ProfileName = 'o200k';

let encoderCache: Tiktoken | null = null;
let encoderProfile: ProfileName | null = null;

function getEncoder(profile: ProfileName): Tiktoken | null {
  if (profile === 'heuristic') return null;
  if (encoderCache && encoderProfile === profile) return encoderCache;
  try {
    encoderCache = getEncoding(profile === 'o200k' ? 'o200k_base' : 'cl100k_base');
    encoderProfile = profile;
    return encoderCache;
  } catch {
    // js-tiktoken can fail to load a vocab in restricted environments.
    // Callers fall back to the heuristic rather than crashing the audit.
    return null;
  }
}

export interface CountResult {
  tokens: number;
  /** True when the requested profile was unavailable and we fell back. */
  degraded: boolean;
  profileUsed: ProfileName;
}

/**
 * Count tokens in a string.
 *
 * The heuristic divides by 4 because that ratio holds well for English prose
 * and code. It is deliberately conservative for CJK (which tokenizes far
 * denser) — see `heuristicDivisor` handling below.
 */
export function countTokens(text: string, profile: ProfileName = DEFAULT_PROFILE): CountResult {
  if (!text) return { tokens: 0, degraded: false, profileUsed: profile };

  if (profile === 'heuristic') {
    return { tokens: heuristicCount(text), degraded: false, profileUsed: 'heuristic' };
  }

  const enc = getEncoder(profile);
  if (!enc) {
    return { tokens: heuristicCount(text), degraded: true, profileUsed: 'heuristic' };
  }

  try {
    return { tokens: enc.encode(text).length, degraded: false, profileUsed: profile };
  } catch {
    return { tokens: heuristicCount(text), degraded: true, profileUsed: 'heuristic' };
  }
}

/**
 * Heuristic token estimate.
 *
 * Base ratio is 4 chars/token for ASCII. Non-ASCII characters (CJK, emoji,
 * accented text) tokenize much denser, so we charge them at 1.5 chars/token.
 * Without this split, a README full of Chinese would be underestimated by ~4x.
 */
function heuristicCount(text: string): number {
  let ascii = 0;
  let nonAscii = 0;
  for (const ch of text) {
    if (ch.codePointAt(0)! < 128) ascii++;
    else nonAscii++;
  }
  return Math.ceil(ascii / 4 + nonAscii / 1.5);
}

export function resetEncoderCache(): void {
  encoderCache = null;
  encoderProfile = null;
}
