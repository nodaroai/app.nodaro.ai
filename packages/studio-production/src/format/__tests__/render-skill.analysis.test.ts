import { describe, it, expect } from "vitest"

import {
  VIDEO_ANALYSIS_AUDIO_MODES,
  analyzedSceneSchema,
  clipLookSchema,
  entitySlotSchema,
  videoAnalysisResultSchema,
} from "@nodaro/shared"

import { FILM_LOOK_KEYS } from "../../look-layers"
import {
  buildFormatRegistry,
  lookPickerKeys,
  shotPickKeys,
} from "../registry"
import {
  ANALYSIS_GUIDANCE_HEADING,
  renderSkill,
  renderSystemPrompt,
} from "../render-skill"
import {
  AUDIO_KEYS,
  AUDIO_MODES,
  CAST_KEYS,
  CAST_KIND_LIST,
  DOCUMENT_KEYS,
  FRAME_KEYS,
  MOTION_KEYS,
  SCENE_KEYS,
  SHOT_KEYS,
  VOICE_KEYS,
} from "../schema"

/**
 * The analysis half of the rendered skill (plan-import-v2 §10.2) — the mapping
 * section's seats, its R52 skill-only carve-out, its place in the document and
 * the guard on its hand-typed field names. A sibling of `render-skill.test.ts`
 * rather than more of it: that file was at the 800-line cap, and this section
 * has its own vocabulary (the four video-analysis shapes) that nothing else
 * there reads.
 */

const GENERATED_FROM = { prompts: "1.10.0", shared: "2.14.0" }

/** The mapping section alone — its heading to the next one. `## Size` is what
 *  follows it by the Interfaces contract, which the ORDER test below pins;
 *  there is no exported accessor to read it off the renderer. */
const sectionOf = (text: string): string =>
  text.slice(text.indexOf(ANALYSIS_GUIDANCE_HEADING), text.indexOf("## Size"))

describe("a video analysis as the brief (plan-import-v2 §10.2)", () => {
  it("is in the skill AND the system prompt, and names every seat it maps to", () => {
    const registry = buildFormatRegistry()
    const { skillMd } = renderSkill(registry, GENERATED_FROM)
    const prompt = renderSystemPrompt(registry)
    for (const text of [skillMd, prompt]) {
      expect(text).toContain(ANALYSIS_GUIDANCE_HEADING)
      for (const seat of [
        "`imageUrl`",
        // `shots[].audio` and bare `transition` also appear OUTSIDE this
        // section (rule 12, and "## The three layers"), so they'd pass even
        // with the section deleted — replaced (fix round 1, addendum) with
        // `speakerSlot` and `onScreenTextKind`, which only this section
        // carries.
        "`speakerSlot`",
        "`onScreenTextKind`",
        "`voice.text`",
        "`film.styleId`",
        "`cameraMotionId`",
        // The FLOOR is the registry's, not a doctrine number retyped here: a
        // bump to `BEAT_MIN_SECONDS` moves the rendered sentence, and a literal
        // would fail this seat rather than follow it.
        `shorter than ${registry.shots.minSeconds} s`,
      ]) {
        expect(text).toContain(seat)
      }
      // A scene's LAST cut has an edit-OUT too, and its own seat for it —
      // without this rule the generator hangs it on a next shot that doesn't
      // exist and the scene ends dead. Asserted INSIDE the mapping section:
      // "## The three layers" names the seat as well, so a whole-text
      // `toContain` would pass with the mapping rule deleted.
      expect(sectionOf(text)).toContain("`motion.endTransition`")
    }
    expect(prompt.length).toBeLessThan(90_000)
  })

  it("R52 — refImageUrl→imageUrl is a skill-only instruction, never the generator's", () => {
    // The structural schema the generator answers against refuses
    // `cast[].imageUrl` (D1); rule 10 already tells a hand-author to leave it
    // out. Teaching the GENERATOR to map `refImageUrl` there would repeat the
    // exact hazard D1 gates rule 18 against, so this mapping line is
    // skill-only (`opts.skill`) and the prompt gets a replacement sentence.
    const registry = buildFormatRegistry()
    const { skillMd } = renderSkill(registry, GENERATED_FROM)
    const prompt = renderSystemPrompt(registry)
    expect(skillMd).toContain("`refImageUrl` → `imageUrl`")
    expect(prompt).not.toContain("refImageUrl")
    expect(prompt).toContain("the generator never writes `imageUrl`")
  })

  it("wraps the derived cast-kind bullet instead of running it to one long line", () => {
    // The section is hand-wrapped at ~95 chars, but the cast-kind pairs are
    // DERIVED from `CAST_KIND_LIST` — the bullet has to wrap ITSELF, or a
    // fifth kind pushes one line past 200 chars again (leg-E fix wave, A4).
    // A cap with slack over the section's own norm, not a formatter — and a
    // pair is never broken across two lines, which is what the `toContain`
    // below is for.
    const LINE_CAP = 105
    const registry = buildFormatRegistry()
    const { skillMd } = renderSkill(registry, GENERATED_FROM)
    const prompt = renderSystemPrompt(registry)
    for (const [rendering, text] of [
      ["the skill", skillMd],
      ["the system prompt", prompt],
    ] as const) {
      const section = sectionOf(text)
      const long = section.split("\n").filter((line) => line.length > LINE_CAP)
      expect(long, `${rendering}: line(s) over ${LINE_CAP} chars: ${long.join(" ⏎ ")}`).toEqual([])
      for (const kind of CAST_KIND_LIST) {
        expect(section).toContain(`\`wired-${kind}\` → ${kind}`)
      }
    }
  })

  /** R80 — the audio row's non-speech mode list is DERIVED from the platform's
   *  `VIDEO_ANALYSIS_AUDIO_MODES`, never hand-typed. What this pins is the
   *  derivation, not upstream growth: a hand-typed list (which is how the row
   *  read at `@nodaro/shared` 2.20.0, and how it went stale when `ambience`
   *  shipped) goes RED here. A mode the platform ADDS is already a compile
   *  error in `audio.ts` (`_unionIsInList`) and re-renders the skill through
   *  the drift test — this is where its name then shows up in the mapping. */
  it("renders the non-speech mode list from the platform's own modes (R80)", () => {
    const registry = buildFormatRegistry()
    const { skillMd } = renderSkill(registry, GENERATED_FROM)
    const prompt = renderSystemPrompt(registry)
    const expected = VIDEO_ANALYSIS_AUDIO_MODES.filter((mode) => mode !== "speech")
    expect(expected.length).toBeGreaterThan(1)
    for (const [rendering, text] of [
      ["the skill", skillMd],
      ["the system prompt", prompt],
    ] as const) {
      // The row wraps itself (`wrapBullet`), so read it off the section with
      // its line breaks and continuation indents flattened back to spaces.
      const flat = sectionOf(text).replace(/\s*\n\s*/g, " ")
      const row = /`audio\[]`: (.+?) → `shots\[]\.audio` cues/.exec(flat)
      expect(row, `${rendering}: no audio mapping row`).not.toBeNull()
      const modes = row![1].split(" / ").map((token) => token.replace(/`/g, ""))
      expect(modes, `${rendering}'s audio row`).toEqual([...expected])
      expect(modes, `${rendering}'s audio row`).not.toContain("speech")
    }
  })

  it("sits after Common mistakes and before Size, per the Interfaces contract", () => {
    const registry = buildFormatRegistry()
    const { skillMd } = renderSkill(registry, GENERATED_FROM)
    const mistakesAt = skillMd.indexOf("## Common mistakes")
    const analysisAt = skillMd.indexOf(ANALYSIS_GUIDANCE_HEADING)
    const sizeAt = skillMd.indexOf("## Size")
    expect(mistakesAt).toBeGreaterThan(-1)
    expect(analysisAt).toBeGreaterThan(mistakesAt)
    expect(sizeAt).toBeGreaterThan(analysisAt)
  })

  /** Fix round 1, item 2 (SHOULD-FIX) — a guard for the mapping's hand-typed
   *  field names: every backticked token resolves to a real ANALYSIS field (the
   *  four exported video-analysis shapes) or PLAN field (this format's own
   *  vocabulary), never a hand-typed guess that quietly drifted from either. */
  describe("the mapping's field names are real (fix round 1, item 2)", () => {
    const registry = buildFormatRegistry()
    const { skillMd } = renderSkill(registry, GENERATED_FROM)
    // BOTH renderings, not the skill alone (leg-E fix wave, A2): the two carry
    // a different sentence each (R52 — `refImageUrl` → `imageUrl` in the skill,
    // "the generator never writes `imageUrl`" in the prompt), so a token that
    // only ever reaches the GENERATOR would otherwise go unchecked.
    const prompt = renderSystemPrompt(registry)

    // ANALYSIS-side: the four exported video-analysis shapes' own fields, the
    // audio-cue shape nested inside a scene (`mode` / `content` / `voice` /
    // `speakerSlot` / `speaker` — reachable, so it is read rather than
    // allowlisted; `speaker` arrived with `@nodaro/shared` 2.21.0), plus
    // the umbrella `videoAnalysisResultSchema`'s own root keys — `meta` / `look`
    // / `slots[]` / `scenes[]` are document SUB-TREES, not leaf fields.
    const ANALYSIS_FIELDS: ReadonlySet<string> = new Set([
      ...Object.keys(entitySlotSchema.shape),
      ...Object.keys(analyzedSceneSchema.shape),
      ...Object.keys(analyzedSceneSchema.shape.audio.element.shape),
      ...Object.keys(clipLookSchema.shape),
      ...Object.keys(videoAnalysisResultSchema.shape.meta.shape),
    ])
    const ANALYSIS_ROOTS: ReadonlySet<string> = new Set(
      Object.keys(videoAnalysisResultSchema.shape),
    )

    // PLAN-side: every document key set the format defines, plus the registry's
    // own pick axes (a scene/shot pick key, e.g. `framingId`) and `AUDIO_MODES`
    // (an audio cue's `mode` value) — both explicitly named in the fix-round
    // ruling as PLAN-side vocabulary beyond the static `*_KEYS` sets.
    const PLAN_FIELDS: ReadonlySet<string> = new Set([
      ...DOCUMENT_KEYS,
      ...SCENE_KEYS,
      ...FRAME_KEYS,
      ...MOTION_KEYS,
      ...SHOT_KEYS,
      ...AUDIO_KEYS,
      ...CAST_KEYS,
      ...VOICE_KEYS,
      ...FILM_LOOK_KEYS,
      ...lookPickerKeys(registry).map((p) => p.key),
      ...shotPickKeys(registry).map((p) => p.key),
      ...AUDIO_MODES,
    ])
    const PLAN_ROOTS: ReadonlySet<string> = new Set([...DOCUMENT_KEYS, ...SCENE_KEYS])

    // ONE named allowlist, a reason per entry — every token here is real, but
    // resolves outside the two unions above for a stated reason.
    const ALLOWLIST: Readonly<Record<string, string>> = {
      subtitle: "an `onScreenTextKind` ENUM VALUE, not a field name",
      continuous: "a `storyJump` ENUM VALUE, not a field name",
    }

    // A dotted token's PREFIX names which side its suffix is read against —
    // `look.styleId` means the ANALYSIS document's own `look` (never
    // `scenes[].look`, which the prose never writes dotted), `film.styleId`
    // means the PLAN's `film`. Deliberately explicit rather than inferred: an
    // unrecognised prefix fails loudly instead of guessing a side.
    const DOTTED_PREFIX_SIDE: Readonly<Record<string, "analysis" | "plan">> = {
      meta: "analysis",
      look: "analysis",
      slots: "analysis",
      shots: "plan",
      motion: "plan",
      voice: "plan",
      film: "plan",
    }

    // Only tokens SHAPED like a field path — an identifier, optionally
    // dotted/bracketed. Excludes prose fragments and worked-syntax examples
    // (`{slot:id}`, `@<label>`, `` `On-screen text: "…"` ``) — those aren't
    // field names to validate.
    const FIELD_TOKEN = /^[A-Za-z][A-Za-z0-9-]*(\[])?(\.[A-Za-z][A-Za-z0-9-]*(\[])?)*$/

    // The one skipped shape that still NAMES fields: an arithmetic expression
    // (`endSec − startSec`). Its operands are checked like any other token
    // (leg-E fix wave, A2) — reading them off the prose, so a drift to
    // `end − start` fails here rather than passing a spelling nothing has.
    const EXPRESSION_TOKEN = /^[A-Za-z][A-Za-z0-9]*( [−+*/] [A-Za-z][A-Za-z0-9]*)+$/

    function isKnown(token: string): boolean {
      // The cast-kind pairs are DERIVED from `CAST_KIND_LIST` (fix-round
      // addendum) — a `wired-<kind>` token is real whenever `<kind>` is.
      const wired = /^wired-(.+)$/.exec(token)
      if (wired && (CAST_KIND_LIST as readonly string[]).includes(wired[1])) return true

      const parts = token.split(".")
      if (parts.length === 1) {
        const bare = parts[0].replace(/\[]$/, "")
        return (
          ANALYSIS_FIELDS.has(bare) ||
          PLAN_FIELDS.has(bare) ||
          ANALYSIS_ROOTS.has(bare) ||
          PLAN_ROOTS.has(bare) ||
          bare in ALLOWLIST
        )
      }
      const prefix = parts[0].replace(/\[]$/, "")
      const suffix = parts[parts.length - 1].replace(/\[]$/, "")
      const side = DOTTED_PREFIX_SIDE[prefix]
      if (side === undefined) return false
      const pool = side === "analysis" ? ANALYSIS_FIELDS : PLAN_FIELDS
      return pool.has(suffix) || suffix in ALLOWLIST
    }

    /** C3 — `styleId` used to sit in the ALLOWLIST above as a forward
     *  reference (spec §13). `@nodaro/shared` 2.21.0 publishes it on
     *  `clipLookSchema`, so the token now resolves through `ANALYSIS_FIELDS`
     *  like any other. Asserted by NAME rather than left to the sweep below: a
     *  platform revert would otherwise surface as an unexplained unknown
     *  token, not as "the field the mapping's `look.styleId → film.styleId`
     *  row is about went away". */
    it("reads `styleId` off the published clip look, not an allowlist (C3)", () => {
      expect(Object.keys(clipLookSchema.shape)).toContain("styleId")
      expect(ALLOWLIST).not.toHaveProperty("styleId")
    })

    it("every field-shaped backtick token resolves to a real plan or analysis field", () => {
      for (const [rendering, text] of [
        ["the skill", skillMd],
        ["the system prompt", prompt],
      ] as const) {
        const tokens = [...sectionOf(text).matchAll(/`([^`]+)`/g)].map((m) => m[1])
        const fieldTokens = tokens.flatMap((t) =>
          FIELD_TOKEN.test(t) ? [t] : EXPRESSION_TOKEN.test(t) ? t.split(/ [−+*/] /) : [],
        )
        expect(
          fieldTokens.length,
          `${rendering}'s section should carry plenty of field-shaped tokens`,
        ).toBeGreaterThan(20)
        const unknown = fieldTokens.filter((t) => !isKnown(t))
        expect(unknown, `unrecognised field-shaped token(s) in ${rendering}: ${unknown.join(", ")}`).toEqual([])
      }
    })
  })
})
