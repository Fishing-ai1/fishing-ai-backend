import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("commerce foundation prices, access and append-only transactions", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key);");
    await db.exec(fs.readFileSync("supabase/migrations/20261002205543_oceancore_commerce_foundation.sql", "utf8"));
    const prices = (await db.query("select product_id,price_cents from public.oc_products order by product_id")).rows;
    assert.deepEqual(prices.map((row) => row.price_cents), [1874, 16499, 374, 2999, 974, 7499]);
    const access = (await db.query("select has_table_privilege('anon','public.oc_transactions','select') as anon_read, has_table_privilege('authenticated','public.oc_products','update') as user_write")).rows[0];
    assert.equal(access.anon_read, false);
    assert.equal(access.user_write, false);
    await db.query("insert into public.oc_transactions(source_key,provider,entry_type,amount_cents,currency,value_status,occurred_at) values('test:one','stripe','gross_receipt',974,'AUD','actual',now())");
    await assert.rejects(() => db.query("update public.oc_transactions set amount_cents=1 where source_key='test:one'"));
    await assert.rejects(() => db.query("delete from public.oc_transactions where source_key='test:one'"));
    await assert.rejects(() => db.query("insert into public.oc_transactions(source_key,provider,entry_type,amount_cents,currency,value_status,occurred_at) values('test:one','stripe','gross_receipt',974,'AUD','actual',now())"));
    const args = ["stripe", "evt_one", "invoice.paid", "in_one", null, null, 974, "AUD", new Date().toISOString()];
    assert.equal((await db.query("select public.oc_record_provider_receipt($1,$2,$3,$4,$5,$6,$7,$8,$9) as recorded", args)).rows[0].recorded, true);
    assert.equal((await db.query("select public.oc_record_provider_receipt($1,$2,$3,$4,$5,$6,$7,$8,$9) as recorded", args)).rows[0].recorded, false);
    assert.equal((await db.query("select count(*)::int as count from public.oc_transactions where provider_reference='in_one'")).rows[0].count, 1);
    assert.equal((await db.query("select status from public.oc_provider_events where event_id='evt_one'")).rows[0].status, "processed");
  } finally {
    await db.close();
  }
});

test("launch ad rule defaults to a 40 percent creator share without overwriting edits", async () => {
  const db = new PGlite();
  try {
    await db.exec("create table public.oc_ad_rules(name text,enabled boolean,version integer,config jsonb,updated_at timestamptz)");
    await db.exec("insert into public.oc_ad_rules(name,enabled,version,config) values ('Launch default',false,1,'{\"creator_revenue_share_percent\":45}'),('Custom',false,2,'{\"creator_revenue_share_percent\":45}')");
    await db.exec(fs.readFileSync("supabase/migrations/20261002212551_oceancore_creator_share_default.sql", "utf8"));
    const rows = (await db.query("select name,version,config->>'creator_revenue_share_percent' as share from public.oc_ad_rules order by name")).rows;
    assert.deepEqual(rows.map((row) => [row.name, row.version, row.share]), [["Custom", 2, "45"], ["Launch default", 2, "40"]]);
  } finally {
    await db.close();
  }
});

test("subscription events are ordered, idempotent, and cannot cancel a replacement", async () => {
  const db = new PGlite();
  const userId = "11111111-1111-4111-8111-111111111111";
  const until = new Date(Date.now() + 30 * 86400000).toISOString();
  const at = (seconds: number) => new Date(1760000000000 + seconds * 1000).toISOString();
  const apply = async (eventId: string, type: string, seconds: number, sub: string, plan: string, status: string) => {
    const result = await db.query(
      "select public.oc_apply_subscription_event($1,$2,$3,$4,$5,$6,$7,$8) as applied",
      [eventId, type, at(seconds), userId, sub, plan, status, until],
    );
    return result.rows[0].applied;
  };
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create table public.profiles(id uuid primary key,plan text,subscription_status text,stripe_subscription_id text);");
    await db.exec(fs.readFileSync("supabase/migrations/20261002205543_oceancore_commerce_foundation.sql", "utf8"));
    await db.query("insert into auth.users(id) values($1)", [userId]);
    await db.query("insert into public.profiles(id,plan,subscription_status) values($1,'crew','active')", [userId]);
    await db.exec(fs.readFileSync("supabase/migrations/20261012072926_oceancore_subscription_entitlement_events.sql", "utf8"));
    assert.equal((await db.query("select metadata->>'plan' as plan from public.oc_entitlements where user_id=$1 and provider='manual'", [userId])).rows[0].plan, "crew");
    assert.equal((await db.query("select has_function_privilege('anon','public.oc_apply_subscription_event(text,text,timestamptz,uuid,text,text,text,timestamptz)','execute') as allowed")).rows[0].allowed, false);
    assert.equal(await apply("evt_a", "customer.subscription.created", 10, "sub_one", "lite", "active"), true);
    assert.equal(await apply("evt_a", "customer.subscription.created", 10, "sub_one", "lite", "active"), false);
    assert.equal(await apply("evt_old", "customer.subscription.updated", 9, "sub_one", "lite", "past_due"), false);
    assert.equal(await apply("evt_b", "customer.subscription.created", 20, "sub_two", "premium", "active"), true);
    assert.equal(await apply("evt_c", "customer.subscription.deleted", 30, "sub_one", "lite", "cancelled"), false);
    const row = (await db.query("select status,provider_subscription_id,metadata->>'plan' as plan from public.oc_entitlements where user_id=$1 and provider='stripe'", [userId])).rows[0];
    assert.deepEqual([row.status, row.provider_subscription_id, row.plan], ["active", "sub_two", "premium"]);
    assert.equal((await db.query("select count(*)::int as count from public.oc_provider_events where status='processed'")).rows[0].count, 4);
    await assert.rejects(() => db.query(
      "select public.oc_apply_subscription_event($1,$2,$3,$4,$5,$6,$7,$8)",
      ["evt_no_period", "customer.subscription.updated", at(40), userId, "sub_two", "premium", "active", null],
    ));
  } finally {
    await db.close();
  }
});
