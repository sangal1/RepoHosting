# RepoHosting ⚡

A simple UI for speedy deployments to the platform of your choice.

**Currently supported:** [Vercel](https://vercel.com) · [Render](https://render.com) · [Netlify](https://netlify.com)

RepoHosting lets you log in once with Google, then connect your Vercel, Render
and Netlify accounts so you can ship repositories fast — all from a single,
laptop-sized page.

---

## Architecture

| Layer      | Tech                                                       |
| ---------- | --------------------------------------------------------- |
| Frontend   | Plain HTML / CSS / JS, hosted on **GitHub Pages**         |
| Auth       | **Supabase Auth** (Google OAuth) via GoTrue REST          |
| Backend    | **Supabase Edge Functions** (Deno)                        |
| Database   | **Postgres** (Supabase) with Row-Level Security           |
| Testing    | **Playwright** (browser) + Deno tests (functions)         |

### Connector auth model

- **Vercel** & **Netlify** — OAuth 2.0 authorization-code flow. RepoHosting
  never sees your password; we store a scoped access token.
- **Render** — Render has **no OAuth**, so users paste a personal **API key**,
  which we validate against the Render API before storing.

All third-party tokens/keys live in Postgres, readable only by their owner via
RLS, and are written exclusively by edge functions using the service role.

---

## Project layout

```
frontend/            Static single-page app (deployed to GitHub Pages)
supabase/
  functions/         Edge functions (oauth-start, oauth-callback, ...)
  migrations/        Postgres schema + RLS
tests/               Playwright specs
.github/workflows/   Pages deploy
```

---

## Local development

```bash
npm install
npx playwright install chromium

# run the static site
npm run serve            # http://127.0.0.1:4173

# run browser tests (spins the server up automatically)
npm test
```

### Edge functions

```bash
# serve functions locally against the linked project
supabase functions serve --env-file .env

# deploy
supabase functions deploy <name>
```

Secrets are managed with `supabase secrets set KEY=value`. See `.env.example`
for the full list.

---

## Testing philosophy

Red/Green TDD. Every feature starts with a failing Playwright spec, then the
implementation makes it pass. Provider OAuth flows are tested against **mocked**
providers (via Playwright request interception) so the full flow is verified end
to end without live third-party credentials; real client IDs/secrets are wired
in later to go live.

---

Made with caffeine & questionable sleep by [@sangal1](https://github.com/sangal1/) 🛠️
