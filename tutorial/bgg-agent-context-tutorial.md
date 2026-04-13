# Build a Board Game AI That Doesn't Guess

Pull BGG's top games into Sanity's Content Lake, then give an AI agent structured, queryable access using Sanity Agent Context.

**Repository:** clone this project, copy [`.env.example`](../.env.example) to `.env`, and follow the commands in the [README](../README.md) for a short path; use this document for the full narrative.

---

## The payoff, first

Here's what this tutorial builds. You type this into a terminal:

```bash
node --env-file=.env agent.mjs "Find games that combine Worker Placement with Deck Building"
```

And you get back something like this:

```
Based on your board game database, here are the matches:

**Dune: Imperium** (weight: 3.0, rating: 8.58, published: 2020)
- Mechanics: Worker Placement, Deck, Bag, and Pool Building, Area Control
- Designers: Paul Dennen

**Dune: Imperium – Uprising** (weight: 3.16, rating: 8.51, published: 2023)
- Mechanics: Worker Placement, Deck, Bag, and Pool Building, Negotiation
- Designers: Paul Dennen
```

Notice what didn't happen: the agent didn't guess. It ran a GROQ query against your Content Lake and returned games that literally have both mechanics tags in their records, pulled from BoardGameGeek's API.

Ask the same question to an LLM without grounding:

> "Games that combine worker placement and deck building include Scythe, Viticulture, and Everdell. Scythe in particular blends resource management with worker placement in interesting ways..."

Scythe doesn't have deck building. Everdell doesn't have traditional worker placement in the way the question implies. The model is pattern-matching on "games that sound like they should fit" from its training data. It has no access to the actual mechanics tags.

That's the problem Sanity Agent Context solves. Your AI agent doesn't consult training data. It queries your Content Lake.

---

## What you'll build

By the end of this tutorial you'll have:

- A Sanity project with a `boardGame` schema, populated from BGG's XML API
- A configured Agent Context document that scopes an AI agent to your board game data
- A minimal agent script that answers natural-language questions by running real GROQ queries against your Content Lake

No separate product frontend. Ingestion and the agent script run on your machine — but **Agent Context’s MCP endpoint only works after you deploy Sanity Studio** (hosted Studio, v5.1+). That one deploy is what unlocks the agent; see Step 5.

---

## Prerequisites

- **Node.js 20+** — [nodejs.org](https://nodejs.org). Run `node --version` to confirm.
- **A Sanity account** — free at [sanity.io](https://sanity.io)
- **A BoardGameGeek XML API token** — registration is required. Create an application at [boardgamegeek.com/applications](https://boardgamegeek.com/applications), then create a token and send it as `Authorization: Bearer …` on every API request. See [Using the XML API](https://boardgamegeek.com/using_the_xml_api).
- **An OpenAI API key** — the agent script uses GPT-4o by default. You can swap in any [Vercel AI SDK provider](https://sdk.vercel.ai/providers/ai-sdk-providers).
- **A few minutes to deploy Studio** — Agent Context is useless without it: the MCP server returns an error until Studio is deployed to Sanity’s hosting (`*.sanity.studio`). Local `npm run dev` alone is not enough.
- Comfort running npm commands in a terminal

---

## Step 1: Create a Sanity project

```bash
npm create sanity@latest -- --template clean --dataset production --output-path bgg-agent
cd bgg-agent
```

Follow the prompts. When asked about a framework, choose **none** — this tutorial doesn't need a frontend.

**Expected output:**
```
✔  Bootstrapping files from template
✔  Resolving latest module versions
✔  Running 'npm install'

Success! Your Sanity project is ready.
```

Your project ID appears in the output and in `sanity.config.ts`. Keep it handy.

**Alternative — clone from GitHub:** Clone the repo, run `npm install`, copy [`.env.example`](../.env.example) to `.env`, and set **`projectId`** / **`dataset`** in **`sanity.config.ts`** and **`sanity.cli.ts`** to your own project. Continue from Step 2.

---

## Step 2: Define the board game schema

Open `schemaTypes/index.ts` and replace its contents:

```typescript
import {defineField, defineType} from 'sanity'

const boardGameType = defineType({
  name: 'boardGame',
  title: 'Board Game',
  type: 'document',
  fields: [
    defineField({name: 'bggId', title: 'BGG ID', type: 'number'}),
    defineField({name: 'name', title: 'Name', type: 'string'}),
    defineField({name: 'yearPublished', title: 'Year Published', type: 'number'}),
    defineField({name: 'minPlayers', title: 'Min Players', type: 'number'}),
    defineField({name: 'maxPlayers', title: 'Max Players', type: 'number'}),
    defineField({name: 'minPlaytime', title: 'Min Playtime (min)', type: 'number'}),
    defineField({name: 'maxPlaytime', title: 'Max Playtime (min)', type: 'number'}),
    defineField({name: 'averageRating', title: 'BGG Average Rating', type: 'number'}),
    defineField({name: 'weight', title: 'Complexity Weight (1–5)', type: 'number'}),
    defineField({
      name: 'categories',
      title: 'Categories',
      type: 'array',
      of: [{type: 'string'}],
    }),
    defineField({
      name: 'mechanics',
      title: 'Mechanics',
      type: 'array',
      of: [{type: 'string'}],
    }),
    defineField({
      name: 'designers',
      title: 'Designers',
      type: 'array',
      of: [{type: 'string'}],
    }),
  ],
})

export const schemaTypes = [boardGameType]
```

The `mechanics` and `categories` arrays are what make the GROQ queries genuinely useful later — they let the agent filter by structured tags rather than approximate text matching.

Deploy the schema to Content Lake so the Agent Context server knows your data shape:

```bash
npx sanity schema deploy
```

**Expected output:**
```
Deploying schema to project abc12345... done
```

---

## Step 3: Pull BGG data into Content Lake

Install the XML parsing package:

```bash
npm install fast-xml-parser
```

Create `ingest.mjs` at the project root:

```javascript
// ingest.mjs
import {createClient} from '@sanity/client'
import {XMLParser} from 'fast-xml-parser'

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID,
  dataset: 'production',
  apiVersion: '2026-01-01',
  token: process.env.SANITY_API_TOKEN,
  useCdn: false,
})

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['item', 'name', 'link'].includes(name),
})

function bggAuthHeaders() {
  const token = process.env.BGG_API_TOKEN?.trim()
  if (!token) {
    throw new Error(
      'Missing BGG_API_TOKEN in .env. BoardGameGeek’s XML API requires a registered application token. Register at https://boardgamegeek.com/applications and add: Authorization: Bearer <token> (see https://boardgamegeek.com/using_the_xml_api)',
    )
  }
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/xml, text/xml, */*',
  }
}

function normalizeItems(itemOrList) {
  if (itemOrList == null) return []
  return Array.isArray(itemOrList) ? itemOrList : [itemOrList]
}

/** BGG /xmlapi2/thing rejects more than 20 IDs per request */
const BGG_THING_BATCH_SIZE = 20

function chunkIds(ids, size) {
  const chunks = []
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size))
  }
  return chunks
}

// Stable IDs for BGG's all-time top games — ensures rich demo data
// regardless of what's trending on the hot list this week
const FEATURED_IDS = [
  174430, // Gloomhaven
  161936, // Pandemic Legacy: Season 1
  233078, // Twilight Imperium: 4th Edition
  167791, // Terraforming Mars
  224517, // Brass: Birmingham
  342942, // Ark Nova
  316554, // Dune: Imperium (worker placement + deck building)
  187645, // Spirit Island
  266192, // Wingspan
  291457, // Gloomhaven: Jaws of the Lion
]

async function fetchWithRetry(url, attempts = 3) {
  const headers = bggAuthHeaders()
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url, {headers})
    if (res.status === 202) {
      // BGG returns 202 when it's still assembling the response
      console.log('BGG is still processing — retrying in 3s...')
      await new Promise((r) => setTimeout(r, 3000))
      continue
    }
    const body = await res.text()
    if (!res.ok) {
      throw new Error(
        `BGG request failed (${res.status}): ${body.slice(0, 300).trim()}`,
      )
    }
    return body
  }
  throw new Error(`Failed to fetch after ${attempts} attempts: ${url}`)
}

async function fetchHotGameIds() {
  const xml = await fetchWithRetry('https://boardgamegeek.com/xmlapi2/hot?type=boardgame')
  const result = parser.parse(xml)
  const items = normalizeItems(result.items?.item)
  return items.map((item) => item['@_id']).filter(Boolean)
}

async function fetchGameDetailsBatch(ids) {
  const xml = await fetchWithRetry(
    `https://boardgamegeek.com/xmlapi2/thing?id=${ids.join(',')}&stats=1`,
  )
  const result = parser.parse(xml)
  const items = normalizeItems(result.items?.item)
  if (items.length === 0) {
    throw new Error('BGG returned no game items for the requested IDs')
  }
  return items
}

async function fetchAllGameDetails(ids) {
  const batches = chunkIds(ids, BGG_THING_BATCH_SIZE)
  const allItems = []
  for (let i = 0; i < batches.length; i++) {
    if (i > 0) {
      // BGG asks for a short delay between requests
      await new Promise((r) => setTimeout(r, 2000))
    }
    const batch = batches[i]
    console.log(
      `Fetching game details batch ${i + 1}/${batches.length} (${batch.length} games)...`,
    )
    const items = await fetchGameDetailsBatch(batch)
    allItems.push(...items)
  }
  return allItems
}

function transformGame(game) {
  const primaryName = game.name?.find?.((n) => n['@_type'] === 'primary') ?? game.name?.[0]
  const links = Array.isArray(game.link) ? game.link : []

  return {
    _id: `boardgame-${game['@_id']}`,
    _type: 'boardGame',
    bggId: parseInt(game['@_id']),
    name: primaryName?.['@_value'] ?? 'Unknown',
    yearPublished: parseInt(game.yearpublished?.['@_value']) || null,
    minPlayers: parseInt(game.minplayers?.['@_value']) || null,
    maxPlayers: parseInt(game.maxplayers?.['@_value']) || null,
    minPlaytime: parseInt(game.minplaytime?.['@_value']) || null,
    maxPlaytime: parseInt(game.maxplaytime?.['@_value']) || null,
    averageRating: parseFloat(game.statistics?.ratings?.average?.['@_value']) || null,
    weight: parseFloat(game.statistics?.ratings?.averageweight?.['@_value']) || null,
    categories: links
      .filter((l) => l['@_type'] === 'boardgamecategory')
      .map((l) => l['@_value']),
    mechanics: links
      .filter((l) => l['@_type'] === 'boardgamemechanic')
      .map((l) => l['@_value']),
    designers: links
      .filter((l) => l['@_type'] === 'boardgamedesigner')
      .map((l) => l['@_value']),
  }
}

const hotIds = await fetchHotGameIds()
console.log(`Fetched ${hotIds.length} IDs from BGG hot list`)

// Merge hot list with featured classics, deduplicate
const allIds = [...new Set([...FEATURED_IDS.map(String), ...hotIds])]
console.log(`Fetching details for ${allIds.length} games...`)

const games = await fetchAllGameDetails(allIds)
const docs = games.map(transformGame)

const tx = client.transaction()
docs.forEach((doc) => tx.createOrReplace(doc))
const result = await tx.commit()
console.log(`Imported ${result.results.length} board games into Content Lake`)
```

Create a `.env` file at the project root. For Sanity, go to `sanity.io/manage`, open your project, click **API → Tokens**, and create one with **Editor** permissions. For BGG, use the bearer token from [Applications → Tokens](https://boardgamegeek.com/applications) for your registered app.

```
SANITY_PROJECT_ID=your_project_id
SANITY_API_TOKEN=your_editor_token
BGG_API_TOKEN=your_bgg_bearer_token
```

Run the ingestion:

```bash
node --env-file=.env ingest.mjs
```

**Expected output:**
```
Fetched 50 IDs from BGG hot list
Fetching details for 58 games...
Fetching game details batch 1/3 (20 games)...
Fetching game details batch 2/3 (20 games)...
Fetching game details batch 3/3 (18 games)...
Imported 58 board games into Content Lake
```

BGG’s `thing` endpoint accepts at most **20 IDs per request**; the script batches automatically and waits 2 seconds between batches.

### Ingest ~250 games (optional)

The repo includes **`data/bgg-ranked-ids.json`** — 250 game IDs produced from a large BGG geeklist (see the `note` field in that file for caveats). To **regenerate** the list from another geeklist, or cap at a different length:

```bash
npm run rank-ids -- 234959 ./data/bgg-ranked-ids.json 250
```

Arguments: `geeklistId`, output path (optional), max IDs (optional). Geeklist exports are often **queued**; the script waits until XML is ready.

Then import up to that many games (details still come from `/xmlapi2/thing`; commits are **chunked** so Sanity stays happy):

```bash
npm run ingest:top250
# same as:
# node --env-file=.env ingest.mjs 250
# or: INGEST_TOP_N=250 node --env-file=.env ingest.mjs
```

For **strict BGG global rank order**, replace `ids` using the official **`bg_ranks`** CSV from [boardgamegeek.com/data_dumps/bg_ranks](https://boardgamegeek.com/data_dumps/bg_ranks) (usually requires logging into BGG in a browser with an approved API application), then keep only the first 250 rows’ IDs in `data/bgg-ranked-ids.json`.

Start the Studio (`npm run dev`, then open `localhost:3333`). After the default small ingest you should see on the order of **~60** board games; after `ingest:top250`, **~250**, each with ratings, complexity weights, mechanics, categories, player counts, playtime ranges, and designer credits from BGG.

---

## Step 4: Install Agent Context

```bash
npm install @sanity/agent-context
```

Open `sanity.config.ts` and add the plugin:

```typescript
import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {agentContextPlugin} from '@sanity/agent-context/studio'
import {schemaTypes} from './schemaTypes'

export default defineConfig({
  name: 'default',
  title: 'BGG Agent',
  projectId: 'your-project-id',
  dataset: 'production',
  plugins: [structureTool(), agentContextPlugin()],
  schema: {types: schemaTypes},
})
```

Restart the Studio after the config change.

---

## Step 5: Deploy Studio (required for Agent Context MCP)

The Agent Context **MCP URL** only accepts traffic for projects whose dataset is tied to a **deployed** Sanity Studio (version **5.1.0 or newer). Running Studio on `localhost` is fine for editing content, but it does **not** satisfy that requirement — you will get an HTTP **400** with a message like *“Only datasets with deployed Studio applications are supported”* until you deploy.

From the project root:

```bash
npx sanity deploy
```

Follow the prompts, sign in if asked, and choose a hostname (for example `your-name-bgg-agent.sanity.studio`). Wait until the CLI reports a successful deploy and prints your **hosted Studio URL**.

**Why this matters:** Agent Context runs on Sanity’s API and needs to associate your dataset with the schema and tools from a **production** Studio deployment — the same source of truth you use when you ship Studio, not an ephemeral dev server.

You can keep using `npm run dev` for day-to-day editing; the hosted deploy can be updated any time with `npx sanity deploy` again after schema or plugin changes.

---

## Step 6: Create the Agent Context document

In the Studio sidebar, you'll see a new **Agent Context** section. Click it, then **Create new Agent Context**. Fill in these fields:

| Field | Value |
|---|---|
| Name | `Board Game Oracle` |
| Slug | `board-games` |
| GROQ filter | `_type == "boardGame"` — must match the schema **exactly** (`boardGame` camelCase). `_type == "boardgame"` returns **zero** documents. |
| Instructions | `You are a board game expert with access to a live BGG-sourced dataset in Sanity. Always use groq_query before claiming there are no matches; use schema_explorer if unsure of field values. BGG mechanics and categories are exact strings: e.g. deck-building is "Deck, Bag, and Pool Building" (not "Deck Building"); cooperative play is often mechanics "Co-operative Play" or categories "Cooperative Game". For every game you mention, add a 2–3 sentence description using only fields from the query (year, players, playtime, mechanics, categories, designers, weight, averageRating)—no invented facts.` |

Save the document. The Studio generates an **MCP URL** (the API path includes a date version, e.g. `v2026-04-09` — use exactly what Studio shows, not a guess):

```
https://api.sanity.io/vYYYY-MM-DD/agent-context/your-project-id/production/board-games
```

Copy it.

---

## Step 7: Connect the agent

Install the Vercel AI SDK packages:

```bash
npm install ai @ai-sdk/openai @ai-sdk/mcp
```

Create `agent.mjs` at the project root:

Use the **`agent.mjs`** in the repo (kept in sync with this tutorial). Important details for **AI SDK v6**:

- `generateText`’s **`text` field is only the last step**. After tool calls, that last step is often empty, so `console.log(text)` prints nothing. The script joins **`result.steps`** text instead and allows up to **20** steps (`stopWhen: stepCountIs(20)`).
- Progress lines go to **stderr** (`Connecting…`, `Loading MCP tools…`, `Calling model…`) so you know it is not hung — the model step can take **20–60 seconds**.
- The question is **`process.argv.slice(2).join(' ')`** so quoted phrases with spaces work as a single prompt.

```javascript
// agent.mjs — see repository for full file; outline:
// - validate SANITY_CONTEXT_MCP_URL, SANITY_API_READ_TOKEN, OPENAI_API_KEY
// - textFromResult(result) → join non-empty result.steps[].text, else result.text
// - question = process.argv.slice(2).join(' ') || default
// - createMCPClient → tools() → generateText({ model: openai('gpt-4o'), tools, stopWhen: stepCountIs(20), messages })
// - console.log(textFromResult(result)) or error with finishReason / steps
```

Add three more variables to `.env`. Create a second API token with **Viewer** permissions for read access — keep it separate from the write token:

```
SANITY_CONTEXT_MCP_URL=<paste the full URL from the Agent Context document in Studio>
SANITY_API_READ_TOKEN=your_viewer_token
OPENAI_API_KEY=your_openai_key
```

**Troubleshooting:**

- *Only datasets with deployed Studio applications are supported* — complete Step 5 (`npx sanity deploy`) and confirm a hosted Studio appears in [sanity.io/manage](https://www.sanity.io/manage).
- **No output on stdout** but stderr shows `Calling model…` — usually fixed by aggregating **`result.steps`** text (see above); do not rely on `result.text` alone in AI SDK v6 with tools.
- **Agent always says “couldn’t find” games** — In Studio, confirm the Agent Context **GROQ filter** uses `_type == "boardGame"` (camelCase). Then remember BGG **`mechanics` / `categories` values are exact strings** (e.g. `"Deck, Bag, and Pool Building"`, `"Co-operative Play"`, `"Cooperative Game"`). The `agent.mjs` **system** prompt and the table above steer the model; re-save the Agent Context document after edits.

---

## The payoff

Run these queries and watch what comes back.

**Query 1: Find games that combine two specific mechanics**

```bash
node --env-file=.env agent.mjs "Find games that combine Worker Placement with Deck Building"
```

The agent fires this GROQ query internally:

```groq
*[_type == "boardGame"
  && "Worker Placement" in mechanics
  && "Deck, Bag, and Pool Building" in mechanics
]{name, weight, averageRating, yearPublished, designers}
```

It returns real games with both mechanics tags — not a plausible-sounding guess.

**Query 2: The specificity test**

Before running the agent, open ChatGPT or Claude in your browser and ask:

> "What is the BGG complexity weight of Wingspan?"

You'll get something like "Wingspan has a medium complexity, generally rated around 2.5 to 3." The actual BGG weight is 2.45 — the LLM is interpolating from its training data rather than reading the number.

Now run it through the agent:

```bash
node --env-file=.env agent.mjs "What is the exact complexity weight and average rating of Wingspan?"
```

The agent queries:

```groq
*[_type == "boardGame" && name == "Wingspan"][0]{name, weight, averageRating, mechanics, designers}
```

Returns: `weight: 2.45, averageRating: 8.08`. Pulled from BGG's API at ingestion time. Not interpolated.

**Query 3: Something that requires structured data to answer at all**

```bash
node --env-file=.env agent.mjs "Which game in the database has the most mechanics listed?"
```

No LLM without access to your Content Lake can answer this accurately. There is no pattern to match on — it requires counting array lengths across real records and finding the maximum. The agent runs a GROQ expression, reads the result, and tells you exactly which game it is and how many mechanics it has.

---

## What's happening under the hood

When you ask the agent a question, it reaches the Agent Context MCP server. That server gives the agent three tools to work with: `initial_context` (a compressed overview of your schema, field names, and document count), `groq_query` (full GROQ access to your Content Lake), and `schema_explorer` (field-level inspection, so the agent constructs accurate queries without guessing at field names).

That MCP server only serves datasets that have a **deployed Studio** registered for the project — which is why `npx sanity deploy` is part of this flow, not an optional production extra.

The agent doesn't retrieve context and answer from memory. It runs queries, reads the results, and builds its response from live data. The instructions in the Agent Context document guide how it frames and presents those results.

Your Sanity content isn't static information baked into the model at training time. It's live structured data the agent can query with the precision of a database.

---

## Where to take this next

The default ingestion pulls hot + featured (~60 games). For **~250** titles, use `npm run ingest:top250` and `data/bgg-ranked-ids.json` (see Step 3). To go larger, regenerate that file from a bigger geeklist or from BGG’s **`bg_ranks`** CSV, then run `node --env-file=.env ingest.mjs <N>`. The schema and Agent Context document stay the same.

The `groqFilter` field in the Agent Context document is worth experimenting with. Set it to `_type == "boardGame" && weight > 3.5` and the agent only sees heavier games. Set it to `_type == "boardGame" && "Co-operative Play" in mechanics` and you've scoped the agent to cooperative games only. The filter controls what the agent can access; the instructions control how it responds.

The same pattern works for any structured dataset. Product catalogs, legal case libraries, technical documentation, medical references. Once your content is in Content Lake, Agent Context is how you give any AI agent accurate, queryable access to it — without retraining and without hallucination.
