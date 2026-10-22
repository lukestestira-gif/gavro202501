-- GAVRO BARBER: run this file in Supabase Dashboard -> SQL Editor.
-- This project uses the server-side service-role key only inside Netlify Functions.
-- Do not add public write policies to these tables.

create extension if not exists btree_gist;

create table if not exists public.site_settings (
  id smallint primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.services (
  id text primary key,
  name text not null,
  description text not null default '',
  duration integer not null check (duration between 15 and 240),
  price numeric(12,2) not null default 0 check (price >= 0),
  cost numeric(12,2) not null default 0 check (cost >= 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.barbers (
  id text primary key,
  name text not null,
  role text not null default 'Barber',
  initials text not null default '',
  color text not null default '#84b5f5',
  work_start time not null default '09:00',
  work_end time not null default '20:00',
  work_days smallint[] not null default array[1,2,3,4,5,6]::smallint[],
  photo text not null default '',
  bio text not null default '',
  active boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint barbers_shift_order check (work_end > work_start)
);

create table if not exists public.gallery (
  id text primary key,
  title text not null default 'Naš rad',
  caption text not null default '',
  image text not null,
  barber_id text null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.bookings (
  id text primary key,
  created_at timestamptz not null default now(),
  name text not null,
  phone text not null,
  note text not null default '',
  service_id text not null,
  service_name text not null,
  barber_id text not null,
  barber_name text not null,
  booking_date date not null,
  start_time time not null,
  duration integer not null check (duration between 1 and 240),
  price numeric(12,2) not null default 0 check (price >= 0),
  cost numeric(12,2) not null default 0 check (cost >= 0),
  status text not null default 'pending' check (status in ('pending','confirmed','completed','cancelled')),
  cancel_token_hash text,
  cancelled_at timestamptz
);

create index if not exists bookings_date_barber_status_idx
  on public.bookings (booking_date, barber_id, status);

-- Protect the schedule against overlapping reservations even when two people book at once.
-- Cancelled appointments no longer block the calendar.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bookings_no_overlap_per_barber'
      and conrelid = 'public.bookings'::regclass
  ) then
    alter table public.bookings
      add constraint bookings_no_overlap_per_barber
      exclude using gist (
        barber_id with =,
        tsrange(
          booking_date + start_time,
          booking_date + start_time + make_interval(mins => duration),
          '[)'
        ) with &&
      ) where (status <> 'cancelled');
  end if;
end $$;

-- All tables are accessed by the backend using SUPABASE_SERVICE_ROLE_KEY.
-- The public browser receives only the site's public data through the API function.
alter table public.site_settings enable row level security;
alter table public.services enable row level security;
alter table public.barbers enable row level security;
alter table public.gallery enable row level security;
alter table public.bookings enable row level security;

grant all on public.site_settings to service_role;
grant all on public.services to service_role;
grant all on public.barbers to service_role;
grant all on public.gallery to service_role;
grant all on public.bookings to service_role;

-- Public read-only image URLs; uploads are done only by the backend service role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gavro-uploads', 'gavro-uploads', true, 6291456, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into public.site_settings (id, data)
values (1, '{
  "salonName": "GAVRO BARBER",
  "heroTitle": "Dobar fade se vidi. Dobar barber se pamti.",
  "heroSubtitle": "Precizno šišanje, fade i uređivanje brade. Izaberi uslugu, pogledaj slobodne termine i rezerviši online.",
  "phone": "",
  "address": "",
  "instagram": "https://www.instagram.com/hairstyle_by_gavro/",
  "accent": "#84b5f5",
  "currency": "RSD",
  "openingHours": "Pon–Sub 09:00–20:00 · Nedelja zatvoreno",
  "aboutTitle": "Nije samo šišanje. To je tvoj ritual.",
  "aboutText": "GAVRO je barber studio posvećen preciznom šišanju, čistim linijama i detaljima. Izaberi svoj stil i rezerviši termin bez nepotrebnog čekanja.",
  "appTitle": "GAVRO u džepu.",
  "appText": "Sačuvaj GAVRO na početnom ekranu telefona i zakaži termin bez traženja linka."
}'::jsonb)
on conflict (id) do nothing;
