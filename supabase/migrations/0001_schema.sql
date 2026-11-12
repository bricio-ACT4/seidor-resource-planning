-- Seidor Resource Planning: full schema as applied to the Supabase project.
-- Roles: pendente (no access), leitor (read, no individual cost rates), editor (read/write incl. costs), admin (+ users).

create extension if not exists unaccent with schema extensions;
create schema if not exists private;
grant usage on schema private to authenticated;

create type public.app_role as enum ('pendente','leitor','editor','admin');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text, full_name text,
  role public.app_role not null default 'pendente',
  created_at timestamptz not null default now()
);

create function private.is_reader() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select role in ('leitor','editor','admin') from public.profiles where id = (select auth.uid())), false) $$;
create function private.is_editor() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select role in ('editor','admin') from public.profiles where id = (select auth.uid())), false) $$;
create function private.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select role = 'admin' from public.profiles where id = (select auth.uid())), false) $$;

-- The first account created becomes admin; every later one waits for approval.
create function private.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''),
          case when exists (select 1 from public.profiles where role = 'admin') then 'pendente'::public.app_role else 'admin'::public.app_role end);
  return new;
end $$;
revoke execute on function private.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

create table public.contracts (
  code text primary key, parent_code text, client text not null, name text not null, pm text,
  status text not null check (status in ('Execution','Paused','Closed')), phase text,
  progress numeric not null default 0, baseline numeric,
  hours_budget numeric not null default 0, hours_pwa numeric, hours_logged numeric,
  cost_budget numeric not null default 0, cost_actual numeric not null default 0, cost_to_incur numeric not null default 0,
  sale_net numeric not null default 0, billed_net numeric not null default 0, margin_sold numeric, margin_forecast numeric,
  start_date date, end_date date, go_live date, source text, updated_at timestamptz not null default now()
);
create table public.scenarios (
  id uuid primary key default gen_random_uuid(), name text not null unique, data jsonb not null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null, updated_at timestamptz not null default now()
);
create table public.resources (
  id text primary key, name text not null, sap_skill text not null default '', seniority text not null default '', start_date date,
  origin text not null default 'timeflow' check (origin in ('timeflow','manual')), updated_at timestamptz not null default now()
);
create table public.resource_metrics (
  resource_id text primary key references public.resources(id) on delete cascade,
  rate_year numeric not null default 0, hours_year numeric not null default 0, cost_year numeric not null default 0,
  rate_month numeric not null default 0, hours_month numeric not null default 0, cost_month numeric not null default 0,
  ref_month text, last_month text, main_contracts text[] not null default '{}', updated_at timestamptz not null default now()
);
create table public.timeflow_imports (
  id bigint generated always as identity primary key, file_name text not null, mode text not null check (mode in ('replace','add')),
  rows_added int not null default 0, rows_skipped int not null default 0, month_from text, month_to text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null, created_at timestamptz not null default now()
);
create table public.timeflow_entries (
  id bigint generated always as identity primary key, person text not null, contract text not null, work_date date not null,
  start_time text not null default '', hours numeric not null check (hours > 0), cost numeric, month text not null,
  seq integer not null default 0, -- numbers identical entries inside one file so none is lost
  import_id bigint references public.timeflow_imports(id) on delete set null,
  constraint timeflow_entries_unique_entry unique (person, contract, work_date, start_time, hours, seq)
);
create index timeflow_entries_month_idx on public.timeflow_entries (month);
create index timeflow_entries_contract_idx on public.timeflow_entries (contract);
create index timeflow_entries_import_idx on public.timeflow_entries (import_id);
create index scenarios_created_by_idx on public.scenarios (created_by);
create index timeflow_imports_created_by_idx on public.timeflow_imports (created_by);

create function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$ begin new.updated_at = now(); return new; end $$;
create trigger contracts_touch before update on public.contracts for each row execute function public.touch_updated_at();
create trigger scenarios_touch before update on public.scenarios for each row execute function public.touch_updated_at();
create trigger resources_touch before update on public.resources for each row execute function public.touch_updated_at();
create trigger resource_metrics_touch before update on public.resource_metrics for each row execute function public.touch_updated_at();

create function public.slugify(x text) returns text language sql stable set search_path = '' as $$
  select left(trim(both '-' from regexp_replace(lower(extensions.unaccent(coalesce(x,''))), '[^a-z0-9]+', '-', 'g')), 120) $$;

-- Row level security
alter table public.profiles enable row level security;
alter table public.contracts enable row level security;
alter table public.scenarios enable row level security;
alter table public.resources enable row level security;
alter table public.resource_metrics enable row level security;
alter table public.timeflow_imports enable row level security;
alter table public.timeflow_entries enable row level security;

create policy "own profile or admin reads" on public.profiles for select to authenticated using (id = (select auth.uid()) or (select private.is_admin()));
create policy "admin updates profiles" on public.profiles for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin deletes profiles" on public.profiles for delete to authenticated using ((select private.is_admin()) and id <> (select auth.uid()));

do $$ declare t text; begin
  foreach t in array array['contracts','scenarios','resources'] loop
    execute format('create policy "readers read %1$s" on public.%1$s for select to authenticated using ((select private.is_reader()))', t);
    execute format('create policy "editors insert %1$s" on public.%1$s for insert to authenticated with check ((select private.is_editor()))', t);
    execute format('create policy "editors update %1$s" on public.%1$s for update to authenticated using ((select private.is_editor())) with check ((select private.is_editor()))', t);
    execute format('create policy "editors delete %1$s" on public.%1$s for delete to authenticated using ((select private.is_editor()))', t);
  end loop;
  -- individual cost rates and raw hours: editors only
  foreach t in array array['resource_metrics','timeflow_imports','timeflow_entries'] loop
    execute format('create policy "editors read %1$s" on public.%1$s for select to authenticated using ((select private.is_editor()))', t);
    execute format('create policy "editors insert %1$s" on public.%1$s for insert to authenticated with check ((select private.is_editor()))', t);
    execute format('create policy "editors delete %1$s" on public.%1$s for delete to authenticated using ((select private.is_editor()))', t);
  end loop;
  execute 'create policy "editors update resource_metrics" on public.resource_metrics for update to authenticated using ((select private.is_editor())) with check ((select private.is_editor()))';
  execute 'create policy "editors update timeflow_imports" on public.timeflow_imports for update to authenticated using ((select private.is_editor())) with check ((select private.is_editor()))';
end $$;

-- Monthly hours per contract without people or cost, for every reader (portfolio chart).
create function public.contract_month_hours() returns table (contract text, month text, hours numeric)
language sql stable security definer set search_path = '' as $$
  select e.contract, e.month, sum(e.hours) from public.timeflow_entries e where private.is_reader() group by e.contract, e.month $$;

create function public.cost_rate_by_month() returns table (month text, hours numeric, cost numeric, people bigint, weighted_rate numeric, simple_rate numeric)
language sql stable security invoker set search_path = '' as $$
  with p as (select month, person, sum(hours) h, sum(cost) c, sum(hours) filter (where cost is not null) hc from public.timeflow_entries group by month, person)
  select month, round(sum(h),1), round(coalesce(sum(c),0)), count(*), round(sum(c) / nullif(sum(hc),0), 2), round(avg(c / nullif(hc,0)), 2) from p group by month order by month $$;

create function public.person_month_hours() returns table (person text, month text, hours numeric, contracts bigint, contract_list text[])
language sql stable security invoker set search_path = '' as $$
  select person, month, round(sum(hours),1), count(distinct contract), array_agg(distinct contract) from public.timeflow_entries group by person, month $$;

create function public.clear_timeflow_entries() returns bigint language plpgsql security invoker set search_path = '' as $$
declare n bigint; begin
  if not private.is_editor() then raise exception 'Only editors can clear hours'; end if;
  delete from public.timeflow_entries where true; get diagnostics n = row_count; return n;
end $$;

-- Rebuilds rates and hours per resource from TIMEFLOW entries. Classification (skill, seniority, start date) is never touched.
-- Year = year of the reference month; reference month = latest month with at least 25% of the median monthly hours.
create function public.refresh_resource_metrics(p_ref_month text default null) returns integer
language plpgsql security invoker set search_path = '' as $$
declare ref text; yr text; n integer;
begin
  if not private.is_editor() then raise exception 'Only editors can refresh resource metrics'; end if;
  delete from public.resource_metrics m using public.resources r where r.id = m.resource_id and r.origin = 'timeflow';
  ref := p_ref_month;
  if ref is null then
    with m as (select month, sum(hours) h from public.timeflow_entries group by month),
         med as (select percentile_cont(0.5) within group (order by h) md from m)
    select max(m.month) into ref from m, med where m.h >= med.md * 0.25;
  end if;
  if ref is null then return 0; end if;
  yr := left(ref, 4);
  insert into public.resources (id, name, origin)
  select distinct on (public.slugify(person)) public.slugify(person), person, 'timeflow'
  from public.timeflow_entries where left(month, 4) = yr on conflict (id) do nothing;
  with e as (select public.slugify(person) rid, contract, month, hours, cost from public.timeflow_entries where left(month, 4) = yr),
  agg as (select rid, sum(hours) hy, sum(cost) cy, sum(hours) filter (where cost is not null) hyc,
      sum(hours) filter (where month = ref) hm, sum(cost) filter (where month = ref) cm,
      sum(hours) filter (where month = ref and cost is not null) hmc, max(month) lastm from e group by rid),
  top as (select rid, array_agg(contract order by h desc) filter (where rn <= 3) cs
    from (select rid, contract, sum(hours) h, row_number() over (partition by rid order by sum(hours) desc) rn from e group by rid, contract) t group by rid)
  insert into public.resource_metrics (resource_id, rate_year, hours_year, cost_year, rate_month, hours_month, cost_month, ref_month, last_month, main_contracts)
  select a.rid, coalesce(round(a.cy / nullif(a.hyc, 0), 2), 0), round(a.hy, 1), coalesce(round(a.cy), 0),
    coalesce(round(a.cm / nullif(a.hmc, 0), 2), 0), coalesce(round(a.hm, 1), 0), coalesce(round(a.cm), 0), ref, a.lastm, coalesce(t.cs, '{}')
  from agg a left join top t using (rid)
  on conflict (resource_id) do update set rate_year = excluded.rate_year, hours_year = excluded.hours_year, cost_year = excluded.cost_year,
    rate_month = excluded.rate_month, hours_month = excluded.hours_month, cost_month = excluded.cost_month,
    ref_month = excluded.ref_month, last_month = excluded.last_month, main_contracts = excluded.main_contracts;
  get diagnostics n = row_count; return n;
end $$;

revoke execute on function public.contract_month_hours(), public.cost_rate_by_month(), public.person_month_hours(), public.clear_timeflow_entries(), public.refresh_resource_metrics(text), public.slugify(text) from public, anon;
grant execute on function public.contract_month_hours(), public.cost_rate_by_month(), public.person_month_hours(), public.clear_timeflow_entries(), public.refresh_resource_metrics(text), public.slugify(text) to authenticated;
