-- OceanCore monetization and weekly financial control foundation.
-- Financial ledgers are server-only and append-only. Browser roles receive no access.
begin;
set local lock_timeout = '5s';

create table public.oc_ad_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  enabled boolean not null default false,
  priority integer not null default 100,
  countries text[] not null default '{}',
  content_types text[] not null default '{}',
  config jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(config) = 'object')
);

insert into public.oc_ad_rules(name,enabled,priority,config) values (
  'Launch default',false,100,
  '{"feed_interval_min":5,"feed_interval_max":7,"minimum_monetized_video_seconds":60,"pre_roll_enabled":true,"mid_roll_enabled":true,"first_mid_roll_seconds":180,"max_ads_per_session":8,"max_ads_per_user_per_day":20,"cooldown_seconds":180,"creator_revenue_share_percent":45}'::jsonb
);

create table public.oc_ad_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null check(event_type in ('opportunity_created','request_sent','filled','not_filled','started','impression_confirmed','completed','skipped','clicked','revenue_reported')),
  provider text not null,
  placement text not null check(placement in ('feed','pre_roll','mid_roll','post_roll','sponsored')),
  content_id text,
  creator_id uuid references auth.users(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  session_hash text,
  country text check(country is null or country ~ '^[A-Z]{2}$'),
  device text,
  platform text,
  revenue_aud numeric(18,6) check(revenue_aud is null or revenue_aud >= 0),
  provider_reference text,
  metadata jsonb not null default '{}',
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  check (user_id is not null or nullif(session_hash,'') is not null),
  check (jsonb_typeof(metadata) = 'object')
);
create index oc_ad_events_time on public.oc_ad_events(occurred_at desc,id);
create index oc_ad_events_provider_type on public.oc_ad_events(provider,event_type,occurred_at desc);
create index oc_ad_events_creator on public.oc_ad_events(creator_id,occurred_at desc) where creator_id is not null;
create index oc_ad_events_content on public.oc_ad_events(content_id,occurred_at desc) where content_id is not null;

create table public.oc_media_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null check(event_type in ('view_started','qualified_view','watch_progress','view_completed')),
  content_id text not null,
  creator_id uuid references auth.users(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  session_hash text,
  country text check(country is null or country ~ '^[A-Z]{2}$'),
  device text,
  platform text,
  content_category text,
  duration_seconds numeric check(duration_seconds is null or duration_seconds >= 0),
  watch_seconds numeric check(watch_seconds is null or watch_seconds >= 0),
  bytes_delivered bigint check(bytes_delivered is null or bytes_delivered >= 0),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  check (user_id is not null or nullif(session_hash,'') is not null)
);
create index oc_media_events_time on public.oc_media_events(occurred_at desc,id);
create index oc_media_events_content on public.oc_media_events(content_id,event_type,occurred_at desc);

create table public.oc_revenue_entries (
  id uuid primary key default gen_random_uuid(),
  entry_key text not null unique,
  stream text not null check(stream in ('advertising','subscription','affiliate','marketplace','sponsorship','data_product','other')),
  value_status text not null check(value_status in ('actual','estimated','projected')),
  amount_aud numeric(18,6) not null,
  provider text,
  provider_reference text,
  country text check(country is null or country ~ '^[A-Z]{2}$'),
  creator_id uuid references auth.users(id) on delete set null,
  content_id text,
  metadata jsonb not null default '{}',
  recognized_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object')
);
create index oc_revenue_entries_period on public.oc_revenue_entries(recognized_at desc,stream,value_status);

create table public.oc_cost_entries (
  id uuid primary key default gen_random_uuid(),
  entry_key text not null unique,
  category text not null check(category in ('video_delivery','video_storage','transcoding','ai','database','bandwidth','api','moderation','creator_payout','acquisition','other')),
  value_status text not null check(value_status in ('actual','estimated','projected')),
  amount_aud numeric(18,6) not null,
  provider text,
  provider_reference text,
  user_id uuid references auth.users(id) on delete set null,
  creator_id uuid references auth.users(id) on delete set null,
  content_id text,
  metadata jsonb not null default '{}',
  incurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object')
);
create index oc_cost_entries_period on public.oc_cost_entries(incurred_at desc,category,value_status);

create table public.oc_creator_payouts (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  eligible_revenue_aud numeric(18,6) not null default 0 check(eligible_revenue_aud >= 0),
  direct_delivery_cost_aud numeric(18,6) not null default 0 check(direct_delivery_cost_aud >= 0),
  revenue_share_percent numeric(7,4) not null check(revenue_share_percent between 0 and 100),
  payout_aud numeric(18,6) not null default 0 check(payout_aud >= 0),
  status text not null default 'pending_validation' check(status in ('pending_validation','approved','held','paid','cancelled')),
  validation jsonb not null default '{}',
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  paid_at timestamptz,
  check(period_end >= period_start),
  check(payout_aud <= greatest(0,eligible_revenue_aud-direct_delivery_cost_aud)),
  unique(creator_id,period_start,period_end)
);

create table public.oc_fraud_signals (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references auth.users(id) on delete set null,
  content_id text,
  signal_type text not null check(signal_type in ('self_viewing','bot_pattern','repeated_device','abnormal_watch','geographic_anomaly','fake_engagement')),
  severity text not null check(severity in ('low','medium','high','critical')),
  score numeric not null check(score between 0 and 1),
  evidence jsonb not null default '{}',
  status text not null default 'open' check(status in ('open','reviewing','cleared','confirmed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index oc_fraud_signals_queue on public.oc_fraud_signals(status,severity,created_at desc);

create table public.oc_financial_targets (
  metric text primary key,
  target_value numeric not null,
  direction text not null check(direction in ('minimum','maximum')),
  unit text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.oc_financial_targets(metric,target_value,direction,unit) values
  ('revenue_per_mau_aud',1.20,'minimum','AUD'),
  ('gross_margin_percent',40,'minimum','percent')
on conflict(metric) do nothing;

create table public.oc_monthly_budgets (
  month date not null check(month=date_trunc('month',month)::date),
  category text not null check(category in ('video_delivery','video_storage','transcoding','ai','database','bandwidth','api','moderation','creator_payout','acquisition','other')),
  budget_aud numeric(18,2) not null check(budget_aud >= 0),
  warning_thresholds numeric[] not null default array[50,75,90,100],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(month,category)
);

create table public.oc_weekly_financial_snapshots (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  week_end date not null,
  version integer not null default 1,
  value_status text not null check(value_status in ('actual','estimated','projected')),
  health_status text not null check(health_status in ('no_data','green','amber','red','critical')),
  metrics jsonb not null,
  reasons jsonb not null default '[]',
  warnings jsonb not null default '[]',
  recommended_actions jsonb not null default '[]',
  assumptions jsonb not null default '{}',
  generated_at timestamptz not null default now(),
  check(week_end=week_start+6),
  unique(week_start,version)
);
create index oc_weekly_snapshots_period on public.oc_weekly_financial_snapshots(week_start desc,version desc);

create function public.oc_financial_ledger_immutable() returns trigger
language plpgsql set search_path='' as $$ begin raise exception 'Financial ledger is append-only'; end $$;

create trigger oc_ad_events_immutable before update or delete or truncate on public.oc_ad_events for each statement execute function public.oc_financial_ledger_immutable();
create trigger oc_media_events_immutable before update or delete or truncate on public.oc_media_events for each statement execute function public.oc_financial_ledger_immutable();
create trigger oc_revenue_entries_immutable before update or delete or truncate on public.oc_revenue_entries for each statement execute function public.oc_financial_ledger_immutable();
create trigger oc_cost_entries_immutable before update or delete or truncate on public.oc_cost_entries for each statement execute function public.oc_financial_ledger_immutable();
create trigger oc_weekly_snapshots_immutable before update or delete or truncate on public.oc_weekly_financial_snapshots for each statement execute function public.oc_financial_ledger_immutable();

create function public.oc_financial_period_metrics(p_start timestamptz,p_end timestamptz)
returns jsonb language sql stable security invoker set search_path='' as $$
with
 activity as (
   select count(distinct user_id) filter(where day>=p_start::date and day<p_end::date) as wau,
          count(distinct user_id) filter(where day>=p_end::date-30 and day<p_end::date) as mau
   from public.oc_activity_daily
 ),
 ads as (
   select count(*) filter(where event_type='opportunity_created') as opportunities,
          count(*) filter(where event_type='request_sent') as requests,
          count(*) filter(where event_type='filled') as filled,
          count(*) filter(where event_type='started') as started,
          count(*) filter(where event_type='impression_confirmed') as impressions,
          count(*) filter(where event_type='completed') as completed,
          count(*) filter(where event_type='clicked') as clicks
   from public.oc_ad_events where occurred_at>=p_start and occurred_at<p_end
 ),
 media as (
   select count(*) filter(where event_type='qualified_view') as video_views,
          coalesce(sum(watch_seconds) filter(where event_type='watch_progress'),0)/60.0 as watch_minutes
   from public.oc_media_events where occurred_at>=p_start and occurred_at<p_end
 ),
 revenue as (
   select coalesce(sum(amount_aud) filter(where stream='advertising'),0) as ad_revenue,
          coalesce(sum(amount_aud),0) as total_revenue,
          count(*) as entries,
          bool_and(value_status='actual') filter(where value_status is not null) as all_actual
   from public.oc_revenue_entries where recognized_at>=p_start and recognized_at<p_end and value_status<>'projected'
 ),
 costs as (
   select coalesce(sum(amount_aud) filter(where category<>'creator_payout'),0) as infrastructure_cost,
          count(*) as entries,
          bool_and(value_status='actual') filter(where value_status is not null) as all_actual
   from public.oc_cost_entries where incurred_at>=p_start and incurred_at<p_end and value_status<>'projected'
 ),
 payouts as (
   select coalesce(sum(payout_aud),0) as creator_payout,count(*) as entries
   from public.oc_creator_payouts
   where period_start<p_end::date and period_end>=p_start::date and status in ('pending_validation','approved','held')
 )
select jsonb_build_object(
 'period_start',p_start,'period_end',p_end,
 'wau',activity.wau,'mau',activity.mau,
 'video_views',media.video_views,'watch_minutes',round(media.watch_minutes,2),
 'ad_opportunities',ads.opportunities,'ad_requests',ads.requests,'filled_ads',ads.filled,'paid_impressions',ads.impressions,
 'fill_rate_percent',case when ads.requests>0 then round(ads.filled::numeric/ads.requests*100,2) else null end,
 'completion_rate_percent',case when ads.started>0 then round(ads.completed::numeric/ads.started*100,2) else null end,
 'click_through_rate_percent',case when ads.impressions>0 then round(ads.clicks::numeric/ads.impressions*100,2) else null end,
 'blended_ecpm_aud',case when ads.impressions>0 then round(revenue.ad_revenue/ads.impressions*1000,4) else null end,
 'ad_revenue_aud',round(revenue.ad_revenue,2),'total_revenue_aud',round(revenue.total_revenue,2),
 'infrastructure_cost_aud',round(costs.infrastructure_cost,2),'creator_payout_liability_aud',round(payouts.creator_payout,2),
 'gross_contribution_aud',round(revenue.total_revenue-costs.infrastructure_cost-payouts.creator_payout,2),
 'gross_margin_percent',case when revenue.total_revenue>0 then round((revenue.total_revenue-costs.infrastructure_cost-payouts.creator_payout)/revenue.total_revenue*100,2) else null end,
 'revenue_per_active_user_aud',case when activity.wau>0 then round(revenue.total_revenue/activity.wau,4) else null end,
 'cost_per_active_user_aud',case when activity.wau>0 then round((costs.infrastructure_cost+payouts.creator_payout)/activity.wau,4) else null end,
 'contribution_per_active_user_aud',case when activity.wau>0 then round((revenue.total_revenue-costs.infrastructure_cost-payouts.creator_payout)/activity.wau,4) else null end,
 'has_ad_data',(ads.opportunities+ads.requests+ads.filled+ads.impressions)>0,
 'has_revenue_data',revenue.entries>0,'has_cost_data',(costs.entries+payouts.entries)>0,
 'revenue_value_status',case when revenue.entries=0 then 'no_data' when revenue.all_actual then 'actual' else 'estimated' end,
 'cost_value_status',case when costs.entries=0 and payouts.entries=0 then 'no_data' when costs.entries=0 or costs.all_actual then 'actual' else 'estimated' end
) from activity,ads,media,revenue,costs,payouts;
$$;

create function public.oc_weekly_financial_health(p_week_start date default null)
returns jsonb language sql stable security invoker set search_path='' as $$
with period as (
 select coalesce(p_week_start,date_trunc('week',now() at time zone 'Australia/Brisbane')::date) as week_start
), metrics as (
 select week_start,
  public.oc_financial_period_metrics(week_start::timestamp at time zone 'Australia/Brisbane',(week_start+7)::timestamp at time zone 'Australia/Brisbane') as current,
  public.oc_financial_period_metrics((week_start-7)::timestamp at time zone 'Australia/Brisbane',week_start::timestamp at time zone 'Australia/Brisbane') as previous
 from period
), averages as (
 select metrics.*,
  (select jsonb_build_object(
    'wau',round(avg((x.m->>'wau')::numeric),2),
    'mau',round(avg((x.m->>'mau')::numeric),2),
    'watch_minutes',round(avg((x.m->>'watch_minutes')::numeric),2),
    'video_views',round(avg((x.m->>'video_views')::numeric),2),
    'paid_impressions',round(avg((x.m->>'paid_impressions')::numeric),2),
    'fill_rate_percent',round(avg((x.m->>'fill_rate_percent')::numeric),2),
    'blended_ecpm_aud',round(avg((x.m->>'blended_ecpm_aud')::numeric),4),
    'ad_revenue_aud',round(avg((x.m->>'ad_revenue_aud')::numeric),2),
    'total_revenue_aud',round(avg((x.m->>'total_revenue_aud')::numeric),2),
    'infrastructure_cost_aud',round(avg((x.m->>'infrastructure_cost_aud')::numeric),2),
    'creator_payout_liability_aud',round(avg((x.m->>'creator_payout_liability_aud')::numeric),2),
    'gross_contribution_aud',round(avg((x.m->>'gross_contribution_aud')::numeric),2),
    'gross_margin_percent',round(avg((x.m->>'gross_margin_percent')::numeric),2),
    'revenue_per_active_user_aud',round(avg((x.m->>'revenue_per_active_user_aud')::numeric),4),
    'cost_per_active_user_aud',round(avg((x.m->>'cost_per_active_user_aud')::numeric),4)
   ) from generate_series(1,4) n cross join lateral (
     select public.oc_financial_period_metrics(
       (week_start-(n*7))::timestamp at time zone 'Australia/Brisbane',
       (week_start-((n-1)*7))::timestamp at time zone 'Australia/Brisbane'
     ) as m
   ) x) as four_week_average
 from metrics
)
select jsonb_build_object('week_start',week_start,'week_end',week_start+6,'current',current,'previous',previous,'four_week_average',four_week_average) from averages;
$$;

do $$ declare t text; begin
 foreach t in array array['oc_ad_rules','oc_ad_events','oc_media_events','oc_revenue_entries','oc_cost_entries','oc_creator_payouts','oc_fraud_signals','oc_financial_targets','oc_monthly_budgets','oc_weekly_financial_snapshots'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on table public.%I from anon, authenticated',t);
  execute format('grant select,insert,update,delete on table public.%I to service_role',t);
 end loop;
end $$;

revoke update,delete on public.oc_ad_events,public.oc_media_events,public.oc_revenue_entries,public.oc_cost_entries,public.oc_weekly_financial_snapshots from service_role;
revoke all on function public.oc_financial_period_metrics(timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.oc_weekly_financial_health(date) from public,anon,authenticated;
grant execute on function public.oc_financial_period_metrics(timestamptz,timestamptz) to service_role;
grant execute on function public.oc_weekly_financial_health(date) to service_role;

commit;
