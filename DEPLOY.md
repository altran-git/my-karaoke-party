# Deploying your own copy (Vercel + PartyKit)

This guide deploys the app on free tiers:

| Part | Where it runs | How it updates |
|---|---|---|
| Website and API (`src/`) | Vercel | Automatically on every push to `main` |
| Live queue server (`party/index.ts`) | PartyKit (Cloudflare) | GitHub Action on push to `main` (`.github/workflows/deploy.yml`), or `npx partykit deploy` by hand |
| Database | Postgres (Neon via Vercel, or any provider) | Migrations run during the Vercel build |
| Search cache | Redis (Upstash via Vercel) | n/a |

Allow about 30 minutes. You need a GitHub account (with this fork), a Google account, and Node.js 20+ with `pnpm` on your computer for the PartyKit step.

> Provider dashboards change often. If a button or menu has moved, look for the closest match.

---

## 1. Get a YouTube Data API key

1. Go to <https://console.cloud.google.com/> and create a new project (e.g. "my-karaoke").
2. Open **APIs & Services → Library**, search for **YouTube Data API v3** and click **Enable**.
3. Open **APIs & Services → Credentials → Create credentials → API key**.
4. (Recommended) Edit the key and, under **API restrictions**, restrict it to **YouTube Data API v3**.
5. Copy the key. This is your `YOUTUBE_API_KEY`.

Free quota: 10,000 units/day. Each search costs 100 units, so you get about 100 searches a day. Results are cached for 24 hours, so repeated searches are free.

## 2. Deploy the PartyKit server

PartyKit handles the real-time queue shared between the TV screen and phones.

```bash
pnpm install
npx partykit login        # opens the browser and signs in with GitHub
npx partykit deploy
```

When it finishes, it prints a URL like:

```
https://karaokeparty.<your-github-username>.partykit.dev
```

Copy it, including `https://`. This is your `NEXT_PUBLIC_PARTYKIT_URL`.

### Auto-deploy PartyKit from GitHub (optional, recommended)

The repo already has `.github/workflows/deploy.yml`, which redeploys PartyKit on every push to `main`. For it to work in your fork:

1. Generate a token on your computer:
   ```bash
   npx partykit token generate
   ```
2. In your fork on GitHub: **Settings → Secrets and variables → Actions → New repository secret**, add:
   - `PARTYKIT_LOGIN`: your PartyKit username (your GitHub username)
   - `PARTYKIT_TOKEN`: the token from step 1
3. Make sure Actions are enabled for the fork (**Actions** tab → enable workflows).

Without these secrets the workflow fails on every push. That's harmless, but you'd have to run `npx partykit deploy` by hand after changing `party/index.ts`.

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
| `NEXT_PUBLIC_PARTYKIT_URL` | The URL from step 2, **with** `https://`, e.g. `https://karaokeparty.yourname.partykit.dev` |
| `NEXT_PUBLIC_BASE_URL` | Your site's domain **without** `https://`, e.g. `my-karaoke.vercel.app` or `karaoke.example.com` |

`NEXT_PUBLIC_BASE_URL` is used for the QR code and join links. If it isn't set, preview deployments fall back to their own unique URLs, which works but changes on every deploy.

## 6. Deploy

Open **Deployments**, click **⋯** on the latest deployment and choose **Redeploy**, or push any commit to `main`.

The build creates the database tables (`prisma migrate deploy`) and then builds the site.

## 7. Test it

1. Open your Vercel URL on a computer/TV and start a party.
2. Scan the QR code with your phone and join.
3. Search for a song and add it. It should appear on the TV screen right away.

If search fails, check `YOUTUBE_API_KEY` and the KV variables. If the queue doesn't update live, check `NEXT_PUBLIC_PARTYKIT_URL`.

## Custom domain (optional)

In Vercel: **Settings → Domains → Add**, then follow the DNS instructions. Afterwards update `NEXT_PUBLIC_BASE_URL` to the new domain and redeploy.

---

## Day-to-day workflow

- **Change the website:** push to `main`. Vercel deploys it automatically (and PartyKit too, if you set up the GitHub secrets).
- **Change the database schema:** create a migration locally with `pnpm prisma migrate dev --name <name>` and commit the `prisma/migrations` folder. Vercel applies it on the next deploy.
- **Change `party/index.ts`:** push to `main` (with the secrets set up) or run `npx partykit deploy`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Build error `Invalid environment variables` | A required variable (`DATABASE_URL`, `YOUTUBE_API_KEY`, `NEXT_PUBLIC_PARTYKIT_URL`) is missing |
| Build error about `DATABASE_URL_NON_POOLING` | Add it with the unpooled Postgres URL (step 4) |
| Party page shows 404 right after creating a party | `NEXT_PUBLIC_PARTYKIT_URL` is wrong or missing `https://` |
| Search returns an error | Bad YouTube key, YouTube API not enabled, daily quota used up, or KV variables missing |
| QR code points to the wrong site | Set `NEXT_PUBLIC_BASE_URL` (no `https://`) and redeploy |
| Changing a `NEXT_PUBLIC_*` variable has no effect | These are baked in at build time, so redeploy after changing them |
