/* Fleet Operations — runtime for the standalone (Vercel + Neon) version.
   The app was built against window.claude.use("db" | "user" | "assets" | "downloads"). This file provides the same calls,
   backed by this site's own /api endpoints, plus the sign-in screen. */
(() => {
  "use strict";
  const POLL_MS = 4000, POLL_HIDDEN_MS = 20000;

  async function api(path, body, opts = {}) {
    const r = await fetch("/api/" + path, {
      method: opts.method || (body !== undefined ? "POST" : "GET"), credentials: "same-origin",
      headers: opts.headers || (body !== undefined ? { "Content-Type": "application/json" } : {}),
      body: opts.raw !== undefined ? opts.raw : body !== undefined ? JSON.stringify(body) : undefined
    });
    let j = {}; try { j = await r.json(); } catch {}
    if (!r.ok) { const e = new Error(j.error || r.statusText || "Request failed"); e.code = j.code || (r.status === 401 ? "unauthenticated" : r.status === 403 ? "permission_denied" : "unavailable"); e.status = r.status; throw e; }
    return j;
  }

  /* ---------- sign-in ---------- */
  let me = null;
  const ready = (async () => {
    try { me = (await api("auth")).user; return me; }
    catch (e) { if (e.status === 401) { showLogin(); return new Promise(() => {}); } throw e; }
  })();

  function showLogin() {
    const go = () => {
      const css = `#foLogin{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:#18212b;padding:16px;font:15px/1.4 Barlow,system-ui,sans-serif}
#foLogin form{background:#fff;color:#18212b;width:min(380px,100%);border-radius:12px;padding:26px 24px;display:flex;flex-direction:column;gap:12px;box-shadow:0 20px 50px rgba(0,0,0,.35)}
#foLogin h1{margin:0;font:700 28px "Barlow Condensed",system-ui,sans-serif}#foLogin p{margin:0;color:#5c6977;font-size:14px}
#foLogin label{display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600}#foLogin input{font:inherit;padding:10px 12px;border:1px solid #d9dfe5;border-radius:8px}
#foLogin button{font:inherit;font-weight:600;padding:11px;border-radius:8px;border:0;background:#1f5f8b;color:#fff;cursor:pointer}#foLogin .lnk{background:none;color:#1f5f8b;padding:4px;font-weight:600}
#foLogin .err{color:#b42318;font-size:13px;min-height:1em}`;
      const wrap = document.createElement("div"); wrap.id = "foLogin";
      wrap.innerHTML = `<style>${css}</style><form novalidate><h1>Fleet Operations</h1><p id="foSub">Sign in to continue.</p>
        <label id="foNameL" hidden>Your name<input id="foName" autocomplete="name" maxlength="80"></label>
        <label>Email<input id="foEmail" type="email" autocomplete="username" required></label>
        <label>Password<input id="foPw" type="password" autocomplete="current-password" required minlength="8"></label>
        <div class="err" id="foErr" role="alert"></div><button type="submit" id="foGo">Sign in</button>
        <button type="button" class="lnk" id="foSwap">New here? Create an account</button></form>`;
      document.body.appendChild(wrap);
      let signup = false;
      const $ = id => document.getElementById(id);
      $("foSwap").onclick = () => { signup = !signup; $("foNameL").hidden = !signup; $("foGo").textContent = signup ? "Create account" : "Sign in";
        $("foSwap").textContent = signup ? "Have an account? Sign in" : "New here? Create an account"; $("foSub").textContent = signup ? "Create your login. An admin then gives you access." : "Sign in to continue.";
        $("foPw").autocomplete = signup ? "new-password" : "current-password"; $("foErr").textContent = ""; };
      wrap.querySelector("form").onsubmit = async e => {
        e.preventDefault(); $("foErr").textContent = ""; $("foGo").disabled = true;
        try { await api("auth", { action: signup ? "signup" : "login", name: $("foName").value, email: $("foEmail").value, password: $("foPw").value }); location.reload(); }
        catch (er) { $("foErr").textContent = er.message; } finally { $("foGo").disabled = false; }
      };
      setTimeout(() => $("foEmail").focus(), 50);
    };
    document.body ? go() : document.addEventListener("DOMContentLoaded", go);
  }

  // Sign out / change password, next to the signed-in name in the side menu.
  function accountMenu() {
    const who = document.getElementById("who"); if (!who || document.getElementById("foAcct")) return;
    const box = document.createElement("div"); box.id = "foAcct"; box.style.cssText = "display:flex;gap:10px;margin:4px 0 6px;font-size:12px";
    const btn = (t, f) => { const b = document.createElement("button"); b.type = "button"; b.textContent = t; b.style.cssText = "background:none;border:0;padding:0;color:inherit;opacity:.8;text-decoration:underline;cursor:pointer;font:inherit"; b.onclick = f; box.appendChild(b); };
    btn("Sign out", async () => { try { await api("auth", { action: "logout" }); } catch {} location.reload(); });
    btn("Change password", changePassword);
    if (me.admin) btn("Reset a password", () => dialog(`<b style="font-size:16px">Reset someone's password</b><p style="margin:0;color:var(--muted,#5c6977)">Give them this temporary password; they can change it after signing in.</p>${fld("foRe", "Their email", "email")}${fld("foRp", "Temporary password (8 characters or more)", "text")}`,
      async d => { await api("auth", { action: "reset", email: d.querySelector("#foRe").value, password: d.querySelector("#foRp").value }); alertBox("Password reset."); }));
    who.after(box);
  }
  function dialog(html, onOk) {
    const d = document.createElement("div");
    d.style.cssText = "position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.45);display:grid;place-items:center;padding:16px";
    d.innerHTML = `<form style="background:var(--surface,#fff);color:var(--ink,#18212b);border-radius:12px;padding:20px;width:min(360px,100%);display:flex;flex-direction:column;gap:10px;font-size:14px">${html}
      <div data-err style="color:#b42318;font-size:13px;min-height:1em"></div><div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">OK</button></div></form>`;
    document.body.appendChild(d);
    d.querySelector("[data-x]").onclick = () => d.remove();
    d.querySelector("form").onsubmit = async e => { e.preventDefault(); try { await onOk(d); d.remove(); } catch (er) { d.querySelector("[data-err]").textContent = er.message; } };
    setTimeout(() => d.querySelector("input")?.focus(), 30);
  }
  const fld = (id, label, type = "password") => `<label style="display:flex;flex-direction:column;gap:4px;font-weight:600;font-size:13px">${label}<input id="${id}" type="${type}" style="font:inherit;padding:8px 10px;border:1px solid var(--line,#d9dfe5);border-radius:6px"></label>`;
  function changePassword() {
    dialog(`<b style="font-size:16px">Change password</b>${fld("foCur", "Current password")}${fld("foNew", "New password (8 characters or more)")}`, async d => {
      await api("auth", { action: "password", current: d.querySelector("#foCur").value, next: d.querySelector("#foNew").value }); alertBox("Password changed.");
    });
  }
  function alertBox(t) { const n = document.createElement("div"); n.textContent = t; n.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#18212b;color:#fff;padding:10px 16px;border-radius:8px;z-index:9999;font-size:14px"; document.body.appendChild(n); setTimeout(() => n.remove(), 3500); }

  /* ---------- shared records: a local copy kept in step with the server ---------- */
  const store = { colls: new Map(), ver: 0, scope: "", subs: new Set(), pending: new Map(), loaded: null, timer: null, syncing: null };
  const coll = name => { if (!store.colls.has(name)) store.colls.set(name, new Map()); return store.colls.get(name); };
  const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));

  async function pull() {
    let changed = new Set(), more = true, guard = 0;
    while (more && guard++ < 200) {
      const r = await api("db", { op: "sync", since: store.ver });
      if (store.scope && r.scope !== store.scope) { store.colls.clear(); store.ver = 0; store.scope = r.scope; changed = new Set(["*"]); more = true; continue; }
      store.scope = r.scope;
      for (const row of r.rows) {
        if (store.pending.has(row.c + "/" + row.id)) continue;
        const m = coll(row.c);
        if (row.d === null) m.delete(row.id); else m.set(row.id, row.d);
        changed.add(row.c);
      }
      store.ver = Math.max(store.ver, r.ver); more = r.more;
    }
    return changed;
  }
  function notify(changed) {
    if (!changed.size) return;
    for (const s of [...store.subs]) if (changed.has("*") || changed.has(s.coll)) { try { s.fire(); } catch (e) { console.error(e); } }
  }
  function sync() {
    store.syncing ||= pull().then(notify).catch(e => { if (e.status === 401) location.reload(); }).finally(() => { store.syncing = null; });
    return store.syncing;
  }
  function schedule() {
    clearTimeout(store.timer);
    store.timer = setTimeout(async () => { await sync(); schedule(); }, document.hidden ? POLL_HIDDEN_MS : POLL_MS);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && store.loaded) { sync(); schedule(); } });
  window.addEventListener("focus", () => { if (store.loaded) sync(); });

  async function write(op, c, id, data) {
    const key = c + "/" + id, m = coll(c), before = m.has(id) ? clone(m.get(id)) : undefined;
    if (op === "delete") m.delete(id); else if (op === "update") { if (!m.has(id)) throw Object.assign(new Error("No such record"), { code: "not_found" }); m.set(id, { ...m.get(id), ...clone(data) }); }
    else m.set(id, clone(data));
    store.pending.set(key, (store.pending.get(key) || 0) + 1);
    notify(new Set([c]));
    try { await api("db", { op, coll: c, id, data: op === "delete" ? undefined : clean(data) }); }
    catch (e) { if (before === undefined) m.delete(id); else m.set(id, before); notify(new Set([c])); throw e; }
    finally { const n = store.pending.get(key) - 1; n ? store.pending.set(key, n) : store.pending.delete(key); }
    sync();
  }
  const clean = d => JSON.parse(JSON.stringify(d ?? {}));
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/-/g, "").slice(0, 20);

  const CMP = {
    "==": (a, b) => a === b, "!=": (a, b) => a !== b, "<": (a, b) => a < b, "<=": (a, b) => a <= b, ">": (a, b) => a > b, ">=": (a, b) => a >= b,
    "in": (a, b) => Array.isArray(b) && b.includes(a), "not-in": (a, b) => Array.isArray(b) && !b.includes(a), "array-contains": (a, b) => Array.isArray(a) && a.includes(b)
  };
  const docSnap = (id, d) => ({ id, exists: d !== undefined, data: () => clone(d) });
  function query(c, filters = [], order = null, lim = 0) {
    const run = () => {
      let rows = [...coll(c).entries()];
      for (const [f, op, v] of filters) rows = rows.filter(([, d]) => d[f] !== undefined && (CMP[op] || (() => false))(d[f], v));
      if (order) { const [f, dir] = order, s = dir === "desc" ? -1 : 1; rows.sort((a, b) => a[1][f] === undefined ? 1 : b[1][f] === undefined ? -1 : a[1][f] < b[1][f] ? -s : a[1][f] > b[1][f] ? s : 0); }
      else rows.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
      if (lim) rows = rows.slice(0, lim);
      const docs = rows.map(([id, d]) => docSnap(id, d));
      return { docs, size: docs.length, empty: !docs.length, forEach: f => docs.forEach(f), docChanges: () => [] };
    };
    return {
      where: (f, op, v) => query(c, [...filters, [f, op, v]], order, lim),
      orderBy: (f, dir) => query(c, filters, [f, dir || "asc"], lim),
      limit: n => query(c, filters, order, n),
      get: async () => { await sync(); return run(); },
      onSnapshot(next, error) {
        const sub = { coll: c, fire: () => next(run()) };
        store.subs.add(sub); store.loaded.then(() => store.subs.has(sub) && sub.fire(), e => error && error(e));
        return () => store.subs.delete(sub);
      }
    };
  }
  function docRef(c, id) {
    return {
      id, path: `${c}/${id}`,
      get: async () => { await sync(); return docSnap(id, coll(c).get(id)); },
      set: data => write("set", c, id, data),
      update: data => write("update", c, id, data),
      delete: () => write("delete", c, id),
      onSnapshot(next, error) {
        const sub = { coll: c, fire: () => next(docSnap(id, coll(c).get(id))) };
        store.subs.add(sub); store.loaded.then(() => store.subs.has(sub) && sub.fire(), e => error && error(e));
        return () => store.subs.delete(sub);
      },
      collection: sub => collectionRef(`${c}__${id}__${sub}`)
    };
  }
  function collectionRef(c) {
    return { ...query(c), path: c, doc: id => docRef(c, id || newId()), add: async data => { const id = newId(); await write("set", c, id, data); return docRef(c, id); } };
  }
  const db = { collection: collectionRef, doc: path => { const [c, id] = String(path).split("/"); return docRef(c, id); } };

  /* ---------- the four capabilities ---------- */
  const user = {
    me: async () => ({ id: me.id, name: me.name, email: me.email, isOwner: !!me.isOwner }),
    can: async () => true,
    profiles: async ids => (await api("auth", { action: "profiles", ids })).profiles || {}
  };
  const OK_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];
  const assets = {
    async upload(blob, opts = {}) {
      const type = String(opts.type || blob.type || "").toLowerCase();
      if (!OK_TYPES.includes(type)) throw Object.assign(new Error("Attach a PDF or a photo."), { code: "unsupported_type" });
      if (blob.size > 4 * 1024 * 1024) throw Object.assign(new Error("Files can be up to 4 MB."), { code: "too_large" });
      return api("blob", undefined, { method: "POST", raw: blob, headers: { "Content-Type": "application/octet-stream", "X-File-Type": type, "X-File-Name": encodeURIComponent(blob.name || "") } });
    },
    list: () => api("blob"),
    delete: async ref => api("blob?id=" + encodeURIComponent(typeof ref === "string" ? ref : ref.id), undefined, { method: "DELETE" })
  };
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = filename || "download"; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return { status: "saved" };
    }
  };

  // Installable as an Android app (Chrome "Install app", or packaged with PWABuilder).
  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));

  window.claude = {
    async use(name) {
      await ready;
      if (name === "db") { store.loaded ||= pull().then(notify).then(() => schedule()); await store.loaded; return db; }
      if (name === "user") return user;
      if (name === "assets") return me.member || me.isOwner ? assets : null;
      if (name === "downloads") return downloads;
      return null;
    }
  };
  ready.then(() => { const t = setInterval(() => { accountMenu(); if (document.getElementById("foAcct")) clearInterval(t); }, 300); restoreButton(); });

  /* ---------- owner: load a backup file into the database ---------- */
  function restoreButton() {
    if (!me?.isOwner) return;
    const t = setInterval(() => {
      const anchor = document.getElementById("stBackup"); if (!anchor) return; clearInterval(t);
      if (document.getElementById("foRestore")) return;
      const lbl = document.createElement("label"); lbl.className = "btn"; lbl.id = "foRestore"; lbl.textContent = "Restore backup (JSON)"; lbl.style.cursor = "pointer";
      const inp = document.createElement("input"); inp.type = "file"; inp.accept = "application/json,.json"; inp.hidden = true; lbl.appendChild(inp);
      anchor.after(lbl);
      inp.onchange = async () => {
        const f = inp.files[0]; inp.value = ""; if (!f) return;
        const msg = document.getElementById("stBkMsg");
        try {
          const j = JSON.parse(await f.text());
          if (j.kind !== "backup" || !j.collections) throw new Error("This is not a Fleet Operations backup file.");
          const docs = Object.entries(j.collections).flatMap(([c, list]) => (list || []).filter(d => d && d.id).map(({ id, ...data }) => ({ coll: c, id: String(id), data })));
          if (!confirm(`Load ${docs.length} records from this backup (taken ${String(j.exportedAt || "").slice(0, 10)})? Records with the same id are replaced; nothing else is deleted.`)) return;
          let done = 0;
          for (let i = 0; i < docs.length; i += 200) { done += (await api("db", { op: "import", docs: docs.slice(i, i + 200) })).imported; if (msg) msg.textContent = `Restoring… ${done} of ${docs.length}`; }
          if (msg) msg.textContent = `Restored ${done} records. Reloading…`;
          setTimeout(() => location.reload(), 1200);
        } catch (e) { if (msg) msg.textContent = "Couldn't restore: " + e.message; }
      };
    }, 500);
  }
})();
