begin;
set local lock_timeout = '5s';

update public.oc_ad_rules
set config = jsonb_set(config, '{creator_revenue_share_percent}', '40'::jsonb),
    version = version + 1,
    updated_at = now()
where name = 'Launch default'
  and enabled = false
  and version = 1
  and config->>'creator_revenue_share_percent' = '45';

commit;
