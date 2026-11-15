# Deploying your own copy (Vercel + Cloudflare)

This guide deploys the app on free tiers:

| Part | Where it runs | How it updates |
|---|---|---|
| Website and API (`src/`) | Vercel | Automatically on every push to `main` |
| Live queue server (`party/index.ts`) | Cloudflare Workers + Durable Objects (your own account) | GitHub Action on push to `main` (`.github/workflows/deploy.yml`), or `pnpm deploy:pk` by hand |
| Database | Postgres (Neon via Vercel, or any provider) | Migrations run during the Vercel build |
| Search cache | Redis (Upstash via Vercel) | n/a |

Allow about 30 minutes. You need a GitHub account (with this fork), a Google account, a free Cloudflare account, and Node.js 20+ with `pnpm` 10+ on your computer for the Cloudflare step.

> The hosted PartyKit platform (partykit.io) shut down on 23 Oct 2026. The live queue server now runs on [PartyServer](https://github.com/threepointone/partyserver) in your own Cloudflare account instead.

> Provider dashboards change often. If a button or menu has moved, look for the closest match.

---

## 1. Get a YouTube Data API key

1. Go to <https://console.cloud.google.com/> and create a new project (e.g. "my-karaoke").
2. Open **APIs & Services → Library**, search for **YouTube Data API v3** and click **Enable**.
3. Open **APIs & Services → Credentials → Create credentials → API key**.
4. (Recommended) Edit the key and, under **API restrictions**, restrict it to **YouTube Data API v3**.
5. Copy the key. This is your `YOUTUBE_API_KEY`.

Free quota: 10,000 units/day. Each search costs 100 units, so you get about 100 searches a day. Results are cached for 24 hours, so repeated searches are free.

## 2. Deploy the live queue server to Cloudflare

The live queue server (`party/index.ts`) keeps the queue in sync between the TV screen and phones. It runs as a Cloudflare Worker with Durable Objects, which are included in the Workers **Free** plan.

1. Create a free account at <https://dash.cloudflare.com/sign-up> and verify your email.
2. On your computer, in the project folder:
   ```bash
   pnpm install
   npx wrangler login        # opens the browser; click "Allow"
   pnpm deploy:pk
   ```
   If Cloudflare asks you to register a `workers.dev` subdomain, pick any name (e.g. your username) and accept.

When it finishes, it prints a URL like:

```
https://my-karaoke-party.<your-subdomain>.workers.dev
```

Copy it, including `https://`. This is your `NEXT_PUBLIC_PARTYKIT_URL`. The name is kept from the PartyKit days, so you don't need to rename anything.

Quick check: opening `<that URL>/parties/main/test` in a browser should show **Party not found =(**. That means the server is running.

### Auto-deploy from GitHub (optional, recommended)

`.github/workflows/deploy.yml` redeploys the queue server on every push to `main`. It's skipped (not failed) until you add these secrets:

1. **API token:** Cloudflare dashboard → **My Profile → API Tokens → Create Token**. Use the **Edit Cloudflare Workers** template, select your account, then **Continue → Create Token**. Copy the token.
2. **Account ID:** Cloudflare dashboard → **Workers & Pages**. The Account ID is shown in the right-hand column (or run `npx wrangler whoami`).
3. In your fork on GitHub: **Settings → Secrets and variables → Actions → New repository secret**, add:
   - `CLOUDFLARE_API_TOKEN`: the token from step 1
   - `CLOUDFLARE_ACCOUNT_ID`: the ID from step 2

## 3. Create the Vercel project

1. Sign in at <https://vercel.com> with GitHub (Hobby plan, free for non-commercial use).
2. **Add New → Project**, then import your fork of `my-karaoke-party`.
3. Framework preset: **Next.js** (auto-detected). Leave the build settings at their defaults. Vercel picks up the `vercel-build` script, which runs Prisma migrations and then builds.
4. **Don't deploy yet.** The first build fails until the database and env vars exist. If it already ran and failed, that's fine. You'll redeploy in step 6.

## 4. Add the database and cache

In the Vercel project, open the **Storage** tab:

1. **Postgres:** create a **Neon** (Postgres) database and connect it to the project (all environments).
2. **Redis/KV:** create an **Upstash for Redis** (KV) store and connect it to the project.

Connecting these adds env vars to the project automatically. Check **Settings → Environment Variables** and confirm you have:

- A pooled Postgres URL, usually `DATABASE_URL`
- A direct (unpooled) Postgres URL, usually `DATABASE_URL_UNPOOLED` or `POSTGRES_URL_NON_POOLING`
- `KV_REST_API_URL` and `KV_REST_API_TOKEN`

The app expects the unpooled URL under the name **`DATABASE_URL_NON_POOLING`**. If that exact name isn't there, add it yourself and paste in the unpooled URL value.

(Using Supabase, Neon directly or another Postgres instead works too. Just set `DATABASE_URL` and `DATABASE_URL_NON_POOLING` yourself.)

## 5. Add the remaining environment variables

In **Settings → Environment Variables**, add these for all environments:

| Name | Value |
|---|---|
| `YOUTUBE_API_KEY` | The key from step 1 |
| `NEXT_PUBLIC_PARTYKIT_URL` | The URL from step 2, **with** `https://`, e.g. `https://my-karaoke-party.yourname.workers.dev` |
| `NEXT_PUBLIC_BASE_URL` | Your site's domain **without** `https://`, e.g. `my-karaoke.vercel.app` or `karaoke.example.com` |

`NEXT_PUBLIC_BASE_URL` is used for the QR code and join links. If it isn't set, preview deployments fall back to their own unique URLs, which works but changes on every deploy.

## 6. Deploy

Open **Deployments**, click **⋯** on the latest deployment and choose **Redeploy**, or push any commit to `main`.

The build creates the database tables (`prisma migrate deploy`) and then builds the site.

## 7. Test it

1. Open your Vercel URL on a computer/TV and start a party.
2. Scan the QR code with your phone and join.
3. Search for a song and add it. It should appear on the TV screen right away.

If search fails, check `YOUTUBE_API_KEY` and the KV variables. If the queue doesn't update live, check `NEXT_PUBLIC_PARTYKIT_URL`. Live logs from the queue server are in the Cloudflare dashboard under **Workers & Pages → my-karaoke-party → Logs**.

## Custom domain (optional)

In Vercel: **Settings → Domains → Add**, then follow the DNS instructions. Afterwards update `NEXT_PUBLIC_BASE_URL` to the new domain and redeploy.

---

## Day-to-day workflow

- **Change the website:** push to `main`. Vercel deploys it automatically (and the queue server too, if you set up the Cloudflare secrets).
- **Change the database schema:** create a migration locally with `pnpm prisma migrate dev --name <name>` and commit the `prisma/migrations` folder. Vercel applies it on the next deploy.
- **Change `party/index.ts`:** push to `main` (with the secrets set up) or run `pnpm deploy:pk`.
- **Run everything locally:** `pnpm dev:pk` (queue server on http://localhost:8787) and `pnpm dev` (app on http://localhost:3000), with `NEXT_PUBLIC_PARTYKIT_URL=http://localhost:8787` in `.env`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Build error `Invalid environment variables` | A required variable (`DATABASE_URL`, `YOUTUBE_API_KEY`, `NEXT_PUBLIC_PARTYKIT_URL`) is missing |
| Build error about `DATABASE_URL_NON_POOLING` | Add it with the unpooled Postgres URL (step 4) |
| Creating a party fails, or the party page shows 404 | `NEXT_PUBLIC_PARTYKIT_URL` is wrong or missing `https://`. Check that `<url>/parties/main/test` shows "Party not found =(" |
| `pnpm deploy:pk` says you are not logged in | Run `npx wrangler login` first |
| Search returns an error | Bad YouTube key, YouTube API not enabled, daily quota used up, or KV variables missing |
| QR code points to the wrong site | Set `NEXT_PUBLIC_BASE_URL` (no `https://`) and redeploy |
| Changing a `NEXT_PUBLIC_*` variable has no effect | These are baked in at build time, so redeploy after changing them |
