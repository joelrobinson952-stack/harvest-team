/* Harvest Team - core: state, helpers, auth, data, realtime, modal/form engine */
(function () {
  'use strict';
  const CFG = window.HARVEST_CONFIG || {};
  const configured = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && !/YOUR_/.test(CFG.SUPABASE_URL + CFG.SUPABASE_ANON_KEY));

  const HT = (window.HT = { views: {}, actions: {}, forms: {}, changes: {}, afterRender: {} });
  const S = (HT.S = {
    user: null, me: null, sections: [], settings: {}, profiles: [], data: {}, errors: {}, live: false,
    ui: { showcaseCat: '', projFilter: 'all', projArchived: false, raidTab: 'upcoming', adminTab: 'overview' }
  });
  let sb = null;

  // ------------------------------------------------------------ helpers
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nl = (s) => esc(s).replace(/\n/g, '<br>');
  const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
  const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
  const fmtDT = (d) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const fmtDay = (s) => {
    if (!s) return '—';
    const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };
  const ago = (d) => {
    const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
    const a = Math.abs(s);
    const u = a < 60 ? [a, 's'] : a < 3600 ? [Math.round(a / 60), 'm'] : a < 86400 ? [Math.round(a / 3600), 'h'] : [Math.round(a / 86400), 'd'];
    return s >= 0 ? (a < 45 ? 'just now' : `${u[0]}${u[1]} ago`) : `in ${u[0]}${u[1]}`;
  };
  const toLocalInput = (iso) => {
    if (!iso) return '';
    const d = new Date(iso), p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const isAdmin = () => !!S.me && S.me.role === 'admin';
  const setting = (k, d) => (S.settings[k] === undefined || S.settings[k] === null ? d : S.settings[k]);
  const nameOf = (id) => (S.profiles.find((p) => p.id === id) || {}).display_name || 'Unknown';
  Object.assign(HT, { $, esc, nl, cap, safeUrl, fmtDT, fmtDay, ago, toLocalInput, isAdmin, setting, nameOf });

  function toast(msg, type) {
    const el = document.createElement('div');
    el.className = 'toast ' + (type || 'ok');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), 3800);
    setTimeout(() => el.remove(), 4300);
  }
  HT.toast = toast;

  // ------------------------------------------------------------ modal
  let modalResolve = null;
  function openModal(html, cls) {
    closeModal();
    $('#modal-root').innerHTML = `<div class="overlay" data-action="closeModalBg"><div class="modal ${cls || ''}" role="dialog" aria-modal="true">${html}</div></div>`;
    document.body.classList.add('noscroll');
    const f = $('#modal-root').querySelector('input:not([type=hidden]):not([type=file]),textarea,select');
    if (f) f.focus();
  }
  function closeModal() {
    const r = modalResolve; modalResolve = null; formCtx = null;
    $('#modal-root').innerHTML = '';
    document.body.classList.remove('noscroll');
    if (r) r(false);
  }
  function confirmDialog(msg, okLabel) {
    return new Promise((res) => {
      openModal(`<h3>Confirm action</h3><p class="modal-text">${esc(msg)}</p><div class="form-actions"><button class="btn" data-action="confirmNo">Cancel</button><button class="btn danger" data-action="confirmYes">${esc(okLabel || 'Delete')}</button></div>`, 'small');
      modalResolve = res;
    });
  }
  Object.assign(HT, { openModal, closeModal, confirmDialog });
  HT.actions.confirmYes = () => { const r = modalResolve; modalResolve = null; closeModal(); if (r) r(true); };
  HT.actions.confirmNo = () => closeModal();
  HT.actions.closeModal = () => closeModal();
  HT.actions.closeModalBg = (d, el, e) => { if (e.target === el) closeModal(); };

  // ------------------------------------------------------------ storage
  async function uploadFile(file, folder) {
    if (file.size > 10 * 1024 * 1024) throw new Error(`"${file.name}" is larger than 10 MB`);
    const ext = ((file.name.split('.').pop() || 'bin').toLowerCase()).replace(/[^a-z0-9]/g, '') || 'bin';
    const path = `${folder}/${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from('media').upload(path, file, { contentType: file.type, cacheControl: '3600' });
    if (error) throw new Error('Upload failed: ' + error.message);
    return sb.storage.from('media').getPublicUrl(path).data.publicUrl;
  }
  const mediaPath = (u) => { const m = String(u || '').match(/\/object\/public\/media\/(.+)$/); return m ? decodeURIComponent(m[1]) : null; };
  async function removeMedia(urls) {
    const paths = (urls || []).map(mediaPath).filter(Boolean);
    if (paths.length) { try { await sb.storage.from('media').remove(paths); } catch (e) { console.warn(e); } }
  }
  Object.assign(HT, { uploadFile, removeMedia });

  // ------------------------------------------------------------ form engine
  let formCtx = null;
  function fieldHtml(f, v) {
    const n = esc(f.name), lab = `<span>${esc(f.label)}${f.required ? ' *' : ''}</span>`, req = f.required ? 'required' : '';
    switch (f.type) {
      case 'textarea': return `<label class="field">${lab}<textarea name="${n}" rows="${f.rows || 4}" ${req}>${esc(v == null ? '' : v)}</textarea></label>`;
      case 'select': return `<label class="field">${lab}<select name="${n}">${f.options.map((o) => `<option value="${esc(o)}" ${o === v ? 'selected' : ''}>${esc(cap(o))}</option>`).join('')}</select></label>`;
      case 'number': return `<label class="field">${lab}<input type="number" name="${n}" value="${esc(v == null ? '' : v)}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} ${req}></label>`;
      case 'date': return `<label class="field">${lab}<input type="date" name="${n}" value="${esc(v ? String(v).slice(0, 10) : '')}" ${req}></label>`;
      case 'datetime': return `<label class="field">${lab}<input type="datetime-local" name="${n}" value="${esc(toLocalInput(v))}" ${req}></label>`;
      case 'checkbox': return `<label class="field inline"><input type="checkbox" name="${n}" ${v ? 'checked' : ''}> ${lab}</label>`;
      case 'image': return `<div class="field">${lab}${v ? `<div class="img-current"><img src="${esc(safeUrl(v))}" alt=""><label class="inline"><input type="checkbox" name="${n}__remove"> Remove current picture</label></div>` : ''}<input type="file" name="${n}" accept="image/png,image/jpeg,image/gif,image/webp" ${f.required && !v ? 'required' : ''}></div>`;
      case 'files': {
        const cur = (v || []).map((a, i) => `<label class="inline"><input type="checkbox" name="${n}__keep" value="${i}" checked> ${esc(a.name || 'file')}</label>`).join('');
        return `<div class="field">${lab}${cur ? `<div class="file-list">${cur}</div>` : ''}<input type="file" name="${n}__new" multiple accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"><small class="muted">Images or PDF, max 10 MB each. Untick a file to remove it.</small></div>`;
      }
      case 'members': {
        const sel = new Set(v || []);
        return `<div class="field">${lab}<div class="member-pick">${S.profiles.map((p) => `<label class="inline"><input type="checkbox" name="${n}" value="${p.id}" ${sel.has(p.id) ? 'checked' : ''}> ${esc(p.display_name)}</label>`).join('') || '<span class="muted">No registered users yet.</span>'}</div></div>`;
      }
      case 'checklist': return `<label class="field">${lab}<textarea name="${n}" rows="5" placeholder="One item per line">${esc((v || []).map((c) => c.text).join('\n'))}</textarea></label>`;
      default: {
        const dl = f.list && f.list.length ? `<datalist id="dl-${n}">${f.list.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>` : '';
        return `<label class="field">${lab}<input type="${f.type === 'password' ? 'password' : 'text'}" name="${n}" value="${esc(v == null ? '' : v)}" ${f.list && f.list.length ? `list="dl-${n}"` : ''} ${f.max ? `maxlength="${f.max}"` : ''} ${f.minlen ? `minlength="${f.minlen}"` : ''} ${req} autocomplete="off">${dl}</label>`;
      }
    }
  }

  async function collectForm(form, ctx) {
    const out = {}, cleanup = [];
    for (const f of ctx.fields) {
      const old = ctx.values[f.name], el = form.elements[f.name];
      switch (f.type) {
        case 'number': out[f.name] = el.value === '' ? (f.nullable ? null : 0) : Number(el.value); break;
        case 'checkbox': out[f.name] = el.checked; break;
        case 'date': out[f.name] = el.value || null; break;
        case 'datetime': out[f.name] = el.value ? new Date(el.value).toISOString() : null; break;
        case 'members': out[f.name] = [...form.querySelectorAll(`input[name="${f.name}"]:checked`)].map((i) => i.value); break;
        case 'image': {
          const file = el.files[0], rm = form.elements[f.name + '__remove'] && form.elements[f.name + '__remove'].checked;
          if (file) { out[f.name] = await uploadFile(file, f.folder || 'images'); if (old) cleanup.push(old); }
          else if (rm) { out[f.name] = null; if (old) cleanup.push(old); }
          else out[f.name] = old == null ? null : old;
          if (f.required && !out[f.name]) throw new Error(`${f.label} is required`);
          break;
        }
        case 'files': {
          const keep = [...form.querySelectorAll(`input[name="${f.name}__keep"]:checked`)].map((i) => +i.value);
          const oldArr = old || [];
          oldArr.forEach((a, i) => { if (!keep.includes(i) && a.url) cleanup.push(a.url); });
          const added = [];
          for (const file of form.elements[f.name + '__new'].files) added.push({ name: file.name, type: file.type, url: await uploadFile(file, 'attachments') });
          out[f.name] = [...oldArr.filter((_, i) => keep.includes(i)), ...added];
          break;
        }
        case 'checklist': {
          const done = new Map((old || []).map((c) => [c.text, c.done]));
          out[f.name] = el.value.split('\n').map((s) => s.trim()).filter(Boolean).map((t) => ({ text: t, done: !!done.get(t) }));
          break;
        }
        default: out[f.name] = el.value.trim();
      }
    }
    return { vals: out, cleanup };
  }

  HT.openForm = function ({ title, fields, values, submitLabel, onSubmit, intro }) {
    const ctx = { fields, values: values || {}, onSubmit };
    openModal(`<form id="modalForm"><h3>${esc(title)}</h3>${intro ? `<p class="muted">${esc(intro)}</p>` : ''}${fields.map((f) => fieldHtml(f, ctx.values[f.name])).join('')}<p class="form-error" hidden></p><div class="form-actions"><button type="button" class="btn" data-action="closeModal">Cancel</button><button type="submit" class="btn primary">${esc(submitLabel || 'Save')}</button></div></form>`, 'wide');
    formCtx = ctx; // set AFTER openModal, which resets formCtx via closeModal()
  };

  async function submitModalForm(form) {
    const ctx = formCtx;
    if (!ctx) return;
    const btn = form.querySelector('[type=submit]'), err = form.querySelector('.form-error'), label = btn.textContent;
    err.hidden = true; btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const { vals, cleanup } = await collectForm(form, ctx);
      const msg = await ctx.onSubmit(vals);
      removeMedia(cleanup);
      closeModal();
      toast(typeof msg === 'string' ? msg : 'Saved');
    } catch (e) {
      err.textContent = e.message || String(e); err.hidden = false;
      btn.disabled = false; btn.textContent = label;
    }
  }

  // ------------------------------------------------------------ data
  const TABLE_Q = {
    announcements: (q) => q.order('created_at', { ascending: false }),
    projects: (q) => q.order('updated_at', { ascending: false }),
    assembly_lines: (q) => q.order('name'),
    raids: (q) => q.order('scheduled_at', { ascending: true }),
    showcase_items: (q) => q.order('created_at', { ascending: false }),
    section_items: (q) => q.order('position').order('created_at'),
    messages: (q) => q.order('created_at', { ascending: false }).limit(300),
    activity: (q) => q.order('created_at', { ascending: false }).limit(15)
  };
  const CONTENT_TABLES = Object.keys(TABLE_Q);

  async function loadTable(t) {
    try {
      let q = sb.from(t).select('*');
      q = TABLE_Q[t](q);
      const { data, error } = await q;
      if (error) throw error;
      S.data[t] = t === 'messages' ? data.reverse() : data;
      delete S.errors[t];
    } catch (e) {
      S.errors[t] = e.message || String(e);
      if (!S.data[t]) S.data[t] = [];
    }
  }
  async function loadSections() { const { data, error } = await sb.from('sections').select('*').order('position'); if (error) throw error; S.sections = data; }
  async function loadSettings() { const { data, error } = await sb.from('settings').select('*'); if (error) throw error; S.settings = Object.fromEntries(data.map((r) => [r.key, r.value])); }
  async function loadProfiles() {
    const { data, error } = await sb.from('profiles').select('*').order('display_name');
    if (error) throw error;
    S.profiles = data;
    const me = data.find((p) => p.id === (S.user && S.user.id));
    if (me) S.me = me;
  }
  async function reload(t) {
    if (t === 'sections') return loadSections();
    if (t === 'settings') return loadSettings();
    if (t === 'profiles') return loadProfiles();
    return loadTable(t);
  }
  HT.loadTable = loadTable;
  HT.refresh = async function (...tables) {
    await Promise.all(tables.map((t) => reload(t).catch((e) => console.error(e))));
    onDataChanged(tables);
  };
  HT.saveSetting = async function (key, value) {
    const { error } = await sb.from('settings').upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) throw error;
  };

  // ------------------------------------------------------------ realtime
  let pending = new Set(), timer = null;
  function subscribe() {
    const ch = sb.channel('harvest-live');
    [...CONTENT_TABLES, 'sections', 'settings', 'profiles'].forEach((t) =>
      ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => {
        pending.add(t);
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const ts = [...pending]; pending = new Set();
          await Promise.all(ts.map((x) => reload(x).catch((e) => console.error(e))));
          onDataChanged(ts);
        }, 250);
      })
    );
    ch.subscribe((status) => { S.live = status === 'SUBSCRIBED'; updateLive(); });
  }
  function updateLive() {
    document.querySelectorAll('.live-dot').forEach((el) => {
      el.classList.toggle('on', S.live);
      el.title = S.live ? 'Live sync connected' : 'Live sync offline - changes appear on refresh';
    });
    document.querySelectorAll('.live-label').forEach((el) => { el.textContent = S.live ? 'LIVE' : 'OFFLINE'; });
  }
  HT.updateLive = updateLive;

  function onDataChanged(tables) {
    if (!S.user) return;
    renderShell();
    const onlyMsgs = tables.every((t) => t === 'messages');
    if (currentKey() === 'messages' && (onlyMsgs || !tables.some((t) => t === 'sections' || t === 'settings'))) {
      if (HT.afterRender.messages) HT.afterRender.messages(false);
      return;
    }
    HT.renderView();
  }

  // ------------------------------------------------------------ shell + routing
  const ICONS = { dashboard: '◈', showcase: '▣', projects: '⚑', assembly: '⚙', raids: '✦', announcements: '◉', messages: '✉', admin: '⛨', page: '❖' };
  HT.icon = (sec) => ICONS[sec.key] || ICONS.page;
  HT.visibleSections = () => S.sections.filter((s) => s.visible);
  const currentKey = () => location.hash.replace(/^#\/?/, '') || 'dashboard';

  function renderShell() {
    const name = setting('site_name', 'HARVEST TEAM');
    document.title = name;
    $('#topbar').innerHTML = `
      <button class="icon-btn menu-btn" data-action="toggleNav" aria-label="Toggle menu">☰</button>
      <a class="brand" href="#/dashboard">
        <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><circle cx="16" cy="16" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 2v8M16 22v8M2 16h8M22 16h8" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="16" r="2.5" fill="currentColor"/></svg>
        <span><b>${esc(name)}</b><small>${esc(setting('tagline', ''))}</small></span>
      </a>
      <div class="top-right">
        <span class="live-wrap"><i class="live-dot ${S.live ? 'on' : ''}"></i><span class="live-label">${S.live ? 'LIVE' : 'OFFLINE'}</span></span>
        <button class="user-chip" data-action="profile" title="Edit profile"><span class="avatar">${esc((S.me.display_name || '?').slice(0, 1).toUpperCase())}</span><span class="uname">${esc(S.me.display_name)}</span>${isAdmin() ? '<span class="badge admin">ADMIN</span>' : ''}</button>
        <button class="btn sm" data-action="signOut">Sign out</button>
      </div>`;
    const key = currentKey();
    const items = HT.visibleSections().map((s) => `<a class="nav-item ${key === s.key ? 'active' : ''}" href="#/${esc(s.key)}"><span class="ico">${HT.icon(s)}</span><span>${esc(s.title)}</span></a>`).join('');
    const adm = isAdmin() ? `<div class="nav-sep">Command</div><a class="nav-item ${key === 'admin' ? 'active' : ''}" href="#/admin"><span class="ico">${ICONS.admin}</span><span>Admin Control Panel</span></a>` : '';
    $('#nav').innerHTML = `<div class="nav-sep">Navigation</div>${items}${adm}`;
  }

  HT.renderView = function () {
    if (!S.user || !S.me) return;
    const key = currentKey(), main = $('#view');
    let html;
    if (key === 'admin') {
      if (!isAdmin()) { location.hash = '#/dashboard'; return; }
      html = HT.views.admin();
    } else {
      let sec = S.sections.find((s) => s.key === key && s.visible);
      if (!sec) {
        if (key !== 'dashboard') { location.hash = '#/dashboard'; return; }
        sec = S.sections.find((s) => s.key === 'dashboard') || { key: 'dashboard', title: 'Dashboard', description: '', kind: 'builtin' };
      }
      html = (sec.kind === 'builtin' && HT.views[key] ? HT.views[key] : HT.views.page)(sec);
    }
    main.innerHTML = html;
    renderShell();
    const hook = HT.afterRender[key];
    if (hook) hook(true);
  };

  window.addEventListener('hashchange', () => {
    document.body.classList.remove('nav-open');
    window.scrollTo(0, 0);
    HT.renderView();
  });

  // ------------------------------------------------------------ auth
  function show(which) {
    $('#boot').hidden = which !== 'boot';
    $('#auth').hidden = which !== 'auth';
    $('#app').hidden = which !== 'app';
  }

  function showAuth(tab, notice) {
    show('auth');
    tab = tab || 'login';
    const notConf = !configured ? `<p class="notice warn">Supabase is not configured yet. Edit <code>js/config.js</code> with your project URL and anon key (see README).</p>` : '';
    const form = {
      login: `<form data-form="login"><label class="field"><span>Email</span><input type="email" name="email" required autocomplete="email"></label><label class="field"><span>Password</span><input type="password" name="password" required autocomplete="current-password"></label><p class="form-error" hidden></p><button class="btn primary block" type="submit">Sign in</button><button type="button" class="link-btn" data-action="authTab" data-tab="forgot">Forgot password?</button></form>`,
      register: `<form data-form="register"><label class="field"><span>Username (letters, numbers, _ ; 3-24)</span><input name="username" required pattern="[A-Za-z0-9_]{3,24}" autocomplete="username"></label><label class="field"><span>Display name</span><input name="display_name" required maxlength="40" autocomplete="nickname"></label><label class="field"><span>Email</span><input type="email" name="email" required autocomplete="email"></label><label class="field"><span>Password (min 8 characters)</span><input type="password" name="password" required minlength="8" autocomplete="new-password"></label><p class="form-error" hidden></p><button class="btn primary block" type="submit">Create account</button></form>`,
      forgot: `<form data-form="forgot"><p class="muted">Enter your account email and we'll send a reset link.</p><label class="field"><span>Email</span><input type="email" name="email" required></label><p class="form-error" hidden></p><button class="btn primary block" type="submit">Send reset link</button><button type="button" class="link-btn" data-action="authTab" data-tab="login">Back to sign in</button></form>`
    }[tab];
    $('#auth').innerHTML = `<div class="auth-card"><div class="auth-brand"><svg viewBox="0 0 32 32" width="44" height="44"><circle cx="16" cy="16" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 2v8M16 22v8M2 16h8M22 16h8" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="16" r="2.5" fill="currentColor"/></svg><h1>${esc(setting('site_name', 'HARVEST TEAM'))}</h1><p>Authorised personnel only</p></div>${notConf}${notice ? `<p class="notice">${esc(notice)}</p>` : ''}${tab !== 'forgot' ? `<div class="tabs"><button class="tab ${tab === 'login' ? 'active' : ''}" data-action="authTab" data-tab="login">Sign in</button><button class="tab ${tab === 'register' ? 'active' : ''}" data-action="authTab" data-tab="register">Register</button></div>` : '<h3>Reset password</h3>'}${form}</div>`;
  }
  HT.actions.authTab = (d) => showAuth(d.tab);

  const fdata = (f) => Object.fromEntries(new FormData(f).entries());
  function formError(f, msg) { const p = f.querySelector('.form-error'); p.textContent = msg; p.hidden = false; }
  async function busy(f, fn) {
    const b = f.querySelector('[type=submit]'), l = b.textContent;
    b.disabled = true; b.textContent = 'Please wait…';
    f.querySelector('.form-error').hidden = true;
    try { await fn(); } catch (e) { formError(f, e.message || String(e)); } finally { b.disabled = false; b.textContent = l; }
  }

  HT.forms.login = (f) => busy(f, async () => {
    if (!configured) throw new Error('Supabase is not configured (js/config.js).');
    const v = fdata(f);
    const { error } = await sb.auth.signInWithPassword({ email: v.email.trim(), password: v.password });
    if (error) throw new Error(/confirm/i.test(error.message) ? 'Please confirm your email first (check your inbox).' : 'Sign in failed: ' + error.message);
  });
  HT.forms.register = (f) => busy(f, async () => {
    if (!configured) throw new Error('Supabase is not configured (js/config.js).');
    const v = fdata(f);
    if (!/^[A-Za-z0-9_]{3,24}$/.test(v.username)) throw new Error('Username must be 3-24 letters, numbers or underscores.');
    const { data, error } = await sb.auth.signUp({
      email: v.email.trim(), password: v.password,
      options: { data: { username: v.username, display_name: v.display_name.trim() }, emailRedirectTo: location.origin + location.pathname }
    });
    if (error) throw new Error(/database error/i.test(error.message) ? 'That username is already taken or invalid.' : error.message);
    if (!data.session) showAuth('login', 'Account created. Check your email and click the confirmation link, then sign in.');
  });
  HT.forms.forgot = (f) => busy(f, async () => {
    const v = fdata(f);
    const { error } = await sb.auth.resetPasswordForEmail(v.email.trim(), { redirectTo: location.origin + location.pathname });
    if (error) throw error;
    showAuth('login', 'If that email has an account, a reset link is on its way.');
  });

  HT.actions.signOut = async () => { await sb.auth.signOut(); };

  HT.openPasswordForm = function (title) {
    HT.openForm({
      title: title || 'Change password',
      fields: [{ name: 'password', label: 'New password (min 8 characters)', type: 'password', required: true, minlen: 8 }],
      onSubmit: async (v) => { const { error } = await sb.auth.updateUser({ password: v.password }); if (error) throw error; return 'Password updated'; }
    });
  };
  HT.actions.profile = () => {
    HT.openForm({
      title: 'Your profile',
      intro: `Signed in as @${S.me.username}${isAdmin() ? ' (administrator)' : ''}`,
      fields: [{ name: 'display_name', label: 'Display name', type: 'text', required: true, max: 40 }],
      values: { display_name: S.me.display_name },
      onSubmit: async (v) => {
        const { error } = await sb.from('profiles').update({ display_name: v.display_name }).eq('id', S.user.id);
        if (error) throw error;
        await HT.refresh('profiles');
      }
    });
  };
  HT.actions.toggleNav = () => document.body.classList.toggle('nav-open');

  function teardown() {
    try { sb.removeAllChannels(); } catch (e) { /* ignore */ }
    S.user = null; S.me = null; S.data = {}; S.errors = {}; S.live = false;
    closeModal();
    showAuth('login');
  }

  async function boot(user) {
    S.user = user;
    show('boot');
    $('#boot').innerHTML = '<div class="boot-card"><div class="spinner"></div><p>Loading team data…</p></div>';
    try {
      const { data: me, error } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
      if (error) throw error;
      if (!me) throw new Error('Your profile record is missing. Make sure sql/schema.sql was run, then sign out and register again.');
      S.me = me;
      await Promise.all([loadSections(), loadSettings(), loadProfiles(), ...CONTENT_TABLES.map(loadTable)]);
      subscribe();
      show('app');
      renderShell();
      HT.renderView();
    } catch (e) {
      console.error(e);
      $('#boot').innerHTML = `<div class="boot-card"><h3>Could not load</h3><p class="muted">${esc(e.message || e)}</p><button class="btn primary" onclick="location.reload()">Retry</button> <button class="btn" data-action="signOut">Sign out</button></div>`;
    }
  }

  // ------------------------------------------------------------ global events
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = HT.actions[el.dataset.action];
    if (!fn) return;
    try { await fn(el.dataset, el, e); } catch (err) { console.error(err); toast(err.message || 'Something went wrong', 'err'); }
  });
  document.addEventListener('change', async (e) => {
    const el = e.target.closest('[data-change]');
    if (!el) return;
    const fn = HT.changes[el.dataset.change];
    try { if (fn) await fn(el.dataset, el); } catch (err) { console.error(err); toast(err.message || 'Something went wrong', 'err'); }
  });
  document.addEventListener('submit', async (e) => {
    const f = e.target;
    if (f.id === 'modalForm') { e.preventDefault(); return submitModalForm(f); }
    const fn = f.dataset && HT.forms[f.dataset.form];
    if (fn) { e.preventDefault(); try { await fn(f); } catch (err) { console.error(err); toast(err.message || 'Something went wrong', 'err'); } }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#modal-root').firstChild) closeModal();
    if (e.target.id === 'chatinput' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const f = $('#chatform'); if (f) f.requestSubmit(); }
  });

  // ------------------------------------------------------------ start
  HT.start = function () {
    if (!configured) { showAuth('login'); return; }
    sb = HT.sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    sb.auth.onAuthStateChange((event, session) => {
      // never await supabase calls directly in this callback
      setTimeout(() => {
        if (session && session.user) {
          if (!S.user || S.user.id !== session.user.id) boot(session.user);
          if (event === 'PASSWORD_RECOVERY') setTimeout(() => HT.openPasswordForm('Set a new password'), 600);
        } else if (S.user || $('#auth').hidden) {
          teardown();
        }
      }, 0);
    });
  };
  document.addEventListener('DOMContentLoaded', HT.start);
})();
