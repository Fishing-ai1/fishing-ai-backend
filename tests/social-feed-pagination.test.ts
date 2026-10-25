import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { decodeFeedCursor, encodeFeedCursor } from '../src/social/FeedCursor.ts';

test('feed cursor is scoped, bounded, and keeps ranked candidates', () => {
  const scope = 'abc123';
  const cursor = {
    scope,
    beforeAt: '2026-10-25T00:00:00.000Z',
    beforeId: '00000000-0000-4000-8000-000000000001',
    pending: [{ id: '00000000-0000-4000-8000-000000000002', score: 42.5 }],
    more: true,
  };
  assert.deepEqual(decodeFeedCursor(encodeFeedCursor(cursor), scope), cursor);
  assert.throws(() => decodeFeedCursor(encodeFeedCursor(cursor), 'other'), /Invalid feed cursor/);
  assert.throws(() => decodeFeedCursor('1', scope), /Invalid feed cursor/);
  const fullCursor = { ...cursor, pending: Array.from({ length: 48 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, score: 58.12,
  })) };
  assert.ok(encodeFeedCursor(fullCursor).length < 4096);
  assert.equal(decodeFeedCursor(encodeFeedCursor(fullCursor), scope).pending.length, 48);
});

test('server-only feed query keyset-pages all public categories without duplicates', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create table public.community_posts(
        id uuid primary key, user_id uuid not null, created_at timestamptz not null,
        status text not null, privacy text not null, category text not null,
        species text, general_area text, post_type text, media_type text
      );
      create table public.community_follows(follower_id uuid, following_id uuid);
      grant select on public.community_posts, public.community_follows to service_role;
    `);
    await db.exec(fs.readFileSync('supabase/migrations/20261025005144_scalable_social_feed_candidates.sql', 'utf8'));
    const author = '11111111-1111-4111-8111-111111111111';
    const viewer = '22222222-2222-4222-8222-222222222222';
    for (let i = 1; i <= 121; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      await db.query(`insert into public.community_posts values
        ($1, $2, $3, 'active', 'public', $4, 'snapper', 'Brisbane', 'discussion', null)`,
        [id, author, '2026-10-25T00:00:00Z', i % 2 ? 'camping' : 'boats']);
    }
    await db.query(`insert into public.community_posts values
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', $1, now(), 'active', 'private', 'camping', null, null, 'discussion', null),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', $1, now(), 'hidden', 'public', 'camping', null, null, 'discussion', null)`, [author]);
    const page = async (beforeAt: string | null, beforeId: string | null, feed = 'home') => {
      const result = await db.query<{ id: string; created_at: string }>(`
        select id, created_at from public.oc_social_feed_candidates(
          $1::uuid, $2::text, ''::text, ''::text, ''::text,
          $3::timestamptz, $4::uuid, null::uuid[], 49
        )`, [viewer, feed, beforeAt, beforeId]);
      return result.rows;
    };
    const ids: string[] = [];
    let beforeAt: string | null = null;
    let beforeId: string | null = null;
    for (;;) {
      const rows = await page(beforeAt, beforeId);
      const batch = rows.slice(0, 48);
      ids.push(...batch.map(row => row.id));
      if (rows.length <= 48) break;
      beforeAt = batch.at(-1)!.created_at;
      beforeId = batch.at(-1)!.id;
    }
    assert.equal(ids.length, 121);
    assert.equal(new Set(ids).size, 121);
    assert.equal((await page(null, null, 'following')).length, 0);
    await db.query('insert into public.community_follows values ($1, $2)', [viewer, author]);
    assert.equal((await page(null, null, 'following')).length, 49);
    assert.equal((await page(null, null, 'boats')).length, 49);
    await db.exec('set role authenticated');
    await assert.rejects(() => db.query('select * from public.oc_social_feed_candidates(null,null,null,null,null,null,null,null,1)'), /permission denied/);
  } finally {
    await db.close();
  }
});
