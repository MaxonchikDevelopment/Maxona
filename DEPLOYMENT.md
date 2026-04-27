# Deployment — Vercel

## Required environment variables

Set these in the Vercel project dashboard (Settings → Environment Variables).
All variables are **server-only** except `NEXT_PUBLIC_APP_URL`.

| Variable | Description |
|---|---|
| `DATABASE_URL` | Supabase pooler URL (`?pgbouncer=true`). Use port 6543. |
| `DIRECT_URL` | Supabase direct URL (no pooler). Port 5432. Required for Prisma migrations. |
| `ANTHROPIC_API_KEY` | Anthropic API key. Rotate before production. |
| `AUTH_PASSWORD` | Middleware password for the single-user app. Rotate before production. |
| `NEXT_PUBLIC_APP_URL` | Full origin of the deployed app — must include `https://` and have **no trailing slash**. Example: `https://maxona-ai.vercel.app`. The app uses this to construct all Strava redirect URIs at runtime. |
| `STRAVA_CLIENT_ID` | Strava app client ID. |
| `STRAVA_CLIENT_SECRET` | Strava app client secret. Rotate before production. |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | Random string used to verify Strava webhook subscriptions. |

### Optional

| Variable | Description |
|---|---|
| `ANTHROPIC_MODEL` | Claude model ID. Defaults to `claude-sonnet-4-6`. |

### Per-environment values

| Environment | `NEXT_PUBLIC_APP_URL` |
|---|---|
| Local (`.env.local`) | `http://localhost:3000` |
| Vercel (production) | `https://maxona-ai.vercel.app` |

> **Warning:** Do not put the production URL in `.env.local`. It would cause local OAuth to
> redirect to production, which Strava will reject because the redirect URI domain must match
> the domain registered in the Strava app settings.

## Strava app settings

In the Strava developer portal (https://www.strava.com/settings/api), configure:

| Field | Value |
|---|---|
| **Authorization Callback Domain** | `maxona-ai.vercel.app` |

This field accepts a **domain only** — no scheme, no path, no trailing slash.
Strava uses it to whitelist the domain; the full redirect URI is constructed by the app.

The full redirect URI the app sends to Strava during OAuth is:

```
https://maxona-ai.vercel.app/api/strava/callback
```

This is built at runtime from `NEXT_PUBLIC_APP_URL + "/api/strava/callback"` — there is no
`STRAVA_REDIRECT_URI` environment variable and none should be set.

## Strava webhook subscription

After deploying, register the webhook subscription once via the Strava API:

```bash
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=<STRAVA_CLIENT_ID> \
  -F client_secret=<STRAVA_CLIENT_SECRET> \
  -F callback_url=https://maxona-ai.vercel.app/api/strava/webhook \
  -F verify_token=<STRAVA_WEBHOOK_VERIFY_TOKEN>
```

The webhook endpoint is publicly accessible (no auth cookie required).

## Prisma migrations on Vercel

Vercel does not run `prisma migrate deploy` automatically.
Either:
- Run it manually from your local machine against the production `DIRECT_URL`, or
- Add a build step: in Vercel's build command use `prisma migrate deploy && next build`

## Security checklist before going live

- [ ] Rotate `ANTHROPIC_API_KEY`
- [ ] Rotate `AUTH_PASSWORD` (use a strong random string, not a memorizable password)
- [ ] Rotate `STRAVA_CLIENT_SECRET`
- [ ] Rotate `STRAVA_WEBHOOK_VERIFY_TOKEN`
- [ ] Confirm `NEXT_PUBLIC_APP_URL` is `https://maxona-ai.vercel.app` in Vercel env vars
- [ ] Confirm `NEXT_PUBLIC_APP_URL` is `http://localhost:3000` in `.env.local`
- [ ] Confirm Strava app Authorization Callback Domain is `maxona-ai.vercel.app`
- [ ] Confirm `.env.local` is in `.gitignore` and never committed
- [ ] Confirm no secrets in `NEXT_PUBLIC_*` variables (`NEXT_PUBLIC_APP_URL` is the only one, and it is intentionally public)

## Notes

- `STRAVA_REDIRECT_URI` is **not** a required env var and should not be set — the app derives the redirect URI from `NEXT_PUBLIC_APP_URL` at runtime.
- Tokens (Strava access/refresh) are stored in the DB only, never in env vars.
- `lastSyncedAt` throttles Strava sync to ≤ 1×/hour. A cron route at `/api/cron/strava-sync` is designed but not implemented in MVP-0.
