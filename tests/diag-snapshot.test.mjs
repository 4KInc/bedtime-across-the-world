import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { checkDiag, MAX_KEYS } from '../server/diag.ts';

// The client's snapshot (diag-system.ts) is one object literal plus the stage placement.
// Nov 15: it grew to 50 fields while the server allowed 48, and every batch was refused.
const src = readFileSync(new URL('../src/diag/diag-system.ts', import.meta.url), 'utf8');
const block = (start, end) => {
  const from = src.indexOf(start);
  return src.slice(from, src.indexOf(end, from));
};
const keys = (text) => [...new Set([...text.matchAll(/(?:^|[\s{,])([a-zA-Z]\w*):\s/gm)].map((m) => m[1]))];
const snapKeys = keys(block("k: 'snap'", '\n    };'));
const placeKeys = keys(block('private placement(', '\n  }'));

test('a full snapshot fits the server limit, with room to grow', () => {
  const all = [...new Set([...snapKeys, ...placeKeys])];
  assert.ok(snapKeys.includes('pg') && placeKeys.includes('wallW'), 'found the snapshot and placement fields');
  assert.ok(all.length + 6 <= MAX_KEYS, `snapshot has ${all.length} fields; the server allows ${MAX_KEYS}`);
  const item = Object.fromEntries(all.map((k) => [k, 1]));
  item.k = 'snap';
  assert.ok(checkDiag({ v: 1, session: 'abcdefghjk', items: [item] }), 'the server accepts it');
});
