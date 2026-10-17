-- Fleet Operations database. The app creates these by itself on first use;
-- you only need to run this if you want to create them by hand in the Neon SQL Editor.
create sequence if not exists fleet_ver;

-- Every record the app keeps (vehicles, drivers, conductors, users, trip sheets, bookings, change history…).
create table if not exists fleet_docs (
  coll       text        not null,             -- which list it belongs to, e.g. 'bookings'
  id         text        not null,
  data       jsonb       not null default '{}'::jsonb,
  ver        bigint      not null,             -- increases on every change; used to send only what changed
  deleted    boolean     not null default false,
  updated_at timestamptz not null default now(),
  primary key (coll, id)
);
create index if not exists fleet_docs_ver_idx on fleet_docs (ver);

-- Logins (email + password). Access to modules is set in the app's User master.
create table if not exists fleet_users (
  id         text primary key,
  email      text not null unique,
  name       text not null,
  pass       text not null,                    -- scrypt hash, never the password itself
  created_at timestamptz not null default now()
);

-- Attached photos and PDFs.
create table if not exists fleet_blobs (
  id         text primary key,
  type       text not null,
  name       text,
  size       integer not null,
  data       text not null,                    -- base64
  owner      text,
  created_at timestamptz not null default now()
);
