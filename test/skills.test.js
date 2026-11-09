import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitFrontmatter, analyzeSkill, findCollisions, tokenizeDescription } from '../dist/skills.js';

test('parses frontmatter and body', () => {
  const md = `---\nname: my-skill\ndescription: does a thing\n---\n# Body\ncontent here\n`;
  const { frontmatter, body, error } = splitFrontmatter(md);
  assert.equal(error, null);
  assert.equal(frontmatter.name, 'my-skill');
  assert.match(body, /content here/);
});

test('reports missing frontmatter instead of throwing', () => {
  const { error } = splitFrontmatter('# Just a heading\n');
  assert.ok(error);
});

test('reports invalid YAML instead of throwing', () => {
  const { error } = splitFrontmatter('---\nname: [unclosed\n---\nbody\n');
  assert.ok(error && /invalid YAML/.test(error));
});

test('metadata tokens exclude the body', () => {
  const shortBody = `---\nname: s\ndescription: short\n---\nhi\n`;
  const longBody = `---\nname: s\ndescription: short\n---\n${'word '.repeat(500)}\n`;
  const a = analyzeSkill(shortBody, 'a/SKILL.md', 'heuristic');
  const b = analyzeSkill(longBody, 'b/SKILL.md', 'heuristic');
  assert.equal(a.metadataTokens, b.metadataTokens, 'body length must not affect metadata cost');
  assert.ok(b.bodyTokens > a.bodyTokens);
});

test('falls back to directory name when frontmatter omits name', () => {
  const md = `---\ndescription: no name field\n---\nbody\n`;
  const s = analyzeSkill(md, 'skills/aws-thing/SKILL.md', 'heuristic', 'aws-thing');
  assert.equal(s.name, 'aws-thing');
});

test('warns when name is missing', () => {
  const md = `---\ndescription: x\n---\nbody\n`;
  const s = analyzeSkill(md, 'p/SKILL.md', 'heuristic', 'p');
  assert.ok(s.warnings.some((w) => /missing `name`/.test(w)));
});

test('tokenizeDescription drops stopwords and short words', () => {
  const words = tokenizeDescription('Use this to help the user with testing');
  assert.ok(!words.has('the'));
  assert.ok(!words.has('use'));
  assert.ok(words.has('testing'));
});

test('detects colliding descriptions', () => {
  const a = analyzeSkill(
    `---\nname: deploy-vercel\ndescription: deploy applications to vercel hosting platform\n---\n`,
    'a/SKILL.md', 'heuristic', 'deploy-vercel');
  const b = analyzeSkill(
    `---\nname: vercel-deploy\ndescription: deploy applications to vercel hosting platform\n---\n`,
    'b/SKILL.md', 'heuristic', 'vercel-deploy');
  const c = analyzeSkill(
    `---\nname: pdf-parse\ndescription: extract text from scanned pdf documents\n---\n`,
    'c/SKILL.md', 'heuristic', 'pdf-parse');
  const collisions = findCollisions([a, b, c], 0.5);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].similarity, 1);
});

test('does not report a skill as colliding with itself', () => {
  const mk = (path) => analyzeSkill(
    `---\nname: same-skill\ndescription: identical description here for both copies\n---\n`,
    path, 'heuristic', 'same-skill');
  // Same skill installed in two directories: one identity, no collision.
  const collisions = findCollisions([mk('x/SKILL.md'), mk('y/SKILL.md')], 0.5);
  assert.equal(collisions.length, 0);
});
