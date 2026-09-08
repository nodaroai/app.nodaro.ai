"use client"

import { useCallback, useMemo, useState } from "react"
import { AlertTriangle, Boxes, Eye, EyeOff, Film, Lock, Pause, Play, Unlock } from "lucide-react"
import type { Scene3DPlanV2, Scene3DV2EditOperation } from "@nodaro/shared"
import type { Scene3DAssetResolver } from "@remotion-pkg/scene3d/v2/asset-resolver"
import type { Scene3DReadinessWarning } from "@remotion-pkg/scene3d/v2/errors"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Scene3DViewport } from "./scene3d-viewport"
import { Scene3DVectorRow } from "./scene3d-number-field"
import { Scene3DPendingRevisionNotice, Scene3DRevisionHistory } from "./scene3d-revision-history"
import { useScene3DPlayback } from "./use-scene3d-playback"
import {
  V2_TRANSFORM_CHANNELS,
  buildEntityColorOperation,
  buildEntityTransformOperation,
  buildEntityVisibilityOperation,
  entityViews,
  shotIndexAtFrame,
  shotViews,
  type Scene3DEntityView,
  type V2TransformChannel,
} from "@/lib/scene3d/v2-view"
import { scene3DV2Text } from "@/lib/scene3d/v2-strings"
import type { VectorAxis } from "@/lib/scene3d/edit-operations"
import type { Scene3DRevisionEntry } from "@/types/nodes"
import { useT } from "@/lib/i18n"

/**
 * A v2 edit, as the panel hands it to its host.
 *
 * Both stale fields travel with it because `applyScene3DV2EditOperations`
 * checks both: the revision the user was looking at AND its content hash. A
 * click on a snapshot the host has already replaced is then refused by the same
 * code the SDK path runs, rather than quietly applied to a different scene.
 */
export interface Scene3DV2EditRequest {
  operations: Scene3DV2EditOperation[]
  expectedRevisionId: string
  expectedContentHash: string
}

export interface Scene3DV2PreviewProps {
  /** Already validated by the caller (`validateScene3DAnyPlan`). */
  plan: Scene3DPlanV2
  /** The same plan, unvalidated — the viewport validates it itself. */
  scenePlan: Record<string, unknown>
  selectedObjectIds?: string[]
  lockedObjectIds?: string[]
  history?: Scene3DRevisionEntry[]
  pendingPlan?: Record<string, unknown>
  isGenerating?: boolean
  readOnly?: boolean
  /** Authorized asset bytes. Absent ⇒ the viewport says the scene cannot load. */
  assetResolver?: Scene3DAssetResolver
  onSelectionChange: (entityIds: string[]) => void
  onLockChange: (entityIds: string[]) => void
  /** Absent ⇒ every edit control is disabled, with the reason on screen. */
  onEditOperations?: (edit: Scene3DV2EditRequest) => void
  onRestore: (revisionId: string) => void
  onResolvePending: (adopt: boolean) => void
}

const CHANNEL_LABEL_KEYS = {
  position: "cfgext.scene3dPosition",
  rotation: "cfgext.scene3dRotation",
  scale: "cfgext.scene3dScale",
} as const

const CHANNEL_STEPS: Record<V2TransformChannel, number> = { position: 0.1, rotation: 0.05, scale: 0.05 }

/**
 * The v2 scene panel: baked viewport + shot navigation + semantic entities.
 *
 * Three things make it a different panel rather than a variant of the v1 one:
 *
 *  - **The camera is baked.** There is one global camera track and the renderer
 *    uses `samples[frame]` exactly, so there is no camera to edit here — the
 *    transport scrubs it and the shot strip jumps between cuts. Offering camera
 *    numbers would be offering an edit that the track would overwrite.
 *  - **Objects are semantic entities.** A row is a person or a vehicle, not a
 *    mesh: the identity colour, the material roles and the capability flags all
 *    come off the manifest, and a click in the viewport resolves through
 *    `nodaroEntityId` back to the entity that owns the mesh that was hit.
 *  - **Edits are proposals.** Every control emits a `Scene3DV2EditOperation`
 *    to `onEditOperations` and nothing else happens locally. The panel never
 *    applies an operation, because a v2 revision the server has not retained
 *    would render as if it were saved while its assets still belong to the
 *    revision it came from — and "saved" is not something a preview may claim.
 */
export function Scene3DV2Preview({
  plan,
  scenePlan,
  selectedObjectIds,
  lockedObjectIds,
  history,
  pendingPlan,
  isGenerating,
  readOnly = false,
  assetResolver,
  onSelectionChange,
  onLockChange,
  onEditOperations,
  onRestore,
  onResolvePending,
}: Scene3DV2PreviewProps) {
  const t = useT()
  const V2_TEXT = scene3DV2Text(t)
  const [warnings, setWarnings] = useState<readonly Scene3DReadinessWarning[]>([])

  const { frame, playing, setPlaying, seek, lastFrame } = useScene3DPlayback(plan.durationInFrames, plan.fps)

  const locked = lockedObjectIds ?? []
  const selected = selectedObjectIds ?? []
  const shots = useMemo(() => shotViews(plan), [plan])
  const entities = useMemo(() => entityViews(plan, { lockedObjectIds: locked }), [plan, locked])
  const activeShot = shotIndexAtFrame(plan, frame)
  const active = entities.find((entity) => entity.id === selected[0])

  // Editing needs BOTH a host that can persist a revision and permission to
  // change anything. The reason is shown, because a panel full of dead controls
  // with no explanation reads as a bug.
  const editingEnabled = !readOnly && onEditOperations !== undefined

  const emit = useCallback(
    (operation: Scene3DV2EditOperation | null) => {
      if (!operation || !onEditOperations || readOnly) return
      onEditOperations({
        operations: [operation],
        expectedRevisionId: plan.revisionId,
        expectedContentHash: plan.provenance.contentHash,
      })
    },
    [onEditOperations, plan.revisionId, plan.provenance.contentHash, readOnly],
  )

  const toggleSelected = (entityId: string) => {
    onSelectionChange(selected.includes(entityId) ? selected.filter((id) => id !== entityId) : [...selected, entityId])
  }
  const toggleLocked = (entityId: string) => {
    if (readOnly) return
    onLockChange(locked.includes(entityId) ? locked.filter((id) => id !== entityId) : [...locked, entityId])
  }

  return (
    <div className="flex flex-col gap-2">
      <Scene3DViewport
        plan={scenePlan}
        frame={frame}
        selectedObjectIds={selected}
        onSelectObject={(entityId) => onSelectionChange(entityId ? [entityId] : [])}
        assetResolver={assetResolver}
        onReadinessWarnings={setWarnings}
      />

      {/* Transport. The camera is baked, so this is the ONLY camera control. */}
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
          {(frame / plan.fps).toFixed(2)}s
        </span>
      </div>

      {/* Shots — hard cuts over one global track, so jumping to one is a seek
          to its first frame and nothing else changes. */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Film className="w-3 h-3" />
          <span>{V2_TEXT.shots}</span>
          <span className="ml-auto">{V2_TEXT.bakedCamera}</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {shots.map((shot) => (
            <button
              key={shot.id}
              type="button"
              aria-label={`${V2_TEXT.shot(shot.index + 1)} — ${shot.label}`}
              aria-pressed={shot.index === activeShot}
              onClick={() => seek(shot.startFrame)}
              className={`rounded px-1.5 py-0.5 text-[10px] border ${
                shot.index === activeShot
                  ? "border-[#ff0073]/50 bg-[#ff0073]/10 text-foreground"
                  : "border-[var(--border-primary)] text-muted-foreground hover:bg-muted/40"
              }`}
            >
              {shot.label}
              <span className="ml-1 text-muted-foreground/60 tabular-nums">{shot.startFrame}</span>
            </button>
          ))}
        </div>
      </div>

      {pendingPlan && <Scene3DPendingRevisionNotice readOnly={readOnly} onResolve={onResolvePending} />}

      {!editingEnabled && !readOnly && (
        <p className="text-[10px] text-muted-foreground" role="note">
          {V2_TEXT.editNeedsApi}
        </p>
      )}

      {warnings.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 flex flex-col gap-0.5">
          {warnings.map((warning, index) => (
            <p key={`${warning.code}-${index}`} className="text-[10px] text-amber-500 flex items-start gap-1">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              <span>
                {warning.message}
                {warning.subject ? ` (${warning.subject})` : ""}
              </span>
            </p>
          ))}
        </div>
      )}

      {/* Entities */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Boxes className="w-3 h-3" />
          <span>{V2_TEXT.entityCount(entities.length)}</span>
          <span className="ml-auto font-mono">rev {plan.revisionId.slice(0, 8)}</span>
        </div>
        <div className="max-h-40 overflow-y-auto flex flex-col gap-0.5">
          {entities.map((entity) => {
            const isSelected = selected.includes(entity.id)
            const isLocked = locked.includes(entity.id)
            return (
              <div
                key={entity.id}
                style={{ paddingLeft: `${Math.min(entity.depth, 6) * 8 + 6}px` }}
                className={`flex items-center gap-1.5 rounded pr-1.5 py-1 text-[11px] ${
                  isSelected ? "bg-[#ff0073]/10 border border-[#ff0073]/30" : "border border-transparent hover:bg-muted/40"
                }`}
              >
                <button
                  type="button"
                  className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
                  aria-pressed={isSelected}
                  onClick={() => toggleSelected(entity.id)}
                >
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm border border-white/20 shrink-0"
                    style={{ backgroundColor: entity.color, opacity: entity.visible ? 1 : 0.35 }}
                  />
                  <span className={`truncate ${entity.visible ? "" : "text-muted-foreground line-through"}`}>
                    {entity.name}
                  </span>
                  <span className="text-[9px] text-muted-foreground shrink-0">{entity.role ?? entity.kind}</span>
                </button>
                {editingEnabled && entity.can.visibility && (
                  <button
                    type="button"
                    aria-label={`${entity.visible ? V2_TEXT.hidden : V2_TEXT.visible} ${entity.name}`}
                    className="text-muted-foreground/50 hover:text-muted-foreground"
                    onClick={() => emit(buildEntityVisibilityOperation(entity, !entity.visible))}
                  >
                    {entity.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  </button>
                )}
                {readOnly ? (
                  isLocked && <Lock role="img" aria-label={`${entity.name} locked`} className="w-3 h-3 text-amber-500" />
                ) : (
                  <button
                    type="button"
                    aria-label={isLocked ? `Unlock ${entity.name}` : `Lock ${entity.name}`}
                    aria-pressed={isLocked}
                    className={isLocked ? "text-amber-500" : "text-muted-foreground/50 hover:text-muted-foreground"}
                    onClick={() => toggleLocked(entity.id)}
                  >
                    {isLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                  </button>
                )}
              </div>
            )
          })}
          {entities.length === 0 && (
            <p className="text-[11px] text-muted-foreground py-1">{t("cfgext.scene3dNoObjects")}</p>
          )}
        </div>
      </div>

      {active && <EntityInspector entity={active} enabled={editingEnabled} onEmit={emit} plan={plan} />}

      <Scene3DRevisionHistory
        history={history ?? []}
        activeRevisionId={plan.revisionId}
        readOnly={readOnly}
        onRestore={onRestore}
      />

      {isGenerating && (
        <p className="text-[10px] text-muted-foreground">{t("cfgext.scene3dLiveWhileRunning")}</p>
      )}
    </div>
  )
}

/**
 * The selected entity's overlay controls.
 *
 * Everything here writes an OVERRIDE, and an override replaces only the
 * channels it names — so the transform rows show the effective value (override
 * where one exists, manifest base otherwise) and each commit carries forward
 * the channels that were already overridden. For an `asset` entity the label
 * says where placement really comes from, because the manifest transform there
 * is an informational snapshot the renderer does not apply.
 */
function EntityInspector({
  entity,
  enabled,
  plan,
  onEmit,
}: {
  entity: Scene3DEntityView
  enabled: boolean
  plan: Scene3DPlanV2
  onEmit: (operation: Scene3DV2EditOperation | null) => void
}) {
  const t = useT()
  const V2_TEXT = scene3DV2Text(t)
  return (
    <>
      <Separator />
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium truncate">{entity.name}</span>
          {entity.placementFromAsset && (
            <span className="text-[9px] text-muted-foreground/70">{V2_TEXT.glbPlacement}</span>
          )}
        </div>

        {entity.transform ? (
          V2_TRANSFORM_CHANNELS.map((channel) => (
            <Scene3DVectorRow
              key={channel}
              label={t(CHANNEL_LABEL_KEYS[channel])}
              step={CHANNEL_STEPS[channel]}
              namePrefix={entity.name}
              vector={entity.transform![channel]}
              disabled={!enabled || !entity.can.transform}
              labelSuffix={
                entity.transformOverridden ? (
                  <span className="text-[9px] text-[#ff0073] shrink-0">{V2_TEXT.overridden}</span>
                ) : undefined
              }
              onCommitAxis={(axis: VectorAxis, next: number) =>
                onEmit(buildEntityTransformOperation(plan, entity, channel, axis, next))
              }
            />
          ))
        ) : (
          <p className="text-[10px] text-muted-foreground">{V2_TEXT.glbPlacement}</p>
        )}

        {entity.materials.map((material) => (
          <div key={material.role} className="grid grid-cols-[52px_1fr] items-center gap-1">
            <span className="text-[10px] text-muted-foreground truncate" title={material.role}>
              {material.role}
            </span>
            <input
              type="color"
              aria-label={`${entity.name} ${material.role} color`}
              value={material.color}
              disabled={!enabled || !entity.can.color}
              onChange={(e) => onEmit(buildEntityColorOperation(entity, material.role, e.target.value))}
              className="h-7 w-full rounded border border-[var(--border-primary)] bg-transparent"
            />
          </div>
        ))}
      </div>
    </>
  )
}
