import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import type { PipelineEvent } from "@nodaro/shared"
import { pipelinesApi, type PipelineRecord } from "@/lib/pipelines-api"
import { usePipelineEvents } from "@/hooks/use-pipeline-events"
import { buildSceneGraphFromPipeline } from "@remotion-pkg/lib/build-scene-graph-from-pipeline"
import type { SceneGraph } from "@remotion-pkg/scene-graph"
import { SceneGraphPlayerPreview } from "@/components/editor/scene-graph-player-preview"

/**
 * Phase 0/0.1 — the standalone "studio" tracer.
 *
 * prompt -> start an Auto Story->Video pipeline -> artifacts appear live as the
 * engine produces them: a STAGE TRACKER (where you are / what's next), the
 * SCRIPT rendered as a readable screenplay (never raw JSON), cast/location/prop
 * portraits, and the scene timeline. Interactive per-stage controls
 * (approve/skip/edit) are the next build. See
 * specs/features/story-to-video-rebuild-north-star.md.
 */

type NarrationLine = { type: string; text: string }

interface EntityCard {
  entityId: string
  entityType: string
  entityKey: string
  status: string
  mainAssetUrl?: string
  variants: string[]
}

const ENTITY_GROUPS: ReadonlyArray<{ type: string; label: string }> = [
  { type: "character", label: "Cast" },
  { type: "location", label: "Locations" },
  { type: "object", label: "Props" },
]

// Readable stage tracker — the 8-stage engine topology with friendly labels.
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

const TERMINAL_STATUSES = ["completed", "failed", "cancelled"]

function describeEvent(evt: PipelineEvent): string | null {
  const r = evt as unknown as Record<string, unknown>
  const v = (k: string) => (r[k] == null ? "" : String(r[k]))
  switch (evt.type as string) {
    case "pipeline:status":
      return `Pipeline ${v("status")}`
    case "stage:status":
      return `${STAGE_LABELS[v("stageName")] ?? v("stageName")} ${v("status")}`
    case "stage:progress":
      // Drop the noisy "(2.8 KB so far)" byte counter — keep just the phase.
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
    case "pipeline:music_ready":
      return "Music ready"
    case "pipeline:completed":
      return "Film complete"
    default:
      return null
  }
}

function pushLine(prev: NarrationLine[], type: string, text: string): NarrationLine[] {
  const last = prev[prev.length - 1]
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

// Parse the script-stage output (ShowrunnerPlan) into a readable screenplay.
// Returns null (NOT a JSON dump) when the shape is unrecognised.
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
      const { id } = await pipelinesApi.create({
        pipeline_type: "story_to_video",
        root_node_id: crypto.randomUUID(),
        story_prompt: story,
        target_duration_seconds: 15,
        format: "reel",
        output_resolution: "720p",
        language: "en",
        mode: "auto",
        video_critic_frame_count: "first_last",
        config: {
          music_enabled: true,
          narration_enabled: false,
          lipsync_enabled: false,
        },
      })
      onOpen(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start the film")
      setBusy(false)
    }
  }, [prompt, busy, onOpen])

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 overflow-y-auto p-8">
      <div className="w-full max-w-xl">
        <h1 className="mb-2 text-lg font-medium text-foreground">
          Nodaro Cinema — Studio
        </h1>
        <p className="mb-4 text-sm text-muted-foreground">
          Type a prompt; the director builds a short film and the script, cast,
          and scenes appear here as they're created.
        </p>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={PROMPT_PLACEHOLDER}
          rows={3}
          className="w-full resize-none rounded-md border bg-card p-3 text-sm text-foreground outline-none focus:border-[#ff0073]"
        />
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

function StageTracker({ stageStatus }: { stageStatus: Record<string, string> }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-1.5">
      {STAGE_ORDER.map((s) => {
        const st = stageStatus[s]
        const done = st === "approved"
        const active = st === "running" || st === "awaiting_approval"
        const cls = done
          ? "border-green-500/50 bg-green-500/10 text-green-400"
          : active
            ? "border-[#ff0073] bg-[#ff0073]/10 text-[#ff0073]"
            : "border-[var(--border-primary)] text-muted-foreground"
        return (
          <span
            key={s}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${cls}`}
          >
            {STAGE_LABELS[s]}
          </span>
        )
      })}
    </div>
  )
}

function EntityImage({ card }: { card: EntityCard }) {
  return (
    <div className="w-32 shrink-0">
      <div className="aspect-square w-full overflow-hidden rounded-md border bg-card">
        {card.mainAssetUrl ? (
          <img
            src={card.mainAssetUrl}
            alt={card.entityKey}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
            {card.status === "failed" ? "failed" : "generating…"}
          </div>
        )}
      </div>
      <div className="mt-1 truncate text-xs text-foreground" title={card.entityKey}>
        {card.entityKey}
      </div>
      {card.variants.length > 0 && (
        <div className="mt-1 flex gap-1 overflow-x-auto">
          {card.variants.slice(0, 6).map((url, i) => (
            <img
              key={i}
              src={url}
              alt=""
              className="h-8 w-8 shrink-0 rounded border object-cover"
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ScriptView({ screenplay }: { screenplay: Screenplay }) {
  return (
    <div className="max-w-3xl space-y-4 rounded-md border bg-card p-4 text-sm leading-relaxed text-foreground">
      {screenplay.cast.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Cast
          </div>
          <ul className="space-y-0.5">
            {screenplay.cast.map((c, i) => (
              <li key={i}>
                <span className="font-medium">{c.name}</span>
                {c.role && (
                  <span className="text-muted-foreground"> · {c.role}</span>
                )}
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
          <div className="text-xs font-medium uppercase tracking-wide text-[#ff0073]">
            {sc.heading}
          </div>
          {sc.description && <p className="mt-1">{sc.description}</p>}
          {sc.narration && (
            <p className="mt-1 italic text-muted-foreground">
              Narration: {sc.narration}
            </p>
          )}
          {sc.dialogue.map((d, j) => (
            <p key={j} className="mt-1">
              <span className="font-medium uppercase">{d.who}:</span> {d.line}
            </p>
          ))}
        </div>
      ))}
    </div>
  )
}

function StudioSession({ pipelineId }: { pipelineId: string }) {
  const { lastEvent, connected } = usePipelineEvents(pipelineId)
  const navigate = useNavigate()
  const [lines, setLines] = useState<NarrationLine[]>([])
  const [entities, setEntities] = useState<Record<string, EntityCard>>({})
  const [stageStatus, setStageStatus] = useState<Record<string, string>>({})
  const [screenplay, setScreenplay] = useState<Screenplay | null>(null)
  const [sceneGraph, setSceneGraph] = useState<SceneGraph | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const feedRef = useRef<HTMLDivElement>(null)

  const stop = useCallback(async () => {
    try {
      await pipelinesApi.cancel(pipelineId)
      setStatus("cancelled")
    } catch {
      // ignore
    }
  }, [pipelineId])

  const loadTimeline = useCallback(async () => {
    try {
      const timeline = await pipelinesApi.getTimeline(pipelineId)
      if (timeline.scenes.length > 0) {
        setSceneGraph(buildSceneGraphFromPipeline(timeline))
      }
    } catch {
      // not assembled yet
    }
  }, [pipelineId])

  const loadScript = useCallback(async () => {
    try {
      const stage = await pipelinesApi.getStage(pipelineId, "script")
      const parsed = parseScreenplay(stage.output)
      if (parsed) setScreenplay(parsed)
    } catch {
      // not ready yet
    }
  }, [pipelineId])

  useEffect(() => {
    void loadScript()
    void loadTimeline()
    pipelinesApi
      .get(pipelineId)
      .then((p) => setStatus(p.status))
      .catch(() => {})
  }, [loadScript, loadTimeline, pipelineId])

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
    }
  }, [lastEvent, loadScript, loadTimeline])

  useEffect(() => {
    if (sceneGraph || error) return
    const interval = setInterval(() => {
      void loadTimeline()
    }, 5000)
    return () => clearInterval(interval)
  }, [sceneGraph, error, loadTimeline])

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight })
  }, [lines])

  const cards = Object.values(entities)
  const isTerminal = status != null && TERMINAL_STATUSES.includes(status)
  const hasArtifacts = screenplay || cards.length > 0 || sceneGraph

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-foreground">Nodaro Cinema</span>
          {status && <span className="text-xs text-muted-foreground">{status}</span>}
        </div>
        <div className="flex items-center gap-2">
          {status && !isTerminal && (
            <button
              type="button"
              onClick={() => void stop()}
              className="rounded-md border px-3 py-1 text-xs text-foreground hover:border-red-500 hover:text-red-400"
            >
              Stop
            </button>
          )}
          <button
            type="button"
            onClick={() => navigate("/studio")}
            className="rounded-md bg-[#ff0073] px-3 py-1 text-xs font-medium text-white"
          >
            New film
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Narration log */}
        <div className="flex w-[300px] shrink-0 flex-col border-r">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <span className="text-sm font-medium text-foreground">AI Director</span>
            <span
              className={
                connected
                  ? "text-xs text-green-400"
                  : "text-xs text-muted-foreground"
              }
            >
              {connected ? "live" : "connecting…"}
            </span>
          </div>
          <div
            ref={feedRef}
            className="flex-1 space-y-1 overflow-y-auto p-3 text-xs"
          >
            {lines.length === 0 ? (
              <p className="text-muted-foreground">Starting your film…</p>
            ) : (
              lines.map((l, i) => (
                <p key={i} className="text-foreground">
                  {l.text}
                </p>
              ))
            )}
          </div>
        </div>

        {/* Artifacts */}
        <div className="flex-1 overflow-y-auto p-6">
          <StageTracker stageStatus={stageStatus} />

          {error && (
            <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">
              The film run did not finish: {error}
            </div>
          )}

          {!hasArtifacts && !error && (
            <p className="text-sm text-muted-foreground">
              Working… the script, cast, and scenes will appear here as they're made.
            </p>
          )}

          {sceneGraph && (
            <section className="mb-8">
              <h2 className="mb-2 text-sm font-medium text-foreground">Film</h2>
              <div className="max-w-3xl">
                <SceneGraphPlayerPreview sceneGraph={sceneGraph} />
              </div>
            </section>
          )}

          {screenplay && (
            <section className="mb-8">
              <h2 className="mb-2 text-sm font-medium text-foreground">Script</h2>
              <ScriptView screenplay={screenplay} />
            </section>
          )}

          {ENTITY_GROUPS.map(({ type, label }) => {
            const group = cards.filter((c) => c.entityType === type)
            if (group.length === 0) return null
            return (
              <section key={type} className="mb-8">
                <h2 className="mb-2 text-sm font-medium text-foreground">{label}</h2>
                <div className="flex flex-wrap gap-3">
                  {group.map((c) => (
                    <EntityImage key={c.entityId} card={c} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      </div>
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
