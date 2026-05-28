"use client"

import { memo, useEffect } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { UserCircle, Loader2, Type } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover } from "./handle-with-popover"
import { isValidCharacterConnection } from "@/lib/identity-handles"
import { VISUAL_PARAMETER_PICKER_NODE_TYPES } from "@/lib/parameter-picker-types"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { CachedImage } from "@/components/ui/cached-image"
import { useFullResolution } from "@/hooks/use-full-resolution"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { hasCredits } from "@/lib/edition"
import { createClient } from "@/lib/supabase"
import { TrainedPill } from "@/components/editor/trained-pill"
import { PipelineStateOverlay } from "./pipeline-state-overlay"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { USAGE_MODES, DEFAULT_USAGE_MODE, usageModeLabel, type UsageMode } from "@nodaro/shared"
import type { CharacterNodeData } from "@/types/nodes"

const isPickerType = (s: string) => VISUAL_PARAMETER_PICKER_NODE_TYPES.has(s)
const ACCEPTS_PROMPT = (t: string) => isValidCharacterConnection("in", t, isPickerType)

function CharacterNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as CharacterNodeData
  const credits = useModelCredits((nodeData.provider as string | undefined) ?? "nano-banana", 2)
  const useFull = useFullResolution(id)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const setCharacterStudioNodeId = useWorkflowStore((s) => s.setCharacterStudioNodeId)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"

  const expressionCount = (nodeData.expressions ?? []).length
  const poseCount = (nodeData.poses ?? []).length
  const motionCount = (nodeData.motions ?? []).length
  // Per-canvas-node default asset (frontend-only). When the user star'd an
  // asset in the Character Studio, that URL drives the thumbnail here; falls
  // back to the approved portrait URL otherwise. Two character nodes that
  // reference the same DB character can show different thumbnails because
  // `defaultAssetUrl` lives on node data, not the DB row.
  const thumbnailUrl = nodeData.defaultAssetUrl || nodeData.sourceImageUrl
  const thumbnailLabel = nodeData.defaultAssetName || nodeData.characterName || "Character"
  // Whether to render the thumbnail as a <video> rather than a <CachedImage>.
  // Heuristic: if the default-asset URL is in the node's motions array, OR
  // its file extension looks like a video, render as video. Otherwise the
  // CachedImage path takes it (R2 image proxy + thumbnail variants).
  const isVideoDefault =
    nodeData.defaultAssetUrl !== undefined &&
    ((nodeData.motions ?? []).some((m) => m.url === nodeData.defaultAssetUrl) ||
      /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(nodeData.defaultAssetUrl))
  const anyAssetRunning =
    nodeData.expressionStatus === "running" ||
    nodeData.poseStatus === "running" ||
    nodeData.lightingStatus === "running" ||
    nodeData.anglesStatus === "running" ||
    nodeData.motionStatus === "running"

  // Per-canvas-node thumbnail aspect ratio (frontend-only). Default to "1:1"
  // for backwards compat — most existing character thumbnails are square. The
  // CSS `aspect-ratio` property accepts "W / H" form, so we translate "16:9"
  // → "16 / 9" at render time. The image inside uses `object-fit: cover` so
  // it crops cleanly regardless of source dimensions.
  const aspectRatio = nodeData.defaultAssetAspectRatio ?? "1:1"
  const aspectRatioCss = aspectRatio.replace(":", " / ")

  // ── Character LoRA training (Cloud edition) ──────────────────────────────
  // Backfill `lora_*` fields onto CharacterNodeData on mount when they're
  // absent — this is the path that handles workflows saved BEFORE training
  // existed. The orchestrator's expandWiredCharacterRefs reads these straight
  // off node data, so without this backfill, pre-existing workflows would
  // silently route through ref injection forever (per design §9.2).
  useEffect(() => {
    if (!hasCredits()) return
    if (nodeData.loraTrainingStatus !== undefined) return
    if (!nodeData.characterDbId) return
    let cancelled = false
    ;(async () => {
      const supabase = createClient()
      // Cast: the Supabase JS generated types don't know about migration 126
      // columns yet — we shipped the columns + the typegen out-of-band. The
      // values are still validated by the migration's CHECK constraint.
      const { data } = await supabase
        .from("characters")
        .select("lora_replicate_version, lora_trigger_word, lora_training_status")
        .eq("id", nodeData.characterDbId)
        .single()
      const row = data as unknown as {
        lora_replicate_version: string | null
        lora_trigger_word: string | null
        lora_training_status: string | null
      } | null
      if (cancelled || !row) return
      updateNodeData(id, {
        loraReplicateVersion: row.lora_replicate_version,
        loraTriggerWord: row.lora_trigger_word,
        loraTrainingStatus: row.lora_training_status,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [nodeData.characterDbId, nodeData.loraTrainingStatus, id, updateNodeData])

  // The variant suffix in "Kira • Smiling" should only show when the user
  // actually picked a non-canonical asset as the default. Skip when the asset
  // name is missing, equals "canonical" (the default portrait), or matches
  // the character's own name (which happens for some canonical sources).
  const variantName = nodeData.defaultAssetName
  const showVariantSuffix =
    !!nodeData.defaultAssetUrl &&
    !!variantName &&
    variantName !== "canonical" &&
    variantName !== nodeData.characterName

  return (
    <div className="relative animate-fade-in-scale" style={{ width: "100%", height: "100%" }}>
    <PipelineStateOverlay
      state={nodeData.pipeline_state}
      isStale={nodeData.is_stale}
    />
    <EditableNodeLabel
      label={nodeData.label}
      icon={<UserCircle className="w-3.5 h-3.5" />}
      onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
    />
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<UserCircle className="h-4 w-4" />}
      category="character"
      credits={credits}
      selected={selected}
      isRunning={status === "running" || anyAssetRunning}
      hideHeader
      topToolbarContent={
        <RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
      }
      handles={[
        { id: "in",           type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true },
        { id: "characterRef", type: "source", position: Position.Right, customStyle: { top: '24px',              right: '-29px' }, external: true },
      ]}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#1a2744] border-b border-[#1e3a6e]">
        <span className="text-[11px]">👤</span>
        <span className="text-[11px] font-semibold text-[#93c5fd]">Character</span>
        <span className="ml-auto text-[9px] text-[#3b82f6] bg-[#0f1e40] px-1.5 py-0.5 rounded">entity</span>
      </div>

      {nodeData.loraTrainingStatus === "succeeded" && (
        <div className="absolute top-1.5 right-1.5 z-10">
          <TrainedPill size="sm" />
        </div>
      )}
      {(nodeData.loraTrainingStatus === "queued" ||
        nodeData.loraTrainingStatus === "training") && (
        <div className="absolute top-1.5 right-1.5 z-10 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/60 text-[9px] text-slate-300 border border-slate-600">
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
          Training…
        </div>
      )}

      {/* Portrait preview — uses defaultAssetUrl when the user star'd a
          studio asset, otherwise falls back to the approved portrait. The
          outer container uses `aspect-ratio` CSS so the image height tracks
          the node width as the user resizes; the image inside is sized to
          100% × 100% with `object-fit: cover` so it crops cleanly without
          stretching regardless of the source dimensions. */}
      <div className="px-2.5 pt-2.5">
        {thumbnailUrl ? (
          <div className="relative group/thumb w-full" style={{ aspectRatio: aspectRatioCss }}>
            {isVideoDefault ? (
              <video
                src={thumbnailUrl}
                className="w-full h-full object-cover rounded-md border border-[#334155] bg-black"
                muted
                playsInline
                loop
                autoPlay
                preload="metadata"
              />
            ) : (
              <CachedImage
                src={thumbnailUrl}
                alt={thumbnailLabel}
                className="w-full h-full object-cover rounded-md border border-[#334155]"
                thumbnail={!useFull}
                thumbnailWidth={320}
              />
            )}
            {nodeData.defaultAssetUrl && (
              // Small ★ marker so users see at-a-glance this thumbnail is
              // a chosen default (not the portrait fallback).
              <span
                aria-hidden
                title={`Default: ${nodeData.defaultAssetName ?? ""}`}
                className="absolute top-1 left-1 px-1 rounded-full bg-black/50 text-[8px] text-yellow-400 leading-tight border border-yellow-400/40"
              >
                ★
              </span>
            )}
            {/* Aspect-ratio toggle. Shows on hover over the thumbnail; the
                active option is highlighted in brand-pink. Clicks call
                `stopPropagation` so toggling doesn't also select the node
                or open the config panel.

                Picking a value here ALSO overrides the per-asset-type
                aspect-ratio default on the next character generation (flows
                in as `characterNodeAspectRatio` to the generate-character*
                routes — explicit `aspectRatio` on the call still wins). */}
            <div className="absolute top-1 right-1 flex gap-0.5 bg-black/60 backdrop-blur-sm rounded px-0.5 py-0.5 opacity-0 group-hover/thumb:opacity-100 transition-opacity">
              {(["1:1", "3:4", "16:9", "9:16"] as const).map((ar) => {
                const isActive = aspectRatio === ar
                return (
                  <button
                    key={ar}
                    type="button"
                    aria-label={`Set character aspect ratio to ${ar}`}
                    aria-pressed={isActive}
                    onClick={(e) => {
                      e.stopPropagation()
                      updateNodeData(id, { defaultAssetAspectRatio: ar })
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    className={`text-[9px] leading-none px-1 py-0.5 rounded ${
                      isActive
                        ? "bg-[#ff0073] text-white"
                        : "text-slate-300 hover:text-white hover:bg-white/10"
                    }`}
                  >
                    {ar}
                  </button>
                )
              })}
            </div>
            {status === "running" && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded-md">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        ) : (
          <div
            className="w-full rounded-md border border-dashed border-[#334155] flex items-center justify-center text-[10px] text-[#3b4155]"
            style={{ aspectRatio: aspectRatioCss }}
          >
            {status === "running" ? <Loader2 className="w-5 h-5 animate-spin" /> : "portrait preview"}
          </div>
        )}
      </div>

      {/* Name + variant label. When a default asset is set we show
          "Character • Variant" below the thumbnail so users can see at a
          glance which asset is acting as the canvas default — addressing
          the "show the name and selected default in the node, not just the
          image" request. The variant suffix is brand-pink to match other
          accent UI; suffix is omitted for canonical/portrait defaults.

          Trailing inline dropdown sets `defaultUsageMode` — how downstream
          generators should consume this character's reference image. The
          mode propagates into every `ConnectedReference` derived from this
          node and drives the per-image directive in the assembled prompt
          (see `packages/shared/src/character-usage-mode.ts`). Click/pointer
          handlers stop propagation so picking a mode doesn't also drag the
          node or open the config panel. */}
      <div className="px-2.5 pt-1.5 flex items-center gap-1.5 min-w-0">
        <div className="flex-1 min-w-0 text-[12px] font-semibold text-slate-200 truncate">
          {nodeData.characterName || "Unnamed"}
          {showVariantSuffix && (
            <span className="text-[#ff0073] font-normal ml-1">{`• ${variantName}`}</span>
          )}
        </div>
        {/* Custom-styled dropdown via shadcn `Select` — the native <select>
            popup didn't match the dark canvas styling and rendered the OS's
            white menu. The `stopPropagation` on the trigger is critical:
            React Flow listens for pointer events on every node to start a
            drag, so without it opening the dropdown would also drag the node
            (and on touch devices the dropdown wouldn't open at all). */}
        <Select
          value={nodeData.defaultUsageMode ?? DEFAULT_USAGE_MODE}
          onValueChange={(v) =>
            updateNodeData(id, { defaultUsageMode: v as UsageMode })
          }
        >
          <SelectTrigger
            aria-label="Default usage mode for character mentions"
            title="How the AI consumes this character's image when @-mentioned"
            className="shrink-0 h-6 w-[110px] text-[10px] bg-[#13161f] border-[#334155] text-slate-300 hover:border-[#475569] focus:border-[#ff0073] px-2 py-0"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {USAGE_MODES.map((m) => (
              <SelectItem key={m} value={m} className="text-[11px]">
                {usageModeLabel(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="px-2.5 pb-2 text-[9px] text-slate-600">{`${nodeData.style} · ${nodeData.gender}`}</div>

      {/* Asset badge row */}
      <div className="px-2.5 pb-2 grid grid-cols-3 gap-1 text-[9px] text-muted-foreground">
        <AssetBadge label="Expr" count={expressionCount} status={nodeData.expressionStatus ?? "idle"} />
        <AssetBadge label="Poses" count={poseCount} status={nodeData.poseStatus ?? "idle"} />
        <AssetBadge label="Motions" count={motionCount} status={nodeData.motionStatus ?? "idle"} />
      </div>

      {/* Voice / personality / studio row */}
      <div className="px-2.5 pb-2.5 grid grid-cols-3 gap-1 text-center">
        <div className="bg-[#1a1d27] rounded px-1 py-1">
          <div className="text-[11px]">🎤</div>
          <div className={`text-[8px] font-semibold ${nodeData.voice ? "text-[#22c55e]" : "text-slate-600"}`}>{nodeData.voice ? "✓" : "—"}</div>
          <div className="text-[7px] text-slate-600">voice</div>
        </div>
        <div className="bg-[#1a1d27] rounded px-1 py-1">
          <div className="text-[11px]">🧠</div>
          <div className={`text-[8px] font-semibold ${nodeData.personality ? "text-[#22c55e]" : "text-slate-600"}`}>{nodeData.personality ? "✓" : "—"}</div>
          <div className="text-[7px] text-slate-600">person.</div>
        </div>
        <button
          type="button"
          aria-label="Open Character Studio"
          className="bg-[#1e3a5f] border border-[#3b82f633] rounded px-1 py-1 cursor-pointer hover:bg-[#234670] transition-colors"
          onClick={(e) => {
            e.stopPropagation()
            setCharacterStudioNodeId(id)
          }}
        >
          <div className="text-[11px]">⬡</div>
          <div className="text-[7px] text-[#93c5fd] font-medium">studio</div>
        </button>
      </div>
    </BaseNode>

    <HandleWithPopover nodeId={id} nodeType="character" handleId="in"           type="target" position={Position.Left}  label="Prompt"    color="#ff0073" icon={<Type />}       side="left"  top="calc(100% - 24px)" accepts={ACCEPTS_PROMPT} />
    <HandleWithPopover nodeId={id} nodeType="character" handleId="characterRef" type="source" position={Position.Right} label="Character" color="#F472B6" icon={<UserCircle />} side="right" top="24px" />
    </div>
  )
}

function AssetBadge({ label, count, status }: { readonly label: string; readonly count: number; readonly status: string }) {
  if (status === "running") {
    return (
      <span className="flex items-center justify-center gap-0.5 px-1 py-0.5 rounded bg-muted/50">
        <Loader2 className="w-2.5 h-2.5 animate-spin" />
        {label}
      </span>
    )
  }
  return (
    <span className={`flex items-center justify-center gap-0.5 px-1 py-0.5 rounded ${count > 0 ? "bg-primary/10 text-primary" : "bg-[#1a1d27] text-slate-600"}`}>
      {label} {count}
    </span>
  )
}

export const CharacterNode = memo(CharacterNodeComponent)
