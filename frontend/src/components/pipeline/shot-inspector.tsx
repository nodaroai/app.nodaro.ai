import { useEffect, useState } from "react"
import { STYLE_PRESETS } from "@nodaro/shared"
import { pipelinesApi } from "@/lib/pipelines-api"

/**
 * Phase 3 — Focus composer.
 *
 * The north-star §6 ④ Focus view: see every scene's shots and direct them.
 * Renders the Scene Director's plan from `scene_node_data` and lets the user
 * edit the per-shot creative levers (motion, duration, dialogue) inline — saved
 * via `pipelinesApi.editShot` (the per-shot edit route field-merges into
 * `scene_node_data.shots[]`). Save-only: edits take effect the next time the
 * shot is animated; existing clips aren't auto-re-rendered.
 *
 * Camera + keyframe are shown read-only for now (re-framing / re-rolling the
 * keyframe is a follow-up that needs the keyframe-regen wiring).
 */

interface ShotView {
  shot_id?: string
  camera?: { shot_type?: string; angle?: string; motion?: string }
  action?: string
  motion_prompt?: string
  dialogue_line?: string | null
  duration_seconds?: number
  visual_keyframe_prompt?: string
  keyframe_url?: string | null
}

interface SceneNodeDataView {
  scene_id?: string
  description?: string
  emotional_beat?: string
  video_model?: string
  image_model?: string
  shot_input_mode?: string
  cast_keys?: string[]
  location_key?: string
  shots?: ShotView[]
}

interface SceneEntity {
  id: string
  entity_key: string
  status: string
  metadata?: { scene_node_data?: SceneNodeDataView } | null
}

export function ShotInspector({ pipelineId }: { pipelineId: string }) {
  const [scenes, setScenes] = useState<SceneEntity[] | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  if (error) return <p className="text-sm text-red-400">{error}</p>
  if (!scenes) return <p className="text-sm text-muted-foreground">Loading shots…</p>

  const withShots = scenes.filter(
    (s) => (s.metadata?.scene_node_data?.shots?.length ?? 0) > 0,
  )
  if (withShots.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        The director is still planning the shots — they'll appear here as each
        scene is composed.
      </p>
    )
  }

  return (
    <div className="max-w-4xl space-y-4">
      <p className="text-xs text-muted-foreground">
        Focus — direct each shot. Edits to motion / duration / dialogue are saved
        to the plan and apply the next time the shot is animated.
      </p>

      {withShots.map((scene) => {
        const d = scene.metadata!.scene_node_data!
        const shots = d.shots ?? []
        return (
          <div key={scene.id} className="rounded-md border bg-card p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="truncate text-sm font-medium text-foreground">
                {d.scene_id ?? scene.entity_key}
              </h3>
              {d.emotional_beat && (
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {d.emotional_beat}
                </span>
              )}
            </div>

            {d.description && (
              <p className="mb-2 text-xs text-muted-foreground">{d.description}</p>
            )}

            <div className="mb-3 flex flex-wrap gap-1.5 text-[10px]">
              {d.video_model && (
                <span className="rounded bg-[#ff0073]/10 px-1.5 py-0.5 text-[#ff0073]">
                  video: {d.video_model}
                </span>
              )}
              {d.image_model && (
                <span className="rounded border bg-card px-1.5 py-0.5 text-muted-foreground">
                  image: {d.image_model}
                </span>
              )}
              {d.shot_input_mode && (
                <span className="rounded border bg-card px-1.5 py-0.5 text-muted-foreground">
                  mode: {d.shot_input_mode}
                </span>
              )}
              {d.location_key && (
                <span className="rounded border bg-card px-1.5 py-0.5 text-muted-foreground">
                  @ {d.location_key}
                </span>
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {shots.map((shot, i) => (
                <ShotCard
                  key={shot.shot_id ?? i}
                  pipelineId={pipelineId}
                  sceneId={scene.id}
                  shot={shot}
                  index={i}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Canonical camera enums (mirror ShotSpecSchema.camera in @nodaro/shared).
const SHOT_TYPES = [
  "wide",
  "medium",
  "close_up",
  "extreme_close_up",
  "pov",
  "over_shoulder",
] as const
const ANGLES = ["eye_level", "low", "high", "dutch", "birds_eye"] as const
const MOTIONS = ["static", "pan", "tilt", "dolly", "tracking", "handheld"] as const

function CameraSelect({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: readonly string[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded border bg-card px-1 py-0.5 text-[10px] text-foreground outline-none focus:border-[#ff0073]"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o.replace(/_/g, " ")}
        </option>
      ))}
    </select>
  )
}

function ShotCard({
  pipelineId,
  sceneId,
  shot,
  index,
}: {
  pipelineId: string
  sceneId: string
  shot: ShotView
  index: number
}) {
  const [motion, setMotion] = useState(shot.motion_prompt ?? "")
  const [keyframePrompt, setKeyframePrompt] = useState(
    shot.visual_keyframe_prompt ?? "",
  )
  const [duration, setDuration] = useState(shot.duration_seconds ?? 0)
  const [dialogue, setDialogue] = useState(shot.dialogue_line ?? "")
  const [shotType, setShotType] = useState(shot.camera?.shot_type ?? "")
  const [angle, setAngle] = useState(shot.camera?.angle ?? "")
  const [shotMotion, setShotMotion] = useState(shot.camera?.motion ?? "")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [kfUrl, setKfUrl] = useState(shot.keyframe_url ?? null)
  const [rerolling, setRerolling] = useState(false)

  const reroll = async () => {
    if (!shot.shot_id || rerolling) return
    setRerolling(true)
    setErr(null)
    try {
      const { keyframe_url } = await pipelinesApi.regenerateKeyframe(
        pipelineId,
        sceneId,
        shot.shot_id,
      )
      setKfUrl(keyframe_url)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Re-roll failed")
    } finally {
      setRerolling(false)
    }
  }

  const dirty =
    motion !== (shot.motion_prompt ?? "") ||
    keyframePrompt !== (shot.visual_keyframe_prompt ?? "") ||
    duration !== (shot.duration_seconds ?? 0) ||
    dialogue !== (shot.dialogue_line ?? "") ||
    shotType !== (shot.camera?.shot_type ?? "") ||
    angle !== (shot.camera?.angle ?? "") ||
    shotMotion !== (shot.camera?.motion ?? "")

  const save = async () => {
    if (!shot.shot_id || !dirty || saving) return
    setSaving(true)
    setErr(null)
    try {
      await pipelinesApi.editShot(pipelineId, sceneId, shot.shot_id, {
        motion_prompt: motion,
        visual_keyframe_prompt: keyframePrompt.trim() ? keyframePrompt : undefined,
        duration_seconds: duration > 0 ? duration : undefined,
        dialogue_line: dialogue.trim() ? dialogue : null,
        camera: {
          ...(shotType ? { shot_type: shotType } : {}),
          ...(angle ? { angle } : {}),
          ...(shotMotion ? { motion: shotMotion } : {}),
        },
      })
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1500)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded border p-2">
      <div className="flex gap-2">
        <div className="flex w-16 shrink-0 flex-col gap-1">
          {kfUrl ? (
            <img
              src={kfUrl}
              alt={`Shot ${index + 1} keyframe`}
              className="h-16 w-16 rounded object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded bg-[var(--border-primary)] text-center text-[9px] text-muted-foreground">
              no keyframe yet
            </div>
          )}
          <button
            type="button"
            onClick={() => void reroll()}
            disabled={rerolling || !shot.shot_id}
            title="Regenerate this keyframe still (costs credits)"
            className="rounded border px-1 py-0.5 text-[9px] text-foreground hover:border-[#ff0073]/50 disabled:opacity-40"
          >
            {rerolling ? "Re-rolling…" : "Re-roll"}
          </button>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-foreground">Shot {index + 1}</div>
          <div className="mt-0.5 flex flex-wrap gap-1">
            <CameraSelect value={shotType} onChange={setShotType} options={SHOT_TYPES} />
            <CameraSelect value={angle} onChange={setAngle} options={ANGLES} />
            <CameraSelect value={shotMotion} onChange={setShotMotion} options={MOTIONS} />
          </div>
          <label className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
            Duration
            <input
              type="number"
              min={0.3}
              max={8}
              step={0.5}
              value={duration || ""}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-14 rounded border bg-card px-1 py-0.5 text-[10px] text-foreground outline-none focus:border-[#ff0073]"
            />
            s
          </label>
        </div>
      </div>

      <label className="mt-2 block text-[10px] text-muted-foreground">
        Keyframe (what the shot shows)
        <textarea
          value={keyframePrompt}
          onChange={(e) => setKeyframePrompt(e.target.value)}
          rows={2}
          placeholder="Describe the framed still…"
          className="mt-0.5 w-full resize-none rounded border bg-card p-1 text-[11px] text-foreground outline-none focus:border-[#ff0073]"
        />
      </label>
      {/* Per-shot style override (north-star §6): inject a look into this one
          shot's keyframe prompt, overriding the film-wide Style for it. */}
      <select
        value=""
        onChange={(e) => {
          const p = STYLE_PRESETS.find((s) => s.id === e.target.value)
          if (p) {
            setKeyframePrompt((prev) =>
              `${prev}${prev.trim() ? "\n\n" : ""}${p.directives.visualStyle ?? ""}`.trim(),
            )
          }
        }}
        className="mt-1 w-full rounded border bg-card px-1 py-0.5 text-[10px] text-muted-foreground outline-none focus:border-[#ff0073]"
      >
        <option value="">+ apply a look to this shot…</option>
        {STYLE_PRESETS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>

      <label className="mt-1 block text-[10px] text-muted-foreground">
        Motion
        <textarea
          value={motion}
          onChange={(e) => setMotion(e.target.value)}
          rows={2}
          className="mt-0.5 w-full resize-none rounded border bg-card p-1 text-[11px] text-foreground outline-none focus:border-[#ff0073]"
        />
      </label>

      <label className="mt-1 block text-[10px] text-muted-foreground">
        Dialogue
        <input
          type="text"
          value={dialogue}
          onChange={(e) => setDialogue(e.target.value)}
          placeholder="(none)"
          className="mt-0.5 w-full rounded border bg-card p-1 text-[11px] text-foreground outline-none focus:border-[#ff0073]"
        />
      </label>

      <div className="mt-1.5 flex items-center justify-end gap-2">
        {err && <span className="text-[10px] text-red-400">{err}</span>}
        {saved && !dirty && <span className="text-[10px] text-green-500">Saved</span>}
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving || !shot.shot_id}
          className="rounded bg-[#ff0073] px-2 py-0.5 text-[10px] font-medium text-white disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  )
}
