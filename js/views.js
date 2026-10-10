/* Harvest Team - content views and entity CRUD */
(function () {
  'use strict';
  const HT = window.HT, S = HT.S;
  const { esc, nl, cap, safeUrl, fmtDT, fmtDay, ago, isAdmin, setting, nameOf, toast } = HT;
  const db = () => HT.sb;

  const PROJECT_STATUS = ['planned', 'active', 'completed', 'cancelled'];
  const PRIORITY = ['low', 'medium', 'high', 'critical'];
  const LINE_STATUS = ['running', 'paused', 'stopped'];
  const RAID_STATUS = ['planned', 'upcoming', 'active', 'completed', 'cancelled'];

  // ------------------------------------------------------------ shared UI bits
  const badge = (s) => `<span class="badge st-${esc(s)}">${esc(s)}</span>`;
  const bar = (pct, cls) => `<div class="bar ${cls || ''}"><i style="width:${Math.max(0, Math.min(100, Number(pct) || 0))}%"></i></div>`;
  const members = (ids) => (ids && ids.length ? ids.map((id) => `<span class="chip">${esc(nameOf(id))}</span>`).join('') : '<span class="muted">Unassigned</span>');
  const empty = (ico, text, sub) => `<div class="empty"><div class="empty-ico">${ico}</div><p>${esc(text)}</p>${sub ? `<small class="muted">${esc(sub)}</small>` : ''}</div>`;
  const img = (u, cls) => (safeUrl(u) ? `<div class="${cls || 'cover'}"><img src="${esc(safeUrl(u))}" alt="" loading="lazy"></div>` : '');
  const errorCard = (t) => `<div class="empty err"><div class="empty-ico">⚠</div><p>Could not load data.</p><small class="muted">${esc(S.errors[t])}</small><br><button class="btn sm" data-action="retry" data-t="${esc(t)}">Retry</button></div>`;
  const needs = (tables, fn) => { for (const t of tables) if (S.errors[t]) return errorCard(t); return fn(); };

  function head(sec, actions) {
    return `<div class="page-head"><div><h1>${esc(sec.title)}</h1><p class="muted">${esc(sec.description || '')}</p></div><div class="actions">${actions || ''}${isAdmin() && sec.id ? `<button class="btn sm ghost" data-action="editSection" data-id="${sec.id}">Edit section</button>` : ''}</div></div>`;
  }
  const addBtn = (kind, label) => (isAdmin() ? `<button class="btn primary" data-action="newEntity" data-kind="${kind}">+ ${esc(label)}</button>` : '');
  const adminRow = (kind, id, extra) => (isAdmin() ? `<div class="card-actions">${extra || ''}<button class="btn sm" data-action="editEntity" data-kind="${kind}" data-id="${id}">Edit</button><button class="btn sm danger" data-action="deleteEntity" data-kind="${kind}" data-id="${id}">Delete</button></div>` : '');

  // ------------------------------------------------------------ entity config
  const ENT = {
    announcements: { label: 'announcement', name: (r) => r.title, media: ['image_url'] },
    projects: { label: 'project', name: (r) => r.name, media: ['cover_url'] },
    assembly_lines: { label: 'assembly line', name: (r) => r.name, media: ['image_url'] },
    raids: { label: 'operation', name: (r) => r.name, media: [], files: ['attachments'] },
    showcase_items: { label: 'picture', name: (r) => r.title, media: ['image_url'] },
    section_items: { label: 'item', name: (r) => r.title, media: ['image_url'] }
  };

  function fieldsFor(kind) {
    switch (kind) {
      case 'announcements': return [
        { name: 'title', label: 'Title', type: 'text', required: true, max: 120 },
        { name: 'body', label: 'Message', type: 'textarea', rows: 6, required: true },
        { name: 'image_url', label: 'Image (optional)', type: 'image', folder: 'announcements' },
        { name: 'pinned', label: 'Pin to top', type: 'checkbox' }];
      case 'projects': return [
        { name: 'name', label: 'Project name', type: 'text', required: true, max: 120 },
        { name: 'description', label: 'Description', type: 'textarea' },
        { name: 'cover_url', label: 'Cover image', type: 'image', folder: 'projects' },
        { name: 'status', label: 'Status', type: 'select', options: PROJECT_STATUS },
        { name: 'priority', label: 'Priority', type: 'select', options: PRIORITY },
        { name: 'members', label: 'Assigned members', type: 'members' },
        { name: 'start_date', label: 'Start date', type: 'date' },
        { name: 'target_date', label: 'Target completion', type: 'date' },
        { name: 'progress', label: 'Progress (%)', type: 'number', min: 0, max: 100 },
        { name: 'notes', label: 'Notes', type: 'textarea' }];
      case 'assembly_lines': return [
        { name: 'name', label: 'Assembly line name', type: 'text', required: true, max: 120 },
        { name: 'description', label: 'Description', type: 'textarea' },
        { name: 'status', label: 'Production status', type: 'select', options: LINE_STATUS },
        { name: 'items', label: 'Products / items being assembled', type: 'text' },
        { name: 'target', label: 'Production target', type: 'number', min: 0 },
        { name: 'current', label: 'Current production quantity', type: 'number', min: 0 },
        { name: 'members', label: 'Assigned members', type: 'members' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
        { name: 'image_url', label: 'Picture (optional)', type: 'image', folder: 'assembly' }];
      case 'raids': return [
        { name: 'name', label: 'Operation name', type: 'text', required: true, max: 120 },
        { name: 'objective', label: 'Objective', type: 'text' },
        { name: 'description', label: 'Description', type: 'textarea' },
        { name: 'scheduled_at', label: 'Date and time', type: 'datetime', required: true },
        { name: 'status', label: 'Status', type: 'select', options: RAID_STATUS },
        { name: 'squad', label: 'Team / squad assignment', type: 'text' },
        { name: 'members', label: 'Assigned squad members', type: 'members' },
        { name: 'briefing', label: 'Briefing notes', type: 'textarea', rows: 6 },
        { name: 'checklist', label: 'Equipment / preparation checklist', type: 'checklist' },
        { name: 'notes', label: 'Additional notes', type: 'textarea' },
        { name: 'attachments', label: 'Images / reference attachments', type: 'files' }];
      case 'showcase_items': return [
        { name: 'title', label: 'Title', type: 'text', required: true, max: 120 },
        { name: 'description', label: 'Description', type: 'textarea' },
        { name: 'category', label: 'Category', type: 'text', max: 40, list: [...new Set((S.data.showcase_items || []).map((i) => i.category).filter(Boolean))] },
        { name: 'image_url', label: 'Picture', type: 'image', required: true, folder: 'showcase' }];
      case 'section_items': return [
        { name: 'title', label: 'Title', type: 'text', required: true, max: 120 },
        { name: 'body', label: 'Content', type: 'textarea', rows: 6 },
        { name: 'image_url', label: 'Image (optional)', type: 'image', folder: 'sections' }];
    }
  }
  function defaultsFor(kind) {
    const next = new Date(Date.now() + 3600e3); next.setMinutes(0, 0, 0);
    return ({
      projects: { status: 'planned', priority: 'medium', progress: 0, members: [] },
      assembly_lines: { status: 'running', target: 0, current: 0, members: [] },
      raids: { status: 'planned', scheduled_at: next.toISOString(), members: [], checklist: [], attachments: [] },
      announcements: { pinned: false }
    })[kind] || {};
  }
  const mediaUrls = (kind, row) => {
    const c = ENT[kind], out = [];
    (c.media || []).forEach((k) => row[k] && out.push(row[k]));
    (c.files || []).forEach((k) => (row[k] || []).forEach((a) => a.url && out.push(a.url)));
    return out;
  };

  function openEntityForm(kind, id, extra) {
    const row = id ? S.data[kind].find((r) => r.id === id) : null;
    if (id && !row) return toast('That item no longer exists', 'err');
    HT.openForm({
      title: (id ? 'Edit ' : 'New ') + ENT[kind].label,
      fields: fieldsFor(kind),
      values: row || defaultsFor(kind),
      onSubmit: async (vals) => {
        const q = id ? db().from(kind).update(vals).eq('id', id) : db().from(kind).insert({ ...vals, ...(extra || {}) });
        const { error } = await q;
        if (error) throw error;
        await HT.refresh(kind, 'activity');
      }
    });
  }
  async function patch(kind, id, vals, msg) {
    const { error } = await db().from(kind).update(vals).eq('id', id);
    if (error) throw error;
    await HT.refresh(kind, 'activity');
    if (msg) toast(msg);
  }
  const rowOf = (kind, id) => S.data[kind].find((r) => r.id === id);
  HT.openEntityForm = openEntityForm;

  Object.assign(HT.actions, {
    newEntity: (d) => openEntityForm(d.kind, null),
    editEntity: (d) => openEntityForm(d.kind, d.id),
    deleteEntity: async (d) => {
      const row = rowOf(d.kind, d.id);
      if (!row) return;
      if (!(await HT.confirmDialog(`Permanently delete "${ENT[d.kind].name(row)}"? This cannot be undone.`))) return;
      const { error } = await db().from(d.kind).delete().eq('id', d.id);
      if (error) throw error;
      HT.removeMedia(mediaUrls(d.kind, row));
      await HT.refresh(d.kind, 'activity');
      toast('Deleted');
    },
    retry: async (d) => { await HT.refresh(d.t); },
    setUi: (d) => { S.ui[d.k] = d.v === 'true' ? true : d.v === 'false' ? false : d.v; HT.renderView(); },
    pinToggle: (d) => patch('announcements', d.id, { pinned: !rowOf('announcements', d.id).pinned }),
    toggleArchive: (d) => { const p = rowOf('projects', d.id); return patch('projects', d.id, { archived: !p.archived }, p.archived ? 'Project restored' : 'Project archived'); },
    addUpdate: (d) => {
      HT.openForm({
        title: 'Post project update', fields: [{ name: 'text', label: 'Update', type: 'textarea', required: true }],
        onSubmit: async (v) => {
          const p = rowOf('projects', d.id);
          await patch('projects', d.id, { updates: [...(p.updates || []), { text: v.text, at: new Date().toISOString(), by: S.me.display_name }] });
        }
      });
    },
    lineState: (d) => patch('assembly_lines', d.id, { status: d.state }, 'Line ' + d.state),
    lineCount: (d) => {
      const l = rowOf('assembly_lines', d.id);
      HT.openForm({
        title: `Update output: ${l.name}`, fields: [{ name: 'current', label: `Current quantity (target ${l.target})`, type: 'number', min: 0 }], values: { current: l.current },
        onSubmit: (v) => patch('assembly_lines', d.id, { current: v.current })
      });
    },
    raidReschedule: (d) => {
      const r = rowOf('raids', d.id);
      HT.openForm({
        title: `Reschedule: ${r.name}`, fields: [{ name: 'scheduled_at', label: 'New date and time', type: 'datetime', required: true }], values: { scheduled_at: r.scheduled_at },
        onSubmit: (v) => patch('raids', d.id, { scheduled_at: v.scheduled_at, status: r.status === 'cancelled' ? 'planned' : r.status })
      });
    },
    raidStatus: async (d) => {
      if (d.status === 'cancelled' && !(await HT.confirmDialog('Cancel this operation?', 'Cancel operation'))) return;
      return patch('raids', d.id, { status: d.status }, 'Operation ' + d.status);
    },
    toggleCheck: async (d, el) => {
      const r = rowOf('raids', d.id);
      const list = (r.checklist || []).map((c, i) => (i === Number(d.i) ? { ...c, done: el.checked } : c));
      await patch('raids', d.id, { checklist: list });
    },
    lightbox: (d) => {
      const it = rowOf('showcase_items', d.id);
      if (it) HT.openModal(`<div class="lightbox"><img src="${esc(safeUrl(it.image_url))}" alt=""><h3>${esc(it.title)}</h3>${it.category ? `<span class="chip">${esc(it.category)}</span>` : ''}<p>${nl(it.description)}</p><div class="form-actions"><button class="btn" data-action="closeModal">Close</button></div></div>`, 'wide');
    },
    editSection: (d) => HT.editSection(d.id),
    newItem: (d) => {
      const items = S.data.section_items.filter((i) => i.section_id === d.id);
      openEntityForm('section_items', null, { section_id: d.id, position: items.length ? Math.max(...items.map((i) => i.position)) + 1 : 0 });
    }
  });

  // ------------------------------------------------------------ dashboard
  function dashCard(title, link, body) {
    return `<section class="panel"><div class="panel-head"><h2>${esc(title)}</h2>${link ? `<a href="#/${link}" class="more">View all →</a>` : ''}</div>${body}</section>`;
  }
  HT.views.dashboard = function (sec) {
    const W = Object.assign({ announcements: true, projects: true, assembly: true, raids: true, messages: true, activity: true, links: true }, setting('dash_widgets', {}));
    const n = Math.max(1, Number(setting('dash_count', 4)) || 4);
    const live = (k) => HT.visibleSections().some((s) => s.key === k);
    const anns = [...S.data.announcements].sort((a, b) => (b.pinned - a.pinned) || (new Date(b.created_at) - new Date(a.created_at)));
    const projs = S.data.projects.filter((p) => p.status === 'active' && !p.archived);
    const lines = S.data.assembly_lines;
    const raids = S.data.raids.filter((r) => ['planned', 'upcoming', 'active'].includes(r.status) && (r.status === 'active' || new Date(r.scheduled_at) > Date.now() - 6 * 3600e3));
    const msgs = S.data.messages.slice(-n).reverse();
    const stat = (v, l) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
    const cards = [];
    if (W.announcements && live('announcements')) cards.push(dashCard('Announcements', 'announcements', S.errors.announcements ? errorCard('announcements') : anns.length ? anns.slice(0, n).map((a) => `<div class="row"><div><b>${a.pinned ? '📌 ' : ''}${esc(a.title)}</b><small class="muted">${esc(a.author_name)} · ${ago(a.created_at)}</small></div></div>`).join('') : empty('◉', 'No announcements')));
    if (W.projects && live('projects')) cards.push(dashCard('Active projects', 'projects', S.errors.projects ? errorCard('projects') : projs.length ? projs.slice(0, n).map((p) => `<div class="row col"><div class="row-between"><b>${esc(p.name)}</b><span class="muted">${p.progress}%</span></div>${bar(p.progress)}</div>`).join('') : empty('⚑', 'No active projects')));
    if (W.assembly && live('assembly')) cards.push(dashCard('Assembly lines', 'assembly', S.errors.assembly_lines ? errorCard('assembly_lines') : lines.length ? lines.slice(0, n + 2).map((l) => { const pct = l.target > 0 ? Math.round((l.current / l.target) * 100) : 0; return `<div class="row col"><div class="row-between"><b>${esc(l.name)}</b>${badge(l.status)}</div>${bar(pct, 'st-' + l.status)}<small class="muted">${l.current} / ${l.target} (${pct}%) ${esc(l.items)}</small></div>`; }).join('') : empty('⚙', 'No assembly lines')));
    if (W.raids && live('raids')) cards.push(dashCard('Upcoming operations', 'raids', S.errors.raids ? errorCard('raids') : raids.length ? raids.slice(0, n).map((r) => `<div class="row"><div><b>${esc(r.name)}</b><small class="muted">${fmtDT(r.scheduled_at)} · ${ago(r.scheduled_at)}</small></div>${badge(r.status)}</div>`).join('') : empty('✦', 'No operations planned')));
    if (W.messages && live('messages')) cards.push(dashCard('Recent messages', 'messages', S.errors.messages ? errorCard('messages') : msgs.length ? msgs.map((m) => `<div class="row"><div><b>${esc(m.sender_name)}</b> <small class="muted">${ago(m.created_at)}</small><div class="clip">${esc(m.body)}</div></div></div>`).join('') : empty('✉', 'No messages yet')));
    if (W.activity) cards.push(dashCard('Activity', null, S.errors.activity ? errorCard('activity') : S.data.activity.length ? S.data.activity.slice(0, n + 4).map((a) => `<div class="row"><div>${esc(a.message)}<small class="muted">${esc(a.actor_name)} · ${ago(a.created_at)}</small></div></div>`).join('') : empty('◔', 'No activity yet')));
    const links = HT.visibleSections().filter((s) => s.key !== 'dashboard');
    const linkHtml = W.links ? `<section class="panel wide"><div class="panel-head"><h2>Quick links</h2></div><div class="tiles">${links.map((s) => `<a class="tile" href="#/${esc(s.key)}"><span class="ico">${HT.icon(s)}</span>${esc(s.title)}</a>`).join('')}${isAdmin() ? '<a class="tile" href="#/admin"><span class="ico">⛨</span>Admin Panel</a>' : ''}</div></section>` : '';
    return `${head(sec, isAdmin() ? '<button class="btn sm" data-action="customizeDash">Customize dashboard</button>' : '')}
      <section class="hero"><div><small class="kicker">WELCOME BACK</small><h2>Welcome, ${esc(S.me.display_name)}</h2><p>${nl(setting('welcome_message', ''))}</p></div>
      <div class="stats">${stat(S.data.projects.filter((p) => p.status === 'active' && !p.archived).length, 'Active projects')}${stat(lines.filter((l) => l.status === 'running').length, 'Lines running')}${stat(raids.length, 'Operations ahead')}${stat(S.profiles.length, 'Members')}</div></section>
      <div class="grid">${cards.join('')}${linkHtml}</div>`;
  };
  HT.actions.customizeDash = () => { S.ui.adminTab = 'settings'; location.hash = '#/admin'; };

  // ------------------------------------------------------------ showcase
  HT.views.showcase = function (sec) {
    return head(sec, addBtn('showcase_items', 'Add picture')) + needs(['showcase_items'], () => {
      const items = S.data.showcase_items;
      const cats = [...new Set(items.map((i) => i.category).filter(Boolean))].sort();
      if (S.ui.showcaseCat && !cats.includes(S.ui.showcaseCat)) S.ui.showcaseCat = '';
      const shown = S.ui.showcaseCat ? items.filter((i) => i.category === S.ui.showcaseCat) : items;
      const chips = cats.length ? `<div class="chips-row"><button class="chip-btn ${!S.ui.showcaseCat ? 'active' : ''}" data-action="setUi" data-k="showcaseCat" data-v="">All</button>${cats.map((c) => `<button class="chip-btn ${S.ui.showcaseCat === c ? 'active' : ''}" data-action="setUi" data-k="showcaseCat" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : '';
      if (!items.length) return empty('▣', 'The showcase is empty.', isAdmin() ? 'Use "Add picture" to upload the first entry.' : 'An administrator has not added any pictures yet.');
      return chips + `<div class="gallery">${shown.map((i) => `<figure class="fig"><button class="fig-img" data-action="lightbox" data-id="${i.id}"><img src="${esc(safeUrl(i.image_url))}" alt="${esc(i.title)}" loading="lazy"></button><figcaption><b>${esc(i.title)}</b>${i.category ? `<span class="chip">${esc(i.category)}</span>` : ''}<p>${nl(i.description)}</p>${adminRow('showcase_items', i.id)}</figcaption></figure>`).join('')}</div>`;
    });
  };

  // ------------------------------------------------------------ projects
  HT.views.projects = function (sec) {
    const filt = `<select data-change="uiSelect" data-k="projFilter">${['all', ...PROJECT_STATUS].map((s) => `<option value="${s}" ${S.ui.projFilter === s ? 'selected' : ''}>${s === 'all' ? 'All statuses' : cap(s)}</option>`).join('')}</select>`;
    const tabs = `<div class="chips-row"><button class="chip-btn ${!S.ui.projArchived ? 'active' : ''}" data-action="setUi" data-k="projArchived" data-v="false">Current</button><button class="chip-btn ${S.ui.projArchived ? 'active' : ''}" data-action="setUi" data-k="projArchived" data-v="true">Archived</button>${filt}</div>`;
    return head(sec, addBtn('projects', 'New project')) + needs(['projects'], () => {
      const list = S.data.projects.filter((p) => !!p.archived === S.ui.projArchived && (S.ui.projFilter === 'all' || p.status === S.ui.projFilter));
      if (!list.length) return tabs + empty('⚑', S.ui.projArchived ? 'No archived projects.' : 'No projects match.', isAdmin() ? 'Create one with "New project".' : '');
      return tabs + `<div class="cards">${list.map((p) => `<article class="card">${img(p.cover_url)}<div class="card-body">
        <div class="row-between"><h3>${esc(p.name)}</h3><span>${badge(p.status)} <span class="badge pr-${esc(p.priority)}">${esc(p.priority)}</span></span></div>
        <p>${nl(p.description)}</p>
        <div class="row-between"><small class="muted">Progress</small><b>${p.progress}%</b></div>${bar(p.progress)}
        <div class="kv"><span>Team</span><div>${members(p.members)}</div></div>
        <div class="kv"><span>Dates</span><div>${fmtDay(p.start_date)} → ${fmtDay(p.target_date)}</div></div>
        ${p.notes ? `<div class="kv"><span>Notes</span><div>${nl(p.notes)}</div></div>` : ''}
        ${(p.updates || []).length ? `<div class="updates"><small class="kicker">LATEST UPDATES</small>${(p.updates || []).slice(-3).reverse().map((u) => `<div><small class="muted">${esc(u.by)} · ${ago(u.at)}</small><br>${nl(u.text)}</div>`).join('')}</div>` : ''}
        <small class="muted">Created ${fmtDT(p.created_at)} · Updated ${fmtDT(p.updated_at)}</small>
        ${adminRow('projects', p.id, `<button class="btn sm" data-action="addUpdate" data-id="${p.id}">Add update</button><button class="btn sm" data-action="toggleArchive" data-id="${p.id}">${p.archived ? 'Restore' : 'Archive'}</button>`)}
      </div></article>`).join('')}</div>`;
    });
  };
  HT.changes.uiSelect = (d, el) => { S.ui[d.k] = el.value; HT.renderView(); };

  // ------------------------------------------------------------ assembly lines
  HT.views.assembly = function (sec) {
    return head(sec, addBtn('assembly_lines', 'New assembly line')) + needs(['assembly_lines'], () => {
      const list = S.data.assembly_lines;
      if (!list.length) return empty('⚙', 'No assembly lines yet.', isAdmin() ? 'Create one with "New assembly line".' : '');
      return `<div class="cards">${list.map((l) => {
        const pct = l.target > 0 ? Math.min(100, Math.round((l.current / l.target) * 100)) : 0;
        const ctl = l.status === 'running' ? `<button class="btn sm" data-action="lineState" data-id="${l.id}" data-state="paused">Pause</button>` : `<button class="btn sm" data-action="lineState" data-id="${l.id}" data-state="running">Restart</button>`;
        return `<article class="card">${img(l.image_url)}<div class="card-body">
          <div class="row-between"><h3>${esc(l.name)}</h3>${badge(l.status)}</div>
          <p>${nl(l.description)}</p>
          ${l.items ? `<div class="kv"><span>Assembling</span><div>${esc(l.items)}</div></div>` : ''}
          <div class="row-between"><small class="muted">Output</small><b>${l.current} / ${l.target} <span class="muted">(${pct}%)</span></b></div>${bar(pct, 'st-' + l.status)}
          <div class="kv"><span>Crew</span><div>${members(l.members)}</div></div>
          ${l.notes ? `<div class="kv"><span>Notes</span><div>${nl(l.notes)}</div></div>` : ''}
          <small class="muted">Last updated ${fmtDT(l.updated_at)}</small>
          ${adminRow('assembly_lines', l.id, `${ctl}<button class="btn sm" data-action="lineCount" data-id="${l.id}">Update count</button>`)}
        </div></article>`;
      }).join('')}</div>`;
    });
  };

  // ------------------------------------------------------------ raids
  HT.views.raids = function (sec) {
    const tabDef = [['upcoming', 'Upcoming'], ['past', 'Completed / cancelled'], ['all', 'All']];
    const tabs = `<div class="chips-row">${tabDef.map(([k, l]) => `<button class="chip-btn ${S.ui.raidTab === k ? 'active' : ''}" data-action="setUi" data-k="raidTab" data-v="${k}">${l}</button>`).join('')}</div>`;
    return head(sec, addBtn('raids', 'New operation')) + needs(['raids'], () => {
      let list = S.data.raids;
      if (S.ui.raidTab === 'upcoming') list = list.filter((r) => ['planned', 'upcoming', 'active'].includes(r.status));
      if (S.ui.raidTab === 'past') list = list.filter((r) => ['completed', 'cancelled'].includes(r.status)).reverse();
      if (!list.length) return tabs + empty('✦', 'No operations in this view.', isAdmin() ? 'Plan one with "New operation".' : '');
      return tabs + `<div class="cards">${list.map((r) => {
        const atts = r.attachments || [];
        const open = ['planned', 'upcoming', 'active'].includes(r.status);
        const ctl = `<button class="btn sm" data-action="raidReschedule" data-id="${r.id}">Reschedule</button>${open ? `<button class="btn sm" data-action="raidStatus" data-id="${r.id}" data-status="completed">Complete</button><button class="btn sm" data-action="raidStatus" data-id="${r.id}" data-status="cancelled">Cancel</button>` : ''}`;
        return `<article class="card"><div class="card-body">
          <div class="row-between"><h3>${esc(r.name)}</h3>${badge(r.status)}</div>
          <div class="when">▸ ${fmtDT(r.scheduled_at)} <small class="muted">(${ago(r.scheduled_at)})</small></div>
          ${r.objective ? `<div class="kv"><span>Objective</span><div><b>${esc(r.objective)}</b></div></div>` : ''}
          ${r.description ? `<p>${nl(r.description)}</p>` : ''}
          ${r.squad ? `<div class="kv"><span>Squad</span><div>${esc(r.squad)}</div></div>` : ''}
          <div class="kv"><span>Members</span><div>${members(r.members)}</div></div>
          ${r.briefing ? `<div class="kv"><span>Briefing</span><div>${nl(r.briefing)}</div></div>` : ''}
          ${(r.checklist || []).length ? `<div class="kv"><span>Checklist</span><ul class="check">${r.checklist.map((c, i) => `<li><label><input type="checkbox" data-action="toggleCheck" data-id="${r.id}" data-i="${i}" ${c.done ? 'checked' : ''} ${isAdmin() ? '' : 'disabled'}> <span class="${c.done ? 'done' : ''}">${esc(c.text)}</span></label></li>`).join('')}</ul></div>` : ''}
          ${r.notes ? `<div class="kv"><span>Notes</span><div>${nl(r.notes)}</div></div>` : ''}
          ${atts.length ? `<div class="kv"><span>Files</span><div class="atts">${atts.map((a) => (/^image\//.test(a.type || '') ? `<a href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener"><img src="${esc(safeUrl(a.url))}" alt="${esc(a.name)}" loading="lazy"></a>` : `<a class="chip" href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener">📎 ${esc(a.name)}</a>`)).join('')}</div></div>` : ''}
          <small class="muted">Created ${fmtDT(r.created_at)} · Updated ${fmtDT(r.updated_at)}</small>
          ${adminRow('raids', r.id, ctl)}
        </div></article>`;
      }).join('')}</div>`;
    });
  };

  // ------------------------------------------------------------ announcements
  HT.views.announcements = function (sec) {
    return head(sec, addBtn('announcements', 'New announcement')) + needs(['announcements'], () => {
      const list = [...S.data.announcements].sort((a, b) => (b.pinned - a.pinned) || (new Date(b.created_at) - new Date(a.created_at)));
      if (!list.length) return empty('◉', 'No announcements yet.', isAdmin() ? 'Post the first one with "New announcement".' : '');
      return `<div class="stack">${list.map((a) => `<article class="card ann ${a.pinned ? 'pinned' : ''}">${img(a.image_url, 'cover wide')}<div class="card-body">
        <div class="row-between"><h3>${a.pinned ? '📌 ' : ''}${esc(a.title)}</h3>${a.pinned ? '<span class="badge st-active">pinned</span>' : ''}</div>
        <small class="muted">By ${esc(a.author_name || 'Admin')} · ${fmtDT(a.created_at)}${a.updated_at && a.updated_at !== a.created_at && new Date(a.updated_at) - new Date(a.created_at) > 5000 ? ' (edited)' : ''}</small>
        <p>${nl(a.body)}</p>
        ${adminRow('announcements', a.id, `<button class="btn sm" data-action="pinToggle" data-id="${a.id}">${a.pinned ? 'Unpin' : 'Pin'}</button>`)}
      </div></article>`).join('')}</div>`;
    });
  };

  // ------------------------------------------------------------ chat
  const initials = (n) => esc((n || '?').trim().slice(0, 1).toUpperCase());
  HT.views.messages = function (sec) {
    return head(sec, '') + `<section class="panel chat"><div class="chat-head"><b># team-chat</b><span class="live-wrap"><i class="live-dot ${S.live ? 'on' : ''}"></i><span class="live-label">${S.live ? 'LIVE' : 'OFFLINE'}</span></span></div><div id="chatlist" class="chat-list"></div><form id="chatform" data-form="chat" class="chat-form"><textarea id="chatinput" rows="1" maxlength="2000" placeholder="Message the team… (Enter to send, Shift+Enter for new line)" aria-label="Message"></textarea><button class="btn primary" type="submit">Send</button></form></section>`;
  };
  HT.afterRender.messages = function (force) {
    const el = HT.$('#chatlist');
    if (!el) return;
    if (S.errors.messages) { el.innerHTML = errorCard('messages'); return; }
    const msgs = S.data.messages;
    if (!msgs.length) { el.innerHTML = empty('✉', 'No messages yet.', 'Send the first message to the team.'); return; }
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
    el.innerHTML = msgs.map((m) => {
      const mine = m.user_id === S.user.id, p = S.profiles.find((x) => x.id === m.user_id);
      const del = isAdmin() || mine ? `<button class="x-btn" data-action="deleteMessage" data-id="${m.id}" title="Delete message">✕</button>` : '';
      return `<div class="msg ${mine ? 'mine' : ''}"><span class="avatar">${initials(m.sender_name)}</span><div class="bubble"><div class="meta"><b>${esc(m.sender_name)}</b>${p && p.role === 'admin' ? '<span class="badge admin">ADMIN</span>' : ''}<small class="muted">${fmtDT(m.created_at)}</small>${del}</div><div class="text">${nl(m.body)}</div></div></div>`;
    }).join('');
    if (force || near) el.scrollTop = el.scrollHeight;
  };
  HT.forms.chat = async function (f) {
    const ta = f.querySelector('textarea'), body = ta.value.trim();
    if (!body) return;
    ta.disabled = true;
    const { data, error } = await db().from('messages').insert({ body }).select().single();
    ta.disabled = false;
    if (error) { toast('Message not sent: ' + error.message, 'err'); return; }
    ta.value = ''; ta.focus();
    if (data && !S.data.messages.some((m) => m.id === data.id)) S.data.messages.push(data);
    HT.afterRender.messages(true);
  };
  HT.actions.deleteMessage = async (d) => {
    if (!(await HT.confirmDialog('Delete this message for everyone?'))) return;
    const { error } = await db().from('messages').delete().eq('id', d.id);
    if (error) throw error;
    S.data.messages = S.data.messages.filter((m) => m.id !== d.id);
    HT.afterRender.messages(false);
    toast('Message deleted');
  };

  // ------------------------------------------------------------ custom pages
  HT.views.page = function (sec) {
    const addI = isAdmin() ? `<button class="btn primary" data-action="newItem" data-id="${sec.id}">+ Add item</button>` : '';
    return head(sec, addI) + needs(['section_items'], () => {
      const items = S.data.section_items.filter((i) => i.section_id === sec.id);
      if (!items.length) return empty('❖', 'This section is empty.', isAdmin() ? 'Use "Add item" to add content.' : '');
      return `<div class="cards">${items.map((i) => `<article class="card">${img(i.image_url)}<div class="card-body"><h3>${esc(i.title)}</h3><p>${nl(i.body)}</p>${adminRow('section_items', i.id)}</div></article>`).join('')}</div>`;
    });
  };
})();
