# Engineering notes: BGG agent + `@sanity/agent-context`

**Audience:** Agent Context / Agent Insights team (and anyone shipping date-relative agents on MCP)  
**Context:** We integrated `@sanity/agent-context` (v0.3.5 tarball) into a small **Node ESM CLI** that uses the Vercel AI SDK’s `generateText` over **Sanity Agent Context** (GROQ via MCP). This document collects **package integration** feedback and **agent behavior** feedback observed in that setup.

---

## Symptom

Running the CLI with:

```bash
node agent.mjs
```

after importing `sanityInsightsIntegration` from **`@sanity/agent-context/ai-sdk`** failed at startup with:

```text
TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".css" for
.../node_modules/sanity/lib/bundle.css
```

**Environment:** Node.js v25.x, ESM (`"type": "module"` / `.mjs`), no bundler — plain Node resolution.

---

## Root cause

The **`@sanity/agent-context/ai-sdk`** bundle imports **`saveConversation`** from:

`dist/_chunks-es/saveConversation.js`

That module imports **`CONVERSATION_SCHEMA_TYPE_NAME`** from:

`dist/_chunks-es/conversationSchema.js`

`conversationSchema.js` begins with:

```js
import { defineField, defineType } from "sanity";
```

So any consumer of **`@sanity/agent-context/ai-sdk`** in Node pulls in the **`sanity`** package (Sanity Studio), which includes **`sanity/lib/bundle.css`**. Node’s native ESM loader does not treat `.css` as a loadable module, so the process throws before any telemetry runs.

**Net:** The “headless” AI SDK integration path is **not** headless from a dependency graph perspective: it is coupled to Studio schema authoring helpers.

---

## Impact

- **Broken:** Server-side / CLI / any unbundled Node use of `@sanity/agent-context/ai-sdk`.
- **Fine (expected):** Studio builds and browser bundles that already compile or ignore CSS.

Teams building **MCP agents, scripts, or backend workers** that only need to **persist conversations** for Insights are likely to hit this unless they use a bundler with explicit CSS handling or duplicate logic.

---

## Suggested upstream directions

Pick one (or combine):

1. **Split persistence from schema**  
   - Move `CONVERSATION_SCHEMA_TYPE_NAME` (and any constants needed for writes) into a **tiny shared module** with **no** `import from "sanity"`.  
   - Keep `defineField` / `defineType` in a **studio-only** entry (e.g. existing `./studio` or a dedicated `./conversation-schema` used only from Studio).

2. **Dedicated Node-safe export**  
   - e.g. `@sanity/agent-context/ai-sdk-node` (or document `@sanity/agent-context/insights` as the only Node import and ensure it never re-exports anything that touches `sanity`).

3. **Document explicitly**  
   - In the package README: **`@sanity/agent-context/ai-sdk` is intended for bundled / Studio contexts** unless you provide a Node-safe entry.  
   - Call out the **`sanity` → `.css`** failure mode so integrators do not assume parity with `@sanity/client`-only scripts.

---

## What we did in this repo (workaround)

We **stopped importing** `@sanity/agent-context/ai-sdk` from the CLI and added a local module **`agent-insights-telemetry.mjs`** that:

- Uses `bindTelemetryIntegration` from **`ai`** (same pattern as the published integration).
- Reimplements the **message normalization** and **`saveConversation`** transaction logic aligned with the published `saveConversation` behavior (including `_type: "sanity.agentContextConversation"` and `generateConversationId` / FNV-style id).

`agent.mjs` imports `sanityInsightsIntegration` from that file instead of from the package.

This keeps Insights writes working **without** loading Studio in Node. The tradeoff is **duplication** until the package exposes a Node-safe path.

---

## References in this repository

| Artifact | Purpose |
| -------- | ------- |
| `agent-insights-telemetry.mjs` | Node-safe telemetry + save (shim) |
| `agent.mjs` | CLI agent; wires optional Insights when env vars are set |
| `docs/agent-context.md` | Copy of package README (local reference) |

---

## Addendum: “New” / “recent” games — GROQ used stale years (2022–2023 in 2026)

### Observed behavior

**User ask (paraphrased):** games that are **new** / recently published.

**Emitted GROQ (paraphrased):** a filter equivalent to **`yearPublished in [2022, 2023]`** (or similar), i.e. **three to four calendar years behind** the real clock.

**Actual calendar context when this was observed:** **2026** (May). Treating “new” as 2022–2023 is misleading for end users and undermines trust in grounded retrieval: the query is valid GROQ but **wrong for the intent** of “new” in the present.

### What our agent system prompt already says

The demo CLI’s system text explicitly steers **temporal** language toward **ranges anchored on the current era**, not a single stale year, including an example that names **2026** next to **2025** for casual “last year” / “recent” style asks (see `agent.mjs` — **Temporal** bullet under `AGENT_SYSTEM`).

Despite that, the model still produced **`[2022, 2023]`**. So this is **not** purely “missing documentation in the prompt”; it is **instruction drift** / **training-prior defaulting** (“recent games” often pattern-matches to mid-2020s in model weights) unless the **current date** is supplied in a form the model reliably binds to at tool-call time.

### Likely causes (for discussion)

1. **No explicit clock in the message bundle** — The model is not given a machine-grounded **`Today: YYYY-MM-DD`** (or ISO instant) in the **system** or **first user** turn, so “new” is interpreted from priors, not from wall time.
2. **Example ≠ constraint** — Static examples in the system prompt can be **ignored or mis-generalized** (e.g. remembering “a two-year window” but filling in the wrong years).
3. **Tool indirection** — The step that writes GROQ may be weakly coupled to the temporal bullet compared to shorter heuristics the model applies when composing strings inside `groq_query`.

### Mitigations we are considering (repo-agnostic recommendations)

1. **Inject dynamic date** — Prepend to `AGENT_SYSTEM` (or equivalent) a line updated on each run, e.g. **`Current date (UTC): 2026-05-01`** from `new Date().toISOString().slice(0, 10)`, and require that **any** `yearPublished` filter for “new”, “recent”, “last year”, or “just came out” **must** be justified against that line. **Implemented in this repo:** `agent.mjs` builds `agentSystemMessage()` from `clockPreamble()` (UTC date + year) plus the existing body; `generateText` uses that each run.
2. **Narrow tool contract** — If Agent Context (or a wrapper) exposes structured args for year ranges before stringifying GROQ, validate ranges server-side (reject or clamp if the range’s maximum year is too far in the past for a “new” intent).
3. **Eval / regression** — Add a canned eval: prompt **“new games”** with clock fixed to **2026-01-15**; assert generated query uses **≥ 2024** or **∈ {2025, 2026}** (exact policy TBD), never **2022–2023** as the primary interpretation.

### Why this might matter to Sanity

Agent Context is positioned as **grounded** access to content. **Grounded but temporally wrong** still reads as a broken product (“the database is from 2026 but it searched 2022”). Anything Sanity can document or template for **MCP + natural language + date-relative queries** (clock injection, eval harness) would help all integrators, not only this demo.

---

## Contact / feedback

If you ship a supported **Node-safe** export or refactor the `saveConversation` → `conversationSchema` edge, we can delete the shim and depend on the package directly. Happy to validate against a prerelease tarball.

**Temporal / agent behavior:** If you publish **recommended patterns** for time-relative agents (clock in system prompt, evals), we are happy to align the demo and reference them from the README.
