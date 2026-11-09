import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countTokens, PROFILES, resetEncoderCache } from '../dist/tokens.js';

test('empty string is zero tokens', () => {
  assert.equal(countTokens('').tokens, 0);
});

test('counts a known string consistently across calls', () => {
  const a = countTokens('the quick brown fox jumps over the lazy dog');
  const b = countTokens('the quick brown fox jumps over the lazy dog');
  assert.equal(a.tokens, b.tokens);
  assert.ok(a.tokens > 0 && a.tokens < 20, `unexpected count ${a.tokens}`);
});

test('longer text costs more tokens', () => {
  const short = countTokens('hello world');
  const long = countTokens('hello world '.repeat(100));
  assert.ok(long.tokens > short.tokens);
});

test('heuristic profile works without a vocabulary', () => {
  const r = countTokens('hello world', 'heuristic');
  assert.equal(r.profileUsed, 'heuristic');
  assert.equal(r.degraded, false);
  assert.ok(r.tokens > 0);
});

test('heuristic charges non-ascii denser than ascii', () => {
  // 40 ASCII chars vs 40 CJK chars: CJK must not be estimated at ascii rates.
  const ascii = countTokens('a'.repeat(40), 'heuristic').tokens;
  const cjk = countTokens('漢'.repeat(40), 'heuristic').tokens;
  assert.ok(cjk > ascii, `expected CJK (${cjk}) > ASCII (${ascii})`);
});

test('every advertised profile resolves', () => {
  for (const name of Object.keys(PROFILES)) {
    const r = countTokens('test input', name);
    assert.ok(r.tokens > 0, `profile ${name} returned ${r.tokens}`);
  }
});

test('resetEncoderCache does not break subsequent counts', () => {
  const before = countTokens('cache test').tokens;
  resetEncoderCache();
  const after = countTokens('cache test').tokens;
  assert.equal(before, after);
});
