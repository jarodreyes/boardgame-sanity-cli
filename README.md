# BGG + Sanity Agent Context demo

Sanity Studio + scripts that ingest **BoardGameGeek** data into the Content Lake and run a small **Node** agent against **Sanity Agent Context** (MCP), so answers come from **GROQ**, not guesses.

**Full walkthrough (learners start here):** [tutorial/bgg-agent-context-tutorial.md](tutorial/bgg-agent-context-tutorial.md)

**Recording a video:** [tutorial/bgg-agent-context-recording-instructions.md](tutorial/bgg-agent-context-recording-instructions.md) · [tutorial/bgg-agent-context-video-script.md](tutorial/bgg-agent-context-video-script.md)

---

## Who this is for

Developers who want a **minimal, reproducible** example: BGG XML API → `boardGame` documents → Agent Context → `agent.mjs` with the Vercel AI SDK. No product frontend.

---

## Prerequisites (short)

| Requirement | Notes |
|-------------|--------|
| **Node.js 20+** | `node --version` |
| **Sanity account** | [sanity.io](https://www.sanity.io) |
| **BGG API application + token** | [Applications](https://boardgamegeek.com/applications) · [Using the XML API](https://boardgamegeek.com/using_the_xml_api) |
| **OpenAI API key** | Or swap the model in `agent.mjs` for another AI SDK provider |

---

## Quick start (after you have a project)

From the repo root:

```bash
cp .env.example .env
# Edit .env — the tutorial explains each variable.

npm install
```

If you **cloned** this repo, set **`projectId`** and **`dataset`** in **`sanity.config.ts`** and **`sanity.cli.ts`** to your own project from [sanity.io/manage](https://www.sanity.io/manage) (the tutorial’s `npm create sanity` path bakes these in for you).

```bash
npx sanity schema deploy
npm run deploy
```

`npm run deploy` hosts Studio; **Agent Context’s MCP URL only works once Studio is deployed** (v5.1+). Then in Studio: install plugins if needed, create the **Agent Context** document, copy the **MCP URL** into `.env`.

```bash
npm run ingest
# optional larger set:
# npm run rank-ids && npm run ingest:top250

npm run agent -- "How many board games are in the database?"
```

For **step-by-step** setup (clean template, schema, ingest, Agent Context fields, troubleshooting), use the **[tutorial](tutorial/bgg-agent-context-tutorial.md)** — it is the source of truth so this README stays short.

---

## npm scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Sanity Studio (local) |
| `npm run deploy` | Host Studio (required for Agent Context MCP) |
| `npm run ingest` | Default BGG import (hot + featured) |
| `npm run ingest:top250` | Import up to 250 games using `data/bgg-ranked-ids.json` |
| `npm run rank-ids` | Regenerate ranked IDs from a BGG geeklist (see script header) |
| `npm run agent -- "…"` | Run the CLI agent (quote your question) |

---

## Repo layout

| Path | Role |
|------|------|
| `tutorial/` | Written tutorial, recording checklist, video script |
| `schemaTypes/` | `boardGame` schema |
| `ingest.mjs` | BGG → Content Lake |
| `agent.mjs` | MCP + `generateText` |
| `scripts/fetch-geeklist-ids.mjs` | Optional ranked ID list for larger ingests |
| `data/bgg-ranked-ids.json` | Default list for `ingest:top250` (replaceable) |

---

## Hosting on GitHub

**Yes — host the repo on GitHub** (or any git host) so people can clone it. This repo is **source code + docs**, not a hosted app.

- **Do commit:** `tutorial/`, `ingest.mjs`, `agent.mjs`, `schemaTypes/`, `.env.example`, `data/bgg-ranked-ids.json` (no secrets).
- **Do not commit:** `.env`, API tokens, cookies, or anything from `sanity.io/manage` that grants access. `.env` is listed in `.gitignore`; use **`.env.example`** as the template.
- **Rotate tokens** if they were ever pasted into a public issue or chat.

Each learner still creates **their own** Sanity project and tokens; the tutorial explains that.

---

## License

`package.json` currently declares `UNLICENSED`. If you want others to reuse the code freely, switch to **MIT** (or similar) in `package.json` and add a `LICENSE` file when you publish.
