-- MAGAZYN SKU - Supabase/Postgres schema
-- Uruchom cały plik w Supabase SQL Editor.

create extension if not exists pgcrypto;

create type public.user_role as enum ('worker','manager','admin');
create type public.container_status as enum ('open','closed','archived');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role public.user_role not null default 'worker',
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  barcode text unique,
  name text not null,
  manufacturer text,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text,
  zone text,
  rack text,
  shelf text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.stock (
  product_id uuid not null references public.products(id),
  location_id uuid not null references public.locations(id),
  quantity numeric(14,3) not null default 0 check(quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key(product_id,location_id)
);

create table public.containers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  location_id uuid references public.locations(id),
  status public.container_status not null default 'open',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.container_items (
  container_id uuid not null references public.containers(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity numeric(14,3) not null default 0 check(quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key(container_id,product_id)
);

create table public.movements (
  id bigint generated always as identity primary key,
  operation text not null check(operation in ('PLACE','MOVE','PICK','OZ_CREATE','OZ_ADD','OZ_PLACE')),
  product_id uuid references public.products(id),
  container_id uuid references public.containers(id),
  from_location_id uuid references public.locations(id),
  to_location_id uuid references public.locations(id),
  quantity numeric(14,3) not null default 0,
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  note text
);

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,full_name) values(new.id,coalesce(new.raw_user_meta_data->>'full_name',new.email)) on conflict do nothing;
  return new;
end;$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.place_product(p_product_id uuid,p_location_id uuid,p_quantity numeric)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_quantity <= 0 then raise exception 'Quantity must be > 0'; end if;
  insert into stock(product_id,location_id,quantity) values(p_product_id,p_location_id,p_quantity)
  on conflict(product_id,location_id) do update set quantity=stock.quantity+excluded.quantity,updated_at=now();
  insert into movements(operation,product_id,to_location_id,quantity,actor_id) values('PLACE',p_product_id,p_location_id,p_quantity,auth.uid());
end;$$;

create or replace function public.move_product(p_product_id uuid,p_from_location_id uuid,p_to_location_id uuid,p_quantity numeric)
returns void language plpgsql security definer set search_path=public as $$
declare current_qty numeric;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_quantity <= 0 or p_from_location_id=p_to_location_id then raise exception 'Invalid move'; end if;
  select quantity into current_qty from stock where product_id=p_product_id and location_id=p_from_location_id for update;
  if coalesce(current_qty,0) < p_quantity then raise exception 'Insufficient stock'; end if;
  update stock set quantity=quantity-p_quantity,updated_at=now() where product_id=p_product_id and location_id=p_from_location_id;
  delete from stock where product_id=p_product_id and location_id=p_from_location_id and quantity=0;
  insert into stock(product_id,location_id,quantity) values(p_product_id,p_to_location_id,p_quantity)
  on conflict(product_id,location_id) do update set quantity=stock.quantity+excluded.quantity,updated_at=now();
  insert into movements(operation,product_id,from_location_id,to_location_id,quantity,actor_id) values('MOVE',p_product_id,p_from_location_id,p_to_location_id,p_quantity,auth.uid());
end;$$;

create or replace function public.pick_product(p_product_id uuid,p_location_id uuid,p_quantity numeric)
returns void language plpgsql security definer set search_path=public as $$
declare current_qty numeric;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_quantity <= 0 then raise exception 'Quantity must be > 0'; end if;
  select quantity into current_qty from stock where product_id=p_product_id and location_id=p_location_id for update;
  if coalesce(current_qty,0) < p_quantity then raise exception 'Insufficient stock'; end if;
  update stock set quantity=quantity-p_quantity,updated_at=now() where product_id=p_product_id and location_id=p_location_id;
  delete from stock where product_id=p_product_id and location_id=p_location_id and quantity=0;
  insert into movements(operation,product_id,from_location_id,quantity,actor_id) values('PICK',p_product_id,p_location_id,p_quantity,auth.uid());
end;$$;

create or replace function public.create_container(p_code text)
returns uuid language plpgsql security definer set search_path=public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  insert into containers(code,created_by) values(trim(p_code),auth.uid()) returning id into cid;
  insert into movements(operation,container_id,actor_id) values('OZ_CREATE',cid,auth.uid());
  return cid;
end;$$;

create or replace function public.add_product_to_container(p_container_id uuid,p_product_id uuid,p_quantity numeric)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_quantity <= 0 then raise exception 'Quantity must be > 0'; end if;
  insert into container_items(container_id,product_id,quantity) values(p_container_id,p_product_id,p_quantity)
  on conflict(container_id,product_id) do update set quantity=container_items.quantity+excluded.quantity,updated_at=now();
  insert into movements(operation,container_id,product_id,quantity,actor_id) values('OZ_ADD',p_container_id,p_product_id,p_quantity,auth.uid());
end;$$;

create or replace function public.place_container(p_container_id uuid,p_location_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare old_loc uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select location_id into old_loc from containers where id=p_container_id for update;
  update containers set location_id=p_location_id,updated_at=now() where id=p_container_id;
  insert into movements(operation,container_id,from_location_id,to_location_id,actor_id) values('OZ_PLACE',p_container_id,old_loc,p_location_id,auth.uid());
end;$$;

create or replace view public.stock_view as
select s.product_id,s.location_id,l.code location_code,l.name location_name,s.quantity
from stock s join locations l on l.id=s.location_id where s.quantity>0;

create or replace view public.container_stock_view as
select ci.product_id,ci.container_id,c.code container_code,c.location_id,l.code location_code,ci.quantity
from container_items ci join containers c on c.id=ci.container_id left join locations l on l.id=c.location_id where ci.quantity>0 and c.status<>'archived';

create or replace view public.movement_view as
select m.id,m.operation,m.quantity,m.created_at,p.name product_name,p.sku,c.code container_code,lf.code from_location_code,lt.code to_location_code,pr.full_name actor_name
from movements m left join products p on p.id=m.product_id left join containers c on c.id=m.container_id left join locations lf on lf.id=m.from_location_id left join locations lt on lt.id=m.to_location_id left join profiles pr on pr.id=m.actor_id;

alter table profiles enable row level security;
alter table products enable row level security;
alter table locations enable row level security;
alter table stock enable row level security;
alter table containers enable row level security;
alter table container_items enable row level security;
alter table movements enable row level security;

create policy profiles_read on profiles for select to authenticated using(true);
create policy products_read on products for select to authenticated using(true);
create policy locations_read on locations for select to authenticated using(true);
create policy stock_read on stock for select to authenticated using(true);
create policy containers_read on containers for select to authenticated using(true);
create policy container_items_read on container_items for select to authenticated using(true);
create policy movements_read on movements for select to authenticated using(true);

-- Admin/manager maintenance policies
create policy products_manage on products for all to authenticated using(exists(select 1 from profiles p where p.id=auth.uid() and p.role in ('manager','admin'))) with check(exists(select 1 from profiles p where p.id=auth.uid() and p.role in ('manager','admin')));
create policy locations_manage on locations for all to authenticated using(exists(select 1 from profiles p where p.id=auth.uid() and p.role in ('manager','admin'))) with check(exists(select 1 from profiles p where p.id=auth.uid() and p.role in ('manager','admin')));
create policy profiles_admin_update on profiles for update to authenticated using(exists(select 1 from profiles p where p.id=auth.uid() and p.role='admin')) with check(exists(select 1 from profiles p where p.id=auth.uid() and p.role='admin'));

-- Minimalne granty dla API
revoke all on all tables in schema public from anon;
grant select on profiles,products,locations,stock,containers,container_items,movements to authenticated;
grant select on stock_view,container_stock_view,movement_view to authenticated;
grant insert,update,delete on products,locations to authenticated;
grant update on profiles to authenticated;
grant execute on function place_product(uuid,uuid,numeric),move_product(uuid,uuid,uuid,numeric),pick_product(uuid,uuid,numeric),create_container(text),add_product_to_container(uuid,uuid,numeric),place_container(uuid,uuid) to authenticated;

-- Dane demonstracyjne (usuń/zmień przed produkcją)
insert into locations(code,name,zone,rack,shelf) values
('A-R01-P01','Strefa A / Regał 1 / Półka 1','A','R01','P01'),
('A-R01-P02','Strefa A / Regał 1 / Półka 2','A','R01','P02'),
('B-R02-P01','Strefa B / Regał 2 / Półka 1','B','R02','P01')
on conflict do nothing;

insert into products(sku,barcode,name,manufacturer) values
('SKU-0001','5900000000017','Produkt demonstracyjny 1','Demo'),
('SKU-0002','5900000000024','Produkt demonstracyjny 2','Demo')
on conflict do nothing;
