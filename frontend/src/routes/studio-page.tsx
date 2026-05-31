import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import type { PipelineEvent } from "@nodaro/shared"
import { pipelinesApi } from "@/lib/pipelines-api"
import { usePipelineEvents } from "@/hooks/use-pipeline-events"
import { buildSceneGraphFromPipeline } from "@remotion-pkg/lib/build-scene-graph-from-pipeline"
import type { SceneGraph } from "@remotion-pkg/scene-graph"
import { SceneGraphPlayerPreview } from "@/components/editor/scene-graph-player-preview"

/**
 * Phase 0 walking skeleton — the standalone "studio" tracer.
 *
 * prompt -> start an Auto Story->Video pipeline -> stream live narration from
 * the pipeline SSE -> render the assembled scenes on an embedded Remotion
 * timeline when the run completes. No conversational agent yet (Phase 2); the
 * engine self-drives in Auto. See specs/features/story-to-video-rebuild-north-star.md (Phase 0).
 */

function describeEvent(evt: PipelineEvent): string | null {
  const r = evt as unknown as Record<string, unknown>
  const v = (k: string) => (r[k] == null ? "" : String(r[k]))
  // Cast to string so a not-yet-known event type never trips the literal switch.
  switch (evt.type as string) {
    case "pipeline:status":
      return `Pipeline ${v("status")}`
    case "stage:status":
      return `${v("stageName")} -> ${v("status")}`
    case "stage:progress":
      return v("message") || `Working on ${v("stageName")}...`
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

const PROMPT_PLACEHOLDER =
  'Describe your film — e.g. "A lighthouse keeper watches the sunrise"'

function StudioPrompt({ onStarted }: { onStarted: (id: string) => void }) {
  const [prompt, setPrompt] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = useCallback(async () => {
    const story = prompt.trim()
    if (!story || busy) return
    setBusy(true)
    setError(null)
    try {
      const { id } = await pipelinesApi.create({
        pipeline_type: "story_to_video",
        // Phase 0: no canvas node — the studio reads pipeline entities directly.
        // A synthetic id satisfies the schema; canvas-node materialization is a
        // no-op in Auto when no node rows exist. (Revisit if the engine needs a
        // real node — easy to swap for a created workflow/node.)
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
      onStarted(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start the film")
      setBusy(false)
    }
  }, [prompt, busy, onStarted])

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
      <div className="w-full max-w-xl">
        <h1 className="mb-2 text-lg font-medium text-foreground">
          Nodaro Cinema — Studio
        </h1>
        <p className="mb-4 text-sm text-muted-foreground">
          Type a prompt; the director builds a short film automatically and it
          plays on the timeline when ready.
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
    </div>
  )
}

function StudioSession({ pipelineId }: { pipelineId: string }) {
  const { lastEvent, connected } = usePipelineEvents(pipelineId)
  const [lines, setLines] = useState<string[]>([])
  const [sceneGraph, setSceneGraph] = useState<SceneGraph | null>(null)
  const [error, setError] = useState<string | null>(null)
  const feedRef = useRef<HTMLDivElement>(null)

  const loadTimeline = useCallback(async () => {
    try {
      const timeline = await pipelinesApi.getTimeline(pipelineId)
      if (timeline.scenes.length > 0) {
        setSceneGraph(buildSceneGraphFromPipeline(timeline))
      }
    } catch {
      // Timeline not assembled yet — ignore until the next completion signal.
    }
  }, [pipelineId])

  // Initial attempt — handles landing here after the pipeline already finished.
  useEffect(() => {
    void loadTimeline()
  }, [loadTimeline])

  // Accumulate narration + (re)load the timeline on completion.
  useEffect(() => {
    if (!lastEvent) return
    const line = describeEvent(lastEvent)
    if (line) setLines((prev) => [...prev, line])
    const meta = lastEvent as unknown as {
      status?: string
      failureReason?: string
      message?: string
    }
    if (lastEvent.type === "pipeline:completed" || meta.status === "completed") {
      void loadTimeline()
    } else if (meta.status === "failed" || meta.status === "cancelled") {
      setError(meta.failureReason || meta.message || `Pipeline ${meta.status}`)
    }
  }, [lastEvent, loadTimeline])

  // Polling fallback — self-heal if the terminal SSE frame is missed (a drop
  // across the completion event). Stops once the timeline is built or errored.
  useEffect(() => {
    if (sceneGraph || error) return
    const interval = setInterval(() => {
      void loadTimeline()
    }, 5000)
    return () => clearInterval(interval)
  }, [sceneGraph, error, loadTimeline])

  // Keep the feed scrolled to the latest line.
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight })
  }, [lines])

  return (
    <div className="flex h-full">
      <div className="flex w-[380px] shrink-0 flex-col border-r">
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
        <div
          ref={feedRef}
          className="flex-1 space-y-1 overflow-y-auto p-3 text-xs"
        >
          {lines.length === 0 ? (
            <p className="text-muted-foreground">Starting your film…</p>
          ) : (
            lines.map((line, i) => (
              <p key={i} className="text-foreground">
                {line}
              </p>
            ))
          )}
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center p-6">
        {sceneGraph ? (
          <div className="w-full max-w-3xl">
            <SceneGraphPlayerPreview sceneGraph={sceneGraph} />
          </div>
        ) : error ? (
          <div className="text-center text-sm text-red-400">
            <p>The film run did not finish.</p>
            <p className="mt-1 text-xs">{error}</p>
          </div>
        ) : (
          <div className="text-center text-sm text-muted-foreground">
            <p>Building your film…</p>
            <p className="mt-1 text-xs">
              The timeline appears here once the scenes are ready.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default function StudioPage() {
  const params = useParams<{ pipelineId?: string }>()
  const navigate = useNavigate()
  const pipelineId = params.pipelineId

  if (!pipelineId) {
    return <StudioPrompt onStarted={(id) => navigate(`/studio/${id}`)} />
  }
  return <StudioSession pipelineId={pipelineId} />
}
