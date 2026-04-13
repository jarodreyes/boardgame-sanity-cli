# Recording Instructions: BGG Agent Context Tutorial

---

## Technical Setup

### Display

- **Resolution:** 1920x1080 minimum. If recording on a retina/HiDPI screen, record at 1x scaling or at 2560x1440 with a 1080p export. Avoid 4K — it slows down post-production without improving readability at typical YouTube/blog embed sizes.
- **Color profile:** sRGB. If your system uses Display P3, switch before recording to avoid washed-out exports.
- **Desktop:** Clean desktop, no icons. Use a neutral dark wallpaper. Do not use the default Sanity coral/salmon wallpaper — it creates distracting color bleed in screen recordings.

### Terminal

- **App:** iTerm2 (macOS) or Windows Terminal. Avoid default macOS Terminal — the color rendering is inferior.
- **Theme:** Dark background, high-contrast text. Recommended: Dracula or One Dark. Avoid pure white backgrounds — they flare against dark Studio UI.
- **Font:** JetBrains Mono or Fira Code, 16pt minimum. Do not go smaller — 14pt is unreadable when compressed to 1080p.
- **Shell prompt:** Keep it short. If your prompt is long (git status decorations, conda env, etc.), temporarily set `PS1='$ '` before recording.
- **Window size:** Full screen, or 80 columns wide minimum if split-screen.

### Browser (for Studio)

- **Browser:** Chrome or Arc. Firefox renders the Studio's font stack slightly differently — use Chrome for consistency with most viewers.
- **Zoom level:** 100%. Do not zoom in — it clips Studio's sidebar.
- **Extensions:** Disable all. Especially any that add UI elements (LastPass icon, 1Password, dark mode overrides).
- **Profile:** Use a clean Chrome profile with no bookmarks bar and no notifications.
- **Studio URL:** `localhost:3333`

### Audio

- Use a dedicated microphone. Built-in laptop audio is not acceptable for published content.
- Recommended minimum: Blue Snowball, Rode NT-USB Mini, or similar.
- Record in a room with soft surfaces (couch, curtains, carpet). Hard surfaces create echo.
- Test your levels before recording: your voice should peak around -12 dB to -6 dB, never clipping at 0 dB.
- Turn off fans, AC, and notifications before each take.

### Screen Recorder

- **macOS:** Quicktime (native) or Screenflow for recordings you'll edit. For OBS, set output to MP4 at a constant quality of 18–22 CRF.
- **Windows:** OBS Studio. Record to MP4 at 60 fps, 1920x1080.
- Record in one session — don't stitch multiple sessions together unless you're intentional about the edit points.

---

## Pre-Recording Checklist

Complete all of these before recording any footage. Nothing is worse than a take that requires a re-record because setup wasn't done.

**Sanity project:**
- [ ] `npm create sanity@latest` completed, project named `bgg-agent`
- [ ] `schemaTypes/index.ts` replaced with the `boardGame` schema
- [ ] `npx sanity schema deploy` run and successful
- [ ] `fast-xml-parser` installed
- [ ] `BGG_API_TOKEN` set (registered BGG application — see [Using the XML API](https://boardgamegeek.com/using_the_xml_api))
- [ ] `ingest.mjs` created and tested — 58 documents imported to Content Lake
- [ ] Studio running at `localhost:3333` with board games visible in document list

**Agent Context:**
- [ ] `@sanity/agent-context` installed
- [ ] `sanity.config.ts` updated with `agentContextPlugin()`
- [ ] Studio restarted and "Agent Context" visible in sidebar
- [ ] **`npx sanity deploy` completed** — hosted Studio URL works; MCP returns 400 until this is done
- [ ] Agent Context document created: name = "Board Game Oracle", slug = "board-games"
- [ ] GROQ filter set to `_type == "boardGame"`
- [ ] Instructions pasted in and saved
- [ ] MCP URL copied and in `.env`

**Agent script:**
- [ ] `ai`, `@ai-sdk/openai`, `@ai-sdk/mcp` installed
- [ ] `agent.mjs` created
- [ ] `.env` has all required variables: `SANITY_PROJECT_ID`, `SANITY_API_TOKEN`, `BGG_API_TOKEN`, `SANITY_CONTEXT_MCP_URL`, `SANITY_API_READ_TOKEN`, `OPENAI_API_KEY`
- [ ] `node --env-file=.env agent.mjs "How many board games are in the database?"` runs and returns a valid answer

**Demo queries tested (run each before recording):**
- [ ] `"Find games that combine Worker Placement with Deck Building"` — returns Dune: Imperium
- [ ] `"What is the exact complexity weight and average rating of Wingspan?"` — returns `weight: 2.45`
- [ ] `"Which game in the database has the most mechanics listed?"` — returns a specific game name

**Visual state:**
- [ ] Terminal prompt is short and clean
- [ ] Browser has only one tab open: `localhost:3333`
- [ ] Code editor (if visible) has `agent.mjs` and `ingest.mjs` open as tabs
- [ ] `.env` file is NOT open in any editor pane during recording
- [ ] No Slack, Mail, or notification apps running
- [ ] Do Not Disturb is on

---

## Window Layout

### Intro + Demo queries (0:00–0:45, 5:15–6:15)

**Fullscreen terminal only.** The command and its output should fill the screen. No split panes. The viewer's eye should have nowhere to go but the response.

### Schema section (1:30–2:15)

**60/40 split:** Terminal on the left (60%), code editor on the right (40%) with `schemaTypes/index.ts` open. Scroll the schema slowly — give viewers 2 seconds per field group before moving on.

### Ingest section (2:15–3:30)

Start with **fullscreen terminal** for the npm install and the script run. Switch to **fullscreen browser** (Studio at `localhost:3333`) after the import completes. Click into one game document and pause for 3 seconds so viewers can see the field values.

### Agent Context section (3:30–4:45)

**Fullscreen terminal** for `npm install @sanity/agent-context` and **`npx sanity deploy`** (show success line with hosted Studio URL). Then **fullscreen browser** for Studio: reload, point out **Agent Context** in the sidebar, create the document, copy MCP URL. Switch back to **terminal** only for pasting the URL into `.env` (mask values; do not show secrets on screen).

### Agent script section (4:45–5:15)

**60/40 split:** Code editor on the left with `agent.mjs` open, terminal on the right. Run the `npm install` for `ai`, `@ai-sdk/openai`, `@ai-sdk/mcp` in the terminal pane.

---

## Chapter Timestamps

Use these for YouTube chapters and for guiding edit cuts:

| Chapter | Timestamp | Description |
|---|---|---|
| 0 | 0:00 | Intro — the payoff demo |
| 1 | 0:45 | Create a Sanity project |
| 2 | 1:30 | Define the board game schema |
| 3 | 2:15 | Ingest BGG data |
| 4 | 3:30 | Install Agent Context plugin |
| 5 | 3:50 | Deploy Studio (`sanity deploy`) — required for MCP |
| 6 | 4:15 | Create Agent Context document + MCP URL |
| 7 | 4:45 | Build the agent script |
| 8 | 5:15 | Run the payoff queries |

---

## Post-Production Notes

### Cuts

- Cut dead air aggressively. Any pause longer than 2 seconds that isn't a deliberate [PAUSE] can be tightened in post.
- Cut `npm install` progress spinners after 1 second — jump cut to the completion message. Viewers don't need to watch package resolution.
- Keep the terminal output of `ingest.mjs` in full — the log lines (hot list count, per-batch `thing` fetches, "Imported … board games") are part of the payoff.

### Zoom effects

Use smooth zoom (1.0x to 1.3x, 0.3s ease) to highlight:
- The `mechanics` and `categories` arrays in the schema section
- The **`npx sanity deploy` success line** (hosted Studio URL) — viewers should remember deploy unlocks Agent Context
- The agent's structured response text on the first payoff query
- The `groqFilter` field value in the Agent Context document

Don't use zoom on code you're scrolling through — it creates nausea.

### Captions

- Auto-captions are acceptable as a base, but manually review and correct:
  - "GROQ" (often transcribed as "grok" or "groc")
  - "BGG" (often transcribed as "biggie")
  - "Content Lake" (often split into "Content" + "Lake" with wrong capitalization)
  - "sanity.io" (often transcribed as "sanity dot io" — fix to the URL form)

### Thumbnail

- Use a split-frame composition: left half shows the ungrounded LLM response (vague, wrong), right half shows the agent's specific, accurate response.
- Text overlay: "Stop Guessing. Start Querying."
- Color: dark background, Sanity red (#F04323) for emphasis text.

### Upload checklist

- [ ] Title: "Build a Board Game AI That Doesn't Guess | Sanity Agent Context Tutorial"
- [ ] Description includes the blog post link as the first URL
- [ ] Description includes links to: Sanity docs for Agent Context, BGG API docs, Vercel AI SDK docs
- [ ] Tags: sanity, agent-context, ai-agent, board-games, groq, content-lake, developer-tutorial
- [ ] Chapter timestamps added to description
- [ ] End screen links to the MCP tutorial (the tldr-pages one in this series)
