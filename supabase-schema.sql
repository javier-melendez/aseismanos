create extension if not exists pgcrypto;

drop function if exists public.create_lunch_code(text);
drop function if exists public.list_lunch_codes();
drop function if exists public.redeem_lunch_code(text, text);
drop function if exists public.valid_code_pool();
drop function if exists public.add_paid_lunches(text, integer);
drop function if exists public.list_customer_events();
drop function if exists public.redeem_free_lunch(text);

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

create table if not exists public.customer_events (
  id uuid primary key default gen_random_uuid(),
  customer_id text not null references public.customers(customer_id),
  code text,
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

create or replace function public.add_paid_lunches(
  p_customer_id text,
  p_quantity integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_paid integer;
  current_free integer;
  total_paid integer;
  earned_free integer;
begin
  perform public.require_admin();

  if p_quantity is null or p_quantity < 1 then
    raise exception 'Cantidad inválida.';
  end if;

  insert into public.customers(customer_id)
  values (p_customer_id)
  on conflict (customer_id) do nothing;

  select paid_count, free_count
  into current_paid, current_free
  from public.customers
  where customer_id = p_customer_id
  for update;

  total_paid := current_paid + p_quantity;
  earned_free := total_paid / 10;
  current_paid := mod(total_paid, 10);
  current_free := current_free + earned_free;

  update public.customers
  set paid_count = current_paid,
      free_count = current_free,
      updated_at = now()
  where customer_id = p_customer_id;

  insert into public.customer_events(customer_id, label)
  values (p_customer_id, format('Se asignaron %s almuerzos', p_quantity));

  if earned_free > 0 then
    insert into public.customer_events(customer_id, label)
    values (p_customer_id, format('Se convirtieron %s almuerzos pagos en %s gratis', earned_free * 10, earned_free));
  end if;

  return public.get_customer_summary(p_customer_id);
end;
$$;

create or replace function public.list_customer_events()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  return coalesce(
    (
      select jsonb_agg(to_jsonb(event_row))
      from (
        select customer_id, label, happened_at
        from public.customer_events
        order by happened_at desc
        limit 30
      ) event_row
    ),
    '[]'::jsonb
  );
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
revoke all on public.customer_events from anon, authenticated;
revoke all on public.app_admins from anon, authenticated;

revoke execute on function public.redeem_free_lunch(text) from public, anon;

grant execute on function public.get_customer_summary(text) to anon, authenticated;
grant execute on function public.add_paid_lunches(text, integer) to authenticated;
grant execute on function public.list_customer_events() to authenticated;
grant execute on function public.redeem_free_lunch(text) to authenticated;

insert into public.restaurant_settings(id)
values (true)
on conflict (id) do nothing;
