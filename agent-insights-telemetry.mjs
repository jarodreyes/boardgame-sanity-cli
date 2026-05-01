/**
 * Mirrors @sanity/agent-context/ai-sdk `sanityInsightsIntegration` for Node CLIs.
 * The published ai-sdk entry pulls saveConversation → conversationSchema → `sanity`
 * (Studio), which imports .css and breaks `node agent.mjs`.
 */
import {bindTelemetryIntegration} from 'ai'

const CONVERSATION_TYPE = 'sanity.agentContextConversation'

const VALID_ROLES = {user: 'user', assistant: 'assistant', system: 'system', tool: 'tool'}

function fnv1a64(str) {
  const FNV_PRIME = 0x00000100000001b3n
  const FNV_OFFSET = 0xcbf29ce484222325n
  const MASK_64 = 0xffffffffffffffffn
  let hash = FNV_OFFSET
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i))
    hash = (hash * FNV_PRIME) & MASK_64
  }
  return hash.toString(36)
}

function generateConversationId(agentId, threadId) {
  const sanitizedAgentId = agentId.replace(/[^a-zA-Z0-9-_]/g, '-')
  const sanitizedThreadId = threadId.replace(/[^a-zA-Z0-9-_]/g, '-')
  const hashSuffix = fnv1a64(`${agentId}:${threadId}`)
  return `agentconversation-${sanitizedAgentId}-${sanitizedThreadId}-${hashSuffix}`
}

async function saveConversation({client, agentId, threadId, messages}) {
  if (!agentId || typeof agentId !== 'string') {
    throw new Error('saveConversation: agentId must be a non-empty string')
  }
  if (!threadId || typeof threadId !== 'string') {
    throw new Error('saveConversation: threadId must be a non-empty string')
  }
  if (!Array.isArray(messages)) {
    throw new Error('saveConversation: messages must be an array')
  }
  const now = new Date().toISOString()
  const documentId = generateConversationId(agentId, threadId)
  const formattedMessages = messages.map((m) => ({
    role: m.role,
    content: m.content,
    ...(m.toolName !== undefined ? {toolName: m.toolName} : {}),
    ...(m.toolType !== undefined ? {toolType: m.toolType} : {}),
  }))
  await client
    .transaction()
    .createIfNotExists({
      _id: documentId,
      _type: CONVERSATION_TYPE,
      agentId,
      threadId,
      startedAt: now,
      messages: [],
    })
    .patch(documentId, (p) =>
      p.set({
        messages: formattedMessages,
        messagesUpdatedAt: now,
      }),
    )
    .commit({autoGenerateArrayKeys: true})
  return documentId
}

function normalizeRole(role) {
  return VALID_ROLES[role] ?? 'assistant'
}

function isObject(value) {
  return typeof value === 'object' && value !== null
}

function serializeContent(value, maxLength = 500) {
  if (value == null) return ''
  try {
    const json = JSON.stringify(value)
    return json.length > maxLength ? json.slice(0, maxLength) + '...(truncated)' : json
  } catch {
    return String(value)
  }
}

function isToolResult(part) {
  return 'result' in part || 'output' in part
}

function formatTextPart(part) {
  if (typeof part === 'string') return part
  if (isObject(part) && 'text' in part && typeof part.text === 'string') return part.text
  return JSON.stringify(part)
}

function contentToString(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(formatTextPart).join('\n')
  return formatTextPart(content)
}

function collectMessages(rawMessages) {
  const messages = []
  for (const raw of rawMessages) {
    if (
      raw.role === 'tool' &&
      Array.isArray(raw.content) &&
      raw.content.some((p) => isObject(p) && isToolResult(p))
    ) {
      continue
    }
    if (!Array.isArray(raw.content)) {
      messages.push({role: normalizeRole(raw.role), content: contentToString(raw.content)})
      continue
    }
    const textParts = []
    const toolCalls = []
    for (const part of raw.content) {
      if (isObject(part) && 'toolName' in part && !isToolResult(part)) {
        toolCalls.push(part)
      } else {
        textParts.push(part)
      }
    }
    if (textParts.length > 0) {
      messages.push({
        role: normalizeRole(raw.role),
        content: textParts.map(formatTextPart).join('\n'),
      })
    }
    for (const call of toolCalls) {
      const toolName = String(call.toolName)
      const args = call.input ?? call.args
      messages.push({
        role: 'tool',
        toolName,
        toolType: 'call',
        content: serializeContent(args),
      })
    }
  }
  return messages
}

function createSanityInsightsIntegration(config) {
  let inputMessages = null
  return {
    onStart(event) {
      if (inputMessages !== null) {
        console.warn(
          '[sanity-insights] Integration instance reused before previous request completed. Create a new integration instance for each generateText call.',
        )
      }
      inputMessages = event.messages ?? []
    },
    async onFinish(event) {
      const allRaw = [...(inputMessages ?? []), ...(event.response.messages ?? [])]
      inputMessages = null
      const messages = collectMessages(allRaw)
      if (messages.length === 0) return
      const agentId =
        typeof config.agentId === 'function' ? config.agentId() : config.agentId
      const threadId =
        typeof config.threadId === 'function' ? config.threadId() : config.threadId
      try {
        await saveConversation({client: config.client, agentId, threadId, messages})
      } catch (err) {
        console.error('[sanity-insights] Failed to save conversation:', err)
      }
    },
  }
}

export function sanityInsightsIntegration(config) {
  return bindTelemetryIntegration(createSanityInsightsIntegration(config))
}
