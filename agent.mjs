// Requires: SANITY_CONTEXT_MCP_URL, SANITY_API_READ_TOKEN (Viewer), OPENAI_API_KEY
// Optional Agent Insights: SANITY_PROJECT_ID + SANITY_INSIGHTS_WRITE_TOKEN (Editor) — see docs/agent-context.md
// Agent Context MCP only works after `npx sanity deploy` (hosted Studio v5.1+); see README and https://www.sanity.io/docs/ai/agent-context
// Set NO_COLOR=1 or pipe stdout to disable ANSI in the answer body.
import 'dotenv/config'
import {randomUUID} from 'node:crypto'
import {generateText, stepCountIs} from 'ai'
import {createMCPClient} from '@ai-sdk/mcp'
import {openai} from '@ai-sdk/openai'
import {createClient} from '@sanity/client'
import {sanityInsightsIntegration} from './agent-insights-telemetry.mjs'
import boxen from 'boxen'
import chalk from 'chalk'

const ansiStdout = process.stdout.isTTY && !process.env.NO_COLOR
const ansiStderr = process.stderr.isTTY && !process.env.NO_COLOR

function errDim(msg) {
  console.error(ansiStderr ? chalk.dim(msg) : msg)
}

function errStep(msg) {
  console.error(ansiStderr ? chalk.cyan('›') + ' ' + chalk.dim(msg) : msg)
}

function printQuestion(q) {
  if (ansiStderr) {
    console.error(
      boxen(q, {
        title: chalk.bold.cyan('Question'),
        titleAlignment: 'left',
        padding: {top: 0, bottom: 0, left: 1, right: 1},
        margin: {top: 0, bottom: 1},
        borderStyle: 'round',
        borderColor: 'cyan',
      }),
    )
  } else {
    console.error(`Question:\n${q}\n`)
  }
}

/** Light Markdown → ANSI for typical model replies (bold, `code`, headers, links). */
function formatAssistantText(text) {
  if (!ansiStdout) {
    return text
      .replace(/\*\*(.+?)\*\*/gs, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/^#{1,3} /gm, '')
  }
  let t = text
  t = t.replace(/^### (.+)$/gm, (_, h) => chalk.magenta.bold(`▸ ${h}`))
  t = t.replace(/^## (.+)$/gm, (_, h) => chalk.magenta.bold(h))
  t = t.replace(/^# (.+)$/gm, (_, h) => chalk.magenta.bold.underline(h))
  t = t.replace(/\*\*(.+?)\*\*/gs, (_, x) => chalk.bold.whiteBright(x))
  t = t.replace(/`([^`]+)`/g, (_, x) => chalk.green(x))
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) =>
    chalk.blue.underline(label) + chalk.dim(` · ${url}`),
  )
  return t
}

const mcpUrl = process.env.SANITY_CONTEXT_MCP_URL?.trim()
const readToken = process.env.SANITY_API_READ_TOKEN?.trim()
if (!mcpUrl || !readToken) {
  console.error(
    ansiStderr
      ? chalk.red.bold('✖ ') +
          chalk.red(
            'Set SANITY_CONTEXT_MCP_URL and SANITY_API_READ_TOKEN in .env.\n' +
              'Create an Agent Context in Studio and copy the MCP URL; use a Viewer token from sanity.io/manage.',
          )
      : 'Set SANITY_CONTEXT_MCP_URL and SANITY_API_READ_TOKEN in .env.\n' +
          'Create an Agent Context in Studio and copy the MCP URL; use a Viewer token from sanity.io/manage.',
  )
  process.exit(1)
}

if (!process.env.OPENAI_API_KEY?.trim()) {
  console.error(ansiStderr ? chalk.red.bold('✖ ') + chalk.red('Set OPENAI_API_KEY in .env.') : 'Set OPENAI_API_KEY in .env.')
  process.exit(1)
}

/** AI SDK v6: `result.text` is only the *last* step; tool rounds often leave it empty. */
function textFromResult(result) {
  const fromSteps = result.steps
    .map((s) => (typeof s.text === 'string' ? s.text.trim() : ''))
    .filter(Boolean)
    .join('\n\n')
    .trim()
  if (fromSteps) return fromSteps
  if (typeof result.text === 'string' && result.text.trim()) return result.text.trim()
  return ''
}

const question =
  process.argv.slice(2).join(' ').trim() || 'How many board games are in the database?'

printQuestion(question)

/** UTC clock for this process — models default "new" to stale years without it (see NOTES_FOR_ENG.md). */
function clockPreamble() {
  const iso = new Date().toISOString()
  const utcDate = iso.slice(0, 10)
  const utcYear = Number(iso.slice(0, 4))
  return `**Current moment (authoritative for this run):** UTC calendar date **${utcDate}**, calendar year **${utcYear}**. Any \`yearPublished\` filter for "new", "recent", "last year", "just came out", or release timing **must** follow this moment — **never** choose years from training memory alone.`
}

function agentSystemMessage() {
  return `${clockPreamble()}\n\n${AGENT_SYSTEM_BODY}`
}

/** Ground the model: BGG uses exact, title-case strings; casual words won’t match `in mechanics`. */
const AGENT_SYSTEM_BODY = `You query a Sanity dataset of board games (_type must be exactly "boardGame", camelCase) imported from BoardGameGeek.

**Query ladder (zero rows on a cooperative ask):** If the user asked for **cooperative** play and the first \`groq_query\` returns **zero** documents: (2) your **next** tool call MUST be another \`groq_query\` with the **same cooperative detection** (Field tips) **and** the same player logic but **no** \`yearPublished\` filter, \`| order(averageRating desc) [0...9]\`. (3) If still zero, drop the player filter but keep cooperative + sort; if still zero, run \`*[_type == "boardGame"] | order(averageRating desc) [0...5]{name, mechanics, categories, ...}\` to prove the dataset is non-empty. **You may not** answer with “there are none”, “it seems”, “issue retrieving”, “couldn’t find”, or “would you like to explore…” until those widening steps have **actually run** when (1) was empty for that cooperative ask. When widening returns games, **list titles** and state what you relaxed.

**Multi-constraint asks (co-op + players + playtime + “new” + several themes):** First \`groq_query\` with **every** constraint you can express with exact BGG strings. On **zero** rows, run **additional** \`groq_query\` calls and relax **one axis at a time** (separate query per relaxation), typical order: drop or widen \`yearPublished\` → widen \`maxPlaytime\` (e.g. try \`maxPlaytime <= 40\` then \`<= 45\` if the user said “under 30 minutes” and nothing matches) → replace **AND** of optional taste tags with **OR** (\`Narrative Choice / Paragraph\` **or** \`City Building\`) while keeping must-haves (often co-op + player count). After a zero hit you need **at least two** widening queries before claiming nothing fits—unless the broadest probe shows **no** \`boardGame\` documents at all.

**No déjà vu:** The dataset may be small. Do **not** answer unrelated questions with the same default \`order(averageRating desc)[0...4]\` slice. Rank and filter for **this** question; prefer games that match **more** of the requested tags over famous titles that ignore half the ask.

**Tool errors:** If \`groq_query\` (or any tool) returns an error, read the message, fix the GROQ, and **retry once** before telling the user data could not be retrieved.

Temporal: the **Current moment** block above is the source of truth for "now". Map "recent" / "new" / "just came out" to \`yearPublished\` using a **range** anchored on that year, not a single stale year. For "last year" in casual speech, people often mean **the last ~12–18 months of releases** — include the **current calendar year** and the previous one (e.g. if the authoritative year is 2026, use \`yearPublished >= 2025\` or \`yearPublished in [2025, 2026]\`), **not** \`yearPublished == 2025\` alone, unless the user explicitly names one past year only. Games "launched" in the current year must not be excluded by a narrow "previous year only" filter. **Do not** use arbitrary old windows (e.g. \`yearPublished in [2022, 2023]\` when the authoritative year is 2024 or later) for "new" — that is incorrect for the user’s intent.

Players: "for N players" or "supports N" means \`minPlayers <= N && maxPlayers >= N\`.

Highly rated: use \`averageRating\` when ordering, but **tie-break toward relevance** to the user’s tags and playtime — not global popularity alone when the user gave specific tastes.

Field tips (arrays of strings — use exact BGG spelling with "in"):
- Worker placement: mechanics contains "Worker Placement"
- Deck building: use "Deck, Bag, and Pool Building" — NOT the casual phrase "Deck Building" alone
- Cooperative: use \`("Co-operative Play" in mechanics || "Cooperative Game" in mechanics || "Cooperative Game" in categories)\` — BGG sometimes lists **Cooperative Game** under mechanics; check **all three**
- Narrative: casual "narrative games" → mechanic **"Narrative Choice / Paragraph"** (exact string); use \`schema_explorer\` if unsure
- City building: category **"City Building"** (exact string)
- Trading / economic: try categories like "Economic", "Negotiation", "Industry / Manufacturing", or search mechanics for "Trading" if present

Prefer schema_explorer or a small exploratory groq_query if unsure of exact tokens.

When you list games (one or many), **always lead with the game’s \`name\`** (bold the title). Never use the designer as the list heading or as a substitute for the title — designers are supporting detail only. Each numbered item must show **Title → then** year, designers, mechanics, categories, players, playtime, then **two or three short sentences** summarizing **only** what appears in those fields (there is **no** long marketing description in the dataset—do not invent story or rules from training data). End each game block with numeric **weight** and **averageRating** when available. Your groq_query projections must include \`name\` whenever you return games.`

let mcpClient
try {
  errStep('Connecting to Agent Context MCP…')
  mcpClient = await createMCPClient({
    transport: {
      type: 'http',
      url: mcpUrl,
      headers: {
        Authorization: `Bearer ${readToken}`,
      },
    },
  })

  errStep('Loading MCP tools…')
  const tools = await mcpClient.tools()

  errStep('Calling model (this can take 20–60s)…')

  const insightsToken = process.env.SANITY_INSIGHTS_WRITE_TOKEN?.trim()
  const insightsProjectId = process.env.SANITY_PROJECT_ID?.trim()
  const insightsDataset = process.env.SANITY_DATASET?.trim() || 'production'
  let experimental_telemetry
  if (insightsToken && insightsProjectId) {
    const insightsClient = createClient({
      projectId: insightsProjectId,
      dataset: insightsDataset,
      token: insightsToken,
      useCdn: false,
      apiVersion: '2026-01-01',
    })
    experimental_telemetry = {
      isEnabled: true,
      integrations: [
        sanityInsightsIntegration({
          client: insightsClient,
          agentId: process.env.SANITY_INSIGHTS_AGENT_ID?.trim() || 'bgg-agent-cli',
          threadId: randomUUID(),
        }),
      ],
    }
    errStep('Agent Insights: telemetry on (this run saved to Studio when classification runs)…')
  }

  const result = await generateText({
    model: openai('gpt-4o'),
    tools,
    stopWhen: stepCountIs(25),
    system: agentSystemMessage(),
    messages: [{role: 'user', content: question}],
    ...(experimental_telemetry ? {experimental_telemetry} : {}),
  })

  const out = textFromResult(result)
  if (out) {
    if (ansiStderr) {
      console.error(chalk.dim('─'.repeat(Math.min(56, (process.stdout.columns || 56) - 1))))
    }
    console.log(formatAssistantText(out))
    if (ansiStderr) {
      errDim(`Done · finishReason=${result.finishReason} · steps=${result.steps?.length ?? 0}`)
    }
  } else {
    console.error(
      ansiStderr
        ? chalk.red.bold('✖') +
            ' ' +
            chalk.red(
              `Model finished with no assistant text. finishReason=${result.finishReason} steps=${result.steps?.length ?? 0}`,
            )
        : `Model finished with no assistant text. finishReason=${result.finishReason} steps=${result.steps?.length ?? 0}`,
    )
    const last = result.steps?.at(-1)
    if (last?.toolResults?.length) {
      errDim('Last step had tool results but no text — try raising stopWhen or check Agent Context instructions.')
    }
    process.exitCode = 1
  }
} catch (err) {
  printDeployHintIfMcpRejected(err)
  throw err
} finally {
  if (mcpClient) await mcpClient.close().catch(() => {})
}

function printDeployHintIfMcpRejected(err) {
  const msg = String(err?.message ?? err)
  if (
    msg.includes('Only datasets with deployed Studio') ||
    msg.includes('-32004')
  ) {
    console.error(
      ansiStderr
        ? chalk.yellow(
            '\nAgent Context MCP requires a deployed Studio (v5.1+). Run: npx sanity deploy\n' +
              'Local npm run dev is not enough. See README and https://www.sanity.io/docs/ai/agent-context\n',
          )
        : '\nAgent Context MCP requires a deployed Studio (v5.1+). Run: npx sanity deploy\n' +
            'Local npm run dev is not enough. See README and https://www.sanity.io/docs/ai/agent-context\n',
    )
  }
}
