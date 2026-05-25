"use client"

import { memo, useState, useEffect, Suspense } from "react"
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry"
import { Position, useReactFlow, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { ImageIcon, Loader2, AlertCircle, ShieldAlert, X, Scissors, Settings, LayoutGrid, Expand, Download, Link, Type, Pencil, Aperture, Minus, Users, Sparkles } from "lucide-react"
import { HandleWithPopover } from "./handle-with-popover"
import { isValidGenerateImageConnection } from "@/lib/generate-image-handles"
import { VISUAL_PARAMETER_PICKER_NODE_TYPES } from "@/lib/parameter-picker-types"

// Stable, module-level `accepts` predicates for each typed handle. Defining
// these outside the component avoids creating fresh arrow refs on every
// render — HandleWithPopover's `useMemo([..., accepts])` would otherwise
// bust every render, cascading to O(N×6) re-computes on every drag frame.
const isPickerType = (s: string) => VISUAL_PARAMETER_PICKER_NODE_TYPES.has(s)
const ACCEPTS_PROMPT     = (t: string) => isValidGenerateImageConnection("prompt",     t, isPickerType)
const ACCEPTS_NEGATIVE   = (t: string) => isValidGenerateImageConnection("negative",   t, isPickerType)
const ACCEPTS_REFERENCES = (t: string) => isValidGenerateImageConnection("references", t, isPickerType)
const ACCEPTS_ASSETS     = (t: string) => isValidGenerateImageConnection("assets",     t, isPickerType)
const ACCEPTS_ELEMENTS   = (t: string) => isValidGenerateImageConnection("elements",   t, isPickerType)
const ACCEPTS_LOOK       = (t: string) => isValidGenerateImageConnection("look",       t, isPickerType)
import { computeDeleteResultUpdates, copyToClipboard } from "@/lib/utils"
import { NodeJobProgress } from "./node-job-progress"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
const ExtractReferencesModal = lazy(() => import("@/components/editor/extract-references-modal").then(m => ({ default: m.ExtractReferencesModal })))
import { SaveToLibraryButton } from "@/components/editor/save-to-library-button"
import { CachedImage } from "@/components/ui/cached-image"
import { useFullResolution } from "@/hooks/use-full-resolution"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"

import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { useProvidersCreditsSum } from "@/ee/hooks/use-providers-credits-sum"
import { buildCreditModelIdentifier } from "@/components/editor/config-panels/helpers"
import { EditableNodeLabel } from "./editable-node-label"
import type { GenerateImageData, ExtractedReference } from "@/types/nodes"

function GenerateImageNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as GenerateImageData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const isSettingsOpen = useWorkflowStore((s) => s.selectedNodeId === id)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  // Check multiple possible URL fields for robustness (match Image to Video thumbnail logic)
  const rawUrl = activeResult?.url ?? nodeData.generatedImageUrl ?? (nodeData as Record<string, unknown>).url as string | undefined
  // Treat empty strings as undefined (falsy check)
  const activeUrl = rawUrl && rawUrl.trim() ? rawUrl : undefined
  const isContentPolicy = status === "failed" && nodeData.errorMessage?.toLowerCase().includes("content policy")
  const openImageEdit = useWorkflowStore((s) => s.openImageEdit)
  const addCharacterDefinition = useWorkflowStore((s) => s.addCharacterDefinition)
  const allCharDefs = useWorkflowStore((s) => s.characterDefinitions)
  const attachedIds = nodeData.characterDefinitionIds ?? []
  const attachedCount = allCharDefs.filter((c) => attachedIds.includes(c.id)).length
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [extractOpen, setExtractOpen] = useState(false)
  const [showThumbnails, setShowThumbnails] = useState(false)
  const [extractedRefs, setExtractedRefs] = useState<readonly ExtractedReference[]>([])
  const useFull = useFullResolution(id)
  const { aspectRatio: imgAspectRatio, onLoadDimensions: handleLoadDimensions } =
    useResultAspectRatio(id, results, activeIndex)
  // Typed handles are anchored to the BOTTOM via `top: calc(100% - Npx)`, so
  // every time the node's height changes (image loads, aspect ratio updates,
  // user resizes), the resolved handle positions shift. React Flow caches
  // handle bounds at mount via getBoundingClientRect; without a re-measure
  // trigger, edges keep drawing to the original (stale) positions.
  const updateNodeInternals = useUpdateNodeInternals()
  const { setNodes } = useReactFlow()
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, imgAspectRatio, updateNodeInternals])
  // Floor-clamp the persisted node.height ONLY for nodes that haven't been
  // user-resized (no `rf-resized` className). Pre-v2.1 workflows stored a
  // height ~150px which is too short for the 6 typed handles; without this,
  // those nodes render with handles overflowing the body until manual resize.
  //
  // Skipping `rf-resized` nodes is critical — a user who deliberately resized
  // smaller (e.g., 180px to keep RunNodeButton close to content) should NOT
  // have their choice silently overwritten on every reload. BaseNode's
  // aspect-fit effect handles the image-loaded case separately when an
  // imageAspectRatio is present; this effect only catches the no-image-yet gap.
  useEffect(() => {
    if (imgAspectRatio) return // BaseNode's aspect-fit owns sizing once image is loaded
    setNodes((nodes) => nodes.map((n) => {
      if (n.id !== id) return n
      // Respect explicit user resize — `rf-resized` is added by BaseNode
      // whenever the user grabs a corner handle or BaseNode auto-fits.
      if (typeof n.className === "string" && n.className.includes("rf-resized")) return n
      const currentHeight = (n.height ?? n.measured?.height ?? 0) as number
      if (currentHeight >= 220) return n
      return { ...n, height: 220 }
    }))
  }, [id, imgAspectRatio, setNodes])
  const creditModelId = buildCreditModelIdentifier(
    nodeData.provider ?? "nano-banana-pro",
    nodeData as unknown as Record<string, unknown>,
  )
  // Single-provider primary cost (also primes the cache). Multi-provider total
  // is the SUM across all selected providers — `RunNodeButton` will further
  // multiply by repeatCount and any upstream-list fan-out, so we just supply
  // the per-press cost here.
  const primaryCredits = useModelCredits(creditModelId, 1)
  const isMultiProvider = (nodeData.providers?.length ?? 0) >= 2
  const providersForSum = isMultiProvider ? (nodeData.providers as readonly string[]) : []
  const providerSum = useProvidersCreditsSum(providersForSum, nodeData as unknown as Record<string, unknown>)
  // While the multi-provider queries are still loading, providerSum is 0 — pass
  // 0 so RunNodeButton hides the credit pill rather than flashing a stale value.
  const credits = isMultiProvider ? providerSum : primaryCredits
  const listTotal = (nodeData as Record<string, unknown>).__listTotal as number | undefined
  const listCompleted = (nodeData as Record<string, unknown>).__listCompleted as number | undefined
  const isNodeRunning = nodeData.executionStatus === "running"
  const listProgressPercent = (listTotal && listTotal > 0 && listCompleted !== undefined)
    ? Math.round((listCompleted / listTotal) * 100)
    : undefined

  function handleDeleteResult(indexToDelete: number) {
    const updates = computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedImageUrl")
    // Keep __listResults in sync
    const listResults = (nodeData as Record<string, unknown>).__listResults as string[] | undefined
    if (listResults) {
      const deletedUrl = results[indexToDelete]?.url
      const newListResults = deletedUrl ? listResults.filter((u) => u !== deletedUrl) : listResults
      if (newListResults.length <= 1) {
        updates.__listResults = undefined
        updates.__listInputs = undefined
        updates.__listTotal = undefined
        updates.__listCompleted = undefined
      } else {
        updates.__listResults = newListResults
        updates.__listTotal = newListResults.length
        updates.__listCompleted = newListResults.length
      }
    }
    updateNodeData(id, updates)
  }

  return (
    <div className="relative" style={{ width: "100%", height: "100%", minHeight: 220 }}>
    {/* Floating label above node */}
    <EditableNodeLabel
      label={nodeData.label}
      icon={<ImageIcon className="w-3.5 h-3.5" />}
      onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
    />
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<ImageIcon className="h-4 w-4" />}
      category="ai"
      credits={credits}
      selected={selected}
      isRunning={status === "running"}
      minWidth={200}
      // 6 input handles stacked from bottom up — the topmost pip ("Look")
      // sits at top: calc(100% - 184px), so the node body needs at least
      // ~200px to keep handles in view. Floor-clamp the aspect-ratio-driven
      // height to 200 so freshly-created nodes (image not loaded yet) AND
      // landscape-image nodes (computed height < 200) both render with
      // handles on the visible body.
      minHeight={Math.max(200, imgAspectRatio ? Math.round(200 / imgAspectRatio) : 150)}
      listCount={listTotal}
      listProgress={isNodeRunning && listTotal ? `${listCompleted ?? 0}/${listTotal}` : undefined}
      listProgressPercent={isNodeRunning ? listProgressPercent : undefined}
      hideHeader
      topToolbarContent={
                  <RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
      }
      bottomToolbarContent={
        showThumbnails && results.length > 1 ? (
          <div className="flex gap-1.5 px-2 py-1.5 bg-black/60 backdrop-blur-sm rounded-xl border border-white/10">
            {results.slice(0, 8).map((r, i) => (
              <CachedImage
                key={`${r.jobId}-${i}`}
                src={r.url}
                alt={`Result ${i + 1}`}
                className={`w-12 h-12 object-cover rounded-lg cursor-pointer transition-all ${
                  i === activeIndex ? "ring-2 ring-[#ff0073]" : "opacity-60 hover:opacity-100"
                }`}
                thumbnail
                thumbnailWidth={96}
                onClick={(e) => {
                  e.stopPropagation()
                  updateNodeData(id, { activeResultIndex: i, generatedImageUrl: r.url })
                }}
              />
            ))}
          </div>
        ) : undefined
      }
      handles={[
        { id: "prompt",     type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 24px)',  left: '-29px' }, external: true },
        { id: "negative",   type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 56px)',  left: '-29px' }, external: true },
        { id: "references", type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 88px)',  left: '-29px' }, external: true },
        { id: "assets",     type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 120px)', left: '-29px' }, external: true },
        { id: "elements",   type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 152px)', left: '-29px' }, external: true },
        { id: "look",       type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 184px)', left: '-29px' }, external: true },
        { id: "image",      type: "source", position: Position.Right, customStyle: { top: '24px',               right: '-29px' }, external: true },
      ]}
      imageAspectRatio={imgAspectRatio}
    >
      <div className="relative w-full h-full group">
        {/* Running state — fills the node instead of forcing 180px, so the
            loader stays visible when the user resizes the node smaller. */}
        {status === "running" && (
          <div className="flex flex-col items-center justify-center gap-2 bg-muted/30 rounded-xl w-full h-full min-h-[80px]">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            <NodeJobProgress progress={nodeData.currentJobProgress} />
          </div>
        )}

        {/* Image state */}
        {status !== "running" && activeUrl && (
          <>
            {results.length > 1 && (
              <button
                type="button"
                className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-md z-10 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => { e.stopPropagation(); setShowThumbnails(v => !v) }}
                title="Show versions"
              >
                <LayoutGrid className="w-3 h-3" />
                <span className="text-[11px] font-medium">{results.length}</span>
              </button>
            )}
            <CachedImage
              src={activeUrl}
              alt="Generated"
              className="w-full h-full object-cover rounded-xl"
              thumbnail={!useFull}
              thumbnailWidth={320}
              onLoadDimensions={handleLoadDimensions}
            />
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                aria-label="Extract references"
                className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                onClick={(e) => {
                  e.stopPropagation()
                  setExtractOpen(true)
                }}
                title="Extract references"
              >
                <Scissors className="w-3.5 h-3.5" />
              </button>
              {results.length > 0 && (
                <button
                  type="button"
                  aria-label="Remove result"
                  className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteConfirm(activeIndex)
                  }}
                  title="Delete this result"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="absolute bottom-2 left-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button type="button" aria-label="Edit image" className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                onClick={(e) => { e.stopPropagation(); openImageEdit(id, activeUrl!, activeResult?.filerobotDesignStateUrl) }} title="Edit image">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button type="button" aria-label="Expand preview" className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                onClick={(e) => { e.stopPropagation(); setPreviewOpen(true) }} title="Fullscreen">
                <Expand className="w-3.5 h-3.5" />
              </button>
              <button type="button" aria-label="Download" className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                onClick={(e) => {
                  e.stopPropagation()
                  const a = document.createElement('a')
                  a.href = `/v1/image-proxy?url=${encodeURIComponent(activeUrl!)}&download=1`
                  a.download = `${nodeData.label || 'image'}.png`
                  a.click()
                }} title="Download">
                <Download className="w-3.5 h-3.5" />
              </button>
              <button type="button" aria-label="Copy URL" className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                onClick={(e) => {
                  e.stopPropagation()
                  copyToClipboard(activeUrl!, "URL copied")
                }} title="Copy URL">
                <Link className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button type="button" aria-label="Settings" className={`w-7 h-7 flex items-center justify-center bg-black/50 hover:bg-black/70 border border-white/10 text-white rounded-full shadow-sm${isSettingsOpen ? " ring-1 ring-white/30" : ""}`}
                onClick={(e) => { e.stopPropagation(); selectNode(isSettingsOpen ? null : id) }} title="Settings">
                <Settings className="w-3.5 h-3.5" />
              </button>
            </div>
          </>
        )}

        {/* Failed state */}
        {status === "failed" && !activeUrl && (
          <div className={`flex flex-col items-center justify-center gap-1 rounded-xl p-2 h-[180px] ${isContentPolicy ? "bg-amber-500/10 text-amber-500" : "bg-red-500/5 text-red-500"}`}>
            <div className="flex items-center gap-1.5">
              {isContentPolicy ? <ShieldAlert className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
              <span className="font-medium">{isContentPolicy ? "Prohibited" : "Failed"}</span>
            </div>
            {(isContentPolicy || nodeData.errorMessage) && (
              <p className={`text-[10px] text-center line-clamp-2 ${isContentPolicy ? "text-amber-400" : "text-red-400"}`} title={nodeData.errorMessage}>
                {isContentPolicy ? "Blocked by provider safety filter. Try a different prompt or image." : nodeData.errorMessage}
              </p>
            )}
          </div>
        )}

        {/* Idle/empty state */}
        {status !== "running" && !activeUrl && status !== "failed" && (
          <div className="flex items-center justify-center rounded-xl bg-muted/10 text-muted-foreground/40 h-[160px]">
            <ImageIcon className="w-10 h-10" />
          </div>
        )}
      </div>
    </BaseNode>
    {/* Generate Image v2.1 — typed handle pips stacked from bottom-up:
        Prompt → Negative → References → Assets → Elements → Look.
        Prompt is the primary (closest to bottom-left). "Look" + "Elements"
        replace the single legacy "Style"; "Assets" replaces "Subjects" —
        accepts split by registry family so the popup mirrors the picker
        structure users already know. Distinct icons: Users (Assets,
        identity entities) vs Sparkles (Elements, atomic descriptors). */}
    <HandleWithPopover nodeId={id} nodeType="generate-image" handleId="prompt"     type="target" position={Position.Left}  label="Prompt"     color="#ff0073" icon={<Type />}      side="left"  top="calc(100% - 24px)"  accepts={ACCEPTS_PROMPT} />
    <HandleWithPopover nodeId={id} nodeType="generate-image" handleId="negative"   type="target" position={Position.Left}  label="Negative"   color="#ef4444" icon={<Minus />}     side="left"  top="calc(100% - 56px)"  accepts={ACCEPTS_NEGATIVE} />
    <HandleWithPopover nodeId={id} nodeType="generate-image" handleId="references" type="target" position={Position.Left}  label="References" color="#22D3EE" icon={<ImageIcon />} side="left"  top="calc(100% - 88px)"  orderMatters accepts={ACCEPTS_REFERENCES} />
    <HandleWithPopover nodeId={id} nodeType="generate-image" handleId="assets"     type="target" position={Position.Left}  label="Assets"     color="#F472B6" icon={<Users />}     side="left"  top="calc(100% - 120px)" orderMatters accepts={ACCEPTS_ASSETS} />
    <HandleWithPopover nodeId={id} nodeType="generate-image" handleId="elements"   type="target" position={Position.Left}  label="Elements"   color="#818CF8" icon={<Sparkles />}  side="left"  top="calc(100% - 152px)" accepts={ACCEPTS_ELEMENTS} />
    <HandleWithPopover nodeId={id} nodeType="generate-image" handleId="look"       type="target" position={Position.Left}  label="Look"       color="#818CF8" icon={<Aperture />}  side="left"  top="calc(100% - 184px)" accepts={ACCEPTS_LOOK} />
    {/* Output image shares the References color (#22D3EE) — both are "image" type. */}
    <HandleWithPopover nodeId={id} nodeType="generate-image" handleId="image"      type="source" position={Position.Right} label="Image"      color="#22D3EE" icon={<ImageIcon />} side="right" top="24px" />
    {activeUrl && (
      <MediaPreviewModal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        type="image"
        url={activeUrl}
        results={results}
        initialIndex={activeIndex}
      />
    )}
    <DeleteConfirmationDialog
      isOpen={deleteConfirm !== null}
      onClose={() => setDeleteConfirm(null)}
      onConfirm={() => {
        if (deleteConfirm !== null) handleDeleteResult(deleteConfirm)
      }}
    />
    {activeUrl && extractOpen && (
      <Suspense fallback={null}>
        <ExtractReferencesModal
          isOpen={extractOpen}
          onClose={() => setExtractOpen(false)}
          imageUrl={activeUrl}
          sceneIndex={0}
          sceneCharacters={[]}
          existingReferences={extractedRefs}
          onSave={(refs) => {
            setExtractedRefs(refs)
            for (const ref of refs) {
              if (!ref.imageUrl) continue
              addCharacterDefinition({
                id: crypto.randomUUID(),
                name: ref.name,
                type: "reference",
                category: ref.type,
                referenceImageUrl: ref.imageUrl,
              })
            }
          }}
        />
      </Suspense>
    )}
    </div>
  )
}

export const GenerateImageNode = memo(GenerateImageNodeComponent)
