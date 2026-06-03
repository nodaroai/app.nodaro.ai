import { useEffect, useState } from "react"
import {
  PIPELINE_PINNABLE_IMAGE_MODELS,
  PIPELINE_PINNABLE_VIDEO_MODELS,
} from "@nodaro/shared"
import { pipelinesApi } from "@/lib/pipelines-api"

/**
 * Phase 3 — selected-clip editor. When a clip is opened in the main screen,
 * this lets the user re-edit it: the original prompt (keyframe + motion), a
 * per-shot image/video model, the reference entities, and "Regenerate clip"
 * (saves the edits, then re-animates via the reanimate route). Edits the first
 * shot of the clicked scene (the clip's source shot).
 */

interface ShotData {
  shot_id?: string
  visual_keyframe_prompt?: string
  motion_prompt?: string
  image_model?: string
  video_model?: string
  video_url?: string | null
}
interface SceneData {
  cast_keys?: string[]
  location_key?: string
  object_keys?: string[]
  image_model?: string
  video_model?: string
  shots?: ShotData[]
}

const LABEL = "font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground"
const FIELD =
  "mt-1 w-full rounded-md border border-[#2a2a2a] bg-[#111] p-1.5 text-[11px] text-foreground outline-none focus:border-[#ff0073]"

export function ClipEditor({
  pipelineId,
  sceneId,
  onRegenerated,
}: {
  pipelineId: string
  sceneId: string
  onRegenerated?: (videoUrl: string) => void
}) {
  const [scene, setScene] = useState<SceneData | null>(null)
  const [shotId, setShotId] = useState<string | null>(null)
  const [keyframePrompt, setKeyframePrompt] = useState("")
  const [motionPrompt, setMotionPrompt] = useState("")
  const [imageModel, setImageModel] = useState("")
  const [videoModel, setVideoModel] = useState("")
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    pipelinesApi
      .getEntities(pipelineId, "scene")
      .then((rows) => {
        if (cancelled) return
        const s = (
          rows as unknown as Array<{
            id: string
            metadata?: { scene_node_data?: SceneData } | null
          }>
        ).find((r) => r.id === sceneId)
        const d = s?.metadata?.scene_node_data
        if (!d) return
        setScene(d)
        const shot = d.shots?.find((sh) => sh.video_url) ?? d.shots?.[0]
        setShotId(shot?.shot_id ?? null)
        setKeyframePrompt(shot?.visual_keyframe_prompt ?? "")
        setMotionPrompt(shot?.motion_prompt ?? "")
        setImageModel(shot?.image_model ?? d.image_model ?? "")
        setVideoModel(shot?.video_model ?? d.video_model ?? "")
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [pipelineId, sceneId])

  const regenerate = async () => {
    if (!shotId || busy) return
    setBusy(true)
    setNote("Saving + re-animating clip…")
    try {
      await pipelinesApi.editShot(pipelineId, sceneId, shotId, {
        visual_keyframe_prompt: keyframePrompt.trim() ? keyframePrompt : undefined,
        motion_prompt: motionPrompt,
        image_model: imageModel || undefined,
        video_model: videoModel || undefined,
      })
      const r = await pipelinesApi.reanimateShot(pipelineId, sceneId, shotId)
      setNote("Clip regenerated")
      onRegenerated?.(r.video_url)
      window.setTimeout(() => setNote(null), 2000)
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Regenerate failed")
    } finally {
      setBusy(false)
    }
  }

  const refs = [
    ...(scene?.cast_keys ?? []),
    ...(scene?.location_key ? [scene.location_key] : []),
    ...(scene?.object_keys ?? []),
  ]

  return (
    <div className="border-t border-[#1d1d1d] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-foreground">
          ✦ Edit this clip
        </span>
        {note && <span className="font-mono text-[10px] text-[#ff0073]">{note}</span>}
      </div>

      <label className="block">
        <span className={LABEL}>Keyframe prompt</span>
        <textarea
          value={keyframePrompt}
          onChange={(e) => setKeyframePrompt(e.target.value)}
          rows={2}
          className={`${FIELD} resize-none`}
        />
      </label>

      <label className="mt-2 block">
        <span className={LABEL}>Motion / direction</span>
        <textarea
          value={motionPrompt}
          onChange={(e) => setMotionPrompt(e.target.value)}
          rows={2}
          className={`${FIELD} resize-none`}
        />
      </label>

      <div className="mt-2 grid grid-cols-2 gap-3">
        <label className="block">
          <span className={LABEL}>Image model</span>
          <select value={imageModel} onChange={(e) => setImageModel(e.target.value)} className={FIELD}>
            <option value="">Auto</option>
            {PIPELINE_PINNABLE_IMAGE_MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={LABEL}>Video model</span>
          <select value={videoModel} onChange={(e) => setVideoModel(e.target.value)} className={FIELD}>
            <option value="">Auto</option>
            {PIPELINE_PINNABLE_VIDEO_MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-2">
        <span className={LABEL}>Reference entities</span>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {refs.length === 0 ? (
            <span className="font-mono text-[10px] text-muted-foreground">none</span>
          ) : (
            refs.map((k) => (
              <span
                key={k}
                className="rounded-md border border-sky-500/40 px-1.5 py-0.5 font-mono text-[10px] text-sky-300"
              >
                @{k}
              </span>
            ))
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => void regenerate()}
          disabled={busy || !shotId}
          className="rounded-md bg-[#ff0073] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-white disabled:opacity-40"
        >
          {busy ? "Regenerating…" : "Save & Regenerate clip"}
        </button>
      </div>
    </div>
  )
}
