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
