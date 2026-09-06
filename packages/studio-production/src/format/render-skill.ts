import { VIDEO_ANALYSIS_AUDIO_MODES } from "@nodaro/shared"

import { DIRECTING_MODES } from "../model-menu"
import { renderLegend } from "./legend"
import { lookPickerKeys, type FormatRegistry } from "./registry"
import {
  CAST_KIND_LIST,
  FORMAT_ID,
  FORMAT_VERSION,
} from "./schema"

/**
 * The SKILL and the generator's system prompt — the last two of the format's
 * five rendered artifacts (spec §4, §9).
 *
 * One body of prose serves both: `SKILL.md` (frontmatter + body, pointing at
 * `references/catalog.md` and `schema.json`) is what an external agent or MCP
 * client reads, and `renderSystemPrompt` is the same body with the legend
 * inlined, which is what our own generator sends. Writing them twice is exactly
 * how the published contract and the shipped prompt drift apart.
 *
 * Every number in the prose is interpolated from the registry — the candidate
 * ceiling, the tenths step, the default models — so a lever change cannot leave
 * a stale sentence behind.
 */

/** The catalog versions the artifacts were rendered against — recorded in the
 *  frontmatter so an author can tell WHICH vocabulary a file follows (§11).
 *  Bare semver strings; this module composes the package names. */
export interface GeneratedFrom {
  readonly prompts: string
  readonly shared: string
}

/**
 * The worked example that ships INSIDE the skill. A local object rather than an
 * import of `fixtures/example.json`, because the renderers must load under
 * plain node in the generator script; `render-skill.test.ts` parses it back out
 * of the rendered markdown and checks every key, id and model against the
 * registry, so an id the catalog dropped cannot ship in it.
 *
 * DELIBERATELY NARROWER than `fixtures/example.json` (D7 fix round 1, R47):
 * this literal is what `renderSystemPrompt` sends to the GENERATOR (beside
 * `renderStructuralJsonSchema`, on the same `generate.ts` wire), so it must
 * satisfy that STRUCTURAL, route-facing schema whole — `frame.subject` (D1)
 * and `cast[].imageUrl` (D8) are STRICT-schema-only fields the route's own
 * `frame`/`cast.items` objects refuse under `additionalProperties: false`,
 * so this example omits both (a generator shown either would be taught a
 * field it can never actually author). The fixture is the richer,
 * studio-EXPORT-shaped superset that carries them, for the import / round-trip
 * / strict-schema tests that need every leg-D field exercised.
 */
const WORKED_EXAMPLE = {
  format: FORMAT_ID,
  version: FORMAT_VERSION,
  title: "Rain in Rome",
  brief: "A rain-soaked chase through Rome, teal-orange, sparse dialogue.",
  film: { cameraFormatId: "arri-alexa", colorLookId: "teal-orange" },
  folders: ["Act 1"],
  scenes: [
    {
      name: "The chase begins",
      folder: "Act 1",
      look: { "lighting-time-of-day": "golden-hour", atmosphereId: ["fog", "light-rain"] },
      frame: {
        prompt: "@Natalie sprints down a narrow Roman alley, SUV headlights behind her",
        model: "gpt-image-2",
        aspectRatio: "16:9",
        resolution: "2K",
        count: 2,
      },
      motion: {
        scenePrompt: "A rain-soaked rooftop chase, shot handheld. Sparse dialogue.",
        model: "seedance-2",
        aspectRatio: "16:9",
        resolution: "1080p",
        duration: 10,
        cameraMotionId: "tracking-shot",
        input: "start",
        endTransition: { id: "cross-dissolve", duration: "short" },
      },
      shots: [
        {
          seconds: 4,
          label: "Sprint",
          text: "she sprints toward camera",
          picks: { framingId: "wide-shot" },
          transition: { id: "cross-dissolve" },
          audio: [
            { mode: "speech", content: "Go, go, go!", speaker: "Natalie", voice: "female, urgent" },
            { mode: "sfx", content: "heavy rain hammering the cobblestones, distant thunder" },
          ],
        },
        {
          seconds: 6,
          text: "the SUV swerves",
          picks: { framingAngleId: "low-angle" },
          transition: {
            id: "whip-pan",
            position: "start",
            duration: "short",
            intensity: "dynamic",
          },
          characterFx: { id: "werewolf", position: "start", intensity: "crazy" },
        },
      ],
      voice: {
        text: "She wasn't stopping — not for anything.",
        casting: "female, urgent",
      },
    },
  ],
  cast: [
    {
      kind: "character",
      name: "Natalie",
      description: "late 20s, red raincoat",
    },
  ],
  music: {
    prompt: "A tense, rain-soaked chase score — driving strings, pulsing low end, no vocals.",
    duration: 30,
    vocals: "instrumental",
    genre: "cinematic",
  },
}

/**
 * `` `word` on model-id `` for models whose resolution VOCABULARIES genuinely
 * differ — the frame default, an image model that spells the same axis in other
 * words, and the motion default. Interpolated rather than written out, because
 * the rule it illustrates is "take the words from the model's own row": an
 * example naming a model or a word this catalog does not have would teach the
 * exact mistake the rule forbids.
 */
function resolutionExamples(registry: FormatRegistry): string {
  const frame = registry.imageModels.find((m) => m.id === registry.defaults.imageModel)
  const motion = registry.videoModels.find((m) => m.id === registry.defaults.videoModel)
  const other = registry.imageModels.find(
    (m) =>
      m.resolutions.length > 0 &&
      !m.resolutions.some((r) => frame?.resolutions.includes(r) === true),
  )
  return [frame, other, motion]
    .map((model) => {
      const word = model?.resolutions[1] ?? model?.resolutions[0]
      return model && word ? `\`${word}\` on ${model.id}` : undefined
    })
    .filter((example): example is string => example !== undefined)
    .join(", ")
}

const DESCRIPTION =
  "Author a Nodaro Studio production plan — the portable JSON a user imports at studio.nodaro.ai to create or extend a production (film look, scenes, framing and motion setup, timed shots with picks, transitions and character FX)."

/** A few real subject dimension names, straight off the registry — the rule
 *  below shows what the field looks like, and a hand-typed list would drift
 *  from the catalog the same rule points at. */
function subjectFieldExamples(registry: FormatRegistry): string {
  return registry.subject
    .slice(0, 4)
    .map((d) => `\`${d.field}\``)
    .join(", ")
}

function exampleFence(): string {
  return ["```json", JSON.stringify(WORKED_EXAMPLE, null, 2), "```"].join("\n")
}

export const ANALYSIS_GUIDANCE_HEADING = "## A video analysis as the brief"

/**
 * Packs a bullet's PIECES onto lines of the section's own ~95-char norm,
 * breaking only BETWEEN them — never inside one. The prose around it is
 * hand-wrapped, but a bullet whose middle is derived from a catalog (the
 * cast-kind pairs below) has no hand to wrap it: a fifth kind would simply
 * make the line longer. Continuation lines take the bullet's 2-space indent.
 * A piece is atomic, so keep each one short enough to sit on a line of its own.
 */
function wrapBullet(pieces: readonly string[], indent = "  ", width = 95): string[] {
  const lines: string[] = []
  let line = ""
  for (const piece of pieces) {
    const next = line === "" ? piece : `${line} ${piece}`
    if (line !== "" && next.length > width) {
      lines.push(line)
      line = `${indent}${piece}`
    } else {
      line = next
    }
  }
  if (line !== "") lines.push(line)
  return lines
}

/** Spec §10.2 — the brief may be a platform video analysis (the recast script
 *  document). The model maps it; this is the mapping, stated once.
 *
 * `opts.skill` gates ONE sentence — R52: a slot's `refImageUrl` → cast entry
 * `imageUrl` is a studio-EXPORT / hand-authored-file instruction (rule 10's own
 * carve-out), never something to teach the GENERATOR: the structural schema
 * refuses `cast[].imageUrl` (D1's invariant, same reason rule 18 is gated).
 * `renderSystemPrompt` gets a replacement line instead — the app binds the
 * reference image itself, the generator never writes the field. */
function analysisGuidance(
  registry: FormatRegistry,
  opts: { readonly skill?: boolean } = {},
): string[] {
  // R52 fix-round addendum: derived from CAST_KIND_LIST, not hand-typed, so a
  // fifth cast kind cannot drift from the mapping's own vocabulary — and, since
  // the list decides the bullet's LENGTH, the bullet wraps itself (A4) rather
  // than running to one 196-char line the way the four kinds already did.
  const wiredPairs = CAST_KIND_LIST.map(
    (kind, i) => `\`wired-${kind}\` → ${kind}${i === CAST_KIND_LIST.length - 1 ? ";" : ","}`,
  )
  // R80: the analyzer's own NON-speech modes, off the platform's list rather
  // than hand-typed — `speech` is the one mode the next sentence is about, and
  // it maps to a scene `voice` as often as to a cue. A mode the platform adds
  // lands in this row instead of being silently missing from it (the row's own
  // guard in `render-skill.analysis.test.ts` refuses a hand-typed list), and
  // because the row's LENGTH is derived, the bullet wraps itself the way the
  // cast-kind one does.
  const nonSpeechModes = VIDEO_ANALYSIS_AUDIO_MODES.filter((mode) => mode !== "speech")
    .map((mode) => `\`${mode}\``)
    .join(" / ")
  // The shot floor the editor's own window ladder starts at (`BEAT_MIN_SECONDS`
  // via the registry), not a doctrine number retyped here.
  const floor = registry.shots.minSeconds
  return [
    ANALYSIS_GUIDANCE_HEADING,
    "",
    "The brief may be a Nodaro video analysis (`meta` · `look` · `slots[]` · `scenes[]` with `audio[]`).",
    "Map it, never summarise it:",
    "",
    ...wrapBullet([
      "- Every slot (`slots[].source`) is a `cast` entry —",
      ...wiredPairs,
      "`label` is the name, `description` travels.",
      "Write `{slot:id}` as `@<label>` in prose.",
    ]),
    ...(opts.skill
      ? [
          "  A slot's `refImageUrl` → `imageUrl` on that cast entry — a studio-export field; leave",
          "  it out of a plan you author by hand, same as rule 10.",
        ]
      : [
          "  The app binds each slot's reference image itself — the generator never writes `imageUrl`.",
        ]),
    "- Continuous cuts in one place are ONE scene with timed `shots`. Start a new scene on a story",
    "  jump (`storyJump` other than `continuous`), a new place, or when the shots would pass the",
    `  motion model's longest clip. A cut shorter than ${floor} s merges into its neighbour — no shot`,
    `  is shorter than ${floor} s. \`seconds\` = \`endSec − startSec\` on the ${registry.shots.step} s grid.`,
    "- A cut's `visual` prose is that shot's own `text` — carried across, never summarised; a scene",
    "  with no `shots` takes it as `motion.scenePrompt`. The text is also where a value the legend",
    "  has no id for belongs: `timeOfDay: ambiguous` says the cut does not tell, so it becomes prose",
    "  or nothing, never the nearest row. And a value may sit on a DIFFERENT key here than the field",
    "  it came from — the analysis's `angle: pov` and `angle: over-the-shoulder` are",
    "  `framingCoverageId` rows, not `framingAngleId` ones — so pick by meaning, not by field name.",
    "- `shotType`, `angle`, `speed`, `timeOfDay` and `effects` become `picks` from the legend;",
    "  `camera` becomes `cameraMotionId` when a row fits AND stays in the shot text — the scene's",
    "  `motion.cameraMotionId`, or a shot's own pick where the move changes mid-scene; a cut's",
    "  `transition` (legacy `transitionOut`, the edit out of that cut) becomes the NEXT shot's",
    "  `transition`, the closest transition id from the legend, and a scene's LAST cut's edit-out",
    "  becomes that scene's `motion.endTransition` — the film's final cut too; `onScreenText` whose",
    "  `onScreenTextKind` is not `subtitle` goes into the text as `On-screen text: \"…\"`.",
    ...wrapBullet([
      "- `audio[]`:",
      nonSpeechModes,
      "→ `shots[].audio` cues.",
      "A `speech` line with a",
      "visible speaker → a `speech` cue",
      "whose `speaker` is the one the",
      "analysis names, or that",
      "`speakerSlot`'s label when it names none,",
      "and whose `voice` is its casting note.",
      "A bodiless line, or one whose note says",
      "voice-over / narration → the scene's",
      "`voice.text` (the first note →",
      "`voice.casting`), in order, split at",
      "the cuts exactly as the analysis quotes it.",
    ]),
    "- `look.styleId` → `film.styleId`. The look prose (`style`, `grade`, `format`, `lens`,",
    "  `lighting`) → the closest `film` and scene `look` ids from the legend; `genre` and",
    "  `influence` → `brief`. Never invent an id.",
    "- `meta.title` → `title` — and when the analysis has no `meta.title`, name the film yourself",
    "  from what it shows; `meta.aspectRatio` → every stage's `aspectRatio`.",
    "",
  ]
}

/**
 * The prose both artifacts share. `catalogHint` names where the ids live —
 * a file path in the skill, "below" in the system prompt.
 *
 * `opts.skill` gates the rules that belong to a HAND-AUTHORED or studio-exported
 * file and must never reach the generator's system prompt: today that is rule 18
 * (`frame.subject`), whose vocabulary is too large for the route's input budget
 * and is deliberately absent from the STRUCTURAL schema (D1's invariant — the
 * generator cannot author a field its schema does not name, so telling it about
 * one would only invite a refusal).
 */
function body(
  registry: FormatRegistry,
  catalogHint: string,
  opts: { readonly skill?: boolean } = {},
): string {
  const budgets = registry.videoModels
    .filter((m) => m.durations.length > 0)
    .map((m) => `${m.id} ${Math.max(...m.durations)}s`)
    .slice(0, 4)
    .join(", ")
  const resolutionWords = resolutionExamples(registry)
  return [
    `# ${FORMAT_ID} v${FORMAT_VERSION}`,
    "",
    "A production is a film look, a list of scenes, and each scene's plan: the",
    "still it is framed from, how it animates, and the timed shots inside that",
    "animation. It is a PLAN — no rendered media, no ids of your own.",
    "",
    "## The three layers",
    "",
    "Direction reads `film > scene look > shot picks`, each layer overriding the",
    "one before it:",
    "",
    `- \`film\` — production-wide, and only these keys: ${[...registry.filmKeys].join(", ")}. One id each.`,
    `- \`scenes[].look\` — this scene's own dimensions (${lookPickerKeys(registry).length} keys). One id per key, or an array where the key is marked \`multi ≤ N\`.`,
    "- `shots[].picks` — ONE id per key, for this window only.",
    "",
    "A `transition` is how a shot COMES IN — a cut, not a look; it is its own",
    "node with three timing levers (`position`, `duration`, `intensity`), and it",
    "is separate from the `transitionId` LOOK pick, which only tints the prose.",
    "`motion.endTransition` is the same node in the other seat: how the scene's",
    "last frames GO OUT, so the clip ends ready to meet what follows — the next",
    "scene's shot 1 `transition` is still how IT comes in.",
    "`characterFx` is an effect on the subject with the same three levers, and it",
    "is never a pick.",
    "",
    "## Rules",
    "",
    "1. **Ids, never labels.** Every pick, lever and model is a catalog id —",
    `   \`golden-hour\`, not "Golden Hour". Read them in ${catalogHint}.`,
    "2. **Keys come from the legend.** A split catalog is addressed per dimension",
    "   (`lighting-time-of-day`, never `lightingId`).",
    "3. **A scene carries at least one of `frame`, `motion` or `shots`.**",
    "4. **Prose mentions are `@Name`** and bind by exact name to the user's own",
    "   library. List everything you mention in `cast` — nothing is created for",
    "   you by the import itself; it tells the user what is missing, and they",
    "   can then choose to create a missing one from an image the file carries.",
    "   Write a `description` on every entry: a name the library has nothing for",
    "   still becomes a role in the production, described by those words, so",
    "   every scene that says the name means the same thing.",
    "5. **When a scene has `shots`, they ARE its directing prose** — do not also",
    "   write `motion.prompt`; it is dropped with a warning. What the WHOLE clip",
    "   is about — story, mood, things to avoid — goes in `motion.scenePrompt`,",
    "   which is kept beside the shots and stands over every one of them.",
    `6. **A scene's shots must fit its motion model's longest clip** (${budgets}).`,
    `   \`seconds\` runs on a ${registry.shots.step}s grid.`,
    "7. **`aspectRatio` and `resolution` are the MODEL's own words** — the same",
    `   axis is spelled differently per model (${resolutionWords}). Take both from`,
    "   that model's own row in the catalog, never from another model's.",
    `8. **\`frame.count\` is 1–${registry.candidates.max}.** Ids you write are ignored — everything is`,
    "   re-minted on import, so a file may be imported twice safely.",
    "9. **What is REJECTED outright**, rather than repaired: a missing or wrong",
    `   \`format\` (it must be \`${FORMAT_ID}\`) or \`version\` (a whole number); a \`frame\``,
    "   with no `prompt`; a shot with no `text` or no `seconds`; and a scene that",
    "   breaks rule 3. EVERYTHING else — an unknown key, an unknown id, off-grid",
    "   `seconds`, a scene over its model's budget — imports with a warning.",
    // The vocabulary is the document type's own list (`CAST_KIND_LIST`), so a
    // kind added to the format cannot leave a stale sentence here; the rendered
    // ORDER is the list's, which is why it is a tuple and not the set.
    `10. **\`cast[].kind\` is one of** \`${CAST_KIND_LIST.join(" | ")}\`.`,
    "    Another kind does NOT reject the file — that entry is listed as",
    "    unresolved and everything else imports. `schema.json` still validates",
    "    the four strictly, so a validator catches it before the user does.",
    "    `cast[].imageUrl` is in that contract but is written by a studio",
    "    EXPORT — the bound entity's own image, so a recipient can create the",
    "    ones they don't have. Leave it out of a plan you author.",
    "11. **Put the film's own look in `film`.** A camera, colour, style or era key",
    "    repeated with one id on EVERY scene is read as the film's and moved there",
    "    (a warning says so); a per-scene deviation stays on that scene.",
    "12. **Audio is a list of concurrent cues per shot** — `shots[].audio`, each",
    "    `{ mode, content, voice?, speaker? }`; `speech` is the line itself (`speaker`",
    "    is who says it — a name, not yet bound to `cast`; `voice` casts the",
    "    delivery), `tone` how it is delivered, `sfx` / `ambience` / `music`",
    "    generation-ready descriptions. Never write bracket tokens in prose — the",
    "    importer places them. A cue renders only on a model whose catalog row says",
    "    `audio: ambient` (sfx / ambience / music — speech and tone drop) or",
    "    `audio: speech` (all).",
    "13. **`motion.audio` is for a scene WITHOUT `shots`.** Beside shots, its cues",
    "    move into the first shot (a warning says so).",
    `14. **\`motion.input\` is the directing mode** — one of \`${DIRECTING_MODES.join("`, `")}\`.`,
    "    Checked at IMPORT against the scene's own model (`motion.model`), or",
    `    \`${registry.defaults.videoModel}\` (the format's default video model) when`,
    "    the plan names none — a mode that model's `inputs:` row (in the catalog)",
    "    does not list imports with a warning and is dropped. In the EDITOR,",
    "    studio's own Composer applies a scene's planned `input` to the Directing",
    "    input picker once per scene, to the model the scene OPENS WITH — only",
    "    while it has no clip yet.",
    "15. **`scenes[].voice` is the spoken line** — `text` (required) and `casting`",
    "    (who says it, prose — not yet bound to `cast`) are yours to author.",
    "    `voiceId`, `voiceType`, `ttsProvider`, `model` and `delivery` are written",
    "    by a STUDIO EXPORT and reserved here — leave them out.",
    "16. **`music` is the production's ONE soundtrack** — `prompt` (required) plus",
    "    the Music catalog's own pickers: `vocals`, `vocalGender`, `genre`, `mood`,",
    "    `instruments`, `singingStyle`, `language`. Unlike `scenes[].voice`,",
    "    every one of these is yours to author — and every one is a CATALOG ID,",
    "    read in the Music section, exactly like the look ids elsewhere: an id",
    "    this studio does not carry is dropped with a warning. `duration` " +
      `(1–${registry.music.maxDuration}s) is STORED for display/restore only —` +
      " it is never sent to the generator.",
    "17. **`brief` is the production's own logline** — one root string, optional,",
    "    naming what the whole film is about. Refine the user's own brief here,",
    "    or leave it out when the plan needs none.",
    ...(opts.skill
      ? [
          "18. **`frame.subject` is WHO is in the shot** — the Structured Subject",
          "    builder's own picks, one catalog id (or a short list, up to that",
          `    dimension's cap) per dimension: ${subjectFieldExamples(registry)}`,
          "    and the rest. A studio EXPORT writes it and a hand-authored file",
          "    may too — read every dimension and its ids in",
          `    ${catalogHint} (the Subject block). It is NOT part of the`,
          "    generator's own schema: the vocabulary is too large for one request,",
          "    so an authoring model writes who is in the shot in `frame.prompt`",
          "    instead.",
        ]
      : []),
    "",
    "## Workflow",
    "",
    `1. Read the catalog (${catalogHint}) and pick the ids you need.`,
    "2. Write the JSON.",
    "3. Check it against `schema.json` if you have a validator.",
    "4. The user imports it at studio.nodaro.ai → **New Project ▸ Import JSON…**",
    "   (a new production). Inside an open production, scenes are appended by",
    "   Director's Review step (**Add scenes**) from a finished run, not from a",
    "   pasted file.",
    "",
    "## Worked example",
    "",
    exampleFence(),
    "",
    "## Common mistakes",
    "",
    "- Writing a label (`\"Golden Hour\"`) where an id belongs (`golden-hour`).",
    "- Inventing an id, a picker key or a model that is not in the catalog — it",
    "  is dropped with a warning and the scene loses that decision.",
    `- \`seconds\` off the ${registry.shots.step}s grid, or a scene's shots totalling more`,
    "  than its model's longest clip — the shots are clamped.",
    "- Forgetting the `@` on an entity the user already has, so it stays prose",
    "  instead of binding to their character.",
    "- Putting a film key (`styleId`, `eraId`) in `scenes[].look` when you meant",
    "  the whole film, or in `film` when you meant one scene.",
    "- Sending a `resolution` the chosen model does not offer — in `frame` it",
    `  falls back to the frame default (${registry.defaults.resolution}); in \`motion\` it falls back to`,
    "  Auto, which is what omitting `motion.resolution` already gives you.",
    "",
    ...analysisGuidance(registry, opts),
    "## Size",
    "",
    "Keep a production under ~20 scenes. A longer plan overruns the generator's",
    "output budget and comes back as a failure rather than a shorter film; write",
    "the film in parts and append the rest through Director (**Add scenes**).",
    "",
    `Defaults when you omit a model: \`${registry.defaults.imageModel}\` for stills,`,
    `\`${registry.defaults.videoModel}\` for motion, ${registry.defaults.aspectRatio}. \`frame.resolution\` defaults to`,
    `${registry.defaults.resolution}; \`motion.resolution\` has NO default — omit it and the model runs at Auto.`,
  ].join("\n")
}

export function renderSkill(
  registry: FormatRegistry,
  generatedFrom: GeneratedFrom,
): { readonly skillMd: string; readonly catalogMd: string } {
  const provenance = `@nodaro/prompts ${generatedFrom.prompts}, @nodaro/shared ${generatedFrom.shared}`
  const skillMd = [
    "---",
    "name: studio-production",
    `description: ${DESCRIPTION}`,
    `generated_from: "${provenance}"`,
    "---",
    "",
    body(registry, "`references/catalog.md`", { skill: true }),
    "",
  ].join("\n")
  const catalogMd = [
    `# ${FORMAT_ID} — catalog`,
    "",
    `Every id this format accepts, rendered from ${provenance}.`,
    "",
    renderLegend(registry, { terms: true, subject: true }),
  ].join("\n")
  return { skillMd, catalogMd }
}

/** The generator's system prompt: the same body, with the legend inlined. */
export function renderSystemPrompt(registry: FormatRegistry): string {
  return [body(registry, "the catalog below"), "", renderLegend(registry, { terms: true })].join(
    "\n",
  )
}
