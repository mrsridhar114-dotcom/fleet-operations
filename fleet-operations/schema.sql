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

-- Set by an admin's temporary password: the person must choose a new password after signing in.
alter table fleet_users add column if not exists must_change boolean not null default false;

-- "Forgot password?" codes sent by email: one per person, valid 15 minutes, 5 tries.
create table if not exists fleet_pw_codes (
  email      text primary key,
  code_hash  text not null,                    -- scrypt hash of the 6-digit code
  expires_at timestamptz not null,
  tries      integer not null default 0,
  sent_at    timestamptz not null default now()
);

-- Wrong-password counter: 8 wrong passwords in a row lock sign-in for that email for 15 minutes.
create table if not exists fleet_login_fails (
  email        text primary key,
  fails        integer not null default 0,
  locked_until timestamptz,
  last_at      timestamptz not null default now()
);

-- Quick PIN sign-in, one row per phone. Only hashes are kept; the PIN works only with the secret stored on that phone.
create table if not exists fleet_pins (
  id          text primary key,
  user_id     text not null,
  secret_hash text not null,
  pin_hash    text not null,                   -- scrypt hash of the 4-digit PIN
  fails       integer not null default 0,      -- 5 wrong PINs remove the row
  created_at  timestamptz not null default now(),
  used_at     timestamptz
);
create index if not exists fleet_pins_user_idx on fleet_pins (user_id);

-- Attached photos and PDFs.
-- Deleted records, kept 30 days so an admin can restore them.
create table if not exists fleet_trash (tid bigserial primary key, coll text not null, id text not null, data jsonb not null, deleted_by text, deleted_by_name text, deleted_at timestamptz not null default now());
create index if not exists fleet_trash_at_idx on fleet_trash (deleted_at);

create table if not exists fleet_blobs (
  id         text primary key,
  type       text not null,
  name       text,
  size       integer not null,
  data       text not null,                    -- base64
  owner      text,
  created_at timestamptz not null default now()
);
