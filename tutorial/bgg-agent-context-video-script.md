# Video Script: Build a Board Game AI That Doesn't Guess

**Target runtime:** ~6–7 minutes (~900 words spoken) — includes `sanity deploy` for Agent Context
**Spoken delivery:** Conversational, direct. No filler phrases. Pause where marked.

---

## INTRO (0:00–0:45)

[ACTION: Terminal is visible, fullscreen. Cursor is at the prompt.]

Let me show you something before I explain anything.

[ACTION: Type and run the command:]
```
node --env-file=.env agent.mjs "Find games that combine Worker Placement with Deck Building"
```

[PAUSE — let the response stream in visibly]

[ACTION: Scroll to show full output — Dune: Imperium with weight, rating, and mechanics listed]

That's an AI agent telling me which board games in my database have *both* of those mechanics. Not guessing. Not pattern-matching from training data. It ran a real database query against a structured dataset I pulled from BoardGameGeek's API.

[PAUSE]

Now compare that to asking the same question to any large language model without grounding.

[ACTION: Switch to browser, open ChatGPT or Claude. Type the same question.]

[PAUSE — let the response appear]

You'll see games mentioned that don't actually have those mechanics, or games described as having mechanics they sort of have, kind of, if you squint. The model is doing its best from training data. It doesn't have access to the actual mechanics tags.

[ACTION: Switch back to terminal]

That difference is what this tutorial is about. We're going to build this from scratch — pulling BGG game data into Sanity's Content Lake, then using a feature called Agent Context to give an AI agent structured, queryable access to that data.

One heads-up: Agent Context's MCP server only works after you **deploy** Sanity Studio to Sanity's hosting — local dev isn't enough for the agent. We'll hit that explicitly when we get there.

Let's go.

---

## STEP 1: CREATE THE PROJECT (0:45–1:30)

[ACTION: Clear terminal, show a fresh prompt]

First, create a new Sanity project. One command:

[ACTION: Type and run:]
```
npm create sanity@latest -- --template clean --dataset production --output-path bgg-agent
```

[PAUSE — let it run, show the install output scrolling]

Follow the prompts — name the project whatever you like, skip the framework question. After it finishes, change into the new directory.

[ACTION: Run `cd bgg-agent`]

You now have a Sanity Studio project with an empty Content Lake. Your project ID is in `sanity.config.ts` — you'll need it shortly.

---

## STEP 2: SCHEMA (1:30–2:15)

[ACTION: Open schemaTypes/index.ts in a code editor side by side, or in terminal with a text editor]

We need to define what a board game document looks like in Sanity. Open `schemaTypes/index.ts` and replace its contents with the schema from the tutorial.

[ACTION: Paste the schema code — pause on the fields array so viewers can see the field names]

[PAUSE]

The interesting ones are these arrays at the bottom — `mechanics` and `categories`. BGG tags every game with structured lists of mechanics: Worker Placement, Deck Building, Area Control, and so on. Storing those as arrays in Content Lake is what lets us query across them precisely later.

Deploy the schema:

[ACTION: Run `npx sanity schema deploy`]

[PAUSE — show the "done" output]

---

## STEP 3: INGEST (2:15–3:30)

[ACTION: Open ingest.mjs in the editor — scroll through it slowly so viewers can see its structure]

This script does three things. It fetches BGG's current hot games list — 50 IDs. It merges that with a list of all-time top-rated games to make sure the demo queries work well regardless of what's trending this week. Then it fetches full details for all of those games from BGG's XML API, transforms them into Sanity documents, and imports them.

The whole script is a bit over 100 lines — including batching, because BGG only allows 20 game IDs per `thing` request.

[ACTION: Highlight the FEATURED_IDS array]

These hardcoded IDs are games like Dune: Imperium, Wingspan, Ark Nova — they're BGG's top-ranked all-time. We include them because they have rich mechanic tags that make the payoff queries really interesting.

[ACTION: Highlight the `fetchWithRetry` function briefly]

BGG's API occasionally returns a 202 while it's assembling the response. This handles that gracefully.

Now create your `.env` file with your project ID, a write token from `sanity.io/manage`, and your BoardGameGeek API bearer token from `boardgamegeek.com/applications`.

[ACTION: Show the .env file with placeholder values]

Then run it:

[ACTION: Run `node --env-file=.env ingest.mjs`]

[PAUSE — let it run; show batch progress lines, then the import count]

[ACTION: Open browser, navigate to localhost:3333 (Studio must already be running in another tab)]

[PAUSE — show the document list with board games, click into one to show the fields]

58 board games. Every one with a BGG rating, complexity weight, mechanics list, categories list, player count, and playtime. That's your Content Lake.

---

## STEP 4: AGENT CONTEXT (3:30–4:30)

[ACTION: Return to terminal]

Install the Agent Context plugin:

[ACTION: Run `npm install @sanity/agent-context`]

Add the plugin to `sanity.config.ts`:

[ACTION: Show the two-line diff — the import and the plugin in the array]

Restart the Studio.

[ACTION: Switch to Studio in browser, reload]

[PAUSE — point out the new "Agent Context" section in the sidebar]

Before the MCP URL will work from a script, you need a **hosted** Studio. From the terminal:

[ACTION: Run `npx sanity deploy` — jump-cut from spinner to success if needed]

Sanity will ask you to log in and pick a hostname on `sanity.studio`. When it's done, your project has a production Studio — that's what Agent Context checks for. You can still use `npm run dev` for editing; this deploy is what unlocks the agent.

[PAUSE]

Now create the Agent Context. In the sidebar, click **Agent Context**, then **Create**. Fill in a name, a slug, a GROQ filter, and instructions.

[ACTION: Type into the Studio form — pause on the instructions field so viewers can read it]

The GROQ filter `_type == "boardGame"` scopes the agent to only see board game documents. The instructions tell it to always use the GROQ query tool rather than answering from general knowledge.

[PAUSE]

Save the document. The Studio gives you an MCP URL — that's your agent's connection endpoint.

[ACTION: Copy the MCP URL, switch to terminal, open .env and paste it in]

---

## STEP 5: THE AGENT (4:30–5:00)

[ACTION: Open agent.mjs in the editor]

The agent script wires an MCP client to that URL, loads the tools — GROQ query, schema explorer, initial context — then calls the model with `generateText` and a small multi-step budget so it can run queries before answering.

Install the dependencies:

[ACTION: Run `npm install ai @ai-sdk/openai @ai-sdk/mcp`]

Add your OpenAI key to `.env`.

[ACTION: Show the final .env file with all variables (including BGG and OpenAI), values masked]

---

## THE PAYOFF (5:00–6:00)

[ACTION: Run the first query:]
```
node --env-file=.env agent.mjs "Find games that combine Worker Placement with Deck Building"
```

[PAUSE — let it run, watch the output stream]

That's Dune: Imperium. And its sequel. Both have exactly those two mechanics in their BGG records.

[ACTION: Run the second query:]
```
node --env-file=.env agent.mjs "What is the exact complexity weight and average rating of Wingspan?"
```

[PAUSE]

Weight: 2.45. Rating: 8.08. Pulled from BGG's API. Not interpolated.

[ACTION: Run the third query:]
```
node --env-file=.env agent.mjs "Which game in the database has the most mechanics listed?"
```

[PAUSE — let it complete]

That one required the agent to count array lengths across every game record and find the maximum. There's no way to answer it without access to the actual data.

[PAUSE]

That's the shift. You gave an AI agent a database instead of a prompt. It queries instead of guesses. The content in your Content Lake isn't context baked into the model — it's live structured data the agent can reach any time you ask it something.

The tutorial link is in the description. It covers how to scale the ingestion to thousands of games and how to scope what the agent sees with different GROQ filters.

[ACTION: Fade out or cut]
