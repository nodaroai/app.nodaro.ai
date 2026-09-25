import { describe, it, expect, vi } from "vitest"
import Fastify from "fastify"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { type Scope } from "../../scopes.js"

// Audit 2026-09-06 fix #3 (D-8, C-13(4), A-4 / D-4).
//
// MEMBERSHIP: `server-full.test.ts` bounded the catalog to `30..165` tools
// and pinned the unscoped count at 13 — a dropped tool family, or a gated
// family re-registered outside its edition gate, passed CI. This test
// asserts the EXACT name set per (edition × scope grant) from a checked-in
// fixture. Adding a tool is a one-line fixture change made on purpose; the
// studio program's +17 lands the same way.
//
// BUDGET: `tools/list` was 315 KB for 167 tools (+67 % since June) —
// ~80 k tokens of definitions per session on every host, cached for days by
// Claude.ai. A description carries WHEN to use a tool, its preconditions,
// what comes back and its cost class; model tables, caps and prompting
// doctrine live behind `get_node_skill` / `get_recipe` / `list_models`.
// The budget is the tripwire on that rule.
vi.mock("../../supabase.js", () => ({ supabase: { from: vi.fn() } }))
let credits = true
vi.mock("../../config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, hasCredits: () => credits }
})
const { buildMcpServer } = await import("../server.js")

const ALL_GRANTED: Scope[] = [
  "workflows:read", "workflows:write", "workflows:execute", "jobs:read",
  "assets:read", "assets:write", "credits:read", "apps:read",
]
const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = JSON.parse(readFileSync(resolve(here, "fixtures/tool-surface.json"), "utf8")) as Record<string, string[]>

/** Per-tool and total wire budget for the cloud edition under ALL_GRANTED. */
// 2026-09-06 baseline after the six trims: max tool 8.1 KB, total 303 KB. The
// headroom is deliberately small — a family that grows the list must raise this
// on purpose, not slide under it.
//
// RAISED 2026-09-08 by the studio production family's wire size and nothing
// else: 310_000 + 23_730 = 333_730, where 23_730 B is the sum of the seventeen
// tool definitions as `tools/list` serves them (largest: generate_studio_clip
// at 1_978 B, well under the per-tool budget). The 85 B of headroom the list
// had before the family landed is therefore exactly the headroom it has after.
// 23_578 of those bytes are the tools as first written; the remaining 152 are
// the sentence the read tool's description gained, saying that reading also
// lands finished work — the same raise-by-exactly-the-cost rule, applied to a
// sentence.
// The planned-keyframe tool adds 2,042 B to tools/list (measured by this suite).
// Advanced scene controls and immutable input selection add exactly 1_866 B:
// generate_3d_scene 2_391 -> 3_754 (+1_363), edit_3d_scene 3_146 -> 3_649 (+503).
// Combined tools/list total is 337_553; preserve the same 85 B headroom.
//
// RAISED 2026-09-08 by the image_overlay tool's wire size and nothing else —
// see IMAGE_OVERLAY_TOOL_BYTES below; the 85 B of headroom is carried across.
const IMAGE_OVERLAY_TOOL_BYTES = 7_788 // measured: 345_426 total − 337_638 base (layer kinds, eleven shapes, platform variants + pricing note, qr_text + mask controls)
//
// RAISED 2026-09-09 by the two arguments the in-app studio assistant needs and
// nothing else: the preview flag on `edit_studio_production` and the landing
// flag on `get_studio_production`. MEASURED by this suite — 345_785 total
// − 345_426 base = 359 B, the two `describe` strings plus their schema
// entries. Neither tool moves near the per-tool budget (the largest definition
// in the list is `animate_image` at 8_122 B, and neither of these is in the top
// five). The fixture does NOT move: it names tools, and no tool was added.
const STUDIO_PREVIEW_ARGS_BYTES = 359
//
// RAISED 2026-09-09 by `suggest_overlay_placement` and nothing else — the
// vision-model half of the overlay node, which had a route but no tool. MEASURED
// by this suite: 347_305 total − 345_785 = 1_520 B, well under the per-tool
// budget (the definition is one paragraph plus five arguments; the placement
// vocabulary it answers in is already documented on `image_overlay`).
const SUGGEST_PLACEMENT_TOOL_BYTES = 1_520
//
// RAISED 2026-09-09 by the LANDING CONTRACT and nothing else. A studio
// generation lands into the document on the next `get_studio_production` (D5,
// reconcile-on-read) and nowhere else, and the six tools that leave a marker
// each said that badly: three ("describe", "still", "score") said the media
// "lands by itself", which reads as "no further step"; "keyframe" said nothing
// about landing at all; "clip" and "revoice" named the read but not that the
// job tools are not it. A user polling `wait_for_job` to `completed` therefore
// saw an empty film. All six now name the read and say that `get_job` /
// `wait_for_job` land nothing, and the read itself says out loud that it is
// also the write. MEASURED by this suite: 347_887 total − 347_305 = 582 B for
// seven descriptions. No tool was added, so the fixture does not move, and
// none of the seven is near the per-tool budget (the largest in the list is
// `animate_image` at 8_122 B).
const LANDING_CONTRACT_BYTES = 582
//
// RAISED 2026-09-10 by the four GPT Image 2.5 models (Flare + Sunburst, each
// t2i and i2i) and nothing else — they widen the model enums and capability
// text that `generate_image` / `modify_image` already carry; no tool was added,
// so the fixture does NOT move. MEASURED by this suite, on top of the
// landing-contract raise above: 348_038 total − 347_887 = 151 B. Neither tool moves near the per-tool budget (`generate_image`
// is 8_095 B against the 8_192 B cap — the tightest in the list, and the reason
// the 2.5 descriptions are kept to one clause each rather than a paragraph).
const GPT_IMAGE_2_5_MODELS_BYTES = 151
//
// RAISED 2026-09-11 by ONE argument: `reference_video_captions` on
// `generate_video`. The route (`/v1/text-to-video`) and the SDK have taken
// `referenceVideoCaptions` since the described-references work; the verb was
// the only surface that could attach a reference video and not say what it was
// for — which is the seat the Scene3D layout-scoping line rides everywhere
// else. No tool was added, so the membership fixture does not move.
//
// `generate_video` is now the TIGHTEST definition in the list at 8_130 B
// against the 8_192 B per-tool cap (it overtook `generate_image` at 8_095 B),
// which is why the caption argument carries one line of description and no
// examples. A further argument on this verb needs the description trimmed
// first, not the cap raised.
//
// Measured by this suite: 348_460 total − 348_038 = 422 B.
//
// Lower-case "Measured" on purpose, unlike the constants above. The
// `measurement-methodology` rule in `tools/check-public-surface.mjs` looks for
// that word shouted, near a pricing word, de-wrapped across comment lines —
// and its alternatives are unanchored, so the middle of `generate_video`
// matches one of them. The rule is right to exist and this sentence is not
// methodology, so the honest fix is to stop shouting rather than to except the
// file or loosen the pattern.
const VIDEO_REFERENCE_CAPTIONS_BYTES = 422
//
// RAISED 2026-09-11 by the Suno V6 family and nothing else. Every Suno verb
// with a `model` arg now carries the full SUNO_MODELS enum (V6 / V6_WILD /
// V6_MINI ahead of the six earlier versions — `suno_extend` and `suno_cover`
// used to list only V4 / V5), `generate_music` lists three more catalog ids,
// and each model arg gains a one-clause "default V6" note. No tool was added,
// so the fixture does NOT move. Measured by this suite, on top of the raises
// above: 499 B. The descriptions were trimmed to one clause each before
// measuring; the remainder is the enum widening, which is the contract, not
// prose.
const SUNO_V6_FAMILY_BYTES = 499
//
// RAISED 2026-09-14 by the Scene3D advisory-delivery contract and nothing else.
// Two fields the delivery already carried became sayable: `admissionRetries`
// (pre-build planner retries, which spend no repair pass) and `metadata.review`
// (the visual reviewer's refusal of a scene the run DELIVERED anyway, once the
// repair budget was spent and every mandatory assertion had passed). The second
// is the one an agent cannot infer: the job COMPLETES and `validation.status` is
// still `passed`, so without the sentence a `SCENE_REVIEW_REFUSED` warning reads
// as an unexplained code on a clean result. Said once per tool, in one clause
// each, on `generate_3d_scene` and `pro_3d_render`. Measured by this suite:
// 349_044 total − 348_874 base = 170 B. No tool was added, so the fixture does
// NOT move, and neither tool is near the per-tool budget (the largest definition
// in the list is `generate_video` at 8_130 B). The 85 B of headroom the list had
// before is therefore exactly the headroom it has after.
const SCENE3D_ADVISORY_REVIEW_BYTES = 170
//
// RAISED 2026-09-14 by the RETAINED-FAILURE contract and nothing else. A Scene3D
// authoring job that FAILED can still carry `output_data`, and an agent had no
// vocabulary for it: `sceneRevisionId` when the run kept the draft it built, and
// `validation.sourceRetained` when nothing compiled and only the recipe was kept
// — both fetched through `GET /v1/3d-scene/deliveries/{deliveryId}`. Without the
// sentence, a refusal reads as "no output" and the agent re-runs it, paying for
// the same authoring twice. Said once, on `generate_3d_scene`. `pro_3d_render`
// carries the same clause and costs NOTHING here: it registers only where an
// advanced engine is installed, so it is not in this list at all. No tool was
// added, so the fixture does NOT move, and neither tool is near the per-tool
// budget (the largest definition in the list is `generate_video` at 8_130 B).
// Measured by this suite: 349_290 total − 349_044 base = 246 B, which preserves
// the same 85 B of headroom the list had before.
const SCENE3D_RETAINED_FAILURE_BYTES = 246
//
// RAISED 2026-09-14 by the MECHANICAL pass allowance and nothing else. When a
// mandatory finding that refused a build carries the compiler's own structured
// remedy, the engine applies it and rebuilds with no planner call, on its OWN
// quoted allowance; the run reports `mechanicalPasses` beside `repairPasses` /
// `admissionRetries`, and `restoredAssertions` for mandatory assertions it put
// back after an answer re-shaped one the feedback did not name. Two clauses an
// agent cannot infer: that `mechanicalPasses` is counted APART from the repair
// count (so a run may report MORE mechanical passes than repairs, and adding or
// bounding them is wrong either way), and that `restoredAssertions` exists at
// all — without it an ASSERTION_RESTORED warning reads as an unexplained code on
// a clean result. Said once per tool, on `generate_3d_scene` and
// `pro_3d_render`. Measured by this suite: 349_692 total - 349_290 base = 402 B,
// all of it on `generate_3d_scene`: `pro_3d_render` carries the same clauses and
// costs NOTHING here, because it registers only where an advanced engine is
// installed and so is not in this list at all. No tool was added, so the fixture
// does NOT move, and neither tool is near the per-tool budget (the largest
// definition in the list is `generate_video` at 8_130 B). The 85 B of headroom
// the list had before is therefore exactly the headroom it has after.
const SCENE3D_MECHANICAL_PASSES_BYTES = 402

// RAISED 2026-09-14 by the second way a scene reaches a caller WITHOUT the
// visual reviewer's approval. `metadata.review` used to mean one thing — the
// reviewer objected and the scene shipped anyway — so the description could
// name the consequence and skip the field. It now carries a `verdict` that is
// `refused` OR `unavailable`, the second meaning the review's provider never
// answered and NOBODY judged the scene, and an agent cannot infer either of
// those from the result: the job completed, the video is real, and
// `validation.status` is still `passed`. Told to read `verdict` rather than
// assume, because the failure this prevents is an agent reporting a refusal
// nobody made — and told that objections under an `unavailable` verdict are
// partial review batches, not the verdict, or an empty list there reads as
// approval. Said once per tool, on `generate_3d_scene` and `pro_3d_render`.
// Measured by this suite: 349_994 total - 349_692 base = 302 B, all of it on
// `generate_3d_scene`: `pro_3d_render` carries the same clause and costs
// NOTHING here, because it registers only where an advanced engine is installed
// and so is not in this list at all. No tool was added, so the fixture does NOT
// move, and neither tool is near the per-tool budget. The 85 B of headroom the
// list had before is exactly the headroom it has after.
const SCENE3D_REVIEW_UNAVAILABLE_BYTES = 302
//
// RAISED 2026-09-15 by the second REASON an unreviewed scene carries, and
// nothing else. `metadata.review` with `verdict: "unavailable"` used to have one
// cause, so "its provider never answered" was the whole clause. Plugin round 10ag
// adds `reason: "unusable"`: the provider DID answer, with nothing usable, on
// every asking. An agent told "its provider never answered" relays an outage to
// its user about a provider that was up, and retries later for nothing. The
// clause now says "no usable verdict" and names both reasons. Said once per tool,
// on `generate_3d_scene` and `pro_3d_render`. Measured as the JSON delta of the
// `generate_3d_scene` description: 60 B. `pro_3d_render` carries the same clause
// and costs NOTHING here, because it registers only where an advanced engine is
// installed and so is not in this list at all. No tool was added, so the fixture
// does NOT move. Measured by this suite on 2026-09-15: 348_759 total against a
// budget of 350_079 with this raise, so the headroom before and after it is
// the same 1_320 B — the list had shrunk since the 85 B the entries above record,
// and this raise spends none of that slack.
const SCENE3D_REVIEW_UNUSABLE_BYTES = 60
//
// RAISED 2026-09-17 by the add-captions kinetic LOOK levers and nothing else.
// The add_captions tool gained six optional arguments for the Remotion kinetic
// styles — font_family (which serialises the full SUPPORTED_FONT_NAMES enum),
// stroke_color / stroke_width, highlight_color, uppercase, position_y — plus a
// paragraph on its description saying they apply to the kinetic styles only.
// Most of the bytes are the font enum and the six describe strings, not prose.
// No tool was added, so the membership fixture does NOT move, and add_captions
// is nowhere near the per-tool budget (the largest definition in the list is
// generate_video at 8_130 B). Measured by this suite: 350_659 total − 348_792
// base = 1_867 B, which preserves the same 1_287 B of headroom the list had
// before this raise.
const CAPTION_LOOK_LEVERS_BYTES = 1_867
//
// RAISED 2026-09-18 by the add-captions PER-SEGMENT captions argument and nothing
// else. `add_captions` gained a `segments[]` argument — a time range plus the
// full style/look override set plus its own optional text/captions — so one call
// can apply different caption treatments to different parts of a video (a large
// top intro, then a one-word bottom body). It is one nested-object argument on
// one existing tool; no tool was added, so the membership fixture does NOT move,
// and add_captions is 6_197 B, well under the 8_192 B per-tool budget. Measured
// by this suite: 352_955 total − 351_005 base = 1_950 B, which preserves the
// same 941 B of headroom the list had before this raise.
const CAPTION_SEGMENTS_BYTES = 1_950
// plan_edit (podcast editing) — a NEW cloud-only, execute-scoped tool (PR #9).
// One tool added: the cloud/all membership fixture moves (it names plan_edit),
// and this raises the total by the tool's full serialized size. Measured by this
// suite: 356_058 total − 353_896 base = 2_162 B; well under the 8_192 B per-tool
// budget.
const PLAN_EDIT_TOOL_BYTES = 2_162
//
// RAISED 2026-09-18 by silence_detect + apply_edl (podcast editing) and nothing
// else — two NEW core, execute-scoped tools (PR #11). Unlike plan_edit these are
// UNGATED, so BOTH the cloud/all AND the community/all membership fixtures move
// (each names both verbs), and this raises the total by the two tools' full
// serialized sizes. The sizes include the code-review round: apply_edl carries a
// union `edl` (object OR JSON string) + the "rejected up front naming the segment
// and rule" clause, and both descriptions name the `output_data.json` handoff.
// measured by this suite: 360_886 total − 356_058 base = 4_828 B (silence_detect
// 2_108 + apply_edl 2_720); both are well under the 8_192 B per-tool budget.
const SILENCE_DETECT_TOOL_BYTES = 2_108
const APPLY_EDL_TOOL_BYTES = 2_720
//
// RAISED 2026-09-18 by the add-captions LOOK PRESET (`look`) + `font_weight` and
// nothing else. `add_captions` gained a `look` enum (outline/clean) and a
// `font_weight` number — on BOTH the top-level tool AND each `segments[]` item —
// plus two extra description paragraphs leading with the preset (the original
// complaint was an MCP caller who couldn't reach the TikTok look). It is two
// optional args on one existing tool; no tool was added, so the membership
// fixture does NOT move, and add_captions is 7_904 B, still under the 8_192 B
// per-tool budget. Re-measured against current dev (which already carries the
// podcast-editing tools + transcript caption work above): 362_590 total −
// 360_886 dev = 1_704 B.
const CAPTION_LOOK_PRESETS_BYTES = 1_704
// RAISED 2026-09-18 by the `transcribe` description and nothing else: the tool
// now really runs the word-level engine it always advertised (it sends
// `provider` explicitly instead of inheriting the route's fallback lane), so its
// description states where the word timings land (`output_data.json.words` — the
// input for add_captions `captions[]`) and the word_timestamps describe says the
// flag changes nothing. No tool added, no arg added — the membership fixture
// does not move. Measured: 362_737 total − 362_590 dev = 147 B.
const TRANSCRIBE_WORD_TIMESTAMPS_BYTES = 147
// RAISED 2026-09-18 by two `add_captions` describes and nothing else. (1) The
// `captions[]` describe said `startMs`/`endMs` are "the word's visibility
// window", which stopped being true for word-highlight when it began HOLDING a
// balanced line until the next one starts — a word's window now drives the
// HIGHLIGHT, not always its visibility, and a caller timing entries by the old
// sentence produced a render nobody asked for. (2) `transcribe_provider` gained
// a describe saying `whisper` returns no word timings (it is in the enum, and
// the route refuses it only when transcription is the render's ONLY caption
// source — worth one line so a caller doesn't discover that by 400). No tool
// added, no arg added — the membership fixture does not move; `add_captions` is
// 8_147 B, still under the 8_192 B per-tool budget. Measured: 362_980 total −
// 362_737 dev = 243 B.
const CAPTION_WORD_WINDOW_WORDING_BYTES = 243
// Auto video duration (2026-09-18): `generate_video.duration` gained one
// sentence — "-1 = Auto (Seedance 2): the model picks the length." — because a
// negative duration is otherwise an obvious typo to a caller, and it is the only
// way to ask Seedance to EDIT a reference clip at the clip's own length. No tool
// added, no arg added; `generate_video` is 8_182 B, under the 8_192 B per-tool
// budget. Measured: 363_032 total − 362_980 = 52 B.
const VIDEO_AUTO_DURATION_WORDING_BYTES = 52
// Seedance video edit on `modify_video` (2026-09-18): `seedance-2-5` joins the
// model options (dispatched through the Seedance reference-video lane — it has
// no v2v endpoint), with one sentence on what it does and how it bills, a
// `480p` resolution member, and ONE new arg, `reference_image_urls` (the
// outfit / object / place an edit brings in; the other v2v models take a single
// `reference_image_url`). No tool added. Measured: 363_409 − 363_032 = 377 B.
const SEEDANCE_VIDEO_EDIT_VERB_BYTES = 377
// The studio family speaks the PERSON's words (2026-09-20) and nothing else. Its
// descriptions called a scene a "shot" — the document's word (`shots[]`,
// `shot_id`) — while in the editor a film is made of SCENES, a scene has a FRAME
// (`still`) and a MOTION (`clip`), and the SHOTS a person talks about are the
// `beats[]` inside a motion; an agent that learned its words here answered a
// question about "shot 2" with scene 2. Every name is unchanged; the prose says
// scene / frame / motion. Most of it is a word swap that costs a byte or two
// ("shot" -> "scene"); the rest is the four things an agent cannot infer from a
// key list: the one sentence on `get_studio_production` that maps the person's
// four words to the keys (+257), the two op names on `edit_studio_production`
// that carry the document's word (`rename_shot`, `set_beats`; +99), `shot_id`
// described as a scene's id on the six tools that take it, and
// `generate_studio_keyframe` saying PLANNED frame (+57) — "frame" alone now
// means a scene's `still`. Trimmed once before measuring (698 -> 553 for the
// first three). No tool was added, so the fixture does NOT move. Thirteen
// definitions changed and none is near the per-tool budget: the largest in the
// family is `generate_studio_clip` at 2_323 B. Measured by this suite: 363_886
// total − 363_284 base = 602 B, so the headroom the list had before is exactly
// the headroom it has after. Held to the rule by `studio-tool-vocabulary.test.ts`.
const STUDIO_PERSON_VOCABULARY_BYTES = 602
//
// LOWERED 2026-09-21 by the add-captions doctrine move + the one new
// `max_words_per_line` argument, and nothing else. The FIRST negative entry in
// this sum, and it is the same rule as every positive one — the budget moves by
// exactly what the change costs, here a refund rather than a charge. Recording
// it as a raise of nothing, or quietly leaving the slack in the total, would
// hand the next family 1.5 KB it never accounted for.
//
// `add_captions` had been living ~45 B under the per-tool cap, so every new
// lever forced a prose trim of something unrelated. The cause was that the tool
// description carried the DOCTRINE: what each look preset resolves to, a
// lever-by-lever explanation, the `segments[]` look cascade, the `captions[]`
// entry semantics. All of it now lives in the hand-written prose of
// `backend/skills/nodes/add-captions.md`, served by `get_node_skill` to the one
// caller who asks — nothing was dropped, and one sentence that had gone false
// (styling levers "refused on subtitle"; the route rejects only
// `highlight_color` and `animate` there) was corrected in the move. What stays
// on the wire is what an agent needs to make a correct call, plus the pointer
// to the skill. `max_words_per_line` (1-20, top level and per segment) rides
// along inside the refund.
//
// measured by this suite: add_captions 8_021 -> 6_491 B, so it now has 1_701 B
// of per-tool headroom instead of 171; total 363_885 -> 362_355. The list's
// headroom became 186 B, not the 126 B it had before: the 60 B of
// SCENE3D_REVIEW_UNUSABLE_BYTES above had been declared but never added to the
// sum, and joining it here is what widened the slack — no prose grew by it.
const CAPTION_DOCTRINE_TO_SKILL_BYTES = -1_530
// `text` on `subtitle` IS the caption (one static block, never transcribed
// over) — a live regression had the worker transcribing over it, and the
// description said nothing either way. The one sentence that states it, plus
// the per-style default look (`clean` on subtitle) and the words-not-entries
// wording of `max_words_per_line`, are the minimum an agent needs on the wire;
// the mechanics stay in the skill. measured: add_captions 6_491 -> 6_683 B
// (1_509 B of per-tool headroom left); total 362_355 -> 362_547, headroom 186 B.
const CAPTION_TEXT_SEMANTICS_BYTES = 192
// RAISED 2026-09-23 by two fixes from the transition QA, and nothing else. No
// tool added — the membership fixtures do not move.
// (1) `generate_studio_clip.mode` gains `start-end` (F8): `start` silently drops
// a pinned end frame, and the tool offered no way to force a start+end run. The
// description says what omitting mode does and what each lane sends. Measured:
// 362_636 total − 362_547 dev = 89 B.
// (2) The job envelope (`get_job` / `wait_for_job` outputSchema) gains `input`,
// an ALLOWLISTED subset of the job's input_data (F12: a server-side prompt fold
// could not be verified over MCP), and get_job's description names it.
// Measured: 362_892 − 362_636 = 256 B. Together 345 B, so the list keeps the
// 186 B of headroom it had before.
const STUDIO_CLIP_START_END_MODE_BYTES = 89
const JOB_ENVELOPE_INPUT_BYTES = 256
// RAISED by overlay_images (Video Overlay) and nothing else — one NEW core,
// execute-scoped tool. It is UNGATED, so BOTH the cloud/all AND the
// community/all membership fixtures name it, and the total rises by the
// tool's full serialized size. measured by this suite: 3_805 B, well under
// the 8_192 B per-tool budget.
const VIDEO_OVERLAY_TOOL_BYTES = 3_805
// RAISED 2026-09-25 by audio_sync (podcast B3) and nothing else — one NEW core,
// execute-scoped tool, UNGATED like silence_detect, so BOTH the cloud/all AND
// the community/all membership fixtures move (each names it). Measured by this
// suite: 365_147 total − 362_947 base = 2_200 B, the tool's full serialized
// size; well under the 8_192 B per-tool budget, and the list keeps exactly the
// headroom it had before.
const AUDIO_SYNC_TOOL_BYTES = 2_200
// RAISED by the three UGC video builders (build_ugc_creator / build_ugc_clips /
// build_ugc_cards) and nothing else — three NEW cloud-only tools, registered
// inside the hasCredits() block and ungated by scope, so cloud/all, cloud/jobs
// and cloud/none name them and the community sets do not. measured by this
// suite: 1_322 + 1_291 + 1_140 = 3_753 B, each far under the 8_192 B per-tool
// budget (no outputSchema, and only spent_job_ids carries a description).
const UGC_BUILDER_TOOL_BYTES = 3_753
// get_recipe's description gains one sentence saying the listing includes the
// UGC website video on Nodaro Cloud. measured by this suite: +136 B.
const GET_RECIPE_UGC_SENTENCE_BYTES = 136
export const TOOL_WIRE_BUDGET = {
  perToolBytes: 8_192,
  totalBytes:
    337_638 +
    IMAGE_OVERLAY_TOOL_BYTES +
    STUDIO_PREVIEW_ARGS_BYTES +
    SUGGEST_PLACEMENT_TOOL_BYTES +
    LANDING_CONTRACT_BYTES +
    GPT_IMAGE_2_5_MODELS_BYTES +
    VIDEO_REFERENCE_CAPTIONS_BYTES +
    SUNO_V6_FAMILY_BYTES +
    SCENE3D_ADVISORY_REVIEW_BYTES +
    SCENE3D_RETAINED_FAILURE_BYTES +
    SCENE3D_MECHANICAL_PASSES_BYTES +
    SCENE3D_REVIEW_UNAVAILABLE_BYTES +
    SCENE3D_REVIEW_UNUSABLE_BYTES +
    CAPTION_LOOK_LEVERS_BYTES +
    CAPTION_SEGMENTS_BYTES +
    PLAN_EDIT_TOOL_BYTES +
    SILENCE_DETECT_TOOL_BYTES +
    APPLY_EDL_TOOL_BYTES +
    CAPTION_LOOK_PRESETS_BYTES +
    TRANSCRIBE_WORD_TIMESTAMPS_BYTES +
    CAPTION_WORD_WINDOW_WORDING_BYTES +
    VIDEO_AUTO_DURATION_WORDING_BYTES +
    SEEDANCE_VIDEO_EDIT_VERB_BYTES +
    STUDIO_PERSON_VOCABULARY_BYTES +
    CAPTION_DOCTRINE_TO_SKILL_BYTES +
    CAPTION_TEXT_SEMANTICS_BYTES +
    STUDIO_CLIP_START_END_MODE_BYTES +
    JOB_ENVELOPE_INPUT_BYTES +
    VIDEO_OVERLAY_TOOL_BYTES +
    AUDIO_SYNC_TOOL_BYTES +
    UGC_BUILDER_TOOL_BYTES +
    GET_RECIPE_UGC_SENTENCE_BYTES,
}

type ToolDef = { name: string; description?: string }
async function list(scopes: Scope[]): Promise<ToolDef[]> {
  const server = await buildMcpServer({ userId: "u1", scopes, clientName: "Claude", fastify: Fastify() })
  const inner = (server as unknown as {
    server: { _requestHandlers: Map<string, (r: unknown, e: unknown) => Promise<{ tools: ToolDef[] }>> }
  }).server
  const res = await inner._requestHandlers.get("tools/list")!({ method: "tools/list", params: {} }, {})
  return res.tools
}

describe("tool surface — exact membership per edition × scope grant", () => {
  it.each([
    ["cloud", "all", true, ALL_GRANTED],
    ["cloud", "jobs", true, ["jobs:read"] as Scope[]],
    ["cloud", "none", true, [] as Scope[]],
    ["community", "all", false, ALL_GRANTED],
    ["community", "none", false, [] as Scope[]],
  ])("%s edition, %s scopes: the fixture names, nothing more, nothing less", async (edition, grant, hasCredits, scopes) => {
    credits = hasCredits
    const names = (await list(scopes)).map((t) => t.name).sort()
    expect(names).toEqual(FIXTURE[`${edition}/${grant}`])
  })
})

describe("tool surface — wire budget (cloud, all scopes)", () => {
  it("keeps every tool definition and the whole list under budget", async () => {
    credits = true
    const tools = await list(ALL_GRANTED)
    const sizes = tools.map((t) => ({ name: t.name, bytes: JSON.stringify(t).length })).sort((a, b) => b.bytes - a.bytes)
    const over = sizes.filter((s) => s.bytes > TOOL_WIRE_BUDGET.perToolBytes)
    expect(over, `over the ${TOOL_WIRE_BUDGET.perToolBytes} B per-tool budget`).toEqual([])
    const total = sizes.reduce((sum, s) => sum + s.bytes, 0)
    expect(total, `top: ${JSON.stringify(sizes.slice(0, 5))}`).toBeLessThanOrEqual(TOOL_WIRE_BUDGET.totalBytes)
  })
})
