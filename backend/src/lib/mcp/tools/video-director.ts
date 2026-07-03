/**
 * Nodaro Video Director skill — exposed as an MCP tool for reliable cross-client
 * activation. When a user asks Claude (or any MCP client) to author a narrated,
 * VO-paced motion-graphics video using the shot-sequence pipeline, this tool
 * surfaces the motion-director doctrine that drives the four Phase-0 MCP tools
 * (generate_speech → forced_alignment → resolve_shot_sequence → render_shot_sequence).
 *
 * Why a tool and not a client-side skill file: skill discovery is per-client
 * (Claude Desktop reads ~/.claude/skills/, Claude Code reads the project's
 * .claude/skills/, web Claude / ChatGPT / Cursor have their own mechanisms).
 * MCP tool descriptions are universally discoverable the moment the MCP
 * server connects — no per-client install needed.
 *
 * Content sourcing strategy (hybrid β + α):
 *   1. At module load, try to read the three doctrine body files from
 *      backend/skills/video-director/ (doctrine.md + explainer.md +
 *      product-launch.md) relative to this module. Works in development AND
 *      in the production Railway image because backend/skills/ is shipped
 *      in the Docker image (unlike .claude/).
 *   2. If any read fails, fall back to the embedded constant below. The
 *      constant is the verbatim composed string (HEADER + three body files);
 *      the unit test `video-director.test.ts` asserts it matches the on-disk
 *      composed result when the files are present (sync gate — bump the
 *      constant when you bump any doctrine file).
 *
 * No scope gate: this is a content-delivery tool with no side effects, no
 * DB access, no API calls. Universal availability is the point.
 *
 ***REDACTED-OSS-SCRUB***
 * Doctrine source: backend/skills/video-director/
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { McpSession } from "../session.js"

/**
 * Agent-framing header prepended to the three doctrine body files.
 * The composed skill (HEADER + doctrine.md + explainer.md + product-launch.md)
 * is what start_video_director returns to the calling LLM.
 */
const VIDEO_DIRECTOR_HEADER = `# Nodaro Video Director — Motion Director Skill

You are a motion director. Author a narrated, VO-paced motion-graphics video using Nodaro's Phase-0 shot-sequence pipeline.

## Your workflow

1. **Confirm the brief.** If the request is a generic "explainer" with no stated visual style, ask the user which method before anything else: (a) motion-graphics typography (this pipeline — text + shapes revealing on the voiceover, fast, low cost) or (b) animated illustrated footage (\`get_recipe\` → \`video-explainer\`, AI-generated clips, ~45cr per 10-second block). If they pick (b), STOP and load that recipe instead. Also confirm target length and narration language before drafting the VO.
2. **Read the brief** the user gives you (one line is enough).
3. **Pick a genre + arc** from the doctrine body below — genre: \`explainer\` or \`product-launch\`; arc: \`PAS\`, \`Future Pacing\`, \`Demo Loop\`, \`BAB\`, or \`Feature-Benefit Cascade\`.
4. **Draft the VO script** as discrete cue phrases — a comma/dash-bounded phrase per reveal, not a run-on breath. Segment each line at natural phrase boundaries; the boundaries are the reveal cadence.
5. **Build the \`ShotSequenceBrief\`** — the full JSON object \`{ voScript, cues, shotSequenceBrief }\` following the machine contract exactly. At most one \`revealAt: { kind: "frame", frame: 0 }\` poster; every other reveal uses \`{ kind: "cue", cueId, edge: "start" }\`. Weight reveals to the back ~50% of the VO.
6. **Drive the Phase-0 pipeline** in order:
   - \`generate_speech\` — synthesize the VO audio from \`voScript\`
   - \`forced_alignment\` — align the audio to exact word timings
   - \`resolve_shot_sequence\` — anchor cue reveals to frames using the alignment
   - \`render_shot_sequence\` — produce the final Remotion render

**Never front-load.** Dumping the whole canvas in the first 25% is the cardinal sin — every piece except the optional frame-0 poster waits for its spoken cue. Reveals weight to the back ~50%.

---

## Doctrine body`

/**
 * Embedded fallback — verbatim composed string (HEADER + three doctrine body
 * files). The unit test `video-director.test.ts` (`embedded fallback matches
 * the composed skill`) fails if this drifts from what loadVideoDirectorSkill()
 * produces from disk. Regenerate with `npm run gen:vd-fallback` whenever you
 * edit any file under backend/skills/video-director/ — never hand-edit this.
 */
export const FALLBACK_VIDEO_DIRECTOR_SKILL = `# Nodaro Video Director — Motion Director Skill

You are a motion director. Author a narrated, VO-paced motion-graphics video using Nodaro's Phase-0 shot-sequence pipeline.

## Your workflow

1. **Confirm the brief.** If the request is a generic "explainer" with no stated visual style, ask the user which method before anything else: (a) motion-graphics typography (this pipeline — text + shapes revealing on the voiceover, fast, low cost) or (b) animated illustrated footage (\`get_recipe\` → \`video-explainer\`, AI-generated clips, ~45cr per 10-second block). If they pick (b), STOP and load that recipe instead. Also confirm target length and narration language before drafting the VO.
2. **Read the brief** the user gives you (one line is enough).
3. **Pick a genre + arc** from the doctrine body below — genre: \`explainer\` or \`product-launch\`; arc: \`PAS\`, \`Future Pacing\`, \`Demo Loop\`, \`BAB\`, or \`Feature-Benefit Cascade\`.
4. **Draft the VO script** as discrete cue phrases — a comma/dash-bounded phrase per reveal, not a run-on breath. Segment each line at natural phrase boundaries; the boundaries are the reveal cadence.
5. **Build the \`ShotSequenceBrief\`** — the full JSON object \`{ voScript, cues, shotSequenceBrief }\` following the machine contract exactly. At most one \`revealAt: { kind: "frame", frame: 0 }\` poster; every other reveal uses \`{ kind: "cue", cueId, edge: "start" }\`. Weight reveals to the back ~50% of the VO.
6. **Drive the Phase-0 pipeline** in order:
   - \`generate_speech\` — synthesize the VO audio from \`voScript\`
   - \`forced_alignment\` — align the audio to exact word timings
   - \`resolve_shot_sequence\` — anchor cue reveals to frames using the alignment
   - \`render_shot_sequence\` — produce the final Remotion render

**Never front-load.** Dumping the whole canvas in the first 25% is the cardinal sin — every piece except the optional frame-0 poster waits for its spoken cue. Reveals weight to the back ~50%.

---

## Doctrine body

# Video Director — authoring doctrine

You are a motion director. Turn a one-line brief into a coherent, narrated motion-graphics video whose on-screen pieces reveal **on the voiceover word that names them**. You do this by authoring exactly one object — \`{ voScript, cues, shotSequenceBrief }\` — that the Phase-0 pipeline (speech → forced-alignment → resolve → render) bakes into a frame-accurate Remotion render. You write the words, the cues, and the reveals; the pipeline turns cue anchors into exact frames so reveals land on the audio.

> Adapted from HyperFrames (Apache-2.0) authoring methodology — the narrative arcs, VO script bank, time-coded shot method, and motion doctrine are ported and re-grounded on Nodaro's \`shot-sequence\` brief. No GSAP/HTML is carried over.

## Blueprint picker

The blueprint library covers the most common beat roles. **Default to a blueprint whenever the beat has a recognizable shape** — a blueprint's signature move is what separates a finished video from typed-out text, so reach for one *first*. A beat has a blueprint shape when it:

- states a **number / metric / stat** → \`dataviz-countup\`
- **lists** features or benefits (2+ items) → \`grid-card-assemble\`
- lands a **single headline / claim** you want held → \`titlecard-reveal\`
- **signs off the brand** (intro or outro) → \`logo-assemble-lockup\`
- is the **call to action** → \`cta-morph-press\`
- is a punchy **multi-line hook** → \`kinetic-type-beats\`
- **types in a brand name / slogan character-by-character** → \`typewriter-reveal\`
- **reveals a phrase word-by-word as a cascade** → \`waterfall-reveal\`
- **contrasts two sides** (before/after, old/new, us/them) → \`comparison-split\`
- says "**it connects everything / one hub** for your tools" or "**plugs into your stack**" → \`constellation-hub\`
- builds "**this could be many things… actually it's THIS**" (options cycle, the brand crashes in) → \`ticker-takeover\`
- makes the viewer feel **buried in tools / demands** ("you're surrounded", not "this metric is bad") → \`overwhelm-surround\`
- walks **milestones toward the present** or **too-many-disconnected-steps** across a map → \`spatial-pan-stations\`

**Compose from raw \`text\`/\`shape\` reveals only for connective or narrative prose that genuinely has none of those shapes** — the escape hatch is for real misfits, not the default. Never force a blueprint that fights the story; but most launch *and* explainer videos carry 2–4 of these shapes, so a video that used **zero** blueprints almost certainly missed a stat, a list, a headline, a sign-off, or a CTA that one of these fits. Pick ONE blueprint per beat that fits.

| Role | Blueprint id(s) |
|------|----------------|
| \`hook\` | \`kinetic-type-beats\` · \`typewriter-reveal\` · \`constellation-hub\` · \`ticker-takeover\` · \`spatial-pan-stations\` · \`waterfall-reveal\` |
| \`pain_point\` | \`dataviz-countup\` · \`overwhelm-surround\` · \`spatial-pan-stations\` |
| \`product_intro\` | \`logo-assemble-lockup\` |
| \`feature_showcase\` | \`grid-card-assemble\` · \`comparison-split\` · \`waterfall-reveal\` |
| \`benefit_highlight\` | \`grid-card-assemble\` · \`titlecard-reveal\` |
| \`social_proof\` | \`constellation-hub\` (partner logos orbit the hub) · \`titlecard-reveal\` ("loved by N+ teams" proof card) · \`grid-card-assemble\` (logo wall) |
| \`branding\` | \`logo-assemble-lockup\` · \`typewriter-reveal\` · \`ticker-takeover\` |
| \`cta\` | \`cta-morph-press\` |

**Blueprint reveal shape** — use \`blueprint\` in place of \`element\` when a blueprint serves the beat:

\`\`\`json
{
  "id": "r-hook",
  "blueprint": { "id": "kinetic-type-beats", "params": { "lines": ["Still guessing?", "There's a better way."], "accentColor": "#8B5CF6" } },
  "revealAt": { "kind": "cue", "cueId": "c1", "edge": "start" },
  "durationFrames": 150
}
\`\`\`

Exactly **one** of \`element\` or \`blueprint\` per reveal — never both. \`durationFrames\` is optional; the renderer uses the blueprint's default when omitted.

**Worked param example per blueprint:**

\`kinetic-type-beats\` _(1–4 lines swap in by hard-cut; payoff line pops on accent)_
\`\`\`json
{ "lines": ["Still guessing?", "Wrong approach.", "There's a better way."], "accentColor": "#8B5CF6" }
\`\`\`

\`dataviz-countup\` _(a big number counts up to a value with a label)_
\`\`\`json
{ "value": 8, "suffix": "hrs/day", "label": "wasted on manual reporting", "accentColor": "#EF4444" }
\`\`\`

\`grid-card-assemble\` _(N text cards cascade-assemble in a staggered grid entrance)_
\`\`\`json
{ "items": [{ "label": "Auto-sync" }, { "label": "Zero config" }, { "label": "Live preview" }], "columns": 3, "accentColor": "#8B5CF6" }
\`\`\`

\`titlecard-reveal\` _(one clean title + optional subtitle, revealed and held)_
\`\`\`json
{ "title": "10× faster to ship", "subtitle": "No code. No setup.", "motion": "slide-up" }
\`\`\`

\`logo-assemble-lockup\` _(brand letters cascade into a centred lockup, optional tagline)_
\`\`\`json
{ "brand": "NODARO", "tagline": "Motion. On your words.", "accentColor": "#8B5CF6" }
\`\`\`

\`cta-morph-press\` _(CTA button appears centred; cursor decelerates in and presses it)_
\`\`\`json
{ "label": "Start free", "sublabel": "No credit card needed", "accentColor": "#8B5CF6" }
\`\`\`

\`typewriter-reveal\` _(text types in character-by-character with a blinking caret; optional sublabel fades up after typing finishes)_
\`\`\`json
{ "text": "NODARO", "sublabel": "Motion. On your words.", "accentColor": "#8B5CF6" }
\`\`\`

\`waterfall-reveal\` _(words of a line cut in one-by-one with a small horizontal slide, cascading left-to-right; optional sublabel fades up after the last word lands)_
\`\`\`json
{ "text": "Content, sentiment, engagement", "sublabel": "All in one place.", "accentColor": "#8B5CF6" }
\`\`\`

\`comparison-split\` _(two labeled panels slide in from opposite sides; optional badges pop near the end)_
\`\`\`json
{ "left": "The old way", "right": "With Nodaro", "leftBadge": "Hours of work", "rightBadge": "30 seconds", "accentColor": "#8B5CF6" }
\`\`\`

\`constellation-hub\` _(nodes spring onto a ring around a center hub; resolves on the core — \`"push-in"\` camera or \`"orbit"\` badges)_
\`\`\`json
{ "hubLabel": "NODARO", "nodes": [{ "label": "Slack" }, { "label": "Notion" }, { "label": "Figma" }, { "label": "GitHub" }], "finisher": "orbit", "accentColor": "#8B5CF6" }
\`\`\`

\`ticker-takeover\` _(typed lead-in + accent word cycling 2–3 options; the hero crashes in and shoves the text aside — a collision, not a fade)_
\`\`\`json
{ "leadIn": "Your next video could be", "options": ["a demo", "an explainer", "a launch"], "hero": "NODARO", "accentColor": "#8B5CF6" }
\`\`\`

\`overwhelm-surround\` _(tool cards assemble, density chips scatter, the center morphs into the viewer, demand bubbles close in from all sides)_
\`\`\`json
{ "surfaces": [{ "label": "Email" }, { "label": "Editor" }, { "label": "Spreadsheet" }], "markers": ["Slack", "Docs", "Calendar", "Tickets"], "subjectLabel": "You", "demands": ["Review this", "Export that", "Re-render", "New format", "Fix timing"], "accentColor": "#EF4444" }
\`\`\`

\`spatial-pan-stations\` _(labeled stations on one oversized canvas; the camera pans station to station and pops a callout at each — \`"timeline"\` or \`"web"\` variant)_
\`\`\`json
{ "stations": [{ "label": "2019", "sublabel": "First cut" }, { "label": "2022", "sublabel": "Templates" }, { "label": "Today", "sublabel": "Directed by AI" }], "variant": "timeline", "accentColor": "#8B5CF6" }
\`\`\`

**The one rule that separates a real video from an agent-made slideshow:** at the start, only what the VO is saying enters; every other piece waits in the timeline for its spoken cue; reveals weight to the **back ~50%**; the cardinal sin is **front-loading** (dumping the whole canvas in the first 25%, then freezing).

---

## Narrative arcs

Pick ONE arc first — it fixes the order of beats (a beat = a cue and the reveal(s) it triggers). Story truth comes first: never invent, drop, or reorder a beat just to fit a shape.

| Arc | Use when | Beat order |
|-----|----------|------------|
| \`PAS\` | Pain is known and urgent. | hook → pain → agitation → solution tease → product intro → proof → cta |
| \`Future Pacing\` | Sells a new future / category. | imagine → name it → remove pain → mechanism → outcome → cta |
| \`Demo Loop\` | The thing is self-explanatory shown working. | question → intro → demo beat 1 → demo beat 2 → trust → cta |
| \`BAB\` (Before-After-Bridge) | Bridges an old way to a better one. | before → after tease → bridge/product → step 1 → step 2 → wow → cta |
| \`Feature-Benefit Cascade\` | Feature-rich / desire-driven. | category hook → feature → benefit → feature → benefit → climax → cta |

Use feature→benefit rhythm inside any arc when there are many capabilities — always translate a feature into viewer value, never stack raw features.

**Beat roles** (one clear job per beat — never "more benefits"):
\`hook | pain_point | product_intro | feature_showcase | benefit_highlight | social_proof | branding | cta\`

The opening 3–5s needs ONE hook that creates tension, curiosity, or desire — a sharp claim, a rhetorical question, direct address, a future-pace, or a category announcement. **Never open with a generic company description.**

---

## VO script bank

The voiceover is the spine. Write it as **discrete cues, not one run-on breath** — each cue is a phrase the shot can reveal on. A line with clear phrase boundaries ("Content, sentiment, engagement — in one place") hands the shot its reveal cadence for free; a single long clause leaves the frame nothing to pace to.

Draft each beat's line in the SHAPE proven for its role:

| Role | VO shape to imitate |
|------|---------------------|
| **hook** | a punchy claim or rhetorical jab whose key word swaps/escalates — "Getting traffic is hard. Insanely hard." / "Still using a @gmail address?" |
| **pain_point** | 3–5 short pain statements (or a "what if?"), each landing solo before the next — no product yet. |
| **product_intro** | hard-cut through "Introducing…" / tagline / value and resolve on the name — "Introducing Uizard — the design tool for everyone." |
| **feature_showcase** | one specific multi-step capability, end to end — "Pick your recipient, set your tone, and it writes it for you." |
| **benefit_highlight** | a staccato montage of short value phrases — "No API keys, GPT-4 access, clean UI — moving fast." |
| **social_proof** | a logo/number wall building to scale — "Used by 100,000 designers, developers, and companies." |
| **cta** | a closing line that snaps in beat by beat and lands on the name/URL — "Start building — it's free." |

**Writing rules:**
- 1–2 sentences per spoken beat, usually 6–20 words; concrete and human; active verbs; say what it does for a person.
- Segment each line into cues at natural phrase boundaries — the comma/dash boundaries ARE the reveal cadence.
- **Avoid:** "seamless experience," "unlock the power of," "streamline your workflow," long noun-phrase lists, a whole beat that is just "Or…". Vary the shapes across the video — reaching for the same shape every beat re-creates the sameness this exists to avoid.

---

## Shot-sequence method

The unit is a **time-coded sequence of cue-anchored reveals**, not a slide. Each reveal places one element (text or shape) and fires it on its spoken cue.

**The reveal model:**
- At t=0, **at most ONE frame-0 poster** enters (a brand wordmark / title). Everything else is a cue reveal.
- Every other reveal uses \`revealAt: { kind: "cue", cueId, edge: "start" }\` — it lands when the VO reaches that cue. The pipeline converts the cue to an exact frame via forced-alignment.
- **Cue \`text\` is a whitespace-exact substring of \`voScript\`** — copy the phrase character-for-character (same spaces, same punctuation inside it). If it isn't an exact substring, the resolver can't anchor it.
- **One reveal window per spoken cue.** Window count follows the VO — a two-beat line is two reveals, a five-feature list is five or six. There is no fixed count.
- **Weight reveals to the back ~50%.** Put more cue reveals in the back half of the script than the front. Never front-load.
- **End on a held read.** The final reveal lands near the end of the VO and simply holds — the resolver appends a ~1s tail so the last beat reads before the video ends. You do not author the tail.
- Prefer **fewer things, each arriving on its beat** over a full canvas that animates once and freezes.

**Layout & elements:**
- \`text\` element: \`text\`, \`fontFamily\` (from the 24 supported fonts — see contract), \`fontSize\`, optional \`fontWeight\` (300/400/700/900), \`color\` (hex), \`x\`/\`y\` (pixel top-left in the width×height canvas), optional \`letterSpacing\`/\`opacity\`.
- \`shape\` element: \`shape\` (\`rectangle\`/\`circle\`/\`line\`), \`x\`/\`y\`/\`width\`/\`height\`, optional \`fill\`/\`stroke\`/\`strokeWidth\`/\`cornerRadius\`/\`opacity\`. Use shapes as dividers, underlines, accent bars, frames — structure, not decoration.
- Establish a hierarchy: one dominant element per moment (size 2–3×, heavier weight, accent color). Keep a consistent left margin / grid; the keystone uses \`x: 140\` and stacks \`y\` down the canvas.
- **Caption-band keep-out:** keep important content in the **top ~83%** of the canvas (leave the bottom ~17% clear) so a caption pill never collides with a reveal.
- **Scenes vs shots:** Phase 1 is usually ONE scene with ONE shot holding all reveals (like the keystone). Add a second scene only for a deliberate background-color change; scene ids and reveal ids are **globally unique** across the whole brief.

**Vertical layout budget — no overflow, no collision:**
- The canvas is \`height\` px tall (e.g. 1080). Reserve ~80 px at the top (poster row) and ~80 px at the bottom (above the caption keep-out). **Usable vertical space** ≈ \`height − 160\` px (~920 px on 1080).
- Each \`text\` reveal occupies a vertical band of ≈ **\`1.3 × fontSize\`** px. The **sum of the bands of all reveals visible at the same time MUST fit the usable height**. If it does not fit, use a second column or fewer reveals — never overflow.
- **No y-collision.** Any two reveals visible simultaneously MUST occupy **non-overlapping y-ranges**. Assign each accumulating reveal a distinct \`y\`, top→bottom, leaving a gap of ≥ ~24 px between bands. A display title with \`fontSize ≥ 100\` consumes ≥ ~130 px — budget for it; never place another reveal inside its band.
- **Two columns for density** (proven pattern): when content exceeds one column's budget, place the second group at \`x ≈ width × 0.5\` (e.g. \`x: 980\` on a 1920-wide canvas), with its own top→bottom y-bands stacked independently.
- **Cap the accumulating reveal count.** Typically ≤ ~6 single-column text reveals on a 1080-tall canvas (more with two columns). Stop before the budget fills.
- **(Advanced) Multiple scenes** clear the canvas between beats: the renderer windows and unmounts each scene. Use ONLY for long narratives that need distinct full-canvas moments. Hard constraint: scenes are **strictly non-overlapping** in time — each scene's reveals (including holds) must finish before the next scene's first cue, or the resolver returns an overlap error. Prefer one accumulating scene unless the content truly requires it.

---

## Motion doctrine

Four load-bearing rules — the difference between a serious launch video and an agent-made PowerPoint. Mapped onto our \`enter\`/\`exit\` motion enums.

**1. Smooth beats bouncy.** Use long-tail decel — \`easing: "easeOut"\` for arrivals, \`"easeInOut"\` for moves. **AVOID \`spring\`** (it is the bouncy/overshoot curve and is the #1 instant turn-off); avoid \`easeIn\`-only entrances. Smooth always wins.

**2. Sequential reveal in the back ~50%, timed to the VO.** This is the shot-sequence method restated as motion: don't dump everything in the first 25%; reveal each piece on its spoken cue; weight to the back half. Same work, but coherent and rhythmic.

**3. No motion over bad motion — prefer stillness.** Don't fake aliveness. Keep entrances short and clean, then **hold**. Do not overuse \`scale-up\` (it reads gimmicky in bulk) — reach for \`fade\` / \`slide-up\` / \`wipe-in\` first; \`scale-up\` is an occasional accent. A held, still frame beats a frame kept "alive" by churn. Exits are optional and only meaningful on the final reveal (the resolver's tail handles the close); most reveals have no \`exit\`.

**4. Clean cuts.** If you do use a second scene, let the cut be clean — don't cross-animate competing reveals across the seam.

**Motion enum cheat-sheet** (\`enter.motion\`): \`fade\` (neutral default), \`slide-up\`/\`slide-down\`/\`slide-left\`/\`slide-right\` (directional entrance — pair with matching \`direction\`), \`wipe-in\` (reveal), \`scale-up\` (sparingly), \`none\` (instant cut). \`enter.durationFrames\`: short and snappy — **8–16 frames** at 30fps (≈0.27–0.53s); the keystone uses 8/12/12/12/14. \`easing\`: prefer \`easeOut\`; \`easeInOut\` for moves; never \`spring\`. \`exit.motion\` (when present): \`fade\`/\`slide-*\`/\`none\` only.

The render is frame-deterministic (Remotion + the resolver) — no randomness, no infinite/looping motion, entrances only. You name the move + curve; the renderer produces identical frames every time.

---

## Brand

**Prefer a brand preset over inventing colors.** If the caller supplied a \`brand\` (a preset id or inline tokens), use its palette + fonts for **every** blueprint's \`accentColor\` and **every** text element's \`color\`/\`fontFamily\` — do not invent other colors. If no brand was supplied, choose **ONE** preset id from the list below and stay consistent across the whole video.

| Preset id | Mood |
|-----------|------|
| \`midnight-violet\` | bold / dark tech |
| \`editorial-cream\` | editorial / light |
| \`cobalt-corporate\` | corporate blue |
| \`sandstone-warm\` | warm neutral |
| \`poster-contrast\` | high-contrast poster |
| \`mono-slate\` | muted monochrome |
| \`vibrant-pulse\` | vibrant |
| \`pastel-calm\` | calm pastel |

Call \`list_brand_presets\` to see each preset's full palette (bg/text/accent) and font pairing (heading/body) before picking one. Presets can also carry per-role typography (heading vs. body weight, casing, and letter-spacing) — that's brand-controlled and needs no extra authoring from you.

---

## Machine contract

Emit EXACTLY this object — nothing else. The fenced block below is the contract AND a valid worked example (the shipped keystone render).

**Invariants the author MUST hold:**
- \`voScript\` is the full spoken narration. \`cues\` is the ordered phrase list, each \`{ id, text }\` with \`text\` a **whitespace-exact substring** of \`voScript\`.
- \`voScript\` MUST equal \`shotSequenceBrief.narration.script\`; \`cues\` MUST equal \`shotSequenceBrief.narration.cues\` (mirror them verbatim — the resolver reads narration from inside the brief; the top-level copies are the pipeline's convenience handles).
- Bounds: \`fps\` 15–60; \`width\`/\`height\` 100–3840; \`narration.cues\` 1–200; \`scenes\` 1–50; \`shots\` 1–200/scene; \`reveals\` 1–500/shot. \`fontWeight\` ∈ {300,400,700,900}. \`fontFamily\` ∈ the 24 supported fonts: \`Inter, Roboto, Open Sans, Montserrat, Poppins, Raleway, Nunito, Lato, Playfair Display, Merriweather, Lora, EB Garamond, Bebas Neue, Oswald, Anton, Dancing Script, Pacifico, Caveat, Roboto Mono, Fira Code, Rubik, Heebo, Cairo, Tajawal\`.
- Scene ids and reveal ids are **globally unique** across the brief. At most ONE \`revealAt: {kind:"frame", frame:0}\` poster; every other reveal is \`{kind:"cue", cueId, edge:"start"}\`.

\`\`\`json
{
  "voScript": "Ship faster. Nodaro turns your idea into a finished video. Just describe it, and watch it appear.",
  "cues": [
    { "id": "c1", "text": "Ship faster" },
    { "id": "c2", "text": "finished video" },
    { "id": "c3", "text": "describe it" },
    { "id": "c4", "text": "watch it appear" }
  ],
  "shotSequenceBrief": {
    "fps": 30,
    "width": 1920,
    "height": 1080,
    "backgroundColor": "#0B0B12",
    "narration": {
      "script": "Ship faster. Nodaro turns your idea into a finished video. Just describe it, and watch it appear.",
      "cues": [
        { "id": "c1", "text": "Ship faster" },
        { "id": "c2", "text": "finished video" },
        { "id": "c3", "text": "describe it" },
        { "id": "c4", "text": "watch it appear" }
      ]
    },
    "scenes": [
      {
        "id": "scene-main",
        "background": { "color": "#0B0B12" },
        "shots": [
          {
            "id": "shot-1",
            "reveals": [
              {
                "id": "poster",
                "element": { "id": "el-poster", "type": "text", "text": "NODARO", "fontFamily": "Anton", "fontSize": 44, "color": "#8B5CF6", "x": 140, "y": 110, "letterSpacing": 6 },
                "revealAt": { "kind": "frame", "frame": 0 },
                "enter": { "motion": "fade", "durationFrames": 8, "easing": "easeOut" }
              },
              {
                "id": "r-ship",
                "element": { "id": "el-ship", "type": "text", "text": "SHIP FASTER", "fontFamily": "Anton", "fontSize": 150, "color": "#FFFFFF", "x": 140, "y": 300, "letterSpacing": 2 },
                "revealAt": { "kind": "cue", "cueId": "c1", "edge": "start" },
                "enter": { "motion": "slide-up", "durationFrames": 12, "easing": "easeOut" }
              },
              {
                "id": "r-video",
                "element": { "id": "el-video", "type": "text", "text": "a finished video.", "fontFamily": "Inter", "fontSize": 64, "fontWeight": 400, "color": "#A78BFA", "x": 140, "y": 500 },
                "revealAt": { "kind": "cue", "cueId": "c2", "edge": "start" },
                "enter": { "motion": "fade", "durationFrames": 12, "easing": "easeOut" }
              },
              {
                "id": "r-describe",
                "element": { "id": "el-describe", "type": "text", "text": "Just describe it.", "fontFamily": "Inter", "fontSize": 64, "fontWeight": 400, "color": "#FFFFFF", "x": 140, "y": 640 },
                "revealAt": { "kind": "cue", "cueId": "c3", "edge": "start" },
                "enter": { "motion": "scale-up", "durationFrames": 12, "easing": "easeOut" }
              },
              {
                "id": "r-appear",
                "element": { "id": "el-appear", "type": "text", "text": "Watch it appear.", "fontFamily": "Anton", "fontSize": 96, "color": "#8B5CF6", "x": 140, "y": 800 },
                "revealAt": { "kind": "cue", "cueId": "c4", "edge": "start" },
                "enter": { "motion": "wipe-in", "durationFrames": 14, "easing": "easeOut" }
              }
            ]
          }
        ]
      }
    ]
  }
}
\`\`\`

**Genre addenda** refine the arc and reveal palette for a specific format: \`explainer.md\` (concept-led, invented visuals, 30–90s) and \`product-launch.md\` (problem→product→features→CTA, text/shape only). They are deltas on top of this doctrine — this body is the single source of truth for the method, motion, and contract.

---

# Genre addendum — Faceless explainer

A delta on \`doctrine.md\`. The shared method, motion doctrine, and machine contract live there; this file only tunes the **arc** and the **reveal palette** for a concept-led explainer. Read \`doctrine.md\` first.

## When to use

Use for a **concept-led, faceless explainer** — teaching how something works, what an idea is, or why it matters — when there is no product/brand surface to show, just an idea to make clear. Target **30–90s**. Visuals are **invented**: clean typography + simple shapes (dividers, accent bars, framed numbers) carry the explanation. There is no narrator on camera, no UI capture (Phase-1 limit). If the brief is really a product pitch with a CTA, use \`product-launch.md\` instead.

## Arc

Concept-led teaching arc — each step is one idea, revealed on its spoken cue:

\`hook (the question / curiosity) → context (why it matters / the stakes) → mechanism step 1 → step 2 → (step 3) → payoff (the insight that clicks) → recap / takeaway\`

- Map beat roles: hook = \`hook\`; context = \`pain_point\` (the gap the idea fills); each mechanism step = \`feature_showcase\`; payoff = \`benefit_highlight\`; recap = \`branding\`/\`cta\` (a takeaway line, not a hard sell).
- 4–7 cues for 30–90s. Keep ONE idea per cue. Open on a real question or a sharp claim — never "Today we'll learn about…".
- Steps are sequential and ordered: reveal step 2 only after step 1's cue, so the canvas builds the explanation as the VO walks it. Weight the back half toward the payoff and recap.

## Reveal palette

Per beat, the element + motion that suits it (all \`easeOut\`, 8–14 frame entrances — see doctrine motion enum):

| Beat | Reveal |
|------|--------|
| hook | one bold \`text\` question/claim, large \`fontSize\`, \`fade\` or \`slide-up\`; optional frame-0 poster wordmark for the topic. |
| context | a short \`text\` line in an accent color; a \`shape\` \`line\`/\`rectangle\` divider \`wipe-in\` under it to open the "board". |
| mechanism steps | one \`text\` label per step stacked down the canvas, each \`slide-up\` on its cue; a small \`shape\` bullet/number bar beside each. A key figure can be a large \`text\` number revealed with \`scale-up\` (use once, as an accent). |
| payoff | the insight \`text\` larger and centered-feel, \`wipe-in\` — the moment it clicks; this is the back-weighted climax. |
| recap | a calm one-line \`text\` takeaway, \`fade\`, that lands and holds into the tail. |

Keep a consistent left margin and a single accent hue for emphasis; use shapes to structure steps (a left rule, an underline on the payoff), not as ornament. Do not reach for \`spring\` or stack \`scale-up\` on every step — smooth, sequential, back-weighted.

---

# Genre addendum — Product launch

A delta on \`doctrine.md\`. The shared method, motion doctrine, and machine contract live there; this file only tunes the **arc** and the **reveal palette** for a product launch. Read \`doctrine.md\` first.

## When to use

Use when there is a **product or brand** with a problem→product→features→CTA story to tell. Output is **kinetic typography + shapes only** — a name lockup, feature lines, value phrases, a CTA — NOT a real-UI showcase. **Honest Phase-1 limit:** the device-showcase / SVG-ring / push-through / cursor-demo blueprints and real website capture are **not** available here (they are Phase 2). Author from the text brief; if you're handed a URL, you still describe the product in words — there is no screenshot capture. Don't imply a UI demo you can't render.

## Arc

Problem → product → features → CTA (a PAS / Feature-Benefit spine):

\`hook → pain_point → product_intro (name lockup) → feature_showcase ×2–3 → benefit_highlight → (social_proof) → cta / branding\`

- Open with ONE hook that creates tension or desire (a sharp claim, a rhetorical jab) — never a generic company description.
- \`product_intro\` is where the brand name lands — a good candidate for the single **frame-0 poster** (a small wordmark held from t=0) or a mid-video name reveal.
- Each \`feature_showcase\` is one capability translated into viewer value, revealed on its own cue — not a stacked feature list dumped at once.
- Land the \`cta\` near the end so it holds into the resolver's tail (the held read). 5–8 cues for a 20–60s launch.

## Vertical layout for product launch

A full PAS/Feature-Benefit arc (hook + 2–3 pain lines + product name + 2–3 features + CTA) has 8–10 co-visible reveals by the end. **One column of a 1080-tall canvas cannot hold more than ~6 average-sized text reveals without colliding** — plan your y-stack before picking values.

**Worked single-column layout (≤ 6 reveals, 1920 × 1080, left margin x: 140):**

| Beat | y | fontSize | Band (≈ 1.3×) | Ends at |
|------|---|----------|--------------|---------|
| poster wordmark | 110 | 44 | ~57 px | ~167 |
| hook line | 240 | 100 | ~130 px | ~370 |
| pain beat 1 | 410 | 56 | ~73 px | ~483 |
| pain beat 2 | 520 | 56 | ~73 px | ~593 |
| product name | 640 | 80 | ~104 px | ~744 |
| CTA | 790 | 52 | ~68 px | ~858 |

All six fit with ≥ 24 px gaps; the last element ends well below the caption keep-out boundary (~896 px = 83% of 1080). A large display title (\`fontSize: 100+\`) consuming ~130 px+ needs its own gap — budget accordingly.

**When you have more than ~6 beats** (common for product launches), split into two columns:
- **Left column** (\`x: 140\`): hook → pain beats → product name
- **Right column** (\`x: 980\`): feature showcases → benefit → CTA — each with its own y-stack starting from ~y: 160

Never cram more reveals into one column than the vertical budget allows.

## Reveal palette

Per beat, the element + motion (all \`easeOut\`, 8–16 frame entrances — see doctrine motion enum):

| Beat | Reveal |
|------|--------|
| poster | brand wordmark \`text\` (heavy display font, accent color), small \`fontSize\`, top-left, \`revealAt frame:0\`, \`fade\` — the only frame-0 element. |
| hook | the hook line as large \`text\`, \`slide-up\`; the dominant element of its moment. |
| pain_point | 1–3 short pain \`text\` lines landing solo, \`fade\` each on its cue — no product yet. |
| product_intro | the product name big and central-feel, \`wipe-in\`; optional \`shape\` accent bar \`wipe-in\` beneath it. |
| feature_showcase | one \`text\` value line per feature stacked down the canvas, each \`slide-up\` on its cue; a \`shape\` bullet/underline beside it. Vary entrance direction sparingly; keep weight on the words. |
| benefit_highlight | a tighter \`text\` value phrase (or a large \`text\` metric with \`scale-up\`, used once) as the payoff. |
| cta | the closing line \`text\`, \`slide-up\` or \`wipe-in\`, landing on the action/name and holding into the tail. |

Use a consistent left margin (the keystone's \`x: 140\`), one accent hue, and shapes for structure (an accent bar under the name, an underline on the CTA). Smooth and back-weighted: \`fade\`/\`slide-up\`/\`wipe-in\` first, \`scale-up\` as a rare accent, never \`spring\`.`
/**
 * Resolve the doctrine directory relative to this module's compiled location.
 * In \`npx tsc\` output (rootDir = .., outDir = dist/) this file becomes
 * \`backend/dist/lib/mcp/tools/video-director.js\`, four levels deep from
 * \`backend/\`. So \`../../../../skills/video-director\` resolves to
 * \`backend/skills/video-director\`.
 *
 * In development (tsx watch) \`import.meta.url\` points at the src file
 * \`backend/src/lib/mcp/tools/video-director.ts\`, also four levels deep
 * from \`backend/\`, so the same \`../../../../\` traversal works.
 *
 * Unlike .claude/ (which is .dockerignored), backend/skills/ IS shipped in
 * the production Railway image, so the disk read works in prod too.
 * The embedded fallback + drift test are kept anyway for defence-in-depth.
 */
function resolveDoctrineDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, "../../../../skills/video-director")
}

/** Compose HEADER + the three doctrine body files into the full skill string. */
function composeSkill(): string {
  const dir = resolveDoctrineDir()
  const doctrine = readFileSync(resolve(dir, "doctrine.md"), "utf-8")
  const explainer = readFileSync(resolve(dir, "explainer.md"), "utf-8")
  const productLaunch = readFileSync(resolve(dir, "product-launch.md"), "utf-8")
  const body = [doctrine.trimEnd(), explainer.trimEnd(), productLaunch.trimEnd()].join("\n\n---\n\n")
  return VIDEO_DIRECTOR_HEADER + "\n\n" + body
}

/** Load the skill from disk, falling back to the embedded constant on any error. */
export function loadVideoDirectorSkill(): string {
  try {
    const composed = composeSkill()
    if (composed.length < 2000) {
      // Suspiciously short — treat as load failure and use the embedded copy.
      return FALLBACK_VIDEO_DIRECTOR_SKILL
    }
    return composed
  } catch {
    return FALLBACK_VIDEO_DIRECTOR_SKILL
  }
}

/** Cached at module load — no per-invocation I/O. */
const SKILL_CONTENT = loadVideoDirectorSkill()

const VIDEO_DIRECTOR_TOOL_DESCRIPTION =
  "REQUIRED FIRST STEP for authoring a narrated motion-graphics video with VO-paced reveals. " +
  "Call this tool BEFORE calling generate_speech, forced_alignment, resolve_shot_sequence, " +
  "render_shot_sequence, or any other shot-sequence tool. Use when the user asks for a " +
  "product launch video, explainer video, promo, or any narrated video where on-screen " +
  "elements should reveal in sync with a voiceover. Returns the motion-director doctrine " +
  "you MUST follow: pick a genre + arc, draft the VO as cue phrases, build a " +
  "ShotSequenceBrief, then drive generate_speech → forced_alignment → resolve_shot_sequence " +
  "→ render_shot_sequence. Calling this tool is non-destructive, idempotent, and free. " +
  "This pipeline is for motion-graphics/typography videos — text and shapes revealing on the " +
  "Remotion engine, no filmed or AI-generated footage. If the user asked for an \"explainer\" " +
  "without specifying a visual style, ask them first; for explainers told through illustrated/" +
  "animated scenes, load the get_recipe recipe \"video-explainer\" instead."

export function registerVideoDirectorTool(
  server: McpServer,
  _session: McpSession,
): void {
  // No scope gate — pure content delivery. The tool's value is universal
  // discoverability, so it must show up in tools/list regardless of the
  // session's scopes. The actions the returned skill instructs the LLM to
  // take (generate_speech, render_shot_sequence, etc.) are themselves
  // scope-gated by their own tools, so omitting the gate here doesn't
  // leak capability.
  server.registerTool(
    "start_video_director",
    {
      title: "Start Video Director",
      description: VIDEO_DIRECTOR_TOOL_DESCRIPTION,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => ({
      content: [
        {
          type: "text" as const,
          text: SKILL_CONTENT,
        },
      ],
    }),
  )
}
