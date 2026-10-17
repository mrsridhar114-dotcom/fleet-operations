// Database access. On Vercel this talks to Neon over HTTP using DATABASE_URL.
let sqlPromise = null;
export async function q(text, params = []) {
  if (globalThis.__FLEET_QUERY) return globalThis.__FLEET_QUERY(text, params); // local test harness only
  if (!process.env.DATABASE_URL) throw Object.assign(new Error("DATABASE_URL is not set"), { status: 500 });
  sqlPromise ||= import("@neondatabase/serverless").then(({ neon }) => neon(process.env.DATABASE_URL));
  const sql = await sqlPromise;
  return sql.query(text, params);
}

// Tables are created on first use, so a new Neon database needs no setup step. schema.sql has the same statements.
let ready = null;
export function ensureSchema() {
  ready ||= (async () => {
    const stmts = [
      `create sequence if not exists fleet_ver`,
      `create table if not exists fleet_docs (coll text not null, id text not null, data jsonb not null default '{}'::jsonb, ver bigint not null, deleted boolean not null default false, updated_at timestamptz not null default now(), primary key (coll, id))`,
      `create index if not exists fleet_docs_ver_idx on fleet_docs (ver)`,
      `create table if not exists fleet_users (id text primary key, email text not null unique, name text not null, pass text not null, created_at timestamptz not null default now())`,
      `alter table fleet_users add column if not exists must_change boolean not null default false`,
      `create table if not exists fleet_pw_codes (email text primary key, code_hash text not null, expires_at timestamptz not null, tries integer not null default 0, sent_at timestamptz not null default now())`,
      `create table if not exists fleet_pins (id text primary key, user_id text not null, secret_hash text not null, pin_hash text not null, fails integer not null default 0, created_at timestamptz not null default now(), used_at timestamptz)`,
      `create index if not exists fleet_pins_user_idx on fleet_pins (user_id)`,
      `create table if not exists fleet_blobs (id text primary key, type text not null, name text, size integer not null, data text not null, owner text, created_at timestamptz not null default now())`
    ];
    for (const s of stmts) await q(s);
  })().catch(e => { ready = null; throw e; });
  return ready;
}
