import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { audit } from '../dist/audit.js';
import { estimateMcpCost } from '../dist/mcp.js';
import { resolveWindow, WINDOWS } from '../dist/windows.js';

async function fixture(files) {
  const dir = await mkdtemp(join(tmpdir(), 'ctxaudit-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, content, 'utf8');
  }
  return dir;
}

test('audit on an empty directory reports zero, not an error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ctxaudit-empty-'));
  try {
    const r = await audit(dir, { profile: 'heuristic' });
    assert.equal(r.preflightTokens, 0);
    assert.equal(r.preflightShare, 0);
    assert.equal(r.items.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('AGENTS.md counts toward pre-flight', async () => {
  const dir = await fixture({ 'AGENTS.md': '# Rules\n' + 'Always test. '.repeat(200) });
  try {
    const r = await audit(dir, { profile: 'heuristic' });
    assert.ok(r.preflightTokens > 0);
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].label, 'AGENTS.md');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('skill metadata counted, bodies excluded from pre-flight', async () => {
  const dir = await fixture({
    '.agents/skills/one/SKILL.md': '---\nname: one\ndescription: first skill\n---\n' + 'body '.repeat(300),
    '.agents/skills/two/SKILL.md': '---\nname: two\ndescription: second skill\n---\n' + 'body '.repeat(300),
  });
  try {
    const r = await audit(dir, { profile: 'heuristic' });
    const meta = r.items.find((i) => i.label.startsWith('skill metadata'));
    assert.ok(meta, 'expected a skill metadata line item');
    // Two short descriptions must stay small even though bodies are large.
    assert.ok(meta.tokens < 60, `metadata unexpectedly large: ${meta.tokens}`);
    assert.equal(r.skills.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('same skill installed twice is counted once', async () => {
  const md = '---\nname: dup\ndescription: the same skill in two places\n---\nbody\n';
  const dir = await fixture({
    '.agents/skills/dup/SKILL.md': md,
    '.claude/skills/dup/SKILL.md': md,
  });
  try {
    const r = await audit(dir, { profile: 'heuristic' });
    assert.equal(r.skills.length, 1, 'duplicate installs must collapse to one skill');
    assert.ok(r.warnings.some((w) => /more than one directory/.test(w)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('MCP servers add schema cost', async () => {
  const dir = await fixture({
    '.mcp.json': JSON.stringify({ mcpServers: { github: { command: 'x' }, fetch: { command: 'y' } } }),
  });
  try {
    const r = await audit(dir, { profile: 'heuristic' });
    assert.equal(r.mcpServers.length, 2);
    const gh = r.mcpServers.find((s) => s.name === 'github');
    assert.equal(gh.confidence, 'measured');
    assert.ok(gh.tokens >= 15000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('preflightShare reflects the chosen window', async () => {
  const dir = await fixture({ 'AGENTS.md': 'word '.repeat(400) });
  try {
    const small = await audit(dir, { profile: 'heuristic', window: 'small-8k' });
    const large = await audit(dir, { profile: 'heuristic', window: 'claude-1m' });
    assert.ok(small.preflightShare > large.preflightShare);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('unknown window throws a clear error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ctxaudit-w-'));
  try {
    await assert.rejects(() => audit(dir, { window: 'nope-123' }), /unknown window/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('unparseable MCP config warns instead of crashing', async () => {
  const dir = await fixture({ '.mcp.json': '{ this is not json or yaml: [' });
  try {
    const r = await audit(dir, { profile: 'heuristic' });
    assert.ok(r.warnings.some((w) => /could not parse MCP config/.test(w)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('estimateMcpCost returns null for unparseable input', () => {
  assert.equal(estimateMcpCost('{{{', 'heuristic'), null);
});

test('estimateMcpCost returns empty array for a config with no servers', () => {
  assert.deepEqual(estimateMcpCost('{"other": true}', 'heuristic'), []);
});

test('resolveWindow accepts presets and raw numbers', () => {
  assert.equal(resolveWindow('claude-200k').tokens, 200000);
  assert.equal(resolveWindow('50000').tokens, 50000);
  assert.equal(resolveWindow('bogus'), null);
  for (const w of WINDOWS) assert.ok(resolveWindow(w.id), `preset ${w.id} unresolved`);
});
