-- Portfolio upload: incremental or full update of contracts from the "Informações dos projetos" export.

-- Extra fields carried by the export.
alter table public.contracts
  add column if not exists description text,
  add column if not exists delivery_manager text,
  add column if not exists project_type text,
  add column if not exists service_portfolio text,
  add column if not exists sale_gross numeric,
  add column if not exists billed_gross numeric,
  add column if not exists to_bill_net numeric,
  add column if not exists received_gross numeric,
  add column if not exists report_status text,
  add column if not exists last_report date;

-- One row per portfolio upload.
create table if not exists public.contract_imports (
  id bigint generated always as identity primary key,
  file_name text not null,
  mode text not null check (mode in ('incremental','full')),
  rows_in_file int not null default 0,
  added int not null default 0, updated int not null default 0, removed int not null default 0,
  removed_codes text[] not null default '{}',
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists contract_imports_created_by_idx on public.contract_imports (created_by);
alter table public.contract_imports enable row level security;
create policy "readers read contract_imports" on public.contract_imports for select to authenticated using ((select private.is_reader()));
create policy "editors insert contract_imports" on public.contract_imports for insert to authenticated with check ((select private.is_editor()));

-- Applies one upload in a single transaction.
--   incremental: adds new contracts and updates the ones in the file; empty cells keep the stored value,
--                name and client keep manual edits; contracts missing from the file are kept.
--   full:        the file becomes the portfolio: every field comes from the file and contracts missing from it are removed.
create or replace function public.import_contracts(p_rows jsonb, p_mode text, p_file text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  full_mode boolean := p_mode = 'full';
  n_add int; n_upd int; n_del int := 0; gone text[] := '{}'; n_rows int;
begin
  if not private.is_editor() then raise exception 'Only editors can import contracts'; end if;
  if p_mode not in ('incremental','full') then raise exception 'Invalid mode %', p_mode; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'No rows to import'; end if;

  drop table if exists pg_temp._src;
  create temp table _src on commit drop as
    select distinct on (code) * from jsonb_populate_recordset(null::public.contracts, p_rows) where coalesce(code, '') <> '' order by code;
  select count(*) into n_rows from _src;

  update public.contracts c set
    parent_code     = coalesce(s.parent_code, c.parent_code),
    client          = case when full_mode then coalesce(s.client, c.client) else c.client end,
    name            = case when full_mode then coalesce(s.name, c.name) else c.name end,
    pm              = case when full_mode then s.pm else coalesce(s.pm, c.pm) end,
    status          = coalesce(s.status, c.status),
    phase           = case when full_mode then s.phase else coalesce(s.phase, c.phase) end,
    progress        = coalesce(s.progress, case when full_mode then 0 else c.progress end),
    baseline        = case when full_mode then s.baseline else coalesce(s.baseline, c.baseline) end,
    hours_budget    = coalesce(s.hours_budget, case when full_mode then 0 else c.hours_budget end),
    hours_pwa       = case when full_mode then s.hours_pwa else coalesce(s.hours_pwa, c.hours_pwa) end,
    hours_logged    = case when full_mode then s.hours_logged else coalesce(s.hours_logged, c.hours_logged) end,
    cost_budget     = coalesce(s.cost_budget, case when full_mode then 0 else c.cost_budget end),
    cost_actual     = coalesce(s.cost_actual, case when full_mode then 0 else c.cost_actual end),
    cost_to_incur   = coalesce(s.cost_to_incur, case when full_mode then 0 else c.cost_to_incur end),
    sale_net        = coalesce(s.sale_net, case when full_mode then 0 else c.sale_net end),
    billed_net      = coalesce(s.billed_net, case when full_mode then 0 else c.billed_net end),
    margin_sold     = case when full_mode then s.margin_sold else coalesce(s.margin_sold, c.margin_sold) end,
    margin_forecast = case when full_mode then s.margin_forecast else coalesce(s.margin_forecast, c.margin_forecast) end,
    start_date      = case when full_mode then s.start_date else coalesce(s.start_date, c.start_date) end,
    end_date        = case when full_mode then s.end_date else coalesce(s.end_date, c.end_date) end,
    go_live         = case when full_mode then s.go_live else coalesce(s.go_live, c.go_live) end,
    description     = case when full_mode then s.description else coalesce(s.description, c.description) end,
    delivery_manager= case when full_mode then s.delivery_manager else coalesce(s.delivery_manager, c.delivery_manager) end,
    project_type    = case when full_mode then s.project_type else coalesce(s.project_type, c.project_type) end,
    service_portfolio = case when full_mode then s.service_portfolio else coalesce(s.service_portfolio, c.service_portfolio) end,
    sale_gross      = case when full_mode then s.sale_gross else coalesce(s.sale_gross, c.sale_gross) end,
    billed_gross    = case when full_mode then s.billed_gross else coalesce(s.billed_gross, c.billed_gross) end,
    to_bill_net     = case when full_mode then s.to_bill_net else coalesce(s.to_bill_net, c.to_bill_net) end,
    received_gross  = case when full_mode then s.received_gross else coalesce(s.received_gross, c.received_gross) end,
    report_status   = case when full_mode then s.report_status else coalesce(s.report_status, c.report_status) end,
    last_report     = case when full_mode then s.last_report else coalesce(s.last_report, c.last_report) end,
    source          = p_file
  from _src s where s.code = c.code;
  get diagnostics n_upd = row_count;

  insert into public.contracts (code, parent_code, client, name, pm, status, phase, progress, baseline, hours_budget, hours_pwa, hours_logged,
    cost_budget, cost_actual, cost_to_incur, sale_net, billed_net, margin_sold, margin_forecast, start_date, end_date, go_live,
    description, delivery_manager, project_type, service_portfolio, sale_gross, billed_gross, to_bill_net, received_gross, report_status, last_report, source)
  select s.code, coalesce(s.parent_code, s.code), coalesce(s.client, left(s.code, 5)), coalesce(s.name, s.code), s.pm, coalesce(s.status, 'Execution'), s.phase,
    coalesce(s.progress, 0), s.baseline, coalesce(s.hours_budget, 0), s.hours_pwa, s.hours_logged,
    coalesce(s.cost_budget, 0), coalesce(s.cost_actual, 0), coalesce(s.cost_to_incur, 0), coalesce(s.sale_net, 0), coalesce(s.billed_net, 0),
    s.margin_sold, s.margin_forecast, s.start_date, s.end_date, s.go_live,
    s.description, s.delivery_manager, s.project_type, s.service_portfolio, s.sale_gross, s.billed_gross, s.to_bill_net, s.received_gross, s.report_status, s.last_report, p_file
  from _src s where not exists (select 1 from public.contracts c where c.code = s.code);
  get diagnostics n_add = row_count;

  if full_mode then
    with d as (delete from public.contracts c where not exists (select 1 from _src s where s.code = c.code) returning c.code)
    select count(*), coalesce(array_agg(code order by code), '{}') into n_del, gone from d;
  end if;

  insert into public.contract_imports (file_name, mode, rows_in_file, added, updated, removed, removed_codes)
  values (p_file, p_mode, n_rows, n_add, n_upd, n_del, gone);

  return jsonb_build_object('added', n_add, 'updated', n_upd, 'removed', n_del, 'removed_codes', to_jsonb(gone));
end $$;

revoke execute on function public.import_contracts(jsonb, text, text) from public, anon;
grant execute on function public.import_contracts(jsonb, text, text) to authenticated;
