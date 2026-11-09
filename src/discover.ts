/**
 * Discovery of agent configuration in a working directory.
 *
 * Design note: we never *assume* a layout. Every path is probed and reported
 * with whether it was found. A missing file is information too — "you have no
 * AGENTS.md" is part of the answer.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

export type SourceKind = 'instructions' | 'skill-metadata' | 'mcp-config' | 'settings';

export interface DiscoveredFile {
  /** Absolute path. */
  path: string;
  /** Path relative to the audited root, for display. */
  relPath: string;
  kind: SourceKind;
  /** Which agent ecosystem this file belongs to. */
  ecosystem: string;
  /** Raw file contents. Empty string when unreadable. */
  content: string;
  /** Bytes on disk. */
  bytes: number;
  /**
   * For skill files: the directory name holding SKILL.md. This is the skill's
   * real identity — many SKILL.md files omit `name` in frontmatter, and the
   * same library is often installed under several directories.
   */
  skillDirName?: string;
}

export interface DiscoveryResult {
  root: string;
  files: DiscoveredFile[];
  /** Paths we looked for and did not find. Surfaced in reports. */
  missing: string[];
  /** Files that matched a name but could not be read. */
  unreadable: string[];
}

interface Probe {
  path: string;
  kind: SourceKind;
  ecosystem: string;
}

const PROBES: Probe[] = [
  // Instructions — the files that ride along on every single turn.
  { path: 'AGENTS.md', kind: 'instructions', ecosystem: 'agents-md' },
  { path: 'CLAUDE.md', kind: 'instructions', ecosystem: 'claude-code' },
  { path: '.cursorrules', kind: 'instructions', ecosystem: 'cursor' },
  { path: '.github/copilot-instructions.md', kind: 'instructions', ecosystem: 'copilot' },
  { path: 'GEMINI.md', kind: 'instructions', ecosystem: 'gemini' },
  { path: '.windsurfrules', kind: 'instructions', ecosystem: 'windsurf' },

  // MCP configuration — tool schemas are loaded at startup.
  { path: '.mcp.json', kind: 'mcp-config', ecosystem: 'mcp' },
  { path: 'opencode.json', kind: 'mcp-config', ecosystem: 'opencode' },
  { path: '.cursor/mcp.json', kind: 'mcp-config', ecosystem: 'cursor' },
  { path: '.vscode/mcp.json', kind: 'mcp-config', ecosystem: 'vscode' },

  // Agent settings that can carry injected instructions.
  { path: '.claude/settings.json', kind: 'settings', ecosystem: 'claude-code' },
  { path: '.claude/settings.local.json', kind: 'settings', ecosystem: 'claude-code' },
];

/** Directories that hold one subdirectory per skill. */
const SKILL_DIRS: Array<{ path: string; ecosystem: string }> = [
  { path: '.agents/skills', ecosystem: 'agents-md' },
  { path: '.claude/skills', ecosystem: 'claude-code' },
  { path: '.opencode/skills', ecosystem: 'opencode' },
  { path: '.cursor/skills', ecosystem: 'cursor' },
  { path: 'agent/skills', ecosystem: 'opencode' },
];

async function readIfFile(absPath: string): Promise<{ content: string; bytes: number } | null> {
  try {
    const st = await stat(absPath);
    if (!st.isFile()) return null;
    const content = await readFile(absPath, 'utf8');
    return { content, bytes: st.size };
  } catch {
    return null;
  }
}

async function listSkillFiles(
  root: string,
  dir: string,
  ecosystem: string,
): Promise<{ files: DiscoveredFile[]; missing: boolean }> {
  const absDir = join(root, dir);
  let entries: string[];
  try {
    entries = await readdir(absDir);
  } catch {
    return { files: [], missing: true };
  }

  const files: DiscoveredFile[] = [];
  for (const entry of entries) {
    const abs = join(absDir, entry, 'SKILL.md');
    const got = await readIfFile(abs);
    if (!got) continue;
    files.push({
      path: abs,
      relPath: relative(root, abs).replace(/\\/g, '/'),
      kind: 'skill-metadata',
      ecosystem,
      content: got.content,
      bytes: got.bytes,
      skillDirName: entry,
    });
  }
  return { files, missing: false };
}

/**
 * Scan a directory for every agent configuration file we know about.
 *
 * Depth is intentionally one level: config lives at the repo root, and
 * recursing would drag in node_modules and vendored skill collections that
 * are not actually loaded by the agent.
 */
export async function discover(rootInput: string): Promise<DiscoveryResult> {
  const root = resolve(rootInput);
  const files: DiscoveredFile[] = [];
  const missing: string[] = [];
  const unreadable: string[] = [];

  for (const probe of PROBES) {
    const abs = join(root, probe.path);
    const got = await readIfFile(abs);
    if (!got) {
      // Distinguish "absent" from "present but unreadable" — the second is a bug
      // the user needs to know about, the first is just a fact.
      let exists = false;
      try {
        await stat(abs);
        exists = true;
      } catch {
        exists = false;
      }
      if (exists) unreadable.push(probe.path);
      else missing.push(probe.path);
      continue;
    }
    files.push({
      path: abs,
      relPath: probe.path,
      kind: probe.kind,
      ecosystem: probe.ecosystem,
      content: got.content,
      bytes: got.bytes,
    });
  }

  for (const sd of SKILL_DIRS) {
    const res = await listSkillFiles(root, sd.path, sd.ecosystem);
    if (res.missing) missing.push(sd.path);
    else files.push(...res.files);
  }

  return { root, files, missing, unreadable };
}
