import { useState } from "react"
import type { ConfigProps } from "./types"
import type { SceneNodeFrontendData } from "@/types/nodes"
import {
  clearVideoCriticMetadata,
  VIDEO_CRITIC_MIN_ADHERENCE_SCORE,
  type MatchCutVerdict,
  type ShotSpec,
  type VideoCriticShotFields,
} from "@nodaro/shared"

/**
 * /simplify pass-2 — warn-tier threshold for the video-critic score chip.
 * A score below this but `verdict==='pass'` (or not explicitly failed) is
 * the "borderline" state — colored amber instead of green. Distinct from
 * `VIDEO_CRITIC_MIN_ADHERENCE_SCORE`, which is the fail threshold: any score
 * strictly below `MIN_ADHERENCE_SCORE` already triggered a retry / cap-fail
 * upstream and surfaces as red (`failed === true`).
 *
 * Defined as `MIN_ADHERENCE_SCORE + 2` so the warn-tier band is always at
 * least 2 wide above the fail threshold — keeps the amber zone meaningful
 * if MIN_ADHERENCE_SCORE gets retuned upstream. Matches the historical
 * inline value (7 = 5 + 2) the pre-pass-2 code carried as a magic number.
 */
const VIDEO_CRITIC_AMBER_THRESHOLD = VIDEO_CRITIC_MIN_ADHERENCE_SCORE + 2
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { X, Plus } from "lucide-react"
import { useSceneHelper } from "@/hooks/use-scene-helper"
import { SceneHelperButtons } from "./scene-helper-buttons"
import { SceneHelperModal } from "./scene-helper-modal"
import { pipelinesApi } from "@/lib/pipelines-api"

/**
 * Phase 1D.2c-b-ii — Video Critic per-shot fields, persisted by Stage 7
 * (scene-internal-pipeline.ts) as direct siblings on the ShotSpec record
 * (NOT under a nested `metadata` key). The shared `VideoCriticShotFields`
 * interface is the single source of truth for these field names — see
 * `packages/shared/src/pipeline-types.ts`.
 */
type ShotWithVideoCritic = ShotSpec & VideoCriticShotFields

/**
 * SceneConfig — Phase 1B.2 read-only config panel for the pipeline-managed
 * SceneNode. Scene data is written by the Scene Director LLM and persisted
 * on `pipeline_entities.metadata.scene_node_data`; the canvas node mirrors
 * that shape. Users approve / reject each scene through the pipeline panel
 * (see Section L), not through this config panel.
 *
 * Mutable fields: `view_mode` + per-shot fields for the 3 Phase 1C.3 input
 * modes: `extends_shot_id` (video_continuation), `interpolation_keyframes`
 * (frame_interpolation), and `camera_path_directive` (camera_path).
 * Phase 1B.3 adds §6.11 Scene-Context helper buttons (Audit Prompt, Improve
 * Prompt, Generate Motion, Optimize for Model, Add B-Roll, Bridge to Next,
 * Anchor Style) that mutate `data.shots` and `data.scene_anchor_keyframe` via
 * Accept-gated patches. The 3 vision-keyframe helpers render disabled with a
 * "Pending Phase 1C" tooltip.
 *
 * Phase 1D.1 adds `stageOutput` (optional) for match-cut verdict display.
 * The prop is plumbed from config-panel.tsx via a React Query on Stage 6
 * (`scene_images`). When absent the match-cut block shows "Pending critic
 * verdict…" (e.g. before the pipeline has reached Stage 6).
 */
interface SceneConfigProps extends ConfigProps<SceneNodeFrontendData> {
  /**
   * Stage 6 (`scene_images`) output from `pipeline_stages.output`.
   * Used to surface `match_cut_verdicts` per shot. Optional — when absent
   * the match-cut block renders a "pending" state.
   *
   * Wired from config-panel.tsx via a `pipelinesApi.getStage(pipelineId,
   * "scene_images")` query keyed on `nodeData.pipeline_id`. Polls at 5 s
   * while the panel is open, stops once the stage is "approved".
   */
  stageOutput?: {
    match_cut_verdicts?: Record<string, MatchCutVerdict>
    match_cut_break_pending?: string[]
  }
}

export function SceneConfig({ data, onUpdate, stageOutput }: SceneConfigProps) {
  // pipeline_id is written by canvas-materializer when the scene is created;
  // pipeline_entity_id is the bound row in pipeline_entities. The §6.11 helper
  // buttons stay disabled until both are present.
  const pipelineId = data.pipeline_id
  const sceneEntityId = data.pipeline_entity_id
  const { state, invoke, reset } = useSceneHelper(pipelineId, sceneEntityId)

  // Local state for camera_path_directive.parameters JSON text fields, keyed
  // by shot_id. We keep the raw textarea string here and only write parsed JSON
  // to node data on blur (skipping invalid JSON silently).
  const [cameraParamsRaw, setCameraParamsRaw] = useState<Record<string, string>>({})

  // Per-shot loading state for the accept-break action (Phase 1D.1).
  const [acceptBreakLoading, setAcceptBreakLoading] = useState<Record<string, boolean>>({})

  // Per-shot loading state for the video-critic Skip / Regenerate actions
  // (Phase 1D.2c-b-ii §9 — J1). Keyed by shot_id; disables both buttons
  // while either action is in flight so a double-click can't race.
  const [videoCriticLoading, setVideoCriticLoading] = useState<Record<string, boolean>>({})

  // Patch a single shot by shot_id, merging `patch` into the existing shot.
  function patchShot(shotId: string, patch: Partial<ShotSpec>) {
    const updatedShots = data.shots.map((s) =>
      s.shot_id === shotId ? { ...s, ...patch } : s,
    )
    onUpdate({ shots: updatedShots })
  }

  // Build a user-friendly label for a shot: "Shot N: <first 40 chars of action>"
  function shotLabel(shot: ShotSpec, idx: number): string {
    const action = shot.action?.trim() ?? ""
    const truncated = action.length > 40 ? `${action.slice(0, 40)}…` : action
    return `Shot ${idx + 1}${truncated ? `: ${truncated}` : ""}`
  }

  return (
    <div className="space-y-3">
      <div>
        <Label>Scene</Label>
        <div className="text-sm">{data.description || data.label || `Scene ${data.scene_index}`}</div>
      </div>
      <div>
        <Label>Beat</Label>
        <div className="text-sm">{data.emotional_beat}</div>
      </div>
      <div>
        <Label>Duration</Label>
        <div className="text-sm">{data.duration_seconds}s</div>
      </div>
      <div>
        <Label>Shots</Label>
        <div className="text-sm">{data.shots.length} planned</div>
      </div>
      <div>
        <Label>Image model</Label>
        <div className="text-sm">{data.image_model}</div>
      </div>
      <div>
        <Label>Video model</Label>
        <div className="text-sm">{data.video_model}</div>
      </div>
      <div>
        <Label>Input mode</Label>
        <div className="text-sm">{data.shot_input_mode}</div>
      </div>
      <div>
        <Label>View mode</Label>
        <Select
          value={data.view_mode ?? "storyboard"}
          onValueChange={(v) =>
            onUpdate({ view_mode: v as "default" | "storyboard" | "video" | "scripting" })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Default</SelectItem>
            <SelectItem value="storyboard">Storyboard</SelectItem>
            <SelectItem value="scripting">Scripting</SelectItem>
            <SelectItem value="video">Video</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="text-xs text-zinc-500 italic">
        Edit through the pipeline panel; this node is pipeline-managed in Phase 1B.2.
      </div>

      {/* ── Per-shot editors: Phase 1C.3 input-mode fields + Phase 1D.1 match-cut + Phase 1D.2c-b-ii video-critic ── */}
      {data.shots.map((shot, idx) => {
        const mode = data.shot_input_mode
        const isMatchCutShot = shot.shot_intent?.is_match_cut === true && idx < data.shots.length - 1
        const shotVC = shot as ShotWithVideoCritic
        const hasVideoCritic = shotVC.video_critic_findings !== undefined

        // Only render the per-shot editor when the scene's input mode has
        // shot-level fields to configure, OR this shot has a match-cut verdict
        // to surface (Phase 1D.1), OR this shot has Video Critic findings to
        // surface (Phase 1D.2c-b-ii).
        if (
          mode !== "video_continuation" &&
          mode !== "frame_interpolation" &&
          mode !== "camera_path" &&
          !isMatchCutShot &&
          !hasVideoCritic
        ) {
          return null
        }

        return (
          <div key={shot.shot_id} className="space-y-2 pt-3 border-t border-zinc-200">
            <Label className="text-xs font-semibold text-zinc-600">
              {shotLabel(shot, idx)}
            </Label>

            {/* ── Section 1: video_continuation — extends_shot_id ──────── */}
            {mode === "video_continuation" && (
              <div className="space-y-1">
                <Label htmlFor={`extends-${shot.shot_id}`} className="text-xs">
                  Extends shot
                </Label>
                <Select
                  value={shot.extends_shot_id ?? ""}
                  onValueChange={(v) =>
                    patchShot(shot.shot_id, { extends_shot_id: v || undefined })
                  }
                >
                  <SelectTrigger id={`extends-${shot.shot_id}`} className="h-8 text-xs">
                    <SelectValue placeholder="None (start fresh)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None (start fresh)</SelectItem>
                    {data.shots
                      .filter((s) => s.shot_id !== shot.shot_id)
                      .map((s, si) => (
                        <SelectItem key={s.shot_id} value={s.shot_id}>
                          {shotLabel(s, si)}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {shot.extends_shot_id &&
                  !data.shots.some(
                    (s) => s.shot_id === shot.extends_shot_id && s.shot_id !== shot.shot_id,
                  ) && (
                    <p className="text-xs text-amber-600">
                      Warning: referenced shot not found in this scene.
                    </p>
                  )}
                <p className="text-xs text-zinc-500">
                  Continuation requires VEO or Seedance 2 video model. Prior shot must come
                  before this one.
                </p>
              </div>
            )}

            {/* ── Section 2: frame_interpolation — interpolation_keyframes ─ */}
            {mode === "frame_interpolation" && (
              <div className="space-y-2">
                <Label className="text-xs">Interpolation keyframes</Label>
                {(shot.interpolation_keyframes ?? []).map((kf, kfIdx) => (
                  <div key={kfIdx} className="flex gap-1 items-start">
                    <Input
                      type="number"
                      min={0}
                      step={0.1}
                      value={kf.timestamp_sec}
                      onChange={(e) => {
                        const frames = [...(shot.interpolation_keyframes ?? [])]
                        frames[kfIdx] = { ...kf, timestamp_sec: parseFloat(e.target.value) || 0 }
                        patchShot(shot.shot_id, { interpolation_keyframes: frames })
                      }}
                      className="h-7 w-20 text-xs shrink-0"
                      aria-label={`Keyframe ${kfIdx + 1} timestamp (seconds)`}
                    />
                    <Textarea
                      value={kf.prompt}
                      onChange={(e) => {
                        const frames = [...(shot.interpolation_keyframes ?? [])]
                        frames[kfIdx] = { ...kf, prompt: e.target.value }
                        patchShot(shot.shot_id, { interpolation_keyframes: frames })
                      }}
                      rows={2}
                      className="text-xs flex-1 min-h-0 resize-none"
                      placeholder="Keyframe visual prompt…"
                      aria-label={`Keyframe ${kfIdx + 1} prompt`}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={() => {
                        const frames = (shot.interpolation_keyframes ?? []).filter(
                          (_, i) => i !== kfIdx,
                        )
                        patchShot(shot.shot_id, { interpolation_keyframes: frames })
                      }}
                      aria-label={`Remove keyframe ${kfIdx + 1}`}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs w-full"
                  onClick={() => {
                    const frames = [
                      ...(shot.interpolation_keyframes ?? []),
                      { timestamp_sec: 0, prompt: "" },
                    ]
                    patchShot(shot.shot_id, { interpolation_keyframes: frames })
                  }}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add keyframe
                </Button>
                <p className="text-xs text-zinc-500">
                  Requires ≥2 keyframes. First must be timestamp 0. Costly — auto-mode falls back
                  to first_frame.
                </p>
              </div>
            )}

            {/* ── Section 3: camera_path — camera_path_directive ────────── */}
            {mode === "camera_path" && (
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label htmlFor={`path-kind-${shot.shot_id}`} className="text-xs">
                    Camera path
                  </Label>
                  <Select
                    value={shot.camera_path_directive?.path_kind ?? ""}
                    onValueChange={(v) => {
                      if (!v) return
                      patchShot(shot.shot_id, {
                        camera_path_directive: {
                          ...shot.camera_path_directive,
                          path_kind: v as "orbit" | "dolly" | "crane" | "arc" | "reveal",
                        },
                      })
                    }}
                  >
                    <SelectTrigger
                      id={`path-kind-${shot.shot_id}`}
                      className="h-8 text-xs"
                    >
                      <SelectValue placeholder="Select path kind…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="orbit">Orbit</SelectItem>
                      <SelectItem value="dolly">Dolly</SelectItem>
                      <SelectItem value="crane">Crane</SelectItem>
                      <SelectItem value="arc">Arc</SelectItem>
                      <SelectItem value="reveal">Reveal</SelectItem>
                    </SelectContent>
                  </Select>
                  {shot.camera_path_directive?.path_kind === "orbit" && (
                    <p className="text-xs text-zinc-400">
                      Hint: try <code className="font-mono">{"{ \"degrees\": 360 }"}</code>
                    </p>
                  )}
                  {shot.camera_path_directive?.path_kind === "dolly" && (
                    <p className="text-xs text-zinc-400">
                      Hint: try <code className="font-mono">{"{ \"distance\": 2 }"}</code>
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label
                    htmlFor={`cam-params-${shot.shot_id}`}
                    className="text-xs"
                  >
                    Parameters (JSON)
                  </Label>
                  <Textarea
                    id={`cam-params-${shot.shot_id}`}
                    value={
                      cameraParamsRaw[shot.shot_id] ??
                      JSON.stringify(shot.camera_path_directive?.parameters ?? {}, null, 2)
                    }
                    onChange={(e) => {
                      setCameraParamsRaw((prev) => ({
                        ...prev,
                        [shot.shot_id]: e.target.value,
                      }))
                    }}
                    onBlur={() => {
                      const raw = cameraParamsRaw[shot.shot_id]
                      if (raw === undefined) return
                      try {
                        const parsed = JSON.parse(raw) as Record<string, unknown>
                        patchShot(shot.shot_id, {
                          camera_path_directive: {
                            path_kind: shot.camera_path_directive?.path_kind ?? "orbit",
                            parameters: parsed,
                          },
                        })
                        // Clear raw draft on success — next render reads from node data.
                        setCameraParamsRaw((prev) => {
                          const next = { ...prev }
                          delete next[shot.shot_id]
                          return next
                        })
                      } catch {
                        // Keep raw draft in state; don't write invalid JSON to node data.
                      }
                    }}
                    rows={3}
                    className="font-mono text-xs resize-none"
                    placeholder="{}"
                  />
                </div>
                <p className="text-xs text-zinc-500">
                  Camera-path directive. Works for all video models via text-prompt fallback;
                  SV3D when available.
                </p>
              </div>
            )}

            {/* ── Section 4: match-cut verdict + accept-break (Phase 1D.1) ── */}
            {isMatchCutShot && (() => {
              const verdict = stageOutput?.match_cut_verdicts?.[shot.shot_id]
              const nextShot = data.shots[idx + 1]!
              const isLoading = acceptBreakLoading[shot.shot_id] ?? false

              const strengthChipClass =
                verdict?.match_strength === "strong"
                  ? "bg-green-500/20 text-green-300"
                  : verdict?.match_strength === "moderate"
                    ? "bg-amber-500/20 text-amber-300"
                    : verdict?.match_strength === "weak"
                      ? "bg-orange-500/20 text-orange-300"
                      : verdict?.match_strength === "break"
                        ? "bg-red-500/20 text-red-300"
                        : "bg-zinc-500/20 text-zinc-400"

              return (
                <div className="border-l-2 border-amber-400 pl-3 my-2 space-y-2">
                  <Label className="text-xs font-semibold">Match Cut</Label>

                  {/* Side-by-side thumbnails */}
                  <div className="flex gap-2">
                    {shot.keyframe_url && (
                      <img
                        src={shot.keyframe_url}
                        alt={`Shot ${shot.shot_id} keyframe`}
                        className="w-24 h-14 object-cover rounded"
                      />
                    )}
                    {nextShot.keyframe_url && (
                      <img
                        src={nextShot.keyframe_url}
                        alt={`Shot ${nextShot.shot_id} keyframe`}
                        className="w-24 h-14 object-cover rounded"
                      />
                    )}
                  </div>

                  {/* Verdict chip + actions */}
                  {!verdict ? (
                    <p className="text-xs text-zinc-500 italic">Pending critic verdict…</p>
                  ) : (
                    <div className="space-y-1">
                      <span
                        className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${strengthChipClass}`}
                      >
                        {verdict.match_strength}
                      </span>

                      {verdict.match_strength === "break" &&
                        !shot.accepted_match_cut_break && (
                          <div className="space-y-1">
                            <p className="text-xs text-zinc-400">{verdict.suggested_adjustments}</p>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              disabled={isLoading || !pipelineId || !sceneEntityId}
                              onClick={() => {
                                if (!pipelineId || !sceneEntityId) return
                                setAcceptBreakLoading((prev) => ({
                                  ...prev,
                                  [shot.shot_id]: true,
                                }))
                                pipelinesApi
                                  .acceptMatchCutBreak(pipelineId, sceneEntityId, shot.shot_id)
                                  .then(() => {
                                    patchShot(shot.shot_id, { accepted_match_cut_break: true })
                                  })
                                  .finally(() => {
                                    setAcceptBreakLoading((prev) => ({
                                      ...prev,
                                      [shot.shot_id]: false,
                                    }))
                                  })
                              }}
                            >
                              {isLoading ? "Accepting…" : "Accept break"}
                            </Button>
                          </div>
                        )}

                      {shot.accepted_match_cut_break && (
                        <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-zinc-500/20 text-zinc-400">
                          Break accepted
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )
            })()}

            {/* ── Section 5: video-critic findings (Phase 1D.2c-b-ii) ───── */}
            {hasVideoCritic && (() => {
              const findings = shotVC.video_critic_findings ?? []
              const failed = shotVC.video_critic_failed === true
              const score = shotVC.video_critic_score
              const continuityScore = shotVC.video_critic_continuity_score
              const identifiedAction = shotVC.video_critic_identified_action
              const retryCount = shotVC.video_critic_retry_count

              // Score chip color: failed = red, score < amber-threshold = amber,
              // else green. The default fallback (10) is above both
              // thresholds so a missing score renders green (informational
              // "no concern" state).
              const scoreChipClass = failed
                ? "bg-red-500/20 text-red-300"
                : (score ?? 10) < VIDEO_CRITIC_AMBER_THRESHOLD
                  ? "bg-amber-500/20 text-amber-300"
                  : "bg-green-500/20 text-green-300"

              const accentBorder = failed
                ? "border-red-400"
                : "border-zinc-300"

              return (
                <div
                  className={`border-l-2 ${accentBorder} pl-3 my-2 space-y-2`}
                  data-testid={`video-critic-${shot.shot_id}`}
                >
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-semibold">Video Critic</Label>
                    {score !== undefined && (
                      <span
                        className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${scoreChipClass}`}
                      >
                        {failed ? "Failed" : "Pass"} · {score}/10
                      </span>
                    )}
                    {continuityScore != null && (
                      <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-zinc-500/20 text-zinc-400">
                        continuity {continuityScore}/10
                      </span>
                    )}
                  </div>

                  {identifiedAction && (
                    <p className="text-xs text-zinc-500 italic">
                      Critic sees: {identifiedAction}
                    </p>
                  )}

                  {findings.length > 0 && (
                    <ul className="space-y-1">
                      {findings.map((finding, fIdx) => {
                        const severityClass =
                          finding.severity === "blocking"
                            ? "bg-red-500/20 text-red-300"
                            : "bg-amber-500/20 text-amber-300"
                        return (
                          <li key={fIdx} className="text-xs space-y-0.5">
                            <div className="flex items-center gap-1">
                              <span
                                className={`inline-block text-[10px] px-1.5 py-0 rounded-full font-medium ${severityClass}`}
                              >
                                {finding.severity}
                              </span>
                              <span className="font-mono text-[10px] text-zinc-400">
                                {finding.category}
                              </span>
                            </div>
                            <div className="text-zinc-300">{finding.description}</div>
                            {finding.suggested_fix && (
                              <div className="text-zinc-500 italic pl-3">
                                Fix: {finding.suggested_fix}
                              </div>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  {retryCount !== undefined && retryCount > 0 && (
                    <p className="text-[10px] text-zinc-500">
                      Retries used: {retryCount}
                    </p>
                  )}

                  {failed && (
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={
                          !pipelineId ||
                          !sceneEntityId ||
                          videoCriticLoading[shot.shot_id] === true
                        }
                        onClick={async () => {
                          if (!pipelineId || !sceneEntityId) return
                          setVideoCriticLoading((prev) => ({
                            ...prev,
                            [shot.shot_id]: true,
                          }))
                          try {
                            await pipelinesApi.skipShotVideoCriticFailure(
                              pipelineId,
                              sceneEntityId,
                              shot.shot_id,
                            )
                            // Mirror the server-side flip so the UI updates
                            // without waiting for the SSE round-trip. The
                            // server keeps the findings (audit trail), so we
                            // only flip the `failed` boolean here.
                            patchShot(shot.shot_id, {
                              video_critic_failed: false,
                            } as Partial<ShotSpec>)
                          } finally {
                            setVideoCriticLoading((prev) => ({
                              ...prev,
                              [shot.shot_id]: false,
                            }))
                          }
                        }}
                      >
                        {videoCriticLoading[shot.shot_id] ? "Skipping…" : "Skip"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={
                          !pipelineId ||
                          !sceneEntityId ||
                          videoCriticLoading[shot.shot_id] === true
                        }
                        onClick={async () => {
                          if (!pipelineId || !sceneEntityId) return
                          setVideoCriticLoading((prev) => ({
                            ...prev,
                            [shot.shot_id]: true,
                          }))
                          try {
                            await pipelinesApi.retryShotVideoGeneration(
                              pipelineId,
                              sceneEntityId,
                              shot.shot_id,
                            )
                            // The server strips every `video_critic_*` field
                            // and re-enqueues the orchestrator; mirror that
                            // here by patching the shot to drop the local
                            // critic fields. The orchestrator will write
                            // fresh values on the next pass. Uses the shared
                            // `clearVideoCriticMetadata` helper so the writer
                            // (Stage 7) + clearers (this + the retry route)
                            // can't drift.
                            const stripped = clearVideoCriticMetadata(
                              shot as unknown as Record<string, unknown>,
                            )
                            // patchShot does a shallow merge — to remove the
                            // critic fields we replace the whole shot.
                            const updatedShots = data.shots.map((s) =>
                              s.shot_id === shot.shot_id ? (stripped as ShotSpec) : s,
                            )
                            onUpdate({ shots: updatedShots })
                          } finally {
                            setVideoCriticLoading((prev) => ({
                              ...prev,
                              [shot.shot_id]: false,
                            }))
                          }
                        }}
                      >
                        {videoCriticLoading[shot.shot_id]
                          ? "Regenerating…"
                          : "Regenerate"}
                      </Button>
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        )
      })}
      <div className="space-y-2 pt-3 border-t border-zinc-200">
        <Label>Helpers</Label>
        <SceneHelperButtons
          pipelineId={pipelineId}
          sceneEntityId={sceneEntityId}
          data={data}
          isLoading={state.status === "loading"}
          onInvoke={(name) => {
            // Per-helper default args. The dispatch is centralized here so the
            // button component stays presentation-only.
            if (
              name === "audit_prompt" ||
              name === "add_broll" ||
              name === "anchor_scene_style"
            ) {
              void invoke(name, undefined)
              return
            }
            if (name === "improve_prompt") {
              // Phase 1B.3 simplicity: improve every shot's action+motion.
              // Phase 1B.4 will let the user select shot_ids + targets.
              void invoke(name, {
                shot_ids: ["all"],
                field_targets: ["action", "motion_prompt"],
              })
              return
            }
            if (name === "generate_motion") {
              void invoke(name, { shot_ids: ["all"] })
              return
            }
            if (name === "optimize_for_model") {
              void invoke(name, { target_model: data.video_model })
              return
            }
            if (name === "bridge_to_next_scene") {
              // Default to the second shot if it exists. User refines in 1B.4.
              const target = data.shots[1]?.shot_id
              if (target) void invoke(name, { target_shot_id: target })
              return
            }
            // audit_images / fix_continuity / validate_match_cut: disabled at
            // the button level (Phase 1C). No dispatch needed.
          }}
        />
      </div>
      <SceneHelperModal
        state={state}
        data={data}
        onAccept={(patch) => {
          onUpdate(patch)
          reset()
        }}
        onReject={reset}
      />
    </div>
  )
}
