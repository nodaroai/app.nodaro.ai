"use client"

import { useCallback, useMemo, useState } from "react"
import { Play, Pause, Lock, Unlock, Boxes, AlertTriangle } from "lucide-react"
import { sampleScene3DFrame } from "@remotion-pkg/scene3d/sampler"
import type { Scene3DObject } from "@nodaro/shared"
// Type-only, and from the SUBPATH — importing the `scene3d` index here would
// pull three.js into every chunk that renders this panel, including the embed.
import type { Scene3DAssetResolver } from "@remotion-pkg/scene3d/v2/asset-resolver"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Scene3DViewport } from "./scene3d-viewport"
import { Scene3DVectorRow, Scene3DNumberField } from "./scene3d-number-field"
import { Scene3DPendingRevisionNotice, Scene3DRevisionHistory } from "./scene3d-revision-history"
import { Scene3DV2Preview, type Scene3DV2EditRequest } from "./scene3d-v2-preview"
import { useScene3DPlayback } from "./use-scene3d-playback"
import {
  planObjects,
  planCamera,
  planFps,
  planDurationInFrames,
  planBackgroundColor,
  planRevisionId,
  type Vec3,
} from "@/lib/scene3d/plan-view"
import { validateScene3DAnyPlan, validateScene3DPlan } from "@/lib/scene3d/validate-plan"
import {
  buildObjectColorOperation,
  buildBackgroundOperation,
  clampChannelValue,
  clampCoordinate,
  clampFocalLength,
  type Scene3DEditOperationLike,
  type ObjectVectorChannel,
  type VectorAxis,
} from "@/lib/scene3d/edit-operations"
import {
  buildObjectPoseEdit,
  buildCameraPoseEdit,
  buildCameraFocalPoseEdit,
  poseEditMode,
  type PoseEditMode,
  type PoseEditPlan,
} from "@/lib/scene3d/pose-edit"
import { applyLocalSceneEdits } from "@/lib/scene3d/apply-local-edit"
import type { Scene3DRevisionEntry } from "@/types/nodes"
import { useT, type TFunction } from "@/lib/i18n"

const OBJECT_CHANNELS: ReadonlyArray<{ channel: ObjectVectorChannel; labelKey: Parameters<TFunction>[0]; step: number }> = [
  { channel: "position", labelKey: "cfgext.scene3dPosition", step: 0.1 },
  { channel: "rotation", labelKey: "cfgext.scene3dRotation", step: 0.05 },
  { channel: "scale", labelKey: "cfgext.scene3dScale", step: 0.05 },
  { channel: "dimensions", labelKey: "cfgext.scene3dSize", step: 0.05 },
]

export interface Scene3DPreviewProps {
  scenePlan: Record<string, unknown>
  selectedObjectIds?: string[]
  lockedObjectIds?: string[]
  history?: Scene3DRevisionEntry[]
  /** A completed job's revision that lost the stale-completion race. */
  pendingPlan?: Record<string, unknown>
  /** True while a generate/edit job is running — the scene stays live, edits keep working. */
  isGenerating?: boolean
  /**
   * Look, don't touch. Playback, scrubbing and selection stay live; every
   * MUTATION — a numeric/colour commit, a lock toggle, a restore, resolving a
   * pending revision — is withheld.
   *
   * Enforced in BOTH directions: the controls that would produce a mutation are
   * disabled or not rendered, AND the callbacks refuse. Disabling alone is not a
   * guard (a `change` event still dispatches against a disabled input in jsdom,
   * and a control can be re-enabled from devtools); refusing alone would leave
   * live-looking controls that do nothing.
   *
   * Defaults to FALSE so the editor canvas — the only caller before the embed —
   * behaves exactly as it did.
   */
  readOnly?: boolean
  onSelectionChange: (objectIds: string[]) => void
  onLockChange: (objectIds: string[]) => void
  /** A NEW immutable revision produced by a deterministic edit. v1 ONLY: a v2
   *  scene's edits are operations, not plans (see `onEditOperations`). */
  onPlanChange: (plan: Record<string, unknown>, changeSummary: string) => void
  onRestore: (revisionId: string) => void
  onResolvePending: (adopt: boolean) => void
  /**
   * Authorized bytes for a v2 scene's assets. Ignored for v1, REQUIRED for v2 —
   * the manifest carries ids and digests, never a transport URL.
   *
   * Deliberately a prop and not something this component builds: the same panel
   * renders inside `/embed/scene3d`, which has no session and must not have one
   * in its module graph. The editor passes
   * `scene3d-preview-authenticated.tsx`'s SDK-backed resolver; the embed passes
   * one that asks its parent frame over `postMessage`.
   */
  assetResolver?: Scene3DAssetResolver
  /**
   * Where a v2 edit goes. Absent ⇒ v2 editing is disabled with a visible
   * reason. The panel never applies a v2 operation itself — see
   * `scene3d-v2-preview.tsx`.
   */
  onEditOperations?: (edit: Scene3DV2EditRequest) => void
}

/**
 * Version dispatch. The scene decides which panel renders, and neither panel
 * has to ask what it is holding.
 *
 * The validator is the same memoized one the viewport uses, so this costs one
 * parse per revision for the whole panel — and an unparseable plan falls
 * through to the v1 panel, which is the one that knows how to show a scene it
 * cannot read (list what is there, explain the issue, keep the data).
 */
export function Scene3DPreview(props: Scene3DPreviewProps) {
  const validation = useMemo(() => validateScene3DAnyPlan(props.scenePlan), [props.scenePlan])
  if (validation.ok && validation.version === 2) {
    return (
      <Scene3DV2Preview
        plan={validation.plan}
        scenePlan={props.scenePlan}
        selectedObjectIds={props.selectedObjectIds}
        lockedObjectIds={props.lockedObjectIds}
        history={props.history}
        pendingPlan={props.pendingPlan}
        isGenerating={props.isGenerating}
        readOnly={props.readOnly}
        assetResolver={props.assetResolver}
        onSelectionChange={props.onSelectionChange}
        onLockChange={props.onLockChange}
        onEditOperations={props.onEditOperations}
        onRestore={props.onRestore}
        onResolvePending={props.onResolvePending}
      />
    )
  }
  return <Scene3DV1Preview {...props} />
}

/**
 * The 3D scene panel: viewport + transport + selection + numeric editing +
 * revision history.
 *
 * Every value edit here goes through `applyLocalSceneEdits` — the SAME
 * `applyScene3DEditOperations` the API route runs — so a nudge on the canvas
 * and the identical nudge made through the SDK produce the same revision. No
 * LLM is called and no credits are spent: the change is visible immediately.
 *
 * **The numbers are the pose at the CURRENT FRAME, not the plan's base values.**
 * The sampler treats the base as an implicit frame-0 keyframe that an explicit
 * frame-0 key overrides, so editing the base on an animated object is a
 * successful edit with no visible effect at any frame — the user drags a
 * number and the scene does not move. Reading and writing through
 * `pose-edit.ts` (which shares the renderer's sampler, so preview and export
 * cannot disagree) makes every commit change what is on screen, and the badge
 * next to each row says whether it will write the base or a keyframe.
 */
function Scene3DV1Preview({
  scenePlan,
  selectedObjectIds,
  lockedObjectIds,
  history,
  pendingPlan,
  isGenerating,
  readOnly = false,
  onSelectionChange,
  onLockChange,
  onPlanChange,
  onRestore,
  onResolvePending,
}: Scene3DPreviewProps) {
  const t = useT()
  const [error, setError] = useState<string | null>(null)

  const fps = planFps(scenePlan)
  const durationInFrames = planDurationInFrames(scenePlan)
  // Defensive readers drive the LIST (a plan that fails validation must still
  // show what it holds); the validated plan drives sampling and editing.
  const objects = useMemo(() => planObjects(scenePlan), [scenePlan])
  const baseCamera = useMemo(() => planCamera(scenePlan), [scenePlan])
  const background = planBackgroundColor(scenePlan)
  const revisionId = planRevisionId(scenePlan)

  const validation = useMemo(() => validateScene3DPlan(scenePlan), [scenePlan])
  const validPlan = validation.ok ? validation.plan : null

  const { frame, playing, setPlaying, seek, lastFrame } = useScene3DPlayback(durationInFrames, fps)

  // One sample per (plan, frame) — the same call the exported MP4 makes.
  const sample = useMemo(
    () => (validPlan ? sampleScene3DFrame(validPlan, frame) : null),
    [validPlan, frame],
  )

  const selected = selectedObjectIds ?? []
  const locked = lockedObjectIds ?? []
  const activeObjectView = objects.find((o) => o.id === selected[0])
  const activeObject: Scene3DObject | undefined = validPlan?.objects.find((o) => o.id === selected[0])
  const activeSample = activeObjectView ? sample?.byId[activeObjectView.id] : undefined
  const cameraSample = sample?.camera

  const applyOperation = useCallback(
    (operation: Scene3DEditOperationLike | null) => {
      if (!operation || readOnly) return
      // `lockedObjectIds` is passed so the canvas obeys the SAME lock the model
      // is held to — a locked object is not editable by hand either.
      const result = applyLocalSceneEdits(scenePlan, [operation], { lockedObjectIds })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setError(null)
      onPlanChange(result.plan, result.changeSummary)
    },
    [scenePlan, onPlanChange, lockedObjectIds, readOnly],
  )

  /** Apply a pose edit, surfacing its one refusal (the keyframe cap) as UI copy. */
  const applyPoseEdit = useCallback(
    (plan: PoseEditPlan) => {
      if (!plan) return
      if (!plan.ok) {
        setError(t("cfgext.scene3dKeyframeLimit"))
        return
      }
      applyOperation(plan.operation)
    },
    [applyOperation, t],
  )

  const toggleSelected = (objectId: string) => {
    onSelectionChange(selected.includes(objectId) ? selected.filter((id) => id !== objectId) : [...selected, objectId])
  }
  const toggleLocked = (objectId: string) => {
    if (readOnly) return
    onLockChange(locked.includes(objectId) ? locked.filter((id) => id !== objectId) : [...locked, objectId])
  }
  const restore = (revisionId: string) => {
    if (readOnly) return
    onRestore(revisionId)
  }
  const resolvePending = (adopt: boolean) => {
    if (readOnly) return
    onResolvePending(adopt)
  }

  /** "Base pose" / "Keyframe @ N" — so the write is labelled, not guessed. */
  const modeBadge = (mode: PoseEditMode) => (
    <span
      className={`text-[9px] shrink-0 ${mode === "base" ? "text-muted-foreground/60" : "text-[#ff0073]"}`}
      title={mode === "base" ? t("cfgext.scene3dModeBaseHint") : t("cfgext.scene3dModeKeyframeHint")}
    >
      {mode === "base" ? t("cfgext.scene3dModeBase") : t("cfgext.scene3dModeKeyframe", { frame })}
    </span>
  )

  /** The vector the controls show for one object channel at the current frame. */
  const channelVector = (channel: ObjectVectorChannel): Vec3 => {
    if (!activeObjectView) return [0, 0, 0]
    if (channel === "dimensions" || !activeSample) return activeObjectView[channel]
    return activeSample[channel] as Vec3
  }

  const editsDisabled = !validPlan || readOnly

  return (
    <div className="flex flex-col gap-2">
      <Scene3DViewport
        plan={scenePlan}
        frame={frame}
        selectedObjectIds={selected}
        onSelectObject={(objectId) => onSelectionChange(objectId ? [objectId] : [])}
      />

      {/* Transport */}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => setPlaying(!playing)}
        >
          {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </Button>
        <input
          type="range"
          min={0}
          max={lastFrame}
          step={1}
          value={frame}
          aria-label="Scrub"
          onChange={(e) => seek(Number.parseInt(e.target.value, 10))}
          className="w-full accent-[#ff0073]"
        />
        <span className="text-[10px] font-mono text-muted-foreground shrink-0 tabular-nums">
          {(frame / fps).toFixed(2)}s
        </span>
      </div>

      {/* An invalid plan keeps ALL of its data and keeps painting the list; only
          editing is off, because the shared applier would refuse it anyway. */}
      {!validation.ok && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 flex items-start gap-1.5" role="alert">
          <AlertTriangle className="w-3 h-3 text-amber-500 mt-0.5 shrink-0" />
          <p className="text-[11px] text-amber-500">
            {t("cfgext.scene3dInvalidPlan")} — {validation.issue}
          </p>
        </div>
      )}

      {pendingPlan && <Scene3DPendingRevisionNotice readOnly={readOnly} onResolve={resolvePending} />}

      {error && (
        <p className="text-[11px] text-red-500" role="alert">{error}</p>
      )}

      {/* Objects */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Boxes className="w-3 h-3" />
          <span>{t("cfgext.scene3dObjectCount", { count: objects.length })}</span>
          {revisionId && <span className="ml-auto font-mono">rev {revisionId.slice(0, 8)}</span>}
        </div>
        <div className="max-h-40 overflow-y-auto flex flex-col gap-0.5">
          {objects.map((object) => {
            const isSelected = selected.includes(object.id)
            const isLocked = locked.includes(object.id)
            return (
              <div
                key={object.id}
                className={`flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px] ${
                  isSelected ? "bg-[#ff0073]/10 border border-[#ff0073]/30" : "border border-transparent hover:bg-muted/40"
                }`}
              >
                <button
                  type="button"
                  className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
                  aria-pressed={isSelected}
                  onClick={() => toggleSelected(object.id)}
                >
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm border border-white/20 shrink-0"
                    style={{ backgroundColor: object.color }}
                  />
                  <span className="truncate">{object.name}</span>
                  <span className="text-[9px] text-muted-foreground shrink-0">{object.primitive}</span>
                  {object.keyframeCount > 0 && (
                    <span className="text-[9px] text-muted-foreground/70 shrink-0">{object.keyframeCount}k</span>
                  )}
                </button>
                {readOnly ? (
                  // Read-only still SHOWS the lock (it explains why the model
                  // left an object alone) — as a static badge, not a control.
                  isLocked && (
                    <Lock role="img" aria-label={`${object.name} locked`} className="w-3 h-3 text-amber-500" />
                  )
                ) : (
                  <button
                    type="button"
                    aria-label={isLocked ? `Unlock ${object.name}` : `Lock ${object.name}`}
                    aria-pressed={isLocked}
                    className={isLocked ? "text-amber-500" : "text-muted-foreground/50 hover:text-muted-foreground"}
                    onClick={() => toggleLocked(object.id)}
                  >
                    {isLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                  </button>
                )}
              </div>
            )
          })}
          {objects.length === 0 && (
            <p className="text-[11px] text-muted-foreground py-1">{t("cfgext.scene3dNoObjects")}</p>
          )}
        </div>
      </div>

      {/* Numeric editing for the first selected object, AT THE CURRENT FRAME */}
      {activeObjectView && (
        <>
          <Separator />
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium truncate">{activeObjectView.name}</span>
              {locked.includes(activeObjectView.id) && (
                <span className="text-[9px] text-amber-500 inline-flex items-center gap-0.5">
                  <Lock className="w-2.5 h-2.5" /> {t("cfgext.scene3dLockedForModel")}
                </span>
              )}
            </div>
            {OBJECT_CHANNELS.map(({ channel, labelKey, step }) => {
              const vector = channelVector(channel)
              const mode = poseEditMode(
                activeObject?.keyframes ?? [],
                channel,
                frame,
                channel !== "dimensions",
              )
              return (
                <div key={channel} className="flex flex-col gap-0.5">
                  <Scene3DVectorRow
                    label={t(labelKey)}
                    step={step}
                    namePrefix={activeObjectView.name}
                    vector={vector}
                    disabled={editsDisabled}
                    labelSuffix={modeBadge(mode)}
                    onCommitAxis={(axis: VectorAxis, next: number) => {
                      if (!activeObject) return
                      applyPoseEdit(
                        buildObjectPoseEdit({
                          object: activeObject,
                          channel,
                          sampled: vector,
                          axis,
                          value: next,
                          clampedValue: clampChannelValue(channel, next),
                          frame,
                        }),
                      )
                    }}
                  />
                </div>
              )
            })}
            <div className="grid grid-cols-[52px_1fr] items-center gap-1">
              <span className="text-[10px] text-muted-foreground">{t("cfgext.scene3dColor")}</span>
              <input
                type="color"
                aria-label={`${activeObjectView.name} color`}
                value={activeObjectView.color}
                disabled={editsDisabled}
                onChange={(e) =>
                  applyOperation(
                    buildObjectColorOperation(activeObjectView.id, e.target.value, activeObjectView.color),
                  )
                }
                className="h-7 w-full rounded border border-[var(--border-primary)] bg-transparent"
              />
            </div>
          </div>
        </>
      )}

      {/* Camera + background */}
      <Separator />
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium">{t("cfgext.scene3dCamera")}</span>
        {(["position", "target"] as const).map((channel) => {
          const vector = (cameraSample?.[channel] ?? baseCamera[channel]) as Vec3
          const mode = poseEditMode(
            validPlan?.camera.keyframes ?? [],
            channel,
            frame,
            true,
          )
          return (
            <Scene3DVectorRow
              key={channel}
              label={t(channel === "position" ? "cfgext.scene3dPosition" : "cfgext.scene3dTarget")}
              namePrefix="Camera"
              vector={vector}
              disabled={editsDisabled}
              labelSuffix={modeBadge(mode)}
              onCommitAxis={(axis: VectorAxis, next: number) => {
                if (!validPlan) return
                applyPoseEdit(
                  buildCameraPoseEdit({
                    camera: validPlan.camera,
                    channel,
                    sampled: vector,
                    axis,
                    clampedValue: clampCoordinate(next),
                    frame,
                  }),
                )
              }}
            />
          )
        })}
        <div className="grid grid-cols-[52px_1fr] items-center gap-1">
          <span className="text-[10px] text-muted-foreground">{t("cfgext.scene3dLens")}</span>
          <Scene3DNumberField
            value={cameraSample?.focalLengthMm ?? baseCamera.focalLengthMm}
            step={1}
            disabled={editsDisabled}
            ariaLabel="Camera focal length"
            onCommit={(next) => {
              if (!validPlan) return
              applyPoseEdit(
                buildCameraFocalPoseEdit({
                  camera: validPlan.camera,
                  sampled: cameraSample?.focalLengthMm ?? baseCamera.focalLengthMm,
                  clampedValue: clampFocalLength(next),
                  frame,
                }),
              )
            }}
          />
        </div>
        <div className="grid grid-cols-[52px_1fr] items-center gap-1">
          <span className="text-[10px] text-muted-foreground">{t("cfgext.scene3dBackdrop")}</span>
          <input
            type="color"
            aria-label="Background color"
            value={background}
            disabled={editsDisabled}
            onChange={(e) => applyOperation(buildBackgroundOperation(e.target.value, background))}
            className="h-7 w-full rounded border border-[var(--border-primary)] bg-transparent"
          />
        </div>
      </div>

      {/* Revision history */}
      <Scene3DRevisionHistory
        history={history ?? []}
        activeRevisionId={revisionId}
        readOnly={readOnly}
        onRestore={restore}
      />


      {isGenerating && (
        <p className="text-[10px] text-muted-foreground">{t("cfgext.scene3dLiveWhileRunning")}</p>
      )}
    </div>
  )
}
