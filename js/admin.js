/* Harvest Team - Admin Control Panel */
(function () {
  'use strict';
  const HT = window.HT, S = HT.S;
  const { esc, nl, fmtDT, fmtDay, ago, isAdmin, setting, toast } = HT;
  const db = () => HT.sb;

  const TABS = [['overview', 'Overview'], ['sections', 'Sections'], ['settings', 'Site & dashboard'], ['users', 'Users & admins'], ['moderation', 'Messages'], ['backup', 'Backup']];
  const WIDGETS = [['announcements', 'Announcements'], ['projects', 'Active projects'], ['assembly', 'Assembly lines'], ['raids', 'Upcoming operations'], ['messages', 'Recent messages'], ['activity', 'Activity feed'], ['links', 'Quick links']];

  HT.views.admin = function () {
    const tab = S.ui.adminTab;
    const nav = `<div class="chips-row">${TABS.map(([k, l]) => `<button class="chip-btn ${tab === k ? 'active' : ''}" data-action="adminTab" data-tab="${k}">${l}</button>`).join('')}</div>`;
    const body = ({ overview, sections, settings, users, moderation, backup })[tab] || overview;
    return `<div class="page-head"><div><h1>Admin Control Panel</h1><p class="muted">Manage content, sections, users and data. Permissions are enforced by the database.</p></div></div>${nav}${body()}`;
  };
  HT.actions.adminTab = (d) => { S.ui.adminTab = d.tab; HT.renderView(); };

  // ------------------------------------------------------------ overview
  function overview() {
    const c = (t) => (S.data[t] || []).length;
    const tile = (n, l, kind, label, ico) => `<div class="panel mini"><div class="mini-top"><span class="ico">${ico}</span><b>${n}</b></div><span class="muted">${l}</span><div class="mini-actions"><button class="btn sm primary" data-action="newEntity" data-kind="${kind}">+ ${label}</button></div></div>`;
    return `<div class="grid3">
      ${tile(c('projects'), 'Projects', 'projects', 'Project', '⚑')}
      ${tile(c('assembly_lines'), 'Assembly lines', 'assembly_lines', 'Line', '⚙')}
      ${tile(c('raids'), 'Operations', 'raids', 'Operation', '✦')}
      ${tile(c('announcements'), 'Announcements', 'announcements', 'Announcement', '◉')}
      ${tile(c('showcase_items'), 'Pictures', 'showcase_items', 'Picture', '▣')}
      <div class="panel mini"><div class="mini-top"><span class="ico">✉</span><b>${c('messages')}</b></div><span class="muted">Messages loaded</span><div class="mini-actions"><button class="btn sm" data-action="adminTab" data-tab="moderation">Moderate</button></div></div>
    </div>
    <section class="panel"><div class="panel-head"><h2>Edit content</h2></div><p class="muted">Content is edited on each section's page: open a section and use the Edit / Delete controls on its cards. Changes sync to every connected device instantly.</p><div class="tiles">${HT.visibleSections().map((s) => `<a class="tile" href="#/${esc(s.key)}"><span class="ico">${HT.icon(s)}</span>${esc(s.title)}</a>`).join('')}</div></section>`;
  }

  // ------------------------------------------------------------ sections
  function sections() {
    const list = S.sections;
    return `<section class="panel"><div class="panel-head"><h2>Website sections</h2><button class="btn primary sm" data-action="newSection">+ Add section</button></div>
      <p class="muted">Rename, describe, reorder or hide sections. Built-in sections can be hidden but not deleted; custom sections can be deleted.</p>
      <div class="list">${list.map((s, i) => `<div class="list-row ${s.visible ? '' : 'dim'}"><div class="grow"><b>${HT.icon(s)} ${esc(s.title)}</b> ${s.kind === 'page' ? '<span class="badge">custom</span>' : '<span class="badge">built-in</span>'} ${s.visible ? '' : '<span class="badge st-cancelled">hidden</span>'}<br><small class="muted">${esc(s.description)}</small></div>
        <div class="btn-group"><button class="btn sm" data-action="moveSection" data-id="${s.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button><button class="btn sm" data-action="moveSection" data-id="${s.id}" data-dir="1" ${i === list.length - 1 ? 'disabled' : ''} title="Move down">↓</button>
        <button class="btn sm" data-action="editSection" data-id="${s.id}">Edit</button>
        <button class="btn sm" data-action="toggleSection" data-id="${s.id}" ${s.key === 'dashboard' ? 'disabled' : ''}>${s.visible ? 'Hide' : 'Show'}</button>
        ${s.kind === 'page' ? `<button class="btn sm danger" data-action="deleteSection" data-id="${s.id}">Delete</button>` : ''}</div></div>`).join('')}</div></section>`;
  }
  const secFields = [{ name: 'title', label: 'Section title', type: 'text', required: true, max: 60 }, { name: 'description', label: 'Description', type: 'textarea', rows: 3 }];
  HT.editSection = function (id) {
    const s = S.sections.find((x) => x.id === id);
    if (!s) return;
    HT.openForm({
      title: 'Edit section', fields: secFields, values: s,
      onSubmit: async (v) => { const { error } = await db().from('sections').update(v).eq('id', id); if (error) throw error; await HT.refresh('sections'); }
    });
  };
  Object.assign(HT.actions, {
    newSection: () => HT.openForm({
      title: 'Add section', fields: secFields,
      onSubmit: async (v) => {
        const pos = S.sections.length ? Math.max(...S.sections.map((s) => s.position)) + 10 : 0;
        const key = 'page-' + Math.random().toString(36).slice(2, 8);
        const { error } = await db().from('sections').insert({ ...v, key, kind: 'page', position: pos, visible: true });
        if (error) throw error;
        await HT.refresh('sections');
      }
    }),
    toggleSection: async (d) => {
      const s = S.sections.find((x) => x.id === d.id);
      const { error } = await db().from('sections').update({ visible: !s.visible }).eq('id', d.id);
      if (error) throw error;
      await HT.refresh('sections');
    },
    moveSection: async (d) => {
      const order = [...S.sections], i = order.findIndex((s) => s.id === d.id), j = i + Number(d.dir);
      if (j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      const ops = order.map((s, idx) => (s.position !== idx * 10 ? db().from('sections').update({ position: idx * 10 }).eq('id', s.id) : null)).filter(Boolean);
      const res = await Promise.all(ops);
      const bad = res.find((r) => r.error);
      if (bad) throw bad.error;
      await HT.refresh('sections');
    },
    deleteSection: async (d) => {
      const s = S.sections.find((x) => x.id === d.id);
      if (!(await HT.confirmDialog(`Delete section "${s.title}" and all of its content permanently?`))) return;
      const urls = S.data.section_items.filter((i) => i.section_id === d.id && i.image_url).map((i) => i.image_url);
      const { error } = await db().from('sections').delete().eq('id', d.id);
      if (error) throw error;
      HT.removeMedia(urls);
      await HT.refresh('sections', 'section_items');
      toast('Section deleted');
    }
  });

  // ------------------------------------------------------------ settings
  function settings() {
    const W = Object.assign({}, { announcements: true, projects: true, assembly: true, raids: true, messages: true, activity: true, links: true }, setting('dash_widgets', {}));
    return `<section class="panel"><div class="panel-head"><h2>Site settings & dashboard</h2></div>
      <form data-form="saveSettings" class="form-inline">
        <label class="field"><span>Site name</span><input name="site_name" value="${esc(setting('site_name', 'HARVEST TEAM'))}" required maxlength="40"></label>
        <label class="field"><span>Tagline</span><input name="tagline" value="${esc(setting('tagline', ''))}" maxlength="80"></label>
        <label class="field"><span>Dashboard welcome message</span><textarea name="welcome_message" rows="3">${esc(setting('welcome_message', ''))}</textarea></label>
        <label class="field"><span>Items per dashboard widget (1-10)</span><input type="number" name="dash_count" min="1" max="10" value="${esc(setting('dash_count', 4))}"></label>
        <div class="field"><span>Dashboard widgets</span><div class="member-pick">${WIDGETS.map(([k, l]) => `<label class="inline"><input type="checkbox" name="w_${k}" ${W[k] ? 'checked' : ''}> ${l}</label>`).join('')}</div></div>
        <p class="form-error" hidden></p>
        <button class="btn primary" type="submit">Save settings</button>
      </form></section>`;
  }
  HT.forms.saveSettings = async function (f) {
    const fd = new FormData(f);
    const widgets = Object.fromEntries(WIDGETS.map(([k]) => [k, fd.has('w_' + k)]));
    const count = Math.max(1, Math.min(10, Number(fd.get('dash_count')) || 4));
    await HT.saveSetting('site_name', String(fd.get('site_name')).trim() || 'HARVEST TEAM');
    await HT.saveSetting('tagline', String(fd.get('tagline')).trim());
    await HT.saveSetting('welcome_message', String(fd.get('welcome_message')).trim());
    await HT.saveSetting('dash_count', count);
    await HT.saveSetting('dash_widgets', widgets);
    await HT.refresh('settings');
    toast('Settings saved');
  };

  // ------------------------------------------------------------ users
  function users() {
    return `<section class="panel"><div class="panel-head"><h2>Registered users (${S.profiles.length})</h2></div>
      <form data-form="promote" class="inline-form"><input name="username" placeholder="Username to make administrator" required pattern="[A-Za-z0-9_]{3,24}"><button class="btn primary" type="submit">Add administrator</button><p class="form-error" hidden></p></form>
      <p class="muted">The person must register first. New admins are only created by an existing admin; the database blocks everyone else from changing roles.</p>
      <div class="table-wrap"><table><thead><tr><th>Username</th><th>Display name</th><th>Role</th><th>Joined</th><th></th></tr></thead><tbody>
      ${S.profiles.map((p) => `<tr><td>@${esc(p.username)} ${p.id === S.user.id ? '<span class="badge">you</span>' : ''}</td><td>${esc(p.display_name)}</td>
        <td><select data-change="setRole" data-id="${p.id}"><option value="member" ${p.role === 'member' ? 'selected' : ''}>Member</option><option value="admin" ${p.role === 'admin' ? 'selected' : ''}>Administrator</option></select></td>
        <td>${fmtDay(String(p.created_at).slice(0, 10))}</td>
        <td><button class="btn sm" data-action="editUser" data-id="${p.id}">Rename</button></td></tr>`).join('')}
      </tbody></table></div>
      <p class="muted">To delete an account entirely, remove it in Supabase &rarr; Authentication &rarr; Users (this needs the dashboard, never browser code).</p></section>`;
  }
  HT.forms.promote = async function (f) {
    const name = f.username.value.trim().toLowerCase();
    const p = S.profiles.find((x) => x.username.toLowerCase() === name);
    const err = f.querySelector('.form-error');
    if (!p) { err.textContent = 'No registered user with that username.'; err.hidden = false; return; }
    err.hidden = true;
    if (p.role === 'admin') { toast(`${p.display_name} is already an administrator`); return; }
    if (!(await HT.confirmDialog(`Give @${p.username} full administrator access?`, 'Make admin'))) return;
    const { error } = await db().from('profiles').update({ role: 'admin' }).eq('id', p.id);
    if (error) throw error;
    await HT.refresh('profiles');
    toast('Administrator added');
  };
  HT.changes.setRole = async function (d, el) {
    const p = S.profiles.find((x) => x.id === d.id);
    const role = el.value;
    if (p.role === role) return;
    const msg = role === 'admin' ? `Make @${p.username} an administrator?` : `Remove administrator access from @${p.username}?`;
    if (!(await HT.confirmDialog(msg, 'Confirm'))) { el.value = p.role; return; }
    const { error } = await db().from('profiles').update({ role }).eq('id', d.id);
    if (error) { el.value = p.role; throw error; }
    await HT.refresh('profiles');
    toast('Role updated');
  };
  HT.actions.editUser = (d) => {
    const p = S.profiles.find((x) => x.id === d.id);
    HT.openForm({
      title: `Display name for @${p.username}`, fields: [{ name: 'display_name', label: 'Display name', type: 'text', required: true, max: 40 }], values: p,
      onSubmit: async (v) => { const { error } = await db().from('profiles').update({ display_name: v.display_name }).eq('id', d.id); if (error) throw error; await HT.refresh('profiles'); }
    });
  };

  // ------------------------------------------------------------ moderation
  function moderation() {
    const msgs = [...S.data.messages].reverse();
    return `<section class="panel"><div class="panel-head"><h2>Message moderation</h2><button class="btn sm danger" data-action="clearMessages" ${msgs.length ? '' : 'disabled'}>Delete all messages</button></div>
      ${S.errors.messages ? `<p class="muted">Could not load: ${esc(S.errors.messages)}</p>` : msgs.length ? `<div class="list">${msgs.map((m) => `<div class="list-row"><div class="grow"><b>${esc(m.sender_name)}</b> <small class="muted">${fmtDT(m.created_at)}</small><div>${nl(m.body)}</div></div><button class="btn sm danger" data-action="deleteMessage" data-id="${m.id}">Delete</button></div>`).join('')}</div>` : '<div class="empty"><p>No messages.</p></div>'}</section>`;
  }
  HT.actions.clearMessages = async () => {
    if (!(await HT.confirmDialog('Delete ALL chat messages permanently?', 'Delete all'))) return;
    const { error } = await db().from('messages').delete().not('id', 'is', null);
    if (error) throw error;
    S.data.messages = [];
    HT.renderView();
    toast('All messages deleted');
  };
  // deleteMessage (views.js) updates local list; re-render admin view too
  const origDel = HT.actions.deleteMessage;
  HT.actions.deleteMessage = async (d, el, e) => { await origDel(d, el, e); if (location.hash === '#/admin') HT.renderView(); };

  // ------------------------------------------------------------ backup
  const BACKUP_TABLES = ['sections', 'settings', 'showcase_items', 'projects', 'assembly_lines', 'raids', 'announcements', 'section_items', 'messages'];
  const CONFLICT = { settings: 'key', sections: 'key' };
  function backup() {
    return `<section class="panel"><div class="panel-head"><h2>Backup & restore</h2></div>
      <p class="muted">Export saves all content as a JSON file (sections, settings, pictures list, projects, assembly lines, operations, announcements, section items and messages). Uploaded image files stay in Supabase Storage; the backup keeps their links.</p>
      <div class="actions-row"><button class="btn primary" data-action="exportData">Export all data</button></div>
      <hr>
      <label class="field"><span>Import a backup file (.json)</span><input type="file" accept="application/json,.json" data-change="importFile"></label>
      <p class="muted">Import merges into existing data (same IDs are overwritten). Chat messages are archived in exports but not re-imported, because sender identity is always set by the server.</p></section>`;
  }
  HT.actions.exportData = async () => {
    const out = { app: 'harvest-team', version: 1, exported_at: new Date().toISOString(), tables: {} };
    for (const t of BACKUP_TABLES) {
      const { data, error } = await db().from(t).select('*');
      if (error) throw new Error(`Export failed on ${t}: ${error.message}`);
      out.tables[t] = data;
    }
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `harvest-team-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Backup downloaded');
  };
  HT.changes.importFile = async (d, el) => {
    const file = el.files[0];
    if (!file) return;
    let json;
    try { json = JSON.parse(await file.text()); } catch (e) { el.value = ''; throw new Error('That file is not valid JSON'); }
    if (!json || json.app !== 'harvest-team' || !json.tables) { el.value = ''; throw new Error('Not a Harvest Team backup file'); }
    const counts = BACKUP_TABLES.filter((t) => t !== 'messages').map((t) => `${(json.tables[t] || []).length} ${t.replace('_', ' ')}`).join(', ');
    if (!(await HT.confirmDialog(`Import backup from ${fmtDT(json.exported_at)}? (${counts}). Existing items with the same ID will be overwritten.`, 'Import'))) { el.value = ''; return; }
    try {
      for (const t of BACKUP_TABLES.filter((x) => x !== 'messages')) {
        const rows = json.tables[t] || [];
        for (let i = 0; i < rows.length; i += 100) {
          const { error } = await db().from(t).upsert(rows.slice(i, i + 100), { onConflict: CONFLICT[t] || 'id' });
          if (error) throw new Error(`Import failed on ${t}: ${error.message}`);
        }
      }
      await HT.refresh('sections', 'settings', 'showcase_items', 'projects', 'assembly_lines', 'raids', 'announcements', 'section_items', 'activity');
      toast('Backup imported');
    } finally { el.value = ''; }
  };
})();
