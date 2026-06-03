import { useEffect, useMemo, useState } from "react"
import { pipelinesApi } from "@/lib/pipelines-api"

/**
 * Phase 3 cinematic — REEL COMPILATION PIPELINE (mockup screens 2/8/9).
 *
 * Two views of the film's scenes: SHOTS FEED (storyboard cards with status +
 * per-scene "Look") and TIMELINE LANES (video/sound/foley lanes with a
 * playhead + timecode). Reads scene entities from the pipeline; status maps
 * pending→DRAFT, generating→GENERATING, approved/completed→READY.
 */

interface SceneNodeDataView {
  scene_id?: string
  description?: string
  video_model?: string
  image_model?: string
  shots?: Array<{
    duration_seconds?: number
    keyframe_url?: string | null
    video_url?: string | null
  }>
  composite_video_url?: string
}
interface SceneEntity {
  id: string
  entity_key: string
  status: string
  main_asset_url?: string | null
  metadata?: { scene_node_data?: SceneNodeDataView } | null
}

interface ReelScene {
  id: string
  n: number
  title: string
  look: string
  seconds: number
  statusKind: StatusKind
  statusLabel: string
  thumb: string | null
  /** Playable clip: the scene composite, or the first animated shot's clip. */
  video: string | null
}

type StatusKind = "ready" | "rendering" | "queued" | "draft"

const STATUS_COLOR: Record<StatusKind, string> = {
  ready: "text-emerald-400",
  rendering: "text-[#ff0073]",
  queued: "text-amber-400",
  draft: "text-muted-foreground",
}

/**
 * Status reflects the CLIP, not the plan: a scene is READY only when its video
 * has rendered (composite, or every shot animated). While shots are still
 * animating it's RENDERING (with the shots-done count); keyframes-ready but not
 * yet animating is QUEUED; still drafting keyframes is GENERATING.
 */
function deriveStatus(
  d: SceneNodeDataView | undefined,
  entityStatus: string,
): { kind: StatusKind; label: string } {
  const shots = d?.shots ?? []
  const total = shots.length
  const withVid = shots.filter((s) => s.video_url).length
  const hasClip = !!d?.composite_video_url || (total > 0 && withVid === total)
  if (hasClip) return { kind: "ready", label: "READY" }
  if (withVid > 0) return { kind: "rendering", label: `RENDERING ${withVid}/${total}` }
  if (entityStatus === "approved" || entityStatus === "completed")
    return { kind: "queued", label: "QUEUED" }
  if (entityStatus === "generating" || entityStatus === "awaiting_approval")
    return { kind: "rendering", label: "GENERATING" }
  return { kind: "draft", label: "DRAFT" }
}

export function ReelPipeline({ pipelineId }: { pipelineId: string }) {
  const [scenes, setScenes] = useState<SceneEntity[] | null>(null)
  const [view, setView] = useState<"feed" | "timeline">("feed")
  const [playing, setPlaying] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      pipelinesApi
        .getEntities(pipelineId, "scene")
        .then((rows) => {
          if (!cancelled) setScenes(rows as unknown as SceneEntity[])
        })
        .catch(() => {})
    void load()
    const t = window.setInterval(load, 5000)
    return () => {
      cancelled = true
      window.clearInterval(t)
    }
  }, [pipelineId])

  const reel = useMemo<ReelScene[]>(() => {
    return (scenes ?? []).map((s, i) => {
      const d = s.metadata?.scene_node_data
      const seconds = (d?.shots ?? []).reduce(
        (sum, sh) => sum + (sh.duration_seconds ?? 0),
        0,
      )
      const video =
        d?.composite_video_url ??
        d?.shots?.find((sh) => sh.video_url)?.video_url ??
        null
      const st = deriveStatus(d, s.status)
      return {
        id: s.id,
        n: i + 1,
        title: d?.description?.slice(0, 22) || s.entity_key,
        look: d?.video_model ?? "—",
        seconds: Math.round(seconds) || 6,
        statusKind: st.kind,
        statusLabel: st.label,
        thumb: d?.shots?.[0]?.keyframe_url ?? s.main_asset_url ?? null,
        video,
      }
    })
  }, [scenes])

  const totalSeconds = reel.reduce((s, r) => s + r.seconds, 0)

  return (
    <div className="border-t border-[#1d1d1d] bg-[#0a0a0a] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.15em] text-[#ff0073]">
            Reel Compilation Pipeline
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {reel.length} scenes totalize {totalSeconds} seconds runtime
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            View:
          </span>
          {(["feed", "timeline"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-md px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider ${
                view === v
                  ? "bg-[#ff0073] text-white"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {v === "feed" ? "▦ Shots Feed" : "≋ Timeline Lanes"}
            </button>
          ))}
        </div>
      </div>

      {view === "feed" ? (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {reel.map((r) => (
            <div
              key={r.id}
              className="w-44 shrink-0 overflow-hidden rounded-md border border-[#2a2a2a] bg-[#111]"
            >
              <button
                type="button"
                onClick={() => r.video && setPlaying(r.video)}
                disabled={!r.video}
                title={r.video ? "Play clip" : "Clip not rendered yet"}
                className="group/clip relative block h-24 w-full bg-black"
              >
                {r.thumb ? (
                  <img src={r.thumb} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center font-mono text-[9px] text-muted-foreground">
                    SH {String(r.n).padStart(2, "0")}
                  </span>
                )}
                {r.video && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover/clip:opacity-100">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#ff0073] text-white">
                      ▶
                    </span>
                  </span>
                )}
                <span className="absolute left-1 top-1 rounded bg-black/70 px-1 font-mono text-[8px] text-foreground">
                  SH {String(r.n).padStart(2, "0")}
                </span>
                <span className="absolute right-1 top-1 rounded bg-black/70 px-1 font-mono text-[8px] text-foreground">
                  {r.video ? "▶ " : ""}
                  {r.seconds}s
                </span>
              </button>
              <div className="p-2">
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-[11px] font-semibold text-foreground">
                    {r.title}
                  </span>
                  <span className={`font-mono text-[8px] font-bold ${STATUS_COLOR[r.statusKind]}`}>
                    {r.statusLabel}
                  </span>
                </div>
                <div className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground">
                  Look: {r.look}
                </div>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="flex w-44 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-[#2a2a2a] py-6 text-muted-foreground hover:border-[#ff0073]/50"
          >
            <span className="text-lg">+</span>
            <span className="font-mono text-[10px] uppercase tracking-wider">Add Scene Slot</span>
            <span className="font-mono text-[8px]">Pin new storyboard specs</span>
          </button>
        </div>
      ) : (
        <TimelineLanes reel={reel} totalSeconds={totalSeconds} />
      )}

      {playing && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 p-8"
          onClick={() => setPlaying(null)}
        >
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            src={playing}
            controls
            autoPlay
            className="max-h-[85vh] max-w-[90vw] rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setPlaying(null)}
            className="absolute right-6 top-6 rounded-md bg-[#ff0073] px-3 py-1 font-mono text-[11px] font-bold uppercase text-white"
          >
            Close [X]
          </button>
        </div>
      )}
    </div>
  )
}

function TimelineLanes({
  reel,
  totalSeconds,
}: {
  reel: ReelScene[]
  totalSeconds: number
}) {
  const total = Math.max(1, totalSeconds)
  let cursor = 0
  const blocks = reel.map((r) => {
    const left = (cursor / total) * 100
    const width = (r.seconds / total) * 100
    cursor += r.seconds
    return { ...r, left, width }
  })
  return (
    <div className="rounded-md border border-[#2a2a2a] bg-[#0d0d0d] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Lane Controls · Frame rate: <span className="text-foreground">23.976 fps</span>
        </span>
        <span className="font-mono text-[10px] text-[#ff0073]">
          Runtime {total}s
        </span>
      </div>
      {(["VIDEO", "SOUND", "FOLEY/FX"] as const).map((lane) => (
        <div key={lane} className="mb-1.5 flex items-stretch gap-2">
          <div className="flex w-16 shrink-0 items-center font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            {lane}
          </div>
          <div className="relative h-9 flex-1 rounded bg-[#161616]">
            {lane === "VIDEO" &&
              blocks.map((b) => (
                <div
                  key={b.id}
                  className="absolute top-0.5 bottom-0.5 overflow-hidden rounded border border-[#ff0073]/40 bg-[#ff0073]/10 px-1 font-mono text-[8px] leading-8 text-foreground"
                  style={{ left: `${b.left}%`, width: `calc(${b.width}% - 2px)` }}
                  title={b.title}
                >
                  SH {String(b.n).padStart(2, "0")} · {b.title}
                </div>
              ))}
            {lane === "SOUND" && (
              <div className="absolute inset-y-1 left-1 right-2 rounded bg-gradient-to-r from-[#ff0073]/20 to-transparent" />
            )}
            {lane === "FOLEY/FX" && (
              <>
                <span className="absolute left-[8%] top-1.5 rounded border border-amber-500/40 px-1 font-mono text-[8px] text-amber-300">
                  GLASS BREACH FX
                </span>
                <span className="absolute left-[45%] top-1.5 rounded border border-amber-500/40 px-1 font-mono text-[8px] text-amber-300">
                  RAIN SIZZLE LOOP
                </span>
              </>
            )}
          </div>
        </div>
      ))}
      <div className="mt-2 flex items-center justify-between font-mono text-[9px] text-muted-foreground">
        <span>
          Stems Sync:{" "}
          <span className="text-foreground">{reel.length} components synced</span>
        </span>
        <span>Click timeline stems to audit sound layers</span>
      </div>
    </div>
  )
}
