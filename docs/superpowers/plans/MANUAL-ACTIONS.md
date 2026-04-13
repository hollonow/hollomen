# HolloEngine — Manual Actions Required
> Things YOU need to do in external dashboards, terminals, and DNS providers.
> Ordered by dependency — complete top to bottom.
> Last updated: 2026-04-13 (session 5)

---

## Progress Tracker

| Step | Action | Status |
|------|--------|--------|
| 0 | Client meeting — collect credentials | ✅ |
| 1 | Supabase schema (`FULL_MIGRATION.sql`) | ✅ |
| 1b | SQL migrations — `valid_status` constraint + `run_sessions` cost/stop columns | ✅ Done (session 5) |
| 2 | Modal secret `Hollo-men` | ✅ |
| 2b | Fix Modal secret: rename `SERPAPI_KEY` → `SERPAPI_API_KEY` | ✅ Done (session 2) |
| 3 | `modal deploy modal_agents.py` (initial) | ✅ (redeployed 2026-04-10) |
| 3b | `modal deploy modal_agents.py` (Telegram notifier) | ❌ **Needed — Python notifier code changed** |
| 4 | GitHub push (`hollonow/hollomen`) | ✅ (latest commit `ee05b49`) |
| 5 | Vercel deploy (client account) | ✅ (auto-redeploys on push) |
| 6 | DNS — CNAME for `tool.luxearchive.com` | ✅ |
| 6b | DNS — Resend TXT record | ❌ **Needed for email delivery** |
| 7 | Verify log panel + stop button | ✅ Working |
| 7d | Auth flow — invite + password reset (code) | ✅ Fixed (session 4/5) |
| 7e | Add `NEXT_PUBLIC_SITE_URL` to Vercel env vars | ✅ Already set |
| 7f | Add `https://tool.luxearchive.com/**` to Supabase Redirect URLs | ❌ **Needed — Supabase Auth → URL Configuration** |
| 7g | Test invite flow e2e (fresh invite) | ❌ Rate limited — test when cleared |
| 8 | Full smoke test (Agents 1–5 + Telegram) | ⏳ Agents 1–5 confirmed working; Telegram unverified (needs step 3b first) |

---

## STEP 1 — Supabase Schema ✅ DONE

Schema migrated. Tables created: `products`, `run_sessions`, `pipeline_logs`, `profiles`.
Admin user added and promoted via SQL.

**RLS fix applied (09/04/26):**
```sql
DROP POLICY IF EXISTS "authenticated_read_write" ON public.products;
CREATE POLICY "authenticated_read_write" ON public.products
  USING (true)
  WITH CHECK (true);
```

---

## STEP 2 — Modal Secret ✅ DONE

Secret named `Hollo-men` created on `hollomenstyle` Modal workspace.
All env vars from `.env` pasted in.

---

## STEP 2b — Fix Modal Secret `Hollo-men` ✅ DONE (session 2)

`SERPAPI_KEY` renamed to `SERPAPI_API_KEY` in Modal dashboard.
Agent 2 confirmed working after this fix.

---

## STEP 3 — Modal Deploy ✅ DONE (redeployed 2026-04-10)

All 6 agents deployed successfully to `hollomenstyle` workspace.
Endpoint URLs saved in Vercel environment variables and `ui/.env.vercel`.

**Fixes applied during original deploy:**
- Updated all 6 decorators from `@modal.web_endpoint` → `@modal.fastapi_endpoint`
- Added `fastapi>=0.100.0` to image dependencies
- Removed `config_vol` volume mount (caused crash-loop on non-empty path)

**Redeployed 2026-04-10** to pick up:
- Agent 2 `SERPAPI_KEY` → `SERPAPI_API_KEY` fix
- Agent 3 `import json` fix
- Log panel UTC timestamp fix

To redeploy after future code changes:
```bash
cd e:\Projects\Hollomen\execution
modal token set --token-id <client-token-id> --token-secret <client-token-secret>
PYTHONIOENCODING=utf-8 modal deploy modal_agents.py
```

---

## STEP 4 — GitHub ✅ DONE

- Repo: `https://github.com/hollonow/hollomen` (public, owned by client `hollonow`)
- You (`iannjenga`) are a collaborator with Write access
- Push code changes with: `git push` from `e:\Projects\Hollomen`
- Vercel auto-redeploys on every push to `main`

**Note:** Repo is public because Vercel Hobby plan doesn't support collaboration on private repos.

---

## STEP 5 — Vercel Deploy ✅ DONE

- Live at: `https://tool.luxearchive.com`
- Client account: `hollonow` on Vercel
- Root directory: `ui`
- Framework: Next.js (auto-detected)

**Environment variables set in Vercel:**
```
NEXT_PUBLIC_SUPABASE_URL=https://sedhrimkgtoumegosubc.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_RTqQHW1Zzeg0ELtV2mLCzQ_tj9xINIY
SUPABASE_SERVICE_ROLE_KEY=<set>
CLOUDINARY_CLOUD_NAME=dewbp3mcn
CLOUDINARY_API_KEY=<set>
CLOUDINARY_API_SECRET=<set>
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=dewbp3mcn
OPENAI_API_KEY=<set>
MODAL_URL_AGENT0=<set>
MODAL_URL_AGENT1=<set>
MODAL_URL_AGENT2=<set>
MODAL_URL_AGENT3=<set>
MODAL_URL_AGENT4=<set>
MODAL_URL_AGENT5=<set>
```

---

## STEP 6 — DNS Configuration

### CNAME ✅ DONE
Added at WPX Control Panel:
| Type | Name | Value |
|------|------|-------|
| CNAME | `tool` | `b67ffbb20a84346a.vercel-dns-017.com` |

`tool.luxearchive.com` is live and resolving. ✅

### Resend TXT ❌ STILL NEEDED
**Where:** WPX Control Panel → Edit DNS → luxearchive.com → Create Record

| Type | Name | Value |
|------|------|-------|
| TXT | `resend._domainkey` | Get from: resend.com → Domains → `luxearchive.com` → DNS Records |

Steps:
1. Log in to WPX → Control Panel
2. Edit DNS → `luxearchive.com`
3. Create Record → Type: TXT, Host: `resend._domainkey`, Value: (from Resend dashboard)
4. Wait 5–30 min → verify at [dnschecker.org](https://dnschecker.org)

Reference: https://wpx.net/kb/how-can-i-add-a-txt-record/

---

## STEP 7 — Remaining Issues to Fix Before Smoke Test

### 7a — Live Log Panel ✅ Fixed (commit `eed7cd1`)
Four bugs fixed in `page.tsx`:
1. `parseLogTimestamp` — added `Z` suffix support so Supabase UTC timestamps parse correctly
2. `stripLogPrefix` — regex updated from `[\d\-: ,]+` to `[\d\-: ,Z]+` so the full prefix is stripped and only the clean message is shown (e.g. `BATCH PROCESSING COMPLETE` not the raw bracketed line)
3. DONE_PATTERN / stop button — guarded with `startedAt > 0` so old log lines on page refresh can't hide the stop button while an agent is running
4. `[ERROR]`/`[CRITICAL]` lines now included in the homepage log filter

### 7b — Stop Button ✅ Fixed (commit `eed7cd1`)
Root cause confirmed: on page refresh, `agentStartedAt` resets to `{}` → `startedAt = 0` → all historical log lines included → old `BATCH PROCESSING COMPLETE` set `forcedStopped = true` → stop button hidden. Fixed by skipping DONE_PATTERN side-effect when `startedAt = 0`.

### 7c — Auth / Password
- Supabase URL config updated to `https://tool.luxearchive.com` ✅
- `/auth/callback` route created ✅
- Reset password flow should now work — test it:
  1. Go to `tool.luxearchive.com/login`
  2. Click **Forgot password?** → enter email
  3. Check inbox → click link → set password

---

## STEP 8b — Manual SQL Migrations (Run Before Smoke Test)

Run both of these in the Supabase SQL editor (`sedhrimkgtoumegosubc`):

### Fix `valid_status` constraint (blocks Agent 2)
```sql
ALTER TABLE products DROP CONSTRAINT IF EXISTS valid_status;

ALTER TABLE products ADD CONSTRAINT valid_status CHECK (status IN (
  'DISCOVERED', 'READY_FOR_SCRAPE', 'SCRAPING',
  'READY_FOR_RESEARCH', 'RESEARCHING',
  'NEEDS_REVIEW', 'READY_FOR_SEO', 'WRITING_SEO',
  'READY_FOR_PUBLISH', 'OPTIMIZING',
  'PUBLISHED', 'PUBLISHING', 'PENDING_APPROVAL', 'SCRAPPED',
  'SCRAPE_FAILED', 'RESEARCH_FAILED', 'SEO_FAILED',
  'OPTIMIZE_FAILED', 'PUBLISH_FAILED'
));
```

### Create `pipeline_configs` table (for Settings → Pipeline Config on Vercel)
```sql
CREATE TABLE IF NOT EXISTS pipeline_configs (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
```

---

## STEP 3b — Redeploy Modal Agents (Telegram Notifier) ❌ NEEDED

The Python notifier code changed in session 5 — all 5 run scripts now import from `notifiers.notifier` (Slack + Telegram unified). Modal agents run the old code until redeployed.

```bash
cd e:\Projects\Hollomen\execution
modal token set --token-id <client-token-id> --token-secret <client-token-secret>
PYTHONIOENCODING=utf-8 modal deploy modal_agents.py
```

After redeploy, Telegram messages should fire on every agent start/complete/error and when a product is flagged NEEDS_REVIEW.

---

## STEP 6b — Resend TXT DNS Record ❌ NEEDED

**Where:** WPX Control Panel → Edit DNS → luxearchive.com → Create Record

| Type | Name | Value |
|------|------|-------|
| TXT | `resend._domainkey` | Get from: resend.com → Domains → `luxearchive.com` → DNS Records |

Steps:
1. Log in to WPX → Control Panel
2. Edit DNS → `luxearchive.com`
3. Create Record → Type: TXT, Host: `resend._domainkey`, Value: (from Resend dashboard)
4. Wait 5–30 min → verify at dnschecker.org

---

## STEP 7f — Supabase Redirect URLs ❌ NEEDED

**Where:** supabase.com → Project `sedhrimkgtoumegosubc` → Authentication → URL Configuration → Redirect URLs

Add: `https://tool.luxearchive.com/**`

This allows Supabase to redirect back to any path on the domain after auth flows. Without it, some auth redirects may be blocked.

---

## STEP 8 — Full Smoke Test (Run After Fixes Above)

Once live log panel and stop button are working:

- [ ] Log in with admin account at `tool.luxearchive.com`
- [ ] Add a real Yupoo URL → product appears in pipeline with status `READY_FOR_SCRAPE`
- [ ] Run Agent 1 → status becomes `READY_FOR_RESEARCH`, logs stream in UI
- [ ] Run Agent 2 → status becomes `READY_FOR_SEO` or `NEEDS_REVIEW`
- [ ] Run Agent 3 → status becomes `READY_FOR_PUBLISH`
- [ ] Run Agent 4 → Cloudinary has WebP images, status `PUBLISHED`
- [ ] Run Agent 5 → product appears in WooCommerce
- [ ] Telegram message received at each stage
- [ ] Email received on publish
- [ ] Reports → Analytics → all sections load without errors
- [ ] Stop button halts an agent mid-batch gracefully
- [ ] Log panel shows live output during run

---

## Credentials Reference

| Service | Where | Notes |
|---------|-------|-------|
| Supabase | supabase.com → project `sedhrimkgtoumegosubc` | SQL Editor for migrations |
| Modal | modal.com → `hollomenstyle` workspace | Use client's token to deploy |
| Vercel | vercel.com → `hollonow` account | Auto-deploys on git push |
| GitHub | github.com/hollonow/hollomen | You have Write access as `iannjenga` |
| WPX DNS | wpx.net → Control Panel → Edit DNS | For `luxearchive.com` DNS records |
| Resend | resend.com → Domains | For TXT record value |
