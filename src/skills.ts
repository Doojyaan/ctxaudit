/**
 * Skill metadata parsing.
 *
 * The key insight this module encodes: a skill's *body* is loaded on demand,
 * but its name + description are injected into the system prompt on every
 * request. So the metadata is the recurring cost, and the body is a one-time
 * cost paid only when the skill is actually used.
 *
 * That distinction is why we report them separately instead of summing.
 */

import YAML from 'yaml';
import { countTokens, type ProfileName } from './tokens.js';

export interface SkillInfo {
  name: string;
  description: string;
  /** Tokens for `name` + `description`, paid on every request. */
  metadataTokens: number;
  /** Tokens for the whole file, paid only when the skill loads. */
  bodyTokens: number;
  /** Path for display. */
  relPath: string;
  /** Frontmatter problems worth surfacing. */
  warnings: string[];
}

interface Frontmatter {
  name?: unknown;
  description?: unknown;
  [key: string]: unknown;
}

/**
 * Split a SKILL.md into frontmatter and body.
 *
 * Deliberately tolerant: a malformed skill should produce a warning attached
 * to that skill, not abort the whole audit. One broken skill in a 400-skill
 * library must not stop you from seeing the other 399.
 */
export function splitFrontmatter(content: string): {
  frontmatter: Frontmatter;
  body: string;
  error: string | null;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!match) {
    return { frontmatter: {}, body: content, error: 'no YAML frontmatter found' };
  }
  const [, raw, body] = match;
  try {
    const parsed = YAML.parse(raw ?? '') as Frontmatter | null;
    if (!parsed || typeof parsed !== 'object') {
      return { frontmatter: {}, body: body ?? '', error: 'frontmatter is not a mapping' };
    }
    return { frontmatter: parsed, body: body ?? '', error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { frontmatter: {}, body: body ?? '', error: `invalid YAML: ${msg}` };
  }
}

export function analyzeSkill(
  content: string,
  relPath: string,
  profile: ProfileName,
  /** Directory name holding SKILL.md — used when frontmatter omits `name`. */
  fallbackName?: string,
): SkillInfo {
  const { frontmatter, body, error } = splitFrontmatter(content);
  const warnings: string[] = [];
  if (error) warnings.push(error);

  const declaredName = typeof frontmatter.name === 'string' ? frontmatter.name : '';
  const description =
    typeof frontmatter.description === 'string' ? frontmatter.description : '';

  if (!declaredName) warnings.push('missing `name` in frontmatter');
  if (!description) warnings.push('missing `description` in frontmatter');

  // Identity falls back to the directory name, not the path: the same skill
  // installed in three directories must resolve to one identity.
  const name = declaredName || fallbackName || relPath;

  // This is the number that matters: what the router sees on every turn.
  const metadataText = [declaredName || fallbackName || '', description]
    .filter(Boolean)
    .join('\n');
  const metadataTokens = countTokens(metadataText, profile).tokens;
  const bodyTokens = countTokens(body, profile).tokens;

  return { name, description, metadataTokens, bodyTokens, relPath, warnings };
}

/**
 * Detect descriptions that are likely to collide with each other.
 *
 * The router only sees name + description [A-14], so two skills whose
 * descriptions overlap heavily will shadow each other — and adding a new skill
 * can silently break an old one [N-02]. We use a cheap Jaccard similarity over
 * lowercased word sets: no embeddings, no network, fully deterministic.
 */
export interface Collision {
  a: string;
  b: string;
  similarity: number;
  shared: string[];
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with', 'when',
  'use', 'this', 'that', 'is', 'are', 'be', 'it', 'as', 'at', 'by', 'from',
  'you', 'your', 'should', 'can', 'will', 'if', 'not', 'but', 'any', 'all',
  'help', 'helps', 'used', 'using', 'user', 'users',
]);

export function tokenizeDescription(description: string): Set<string> {
  const words = description
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  return new Set(words);
}

export function findCollisions(skills: SkillInfo[], threshold = 0.5): Collision[] {
  const out: Collision[] = [];
  const sets = skills.map((s) => ({ skill: s, words: tokenizeDescription(s.description) }));

  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const left = sets[i]!;
      const right = sets[j]!;
      // Two entries with the same name are the same skill found twice on disk,
      // not two skills competing for the same routing slot. Skip them: reporting
      // a skill as colliding with itself is noise, and it drowns the real
      // collisions when a repo has several skill directories.
      if (left.skill.name === right.skill.name) continue;
      if (left.words.size === 0 || right.words.size === 0) continue;

      let intersection = 0;
      const shared: string[] = [];
      for (const w of left.words) {
        if (right.words.has(w)) {
          intersection++;
          shared.push(w);
        }
      }
      const union = left.words.size + right.words.size - intersection;
      const similarity = union === 0 ? 0 : intersection / union;

      if (similarity >= threshold) {
        out.push({
          a: left.skill.name,
          b: right.skill.name,
          similarity,
          shared: shared.sort(),
        });
      }
    }
  }

  return out.sort((x, y) => y.similarity - x.similarity);
}
