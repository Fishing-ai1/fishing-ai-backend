begin;
set local lock_timeout = '5s';

create table public.oc_products (
  product_id text primary key,
  product_key text not null,
  product_type text not null check (product_type in ('subscription','marketplace_boost','creator_tip','creator_subscription','business_subscription','advertising','sponsorship','featured_listing','affiliate','founder_offer','digital_purchase','physical_service_lead','future_product')),
  name text not null,
  description text not null default '',
  currency text not null default 'AUD' check (currency ~ '^[A-Z]{3}$'),
  price_cents integer not null check (price_cents >= 0),
  billing_interval text check (billing_interval in ('monthly','yearly')),
  provider text not null default 'stripe',
  provider_product_id text,
  provider_price_id text,
  active boolean not null default false,
  country text not null default 'AU' check (country ~ '^[A-Z]{2}$'),
  platform text not null default 'web' check (platform in ('web','ios','android','all')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_key, billing_interval, provider, country, platform)
);
create index oc_products_lookup on public.oc_products(product_type,active,country,platform);

insert into public.oc_products(product_id,product_key,product_type,name,price_cents,billing_interval,active) values
  ('oceancore_lite_monthly','lite','subscription','OceanCore Lite',374,'monthly',true),
  ('oceancore_lite_yearly','lite','subscription','OceanCore Lite',2999,'yearly',true),
  ('oceancore_premium_monthly','premium','subscription','OceanCore Premium',974,'monthly',true),
  ('oceancore_premium_yearly','premium','subscription','OceanCore Premium',7499,'yearly',true),
  ('oceancore_crew_monthly','crew','subscription','OceanCore Crew',1874,'monthly',true),
  ('oceancore_crew_yearly','crew','subscription','OceanCore Crew',16499,'yearly',true);

create table public.oc_provider_events (
  provider text not null,
  event_id text not null,
  event_type text not null,
  status text not null default 'received' check (status in ('received','processed','failed')),
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  primary key (provider,event_id)
);
create index oc_provider_events_unprocessed on public.oc_provider_events(status,received_at) where status <> 'processed';

create table public.oc_transactions (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  provider text not null,
  provider_reference text,
  product_id text references public.oc_products(product_id) on delete restrict,
  user_id uuid references auth.users(id) on delete restrict,
  entry_type text not null check (entry_type in ('gross_receipt','provider_fee','tax','refund','chargeback','creator_earning','creator_payout','adjustment')),
  amount_cents bigint not null check (amount_cents <> 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  value_status text not null check (value_status in ('actual','estimated')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now()
);
create index oc_transactions_period on public.oc_transactions(occurred_at desc,entry_type,value_status);
create index oc_transactions_user on public.oc_transactions(user_id,occurred_at desc) where user_id is not null;

create table public.oc_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entitlement_key text not null,
  provider text not null,
  provider_subscription_id text,
  status text not null check (status in ('active','trial','past_due','cancelled','expired')),
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id,entitlement_key,provider)
);
create index oc_entitlements_active on public.oc_entitlements(user_id,status,valid_until);

create function public.oc_reject_transaction_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Financial transactions are append-only; write a compensating entry';
end;
$$;
create trigger oc_transactions_append_only before update or delete on public.oc_transactions
for each row execute function public.oc_reject_transaction_mutation();

create function public.oc_record_provider_receipt(
  p_provider text,
  p_event_id text,
  p_event_type text,
  p_reference text,
  p_user_id uuid,
  p_product_id text,
  p_amount_cents bigint,
  p_currency text,
  p_occurred_at timestamptz
) returns boolean language plpgsql set search_path = '' as $$
begin
  if p_provider is null or p_event_id is null or p_reference is null or p_event_type is null
    or p_amount_cents <= 0 or p_currency !~ '^[A-Z]{3}$' or p_occurred_at is null then
    raise exception 'Invalid provider receipt';
  end if;
  insert into public.oc_provider_events(provider,event_id,event_type,status,occurred_at)
    values(p_provider,p_event_id,p_event_type,'received',p_occurred_at)
    on conflict do nothing;
  if not found then return false; end if;
  insert into public.oc_transactions(source_key,provider,provider_reference,product_id,user_id,entry_type,amount_cents,currency,value_status,occurred_at)
    values(p_provider || ':' || p_reference || ':gross_receipt',p_provider,p_reference,p_product_id,p_user_id,'gross_receipt',p_amount_cents,p_currency,'actual',p_occurred_at)
    on conflict(source_key) do nothing;
  update public.oc_provider_events set status='processed',processed_at=now()
    where provider=p_provider and event_id=p_event_id;
  return true;
end;
$$;

alter table public.oc_products enable row level security;
alter table public.oc_provider_events enable row level security;
alter table public.oc_transactions enable row level security;
alter table public.oc_entitlements enable row level security;
revoke all on public.oc_products,public.oc_provider_events,public.oc_transactions,public.oc_entitlements from public,anon,authenticated;
grant select,insert,update,delete on public.oc_products to service_role;
grant select,insert,update on public.oc_provider_events to service_role;
grant select,insert on public.oc_transactions to service_role;
grant select,insert,update,delete on public.oc_entitlements to service_role;
revoke all on function public.oc_reject_transaction_mutation() from public,anon,authenticated;
revoke all on function public.oc_record_provider_receipt(text,text,text,text,uuid,text,bigint,text,timestamptz) from public,anon,authenticated;
grant execute on function public.oc_record_provider_receipt(text,text,text,text,uuid,text,bigint,text,timestamptz) to service_role;

commit;
