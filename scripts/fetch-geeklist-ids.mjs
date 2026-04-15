#!/usr/bin/env node
import 'dotenv/config'
import {mkdir, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {XMLParser} from 'fast-xml-parser'

/**
 * Fetch board game IDs from a BGG geeklist (XML API v1) and write data/bgg-ranked-ids.json
 *
 * Usage:
 *   node scripts/fetch-geeklist-ids.mjs [geeklistId] [outputPath] [maxIds]
 *
 * Default geeklistId: 234959 (425 ranked board games; order is the list author’s, not BGG’s
 * global rank — swap the ID for any geeklist you prefer, or use a CSV; see tutorial.)
 *
 * BGG often queues geeklist exports; this script retries until XML is ready.
 */

const geeklistId = process.argv[2] ?? '234959'
const defaultOut = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'data',
  'bgg-ranked-ids.json',
)
const outPath = process.argv[3] ?? defaultOut
const maxIdsArg = process.argv[4]
const maxIds = maxIdsArg ? parseInt(maxIdsArg, 10) : undefined

function bggAuthHeaders() {
  const token = process.env.BGG_API_TOKEN?.trim()
  if (!token) {
    console.error('Set BGG_API_TOKEN in .env')
    process.exit(1)
  }
  return {Authorization: `Bearer ${token}`, Accept: 'application/xml'}
}

async function fetchGeeklistXml(id) {
  const res = await fetch(`https://boardgamegeek.com/xmlapi/geeklist/${id}`, {
    headers: bggAuthHeaders(),
  })
  return res.text()
}

function isQueued(xml) {
  return xml.includes('try again later') || xml.includes('will be processed')
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => name === 'item',
})

function extractBoardGameIds(xml) {
  const doc = parser.parse(xml)
  const items = doc.geeklist?.item
  if (!items) return []
  const list = Array.isArray(items) ? items : [items]
  const ids = []
  for (const it of list) {
    if (it['@_subtype'] === 'boardgame' && it['@_objectid']) {
      ids.push(String(it['@_objectid']))
    }
  }
  return ids
}

let xml = ''
for (let attempt = 1; attempt <= 40; attempt++) {
  xml = await fetchGeeklistXml(geeklistId)
  if (!isQueued(xml)) break
  console.log(`Geeklist ${geeklistId} queued — waiting 5s (attempt ${attempt}/40)...`)
  await new Promise((r) => setTimeout(r, 5000))
}

if (isQueued(xml)) {
  console.error('Geeklist never became ready. Try again later or use another geeklist ID.')
  process.exit(1)
}

const ids = extractBoardGameIds(xml)
if (ids.length === 0) {
  console.error('No boardgame items found. Check geeklist ID and XML structure.')
  process.exit(1)
}

const capped =
  typeof maxIds === 'number' && Number.isFinite(maxIds) && maxIds > 0
    ? ids.slice(0, maxIds)
    : ids

const payload = {
  source: `geeklist:${geeklistId}`,
  fetchedAt: new Date().toISOString(),
  ids: capped,
}

await mkdir(path.dirname(outPath), {recursive: true})
await writeFile(outPath, JSON.stringify(payload, null, 2), 'utf8')
console.log(`Wrote ${capped.length} ids to ${outPath}`)
