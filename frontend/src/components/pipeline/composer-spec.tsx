import { useEffect, useMemo, useState } from "react"
import { STYLE_PRESETS } from "@nodaro/shared"
import { pipelinesApi } from "@/lib/pipelines-api"

/**
 * Phase 3 — "Nodaro Cinema" Composer Spec (design anchor).
 *
 * The cinematic shot composer from the approved mockup: a COMPOSER SPEC panel
 * (FRAMING / DIRECTING) beside a slate-styled preview. Reads scene/shot data
 * from the pipeline and saves per-shot edits via `editShot` / re-rolls the
 * keyframe via `regenerateKeyframe` (the routes already built). Cosmetic
 * technical fields (lens, grade, motion strength, TTS) are surfaced to match
 * the mockup; the load-bearing ones (keyframe + motion prompt, duration,
 * entities, model) are wired to real data.
 */

interface ShotView {
  shot_id?: string
  camera?: { shot_type?: string; angle?: string; motion?: string }
  motion_prompt?: string
  dialogue_line?: string | null
  duration_seconds?: number
  visual_keyframe_prompt?: string
  keyframe_url?: string | null
  video_url?: string | null
}
interface SceneNodeDataView {
  scene_id?: string
  description?: string
  video_model?: string
  image_model?: string
  cast_keys?: string[]
  location_key?: string
  object_keys?: string[]
  shots?: ShotView[]
}
interface SceneEntity {
  id: string
  entity_key: string
  metadata?: { scene_node_data?: SceneNodeDataView } | null
}

const LENSES = [
  "Helios 54-2 78mm",
  "Helios 44-2 58mm",
  "Zeiss Planar 50mm",
  "Cooke S4 32mm",
  "Anamorphic 35mm",
]
const DURATIONS = [3, 5, 6, 8] as const
const MOTION_LEVELS = ["Low Drift", "Medium Velocity", "High Kinetic"] as const

const LABEL =
  "block font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground"

export function ComposerSpec({ pipelineId }: { pipelineId: string }) {
  const [scenes, setScenes] = useState<SceneEntity[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeShot, setActiveShot] = useState(0)

  useEffect(() => {
    let cancelled = false
    pipelinesApi
      .getEntities(pipelineId, "scene")
      .then((rows) => {
        if (!cancelled) setScenes(rows as unknown as SceneEntity[])
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load shots")
      })
    return () => {
      cancelled = true
    }
  }, [pipelineId])

  // Flatten every scene's shots into one ordered shot list (the filmstrip).
  const shots = useMemo(() => {
    const out: Array<{ sceneId: string; scene: SceneNodeDataView; shot: ShotView; n: number }> =
      []
    for (const s of scenes ?? []) {
      const d = s.metadata?.scene_node_data
      for (const shot of d?.shots ?? []) {
        out.push({ sceneId: s.id, scene: d!, shot, n: out.length + 1 })
      }
    }
    return out
  }, [scenes])

  if (error) return <p className="p-4 text-sm text-red-400">{error}</p>
  if (!scenes) return <p className="p-4 text-sm text-muted-foreground">Loading composer…</p>
  if (shots.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Shots will appear here once the director plans them.
      </p>
    )
  }

  const current = shots[Math.min(activeShot, shots.length - 1)]!

  return (
    <div className="flex min-h-[78vh] flex-col overflow-hidden rounded-lg border border-[#1d1d1d] bg-[#0a0a0a] text-foreground">
      <div className="flex min-h-0 flex-1">
        <ComposerPanel
          key={`${current.sceneId}:${current.shot.shot_id}`}
          pipelineId={pipelineId}
          sceneId={current.sceneId}
          scene={current.scene}
          shot={current.shot}
          shotNumber={current.n}
        />
        <SlatePreview shot={current.shot} number={current.n} scene={current.scene} />
      </div>
      <ShotFilmstrip
        shots={shots}
        active={activeShot}
        onSelect={setActiveShot}
      />
    </div>
  )
}

function ComposerPanel({
  pipelineId,
  sceneId,
  scene,
  shot,
  shotNumber,
}: {
  pipelineId: string
  sceneId: string
  scene: SceneNodeDataView
  shot: ShotView
  shotNumber: number
}) {
  const [tab, setTab] = useState<"framing" | "directing">("framing")
  const [framing, setFraming] = useState(shot.visual_keyframe_prompt ?? "")
  const [directing, setDirecting] = useState(shot.motion_prompt ?? "")
  const [grade, setGrade] = useState(STYLE_PRESETS[0]?.id ?? "")
  const [lens, setLens] = useState(LENSES[0])
  const [duration, setDuration] = useState<number>(
    DURATIONS.includes((shot.duration_seconds ?? 6) as never)
      ? (shot.duration_seconds as number)
      : 6,
  )
  const [motionLevel, setMotionLevel] = useState<string>("Medium Velocity")
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const stems = [
    ...(scene.cast_keys ?? []).map((k) => ({ k, kind: "cast" as const })),
    ...(scene.location_key ? [{ k: scene.location_key, kind: "loc" as const }] : []),
    ...(scene.object_keys ?? []).map((k) => ({ k, kind: "obj" as const })),
  ]
  const engineNode =
    tab === "framing"
      ? `${scene.image_model ?? "nano-banana-2"} (Framing still core)`
      : `${scene.video_model ?? "kling-3.0"} (Directing core video)`

  const save = async () => {
    if (!shot.shot_id || busy) return
    setBusy(true)
    setNote(null)
    try {
      await pipelinesApi.editShot(pipelineId, sceneId, shot.shot_id, {
        visual_keyframe_prompt: framing.trim() ? framing : undefined,
        motion_prompt: directing,
        duration_seconds: duration,
      })
      setNote("Spec saved")
      window.setTimeout(() => setNote(null), 1500)
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Save failed")
    } finally {
      setBusy(false)
    }
  }

  const generate = async () => {
    if (!shot.shot_id || busy) return
    setBusy(true)
    setNote("Re-rolling keyframe…")
    try {
      await pipelinesApi.regenerateKeyframe(pipelineId, sceneId, shot.shot_id)
      setNote("Keyframe re-rolled")
      window.setTimeout(() => setNote(null), 1500)
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Generate failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex w-[340px] shrink-0 flex-col overflow-y-auto border-r border-[#1d1d1d] p-4">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold tracking-wide text-foreground">
            <span className="text-[#ff0073]">≡</span> COMPOSER SPEC
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Selected Shot Parameters Configuration
          </div>
        </div>
        <span className="rounded-sm bg-[#ff0073] px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-white">
          Pro View
        </span>
      </div>

      {/* FRAMING / DIRECTING tabs */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        {(["framing", "directing"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-md border px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-wider transition-colors ${
              tab === t
                ? "border-[#ff0073] bg-[#ff0073] text-white"
                : "border-[#2a2a2a] bg-transparent text-muted-foreground hover:border-[#ff0073]/50"
            }`}
          >
            {t === "framing" ? "▢ Framing" : "▷ Directing"}
          </button>
        ))}
      </div>

      <div className="mb-4">
        <span className={LABEL}>Active Engine Node:</span>
        <div className="mt-1 rounded-md border border-[#ff0073]/40 bg-[#ff0073]/10 px-2 py-1.5 font-mono text-[11px] text-[#ff0073]">
          {engineNode}
        </div>
      </div>

      <div className="mb-4">
        <div className="mb-1 flex items-center justify-between">
          <span className={LABEL}>Injected Entities (@stems)</span>
          <span className="font-mono text-[9px] text-muted-foreground">
            {stems.length} loaded
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {stems.map(({ k, kind }) => (
            <span
              key={`${kind}:${k}`}
              className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] ${
                kind === "cast"
                  ? "border-sky-500/50 text-sky-300"
                  : kind === "loc"
                    ? "border-[#ff0073]/50 text-[#ff0073]"
                    : "border-emerald-500/50 text-emerald-300"
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />@{k}
            </span>
          ))}
          <span className="rounded-md border border-dashed border-[#2a2a2a] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            + inject
          </span>
        </div>
      </div>

      <div className="mb-4">
        <span className={LABEL}>
          {tab === "framing" ? "▢ Framing Specification" : "▷ Directing Movement Script"}
        </span>
        <textarea
          value={tab === "framing" ? framing : directing}
          onChange={(e) =>
            tab === "framing" ? setFraming(e.target.value) : setDirecting(e.target.value)
          }
          rows={4}
          className="mt-1 w-full resize-none rounded-md border border-[#2a2a2a] bg-[#111] p-2 font-mono text-[11px] leading-relaxed text-foreground outline-none focus:border-[#ff0073]"
        />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <label className={LABEL}>
          Grade Style Cook
          <select
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            className="mt-1 w-full rounded-md border border-[#2a2a2a] bg-[#111] p-1.5 text-[11px] text-foreground outline-none focus:border-[#ff0073]"
          >
            {STYLE_PRESETS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          Lens / Aperture
          <select
            value={lens}
            onChange={(e) => setLens(e.target.value)}
            className="mt-1 w-full rounded-md border border-[#2a2a2a] bg-[#111] p-1.5 text-[11px] text-foreground outline-none focus:border-[#ff0073]"
          >
            {LENSES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mb-2 flex items-center justify-between">
        <span className={LABEL}>Duration Specification</span>
        <div className="flex gap-1">
          {DURATIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDuration(d)}
              className={`rounded px-2 py-0.5 font-mono text-[10px] ${
                duration === d
                  ? "bg-[#ff0073] text-white"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {d}s
            </button>
          ))}
        </div>
      </div>

      <div className="mb-2 flex items-center justify-between">
        <span className={LABEL}>Motion Strength Speed</span>
        <button
          type="button"
          onClick={() =>
            setMotionLevel(
              MOTION_LEVELS[(MOTION_LEVELS.indexOf(motionLevel as never) + 1) % MOTION_LEVELS.length],
            )
          }
          className="rounded border border-[#ff0073]/40 bg-[#ff0073]/10 px-2 py-0.5 font-mono text-[10px] text-[#ff0073]"
        >
          {motionLevel}
        </button>
      </div>

      <div className="mb-4 flex items-center justify-between">
        <span className={LABEL}>Synthesized TTS Voice</span>
        <span className="rounded border border-[#ff0073]/40 bg-[#ff0073]/10 px-2 py-0.5 font-mono text-[10px] text-[#ff0073]">
          TTS AUTO_ON
        </span>
      </div>

      <div className="mt-auto flex items-center gap-2 rounded-md border border-[#2a2a2a] p-2">
        <div className="flex-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Token Overhead
          </div>
          <div className="font-mono text-[10px] text-foreground">
            {note ?? "Ready 4K (Estimate ~15s)"}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void (tab === "framing" ? generate() : save())}
          disabled={busy || !shot.shot_id}
          title={tab === "framing" ? "Re-roll keyframe" : "Save directing spec"}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#ff0073] text-white disabled:opacity-40"
        >
          {busy ? "…" : "✦"}
        </button>
      </div>
      {tab === "framing" && (
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !shot.shot_id}
          className="mt-2 rounded-md border border-[#2a2a2a] py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          Save spec
        </button>
      )}
      <div className="mt-2 font-mono text-[9px] text-muted-foreground">
        Shot {shotNumber} · grade {STYLE_PRESETS.find((s) => s.id === grade)?.label}
      </div>
    </div>
  )
}

function SlatePreview({
  shot,
  number,
  scene,
}: {
  shot: ShotView
  number: number
  scene: SceneNodeDataView
}) {
  const title = (scene.description ?? "Untitled shot").slice(0, 40)
  return (
    <div className="flex min-w-0 flex-1 flex-col p-4">
      <div className="mb-2 flex items-start justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#ff0073]">
            Shot {String(number).padStart(2, "0")} · seconds 0:{shot.duration_seconds ?? 6} ·{" "}
            <span className="text-emerald-400">Ready</span>
          </div>
          <div className="text-lg font-semibold uppercase tracking-wide text-foreground">
            {title}
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-foreground">
            4K DCI Widescreen Aspect
          </div>
          <div className="font-mono text-[9px] text-muted-foreground">
            Codec: ProRes Raw (Cinema HDR · Helios 44-2)
          </div>
        </div>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-lg border border-[#1d1d1d] bg-black">
        <div className="absolute inset-x-0 top-0 h-10 bg-black" />
        <div className="absolute inset-x-0 bottom-0 h-10 bg-black" />
        {shot.video_url ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            key={shot.video_url}
            src={shot.video_url}
            controls
            poster={shot.keyframe_url ?? undefined}
            className="h-full w-full object-contain"
          />
        ) : shot.keyframe_url ? (
          <img
            src={shot.keyframe_url}
            alt={`Shot ${number}`}
            className="h-full w-full object-contain"
          />
        ) : (
          <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            keyframe pending — re-roll to generate
          </span>
        )}
        <span className="absolute bottom-3 left-3 rounded border border-[#2a2a2a] bg-black/70 px-2 py-0.5 font-mono text-[10px] text-[#ff0073]">
          TC: 00:00:14:0{number}
        </span>
        <span className="absolute bottom-3 right-3 rounded border border-[#2a2a2a] bg-black/70 px-2 py-0.5 font-mono text-[10px] text-foreground">
          LENS STATUS: HELIOS 44-2
        </span>
      </div>
    </div>
  )
}

function ShotFilmstrip({
  shots,
  active,
  onSelect,
}: {
  shots: Array<{ shot: ShotView; n: number }>
  active: number
  onSelect: (i: number) => void
}) {
  return (
    <div className="flex items-center gap-3 border-t border-[#1d1d1d] p-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        Shot Filmstrip Sequence:
      </span>
      <div className="flex gap-1.5 overflow-x-auto">
        {shots.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(i)}
            className={`h-10 w-16 shrink-0 overflow-hidden rounded border ${
              active === i ? "border-[#ff0073]" : "border-[#2a2a2a]"
            }`}
          >
            {s.shot.keyframe_url ? (
              <img src={s.shot.keyframe_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center bg-[#161616] font-mono text-[8px] text-muted-foreground">
                SH {String(s.n).padStart(2, "0")}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
