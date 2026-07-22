# Spring Bowls

A small web app for running a one-day lawn-bowls tournament — the 7th **Spring Bowls**, *BYO Brit edition*.

Everyone gets a username + password, sees their next fixture and rink, enters scores, checks the group tables and bracket, and votes for the fun awards. One admin (the host) sets the whole thing up and can fix anything on the day.

- **Event date:** Saturday 1 August 2026
- **Status:** requirements + design (no app code yet)
- **This is a personal project** — unrelated to any employer.

## Tech

| Layer | Choice | Why |
|---|---|---|
| App | Next.js (App Router) + TypeScript + Tailwind | One framework for UI + server; great hot-reload |
| Data / auth / realtime | Supabase (Postgres) | Free tier; realtime powers the live "up next" screens |
| Hosting | Vercel | Free; one link to share |
| Tests | Vitest, React Testing Library, Playwright, Stryker (mutation) | See [test strategy](docs/test-strategy.md) |

## Docs

| Doc | What's in it |
|---|---|
| [requirements.md](docs/requirements.md) | The full spec — roles, scope, numbered requirements + acceptance criteria |
| [domain-glossary.md](docs/domain-glossary.md) | Bowls terms + the data model / entities |
| [test-strategy.md](docs/test-strategy.md) | How we test, and the rules that stop tests from cheating |
| [edge-cases.md](docs/edge-cases.md) | Living log of edge cases + open decisions to resolve in user testing |
| [decisions.md](docs/decisions.md) | Short record of key design decisions and why |

## Running it (once the app exists)

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # unit + integration (Vitest)
npm run test:e2e # end-to-end (Playwright)
```
