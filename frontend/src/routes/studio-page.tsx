import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react"
import { useNavigate, useParams } from "react-router-dom"
import type {
  PipelineEvent,
  PipelineMode,
  PipelinePinnableImageModel,
  PipelinePinnableVideoModel,
  PipelineStageName,
  SubGateName,
} from "@nodaro/shared"
import {
  PIPELINE_PINNABLE_IMAGE_MODELS,
  PIPELINE_PINNABLE_VIDEO_MODELS,
  STYLE_PRESETS,
  getStylePreset,
  getFeaturedEntities,
  estimateFilmCredits,
} from "@nodaro/shared"
import { pipelinesApi, type PipelineRecord } from "@/lib/pipelines-api"
import {
  uploadImage,
  getCharacters,
  getLocations,
  getObjects,
  getCurrentUserId,
  getUserCredits,
} from "@/lib/api"
import { usePipelineEvents } from "@/hooks/use-pipeline-events"
import { buildSceneGraphFromPipeline } from "@remotion-pkg/lib/build-scene-graph-from-pipeline"
import type { SceneGraph } from "@remotion-pkg/scene-graph"
import { SceneGraphPlayerPreview } from "@/components/editor/scene-graph-player-preview"
import { ComposerSpec } from "@/components/studio/composer-spec"
import { ClipEditor } from "@/components/studio/clip-editor"
import { CinemaTopBar, FlowGraphModal } from "@/components/studio/cinema-top-bar"
import { AiDirectorPanel } from "@/components/studio/ai-director-panel"
import { ReelPipeline } from "@/components/studio/reel-pipeline"

/**
 * Phase 0.x — the standalone "studio" tracer with per-stage CONTROL.
 *
 * The pipeline runs CHECKPOINTED (manual mode): it pauses at each gate so the
 * user decides before credits are spent. The studio renders a readable script,
 * a stage tracker, live artifacts, and a "Your turn" gate panel that drives the
 * engine's existing approval routes (approve stage / per-entity generate / skip
 * / approve / reject). Reuse-from-library + skip-script-critic are follow-ups.
 */

type NarrationLine = { type: string; text: string }

// Phase 3 — the autonomy dial (north-star §6: "Composer ⇄ AI Director").
// One control that decides how much the engine does on its own vs how much the
// user directs, by mapping to the pipeline's `mode` + gate config.
type Autonomy = "director_ai" | "copilot" | "director_me"

interface AutonomyOption {
  label: string
  hint: string
  mode: PipelineMode
  /** Auto-advance the production stages (shot_list / scene_images). */
  autoAdvanceProduction: boolean
  /** Skip the script critic + pause for review at the first draft. */
  skipScriptCritic: boolean
}

const AUTONOMY_OPTIONS: Record<Autonomy, AutonomyOption> = {
  director_ai: {
    label: "AI Director",
    hint: "Describe it — AI makes the whole film, no stops.",
    mode: "auto",
    autoAdvanceProduction: true,
    skipScriptCritic: false,
  },
  copilot: {
    label: "Co-pilot",
    hint: "AI drafts; you approve the creative calls (cast, props, script).",
    mode: "manual",
    autoAdvanceProduction: true,
    skipScriptCritic: true,
  },
  director_me: {
    label: "Director",
    hint: "You review and approve every stage.",
    mode: "manual",
    autoAdvanceProduction: false,
    skipScriptCritic: true,
  },
}
const AUTONOMY_ORDER: readonly Autonomy[] = ["director_ai", "copilot", "director_me"]

// A stage-level gate awaiting the user, with its sub-gate (if any) so the right
// route is used: animate sub-gates (dialogue_recheck / silent_cut) need
// approveSubGate; plain stage gates (post_merge) use approveStage.
type StageGate = { stageName: string; subGate: string | null }

interface EntityCard {
  entityId: string
  entityType: string
  entityKey: string
  status: string
  mainAssetUrl?: string
  description?: string
  variants: string[]
}

const ENTITY_GROUPS: ReadonlyArray<{ type: string; label: string }> = [
  { type: "character", label: "Cast" },
  { type: "location", label: "Locations" },
  { type: "object", label: "Props" },
]
const ENTITY_TYPES = ["character", "object", "location"] as const

interface FilmMediaItem {
  url: string
  label: string
  kind: "image" | "video"
}

function mediaKind(url: string): "image" | "video" {
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url) ? "video" : "image"
}

/**
 * Flatten every generated asset of the film — each entity's main image + its
 * variants, in stage order (Cast → Props → Locations) — into one ordered list
 * the fullscreen viewer pages through. Scene composites (video) are appended by
 * the caller once the timeline assembles.
 */
function buildEntityMedia(entities: Record<string, EntityCard>): FilmMediaItem[] {
  const cards = Object.values(entities)
  const out: FilmMediaItem[] = []
  for (const { type } of ENTITY_GROUPS) {
    for (const c of cards) {
      if (c.entityType !== type || !c.mainAssetUrl) continue
      out.push({ url: c.mainAssetUrl, label: c.entityKey, kind: mediaKind(c.mainAssetUrl) })
      c.variants.forEach((u, i) =>
        out.push({ url: u, label: `${c.entityKey} · variant ${i + 1}`, kind: mediaKind(u) }),
      )
    }
  }
  return out
}

const STAGE_ORDER = [
  "script",
  "characters",
  "objects",
  "locations",
  "shot_list",
  "scene_images",
  "animate_audio_edit",
  "post_merge",
] as const
const STAGE_LABELS: Record<string, string> = {
  script: "Script",
  characters: "Cast",
  objects: "Props",
  locations: "Locations",
  shot_list: "Shots",
  scene_images: "Scenes",
  animate_audio_edit: "Animate",
  post_merge: "Finish",
}

// Human "what's happening now" line per stage — shown in the status banner so
// the user always knows the director is working, even when there's no gate to
// act on (otherwise a generating stage looks frozen).
const STAGE_ACTIVITY: Record<string, string> = {
  script: "Drafting the script…",
  characters: "Generating the cast…",
  objects: "Generating the props…",
  locations: "Generating the locations…",
  shot_list: "Planning the shots…",
  scene_images: "Creating the scenes…",
  animate_audio_edit: "Animating and adding audio…",
  post_merge: "Assembling your film…",
}

// Which entity type each entity-stage tab renders (that type's cards + gate).
// Non-entity stages (script / shots / scenes / animate / finish) aren't here.
const STAGE_ENTITY_TYPE: Record<string, "character" | "object" | "location"> = {
  characters: "character",
  objects: "object",
  locations: "location",
}
// Stage tabs whose content is the assembled film player.
const FILM_STAGES = new Set(["scene_images", "animate_audio_edit", "post_merge"])

const TERMINAL_STATUSES = ["completed", "failed", "cancelled"]

/**
 * Map a thrown API error (shaped `"<status>: <json>"` by pipelines-api) to a
 * human message for the gate's action banner. Without this, a failed gate
 * action (e.g. reject hitting a 400/409) is swallowed by `act()` and the click
 * looks dead — which is exactly how the "Redo does nothing" bug presented.
 */
function friendlyActionError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  const code = raw.match(/"code":"([^"]+)"/)?.[1]
  const map: Record<string, string> = {
    entity_not_awaiting_approval: "This item already moved on — the view refreshed.",
    entity_already_advanced: "This item already moved on — the view refreshed.",
    validation_error: "That request was rejected as invalid.",
  }
  return (code && map[code]) || "That action didn't go through — please try again."
}

function describeEvent(evt: PipelineEvent): string | null {
  const r = evt as unknown as Record<string, unknown>
  const v = (k: string) => (r[k] == null ? "" : String(r[k]))
  switch (evt.type as string) {
    case "pipeline:status":
      return `Pipeline ${v("status")}`
    case "stage:status":
      return `${STAGE_LABELS[v("stageName")] ?? v("stageName")} ${v("status")}`
    case "stage:progress":
      return (v("message") || `Working on ${v("stageName")}...`).replace(
        /\s*\([\d.]+\s*[KMG]?B so far\)/i,
        "",
      )
    case "entity:status":
      return `${v("entityType")} "${v("entityKey")}" ${v("status")}`
    case "entity:variant:added":
      return `Variant ${v("variantKey")} ready`
    case "scene:status":
      return `Scene ${v("sceneIndex")} ${v("status")}`
    case "pipeline:warning":
      return `! ${v("message") || v("code")}`
    case "pipeline:completed":
      return "Film complete"
    default:
      return null
  }
}

function pushLine(prev: NarrationLine[], type: string, text: string): NarrationLine[] {
  const last = prev[prev.length - 1]
  // Skip exact consecutive duplicates (e.g. repeated "Pipeline awaiting_approval").
  if (last && last.text === text) return prev
  if (last && last.type === type && type === "stage:progress") {
    return [...prev.slice(0, -1), { type, text }]
  }
  return [...prev, { type, text }]
}

interface ScreenplayScene {
  heading: string
  description: string
  narration?: string
  dialogue: Array<{ who: string; line: string }>
}
interface Screenplay {
  cast: Array<{ name: string; role: string; description: string }>
  scenes: ScreenplayScene[]
}

function parseScreenplay(output: unknown): Screenplay | null {
  if (!output || typeof output !== "object") return null
  const o = output as Record<string, unknown>
  const plan = (o.plan && typeof o.plan === "object" ? o.plan : o) as Record<
    string,
    unknown
  >
  const castByKey = new Map<string, string>()
  const cast: Screenplay["cast"] = []
  if (Array.isArray(plan.cast)) {
    for (const c of plan.cast) {
      const cc = (c ?? {}) as Record<string, unknown>
      const key = String(cc.key ?? "")
      const name = String(cc.name ?? key ?? "")
      if (key) castByKey.set(key, name)
      cast.push({
        name,
        role: typeof cc.role === "string" ? cc.role : "",
        description:
          typeof cc.visual_description === "string" ? cc.visual_description : "",
      })
    }
  }
  const scenes: ScreenplayScene[] = []
  if (Array.isArray(plan.scenes)) {
    plan.scenes.forEach((s, i) => {
      const sc = (s ?? {}) as Record<string, unknown>
      const idx = sc.scene_index ?? i + 1
      const loc = sc.location_key ? ` · ${sc.location_key}` : ""
      const beat = sc.emotional_beat ? ` · ${sc.emotional_beat}` : ""
      const dialogue: ScreenplayScene["dialogue"] = []
      if (Array.isArray(sc.dialogue)) {
        for (const d of sc.dialogue) {
          const dd = (d ?? {}) as Record<string, unknown>
          if (typeof dd.line === "string" && dd.line) {
            dialogue.push({
              who: castByKey.get(String(dd.cast_key)) ?? String(dd.cast_key ?? ""),
              line: dd.line,
            })
          }
        }
      }
      scenes.push({
        heading: `Scene ${idx}${loc}${beat}`,
        description: typeof sc.description === "string" ? sc.description : "",
        narration: typeof sc.narration === "string" ? sc.narration : undefined,
        dialogue,
      })
    })
  }
  if (cast.length === 0 && scenes.length === 0) return null
  return { cast, scenes }
}

const PROMPT_PLACEHOLDER =
  'Describe your film — e.g. "A lighthouse keeper watches the sunrise"'

function StudioPrompt({ onOpen }: { onOpen: (id: string) => void }) {
  const [prompt, setPrompt] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recent, setRecent] = useState<PipelineRecord[]>([])
  // Autonomy dial — how much the engine self-drives vs pauses for the user.
  const [autonomy, setAutonomy] = useState<Autonomy>("copilot")
  // Style Gallery — the foundational "look" ("" = Auto, let the Showrunner pick).
  const [styleId, setStyleId] = useState("")
  // Film length (seconds) — drives how many scenes/shots the Showrunner plans.
  const [duration, setDuration] = useState(15)
  // Upfront model picker — global overrides for the whole film ("" = let the
  // engine choose). Per-step overrides land on each gate in a follow-up.
  const [imageModel, setImageModel] = useState("")
  const [videoModel, setVideoModel] = useState("")

  useEffect(() => {
    pipelinesApi
      .list()
      .then((r) => setRecent(r.slice(0, 8)))
      .catch(() => {})
  }, [])

  const start = useCallback(async () => {
    const story = prompt.trim()
    if (!story || busy) return
    setBusy(true)
    setError(null)
    try {
      const auto = AUTONOMY_OPTIONS[autonomy]
      const { id } = await pipelinesApi.create({
        pipeline_type: "story_to_video",
        root_node_id: crypto.randomUUID(),
        story_prompt: story,
        target_duration_seconds: duration,
        format: "reel",
        output_resolution: "720p",
        language: "en",
        // Driven by the autonomy dial: AI Director = auto (no stops); Co-pilot /
        // Director = manual (pause at creative / all gates respectively).
        mode: auto.mode,
        video_critic_frame_count: "first_last",
        // Style Gallery — folds into the Showrunner's global_style and
        // propagates to every entity + shot. Omitted on "Auto".
        style_directives: getStylePreset(styleId)?.directives,
        config: {
          music_enabled: true,
          narration_enabled: false,
          lipsync_enabled: false,
          // Co-pilot/Director skip the script critic and show the draft at the
          // gate (Edit / Regenerate / Run-critic there); AI Director runs the
          // full critic chain unattended.
          skip_script_critic: auto.skipScriptCritic,
          // Co-pilot's lever: approve the creative entities (script/cast/props/
          // locations), then production (shots + keyframes) advances on its own.
          // Director turns this off to review every stage.
          auto_advance_production: auto.autoAdvanceProduction,
          // Render shots in parallel (~minutes) instead of the continuity-forced
          // sequential path (~an hour for a multi-shot reel).
          force_parallel_animate: true,
          // Upfront model overrides (global). Omitted when "Auto" so the engine
          // picks. Per-stage overrides (stage_models) are layered on later.
          image_model: imageModel
            ? (imageModel as PipelinePinnableImageModel)
            : undefined,
          video_model: videoModel
            ? (videoModel as PipelinePinnableVideoModel)
            : undefined,
        },
      })
      onOpen(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start the film")
      setBusy(false)
    }
  }, [prompt, busy, onOpen, autonomy, styleId, duration, imageModel, videoModel])

  // Approximate cost preview (display only — actual credits are charged per
  // job at generation time). base + per-shot × shots, model-driven.
  const cost = estimateFilmCredits(duration, videoModel || undefined)

  return (
    <div className="flex h-full flex-col items-center gap-8 overflow-y-auto p-8">
      <div className="w-full max-w-xl">
        <h1 className="mb-2 text-lg font-medium text-foreground">
          Nodaro Cinema — Studio
        </h1>
        <p className="mb-4 text-sm text-muted-foreground">
          Type a prompt; the director drafts a film and pauses at each step so
          you decide what gets made — before any credits are spent.
        </p>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={PROMPT_PLACEHOLDER}
          rows={3}
          className="w-full resize-none rounded-md border bg-card p-3 text-sm text-foreground outline-none focus:border-[#ff0073]"
        />
        <div className="mt-3">
          <span className="block text-xs text-muted-foreground">Who directs?</span>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {AUTONOMY_ORDER.map((k) => {
              const opt = AUTONOMY_OPTIONS[k]
              const active = autonomy === k
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setAutonomy(k)}
                  aria-pressed={active}
                  className={`rounded-md border p-2 text-left transition-colors ${
                    active
                      ? "border-[#ff0073] bg-[#ff0073]/10"
                      : "bg-card hover:border-[#ff0073]/50"
                  }`}
                >
                  <span className="block text-sm font-medium text-foreground">
                    {opt.label}
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-tight text-muted-foreground">
                    {opt.hint}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
        <div className="mt-3">
          <span className="block text-xs text-muted-foreground">Style</span>
          <div className="mt-1 grid grid-cols-3 gap-2 sm:grid-cols-4">
            <button
              type="button"
              onClick={() => setStyleId("")}
              aria-pressed={styleId === ""}
              className={`rounded-md border p-1.5 text-left transition-colors ${
                styleId === ""
                  ? "border-[#ff0073] bg-[#ff0073]/10"
                  : "bg-card hover:border-[#ff0073]/50"
              }`}
            >
              <div className="flex h-8 items-center justify-center rounded bg-[var(--border-primary)] text-[9px] text-muted-foreground">
                Auto
              </div>
              <span className="mt-1 block truncate text-[10px] font-medium text-foreground">
                Auto
              </span>
            </button>
            {STYLE_PRESETS.map((s) => {
              const active = styleId === s.id
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStyleId(s.id)}
                  aria-pressed={active}
                  title={s.description}
                  className={`rounded-md border p-1.5 text-left transition-colors ${
                    active
                      ? "border-[#ff0073] bg-[#ff0073]/10"
                      : "bg-card hover:border-[#ff0073]/50"
                  }`}
                >
                  <div className="h-8 rounded" style={{ background: s.swatch }} />
                  <span className="mt-1 block truncate text-[10px] font-medium text-foreground">
                    {s.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <label className="block text-xs text-muted-foreground">
            Length
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="mt-1 w-full rounded-md border bg-card p-2 text-sm text-foreground outline-none focus:border-[#ff0073]"
            >
              <option value={15}>15s</option>
              <option value={30}>30s</option>
              <option value={45}>45s</option>
              <option value={60}>1 min</option>
              <option value={90}>1.5 min</option>
              <option value={120}>2 min</option>
              <option value={180}>3 min</option>
              <option value={300}>5 min</option>
              <option value={600}>10 min</option>
            </select>
          </label>
          <label className="block text-xs text-muted-foreground">
            Image model
            <select
              value={imageModel}
              onChange={(e) => setImageModel(e.target.value)}
              className="mt-1 w-full rounded-md border bg-card p-2 text-sm text-foreground outline-none focus:border-[#ff0073]"
            >
              <option value="">Auto (recommended)</option>
              {PIPELINE_PINNABLE_IMAGE_MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-muted-foreground">
            Video model
            <select
              value={videoModel}
              onChange={(e) => setVideoModel(e.target.value)}
              className="mt-1 w-full rounded-md border bg-card p-2 text-sm text-foreground outline-none focus:border-[#ff0073]"
            >
              <option value="">Auto (recommended)</option>
              {PIPELINE_PINNABLE_VIDEO_MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 flex items-baseline justify-between rounded-md border border-dashed bg-card/50 px-3 py-2">
          <span className="text-xs text-muted-foreground">Estimated cost</span>
          <span className="text-sm text-foreground">
            ≈ {cost.totalCredits.toLocaleString()} credits{" "}
            <span className="text-xs text-muted-foreground">
              ({cost.shotCount} shots · ~{cost.creditsPerSecond}/s
              {cost.modelKnown ? "" : " · Auto"})
            </span>
          </span>
        </div>
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        <button
          type="button"
          onClick={() => void start()}
          disabled={!prompt.trim() || busy}
          className="mt-3 rounded-md bg-[#ff0073] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Starting…" : "Create film"}
        </button>
      </div>

      {recent.length > 0 && (
        <div className="w-full max-w-xl">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Recent films
          </h2>
          <div className="space-y-1">
            {recent.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onOpen(p.id)}
                className="flex w-full items-center justify-between gap-3 rounded-md border bg-card px-3 py-2 text-left text-sm hover:border-[#ff0073]"
              >
                <span className="truncate text-foreground">
                  {p.input_prompt || "Untitled film"}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {p.status}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StageTracker({
  stageStatus,
  awaiting,
  currentStage,
  selected,
  onSelect,
}: {
  stageStatus: Record<string, string>
  awaiting: string[]
  currentStage: string | null
  selected: string
  onSelect: (stage: string) => void
}) {
  // "You are here" = the pipeline's authoritative current_stage (engine-set on
  // the row) when known; otherwise fall back to the first stage that's
  // awaiting/running per SSE. The row is the source of truth because SSE
  // stage:status events can be dropped — when that happened the breadcrumb got
  // stuck on the previous stage even though the run had moved on.
  const fromRow = currentStage
    ? STAGE_ORDER.indexOf(currentStage as (typeof STAGE_ORDER)[number])
    : -1
  const currentIdx =
    fromRow >= 0
      ? fromRow
      : STAGE_ORDER.findIndex(
          (s) =>
            awaiting.includes(s) ||
            stageStatus[s] === "running" ||
            stageStatus[s] === "awaiting_approval",
        )
  return (
    <div className="mb-6 flex flex-wrap items-center gap-1.5">
      {STAGE_ORDER.map((s, i) => {
        const isSelected = s === selected
        const isCurrent = i === currentIdx
        const done =
          stageStatus[s] === "approved" || (currentIdx >= 0 && i < currentIdx)
        const cls = isSelected
          ? "border-[#ff0073] bg-[#ff0073] text-white"
          : done
            ? "border-green-500/50 bg-green-500/10 text-green-400 hover:border-[#ff0073]/60"
            : "border-[var(--border-primary)] text-muted-foreground hover:border-[#ff0073]/60"
        return (
          <button
            key={s}
            type="button"
            onClick={() => onSelect(s)}
            className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${cls}`}
          >
            {/* Live dot marks the stage the engine is actually on, shown when
                you've navigated to a different tab. */}
            {isCurrent && !isSelected ? "● " : ""}
            {STAGE_LABELS[s]}
          </button>
        )
      })}
    </div>
  )
}

interface GateActions {
  generate: (entityId: string, description?: string) => void
  skip: (entityId: string) => void
  upload: (entityId: string, assetUrl: string, file: File) => void
  reuse: (entityId: string, assetUrl: string) => void
  approveEntity: (entityId: string) => void
  rejectEntity: (entityId: string, feedback: string) => void
  approveGate: (stageName: string, subGate: string | null) => void
}

type LibraryItem = { id: string; name: string; url: string }

// Reuse-from-library — list the user's saved entities of the matching type so
// they can pick an existing one instead of generating. Reuses the `upload`
// backend path with the existing asset's URL (no new backend route).
async function fetchLibraryByType(type: string): Promise<LibraryItem[]> {
  const pick = <T extends { id: string; name: string; sourceImageUrl: string | null }>(
    rows: T[],
  ): LibraryItem[] =>
    rows
      .filter((r) => r.sourceImageUrl)
      .map((r) => ({ id: r.id, name: r.name, url: r.sourceImageUrl as string }))
  if (type === "character") return pick((await getCharacters()).characters)
  if (type === "location") return pick((await getLocations()).locations)
  if (type === "object") return pick((await getObjects()).objects)
  return []
}

function EntityDescGate({
  card,
  acting,
  onGenerate,
  onSkip,
  onUpload,
  onReuse,
}: {
  card: EntityCard
  acting: boolean
  onGenerate: (entityId: string, description?: string) => void
  onSkip: (entityId: string) => void
  onUpload: (entityId: string, assetUrl: string, file: File) => void
  onReuse: (entityId: string, assetUrl: string) => void
}) {
  const [desc, setDesc] = useState(card.description ?? "")
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [reuseOpen, setReuseOpen] = useState(false)
  const [libTab, setLibTab] = useState<"featured" | "mine">("featured")
  const [library, setLibrary] = useState<LibraryItem[]>([])
  const [libLoading, setLibLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const featured = getFeaturedEntities(card.entityType)

  const toggleReuse = async () => {
    const next = !reuseOpen
    setReuseOpen(next)
    if (next && library.length === 0) {
      setLibLoading(true)
      setErr(null)
      try {
        setLibrary(await fetchLibraryByType(card.entityType))
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Couldn't load your library")
      } finally {
        setLibLoading(false)
      }
    }
  }
  // The description arrives via getEntities (not SSE) — fill it in once it lands.
  useEffect(() => {
    if (card.description && !desc) setDesc(card.description)
  }, [card.description, desc])
  const edited = card.description != null && desc !== card.description
  const busy = acting || uploading

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (fileRef.current) fileRef.current.value = ""
    if (!file) return
    setUploading(true)
    setErr(null)
    try {
      const { url } = await uploadImage(file)
      onUpload(card.entityId, url, file)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="rounded-md border bg-card p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-sm text-foreground">
          {card.entityKey}{" "}
          <span className="text-xs text-muted-foreground">({card.entityType})</span>
        </span>
        <span className="flex shrink-0 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onGenerate(card.entityId, edited ? desc : undefined)}
            className="rounded-md bg-[#ff0073] px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            Generate
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="rounded-md border px-3 py-1 text-xs text-foreground disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "Upload"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void toggleReuse()}
            className="rounded-md border px-3 py-1 text-xs text-foreground disabled:opacity-50"
          >
            Library
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onSkip(card.entityId)}
            className="rounded-md border px-3 py-1 text-xs text-foreground disabled:opacity-50"
          >
            Skip
          </button>
        </span>
      </div>
      <textarea
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        rows={2}
        placeholder="Description used to generate this — edit before Generate…"
        className="w-full rounded-md border bg-background p-2 text-xs text-foreground"
      />
      {err && <p className="mt-1 text-xs text-red-400">{err}</p>}
      {reuseOpen && (
        <div className="mt-2">
          <div className="mb-1.5 flex gap-1">
            <button
              type="button"
              onClick={() => setLibTab("featured")}
              className={`rounded-md px-2 py-0.5 text-[10px] ${
                libTab === "featured"
                  ? "bg-[#ff0073]/10 text-[#ff0073]"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Starter packs
            </button>
            <button
              type="button"
              onClick={() => setLibTab("mine")}
              className={`rounded-md px-2 py-0.5 text-[10px] ${
                libTab === "mine"
                  ? "bg-[#ff0073]/10 text-[#ff0073]"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              My library
            </button>
          </div>

          {libTab === "featured" ? (
            featured.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No starter packs for this type — Generate, Upload, or pick from My
                library.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {featured.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    disabled={busy}
                    title={f.description}
                    onClick={() => {
                      setDesc(f.description)
                      setReuseOpen(false)
                    }}
                    className="rounded-full border px-2 py-1 text-[10px] text-foreground hover:border-[#ff0073]/50 disabled:opacity-50"
                  >
                    {f.label}
                  </button>
                ))}
                <p className="mt-1 w-full text-[10px] text-muted-foreground">
                  Fills the description with a starter — then hit Generate.
                </p>
              </div>
            )
          ) : libLoading ? (
            <p className="text-xs text-muted-foreground">Loading your library…</p>
          ) : library.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nothing saved for this type yet — Generate or Upload instead.
            </p>
          ) : (
            <div className="flex gap-2 overflow-x-auto">
              {library.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    onReuse(card.entityId, item.url)
                    setReuseOpen(false)
                  }}
                  className="w-20 shrink-0 text-left disabled:opacity-50"
                  title={item.name}
                >
                  <img
                    src={item.url}
                    alt={item.name}
                    className="h-20 w-20 rounded border object-cover"
                  />
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {item.name}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        onChange={handleFile}
        className="hidden"
      />
    </div>
  )
}

function GatePanel({
  cards,
  awaiting,
  acting,
  scriptReady,
  actions,
  onOpenMedia,
  viewStage,
}: {
  cards: EntityCard[]
  awaiting: StageGate[]
  acting: boolean
  scriptReady: boolean
  actions: GateActions
  onOpenMedia: (url: string) => void
  viewStage: string
}) {
  const [redoFor, setRedoFor] = useState<string | null>(null)
  const [redoFeedback, setRedoFeedback] = useState("")
  // Only surface the gate for the tab being viewed. Entity-stage tabs show that
  // type's per-entity gates; non-entity stages show their own stage-level gate.
  const entityType = STAGE_ENTITY_TYPE[viewStage]
  const pendingDesc = entityType
    ? cards.filter((c) => c.entityType === entityType && c.status === "pending_description")
    : []
  const awaitingImage = entityType
    ? cards.filter((c) => c.entityType === entityType && c.status === "awaiting_approval")
    : []
  const stageGates = awaiting.filter((g) => g.stageName === viewStage)
  if (pendingDesc.length === 0 && awaitingImage.length === 0 && stageGates.length === 0) {
    return null
  }
  const btn =
    "rounded-md px-3 py-1 text-xs font-medium disabled:opacity-50"
  return (
    <div className="mb-6 rounded-md border border-[#ff0073]/40 bg-[#ff0073]/5 p-4">
      <div className="mb-2 text-sm font-medium text-foreground">Your turn</div>

      {pendingDesc.length > 0 && (
        <div className="mb-3">
          <div className="mb-2 text-xs text-muted-foreground">
            Choose what to create — review/edit the description, then Generate
            (nothing is made until you pick):
          </div>
          <div className="space-y-2">
            {pendingDesc.map((c) => (
              <EntityDescGate
                key={c.entityId}
                card={c}
                acting={acting}
                onGenerate={actions.generate}
                onSkip={actions.skip}
                onUpload={actions.upload}
                onReuse={actions.reuse}
              />
            ))}
          </div>
        </div>
      )}

      {awaitingImage.length > 0 && (
        <div className="mb-3">
          <div className="mb-2 text-xs text-muted-foreground">
            Review generated — click an image to view it full-screen:
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {awaitingImage.map((c) => (
              <div
                key={c.entityId}
                className="overflow-hidden rounded-md border bg-card"
              >
                <button
                  type="button"
                  onClick={() => c.mainAssetUrl && onOpenMedia(c.mainAssetUrl)}
                  className="block w-full cursor-zoom-in"
                  title="View full-screen"
                >
                  {c.mainAssetUrl ? (
                    <img
                      src={c.mainAssetUrl}
                      alt={c.entityKey}
                      className="aspect-square w-full object-cover"
                    />
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center text-xs text-muted-foreground">
                      generating…
                    </div>
                  )}
                </button>
                <div className="p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="truncate text-sm text-foreground"
                      title={c.entityKey}
                    >
                      {c.entityKey}
                    </span>
                    <span className="flex shrink-0 gap-1.5">
                      <button
                        type="button"
                        disabled={acting}
                        onClick={() => actions.approveEntity(c.entityId)}
                        className={`${btn} bg-[#ff0073] text-white`}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRedoFor(redoFor === c.entityId ? null : c.entityId)
                          setRedoFeedback("")
                        }}
                        className={`${btn} border text-foreground`}
                      >
                        Redo
                      </button>
                    </span>
                  </div>
                  {redoFor === c.entityId && (
                    <div className="mt-2 flex gap-2">
                      <input
                        value={redoFeedback}
                        onChange={(e) => setRedoFeedback(e.target.value)}
                        placeholder="What to change (optional)…"
                        className="flex-1 rounded-md border bg-background px-2 py-1 text-xs text-foreground"
                      />
                      <button
                        type="button"
                        disabled={acting}
                        onClick={() => {
                          actions.rejectEntity(
                            c.entityId,
                            redoFeedback.trim() ||
                              "Regenerate this image — give a different take",
                          )
                          setRedoFor(null)
                          setRedoFeedback("")
                        }}
                        className={`${btn} bg-[#ff0073] text-white`}
                      >
                        Regenerate
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {stageGates.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {stageGates.map((g) =>
            g.stageName === "script" && !scriptReady ? (
              <span key={g.stageName} className="text-xs text-muted-foreground">
                Loading script…
              </span>
            ) : (
              <button
                key={g.stageName}
                type="button"
                disabled={acting}
                onClick={() => actions.approveGate(g.stageName, g.subGate)}
                className={`${btn} bg-[#ff0073] text-white`}
              >
                Approve {STAGE_LABELS[g.stageName] ?? g.stageName} & continue
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}

function EntityImage({
  card,
  onOpenMedia,
}: {
  card: EntityCard
  onOpenMedia: (url: string) => void
}) {
  return (
    <div className="w-48 shrink-0">
      <div className="aspect-square w-full overflow-hidden rounded-md border bg-card">
        {card.mainAssetUrl ? (
          <button
            type="button"
            onClick={() => onOpenMedia(card.mainAssetUrl as string)}
            className="block h-full w-full cursor-zoom-in"
            title="View full-screen"
          >
            <img
              src={card.mainAssetUrl}
              alt={card.entityKey}
              className="h-full w-full object-cover"
            />
          </button>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            {card.status === "failed"
              ? "failed"
              : card.status === "skipped"
                ? "skipped"
                : card.status === "pending_description"
                  ? "awaiting choice"
                  : "generating…"}
          </div>
        )}
      </div>
      <div className="mt-1 truncate text-xs text-foreground" title={card.entityKey}>
        {card.entityKey}
      </div>
      {card.variants.length > 0 && (
        <div className="mt-1 flex gap-1 overflow-x-auto">
          {card.variants.slice(0, 6).map((url, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onOpenMedia(url)}
              className="h-12 w-12 shrink-0 cursor-zoom-in overflow-hidden rounded border"
              title="View full-screen"
            >
              <img src={url} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

type ScriptPatch = { op: "replace"; path: string; value: string }

function ScriptView({
  screenplay,
  acting,
  onApplyEdits,
  onRedoScene,
  onRegenerate,
}: {
  screenplay: Screenplay
  acting: boolean
  onApplyEdits: (patches: ScriptPatch[]) => void
  onRedoScene: (index: number, feedback: string) => void
  onRegenerate: (feedback: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [redoFor, setRedoFor] = useState<number | null>(null)
  const [sceneFeedback, setSceneFeedback] = useState("")
  const [regenOpen, setRegenOpen] = useState(false)
  const [regenFeedback, setRegenFeedback] = useState("")

  const startEdit = () => {
    const d: Record<number, string> = {}
    screenplay.scenes.forEach((sc, i) => {
      d[i] = sc.description
    })
    setDrafts(d)
    setEditing(true)
  }
  const save = () => {
    const patches: ScriptPatch[] = screenplay.scenes
      .map((sc, i) => ({ i, sc }))
      .filter(({ i, sc }) => drafts[i] !== undefined && drafts[i] !== sc.description)
      .map(({ i }) => ({
        op: "replace" as const,
        path: `/scenes/${i}/description`,
        value: drafts[i] ?? "",
      }))
    if (patches.length > 0) onApplyEdits(patches)
    setEditing(false)
  }

  const inputCls =
    "flex-1 rounded-md border bg-background px-2 py-1 text-xs text-foreground"
  const pinkBtn =
    "rounded-md bg-[#ff0073] px-3 py-1 text-xs font-medium text-white disabled:opacity-50"

  return (
    <div className="max-w-3xl space-y-4 rounded-md border bg-card p-4 text-sm leading-relaxed text-foreground">
      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <button type="button" onClick={save} disabled={acting} className={pinkBtn}>
              Save edits
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md border px-3 py-1 text-xs text-foreground"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={startEdit}
              className="rounded-md border px-3 py-1 text-xs text-foreground"
            >
              Edit manually
            </button>
            <button
              type="button"
              onClick={() => setRegenOpen((v) => !v)}
              className="rounded-md border px-3 py-1 text-xs text-foreground"
            >
              Regenerate script
            </button>
          </>
        )}
      </div>

      {regenOpen && !editing && (
        <div className="flex gap-2">
          <input
            value={regenFeedback}
            onChange={(e) => setRegenFeedback(e.target.value)}
            placeholder="What to change (e.g. make it funnier, shorter)…"
            className={inputCls}
          />
          <button
            type="button"
            disabled={acting}
            onClick={() => {
              onRegenerate(regenFeedback)
              setRegenOpen(false)
              setRegenFeedback("")
            }}
            className={pinkBtn}
          >
            Regenerate
          </button>
        </div>
      )}

      {screenplay.cast.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Cast
          </div>
          <ul className="space-y-0.5">
            {screenplay.cast.map((c, i) => (
              <li key={i}>
                <span className="font-medium">{c.name}</span>
                {c.role && <span className="text-muted-foreground"> · {c.role}</span>}
                {c.description && (
                  <span className="text-muted-foreground"> — {c.description}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {screenplay.scenes.map((sc, i) => (
        <div key={i}>
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium uppercase tracking-wide text-[#ff0073]">
              {sc.heading}
            </div>
            {!editing && (
              <button
                type="button"
                onClick={() => {
                  setRedoFor(redoFor === i ? null : i)
                  setSceneFeedback("")
                }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Redo
              </button>
            )}
          </div>
          {editing ? (
            <textarea
              value={drafts[i] ?? sc.description}
              onChange={(e) => setDrafts((p) => ({ ...p, [i]: e.target.value }))}
              rows={3}
              className="mt-1 w-full rounded-md border bg-background p-2 text-sm text-foreground"
            />
          ) : (
            sc.description && <p className="mt-1">{sc.description}</p>
          )}
          {!editing && sc.narration && (
            <p className="mt-1 italic text-muted-foreground">
              Narration: {sc.narration}
            </p>
          )}
          {!editing &&
            sc.dialogue.map((d, j) => (
              <p key={j} className="mt-1">
                <span className="font-medium uppercase">{d.who}:</span> {d.line}
              </p>
            ))}
          {redoFor === i && !editing && (
            <div className="mt-2 flex gap-2">
              <input
                value={sceneFeedback}
                onChange={(e) => setSceneFeedback(e.target.value)}
                placeholder="How to change this scene…"
                className={inputCls}
              />
              <button
                type="button"
                disabled={acting}
                onClick={() => {
                  onRedoScene(i, sceneFeedback)
                  setRedoFor(null)
                  setSceneFeedback("")
                }}
                className={pinkBtn}
              >
                Redo scene
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * Fullscreen media viewer — opens on any film asset and pages forward/back
 * across the whole film (cast, props, locations, scene clips) via arrows,
 * keyboard (←/→/Esc), and a thumbnail strip. Click the backdrop to close.
 */
function Lightbox({
  media,
  index,
  onClose,
  onIndex,
}: {
  media: FilmMediaItem[]
  index: number
  onClose: () => void
  onIndex: (i: number) => void
}) {
  const count = media.length
  const go = useCallback(
    (delta: number) => {
      if (count === 0) return
      onIndex((index + delta + count) % count)
    },
    [count, index, onIndex],
  )
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      else if (e.key === "ArrowRight") go(1)
      else if (e.key === "ArrowLeft") go(-1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [go, onClose])

  const item = media[index]
  if (!item) return null

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col bg-black/90" onClick={onClose}>
      <div className="flex items-center gap-4 px-4 py-3 text-sm text-white/80">
        <span className="flex-1 truncate">{item.label}</span>
        <span className="shrink-0 tabular-nums">
          {index + 1} / {count}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md border border-white/20 px-3 py-1 text-xs text-white hover:bg-white/10"
        >
          Close
        </button>
      </div>
      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden p-4"
        onClick={(e) => e.stopPropagation()}
      >
        {count > 1 && (
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous"
            className="absolute left-4 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-3xl leading-none text-white hover:bg-white/20"
          >
            ‹
          </button>
        )}
        {item.kind === "video" ? (
          <video
            key={item.url}
            src={item.url}
            controls
            autoPlay
            className="max-h-full max-w-full rounded-md"
          />
        ) : (
          <img
            src={item.url}
            alt={item.label}
            className="max-h-full max-w-full rounded-md object-contain"
          />
        )}
        {count > 1 && (
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next"
            className="absolute right-4 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-3xl leading-none text-white hover:bg-white/20"
          >
            ›
          </button>
        )}
      </div>
      {count > 1 && (
        <div
          className="flex gap-2 overflow-x-auto px-4 py-3"
          onClick={(e) => e.stopPropagation()}
        >
          {media.map((m, i) => (
            <button
              key={`${m.url}-${i}`}
              type="button"
              onClick={() => onIndex(i)}
              className={`h-14 w-14 shrink-0 overflow-hidden rounded border-2 ${
                i === index
                  ? "border-[#ff0073]"
                  : "border-transparent opacity-60 hover:opacity-100"
              }`}
              title={m.label}
            >
              {m.kind === "video" ? (
                <div className="flex h-full w-full items-center justify-center bg-white/10 text-white">
                  ▶
                </div>
              ) : (
                <img src={m.url} alt="" className="h-full w-full object-cover" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function StudioSession({ pipelineId }: { pipelineId: string }) {
  const { lastEvent, connected } = usePipelineEvents(pipelineId)
  const navigate = useNavigate()
  const [lines, setLines] = useState<NarrationLine[]>([])
  const [entities, setEntities] = useState<Record<string, EntityCard>>({})
  const [stageStatus, setStageStatus] = useState<Record<string, string>>({})
  const [awaiting, setAwaiting] = useState<StageGate[]>([])
  const [acting, setActing] = useState(false)
  const [screenplay, setScreenplay] = useState<Screenplay | null>(null)
  const [sceneGraph, setSceneGraph] = useState<SceneGraph | null>(null)
  const [sceneMedia, setSceneMedia] = useState<FilmMediaItem[]>([])
  const [completedScenes, setCompletedScenes] = useState(0)
  // Seconds elapsed with no script yet — drives the "is the worker running?"
  // hint when a film sits queued/working with nothing processing it.
  const [elapsedSec, setElapsedSec] = useState(0)
  // Cinematic shell: Pro Control vs Autopilot AR + the Flow Graph modal.
  const [autopilot, setAutopilot] = useState(false)
  const [flowOpen, setFlowOpen] = useState(false)
  // Clip selected from the reel — plays in the main screen + opens its editor.
  const [selectedClip, setSelectedClip] = useState<{
    url: string
    label: string
    sceneId: string
  } | null>(null)
  // Account Gen-Credits shown in the top bar — refreshed every 30s.
  const [credits, setCredits] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const uid = await getCurrentUserId()
      if (!uid || cancelled) return
      try {
        const r = await getUserCredits(uid)
        if (!cancelled) setCredits(r.data?.total ?? null)
      } catch {
        /* ignore — top bar falls back to "—" */
      }
    }
    void load()
    const t = window.setInterval(() => void load(), 30_000)
    return () => {
      cancelled = true
      window.clearInterval(t)
    }
  }, [])
  const [animateProgress, setAnimateProgress] = useState<{
    totalShots: number
    shotsDone: number
    percent: number
  } | null>(null)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [currentStage, setCurrentStage] = useState<string | null>(null)
  const [selectedStage, setSelectedStage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const feedRef = useRef<HTMLDivElement>(null)
  // Last scene count we rebuilt the player at — avoids resetting playback on
  // every 5s poll when the scene count hasn't changed.
  const lastSceneCountRef = useRef(0)

  // Pull the pipeline row's authoritative status + current_stage. SSE alone is
  // unreliable for the breadcrumb (events can drop), so we also poll this and
  // refresh it on every stage transition.
  const loadPipeline = useCallback(async () => {
    try {
      const p = await pipelinesApi.get(pipelineId)
      setStatus(p.status)
      // Keep the last real stage — do NOT clobber it with a transient null
      // during a stage handoff / re-drive (the row briefly has no
      // current_stage). Otherwise the tab view bounces back to "Script" on
      // every approval and snaps back a moment later.
      if (p.current_stage) setCurrentStage(p.current_stage)
    } catch {
      /* ignore */
    }
  }, [pipelineId])

  const stop = useCallback(async () => {
    try {
      await pipelinesApi.cancel(pipelineId)
      setStatus("cancelled")
    } catch {
      /* ignore */
    }
  }, [pipelineId])

  const loadTimeline = useCallback(async () => {
    try {
      const timeline = await pipelinesApi.getTimeline(pipelineId)
      // The timeline returns scenes as they finish (partial), so this doubles
      // as the live animate progress count.
      setCompletedScenes(timeline.scenes.length)
      setAnimateProgress(timeline.animateProgress ?? null)
      // Only rebuild the player when a NEW scene lands — rebuilding every poll
      // would reset in-progress playback of the partial film.
      if (
        timeline.scenes.length > 0 &&
        timeline.scenes.length !== lastSceneCountRef.current
      ) {
        lastSceneCountRef.current = timeline.scenes.length
        setSceneGraph(buildSceneGraphFromPipeline(timeline))
        setSceneMedia(
          timeline.scenes.map((s, i) => ({
            url: s.compositeUrl,
            label: `Scene ${i + 1}`,
            kind: "video" as const,
          })),
        )
      }
    } catch {
      /* not assembled yet */
    }
  }, [pipelineId])

  const loadScript = useCallback(async () => {
    try {
      const stage = await pipelinesApi.getStage(pipelineId, "script")
      const parsed = parseScreenplay(stage.output)
      if (parsed) setScreenplay(parsed)
    } catch {
      /* not ready */
    }
  }, [pipelineId])

  // Refresh the gate: which stages await approval + the entity statuses (also
  // backfills entity cards on reload, since SSE only carries live changes).
  const refreshGate = useCallback(async () => {
    // Always (re)load the script — when the script gate opens there's often no
    // distinct stage:status event, so this is the reliable trigger.
    void loadScript()
    try {
      const pa = await pipelinesApi.pendingApprovals(pipelineId)
      setAwaiting(
        pa.map((p) => ({
          stageName: p.stage_name,
          subGate:
            (p.output as { current_sub_gate?: string } | null)?.current_sub_gate ?? null,
        })),
      )
    } catch {
      /* ignore */
    }
    for (const t of ENTITY_TYPES) {
      try {
        const ents = await pipelinesApi.getEntities(pipelineId, t)
        if (ents.length === 0) continue
        setEntities((prev) => {
          const next = { ...prev }
          for (const e of ents) {
            next[e.id] = {
              entityId: e.id,
              entityType: e.entity_type,
              entityKey: e.entity_key,
              status: e.status,
              mainAssetUrl: e.main_asset_url ?? next[e.id]?.mainAssetUrl,
              description:
                (e.metadata?.visual_description as string | undefined) ??
                next[e.id]?.description,
              variants: next[e.id]?.variants ?? [],
            }
          }
          return next
        })
      } catch {
        /* ignore */
      }
    }
  }, [pipelineId, loadScript])

  const act = useCallback(
    (fn: () => Promise<unknown>) => {
      if (acting) return
      setActing(true)
      setActionError(null)
      void fn()
        .catch((e) => setActionError(friendlyActionError(e)))
        .finally(() => {
          setActing(false)
          void refreshGate()
        })
    },
    [acting, refreshGate],
  )

  const actions: GateActions = {
    generate: (eid, description) =>
      act(() =>
        pipelinesApi.approveDescription(
          pipelineId,
          eid,
          description != null && description.trim()
            ? { mode: "user_edited", description }
            : { mode: "llm" },
        ),
      ),
    skip: (eid) => act(() => pipelinesApi.skipEntity(pipelineId, eid)),
    approveEntity: (eid) => act(() => pipelinesApi.approveEntity(pipelineId, eid)),
    rejectEntity: (eid, feedback) =>
      act(() => pipelinesApi.rejectEntity(pipelineId, eid, feedback)),
    // Route to the right backend action: animate Stage-7 sub-gates
    // (dialogue_recheck / silent_cut) need approveSubGate; a plain stage gate
    // (the final cut at post_merge) uses approveStage.
    approveGate: (stageName, subGate) =>
      subGate && stageName === "animate_audio_edit"
        ? act(() => pipelinesApi.approveSubGate(pipelineId, subGate as SubGateName))
        : act(() =>
            pipelinesApi.approveStage(pipelineId, stageName as PipelineStageName),
          ),
    upload: (eid, assetUrl, file) =>
      act(() =>
        pipelinesApi.approveDescription(pipelineId, eid, {
          mode: "upload",
          asset_url: assetUrl,
          filename: file.name,
          mime_type: file.type,
          size_bytes: file.size,
        }),
      ),
    reuse: (eid, assetUrl) =>
      act(() =>
        pipelinesApi.approveDescription(pipelineId, eid, {
          mode: "upload",
          asset_url: assetUrl,
        }),
      ),
  }

  // Initial load.
  useEffect(() => {
    void loadScript()
    void loadTimeline()
    void refreshGate()
    void loadPipeline()
  }, [loadScript, loadTimeline, refreshGate, loadPipeline])

  // Drive off the live SSE stream.
  useEffect(() => {
    if (!lastEvent) return
    const evt = lastEvent
    const line = describeEvent(evt)
    if (line) setLines((prev) => pushLine(prev, evt.type, line))

    if (evt.type === "stage:status") {
      const e = evt as unknown as { stageName?: string; status?: string }
      if (e.stageName && e.status) {
        setStageStatus((prev) => ({ ...prev, [e.stageName as string]: e.status as string }))
      }
      if (e.stageName === "script") void loadScript()
      void refreshGate()
      void loadPipeline()
    } else if (evt.type === "entity:status") {
      const e = evt as unknown as {
        entityId: string
        entityType: string
        entityKey: string
        status: string
        mainAssetUrl?: string
      }
      setEntities((prev) => ({
        ...prev,
        [e.entityId]: {
          entityId: e.entityId,
          entityType: e.entityType,
          entityKey: e.entityKey,
          status: e.status,
          mainAssetUrl: e.mainAssetUrl ?? prev[e.entityId]?.mainAssetUrl,
          description: prev[e.entityId]?.description,
          variants: prev[e.entityId]?.variants ?? [],
        },
      }))
    } else if (evt.type === "entity:variant:added") {
      const e = evt as unknown as { entityId: string; assetUrl: string }
      setEntities((prev) => {
        const cur = prev[e.entityId]
        if (!cur || cur.variants.includes(e.assetUrl)) return prev
        return {
          ...prev,
          [e.entityId]: { ...cur, variants: [...cur.variants, e.assetUrl] },
        }
      })
    }

    if (evt.type === "pipeline:completed") {
      setStatus("completed")
      void loadTimeline()
    } else if (evt.type === "pipeline:status") {
      const s = (evt as unknown as { status?: string }).status
      if (s) setStatus(s)
      if (s === "completed") void loadTimeline()
      else if (s === "failed" || s === "cancelled") setError(`Pipeline ${s}`)
      void refreshGate()
      void loadPipeline()
    }
  }, [lastEvent, loadScript, loadTimeline, refreshGate, loadPipeline])

  // Poll while a run is active so the gate, script, and timeline self-heal even
  // if an SSE frame is dropped. Keep polling THROUGH animate (don't stop on the
  // first assembled scene) so the partial film + per-scene progress keep
  // updating; stop only once the pipeline is terminal or errored.
  useEffect(() => {
    if (error) return
    if (status != null && TERMINAL_STATUSES.includes(status)) return
    const interval = setInterval(() => {
      void loadTimeline()
      void refreshGate()
      void loadPipeline()
    }, 5000)
    return () => clearInterval(interval)
  }, [status, error, loadTimeline, refreshGate, loadPipeline])

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight })
  }, [lines])

  const cards = Object.values(entities)
  const filmMedia = useMemo(
    () => [...buildEntityMedia(entities), ...sceneMedia],
    [entities, sceneMedia],
  )
  const openMedia = useCallback(
    (url: string) => {
      const i = filmMedia.findIndex((m) => m.url === url)
      setLightboxIndex(i >= 0 ? i : null)
    },
    [filmMedia],
  )
  const isTerminal = status != null && TERMINAL_STATUSES.includes(status)
  // Count up while the film hasn't produced a script yet; freeze once it has
  // (or terminates). Lets us flag a film that's queued but not being driven.
  useEffect(() => {
    if (isTerminal || screenplay) return
    const t = window.setInterval(() => setElapsedSec((s) => s + 1), 1000)
    return () => window.clearInterval(t)
  }, [isTerminal, screenplay])
  // "Queued/working but nothing's processing it" — the pipeline worker is most
  // likely down. A pre-start status (queued/pending) should be picked up within
  // a second or two, so a short threshold there; give a running Stage 1 longer.
  const notStarted = status === "queued" || status === "pending" || status == null
  const stuck = !isTerminal && !screenplay && elapsedSec > (notStarted ? 15 : 75)
  // Which stage tab is being viewed — the user's manual pick, else the active
  // stage, else the first stage. `viewEntityType` is set for Cast/Props/Locations.
  const viewStage = selectedStage ?? currentStage ?? "script"
  const viewEntityType = STAGE_ENTITY_TYPE[viewStage]
  // Total scenes (from the script) drives the animate progress bar; completed
  // = scenes whose video composite is ready (from the timeline).
  const totalScenes = screenplay?.scenes.length ?? 0
  const sceneProgressPct =
    totalScenes > 0 ? Math.round((completedScenes / totalScenes) * 100) : 0
  // Is the user being asked to do something ON THE CURRENT STAGE right now? Scope
  // it to currentStage (a stage gate for it, or its entities awaiting) so the
  // banner doesn't say "your turn" while a production stage is just running.
  const currentEntityType = currentStage ? STAGE_ENTITY_TYPE[currentStage] : undefined
  const hasGate =
    (currentStage != null && awaiting.some((a) => a.stageName === currentStage)) ||
    (currentEntityType != null &&
      cards.some(
        (c) =>
          c.entityType === currentEntityType &&
          (c.status === "pending_description" || c.status === "awaiting_approval"),
      ))
  const activity = currentStage
    ? STAGE_ACTIVITY[currentStage] ??
      `Working on ${STAGE_LABELS[currentStage] ?? currentStage}…`
    : "Working…"

  return (
    <div className="flex h-full flex-col">
      <CinemaTopBar
        projectName={pipelineId.slice(0, 8).toUpperCase()}
        autopilot={autopilot}
        onToggleAutopilot={setAutopilot}
        onOpenFlow={() => setFlowOpen(true)}
        credits={credits}
        running={!isTerminal}
        onStop={() => void stop()}
        onNewFilm={() => navigate("/studio")}
      />

      <div className="flex flex-1 overflow-hidden">
        <div ref={feedRef} className="flex-1 overflow-y-auto bg-[#0a0a0a] p-6">
          <StageTracker
            stageStatus={stageStatus}
            awaiting={awaiting.map((a) => a.stageName)}
            currentStage={currentStage}
            selected={viewStage}
            onSelect={(s) =>
              // Clicking the live stage re-enters "follow" mode (track the
              // active stage); any other tab pins to that stage until you click
              // again. No auto-yank, so approvals never bounce your view.
              setSelectedStage(s === currentStage ? null : s)
            }
          />

          {/* Clip selected from the reel — plays here in the main screen. */}
          {selectedClip && (
            <div className="mb-4 overflow-hidden rounded-lg border border-[#1d1d1d] bg-black">
              <div className="flex items-center justify-between border-b border-[#1d1d1d] px-3 py-1.5">
                <span className="font-mono text-[11px] uppercase tracking-wide text-[#ff0073]">
                  ▶ {selectedClip.label}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedClip(null)}
                  className="font-mono text-[10px] text-muted-foreground hover:text-foreground"
                >
                  Close [X]
                </button>
              </div>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                key={selectedClip.url}
                src={selectedClip.url}
                controls
                autoPlay
                className="max-h-[55vh] w-full bg-black"
              />
              <ClipEditor
                pipelineId={pipelineId}
                sceneId={selectedClip.sceneId}
                onRegenerated={(url) =>
                  setSelectedClip((c) => (c ? { ...c, url } : c))
                }
              />
            </div>
          )}

          {/* Global status: what the engine is doing right now, independent of
              which tab is open. When a gate is open on a stage you're not
              viewing, the banner is a button that jumps you there. */}
          {!isTerminal &&
            (hasGate ? (
              viewStage === currentStage ? (
                <div className="mb-4 flex items-center gap-3 rounded-md border bg-card px-3 py-2.5 text-sm">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#ff0073]" />
                  <span className="text-foreground">Your turn — review and choose below.</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setSelectedStage(null)}
                  className="mb-4 flex w-full items-center gap-3 rounded-md border border-[#ff0073]/40 bg-[#ff0073]/5 px-3 py-2.5 text-left text-sm hover:bg-[#ff0073]/10"
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#ff0073]" />
                  <span className="text-foreground">
                    Your turn on{" "}
                    {STAGE_LABELS[currentStage ?? ""] ?? "the current step"} — click to open.
                  </span>
                </button>
              )
            ) : stuck ? (
              <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
                <p className="font-medium text-amber-300">
                  This film isn't being processed.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  It's {notStarted ? "queued, but nothing has picked it up" : "running, but stalled"}{" "}
                  for {elapsedSec}s. The Story→Video engine is driven by a background
                  worker — if it's not running, films sit here forever. Check that the
                  backend has <code className="text-foreground">EDITION=cloud</code> and
                  Redis up, then start the pipeline worker:
                </p>
                <pre className="mt-1.5 overflow-x-auto rounded bg-background p-1.5 text-[10px] text-foreground">
npm run pipeline-worker:dev
                </pre>
              </div>
            ) : (
              <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-card px-3 py-2.5 text-sm">
                <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[#ff0073] border-t-transparent" />
                <span className="text-foreground">{activity}</span>
                <span className="text-xs text-muted-foreground">
                  You'll be asked to review as soon as it's ready — nothing to do right now.
                </span>
              </div>
            ))}

          {actionError && (
            <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">
              {actionError}
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">
              The film run did not finish: {error}
            </div>
          )}

          {/* Gate for the viewed tab only. */}
          {!isTerminal && (
            <GatePanel
              cards={cards}
              awaiting={awaiting}
              acting={acting}
              scriptReady={!!screenplay}
              actions={actions}
              onOpenMedia={openMedia}
              viewStage={viewStage}
            />
          )}

          {/* ── Tab content ─────────────────────────────────────────────── */}
          {viewStage === "script" &&
            (screenplay ? (
              <ScriptView
                screenplay={screenplay}
                acting={acting}
                onApplyEdits={(patches) =>
                  act(() => pipelinesApi.applyEdits(pipelineId, "script", patches))
                }
                onRedoScene={(index, fb) =>
                  act(() =>
                    pipelinesApi.regenerateScene(pipelineId, index, fb || "Improve this scene"),
                  )
                }
                onRegenerate={(fb) =>
                  act(() =>
                    pipelinesApi.rejectStage(pipelineId, "script", fb || "Regenerate the script"),
                  )
                }
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                The script will appear here once it's drafted.
              </p>
            ))}

          {viewEntityType &&
            (() => {
              const group = cards.filter((c) => c.entityType === viewEntityType)
              if (group.length === 0) {
                return (
                  <p className="text-sm text-muted-foreground">
                    {STAGE_LABELS[viewStage]} will appear here as they're made.
                  </p>
                )
              }
              return (
                <div className="flex flex-wrap gap-3">
                  {group.map((c) => (
                    <EntityImage key={c.entityId} card={c} onOpenMedia={openMedia} />
                  ))}
                </div>
              )
            })()}

          {viewStage === "shot_list" && <ComposerSpec pipelineId={pipelineId} />}

          {FILM_STAGES.has(viewStage) && (
            <div className="max-w-3xl space-y-3">
              {!isTerminal && animateProgress && animateProgress.totalShots > 0 ? (
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Animating shots…</span>
                    <span className="tabular-nums">
                      {animateProgress.shotsDone} / {animateProgress.totalShots} shots (
                      {animateProgress.percent}%)
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--border-primary)]">
                    <div
                      className="h-full bg-[#ff0073] transition-[width] duration-500"
                      style={{ width: `${animateProgress.percent}%` }}
                    />
                  </div>
                </div>
              ) : totalScenes > 0 && !isTerminal ? (
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Rendering scenes…</span>
                    <span className="tabular-nums">
                      {completedScenes} / {totalScenes} ready ({sceneProgressPct}%)
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--border-primary)]">
                    <div
                      className="h-full bg-[#ff0073] transition-[width] duration-500"
                      style={{ width: `${sceneProgressPct}%` }}
                    />
                  </div>
                </div>
              ) : null}
              {sceneGraph ? (
                <SceneGraphPlayerPreview sceneGraph={sceneGraph} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  The first scene will play here the moment it's rendered — you don't
                  have to wait for the whole film.
                </p>
              )}
            </div>
          )}
        </div>
        <AiDirectorPanel
          pipelineId={pipelineId}
          lines={lines}
          running={connected && !isTerminal}
          expanded={autopilot}
        />
      </div>

      <ReelPipeline
        pipelineId={pipelineId}
        onPlayClip={(url, label, sceneId) => setSelectedClip({ url, label, sceneId })}
      />

      {flowOpen && (
        <FlowGraphModal
          projectName={pipelineId.slice(0, 8).toUpperCase()}
          stems={(screenplay?.cast ?? []).map((c) => ({
            name: c.name,
            kind: "cast" as const,
            desc: c.description,
          }))}
          onClose={() => setFlowOpen(false)}
        />
      )}

      {lightboxIndex != null && filmMedia.length > 0 && (
        <Lightbox
          media={filmMedia}
          index={Math.min(lightboxIndex, filmMedia.length - 1)}
          onClose={() => setLightboxIndex(null)}
          onIndex={setLightboxIndex}
        />
      )}
    </div>
  )
}

export default function StudioPage() {
  const params = useParams<{ pipelineId?: string }>()
  const navigate = useNavigate()
  const pipelineId = params.pipelineId

  if (!pipelineId) {
    return <StudioPrompt onOpen={(id) => navigate(`/studio/${id}`)} />
  }
  return <StudioSession pipelineId={pipelineId} />
}
