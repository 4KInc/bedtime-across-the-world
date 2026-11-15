import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BucketDiagSink } from './diag.ts';

/** A stand-in bucket: objects by name. */
function bucket(fail = { get: false }) {
  const objects = new Map<string, string>();
  return {
    objects,
    fail,
    put: async (name: string, body: string) => void objects.set(name, body),
    get: async (name: string) => {
      if (fail.get) throw new Error('unavailable');
      return objects.get(name) ?? null;
    },
  };
}
const batch = (session: string, ...lines: string[]) => ({ session, lines }) as never;

test('a session reopened on a new server instance continues its stored file, never overwrites it', async () => {
  const b = bucket();
  const first = new BucketDiagSink(b.put, b.get, 1e9);
  await first.append(batch('abc123', '{"t":1}', '{"t":2}'), '2026-11-15');
  await first.flush();
  // A deploy or scale-to-zero later: a new instance, the same session sends again.
  const second = new BucketDiagSink(b.put, b.get, 1e9);
  await second.append(batch('abc123', '{"t":3}'), '2026-11-15');
  await second.flush();
  assert.deepEqual(b.objects.get('diag/2026-11-15/abc123.jsonl')!.trim().split('\n'), ['{"t":1}', '{"t":2}', '{"t":3}']);
});

test('when what is stored cannot be read, nothing is written until it can', async () => {
  const b = bucket();
  b.objects.set('diag/2026-11-15/abc123.jsonl', '{"t":1}\n');
  const sink = new BucketDiagSink(b.put, b.get, 1e9);
  b.fail.get = true;
  await sink.append(batch('abc123', '{"t":2}'), '2026-11-15');
  await sink.flush();
  assert.equal(b.objects.get('diag/2026-11-15/abc123.jsonl'), '{"t":1}\n');
  b.fail.get = false;
  await sink.flush();
  assert.deepEqual(b.objects.get('diag/2026-11-15/abc123.jsonl')!.trim().split('\n'), ['{"t":1}', '{"t":2}']);
});
