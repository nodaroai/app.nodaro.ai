/**
 * THE GOLDEN OP SCRIPT — one batch that touches every operation of every
 * section (spec §6, `ops/SECTIONS.md`).
 *
 * It is generated beside the document rather than written by hand for one
 * reason: every id it addresses has to be an id the document really carries —
 * the two live shot ids, the bin's two entry ids, the result keys of the
 * histories, and the cast keys that `enrollCastMember` actually minted. A
 * script authored separately drifts the moment either side changes, and the
 * failure would surface as `op_target_missing` inside somebody else's test.
 *
 * The integrator applies it to the golden production and commits the result as
 * `golden-after-ops.json`; from then on both repos assert that a batch of these
 * operations produces the same bytes. Which is why ORDERING is part of the
 * fixture, not an accident of authoring — see {@link buildGoldenOps}.
 */
import { buildStill } from "../shot"
import { castSlug } from "../cast"
import { serializeProduction, type SerializedProduction } from "../shot-graph"

import { KIRA, KIRA_KEY, VALLEY_KEY } from "./golden-document"

/** The renamed role's key — `rename_cast_member` moves the row to a new slug. */
const LANTERN_KEY = castSlug("object", "Lantern")
const STORM_LANTERN_KEY = castSlug("object", "Storm lantern")

/** A one-shot graph for `insert_shots` — the same shape a paste carries. */
function pastedGraph(): SerializedProduction {
  return serializeProduction(
    [
      {
        id: "shot-pasted",
        name: "Pasted crossing",
        still: buildStill(
          {
            nodeId: "generate-image-shot-pasted",
            provider: "flux-2-max",
            prompt: "the road out of the valley",
          },
          [
            {
              url: "https://r2.example/still-pasted.png",
              jobId: "job-still-pasted",
              prompt: "the road out of the valley",
              provider: "flux-2-max",
            },
          ],
          0,
        ),
      },
    ],
    "shot-pasted",
  )
}

/**
 * A batch that touches every operation of every section — the script whose
 * result the integrator commits as `golden-after-ops.json` and both repos then
 * assert byte-equal.
 *
 * Ordering is part of the fixture. Three rules it keeps:
 *  - it addresses only ids the DOCUMENT has or an EARLIER op in this batch
 *    minted by name (`add_folder { id }`, `duplicate_shot { newId }`); nothing
 *    addresses a shot `insert_shots` pasted, whose ids `ctx.mintId` re-mints;
 *  - a delete comes after the reads of what it deletes, and `clear_trash` comes
 *    after the two bin entries the fixture ships are restored and purged;
 *  - `set_archived` ends on `false`, so the document the batch produces is
 *    still the visible, unarchived production the fixture describes.
 *
 * `land_job` and the pending-STILL markers are P1.2 and deliberately absent.
 */
export function buildGoldenOps(): ReadonlyArray<Record<string, unknown>> {
  return [
    // 1 · production
    { op: "set_name", name: "The Rooftop Cut" },
    { op: "set_thumbnail", url: "https://r2.example/thumb/rooftop.png" },
    { op: "set_archived", archived: true },
    { op: "select_shot", shotId: "shot-2" },
    { op: "set_film", film: { style: "neo-noir", era: "1970s" } },
    {
      op: "set_music",
      music: {
        url: "https://r2.example/music/storm.mp3",
        prompt: "Low strings under a rising storm.",
        duration: 30,
        provider: "suno-v5",
      },
    },
    { op: "clear_music" },
    {
      op: "set_music_plan",
      plan: {
        prompt: "Low strings, then nothing at all.",
        duration: 24,
        selections: {
          vocals: "instrumental",
          vocalGender: "any",
          instruments: ["strings"],
          genre: "ambient",
          mood: "bleak",
        },
      },
    },
    {
      op: "set_storyboard",
      patch: { brief: "A courier outruns a storm she cannot beat.", filmLength: 60 },
    },

    // 2 · folders
    { op: "add_folder", id: "folder-act-2", name: "Act II" },
    { op: "rename_folder", id: "folder-act-2", name: "Act Two" },
    { op: "move_shot_to_folder", shotId: "shot-2", folderId: "folder-act-2" },
    { op: "move_shot_to_folder", shotId: "shot-2", folderId: null },
    { op: "remove_folder", id: "folder-act-2" },

    // 3 · shots
    { op: "add_shot", id: "shot-4", afterShotId: "shot-3", name: "Coda" },
    { op: "rename_shot", id: "shot-4", name: "Coda, reprise" },
    { op: "duplicate_shot", id: "shot-1", newId: "shot-1-copy" },
    { op: "move_shot", id: "shot-1-copy", toIndex: 0 },
    { op: "remove_shot", id: "shot-1-copy" },
    { op: "insert_shots", graph: pastedGraph(), afterShotId: "shot-2" },
    {
      op: "set_plan",
      shotId: "shot-3",
      frame: { prompt: "the ridge line at dusk, wolf on the crest", provider: "flux-2-max" },
      motion: null,
    },

    // 4 · beats
    { op: "set_scene_prompt", shotId: "shot-2", text: "The crossing, in one move." },
    {
      op: "set_beats",
      shotId: "shot-2",
      beats: [
        { id: "beat-2a", seconds: 3, text: "She steps off the shoulder of the road." },
        {
          id: "beat-2b",
          seconds: 3,
          text: "The valley opens.",
          directions: [{ kind: "ambience", text: "wind in dry grass" }],
        },
      ],
    },
    { op: "set_end_transition", shotId: "shot-2", transition: { id: "cross-dissolve" } },
    { op: "set_end_transition", shotId: "shot-1", transition: null },

    // 5 · looks
    { op: "set_look", shotId: "shot-2", look: { timeOfDay: "dusk" } },
    {
      op: "set_cast_look",
      shotId: "shot-2",
      key: KIRA_KEY,
      look: {
        url: "https://r2.example/cast/kira-side.png",
        variantSlug: "angles:side",
        label: "side",
      },
    },
    { op: "set_cast_look", shotId: "shot-1", key: KIRA_KEY, look: null },
    {
      op: "set_cast_look_map",
      shotId: "shot-2",
      map: {
        [KIRA_KEY]: {
          url: "https://r2.example/cast/kira-front.png",
          variantSlug: "angles:front",
          label: "front",
        },
      },
    },

    // 6 · stills
    {
      op: "add_still_result",
      shotId: "shot-1",
      atFront: true,
      result: {
        url: "https://r2.example/still-1e.png",
        jobId: "job-still-1e",
        prompt: `@${KIRA_KEY} on the rooftop, tighter`,
        provider: "flux-2-max",
        aspectRatio: "16:9",
        resolution: "2k",
        promptFormat: 2,
        look: { timeOfDay: "blue-hour" },
      },
    },
    { op: "set_active_still", shotId: "shot-1", result: "job-still-1b" },
    { op: "rename_still_result", shotId: "shot-1", result: "job-still-1c", name: "Empty roof" },
    { op: "remove_still_result", shotId: "shot-1", result: "job-still-1c" },

    // 7 · clips
    {
      op: "add_clip_result",
      shotId: "shot-2",
      result: {
        url: "https://r2.example/clip-2b.mp4",
        jobId: "job-clip-2b",
        prompt: `${KIRA} crosses @${VALLEY_KEY}, longer`,
        provider: "seedance-2",
        duration: 8,
        referenceImageUrls: ["https://r2.example/ref/valley.png"],
      },
    },
    { op: "set_active_clip", shotId: "shot-1", result: "job-clip-1b" },
    { op: "rename_clip_result", shotId: "shot-1", result: "job-clip-1a", name: "Take 1, slow" },
    { op: "remove_clip_result", shotId: "shot-1", result: "job-clip-1a" },

    // 8 · frames
    { op: "set_start_frame", shotId: "shot-2", url: "https://r2.example/still-1a.png" },
    { op: "set_end_frame", shotId: "shot-2", url: null },
    {
      op: "set_directing_references",
      shotId: "shot-1",
      kind: "images",
      urls: ["https://r2.example/ref/rooftop.png"],
    },
    {
      op: "add_pending_clip",
      shotId: "shot-2",
      pending: {
        jobId: "job-clip-pending-2",
        provider: "seedance-2",
        prompt: `${KIRA} crosses @${VALLEY_KEY}, longer`,
        startedAt: 1_757_116_860_000,
        duration: 8,
      },
    },
    { op: "remove_pending_clip", shotId: "shot-1", jobId: "job-clip-pending-1" },

    // 9 · voice
    {
      op: "set_voice",
      shotId: "shot-2",
      voice: {
        url: "https://r2.example/voice/shot-2.mp3",
        text: "Nothing followed her out of the valley.",
        voiceId: "voice-narrator",
        voiceType: "premade",
        ttsProvider: "elevenlabs-multilingual",
        model: "eleven_multilingual_v2",
        delivery: { stability: 0.7 },
      },
    },
    { op: "clear_voice", shotId: "shot-1" },

    // 10 · cast
    {
      op: "enroll_cast",
      member: { kind: "object", assetId: "obj-lantern", displayName: "Lantern" },
    },
    { op: "set_cast_role", key: LANTERN_KEY, role: "prop" },
    {
      op: "recast_cast_member",
      key: LANTERN_KEY,
      actor: { kind: "object", assetId: "obj-storm-lamp" },
    },
    { op: "rename_cast_member", key: LANTERN_KEY, displayName: "Storm lantern" },
    { op: "remove_cast_member", key: STORM_LANTERN_KEY },
    { op: "mint_cast_from_chips" },

    // 11 · trash
    { op: "restore_trashed", trashId: "trash-still-1" },
    { op: "purge_trashed", trashId: "trash-clip-1" },
    { op: "clear_trash" },

    // 12 · cuts
    {
      op: "add_cut",
      cut: {
        id: "cut-b",
        name: "Cut B",
        url: "https://r2.example/cuts/cut-b.mp4",
        exportedAt: "2026-09-06T18:00:00.000Z",
        duration: 39,
        shotsCount: 4,
      },
    },
    { op: "rename_cut", id: "cut-b", name: "Cut B, tight" },
    { op: "duplicate_cut", id: "cut-b", newId: "cut-c" },
    { op: "mark_cut_final", id: "cut-c" },
    { op: "delete_cut", id: "cut-b" },

    // …and back to a visible production, so the batch's result is one too.
    { op: "set_archived", archived: false },
  ]
}
