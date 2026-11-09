/**
 * The audit: turn discovered files into a cost breakdown.
 *
 * Output shape is intentionally flat and serialisable — the same structure
 * feeds the terminal report, the JSON output, and the CI budget check.
 */

import { discover } from './discover.js';
import { estimateMcpCost, type McpServerCost } from './mcp.js';
import { analyzeSkill, findCollisions, type Collision, type SkillInfo } from './skills.js';
import { countTokens, type ProfileName } from './tokens.js';
import { resolveWindow } from './windows.js';

export interface LineItem {
  /** Human label, e.g. "AGENTS.md" or "skills metadata (12 skills)". */
  label: string;
  tokens: number;
  /** Share of the pre-flight total, 0..1. */
  share: number;
  /** Where the number came from. */
  detail: string;
  /** Whether this cost recurs on every request. */
  recurring: boolean;
}

export interface AuditReport {
  root: string;
  profile: ProfileName;
  profileNote: string;
  window: { label: string; tokens: number };
  /** Total tokens consumed before the user types anything. */
  preflightTokens: number;
  /** preflightTokens / window.tokens, 0..1. */
  preflightShare: number;
  items: LineItem[];
  skills: SkillInfo[];
  collisions: Collision[];
  mcpServers: McpServerCost[];
  missing: string[];
  unreadable: string[];
  warnings: string[];
  /** Actionable suggestions, ordered by tokens saved. */
  recommendations: Recommendation[];
}

export interface Recommendation {
  title: string;
  detail: string;
  /** Estimated tokens saved if followed. */
  saves: number;
}

export interface AuditOptions {
  profile?: ProfileName;
  window?: string;
  /** Similarity threshold for skill description collisions. */
  collisionThreshold?: number;
}

export async function audit(rootInput: string, opts: AuditOptions = {}): Promise<AuditReport> {
  const profile = opts.profile ?? 'o200k';
  const window = resolveWindow(opts.window ?? 'claude-200k');
  if (!window) throw new Error(`unknown window: ${opts.window}`);

  const disc = await discover(rootInput);
  const warnings: string[] = [];

  if (disc.unreadable.length > 0) {
    warnings.push(
      `${disc.unreadable.length} config file(s) exist but could not be read: ${disc.unreadable.join(', ')}`,
    );
  }

  // --- Instructions: the simplest and usually largest recurring cost ---
  const instructionItems: LineItem[] = [];
  for (const f of disc.files.filter((x) => x.kind === 'instructions')) {
    const { tokens } = countTokens(f.content, profile);
    instructionItems.push({
      label: f.relPath,
      tokens,
      share: 0,
      detail: `${f.bytes} bytes, ${f.ecosystem}`,
      recurring: true,
    });
  }

  // --- Skills: metadata recurs, bodies do not ---
  //
  // Deduplicate by skill name. The same library is frequently installed in
  // several places (.agents/skills, agent/skills, .opencode/skills) — sometimes
  // as a symlink, sometimes as a copy. Counting each copy would triple the
  // reported tax and invent collisions between a skill and itself.
  const skillFiles = disc.files.filter((f) => f.kind === 'skill-metadata');
  const byName = new Map<string, SkillInfo>();
  const duplicateNames: string[] = [];
  for (const f of skillFiles) {
    const info = analyzeSkill(f.content, f.relPath, profile, f.skillDirName);
    const existing = byName.get(info.name);
    if (existing) {
      duplicateNames.push(info.name);
      continue;
    }
    byName.set(info.name, info);
  }
  const skills: SkillInfo[] = [...byName.values()];

  if (duplicateNames.length > 0) {
    warnings.push(
      `${duplicateNames.length} skill(s) are installed in more than one directory and were counted once (first: ${duplicateNames[0]})`,
    );
  }

  const skillMetadataTokens = skills.reduce((a, s) => a + s.metadataTokens, 0);
  const skillBodyTokens = skills.reduce((a, s) => a + s.bodyTokens, 0);

  if (skills.length > 0) {
    const broken = skills.filter((s) => s.warnings.length > 0);
    if (broken.length > 0) {
      warnings.push(
        `${broken.length} skill(s) have frontmatter problems (first: ${broken[0]!.relPath})`,
      );
    }
  }

  const collisions = findCollisions(skills, opts.collisionThreshold ?? 0.5);

  // --- MCP: schemas load at startup ---
  const mcpServers: McpServerCost[] = [];
  let mcpConfigTokens = 0;
  for (const f of disc.files.filter((x) => x.kind === 'mcp-config')) {
    const costs = estimateMcpCost(f.content, profile);
    if (costs === null) {
      warnings.push(`could not parse MCP config: ${f.relPath}`);
      continue;
    }
    mcpServers.push(...costs);
    mcpConfigTokens += countTokens(f.content, profile).tokens;
  }
  const mcpSchemaTokens = mcpServers.reduce((a, s) => a + s.tokens, 0);

  // --- Assemble line items ---
  const items: LineItem[] = [...instructionItems];

  if (skills.length > 0) {
    items.push({
      label: `skill metadata (${skills.length} skills)`,
      tokens: skillMetadataTokens,
      share: 0,
      detail: `name + description of every installed skill, injected each request`,
      recurring: true,
    });
  }

  if (mcpServers.length > 0) {
    items.push({
      label: `MCP tool schemas (${mcpServers.length} servers)`,
      tokens: mcpSchemaTokens,
      share: 0,
      detail: mcpServers.map((s) => `${s.name}~${s.tokens}`).join(', '),
      recurring: true,
    });
    if (mcpConfigTokens > 0) {
      items.push({
        label: 'MCP config files',
        tokens: mcpConfigTokens,
        share: 0,
        detail: 'raw config JSON',
        recurring: true,
      });
    }
  }

  const preflightTokens = items.reduce((a, i) => a + i.tokens, 0);
  for (const item of items) {
    item.share = preflightTokens === 0 ? 0 : item.tokens / preflightTokens;
  }

  // --- Recommendations, ordered by tokens saved ---
  const recommendations: Recommendation[] = [];

  const biggestInstruction = [...instructionItems].sort((a, b) => b.tokens - a.tokens)[0];
  if (biggestInstruction && biggestInstruction.tokens > 2000) {
    recommendations.push({
      title: `Trim ${biggestInstruction.label}`,
      detail:
        'Instruction files past ~2k tokens hit lost-in-the-middle: the agent reads the ends and skips the middle. Move reference material into a separate doc the agent can open on demand.',
      saves: Math.floor(biggestInstruction.tokens * 0.4),
    });
  }

  if (collisions.length > 0) {
    const worst = collisions[0]!;
    recommendations.push({
      title: `Resolve ${collisions.length} skill description collision(s)`,
      detail: `"${worst.a}" and "${worst.b}" overlap ${(worst.similarity * 100).toFixed(0)}%. The router picks between them using only name + description, so one will shadow the other. Add an explicit "not for..." line to whichever is narrower.`,
      saves: 0,
    });
  }

  const priciestMcp = [...mcpServers].sort((a, b) => b.tokens - a.tokens)[0];
  if (priciestMcp && priciestMcp.tokens > 5000) {
    recommendations.push({
      title: `Disable or lazy-load the "${priciestMcp.name}" MCP server`,
      detail:
        'Tool schemas load at startup and are paid every session, including sessions that never touch that server. Remove it from the project config and enable it per-task instead.',
      saves: priciestMcp.tokens,
    });
  }

  if (skillMetadataTokens > 4000) {
    recommendations.push({
      title: 'Prune rarely-used skills',
      detail: `${skills.length} skills cost ${skillMetadataTokens.toLocaleString('en-US')} tokens of metadata on every request. Every skill you never invoke is pure tax.`,
      saves: Math.floor(skillMetadataTokens * 0.5),
    });
  }

  recommendations.sort((a, b) => b.saves - a.saves);

  const profileNote =
    profile === 'o200k'
      ? 'o200k_base (GPT-4o/o-series vocab)'
      : profile === 'cl100k'
        ? 'cl100k_base (GPT-4 vocab)'
        : 'chars/4 heuristic';

  return {
    root: disc.root,
    profile,
    profileNote,
    window,
    preflightTokens,
    preflightShare: window.tokens === 0 ? 0 : preflightTokens / window.tokens,
    items: items.sort((a, b) => b.tokens - a.tokens),
    skills: skills.sort((a, b) => b.metadataTokens - a.metadataTokens),
    collisions,
    mcpServers: mcpServers.sort((a, b) => b.tokens - a.tokens),
    missing: disc.missing,
    unreadable: disc.unreadable,
    warnings,
    recommendations,
    // skillBodyTokens is intentionally not added to preflight — bodies load
    // on demand. Exposed for callers that want the full picture.
    ...({ skillBodyTokens } as Record<string, number>),
  };
}
