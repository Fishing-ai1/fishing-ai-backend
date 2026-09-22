begin;
set local lock_timeout='5s';
alter table public.oc_ai_requests
 add column attempts jsonb not null default '[]' check(jsonb_typeof(attempts)='array' and jsonb_array_length(attempts)<=8),
 add column known_cost_usd numeric check(known_cost_usd>=0),
 add column pricing_complete boolean not null default false,
 add column usage_complete boolean not null default false;
comment on column public.oc_ai_requests.attempts is 'Sanitized model attempt metadata only; never prompts, answers, credentials or private images.';
comment on column public.oc_ai_requests.known_cost_usd is 'Known priced usage; not a total when usage_complete is false. Unknown transport usage stays unpriced.';
commit;
