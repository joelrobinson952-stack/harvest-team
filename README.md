# Harvest Team Hub

A dark tactical team hub (dashboard, showcase, projects, assembly lines, raid planning, announcements, live chat, admin panel) that runs as a **static site on GitHub Pages** with **Supabase** as the shared backend (auth, database, realtime, image storage).

```
index.html          app shell
css/style.css       tactical theme (responsive)
js/config.js        <- your Supabase URL + anon key go here
js/core.js          auth, data loading, realtime, modal/form engine
js/views.js         dashboard, showcase, projects, assembly, raids, announcements, chat
js/admin.js         Admin Control Panel (sections, settings, users, moderation, backup)
sql/schema.sql      tables, RLS policies, triggers, storage bucket, realtime, seed data
```

Everything uses relative paths, so it works from `https://<user>.github.io/<repo>/`.

## 1. Create the Supabase project
1. Sign in at <https://supabase.com> and create a new project.
2. **Before running the SQL**, open `sql/schema.sql`, scroll to *7. ADMIN BOOTSTRAP* and replace the three placeholder e-mails with the real e-mail address each initial admin (**JXELR**, **wattsomc**, **sp0tted_**) will register with.
3. Open **SQL Editor → New query**, paste the whole file and press **Run**. It is safe to re-run.

## 2. Configure authentication
In **Authentication**:
- **Providers → Email**: enabled, and keep **Confirm email** ON (this is what stops someone claiming an admin username).
- **URL Configuration**: set **Site URL** to your GitHub Pages address (e.g. `https://yourname.github.io/harvest-team/`) and add the same URL under **Redirect URLs**. (Use `http://localhost:8000/` too if you test locally.)

## 3. Connect the website
Supabase → **Project Settings → API**. Copy the **Project URL** and the **anon / public** key into `js/config.js`.
The anon key is meant to be public. Security comes from Row Level Security. **Never** put the `service_role` key in the repo.

## 4. Deploy to GitHub Pages
1. Create a repository and upload all files (keep the folder structure).
2. **Settings → Pages → Build and deployment**: Source = *Deploy from a branch*, Branch = `main` / root.
3. Open the published URL.

## 5. Create the administrators
Each initial admin opens the site → **Register** with the exact username (`JXELR`, `wattsomc`, `sp0tted_`) and the e-mail you put in the SQL → confirms the e-mail → signs in. They are admin automatically and the **Admin Control Panel** appears in the navigation.

Fallbacks:
- Already registered with another e-mail? Run in the SQL editor: `select public.make_admin('their@email.com');`
- Once you have one admin, they can promote or demote others in **Admin Control Panel → Users & admins**.

## How security works
- Signed-in users can **read** everything; only users whose `profiles.role = 'admin'` can **write** content, sections, settings or upload files (enforced by RLS + storage policies, not by the browser).
- A database trigger stops anyone changing their own role or username, and stops the last admin being removed.
- Admin status is **not** granted by username alone: the pre-approved username must also match the pre-approved e-mail, and e-mail confirmation is required to sign in.
- Chat sender names and announcement authors are filled in by database triggers, so they cannot be spoofed from the browser.
- Members can post chat messages and delete their own; admins can delete any.
- Uploaded pictures live in a **public** storage bucket (`media`): anyone with a direct image URL can view it, but only admins can upload or delete.

## Features checklist
Dashboard (welcome, announcements, projects, assembly lines, upcoming raids, recent chat, activity, quick links, customisable widgets) · Showcase (starts empty, categories, upload/edit/delete) · Projects (status, priority, members, dates, progress, notes + update log, archive) · Assembly lines (pause/restart, targets, output counter) · Raid planning (briefing, checklist, attachments, reschedule/cancel/complete) · Announcements (pinned, images) · Realtime team chat with moderation · User & admin management · Section manager (add, rename, describe, reorder, hide, delete) · Site settings · JSON export/import · Confirmation prompts on destructive actions.

There is no "Section 04" anywhere: the navigation only contains the sections in the `sections` table, and none are seeded with that name or number.

## Notes & limits
- Login is by **e-mail + password** (usernames are display identities). Logging in by username would expose accounts' e-mails to anonymous visitors.
- Deleting an account completely is done in Supabase → Authentication → Users.
- Image uploads: PNG, JPEG, GIF, WebP, plus PDF attachments on operations, 10 MB each.
- If the header shows **OFFLINE**, realtime isn't connected; changes still save and appear after the next action or refresh. Check that the realtime section of `schema.sql` ran.
- Local testing: `python3 -m http.server 8000` in this folder, then open `http://localhost:8000`.
