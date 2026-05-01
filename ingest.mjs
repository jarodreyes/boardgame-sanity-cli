// ingest.mjs
import 'dotenv/config'
import {readFile} from 'node:fs/promises'
import path from 'node:path'
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

/** Sanity: avoid oversized single transactions on large imports */
const SANITY_TX_CHUNK = 100

function parseIngestTopN() {
  const fromEnv = process.env.INGEST_TOP_N?.trim()
  if (fromEnv && /^\d+$/.test(fromEnv)) {
    return parseInt(fromEnv, 10)
  }
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--top=')) {
      const n = parseInt(arg.slice(6), 10)
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  const pos = process.argv[2]
  if (pos && /^\d+$/.test(pos)) return parseInt(pos, 10)
  return null
}

async function loadRankedIdsFromJson() {
  const fp = path.join(process.cwd(), 'data', 'bgg-ranked-ids.json')
  const data = JSON.parse(await readFile(fp, 'utf8'))
  if (!Array.isArray(data.ids)) {
    throw new Error(`${fp} must contain an "ids" array — run: npm run rank-ids`)
  }
  return data.ids.map(String)
}

async function resolveIdList(topN) {
  if (!topN) {
    const hotIds = await fetchHotGameIds()
    console.log(`Fetched ${hotIds.length} IDs from BGG hot list`)
    const allIds = [...new Set([...FEATURED_IDS.map(String), ...hotIds])]
    console.log(`Fetching details for ${allIds.length} games (hot + featured)...`)
    return allIds
  }

  console.log(`Top-N ingest: up to ${topN} games from data/bgg-ranked-ids.json`)
  let ranked = await loadRankedIdsFromJson()
  ranked = [...new Set(ranked)]
  let chosen = ranked.slice(0, topN)
  if (chosen.length < topN) {
    console.warn(
      `Only ${chosen.length} unique IDs in ranked file; padding with hot + featured until ${topN}.`,
    )
    const hotIds = await fetchHotGameIds()
    const pool = [...ranked, ...FEATURED_IDS.map(String), ...hotIds]
    const ordered = []
    const seen = new Set()
    for (const id of pool) {
      if (seen.has(id)) continue
      seen.add(id)
      ordered.push(id)
      if (ordered.length >= topN) break
    }
    chosen = ordered
  }
  console.log(`Fetching details for ${chosen.length} games...`)
  return chosen
}

async function commitInChunks(docs) {
  let total = 0
  for (let i = 0; i < docs.length; i += SANITY_TX_CHUNK) {
    const slice = docs.slice(i, i + SANITY_TX_CHUNK)
    const tx = client.transaction()
    slice.forEach((doc) => tx.createOrReplace(doc))
    const result = await tx.commit()
    total += result.results?.length ?? slice.length
    console.log(
      `Committed Sanity batch ${Math.floor(i / SANITY_TX_CHUNK) + 1} (${slice.length} docs) — running total ${total}`,
    )
  }
  return total
}

// Stable IDs for BGG's all-time top games — ensures rich demo data
// regardless of what's trending on the hot list this week
const FEATURED_IDS = [
  456440, // Cozy Stickerville — narrative + city building + co-op demo target
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

const topN = parseIngestTopN()
const allIds = await resolveIdList(topN)

const games = await fetchAllGameDetails(allIds)
const docs = games.map(transformGame)

const imported = await commitInChunks(docs)
console.log(`Imported ${imported} board games into Content Lake`)