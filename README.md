# Ka Alala — Admin Panel

Next.js 15 admin portal for the Ka Alala language-learning app. Talks to the
**same Supabase project** as the mobile app, using the service-role key on the
server only — mobile RLS/anti-cheat rules stay untouched.

## Features

- **Dashboard** — live stats: users, chapters, lessons, quiz questions, completions, badges awarded, posts, XP earned today
- **Learning Path builder** — create/edit/reorder/delete chapters and lessons (video, audio, quiz), upload media straight to Supabase Storage or paste a URL
- **Quiz builder** — questions with A–D options and the correct answer, matching the mobile app's format exactly
- **Badges** — XP-tier badges with icon upload, activate/deactivate; one badge per XP tier, enforced on create *and* edit
- **Users** — paginated list (25/page), search, view stats/earned badges, manually award badges
- **Community** — triage posts users flagged, hide/restore them, or delete permanently
- **Subscriptions** — read-only overview; per-user plan/status/expiry also shown read-only on the user page
- **Admin Accounts** — role-based access control with multiple admins
- **Password reset** — self-service "Forgot password?" on the login page, via a 6-digit emailed code
- **Pending feedback everywhere** — every button spins and locks while its action
  runs, links spin while the next page loads, and route changes show a skeleton

## Roles

| Role | Access |
|---|---|
| `super_admin` | Everything, incl. admin management |
| `content_manager` | Dashboard + Learning Path + Badges + Quiz builder |
| `support` | Dashboard + Users + Community + Subscriptions (all subscription info is read-only) |

## Setup

### 1. Run the database migration

In the Supabase SQL Editor, run the mobile repo's
`supabase/migrations/20260814001500_admin_panel.sql`
(creates `admin_users`, `subscriptions`, the `promote_admin` helper, and the
`chapter_video` / `chapter_audio` / `badge_url` storage buckets).
All earlier migrations (`20240101000000` … `20260814001400`) must already be in.

### 2. Create your first super admin

The account must already exist in Supabase Auth (sign up in the mobile app
first), then in the SQL Editor:

```sql
select promote_admin('you@example.com', 'super_admin');
```

Further admins can then be added from the panel's **Admin Accounts** page —
that page can also create brand-new auth accounts.

### 3. Environment variables

Copy `.env.example` to `.env.local` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=...        # same as the mobile app
NEXT_PUBLIC_SUPABASE_ANON_KEY=...   # same as the mobile app
SUPABASE_SERVICE_ROLE_KEY=...       # Supabase Dashboard → Settings → API → service_role
NEXT_PUBLIC_SITE_URL=...            # optional; this panel's public URL (production only)
```

> ⚠️ The **service-role key bypasses RLS**. It is only ever read on the server
> (`src/lib/supabase/admin.ts` imports `server-only`). Never commit it, never
> expose it to the browser, and never put it in the mobile app.

### 4. Run

```bash
npm install
npm run dev      # http://localhost:3000 → redirects to /login
```

Production:

```bash
npm run build && npm start
```

## How access control works

- `middleware.ts` keeps the Supabase session cookie fresh and forces `/login` for anonymous visitors — except on `/login`, `/forgot-password` and `/auth/*`, which must work signed out.
- Every page/action calls `requireAdmin()` — signed-in users **not** in `admin_users` are signed out and rejected.
- `requireRole(area)` gates each area per the table above (`src/lib/auth.ts` → `AREA_ROLES`).
- All DB writes go through the service-role client inside server actions; nothing is exposed to the browser.

## Community moderation

Run `supabase/migrations/20260901000100_community_moderation.sql` from the mobile
repo first — it adds `post_reports`, the `hidden_at` / `hidden_by` columns on
`posts`, and rebuilds `posts_feed_view` to skip hidden posts.

The **Community** page has three tabs:

| Tab | What's in it |
|---|---|
| Flagged | Posts with open reports, most-reported first, with each reason and note |
| All posts | Visible posts, newest first |
| Hidden | Everything a moderator has hidden, with a Restore button |

All three paginate at 20 per page; switching tabs resets to page 1. The Flagged
tab orders by report count, which lives in `post_reports` rather than on the post
— so it sorts and slices the id list first, then fetches only that page's posts.

Four actions, all service-role writes:

- **Hide post** — sets `hidden_at`/`hidden_by` (+ an optional internal reason) and
  closes the post's open reports as `actioned`. The post vanishes from the app but
  the row survives, so this is reversible and leaves a record.
- **Restore to feed** — clears those columns.
- **Dismiss reports** — closes the reports as `dismissed`, post untouched.
- **Delete permanently** — no undo; likes, comments, pins and reports all cascade away.

Hiding is enforced in two places: `posts_feed_view` filters `hidden_at is null`,
and the `posts` SELECT policy does too — so a hidden post is gone even for a
client querying the table directly.

In the app, every post that isn't yours gets a **Report** action (feed and post
detail) with a reason picker and an optional note. `(post_id, reporter_id)` is
unique, so reporting twice is a no-op rather than a louder signal, and RLS blocks
reporting your own post.

## Password resets

Self-service, using a **6-digit code** emailed to the admin — no link to click.

### One-time Supabase setup

**1. Put the code in the email.** Dashboard → Authentication → **Emails** →
**Reset Password** template. The stock template only renders a link, so add the
token — this is what makes the whole flow work:

```html
<h2>Reset your Ka Alala Admin password</h2>
<p>Enter this code in the admin panel:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
<p>It expires in about an hour. If you didn't ask for it, ignore this email.</p>
```

**2. (Optional) Keep the link working too.** If you leave `{{ .ConfirmationURL }}`
in the template as well, clicking it still works via `/auth/callback` — but then
add `http://localhost:3000/**` and your production URL under Authentication →
**URL Configuration → Redirect URLs**. Code-only templates need no allow-list.

### The flow

1. **Forgot password?** → `/forgot-password` → enter the admin email.
2. `requestPasswordReset` checks the email is in `admin_users`, then calls
   `resetPasswordForEmail`. Same page comes back in code-entry mode.
3. Enter the 6 digits → `verifyResetCode` calls
   `verifyOtp({ type: 'recovery' })`, which creates the session.
4. `/reset-password` sets the new password, signs out, and returns to `/login`.

### Two things worth knowing

- **Non-admin emails get no email, and the page says the same thing either way.**
  This panel shares its Supabase project with the mobile app, so the
  `admin_users` check stops it emailing ordinary app users — and the identical
  wording stops the form being used to discover who the admins are. A valid
  recovery code for a non-admin account is re-checked in `verifyResetCode` and
  signed straight back out.
- **Unlike the link flow, the code can be entered in any browser** — there is no
  PKCE cookie to match, so requesting on desktop and reading the mail on a phone
  is fine.

If mail never arrives, it is almost always Supabase's built-in SMTP hourly limit
(2/hour on free projects) — configure your own SMTP under Authentication →
Emails for anything beyond light use.

## Pending / loading feedback

Server actions and `force-dynamic` pages both leave a gap between the click and
the result, so three things fill it:

- `components/SubmitButton.tsx` — `useFormStatus()` spinner on every form
  button. It also **disables the button while pending**, which is what stops a
  double-click creating two lessons.
- `components/PendingLink.tsx` / `NavLink.tsx` — `useLinkStatus()` spinner on
  links that navigate, plus the active-section highlight in the sidebar.
- `app/(admin)/loading.tsx` — skeleton shown for every admin route the moment a
  navigation starts. The sidebar stays put; only the main pane swaps.

`SubmitButton` must stay its own component: `useFormStatus` reads the nearest
parent `<form>`, so it returns nothing if it is called in the same component
that renders the form.

## Performance notes

Every Supabase round trip from this panel costs roughly the same latency
(~250ms) whatever it returns — the data is small, the network isn't. So the
thing worth optimising is the number of *sequential* round trips, not the
queries themselves.

- `requireAdmin()` is wrapped in React's `cache()`. The layout and the page both
  call it in one request; without the cache every page load paid for two
  `auth.getUser()` calls and two `admin_users` lookups.
- The dashboard issues its queries in two parallel waves instead of four
  sequential ones — only the two profile queries actually need the admin ids.
- Lists that used to fetch a related table separately now embed it:
  `profiles → subscriptions`, `posts → profiles` (author), `chapters → lessons`.
  Each one is a unique/plain FK, so PostgREST resolves it in the same request.

Measured against the live project: dashboard 1598ms → 517ms, users list 464ms →
236ms, chapter detail 473ms → 231ms, plus ~600ms off *every* page from the
cached auth check.

One caveat on the embeds: without generated DB types, supabase-js types every
embedded relation as an array, while PostgREST sends a single object for a
to-one. The call sites normalise both shapes rather than asserting either.

## Media uploads

- Video lessons → `chapter_video` bucket, audio lessons → `chapter_audio`, badge icons → `badge_url`.
- Files are stored at `{chapterId}/{timestamp}.{ext}` and the public URL is saved on the row — the mobile app reads `media_url` / `icon_url` directly.
- You can also paste an already-hosted `https://` URL instead of uploading.
- Upload limit is set to 500 MB (`next.config.ts` → `serverActions.bodySizeLimit`).
