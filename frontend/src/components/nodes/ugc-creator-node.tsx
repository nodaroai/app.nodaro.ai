"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { ugcPickPending } from "@nodaro/shared/ugc"
import { AlertCircle, Braces, ImageIcon, Loader2, UserRound } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { NodeJobProgress } from "./node-job-progress"
import { NodeQuickStrip } from "./node-quick-strip"
import { useNodeTextDir } from "./node-text-dir"
import { UgcCreatorCandidatesPicker } from "./ugc-creator-candidates"
import { UgcInputPips, ugcNodeHandles, ugcPipTop } from "./ugc-node-pips"
import { imageNodeSizing } from "./video-node-defaults"
import { CachedImage } from "@/components/ui/cached-image"
import { useUpstreamImageAspect } from "@/hooks/use-upstream-image-aspect"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { hasCredits } from "@/lib/edition"
import { useT } from "@/lib/i18n"
import { useLocalizeHandleLabel, useLocalizeNodeLabel } from "@/lib/i18n/labels"
import { ugcNodeMessageText } from "@/lib/ugc-copy"
import type { UgcCreatorData } from "@/types/nodes"

const OUTPUTS = ["creator", "image"] as const
const NO_PICKERS = ""

/**
 * The pickers wired into the creator look, as each source node's label (the
 * Settings-input precedent: several sources on one pip, listed in the node).
 * The store subscription is a string, so an unrelated change does not
 * re-render the node.
 */
function useCreatorLookSources(nodeId: string): ReadonlyArray<{ readonly id: string; readonly label: string }> {
  const key = useWorkflowStore((s) => {
    const wired = s.edges.filter((e) => e.target === nodeId && e.targetHandle === "pickers")
    if (wired.length === 0) return NO_PICKERS
    return JSON.stringify(
      wired.map((e) => {
        const source = s.nodes.find((n) => n.id === e.source)
        const label = (source?.data as { label?: unknown } | undefined)?.label
        return [e.source, typeof label === "string" && label ? label : (source?.type ?? "")]
      }),
    )
  })
  return useMemo(
    () => (key === NO_PICKERS ? [] : (JSON.parse(key) as Array<[string, string]>).map(([id, label]) => ({ id, label }))),
    [key],
  )
}

function UgcCreatorNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  // The canvas is pinned left to right; a sentence on the card reads in the interface's direction.
  const textDir = useNodeTextDir()
  const localizeNode = useLocalizeNodeLabel()
  const localizeHandle = useLocalizeHandleLabel()
  const d = data as UgcCreatorData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const isReadOnly = useWorkflowStore((s) => s.isReadOnly)
  const status = d.executionStatus ?? "idle"
  const running = status === "running"
  const imageUrl = d.generatedImageUrl
  // Options of a draw wait for the person's pick (after a pause, or a credits stop that kept some):
  // they take the single preview's place, and the node hands nothing on until one is picked.
  const pickPending = !running && ugcPickPending(d)
  // A run that is starting (a re-draw's save) counts as a run: its options stay in view, unpickable.
  const runStarting = (status as string) === "pending"
  const lookSources = useCreatorLookSources(id)
  // A pick takes the options away with the button pressed: focus lands on the creator now shown.
  const previewRef = useRef<HTMLDivElement>(null)
  const focusAfterPick = useRef(false)
  useEffect(() => {
    if (!focusAfterPick.current || pickPending) return
    focusAfterPick.current = false
    // Never scroll the canvas to it.
    previewRef.current?.focus({ preventScroll: true })
  }, [pickPending])

  // One image, not a result history, so its aspect is measured here (the
  // Generate Mask precedent); with none, the node follows the wired photo.
  const [measuredAspect, setMeasuredAspect] = useState<number | undefined>(undefined)
  const upstreamAspect = useUpstreamImageAspect(id)
  const onLoadDimensions = useCallback(({ width, height }: { width: number; height: number }) => {
    if (width > 0 && height > 0) setMeasuredAspect(width / height)
  }, [])

  const source = d.source === "photo" ? t("creatorCard.myPhoto") : t("creatorCard.aiCreator")
  const gender = d.gender === "man" ? t("creatorCard.man") : d.gender === "woman" ? t("creatorCard.woman") : undefined

  return (
    <div className="relative" style={{ width: "100%", height: "100%" }}>
      <EditableNodeLabel
        label={d.label}
        icon={<UserRound className="w-3.5 h-3.5" />}
        onSave={(label) => updateNodeData(id, { label })}
      />
      <BaseNode
        id={id}
        label={d.label}
        icon={<UserRound className="h-4 w-4" />}
        category="ai"
        selected={selected}
        isRunning={running}
        {...imageNodeSizing(imageUrl ? measuredAspect : undefined, upstreamAspect)}
        hideHeader
        topToolbarContent={
          <NodeQuickStrip nodeId={id} isRunning={running}>
            {pickPending && (
              <span className="inline-flex h-6 items-center px-1.5 text-[10px] font-medium whitespace-nowrap text-neutral-900/85 dark:text-white/85">
                {t("ugc.creator.awaitingPick")}
              </span>
            )}
          </NodeQuickStrip>
        }
        handles={ugcNodeHandles("ugc-creator", OUTPUTS)}
      >
        <div className="flex flex-col gap-1.5 p-2 h-full">
          {running && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-md bg-muted/30 min-h-[96px]">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              <NodeJobProgress progress={d.currentJobProgress} />
            </div>
          )}
          {status === "failed" && (
            <div className="flex flex-col items-center justify-center gap-1 rounded-md bg-red-500/5 text-red-500 p-2">
              <div className="flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="font-medium">{t("node.failed")}</span>
              </div>
              {d.errorMessage && (
                <p dir="auto" className="text-[10px] text-center text-red-400 line-clamp-3" title={ugcNodeMessageText(d.errorMessage)}>
                  {ugcNodeMessageText(d.errorMessage)}
                </p>
              )}
            </div>
          )}
          {pickPending ? (
            <UgcCreatorCandidatesPicker
              nodeId={id}
              candidates={d.candidates}
              disabled={isReadOnly || runStarting}
              onPicked={() => {
                focusAfterPick.current = true
              }}
            />
          ) : (
            <>
              {!running && imageUrl && (
                <div ref={previewRef} tabIndex={-1} className="relative flex-1 min-h-0 overflow-hidden rounded-md outline-none" data-testid="ugc-creator-preview">
                  <CachedImage src={imageUrl} alt={d.label} className="w-full h-full object-contain" onLoadDimensions={onLoadDimensions} />
                </div>
              )}
              {!running && !imageUrl && status !== "failed" && (
                <div
                  className="flex flex-1 items-center justify-center rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40 min-h-[96px]"
                  data-testid="ugc-creator-empty"
                >
                  <UserRound className="w-6 h-6" />
                </div>
              )}
            </>
          )}
          {d.optionFailed && (
            <p dir={textDir} className="text-[10px] text-muted-foreground">
              {t("ugc.creator.optionFailed")}
            </p>
          )}
          {/* Two chips, never a sentence joined in code: each language orders its own words. */}
          <div className="flex flex-wrap items-center gap-1 text-[11px]" data-testid="ugc-creator-source">
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{source}</span>
            {gender && <span className="rounded bg-muted px-1.5 py-0.5">{gender}</span>}
          </div>
          {lookSources.length > 0 && (
            <div className="flex flex-wrap items-center gap-1" data-testid="ugc-creator-look">
              <span className="text-[10px] text-muted-foreground">{localizeHandle("Creator look")}</span>
              {lookSources.map((s) => (
                <span key={s.id} className="max-w-[120px] truncate rounded-md border bg-muted/40 px-1.5 py-0.5 text-[10px]">
                  {localizeNode(s.label)}
                </span>
              ))}
            </div>
          )}
          {hasCredits() && <p className="text-[10px] text-muted-foreground leading-snug">{t("ugc.creator.priceLine")}</p>}
        </div>
      </BaseNode>
      <UgcInputPips nodeId={id} nodeType="ugc-creator" />
      <HandleWithPopover nodeId={id} nodeType="ugc-creator" handleId="creator" type="source" position={Position.Right} label="Creator" color={HANDLE_COLORS.look} icon={<Braces />} side="right" top={ugcPipTop(0)} />
      <HandleWithPopover nodeId={id} nodeType="ugc-creator" handleId="image" type="source" position={Position.Right} label="Image" color={HANDLE_COLORS.image} icon={<ImageIcon />} side="right" top={ugcPipTop(1)} />
    </div>
  )
}

export const UgcCreatorNode = memo(UgcCreatorNodeComponent)
