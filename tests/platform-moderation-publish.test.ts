import assert from 'node:assert/strict';
import test from 'node:test';
import { flagContent } from '../src/platform/moderation.ts';

const input = { userId: 'user', targetType: 'post', targetId: 'post', text: 'Morning on the water' };

test('clean content has no review flags', async () => {
  const db = { from: () => { throw new Error('No queue write expected'); } };
  const gateway = { config: { moderation: 'test' }, moderate: async () => ({ connected: true, flagged: false }) };
  assert.deepEqual(await flagContent(db, gateway, input), []);
});

test('risky content and unavailable moderation create review work before publication', async () => {
  const inserted: any[] = [];
  const db = { from: () => ({ insert: async (rows: any[]) => { inserted.push(...rows); return { error: null }; } }) };
  const gateway = { config: { moderation: 'test' }, moderate: async () => ({ connected: false, flagged: false }) };
  const flags = await flagContent(db, gateway, { ...input, text: 'Send your password' });
  assert.ok(flags.length >= 2);
  assert.equal(inserted.length, flags.length);
  assert.ok(flags.some(flag => flag.reason.includes('provider unavailable')));
});

test('review queue failure blocks publication', async () => {
  const db = { from: () => ({ insert: async () => ({ error: new Error('database down') }) }) };
  const gateway = { config: { moderation: 'test' }, moderate: async () => ({ connected: true, flagged: true, categories: { violence: true }, scores: { violence: 0.98 } }) };
  await assert.rejects(() => flagContent(db, gateway, input), /Moderation review could not be recorded/);
});
