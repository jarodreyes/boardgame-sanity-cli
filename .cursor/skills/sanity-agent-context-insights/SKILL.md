---
name: sanity-agent-context-insights
description: >-
  Use when working on @sanity/agent-context, Agent Insights telemetry, Studio
  plugin, classification functions, or env tokens for this bgg-agent repo.
---

# Sanity Agent Context & Insights (this repo)

## Where to read

- Package usage and classification setup: **`docs/agent-context.md`** (copied from `@sanity/agent-context`).
- Hosted Studio + MCP: project **`README.md`** and [Agent Context docs](https://www.sanity.io/docs/ai/agent-context).

## This project’s wiring

- **Studio:** `sanity.config.ts` uses `agentContextPlugin()` from `@sanity/agent-context/studio` (Insights dashboard on by default unless `{insights: {enabled: false}}`).
- **CLI agent:** `agent.mjs` sends **AI SDK telemetry** to Insights when **`SANITY_PROJECT_ID`** and **`SANITY_INSIGHTS_WRITE_TOKEN`** are set (see **`.env.example`**). Uses **`agent-insights-telemetry.mjs`** (same behavior as `@sanity/agent-context/ai-sdk`) because the published `ai-sdk` entry imports Studio’s `sanity` package and breaks **`node agent.mjs`**. Each run gets a new `threadId` (`randomUUID()`); `agentId` defaults to `bgg-agent-cli` or **`SANITY_INSIGHTS_AGENT_ID`**.
- **Classification:** Not in-repo yet; follow **`docs/agent-context.md`** “Set Up Classification” (Sanity Functions + blueprint at repo root).

## Tokens

| Variable | Role |
| -------- | ---- |
| `SANITY_API_READ_TOKEN` | Viewer — MCP only |
| `SANITY_INSIGHTS_WRITE_TOKEN` | Editor — save conversations for Insights (keep server-side) |
| `SANITY_API_TOKEN` | Used by `ingest.mjs` (write); separate from Insights unless you intentionally reuse |

Do not use the MCP Viewer token for Insights writes.

## After schema changes

Run `npm run schema:deploy` (or `npx sanity schemas deploy --workspace default`) so plugin types exist before relying on the Insights UI.
