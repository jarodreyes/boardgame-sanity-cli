// Requires: SANITY_CONTEXT_MCP_URL, SANITY_API_READ_TOKEN (Viewer), OPENAI_API_KEY
// Agent Context MCP only works after `npx sanity deploy` (hosted Studio v5.1+); see tutorial Step 5.
import {generateText, stepCountIs} from 'ai'
import {createMCPClient} from '@ai-sdk/mcp'
import {openai} from '@ai-sdk/openai'

const mcpUrl = process.env.SANITY_CONTEXT_MCP_URL?.trim()
const readToken = process.env.SANITY_API_READ_TOKEN?.trim()
if (!mcpUrl || !readToken) {
  console.error(
    'Set SANITY_CONTEXT_MCP_URL and SANITY_API_READ_TOKEN in .env.\n' +
      'Create an Agent Context in Studio and copy the MCP URL; use a Viewer token from sanity.io/manage.',
  )
  process.exit(1)
}

if (!process.env.OPENAI_API_KEY?.trim()) {
  console.error('Set OPENAI_API_KEY in .env.')
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

/** Ground the model: BGG uses exact, title-case strings; casual words won’t match `in mechanics`. */
const AGENT_SYSTEM = `You query a Sanity dataset of board games (_type must be exactly "boardGame", camelCase) imported from BoardGameGeek.

Before you say there are no matches, you MUST call groq_query successfully at least once to confirm scope (e.g. count or a 3-row sample). Never claim the dataset is empty or has no cooperative / deck-building / trading games without a GROQ result proving it.

Field tips (arrays of strings — use exact BGG spelling with "in"):
- Worker placement: mechanics contains "Worker Placement"
- Deck building: use "Deck, Bag, and Pool Building" — NOT the casual phrase "Deck Building" alone
- Cooperative: try mechanics "Co-operative Play" (hyphen) OR categories "Cooperative Game"
- Trading / economic: try categories like "Economic", "Negotiation", "Industry / Manufacturing", or search mechanics for "Trading" if present; combine with minPlayers/maxPlayers for player count

Prefer schema_explorer or a small exploratory groq_query if unsure of exact tokens.

When you list games (one or many), for **each** title include a **brief description** (2–3 sentences) in plain language, using **only** facts present in that game’s query result: year, player range, playtime range, weight, average rating, notable mechanics and categories, and designers. Do not invent mechanics or categories that are not in the data. End each game block with the numeric weight and rating when available.`

let mcpClient
try {
  console.error('Connecting to Agent Context MCP…')
  mcpClient = await createMCPClient({
    transport: {
      type: 'http',
      url: mcpUrl,
      headers: {
        Authorization: `Bearer ${readToken}`,
      },
    },
  })

  console.error('Loading MCP tools…')
  const tools = await mcpClient.tools()

  console.error('Calling model (this can take 20–60s)…')
  const result = await generateText({
    model: openai('gpt-4o'),
    tools,
    stopWhen: stepCountIs(25),
    system: AGENT_SYSTEM,
    messages: [{role: 'user', content: question}],
  })

  const out = textFromResult(result)
  if (out) {
    console.log(out)
  } else {
    console.error(
      'Model finished with no assistant text. finishReason=%s steps=%s',
      result.finishReason,
      result.steps?.length ?? 0,
    )
    const last = result.steps?.at(-1)
    if (last?.toolResults?.length) {
      console.error('Last step had tool results but no text — try raising stopWhen or check Agent Context instructions.')
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
      '\nAgent Context MCP requires a deployed Studio (v5.1+). Run: npx sanity deploy\n' +
        'Local npm run dev is not enough. See the tutorial Step 5.\n',
    )
  }
}
