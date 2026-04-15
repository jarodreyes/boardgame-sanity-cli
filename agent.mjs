// Requires: SANITY_CONTEXT_MCP_URL, SANITY_API_READ_TOKEN (Viewer), OPENAI_API_KEY
// Agent Context MCP only works after `npx sanity deploy` (hosted Studio v5.1+); see tutorial Step 5.
// Set NO_COLOR=1 or pipe stdout to disable ANSI in the answer body.
import 'dotenv/config'
import {generateText, stepCountIs} from 'ai'
import {createMCPClient} from '@ai-sdk/mcp'
import {openai} from '@ai-sdk/openai'
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

/** Ground the model: BGG uses exact, title-case strings; casual words won’t match `in mechanics`. */
const AGENT_SYSTEM = `You query a Sanity dataset of board games (_type must be exactly "boardGame", camelCase) imported from BoardGameGeek.

**Query ladder (non-negotiable):** (1) Run a \`groq_query\` that matches the user’s wording (including year if they implied one). (2) If it returns **zero** documents, your **immediate next tool call** MUST be another \`groq_query\` with the **same cooperative + player logic** but **no** \`yearPublished\` filter, ordered by \`averageRating desc\`, limit at least 10 — e.g. \`*[_type == "boardGame" && ("Co-operative Play" in mechanics || "Cooperative Game" in categories) && minPlayers <= N && maxPlayers >= N] | order(averageRating desc) [0...9]\` with their N. (3) If still zero, drop the player filter but keep cooperative + sort by rating; if still zero, run \`*[_type == "boardGame"] | order(averageRating desc) [0...5]{name, mechanics, categories, ...}\` to confirm the dataset is non-empty. **You may not** answer with “there are none”, “it seems”, or “would you like to explore…” until steps (2)–(3) have actually run when (1) was empty. When (2) or (3) returns games, **list them by name** and briefly say you widened the filter (e.g. removed year). Small ingests: be honest about year coverage, but still show concrete titles from the ladder.

Temporal: map "recent" / "new" / "just came out" to \`yearPublished\` using a **range**, not a single past year. For "last year" in casual speech, people often mean **the last ~12–18 months of releases** — include the **current calendar year** and the previous one (e.g. if now is 2026, use \`yearPublished >= 2025\` or \`yearPublished in [2025, 2026]\`), **not** \`yearPublished == 2025\` alone, unless the user explicitly names one past year only. Games "launched" in the current year must not be excluded by a narrow "previous year only" filter.

Players: "for N players" or "supports N" means \`minPlayers <= N && maxPlayers >= N\`.

Highly rated: use \`averageRating\` — e.g. order by \`averageRating desc\` and cap with \`[0…5]\` or a numeric threshold when useful.

Field tips (arrays of strings — use exact BGG spelling with "in"):
- Worker placement: mechanics contains "Worker Placement"
- Deck building: use "Deck, Bag, and Pool Building" — NOT the casual phrase "Deck Building" alone
- Cooperative: use \`("Co-operative Play" in mechanics || "Cooperative Game" in categories)\` — check **both**; do not require only one field
- Trading / economic: try categories like "Economic", "Negotiation", "Industry / Manufacturing", or search mechanics for "Trading" if present

Prefer schema_explorer or a small exploratory groq_query if unsure of exact tokens.

When you list games (one or many), **always lead with the game’s \`name\`** (bold the title). Never use the designer as the list heading or as a substitute for the title — designers are supporting detail only. Each numbered item must show **Title → then** year, designers, mechanics, categories, players, playtime, then a **brief description** (2–3 sentences) using **only** facts from the query. End each game block with numeric **weight** and **averageRating** when available. Your groq_query projections must include \`name\` whenever you return games.`

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
  const result = await generateText({
    model: openai('gpt-4o'),
    tools,
    stopWhen: stepCountIs(25),
    system: AGENT_SYSTEM,
    messages: [{role: 'user', content: question}],
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
              'Local npm run dev is not enough. See the tutorial Step 5.\n',
          )
        : '\nAgent Context MCP requires a deployed Studio (v5.1+). Run: npx sanity deploy\n' +
            'Local npm run dev is not enough. See the tutorial Step 5.\n',
    )
  }
}
