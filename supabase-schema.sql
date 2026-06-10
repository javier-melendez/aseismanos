create extension if not exists pgcrypto;

drop function if exists public.create_lunch_code(text, date);
drop function if exists public.create_lunch_code(date);
drop function if exists public.list_lunch_codes(text);
drop function if exists public.redeem_free_lunch(text, text);
drop function if exists public.redeem_lunch_code(text, text, date);

create table if not exists public.restaurant_settings (
  id boolean primary key default true,
  name text not null default 'A Seis Manos',
  address text not null default 'Calle 10 # 4-22, Bogotá',
  phone text not null default '+57 300 000 0000',
  updated_at timestamptz not null default now(),
  constraint restaurant_settings_singleton check (id)
);

create table if not exists public.customers (
  customer_id text primary key,
  paid_count integer not null default 0 check (paid_count between 0 and 9),
  free_count integer not null default 0 check (free_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lunch_codes (
  code text primary key check (code ~ '^[A-Z0-9]{4,6}$'),
  created_at timestamptz not null default now(),
  used_at timestamptz,
  used_by text references public.customers(customer_id),
  constraint lunch_codes_used_pair check (
    (used_at is null and used_by is null) or (used_at is not null and used_by is not null)
  )
);

alter table public.lunch_codes
drop column if exists valid_on;

create table if not exists public.customer_events (
  id uuid primary key default gen_random_uuid(),
  customer_id text not null references public.customers(customer_id),
  code text references public.lunch_codes(code),
  label text not null,
  happened_at timestamptz not null default now()
);

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

alter table public.restaurant_settings enable row level security;
alter table public.customers enable row level security;
alter table public.lunch_codes enable row level security;
alter table public.customer_events enable row level security;
alter table public.app_admins enable row level security;

drop policy if exists "public can read restaurant settings" on public.restaurant_settings;
create policy "public can read restaurant settings"
on public.restaurant_settings for select
using (true);

create or replace function public.require_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.app_admins
    where user_id = auth.uid()
  ) then
    raise exception 'No autorizado.';
  end if;
end;
$$;

create or replace function public.valid_code_pool()
returns table(code text)
language sql
stable
as $$
  with alphabet as (
    select 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'::text as chars
  ),
  generated as (
    select generate_series(0, 9999) as index
  ),
  hashed as (
    select
      encode(
        digest(
          'aseismanos:' || index::text,
          'sha256'
        ),
        'hex'
      ) as hex
    from generated
  )
  select string_agg(
    substr(alphabet.chars, (get_byte(decode(substr(hashed.hex, pos * 2 + 1, 2), 'hex'), 0) % length(alphabet.chars)) + 1, 1),
    ''
    order by pos
  ) as code
  from hashed
  cross join alphabet
  cross join generate_series(0, 5) as pos
  group by hashed.hex
$$;

create or replace function public.get_customer_summary(p_customer_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  insert into public.customers(customer_id)
  values (p_customer_id)
  on conflict (customer_id) do nothing;

  select jsonb_build_object(
    'paid_count', c.paid_count,
    'free_count', c.free_count,
    'log', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'label', e.label,
            'happened_at', e.happened_at,
            'code', e.code
          )
          order by e.happened_at desc
        )
        from (
          select *
          from public.customer_events
          where customer_id = p_customer_id
          order by happened_at desc
          limit 10
        ) e
      ),
      '[]'::jsonb
    )
  )
  into result
  from public.customers c
  where c.customer_id = p_customer_id;

  return result;
end;
$$;

create or replace function public.create_lunch_code()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_code text;
begin
  perform public.require_admin();

  select pool.code
  into new_code
  from public.valid_code_pool() pool
  where not exists (
    select 1 from public.lunch_codes existing where existing.code = pool.code
  )
  order by random()
  limit 1;

  if new_code is null then
    raise exception 'No quedan códigos disponibles.';
  end if;

  insert into public.lunch_codes(code)
  values (new_code);

  return (
    select to_jsonb(created_code)
    from public.lunch_codes created_code
    where created_code.code = new_code
  );
end;
$$;

create or replace function public.list_lunch_codes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  return coalesce(
    (
      select jsonb_agg(to_jsonb(lc) order by lc.created_at desc)
      from (
        select *
        from public.lunch_codes
        order by created_at desc
        limit 30
      ) lc
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.redeem_lunch_code(
  p_customer_id text,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_code text := upper(regexp_replace(p_code, '[^A-Z0-9]', '', 'g'));
  code_record public.lunch_codes%rowtype;
  new_paid integer;
  new_free integer;
begin
  select *
  into code_record
  from public.lunch_codes
  where code = normalized_code
  for update;

  if not found then
    raise exception 'Código inexistente.';
  end if;

  if code_record.used_at is not null then
    raise exception 'Este código ya fue usado.';
  end if;

  insert into public.customers(customer_id)
  values (p_customer_id)
  on conflict (customer_id) do nothing;

  select paid_count + 1, free_count
  into new_paid, new_free
  from public.customers
  where customer_id = p_customer_id
  for update;

  if new_paid >= 10 then
    new_paid := new_paid - 10;
    new_free := new_free + 1;
  end if;

  update public.customers
  set paid_count = new_paid,
      free_count = new_free,
      updated_at = now()
  where customer_id = p_customer_id;

  update public.lunch_codes
  set used_at = now(),
      used_by = p_customer_id
  where code = normalized_code;

  insert into public.customer_events(customer_id, code, label)
  values (p_customer_id, normalized_code, 'Almuerzo registrado');

  return public.get_customer_summary(p_customer_id);
end;
$$;

create or replace function public.redeem_free_lunch(
  p_customer_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  update public.customers
  set free_count = free_count - 1,
      updated_at = now()
  where customer_id = p_customer_id
    and free_count > 0;

  if not found then
    raise exception 'Este cliente no tiene almuerzos gratis disponibles.';
  end if;

  insert into public.customer_events(customer_id, label)
  values (p_customer_id, 'Almuerzo gratis entregado');

  return public.get_customer_summary(p_customer_id);
end;
$$;

revoke all on public.customers from anon, authenticated;
revoke all on public.lunch_codes from anon, authenticated;
revoke all on public.customer_events from anon, authenticated;
revoke all on public.app_admins from anon, authenticated;

revoke execute on function public.create_lunch_code() from public, anon;
revoke execute on function public.list_lunch_codes() from public, anon;
revoke execute on function public.redeem_free_lunch(text) from public, anon;

grant execute on function public.get_customer_summary(text) to anon, authenticated;
grant execute on function public.create_lunch_code() to authenticated;
grant execute on function public.list_lunch_codes() to authenticated;
grant execute on function public.redeem_lunch_code(text, text) to anon, authenticated;
grant execute on function public.redeem_free_lunch(text) to authenticated;

insert into public.restaurant_settings(id)
values (true)
on conflict (id) do nothing;
