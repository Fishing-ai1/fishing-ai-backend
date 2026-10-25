import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('database keeps held messages private and reserves message sends atomically', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated;
      create role anon;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create table public.community_conversation_members(conversation_id uuid, user_id uuid);
      create table public.community_messages(
        id uuid primary key, conversation_id uuid, sender_id uuid,
        body text, status text, moderation_reason text
      );
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
      grant select on public.community_messages, public.community_conversation_members to authenticated;
      alter table public.community_messages enable row level security;
    `);
    await db.exec(fs.readFileSync('supabase/migrations/20261025000428_community_message_safety_limits.sql', 'utf8'));

    const sender = '11111111-1111-4111-8111-111111111111';
    const recipient = '22222222-2222-4222-8222-222222222222';
    const conversation = '33333333-3333-4333-8333-333333333333';
    await db.query('insert into auth.users(id) values ($1), ($2)', [sender, recipient]);
    await db.query('insert into public.community_conversation_members values ($1, $2), ($1, $3)', [conversation, sender, recipient]);
    await db.query(`insert into public.community_messages values
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', $1, $2, 'visible', 'active', null),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', $1, $2, 'held', 'held', null),
      ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', $1, $2, 'removed', 'removed', null)`, [conversation, sender]);

    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${recipient}';`);
    let rows = await db.query<{ body: string }>('select body from public.community_messages order by body');
    assert.deepEqual(rows.rows.map(row => row.body), ['visible']);
    await db.exec(`set request.jwt.claim.sub = '${sender}';`);
    rows = await db.query<{ body: string }>('select body from public.community_messages order by body');
    assert.deepEqual(rows.rows.map(row => row.body), ['held', 'visible']);

    await assert.rejects(() => db.query('select public.oc_reserve_message_send($1)', [sender]), /permission denied/);
    await db.exec('set role service_role');
    for (let i = 0; i < 20; i++) {
      const result = await db.query<{ retry: number }>('select public.oc_reserve_message_send($1) as retry', [sender]);
      assert.equal(result.rows[0].retry, 0);
    }
    const denied = await db.query<{ retry: number }>('select public.oc_reserve_message_send($1) as retry', [sender]);
    assert.ok(denied.rows[0].retry > 0);
    const independent = await db.query<{ retry: number }>('select public.oc_reserve_message_send($1) as retry', [recipient]);
    assert.equal(independent.rows[0].retry, 0);
  } finally {
    await db.close();
  }
});
