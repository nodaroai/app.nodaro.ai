import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import type { PipelineEvent, PipelineStageName } from "@nodaro/shared"
import { pipelinesApi, type PipelineRecord } from "@/lib/pipelines-api"
import { usePipelineEvents } from "@/hooks/use-pipeline-events"
import { buildSceneGraphFromPipeline } from "@remotion-pkg/lib/build-scene-graph-from-pipeline"
import type { SceneGraph } from "@remotion-pkg/scene-graph"
import { SceneGraphPlayerPreview } from "@/components/editor/scene-graph-player-preview"

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
        // Checkpointed: pause at each stage so the user controls before spending.
        mode: "manual",
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
}: {
  stageStatus: Record<string, string>
  awaiting: string[]
}) {
  // "You are here" = the first stage that's awaiting or running.
  const currentIdx = STAGE_ORDER.findIndex(
    (s) =>
      awaiting.includes(s) ||
      stageStatus[s] === "running" ||
      stageStatus[s] === "awaiting_approval",
  )
  return (
    <div className="mb-6 flex flex-wrap items-center gap-1.5">
      {STAGE_ORDER.map((s, i) => {
        const isCurrent = i === currentIdx
        const done =
          stageStatus[s] === "approved" || (currentIdx >= 0 && i < currentIdx)
        const cls = isCurrent
          ? "border-[#ff0073] bg-[#ff0073] text-white"
          : done
            ? "border-green-500/50 bg-green-500/10 text-green-400"
            : "border-[var(--border-primary)] text-muted-foreground"
        return (
          <span
            key={s}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${cls}`}
          >
            {isCurrent ? "▶ " : ""}
            {STAGE_LABELS[s]}
          </span>
        )
      })}
    </div>
  )
}

interface GateActions {
  generate: (entityId: string, description?: string) => void
  skip: (entityId: string) => void
  approveEntity: (entityId: string) => void
  rejectEntity: (entityId: string) => void
  approveStage: (stage: string) => void
}

function EntityDescGate({
  card,
  acting,
  onGenerate,
  onSkip,
}: {
  card: EntityCard
  acting: boolean
  onGenerate: (entityId: string, description?: string) => void
  onSkip: (entityId: string) => void
}) {
  const [desc, setDesc] = useState(card.description ?? "")
  // The description arrives via getEntities (not SSE) — fill it in once it lands.
  useEffect(() => {
    if (card.description && !desc) setDesc(card.description)
  }, [card.description, desc])
  const edited = card.description != null && desc !== card.description
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
            disabled={acting}
            onClick={() => onGenerate(card.entityId, edited ? desc : undefined)}
            className="rounded-md bg-[#ff0073] px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            Generate
          </button>
          <button
            type="button"
            disabled={acting}
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
    </div>
  )
}

function GatePanel({
  cards,
  awaiting,
  acting,
  scriptReady,
  actions,
}: {
  cards: EntityCard[]
  awaiting: string[]
  acting: boolean
  scriptReady: boolean
  actions: GateActions
}) {
  const pendingDesc = cards.filter((c) => c.status === "pending_description")
  const awaitingImage = cards.filter((c) => c.status === "awaiting_approval")
  // Stage-level gates (script, shots, scenes, finish, variant batches).
  const stageGates = awaiting
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
              />
            ))}
          </div>
        </div>
      )}

      {awaitingImage.length > 0 && (
        <div className="mb-3">
          <div className="mb-1 text-xs text-muted-foreground">Review generated:</div>
          <div className="space-y-1">
            {awaitingImage.map((c) => (
              <div
                key={c.entityId}
                className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-1.5 text-sm"
              >
                <span className="flex items-center gap-2">
                  {c.mainAssetUrl && (
                    <img
                      src={c.mainAssetUrl}
                      alt=""
                      className="h-8 w-8 rounded object-cover"
                    />
                  )}
                  <span className="truncate text-foreground">{c.entityKey}</span>
                </span>
                <span className="flex shrink-0 gap-2">
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
                    disabled={acting}
                    onClick={() => actions.rejectEntity(c.entityId)}
                    className={`${btn} border text-foreground`}
                  >
                    Redo
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {stageGates.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {stageGates.map((s) =>
            s === "script" && !scriptReady ? (
              <span key={s} className="text-xs text-muted-foreground">
                Loading script…
              </span>
            ) : (
              <button
                key={s}
                type="button"
                disabled={acting}
                onClick={() => actions.approveStage(s)}
                className={`${btn} bg-[#ff0073] text-white`}
              >
                Approve {STAGE_LABELS[s] ?? s} & continue
              </button>
            ),
          )}
        </div>
      )}
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

function StudioSession({ pipelineId }: { pipelineId: string }) {
  const { lastEvent, connected } = usePipelineEvents(pipelineId)
  const navigate = useNavigate()
  const [lines, setLines] = useState<NarrationLine[]>([])
  const [entities, setEntities] = useState<Record<string, EntityCard>>({})
  const [stageStatus, setStageStatus] = useState<Record<string, string>>({})
  const [awaiting, setAwaiting] = useState<string[]>([])
  const [acting, setActing] = useState(false)
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
      /* ignore */
    }
  }, [pipelineId])

  const loadTimeline = useCallback(async () => {
    try {
      const timeline = await pipelinesApi.getTimeline(pipelineId)
      if (timeline.scenes.length > 0) {
        setSceneGraph(buildSceneGraphFromPipeline(timeline))
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
      setAwaiting(pa.map((p) => p.stage_name))
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
      void fn()
        .catch(() => {})
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
    rejectEntity: (eid) => act(() => pipelinesApi.rejectEntity(pipelineId, eid, "")),
    approveStage: (s) =>
      act(() => pipelinesApi.approveStage(pipelineId, s as PipelineStageName)),
  }

  // Initial load.
  useEffect(() => {
    void loadScript()
    void loadTimeline()
    void refreshGate()
    pipelinesApi
      .get(pipelineId)
      .then((p) => setStatus(p.status))
      .catch(() => {})
  }, [loadScript, loadTimeline, refreshGate, pipelineId])

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
    }
  }, [lastEvent, loadScript, loadTimeline, refreshGate])

  // Poll while a run is active so the gate, script, and timeline self-heal even
  // if an SSE frame is dropped. Stops once the film is assembled or errored.
  useEffect(() => {
    if (sceneGraph || error) return
    const interval = setInterval(() => {
      void loadTimeline()
      void refreshGate()
    }, 5000)
    return () => clearInterval(interval)
  }, [sceneGraph, error, loadTimeline, refreshGate])

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight })
  }, [lines])

  const cards = Object.values(entities)
  const isTerminal = status != null && TERMINAL_STATUSES.includes(status)
  const hasArtifacts = screenplay || cards.length > 0 || sceneGraph

  return (
    <div className="flex h-full flex-col">
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
        <div className="flex w-[300px] shrink-0 flex-col border-r">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <span className="text-sm font-medium text-foreground">AI Director</span>
            <span
              className={
                connected ? "text-xs text-green-400" : "text-xs text-muted-foreground"
              }
            >
              {connected ? "live" : "connecting…"}
            </span>
          </div>
          <div ref={feedRef} className="flex-1 space-y-1 overflow-y-auto p-3 text-xs">
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

        <div className="flex-1 overflow-y-auto p-6">
          <StageTracker stageStatus={stageStatus} awaiting={awaiting} />

          {!isTerminal && (
            <GatePanel
              cards={cards}
              awaiting={awaiting}
              acting={acting}
              scriptReady={!!screenplay}
              actions={actions}
            />
          )}

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
              <ScriptView
                screenplay={screenplay}
                acting={acting}
                onApplyEdits={(patches) =>
                  act(() => pipelinesApi.applyEdits(pipelineId, "script", patches))
                }
                onRedoScene={(index, fb) =>
                  act(() =>
                    pipelinesApi.regenerateScene(
                      pipelineId,
                      index,
                      fb || "Improve this scene",
                    ),
                  )
                }
                onRegenerate={(fb) =>
                  act(() =>
                    pipelinesApi.rejectStage(
                      pipelineId,
                      "script",
                      fb || "Regenerate the script",
                    ),
                  )
                }
              />
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
