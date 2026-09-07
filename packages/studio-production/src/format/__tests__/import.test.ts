import { describe, it, expect } from "vitest"

import type { ReferenceSource } from "@nodaro/shared"

import { videoDurationOptions } from "../../model-menu"
import example from "../fixtures/example.json"
import { EXAMPLE_LIBRARY } from "../fixtures/library"
import {
  importProduction,
  parseDocument,
  validateDocument,
  type ImportOptions,
  type ImportResult,
} from "../import"
import { buildFormatRegistry } from "../registry"
import type { MentionCandidate } from "../../prompt-mentions"

/**
 * Stages 1–2 of the pipeline and the END-TO-END run (spec §6). The stages with
 * a suite of their own live beside this one, split out in the follow-ups fix
 * wave once this file passed the 800-line house cap: `import.resolve.test.ts`
 * (§6.4), `import.map.test.ts` (§6.5), `import.summary.test.ts` (the preview
 * receipt) and `import.music.test.ts` (the soundtrack, D5/R42). Each carries
 * its own copy of these builders for the reason a `.test.ts` is never imported
 * from a `.test.ts`: it would re-run its own blocks a second time.
 */
/**
 * Stages 1–2 of the pipeline (spec §6): what is a document at all. A wrong
 * `format` is refused before the schema runs (§3), and a hard failure names the
 * first failing path so the dialog can point at it (§11).
 */
describe("parse", () => {
  it("rejects text that is not JSON", () => {
    const out = parseDocument("{nope")
    expect(out).toEqual({ error: "That file isn't valid JSON." })
  })

  it("rejects a JSON array", () => {
    expect(parseDocument("[]")).toEqual({
      error: "A production file must be a JSON object.",
    })
  })

  it("rejects a foreign format before parsing it", () => {
    const out = parseDocument({ format: "some-other-tool", version: 1 })
    expect(out).toEqual({
      error: 'Not a studio production file (expected "format": "nodaro-studio-production").',
      path: "format",
    })
  })

  it("accepts an already-parsed object", () => {
    expect(parseDocument(example)).toEqual({ doc: example })
  })
})

describe("validate", () => {
  it("returns the typed document for the §3 example", () => {
    const out = validateDocument(example)
    expect("doc" in out && out.doc.scenes).toHaveLength(1)
  })

  it("names the first failing path", () => {
    const out = validateDocument({
      format: "nodaro-studio-production",
      version: 1,
      scenes: [{ shots: [{ seconds: 4 }] }],
    })
    expect(out).toEqual({
      error: expect.stringContaining("expected string"),
      path: "scenes[0].shots[0].text",
    })
  })
})

// `source` MUST be annotated: `ConnectedReference.source` is the narrow union
// `ReferenceSource`, and an unannotated default widens the parameter to `string`.
// `source` MUST be annotated: `ConnectedReference.source` is the narrow union
// `ReferenceSource`, and an unannotated default widens the parameter to `string`.
const candidate = (
  id: string,
  name: string,
  source: ReferenceSource = "wired-character",
): MentionCandidate => ({
  id,
  name,
  toConnectedReference: () => ({
    id,
    defaultName: name,
    source,
    url: `https://r2.example/${id}.png`,
  }),
})

const REGISTRY = buildFormatRegistry()

const options = (
  candidates = EXAMPLE_LIBRARY,
): ImportOptions => ({
  candidates,
  durationsFor: (model) => videoDurationOptions(model).map((d) => d.value),
  registry: REGISTRY,
})

/**
 * Both halves of §6.4's promise, read off ONE result: the names the preview
 * tells the user to create, and the names the warnings complain about. They are
 * the SAME set or the dialog asks for an entity nothing explains.
 */
const castVerdict = (
  out: ImportResult,
  cast: ReadonlyArray<{ name: string }>,
): { summarised: string[]; warned: string[] } => ({
  summarised: out.ok ? out.summary.unresolvedCast.map((e) => e.name) : [],
  warned: out.ok
    ? out.warnings
        .filter((w) => w.code === "unresolved-cast")
        .map((w) => cast[Number(/\[(\d+)\]/.exec(w.path ?? "")?.[1])].name)
    : [],
})

describe("importProduction", () => {
  it("imports the §3 example with ZERO warnings", () => {
    const out = importProduction(JSON.stringify(example), options())
    expect(out.ok && out.warnings).toEqual([])
  })

  it("carries the title for a new production", () => {
    const out = importProduction(example, options())
    expect(out.ok && out.title).toBe("Rain in Rome")
  })

  it("carries the root brief, trimmed (D6)", () => {
    const out = importProduction(
      { ...example, brief: "  A rain-soaked chase through Rome.  " },
      options(),
    )
    expect(out.ok && out.brief).toBe("A rain-soaked chase through Rome.")
  })

  it("omits brief when the document doesn't carry one, or carries only whitespace", () => {
    // `example` now carries its own `brief` (D6 fix round 1's round-trip pin) —
    // explicitly absent here, not reused bare.
    const bare = importProduction({ ...example, brief: undefined }, options())
    expect(bare.ok && "brief" in bare).toBe(false)
    const blank = importProduction({ ...example, brief: "   " }, options())
    expect(blank.ok && "brief" in blank).toBe(false)
  })

  it("rejects a bad document with the first failing path", () => {
    const out = importProduction(
      { format: "nodaro-studio-production", version: 1, scenes: [] },
      options(),
    )
    expect(out).toEqual({
      ok: false,
      error: expect.stringContaining("Too small"),
      path: "scenes",
    })
  })

  it("warns about a key from a newer studio, and still imports", () => {
    const out = importProduction(
      {
        format: "nodaro-studio-production",
        version: 1,
        soundtrackId: "abc",
        scenes: [{ frame: { prompt: "p" }, mood: "tense" }],
      },
      options(),
    )
    expect(out.ok && out.warnings.map((w) => w.path)).toEqual([
      "soundtrackId",
      "scenes[0].mood",
    ])
    expect(out.ok && out.shots).toHaveLength(1)
  })

  it("a document-level `voice` key now warns unknown-key (D7 — voice lives at scenes[].voice, not a reserved root slot)", () => {
    const out = importProduction(
      {
        format: "nodaro-studio-production",
        version: 1,
        scenes: [{ frame: { prompt: "p" } }],
        voice: { lines: [] },
      },
      options(),
    )
    expect(out.ok && out.warnings).toEqual([
      {
        code: "unknown-key",
        message: '"voice" is not part of this format — dropped.',
        path: "voice",
      },
    ])
  })

  it("still imports a v1 document carrying its era's root voice/music shapes (D13 backward compat)", () => {
    // Before D5/D7 a v1 file could carry `voice: { track }` (the reserved slot)
    // and a bare-array `music` (the pre-D5 shape). Neither special-cases the
    // version: `voice` is swept as any other unknown key would be, and `music`
    // goes through `repairMusic`'s own trust boundary (R42) exactly as a
    // current file's malformed soundtrack would.
    const out = importProduction(
      {
        format: "nodaro-studio-production",
        version: 1,
        scenes: [{ frame: { prompt: "an alley" } }],
        voice: { track: "vo-1" },
        music: ["cue-a"],
      },
      options(),
    )
    expect(out.ok).toBe(true)
    expect(out.ok && out.warnings).toEqual([
      {
        code: "unknown-key",
        message: '"voice" is not part of this format — dropped.',
        path: "voice",
      },
      {
        code: "audio",
        message: "The soundtrack could not be read and was dropped.",
        path: "music",
      },
    ])
  })

  it("leaves a picker key inside `look` to repair — one warning, not two", () => {
    const out = importProduction(
      {
        format: "nodaro-studio-production",
        version: 1,
        scenes: [{ look: { vibeId: "moody" }, frame: { prompt: "p" } }],
      },
      options(),
    )
    expect(out.ok && out.warnings).toHaveLength(1)
    expect(out.ok && out.warnings[0].path).toBe("scenes[0].look.vibeId")
  })

  it("sweeps an alien key at EVERY fixed-shape level", () => {
    // One key per level — TWELVE levels, THIRTEEN rows (`audio` is probed at
    // two paths, see below): AUDIO_KEYS joined the seven B5 found here,
    // VOICE_KEYS + DELIVERY_KEYS joined for D4, MUSIC_KEYS for D5, all in
    // one document — and every key is BORROWED FROM A SIBLING LEVEL's set
    // (`duration` is motion's and a lever's, `count` is framing's, `title` is
    // the document's, `label`/`text` are a shot's, `position` is a lever's;
    // music's `text` is a shot's/voice's). A key alien to every level would
    // warn no matter which set the sweep was handed, which is what makes a
    // swapped argument nearly invisible: `MOTION_KEYS` is `FRAME_KEYS` plus
    // its own, minus `count`.
    //
    // The two AUDIO_KEYS probes sit at different paths on purpose: the shot's
    // own `audio[0]` (scene 0, which has shots), and a SECOND, SHOT-LESS
    // scene's `motion.audio[0]` — never scene 0's motion, which would trigger
    // the D3 scene→first-shot move (and its own `audio` warning) and break
    // this list's exactness. `voice`/`voice.delivery` sit on scene 0 too, AFTER
    // its shots — the sweep's own order (`unknownKeyWarnings`).
    const out = importProduction(
      {
        format: "nodaro-studio-production",
        version: 1,
        name: "abc",
        scenes: [
          {
            title: "The chase",
            frame: { prompt: "p", duration: 3 },
            motion: { count: 2 },
            shots: [
              {
                seconds: 4,
                text: "she runs",
                duration: "short",
                transition: { id: "cross-dissolve", label: "Cut" },
                characterFx: { id: "werewolf", text: "howl" },
                audio: [{ mode: "sfx", content: "x", volume: 1 }],
              },
            ],
            voice: { text: "hi", duration: 3, delivery: { position: "start" } },
          },
          {
            motion: { audio: [{ mode: "sfx", content: "y", gain: 1 }] },
          },
        ],
        cast: [{ kind: "character", name: "Natalie", title: "lead" }],
        music: { prompt: "strings", text: "x" },
      },
      options(),
    )
    // EXACTLY these — the document is otherwise repair-clean, so a level swept
    // twice, missed, or against the wrong set shows up here. Compared as an
    // ORDERED ARRAY of [code, path] pairs, never a Set of paths (B8): a level
    // an extra `sweep` call visits twice pushes a SECOND, identically-pathed
    // warning — a length/order-sensitive `toEqual` on the array fails on that
    // extra element, where de-duping into a Set first would silently absorb
    // it back down to the same 13 unique paths and miss the bug entirely.
    expect(out.ok && out.warnings.map((w) => [w.code, w.path])).toEqual([
      ["unknown-key", "name"],
      ["unknown-key", "scenes[0].title"],
      ["unknown-key", "scenes[0].frame.duration"],
      ["unknown-key", "scenes[0].motion.count"],
      ["unknown-key", "scenes[0].shots[0].duration"],
      ["unknown-key", "scenes[0].shots[0].transition.label"],
      ["unknown-key", "scenes[0].shots[0].characterFx.text"],
      ["unknown-key", "scenes[0].shots[0].audio[0].volume"],
      ["unknown-key", "scenes[0].voice.duration"],
      ["unknown-key", "scenes[0].voice.delivery.position"],
      ["unknown-key", "scenes[1].motion.audio[0].gain"],
      ["unknown-key", "cast[0].title"],
      ["unknown-key", "music.text"],
    ])
  })

  it("imports a NARRATION-ONLY scene — voice is a fourth stage (whole-branch panel)", () => {
    // The at-least-one refine never learned `voice`, so a scene with a line and
    // no framing hard-rejected the WHOLE file. It lands as a plan-only shot
    // carrying `plan.voice` — what the exporter's own plan-only rung expects.
    const out = importProduction(
      {
        format: "nodaro-studio-production",
        version: 1,
        scenes: [{ voice: { text: "Somewhere south of the border." } }],
      },
      options(),
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.warnings).toEqual([])
    expect(out.shots).toHaveLength(1)
    expect(out.shots[0].plan?.voice).toEqual({
      text: "Somewhere south of the border.",
    })
    expect(out.shots[0].plan?.frame).toBeUndefined()
  })

  it("still refuses a scene that plans NOTHING", () => {
    const out = importProduction(
      {
        format: "nodaro-studio-production",
        version: 1,
        scenes: [{ name: "a scene that plans nothing" }],
      },
      options(),
    )
    expect(out.ok).toBe(false)
  })

  it("lists an unresolved cast member in the summary", () => {
    const out = importProduction(
      {
        format: "nodaro-studio-production",
        version: 1,
        scenes: [{ frame: { prompt: "@Marco waits" } }],
        cast: [{ kind: "character", name: "Marco" }],
      },
      options(),
    )
    expect(out.ok && out.summary.unresolvedCast).toEqual([
      { kind: "character", name: "Marco" },
    ])
  })

  it("names in the summary exactly what the warnings call unresolved", () => {
    // Two rows share a name and disagree about its kind: the first is AMBIGUOUS
    // (two library rows answer to "River"), the second UNPLACEABLE. One dedup set
    // spanning both codes swallows the second — and the summary then names an
    // entity no warning explains.
    const cast = [
      { kind: "character", name: "River" },
      { kind: "vehicle", name: "River" },
    ]
    const out = importProduction(
      {
        format: "nodaro-studio-production",
        version: 1,
        scenes: [{ frame: { prompt: "@River at dawn" } }],
        cast,
      },
      options([
        candidate("c-river", "River"),
        candidate("l-river", "River", "wired-location"),
      ]),
    )
    expect(out.ok && out.warnings.map((w) => [w.code, w.path])).toEqual([
      ["ambiguous-cast", "cast[0]"],
      ["unresolved-cast", "cast[1]"],
    ])
    const verdict = castVerdict(out, cast)
    expect(verdict.summarised).toEqual(["River"])
    expect(verdict.warned).toEqual(verdict.summarised)
    expect(out.ok && out.summary.unresolvedCast).toEqual([
      { kind: "vehicle", name: "River" },
    ])
  })

  it("lands a shot's @mention as a binding on its beat", () => {
    const out = importProduction(
      {
        format: "nodaro-studio-production",
        version: 1,
        scenes: [{ shots: [{ seconds: 4, text: "@Natalie turns the corner" }] }],
      },
      options(),
    )
    expect(out.ok && out.shots[0].beats?.[0].references).toEqual([
      {
        id: "char-natalie",
        defaultName: "Natalie",
        source: "wired-character",
        url: "https://r2.example/natalie.png",
      },
    ])
  })

  it("lands a shot's cues on the beat and PLACES their tokens (D6)", () => {
    const out = importProduction(
      {
        format: "nodaro-studio-production",
        version: 1,
        scenes: [
          {
            shots: [
              {
                seconds: 4,
                text: "she runs",
                audio: [
                  { mode: "sfx", content: "wind" },
                  { mode: "speech", content: "Go!", speaker: "Natalie", voice: "urgent" },
                ],
              },
            ],
          },
        ],
      },
      options(),
    )
    expect(out.ok && out.shots[0].beats![0]).toMatchObject({
      text: "she runs [wind] [Go!]",
      directions: [
        { kind: "sfx", text: "wind" },
        { kind: "speech", text: "Go!", speaker: "Natalie", voice: "urgent" },
      ],
    })
    expect(out.ok && out.summary.audioCues).toBe(2)
  })

  it("a scene without shots keeps its cues on the plan's motion, tokens in the prompt", () => {
    const out = importProduction(
      {
        format: "nodaro-studio-production",
        version: 1,
        scenes: [
          {
            motion: {
              prompt: "slow push [drums]",
              audio: [
                { mode: "music", content: "drums" },
                { mode: "sfx", content: "rain" },
              ],
            },
          },
        ],
      },
      options(),
    )
    expect(out.ok && out.shots[0].plan?.motion).toMatchObject({
      prompt: "slow push [drums] [rain]",
      directions: [
        { kind: "music", text: "drums" },
        { kind: "sfx", text: "rain" },
      ],
    })
  })

  it("places one token per cue even when two cues are identical", () => {
    // No dedup by text: `unplacedDirectionTokens` walks the directions list
    // one at a time, so a doubled cue must place a doubled token.
    const out = importProduction(
      {
        format: "nodaro-studio-production",
        version: 1,
        scenes: [
          {
            shots: [
              {
                seconds: 4,
                text: "the door creaks",
                audio: [
                  { mode: "sfx", content: "wind" },
                  { mode: "sfx", content: "wind" },
                ],
              },
            ],
          },
        ],
      },
      options(),
    )
    expect(out.ok && out.shots[0].beats![0]).toMatchObject({
      text: "the door creaks [wind] [wind]",
      directions: [
        { kind: "sfx", text: "wind" },
        { kind: "sfx", text: "wind" },
      ],
    })
  })

  it("places a cue whose content itself contains a bracket, and stays stable once already placed", () => {
    // A plain `indexOf` substring search, not a bracket parser — nesting must
    // not confuse it. The second call simulates the document a re-export
    // would produce (export never touches `text`): importing it a second time
    // must not double the token (D6's "already there" rung).
    const scene = (text: string) => ({
      format: "nodaro-studio-production" as const,
      version: 1,
      scenes: [
        {
          shots: [
            { seconds: 4, text, audio: [{ mode: "sfx", content: "door [slam]" }] },
          ],
        },
      ],
    })
    const first = importProduction(scene("she flinches"), options())
    expect(first.ok && first.shots[0].beats![0]).toMatchObject({
      text: "she flinches [door [slam]]",
      directions: [{ kind: "sfx", text: "door [slam]" }],
    })
    const again = importProduction(scene("she flinches [door [slam]]"), options())
    expect(again.ok && again.shots[0].beats![0]).toMatchObject({
      text: "she flinches [door [slam]]",
      directions: [{ kind: "sfx", text: "door [slam]" }],
    })
  })
})
