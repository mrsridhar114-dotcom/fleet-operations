/* Fleet Operations — runtime for the standalone (Vercel + Neon) version.
   The app was built against window.claude.use("db" | "user" | "assets" | "downloads"). This file provides the same calls,
   backed by this site's own /api endpoints, plus the sign-in screen. */
(() => {
  "use strict";
  const POLL_MS = 4000, POLL_HIDDEN_MS = 20000;

  /* ---------- start-up cover ----------
     The app's screens stay hidden behind a plain "Fleet Operations" cover until we know who is signed in and their
     records (and permissions) have loaded, so nobody sees the full menu flash up before the sign-in screen. */
  document.documentElement.classList.add("fo-boot");
  const bootCss = document.createElement("style");
  bootCss.textContent = `html.fo-boot,html.fo-boot body{background:#18212b!important}
html.fo-boot body>*:not(#foLogin):not(#foPin){visibility:hidden!important}
html.fo-boot body::before{content:"Fleet Operations";position:fixed;inset:0;z-index:9990;display:grid;place-items:center;color:#dbe4ec;font:700 26px/1 "Barlow Condensed",system-ui,sans-serif;letter-spacing:.02em}
html.fo-boot.fo-login body::before{content:none}`;
  document.head.appendChild(bootCss);
  let bootDone = false;
  const reveal = () => { if (bootDone) return; bootDone = true; requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove("fo-boot"))); };

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
    await null; // let the rest of this file set up first
    const pc = pinCfg();
    try { me = (await api("auth")).user; }
    catch (e) { if (e.status === 401) { pc ? showPin(pc, { signedOut: true }) : showLogin(); return new Promise(() => {}); } throw e; }
    if (pc && pc.uid !== me.id) savePin(null);
    else if (pc && needsUnlock()) { await new Promise(res => showPin(pc, { onOk: res })); document.documentElement.classList.remove("fo-login"); }
    markUnlocked();
    return me;
  })();

  /* ---------- quick PIN for phones ----------
     After the first email sign-in on a phone, the user can set a 4-digit PIN. The phone keeps a random device key;
     the server keeps only hashes. The app then asks for the PIN when it is opened, after 5 minutes in the background,
     and after signing out. 5 wrong PINs cancel it. */
  const PIN_KEY = "fo-pin", UNLOCK_KEY = "fo-unlocked", LOCK_AFTER_MS = 5 * 60 * 1000;
  const isPhone = () => matchMedia("(pointer: coarse)").matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
  function pinCfg() { try { const c = JSON.parse(localStorage.getItem(PIN_KEY) || "null"); return c && c.device && c.secret ? c : null; } catch { return null; } }
  function savePin(c) { try { c ? localStorage.setItem(PIN_KEY, JSON.stringify(c)) : localStorage.removeItem(PIN_KEY); } catch {} }
  function markUnlocked() { try { sessionStorage.setItem(UNLOCK_KEY, String(Date.now())); } catch {} }
  function needsUnlock() { let t = 0; try { t = +sessionStorage.getItem(UNLOCK_KEY) || 0; } catch {} return !t || Date.now() - t > LOCK_AFTER_MS; }
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { hiddenAt = Date.now(); if (me && !document.getElementById("foPin")) markUnlocked(); return; }
    const pc = pinCfg();
    if (me && pc && hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS && !document.getElementById("foPin")) {
      document.documentElement.classList.add("fo-boot", "fo-login");
      showPin(pc, { onOk: () => { document.documentElement.classList.remove("fo-boot", "fo-login"); markUnlocked(); } });
    }
  });
  setInterval(() => { if (me && !document.hidden && !document.getElementById("foPin")) markUnlocked(); }, 30000);

  const PIN_CSS = `#foPin{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:#18212b;padding:16px;font:15px/1.4 Barlow,system-ui,sans-serif;color:#18212b}
#foPin .card{background:#fff;width:min(360px,100%);border-radius:14px;padding:24px 20px 16px;display:flex;flex-direction:column;align-items:center;gap:10px;box-shadow:0 20px 50px rgba(0,0,0,.35)}
#foPin h1{margin:0;font:700 26px/1.1 "Barlow Condensed",system-ui,sans-serif;text-align:center}#foPin p{margin:0;color:#5c6977;font-size:14px;text-align:center}
#foPin .dots{display:flex;gap:16px;margin:10px 0 2px}#foPin .dots i{width:16px;height:16px;border-radius:50%;border:2px solid #1f5f8b;display:block}#foPin .dots i.on{background:#1f5f8b}
#foPin .err{color:#b42318;font-size:13px;min-height:1.2em;text-align:center}
#foPin .pad{display:grid;grid-template-columns:repeat(3,72px);gap:12px 22px;margin:4px 0 6px}
#foPin .pad button{width:72px;height:72px;border-radius:50%;border:0;background:#eef1f4;color:#18212b;font:600 26px/1 system-ui,sans-serif;cursor:pointer;touch-action:manipulation}
#foPin .pad button:active{background:#d9e6f0}#foPin .pad button.ghost{background:none;font-size:15px;color:#1f5f8b}#foPin .pad button:disabled{opacity:.4}
#foPin .lnk{background:none;border:0;color:#1f5f8b;font:600 14px system-ui,sans-serif;padding:8px;cursor:pointer}
#foPin .shake{animation:foShake .35s}@keyframes foShake{20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}`;
  // A 4-digit keypad screen. onDone(pin, ui) runs when four digits are in.
  function pinPad({ title, sub, onDone, links = [] }) {
    document.getElementById("foPin")?.remove();
    const w = document.createElement("div"); w.id = "foPin"; w.setAttribute("role", "dialog"); w.setAttribute("aria-modal", "true");
    w.innerHTML = `<style>${PIN_CSS}</style><div class="card"><h1></h1><p data-sub></p><div class="dots" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="err" role="alert"></div><div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button type="button" data-d="${n}">${n}</button>`).join("")}<span></span><button type="button" data-d="0">0</button><button type="button" class="ghost" data-del aria-label="Delete">⌫</button></div>
      <div data-links style="display:flex;flex-direction:column;align-items:center"></div></div>`;
    const q1 = sel => w.querySelector(sel);
    q1("h1").textContent = title; q1("[data-sub]").textContent = sub;
    links.forEach(([t, f]) => { const b = document.createElement("button"); b.type = "button"; b.className = "lnk"; b.textContent = t; b.onclick = f; q1("[data-links]").appendChild(b); });
    let pin = "", busy = false;
    const draw = () => w.querySelectorAll(".dots i").forEach((d, i) => d.classList.toggle("on", i < pin.length));
    const ui = {
      setTitle: t => q1("h1").textContent = t, setSub: t => q1("[data-sub]").textContent = t,
      err: t => { q1(".err").textContent = t || ""; if (t) { const d = q1(".dots"); d.classList.remove("shake"); void d.offsetWidth; d.classList.add("shake"); } },
      clear: () => { pin = ""; draw(); }, busy: b => { busy = b; w.querySelectorAll(".pad button").forEach(x => x.disabled = b); },
      close: () => { w.remove(); document.removeEventListener("keydown", key); }
    };
    const press = async d => {
      if (busy) return;
      if (d === "del") { pin = pin.slice(0, -1); draw(); return; }
      if (pin.length >= 4) return;
      pin += d; draw(); q1(".err").textContent = "";
      if (pin.length === 4) { const v = pin; ui.busy(true); try { await onDone(v, ui); } finally { if (document.body.contains(w)) ui.busy(false); } }
    };
    w.addEventListener("click", e => { const b = e.target.closest(".pad button"); if (b) press(b.hasAttribute("data-del") ? "del" : b.dataset.d); });
    const key = e => { if (!document.body.contains(w)) return document.removeEventListener("keydown", key); if (/^\d$/.test(e.key)) press(e.key); else if (e.key === "Backspace") press("del"); };
    document.addEventListener("keydown", key);
    const add = () => document.body.appendChild(w);
    document.body ? add() : document.addEventListener("DOMContentLoaded", add);
    return ui;
  }
  // Enter the PIN to sign in (signed out) or to unlock (still signed in).
  function showPin(cfg, { signedOut = false, onOk } = {}) {
    document.documentElement.classList.add("fo-login");
    const first = String(cfg.name || "").trim().split(/\s+/)[0];
    const toEmail = forget => () => { if (forget) savePin(null); document.getElementById("foPin")?.remove(); showLogin(); };
    pinPad({
      title: first ? `Welcome back, ${first}` : "Welcome back", sub: "Enter your 4-digit PIN",
      links: [["Forgot PIN?", toEmail(true)], ["Use email and password", toEmail(false)]],
      onDone: async (pin, ui) => {
        try {
          await api("auth", { action: "pinlogin", device: cfg.device, secret: cfg.secret, pin });
          markUnlocked();
          if (signedOut || !onOk) { location.reload(); return; }
          ui.close(); onOk();
        } catch (e) {
          ui.clear();
          if (e.code === "pin_gone" || /Too many|isn't set up/.test(e.message)) { savePin(null); ui.err(e.message); setTimeout(toEmail(false), 1800); }
          else ui.err(e.message || "Couldn't check the PIN. Check your connection.");
        }
      }
    });
  }
  // Choose a new PIN (twice). Used after the first email sign-in on a phone, and from the side menu.
  function pinSetup({ after, skip }) {
    let first = "";
    const old = pinCfg();
    pinPad({
      title: old ? "Change your PIN" : "Set up a quick PIN", sub: "Choose 4 digits to open the app on this phone",
      links: [[skip ? "Skip for now" : "Cancel", () => { document.getElementById("foPin")?.remove(); (skip || after)(false); }]],
      onDone: async (pin, ui) => {
        if (!first) {
          if (/^(\d)\1{3}$/.test(pin) || ["1234", "2345", "3456", "4567", "5678", "6789", "4321", "9876", "0123"].includes(pin)) { ui.clear(); ui.err("That PIN is too easy to guess. Avoid 1234 or the same digit four times."); return; }
          first = pin; ui.clear(); ui.setSub("Enter the same 4 digits again"); return;
        }
        if (pin !== first) { first = ""; ui.clear(); ui.setSub("Choose 4 digits to open the app on this phone"); ui.err("The PINs didn't match. Try again."); return; }
        try {
          const r = await api("auth", { action: "pinset", pin, device: old?.device || "" });
          savePin({ device: r.device, secret: r.secret, uid: r.user.id, name: r.user.name, email: r.user.email });
          markUnlocked(); ui.close(); after(true);
        } catch (e) { first = ""; ui.clear(); ui.setSub("Choose 4 digits to open the app on this phone"); ui.err(e.message); }
      }
    });
  }

  function showLogin() {
    document.documentElement.classList.add("fo-login");
    const go = () => {
      const css = `#foLogin{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:#18212b;padding:16px;font:15px/1.4 Barlow,system-ui,sans-serif}
#foLogin form{background:#fff;color:#18212b;width:min(380px,100%);border-radius:12px;padding:26px 24px;display:flex;flex-direction:column;gap:12px;box-shadow:0 20px 50px rgba(0,0,0,.35)}
#foLogin h1{margin:0;font:700 28px "Barlow Condensed",system-ui,sans-serif}#foLogin p{margin:0;color:#5c6977;font-size:14px}
#foLogin label{display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600}#foLogin input{font:inherit;padding:10px 12px;border:1px solid #d9dfe5;border-radius:8px}
#foLogin button{font:inherit;font-weight:600;padding:11px;border-radius:8px;border:0;background:#1f5f8b;color:#fff;cursor:pointer}#foLogin .lnk{background:none;color:#1f5f8b;padding:4px;font-weight:600}
#foLogin .err{color:#b42318;font-size:13px;min-height:1em}
#foLogin .pw{position:relative;display:flex}#foLogin .pw input{flex:1;padding-right:64px;min-width:0}
#foLogin .pw .show{position:absolute;right:4px;top:50%;transform:translateY(-50%);background:none;color:#1f5f8b;padding:6px 8px;font-size:13px}
#foLogin .fgt{align-self:flex-end;margin-top:-6px;font-size:13px!important;padding:2px 0!important}#foLogin .ok{color:#2e7d4f;font-size:14px;background:#e4f3ea;border-radius:8px;padding:10px 12px}
#foLogin label.keep{flex-direction:row;align-items:center;gap:10px;font-weight:500;font-size:14px;cursor:pointer}#foLogin label.keep input{width:20px;height:20px;margin:0;accent-color:#1f5f8b}`;
      const wrap = document.createElement("div"); wrap.id = "foLogin";
      wrap.innerHTML = `<style>${css}</style><form novalidate><h1>Welcome to VBS</h1><p id="foSub">Sign in to manage your fleet</p>
        <label id="foNameL" hidden>Your name<input id="foName" autocomplete="name" maxlength="80"></label>
        <label>Email<input id="foEmail" type="email" autocomplete="username" required></label>
        <label id="foPwL">Password<span class="pw"><input id="foPw" type="password" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" required minlength="8"><button type="button" class="show" id="foShow" aria-label="Show password">Show</button></span></label>
        <button type="button" class="lnk fgt" id="foForgot">Forgot password?</button>
        <label id="foCodeL" hidden>6-digit code from your email<input id="foCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" style="letter-spacing:6px;font-size:20px;text-align:center"></label>
        <label id="foNewL" hidden>New password (8 characters or more)<input id="foNew" type="password" autocomplete="new-password" autocapitalize="off"></label>
        <label id="foNew2L" hidden>Enter the new password again<input id="foNew2" type="password" autocomplete="new-password" autocapitalize="off"></label>
        <label class="keep" id="foKeepL"><input type="checkbox" id="foKeep" checked>Keep me signed in on this device</label>
        <div class="ok" id="foOk" role="status" hidden></div>
        <div class="err" id="foErr" role="alert"></div><button type="submit" id="foGo">Sign in</button>
        <button type="button" class="lnk" id="foResend" hidden>Send a new code</button>
        <button type="button" class="lnk" id="foSwap">New here? Create an account</button></form>`;
      document.body.appendChild(wrap);
      let signup = false, mode = "login";
      const $ = id => document.getElementById(id);
      const LS = "fo-login-email";
      try { const em = localStorage.getItem(LS); if (em) $("foEmail").value = em; } catch {}
      $("foEmail").setAttribute("autocapitalize", "off");
      $("foShow").onclick = () => { const on = $("foPw").type === "password"; $("foPw").type = on ? "text" : "password"; $("foShow").textContent = on ? "Hide" : "Show"; $("foShow").setAttribute("aria-label", on ? "Hide password" : "Show password"); $("foPw").focus(); };
      // Modes on one card: sign in, create an account, forgot password (email), and reset with the emailed code.
      const setMode = m => {
        mode = m; signup = m === "signup";
        const show = (id, on) => $(id).hidden = !on;
        show("foNameL", m === "signup"); show("foPwL", m === "login" || m === "signup"); show("foKeepL", m !== "forgot");
        show("foForgot", m === "login"); show("foCodeL", m === "code"); show("foNewL", m === "code"); show("foNew2L", m === "code"); show("foResend", m === "code");
        $("foEmail").readOnly = m === "code";
        $("foGo").textContent = { signup: "Create account", forgot: "Send code", code: "Reset password" }[m] || "Sign in";
        $("foSwap").textContent = m === "login" ? "New here? Create an account" : "Back to sign in";
        $("foSub").textContent = { signup: "Create your login. An admin then gives you access.", forgot: "Enter your email and we'll send you a 6-digit code.", code: `We sent a 6-digit code to ${$("foEmail").value.trim()}. Check your inbox and spam folder.` }[m] || "Sign in to manage your fleet";
        $("foPw").autocomplete = m === "signup" ? "new-password" : "current-password"; $("foErr").textContent = ""; $("foOk").hidden = true; $("foGo").hidden = false;
      };
      $("foSwap").onclick = () => setMode(mode === "login" ? "signup" : "login");
      $("foForgot").onclick = () => { setMode("forgot"); $("foEmail").focus(); };
      const sendCode = async () => {
        await api("auth", { action: "forgot", email: $("foEmail").value.trim() });
        setMode("code"); setTimeout(() => $("foCode").focus(), 30);
      };
      $("foResend").onclick = async () => { $("foErr").textContent = ""; try { await sendCode(); $("foOk").textContent = "A new code is on its way."; $("foOk").hidden = false; } catch (er) { $("foErr").textContent = er.message; } };
      wrap.querySelector("form").onsubmit = async e => {
        e.preventDefault(); $("foErr").textContent = ""; $("foGo").disabled = true;
        const keep = $("foKeep").checked, email = $("foEmail").value.trim();
        if (mode === "forgot") {
          try { await sendCode(); } catch (er) { $("foErr").textContent = er.message; } finally { $("foGo").disabled = false; }
          return;
        }
        if (mode === "code") {
          try {
            const code = $("foCode").value.trim(), a = $("foNew").value, b = $("foNew2").value;
            if (!/^\d{6}$/.test(code)) throw new Error("Enter the 6-digit code from the email.");
            if (a.length < 8) throw new Error("Use a new password of at least 8 characters.");
            if (a !== b) throw new Error("The two passwords don't match.");
            await api("auth", { action: "resetcode", email, code, password: a, remember: keep });
            try { keep ? localStorage.setItem(LS, email) : localStorage.removeItem(LS); } catch {}
            savePin(null); markUnlocked();
            if (isPhone()) { wrap.remove(); pinSetup({ after: () => location.reload(), skip: () => location.reload() }); return; }
            location.reload();
          } catch (er) { $("foErr").textContent = er.message; } finally { if ($("foGo")) $("foGo").disabled = false; }
          return;
        }
        try {
          await api("auth", { action: signup ? "signup" : "login", name: $("foName").value, email, password: $("foPw").value, remember: keep });
          try { keep ? localStorage.setItem(LS, email) : localStorage.removeItem(LS); } catch {}
          markUnlocked();
          const pc = pinCfg();
          if (isPhone() && !signup && !(pc && pc.email === email.toLowerCase())) { wrap.remove(); pinSetup({ after: () => location.reload(), skip: () => location.reload() }); return; }
          location.reload();
        }
        catch (er) { $("foErr").textContent = er.message; } finally { if ($("foGo")) $("foGo").disabled = false; }
      };
      setTimeout(() => ($("foEmail").value ? $("foPw") : $("foEmail")).focus(), 50);
    };
    document.body ? go() : document.addEventListener("DOMContentLoaded", go);
  }

  // Sign out / change password, next to the signed-in name in the side menu.
  function accountMenu() {
    const who = document.getElementById("who"); if (!who || document.getElementById("foAcct")) return;
    const box = document.createElement("div"); box.id = "foAcct"; box.style.cssText = "display:flex;gap:10px;margin:4px 0 6px;font-size:12px";
    const btn = (t, f) => { const b = document.createElement("button"); b.type = "button"; b.textContent = t; b.style.cssText = "background:none;border:0;padding:0;color:inherit;opacity:.8;text-decoration:underline;cursor:pointer;font:inherit"; b.onclick = f; box.appendChild(b); };
    btn("Change password", changePassword);
    if (isPhone() || pinCfg()) btn(pinCfg() ? "Change PIN" : "Set up PIN", () => pinSetup({ after: ok => { if (ok) { alertBox("PIN saved. Use it to open the app on this phone."); } refreshAcct(); } }));
    if (pinCfg()) btn("Remove PIN", async () => { const c = pinCfg(); try { await api("auth", { action: "pinoff", device: c.device }); } catch {} savePin(null); alertBox("PIN removed from this phone."); refreshAcct(); });
    if (me.admin) btn("Reset a password", () => dialog(`<b style="font-size:16px">Reset someone's password</b><p style="margin:0;color:var(--muted,#5c6977)">Give them this temporary password; they can change it after signing in.</p>${fld("foRe", "Their email", "email")}${fld("foRp", "Temporary password (8 characters or more)", "text")}`,
      async d => { await api("auth", { action: "reset", email: d.querySelector("#foRe").value, password: d.querySelector("#foRp").value }); alertBox("Password reset."); }));
    who.after(box);
    powerButtons();
  }
  // Signed in with a temporary password: choose a new one before using the app.
  function forceNewPassword() {
    const d = document.createElement("div"); d.id = "foMust";
    d.style.cssText = "position:fixed;inset:0;z-index:9999;background:#18212b;display:grid;place-items:center;padding:16px;font:15px/1.4 Barlow,system-ui,sans-serif";
    const inp = id => `<input id="${id}" type="password" autocomplete="new-password" autocapitalize="off" style="font:inherit;padding:10px 12px;border:1px solid #d9dfe5;border-radius:8px">`;
    d.innerHTML = `<form style="background:#fff;color:#18212b;width:min(380px,100%);border-radius:12px;padding:24px;display:flex;flex-direction:column;gap:12px">
      <b style="font:700 26px/1.1 'Barlow Condensed',system-ui,sans-serif">Choose a new password</b>
      <span style="color:#5c6977;font-size:14px">You signed in with a temporary password. Set your own to continue.</span>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600">New password (8 characters or more)${inp("foN1")}</label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600">Enter it again${inp("foN2")}</label>
      <div data-err style="color:#b42318;font-size:13px;min-height:1em"></div>
      <button style="font:inherit;font-weight:600;padding:11px;border-radius:8px;border:0;background:#1f5f8b;color:#fff">Save and continue</button></form>`;
    document.body.appendChild(d);
    const err = d.querySelector("[data-err]");
    d.querySelector("form").onsubmit = async e => {
      e.preventDefault(); err.textContent = "";
      const a = d.querySelector("#foN1").value, b = d.querySelector("#foN2").value;
      if (a.length < 8) return err.textContent = "Use at least 8 characters.";
      if (a !== b) return err.textContent = "The two passwords don't match.";
      try { await api("auth", { action: "password", next: a, device: pinCfg()?.device || "" }); me.mustChange = false; d.remove(); alertBox("Password saved."); }
      catch (er) { err.textContent = er.message; }
    };
    setTimeout(() => d.querySelector("#foN1").focus(), 50);
  }
  function refreshAcct() { document.getElementById("foAcct")?.remove(); accountMenu(); }

  // Sign out: a power icon at the top of the side menu, next to "Fleet Operations" (on phones, seen when the menu is open). Asks first.
  const POWER_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 3v8"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/></svg>`;
  function signOutAsk() {
    const d = document.createElement("div");
    d.style.cssText = "position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.45);display:grid;place-items:center;padding:16px";
    d.innerHTML = `<div role="dialog" aria-modal="true" aria-label="Sign out" style="background:var(--surface,#fff);color:var(--ink,#18212b);border-radius:12px;padding:20px;width:min(340px,100%);display:flex;flex-direction:column;gap:14px;font-size:15px">
      <b style="font-size:17px">Sign out?</b><span style="color:var(--muted,#5c6977);font-size:14px">${pinCfg() ? "Next time, sign in with your PIN." : "You'll need your email and password to sign in again on this device."}</span>
      <div style="display:flex;gap:8px"><button type="button" class="btn" data-x style="flex:1">Cancel</button><button type="button" class="btn danger" data-ok style="flex:1">Sign out</button></div></div>`;
    document.body.appendChild(d);
    d.onclick = e => { if (e.target === d) d.remove(); };
    d.querySelector("[data-x]").onclick = () => d.remove();
    d.querySelector("[data-ok]").onclick = async e => { e.target.disabled = true; try { await api("auth", { action: "logout" }); } catch {} location.reload(); };
    setTimeout(() => d.querySelector("[data-x]").focus(), 30);
  }
  function powerButtons() {
    if (document.getElementById("foPowerCss")) return;
    const st = document.createElement("style"); st.id = "foPowerCss";
    st.textContent = `.fo-power{display:inline-grid;place-items:center;width:38px;height:38px;padding:0!important;border-radius:8px;border:1px solid var(--side-line,#24323f)!important;background:none;color:var(--side-ink,#dbe4ec)!important;cursor:pointer;flex:none}
.fo-power:hover,.fo-power:focus-visible{border-color:var(--danger,#b3261e)!important;color:#ff8a80!important}
.side .fo-power{position:absolute;top:calc(17px + env(safe-area-inset-top,0px));right:10px;z-index:2;width:32px;height:32px}
.side .fo-power svg{width:17px;height:17px}
.side .brand{padding-right:46px}.side .brand .mark{white-space:nowrap;font-size:21px}
@media (max-width:860px){.side .fo-power{top:calc(17px + env(safe-area-inset-top,0px))}}`;
    document.head.appendChild(st);
    const mk = () => { const b = document.createElement("button"); b.type = "button"; b.className = "fo-power"; b.title = "Sign out"; b.setAttribute("aria-label", "Sign out"); b.innerHTML = POWER_SVG; b.onclick = signOutAsk; return b; };
    const side = document.getElementById("side"); if (side) side.prepend(mk());
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
      await api("auth", { action: "password", current: d.querySelector("#foCur").value, next: d.querySelector("#foNew").value, device: pinCfg()?.device || "" }); alertBox("Password changed.");
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
  ready.then(() => {
    const cap = setTimeout(reveal, 6000);
    const wait = () => store.loaded ? store.loaded.then(() => setTimeout(() => { clearTimeout(cap); reveal(); }, 250), () => reveal()) : setTimeout(wait, 50);
    wait();
  }, () => reveal());
  ready.then(() => { if (me?.mustChange) forceNewPassword(); });
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
