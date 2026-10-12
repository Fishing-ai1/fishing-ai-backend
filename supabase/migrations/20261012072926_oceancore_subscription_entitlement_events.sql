begin;
set local lock_timeout = '5s';

alter table public.oc_entitlements add column last_provider_event_at timestamptz;

insert into public.oc_entitlements(user_id,entitlement_key,provider,status,metadata)
select id,'subscription','manual','active',
  jsonb_build_object('plan',plan,'reason','legacy_beta_access')
from public.profiles
where plan in ('lite','premium','crew')
  and subscription_status in ('active','trial')
  and stripe_subscription_id is null
on conflict (user_id,entitlement_key,provider) do nothing;

create function public.oc_apply_subscription_event(
  p_event_id text,
  p_event_type text,
  p_event_at timestamptz,
  p_user_id uuid,
  p_subscription_id text,
  p_plan text,
  p_status text,
  p_valid_until timestamptz
) returns boolean language plpgsql set search_path = '' as $$
declare
  applied boolean;
begin
  if coalesce(p_event_id, '') = '' or p_event_type not in
    ('customer.subscription.created','customer.subscription.updated','customer.subscription.deleted')
    or p_event_at is null or p_user_id is null or coalesce(p_subscription_id, '') = ''
    or p_plan not in ('lite','premium','crew')
    or p_status not in ('active','trial','past_due','cancelled','expired')
    or (p_status in ('active','trial') and (p_valid_until is null or p_valid_until <= now())) then
    raise exception 'Invalid subscription event';
  end if;

  insert into public.oc_provider_events(provider,event_id,event_type,status,occurred_at)
    values('stripe',p_event_id,p_event_type,'received',p_event_at)
    on conflict do nothing;
  if not found then return false; end if;

  insert into public.oc_entitlements(
    user_id,entitlement_key,provider,provider_subscription_id,status,valid_until,
    metadata,last_provider_event_at
  ) values (
    p_user_id,'subscription','stripe',p_subscription_id,p_status,p_valid_until,
    jsonb_build_object('plan',p_plan,'event_id',p_event_id),p_event_at
  )
  on conflict (user_id,entitlement_key,provider) do update set
    provider_subscription_id = excluded.provider_subscription_id,
    status = excluded.status,
    valid_until = excluded.valid_until,
    metadata = excluded.metadata,
    last_provider_event_at = excluded.last_provider_event_at,
    updated_at = now()
  where excluded.last_provider_event_at > public.oc_entitlements.last_provider_event_at
    and not (
      p_event_type = 'customer.subscription.deleted'
      and public.oc_entitlements.provider_subscription_id <> p_subscription_id
    );
  applied := found;

  update public.oc_provider_events set status='processed',processed_at=now()
    where provider='stripe' and event_id=p_event_id;
  return applied;
end;
$$;

revoke all on function public.oc_apply_subscription_event(text,text,timestamptz,uuid,text,text,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.oc_apply_subscription_event(text,text,timestamptz,uuid,text,text,text,timestamptz)
  to service_role;

commit;
