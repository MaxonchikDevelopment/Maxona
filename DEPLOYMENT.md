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
| `NEXT_PUBLIC_APP_URL` | Deployed domain, no trailing slash. E.g. `https://maxona-ai.vercel.app`. Drives Strava OAuth redirect URI construction. |
| `STRAVA_CLIENT_ID` | Strava app client ID. |
| `STRAVA_CLIENT_SECRET` | Strava app client secret. Rotate before production. |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | Random string used to verify Strava webhook subscriptions. |

### Optional

| Variable | Description |
|---|---|
| `ANTHROPIC_MODEL` | Claude model ID. Defaults to `claude-sonnet-4-6`. |

## Strava OAuth callback URL

The Strava app callback URL must be set to:

```
https://<your-domain>/api/strava/callback
```

This is derived from `NEXT_PUBLIC_APP_URL` in code — no separate env var needed.

## Strava webhook subscription

After deploying, register the webhook subscription once via the Strava API:

```bash
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=<STRAVA_CLIENT_ID> \
  -F client_secret=<STRAVA_CLIENT_SECRET> \
  -F callback_url=https://<your-domain>/api/strava/webhook \
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
- [ ] Confirm `NEXT_PUBLIC_APP_URL` matches the deployed domain exactly
- [ ] Confirm Strava app callback URL is updated in the Strava developer portal
- [ ] Confirm `.env.local` is in `.gitignore` and never committed
- [ ] Confirm no secrets in `NEXT_PUBLIC_*` variables (only `NEXT_PUBLIC_APP_URL` is used, which is intentionally public)

## Notes

- `STRAVA_REDIRECT_URI` is **not** a required env var — the app derives the redirect URI from `NEXT_PUBLIC_APP_URL`.
- Tokens (Strava access/refresh) are stored in the DB only, never in env vars.
- `lastSyncedAt` throttles Strava sync to ≤ 1×/hour. A cron route at `/api/cron/strava-sync` is designed but not implemented in MVP-0.
