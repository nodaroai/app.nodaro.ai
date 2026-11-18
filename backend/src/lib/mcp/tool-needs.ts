import { USE_CASE_NODE_TYPES, usecaseContinuePath, usecaseDescriptor } from "@nodaro/render-rules"
import type { WorldId } from "@nodaro/shared/runtime-config"
import { FILM_PIPELINE_FEATURE } from "../availability-override.js"
import { PODCAST_PACK_TOOLS } from "../use-case/pack-price.js"

/**
 * What every MCP tool needs from what a deployment offers (decided
 * 2026-11-11): ONE table, keyed by tool name, read by the offer funnel
 * (`tool-offer.ts`) to list a tool only where everything it needs is offered
 * to the viewer, and to refuse a call to one that is not.
 *
 * A need is DERIVED wherever the code allows it: a tool that runs a node
 * names the ROUTE it calls, and the node comes from that route through
 * `lib/route-node-gate.ts` — the very resolution the credit guard refuses a
 * run by. Only a need no route of the tool's own can name is written as a
 * node, and it says why. `__tests__/tool-needs-census.test.ts` holds the table
 * to the code: every tool the server registers has exactly one entry, every
 * route resolves to a node, each route a tool's code calls is declared and
 * each declared route is one its code calls.
 *
 * The rules the entries follow:
 *  1. A tool that runs a node through a route needs that node (`routes`). A
 *     tool with several lanes (with or without a start frame, by provider) is
 *     offered while ANY lane is; the steps one call runs in sequence must ALL
 *     be (`steps`).
 *  2. A tool that prepares, quotes, plans or continues a run of a node needs
 *     that node, though its own route runs none (`nodes`, with `why`).
 *  3. A product the deployment offers only as a world, with no node of its
 *     own (Studio), is needed by the tools that make or change its work
 *     (`world`).
 *  4. Needs nothing a deployment can withhold (`none`, with why): a read of
 *     the caller's own data, acting on work already made (following,
 *     stopping or removing it stays possible however the offer changes), a
 *     document or catalog (what it describes is judged where it runs), an
 *     upload, a session, the balance, a saved graph run (each node is judged
 *     when it runs).
 *  A tool whose every call imports a link to outside content needs link
 *  imports; one that only makes sense with one model family needs a model of
 *  it (`modelFamily`, judged only where the deployment restricts models, as
 *  the credit guard's run-model door is).
 */

/** A node-running route a tool calls: its path pattern, or the pattern and the body that picks its node. */
export type RouteNeed = string | { readonly route: string; readonly body: Readonly<Record<string, unknown>> }

export interface ToolNeed {
  /** Lanes: node-running routes the tool calls; it is offered while ANY of them is. */
  readonly routes?: readonly RouteNeed[]
  /** Routes ONE call runs in sequence, every one of which must be offered; called from `stepsIn`. */
  readonly steps?: readonly string[]
  /** The repo file (from the repo root) whose code calls `steps`. */
  readonly stepsIn?: string
  /** The routes were computed from the registry the tool's own code reads (no literal to find). */
  readonly fromRegistry?: true
  /** Nodes (or gateable features) no route of the tool's own names; every one must be offered. */
  readonly nodes?: readonly string[]
  /** Why `nodes` are needed. */
  readonly why?: string
  /** A model family (`MODEL_CATALOG` `family`) at least one model of which must be offered. */
  readonly modelFamily?: string
  /** Every call imports a link to outside content (`imports.links`). */
  readonly linkImports?: true
  /** The world (the shared header's) the tool's product is. */
  readonly world?: WorldId
  /** The tool needs nothing a deployment can withhold — why. */
  readonly none?: string
}

const runs = (...routes: RouteNeed[]): ToolNeed => ({ routes })
const needs = (nodes: readonly string[], why: string): ToolNeed => ({ nodes, why })
const none = (why: string): ToolNeed => ({ none: why })

const READ = "reads the caller's own data"
const OWN_WRITE = "writes the caller's own data and runs no node"
const MADE = "acts on work already made: following, stopping or removing it stays possible whatever the deployment offers now"
const CONTENT = "serves a document or a catalog; what it describes is judged where it runs"
const GRAPH = "runs a saved graph; every node in it is judged when it runs"
const UPLOAD = "hands out an upload of the caller's own file and runs no node"
const ACCOUNT = "reads the caller's balance or account"
const DIAGNOSTIC = "a connectivity check"

/** Recast renders a Generate Video Pro run; every Recast route follows that node (lib/route-node-gate.ts). */
const RECAST = needs(["generate-video-pro"], "prepares a Recast run, which Generate Video Pro renders")
/** Every trend run is a Video Remake run (`requireNodeAvailable("cast-swap")` on its run route). */
const TREND = needs(["cast-swap"], "browses or quotes trends, and every trend run is a Video Remake (cast-swap) run")
const PIPELINE = needs([FILM_PIPELINE_FEATURE], "calls the film pipeline's services directly, past every route door")
const STUDIO: ToolNeed = { world: "studio" }

/** The use-case nodes' run and continue routes, as the registry their verbs read gives them. */
const USE_CASE_RUN_ROUTES: readonly string[] = USE_CASE_NODE_TYPES.map((t) => usecaseDescriptor(t).route)
const USE_CASE_CONTINUE_ROUTES: readonly string[] = USE_CASE_NODE_TYPES.map((t) => usecaseContinuePath(t))

/** The Video Director chain's own steps (author → speech → alignment → render). */
const DIRECTOR: ToolNeed = {
  routes: ["/v1/video-director/run"],
  steps: ["/v1/text-to-speech", "/v1/forced-alignment", "/v1/render-video/plan"],
  stepsIn: "backend/src/ee/video-director/orchestrate.ts",
}

export const TOOL_NEEDS: Readonly<Record<string, ToolNeed>> = Object.freeze({
  // ── Diagnostics, account, documents and catalogs ─────────────────────────
  ping: none(DIAGNOSTIC),
  check_balance: none(ACCOUNT),
  credit_transactions: none(ACCOUNT),
  list_models: none(CONTENT),
  get_picker_catalog: none(CONTENT),
  get_node_skill: none(CONTENT),
  start_workflow_editor: none(CONTENT),
  get_recipe: none(CONTENT),
  start_film_director: none(CONTENT),
  start_video_director: none(CONTENT),
  list_shot_shapes: none(CONTENT),
  get_shot_shape: none(CONTENT),
  list_brand_presets: none(CONTENT),
  list_voices: none(CONTENT),
  diagnose_run: none(READ),

  // ── Jobs, gallery, projects, workspaces ─────────────────────────────────
  list_jobs: none(READ),
  get_job: none(READ),
  wait_for_job: none(READ),
  rate_job: none(OWN_WRITE),
  browse_gallery: none(READ),
  browse_uploads: none(READ),
  list_favorites: none(READ),
  get_asset: none(READ),
  display_asset: none(READ),
  get_app_run: none(READ),
  favorite_asset: none(OWN_WRITE),
  list_projects: none(READ),
  get_project: none(READ),
  list_workspaces: none(READ),
  select_workspace: none(OWN_WRITE),
  list_trash: none(READ),
  restore_job: none(MADE),

  // ── Uploads ─────────────────────────────────────────────────────────────
  request_image_upload: none(UPLOAD),
  request_video_upload: none(UPLOAD),
  request_audio_upload: none(UPLOAD),
  prepare_image_upload: none(UPLOAD),
  prepare_video_upload: none(UPLOAD),
  prepare_audio_upload: none(UPLOAD),
  upload_image_widget: none(UPLOAD),
  upload_video_widget: none(UPLOAD),
  upload_audio_widget: none(UPLOAD),

  // ── Workflows, apps, components ─────────────────────────────────────────
  list_workflows: none(READ),
  get_workflow: none(READ),
  get_workflow_json: none(READ),
  export_workflow: none(READ),
  create_workflow: none("writes the caller's own workflow; a node the deployment withholds is refused at the write"),
  update_workflow_json: none("writes the caller's own workflow; a node the deployment withholds is refused at the write"),
  import_workflow: none("writes the caller's own workflow; a node the deployment withholds is refused at the write"),
  delete_workflow: none(MADE),
  run_workflow: none(GRAPH),
  render_final: none(GRAPH),
  list_apps: none(READ),
  get_app_inputs: none(READ),
  run_app: none(GRAPH),
  retry_app_run: none(GRAPH),
  delete_app_run: none(MADE),
  list_components: none(READ),
  get_component_inputs: none(READ),
  run_component: none(GRAPH),

  // ── The caller's saved things ───────────────────────────────────────────
  list_node_presets: none(READ),
  get_node_preset: none(READ),
  save_node_preset: none(OWN_WRITE),
  delete_node_preset: none(OWN_WRITE),
  favorite_node_preset: none(OWN_WRITE),
  list_palettes: none(READ),
  save_palette: none(OWN_WRITE),
  list_moodboards: none(READ),
  save_moodboard: none(OWN_WRITE),
  list_collections: none(READ),
  read_collection: none(READ),
  add_collection_record: none(OWN_WRITE),
  list_sessions: none(READ),
  read_session: none(READ),
  create_session: none(OWN_WRITE),
  update_session: none(OWN_WRITE),
  list_voice_favorites: none(READ),
  favorite_voice: none(OWN_WRITE),
  save_image_defaults: none(OWN_WRITE),
  save_post: none(OWN_WRITE),
  list_saved_posts: none(READ),

  // ── Entities: the library is the caller's; making a sheet runs the node ──
  list_characters: none(READ),
  get_character: none(READ),
  create_character: none(OWN_WRITE),
  update_character: none(OWN_WRITE),
  approve_portrait: runs("/v1/characters/:id/approve-portrait"),
  recaption_character: runs("/v1/characters/:id/llm-caption"),
  generate_character: runs("/v1/generate-character", "/v1/generate-character-asset"),
  generate_character_motion: runs("/v1/generate-character-motion"),
  train_character: runs("/v1/characters/:id/train"),
  list_locations: none(READ),
  get_location: none(READ),
  create_location: none(OWN_WRITE),
  update_location: none(OWN_WRITE),
  approve_main_image: runs("/v1/locations/:id/approve-main-image"),
  recaption_location: runs("/v1/locations/:id/llm-caption"),
  generate_location: runs("/v1/generate-location", "/v1/generate-location-asset"),
  generate_location_motion: runs("/v1/generate-location-motion"),
  list_objects: none(READ),
  get_object: none(READ),
  approve_object_main_image: runs("/v1/objects/:id/approve-main-image"),
  recaption_object: runs("/v1/objects/:id/llm-caption"),
  generate_object: runs("/v1/generate-object", "/v1/generate-object-asset"),
  generate_object_motion: runs("/v1/generate-object-motion"),
  list_creatures: none(READ),
  get_creature: none(READ),
  approve_creature_main_image: runs("/v1/creatures/:id/approve-main-image"),
  recaption_creature: runs("/v1/creatures/:id/llm-caption"),
  generate_creature: runs("/v1/generate-creature", "/v1/generate-creature-asset"),
  generate_creature_motion: runs("/v1/generate-creature-motion"),

  // ── Image ───────────────────────────────────────────────────────────────
  generate_image: runs("/v1/generate-image"),
  modify_image: runs("/v1/image-to-image"),
  image_to_image: runs("/v1/image-to-image"),
  edit_image: runs(
    { route: "/v1/edit-image", body: { provider: "recraft-upscale" } },
    { route: "/v1/edit-image", body: { provider: "recraft-remove-bg" } },
    { route: "/v1/edit-image", body: { provider: "nano-banana-edit" } },
  ),
  generate_mask: runs("/v1/generate-mask"),
  image_collage: runs("/v1/image-collage"),
  image_overlay: runs("/v1/image-overlay"),
  suggest_overlay_placement: runs("/v1/image-overlay/suggest-placement"),
  image_to_text: runs("/v1/image-to-text/describe"),
  generate_text: runs("/v1/llm-chat/generate"),
  generate_script: runs("/v1/generate-script"),
  analyze_prompt: runs("/v1/prompt-helper/wizard"),
  generate_prompt: runs("/v1/prompt-helper/wizard"),
  enhance_prompt: runs("/v1/prompt-helper/wizard"),
  split_into_layers: runs("/v1/split-into-layers"),
  reduce: runs("/v1/reduce"),

  // ── Video ───────────────────────────────────────────────────────────────
  // With a start frame on the image-to-video route, without on text-to-video:
  // either lane makes the tool useful; the route refuses the other.
  generate_video: runs("/v1/generate-video", "/v1/text-to-video"),
  animate_image: runs("/v1/generate-video"),
  modify_video: runs("/v1/video-to-video", "/v1/text-to-video"),
  extend_video: runs("/v1/extend-video"),
  combine_videos: runs("/v1/combine-videos"),
  assemble_narrated_video: runs("/v1/assemble-narrated-video"),
  add_captions: runs("/v1/add-captions"),
  extract_frame: runs("/v1/extract-frame"),
  lip_sync: runs("/v1/lip-sync"),
  relight_video: runs("/v1/switchx"),
  trim_video: runs("/v1/trim-video"),
  loop_video: runs("/v1/loop-video"),
  merge_video_audio: runs("/v1/merge-video-audio"),
  replace_audio: runs("/v1/replace-audio"),
  still_to_video: runs("/v1/still-to-video"),
  gif_to_video: runs("/v1/gif-to-video"),
  slideshow: runs("/v1/slideshow"),
  motion_transfer: runs("/v1/motion-transfer"),
  face_swap: runs("/v1/face-swap"),
  video_upscale: runs("/v1/video-upscale"),
  video_depth: runs("/v1/video-depth"),
  speech_to_video: runs("/v1/speech-to-video"),
  video_analysis: runs("/v1/video-analysis"),
  video_audit: runs("/v1/video-audit"),
  continue_video_pro: runs("/v1/generate-video-pro/continue"),
  stop_video_pro: none(MADE),
  silence_detect: runs("/v1/silence-detect"),
  audio_sync: runs("/v1/audio-sync"),
  apply_edl: runs("/v1/apply-edl"),
  plan_edit: runs("/v1/edit-plan"),
  switch_cameras: runs("/v1/camera-switch"),
  video_mask: runs("/v1/video-mask"),
  mask_composite: runs("/v1/mask-composite"),
  overlay_images: runs("/v1/video-overlay"),
  shot_cuts: runs("/v1/shot-cuts"),
  split_media: runs("/v1/split-media"),
  speaker_map: runs("/v1/speaker-map"),
  speaker_view: runs("/v1/speaker-view"),
  // Every capture is of a page on another site: its one argument is that page.
  capture_site: { ...runs("/v1/site-capture"), linkImports: true },
  forced_alignment: runs("/v1/forced-alignment"),
  resolve_shot_sequence: needs(["render-video"], "plans a shot sequence that only Render Video renders"),
  render_shot_sequence: runs("/v1/render-video/plan"),
  generate_3d_scene: runs("/v1/3d-scene/generate"),
  edit_3d_scene: runs("/v1/3d-scene/edit"),
  render_3d_scene: runs("/v1/render-video/plan"),
  pro_3d_render: runs("/v1/pro-3d-render"),
  create_explainer: DIRECTOR,
  create_launch_video: DIRECTOR,

  // ── Podcast use cases: each verb its node; continue / estimate any of them ─
  tighten_episode: runs("/v1/tighten-episode"),
  make_chapters: runs("/v1/episode-chapters"),
  make_trailer: runs("/v1/episode-trailer"),
  make_clip_pack: runs("/v1/clip-pack"),
  speaker_layout: runs("/v1/speaker-layout"),
  continue_use_case: { routes: USE_CASE_CONTINUE_ROUTES, fromRegistry: true },
  estimate_use_case: { routes: USE_CASE_RUN_ROUTES, fromRegistry: true },
  // A pack runs the tools its body names (lib/route-node-gate.ts): offered while any of them is.
  make_podcast_pack: runs(...PODCAST_PACK_TOOLS.map((t) => ({ route: "/v1/podcast-pack", body: { tools: { [t]: {} } } }))),

  // ── Audio ───────────────────────────────────────────────────────────────
  generate_music: runs("/v1/generate-music", "/v1/suno/generate"),
  generate_speech: runs("/v1/text-to-speech"),
  generate_dialogue: runs("/v1/text-to-dialogue"),
  download_youtube_audio: { linkImports: true },
  voice_changer: runs("/v1/voice-changer"),
  voice_changer_pro: runs("/v1/voice-changer-pro"),
  voice_changer_pro_analyze: runs("/v1/voice-changer-pro/analyze"),
  voice_changer_pro_export: runs("/v1/voice-changer-pro/export"),
  dubbing: runs("/v1/dubbing"),
  get_dubbing: none(READ),
  get_dubbing_captions: none(READ),
  add_dubbing_language: runs("/v1/dubbing/:jobId/languages"),
  voice_design: runs("/v1/voice-design"),
  voice_remix: runs("/v1/voice-remix"),
  trim_audio: runs("/v1/trim-audio"),
  text_to_audio: runs("/v1/text-to-audio"),
  audio_isolation: runs("/v1/audio-isolation"),
  separate_audio: runs("/v1/audio-separation"),
  apply_audio_fx: runs("/v1/audio-fx"),
  pitch_tempo: runs("/v1/pitch-tempo"),
  mix_audio: runs("/v1/mix-audio"),
  transcribe: runs("/v1/transcribe"),
  // A Suno route that judges the model it runs (`runModel`) only makes sense
  // where a Suno model is offered.
  suno_generate: { ...runs("/v1/suno/generate"), modelFamily: "Suno" },
  suno_cover: { ...runs("/v1/suno/cover"), modelFamily: "Suno" },
  suno_extend: { ...runs("/v1/suno/extend"), modelFamily: "Suno" },
  suno_mashup: { ...runs("/v1/suno/mashup"), modelFamily: "Suno" },
  suno_add_instrumental: { ...runs("/v1/suno/add-instrumental"), modelFamily: "Suno" },
  suno_add_vocals: { ...runs("/v1/suno/add-vocals"), modelFamily: "Suno" },
  suno_upload_extend: { ...runs("/v1/suno/upload-extend"), modelFamily: "Suno" },
  suno_lyrics: runs("/v1/suno/lyrics"),
  suno_separate_stems: runs("/v1/suno/separate"),
  suno_music_video: runs("/v1/suno/music-video"),
  suno_replace_section: runs("/v1/suno/replace-section"),
  suno_style_boost: runs("/v1/suno/style-boost"),
  suno_convert_wav: runs("/v1/suno/convert-wav"),
  suno_speech: runs("/v1/suno-speech"),

  // ── Video Remake (cast-swap) and trends ────────────────────────────────
  video_remake: runs("/v1/video-remake"),
  estimate_full_quality: runs("/v1/video-remake/:jobId/full-quality"),
  full_quality: runs("/v1/video-remake/:jobId/full-quality"),
  list_trends: TREND,
  get_trend: TREND,
  estimate_trend: TREND,
  run_trend: TREND,

  // ── Recast ──────────────────────────────────────────────────────────────
  // A run that pauses for a choice fires its next hop (candidates, the plan)
  // from the tool that started it or the one that resolved the choice.
  start_recast: runs("/v1/recast", "/v1/recast/:id/candidates", "/v1/recast/:id/plan"),
  resolve_recast_gate: runs("/v1/recast/:id/candidates", "/v1/recast/:id/plan"),
  get_recast_status: none(MADE),
  get_recast_authoring_skill: RECAST,
  validate_recast_script: RECAST,
  import_recast_script: RECAST,

  // ── The film pipeline ───────────────────────────────────────────────────
  start_pipeline: PIPELINE,
  branch_pipeline: PIPELINE,
  chat_pipeline_stage: PIPELINE,
  apply_chat_proposal: PIPELINE,
  get_pipeline_status: none(MADE),
  get_pipeline_stage_chat: none(MADE),
  pipeline_pending_approvals: none(MADE),

  // ── UGC builders ────────────────────────────────────────────────────────
  build_ugc_creator: runs("/v1/ugc/creator"),
  build_ugc_clips: runs("/v1/ugc/clips"),
  build_ugc_cards: runs("/v1/ugc/cards"),
  ugc_split_speech: runs("/v1/ugc/segments"),
  ugc_finish_clips: runs("/v1/ugc/finish"),

  // ── Research and competitors ────────────────────────────────────────────
  social_search: runs("/v1/social-search"),
  scan_competitor: runs("/v1/competitor-scan"),
  add_competitor: needs(["competitor-scan"], "tracks an account for competitor scans"),
  list_competitors: none(READ),
  competitor_cards: none(READ),
  competitor_lessons: none(READ),
  competitor_tried: none(READ),
  mark_card_done: none(OWN_WRITE),

  // ── Studio productions: a world with no node of its own ────────────────
  // Its generation steps submit to the priced single-node routes, each judged
  // as its own node when it runs.
  get_studio_production_skill: STUDIO,
  validate_studio_plan: STUDIO,
  create_studio_production: STUDIO,
  import_studio_production: STUDIO,
  edit_studio_production: STUDIO,
  clone_studio_production: STUDIO,
  describe_studio_production: STUDIO,
  generate_studio_still: STUDIO,
  generate_studio_keyframe: STUDIO,
  generate_studio_clip: STUDIO,
  new_studio_shot_from_frame: STUDIO,
  voice_studio_shot: STUDIO,
  revoice_studio_clip: STUDIO,
  score_studio_production: STUDIO,
  list_studio_productions: none(MADE),
  get_studio_production: none(MADE),
  share_studio_production: none(MADE),
  plan_studio_export: none(MADE),
})
