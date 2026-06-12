"use client"

import { useMemo, useRef } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { PromptEditor } from "@/components/editor/config-panels/prompt-editor"
import { PromptHelperButton } from "@/components/editor/config-panels/prompt-helper-button"
import { SnippetMenuButton } from "@/components/editor/config-panels/snippet-menu-button"
import {
  PromptFieldFinalView,
  PromptFieldModeToggle,
} from "@/components/editor/config-panels/prompt-field-final-view"
import {
  useFinalPromptSegments,
  negativeRoutingCaption,
} from "@/components/editor/config-panels/use-final-prompt-segments"
import { usePromptFieldMode } from "@/hooks/use-prompt-field-mode"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { getPromptFields, getSnippetMedia } from "@/lib/prompt-fields"
import { useSnippetPool } from "@/hooks/queries/use-prompt-snippets-queries"
import { getPromptIcon } from "./prompt-edit-button"
import { getUpstreamNodes, buildNodeRefMap } from "@/lib/node-refs"
import { getConnectedSources } from "@/components/editor/config-panels/helpers"
import {
  buildImageConnectedReferences,
  connectedReferencesToRefImages,
  type ConnectedRefsData,
} from "@/components/editor/config-panels/connected-references"
import type { FieldMappings } from "@/types/nodes"

/**
 * Quick-edit Prompt modal. Mounted ONCE at the editor root; opens for whichever
 * node id is in the store's `promptEditNodeId`. Edits the node's prompt (and
 * negative prompt, where the node has one) without opening the full config
 * panel.
 *
 * Edits apply LIVE to the node (no Save) — exactly like the config panel and the
 * ⌘I fullscreen settings, so behavior is consistent. Editing a field also drops
 * any upstream binding on it (a typed value can't coexist with a mapped source).
 * Close via the ✕, Esc, or ⌘/Ctrl+E.
 *
 * The prompt fields are the same {@link PromptEditor} the config panel uses, so
 * `@`-mention reference pills and `{}` variables work identically here.
 *
 * Must live at the root rather than inside a node's hover toolbar: that toolbar
 * unmounts when the cursor leaves the node, which would tear the dialog down.
 */
export function PromptQuickEditModal() {
  const nodeId = useWorkflowStore((s) => s.promptEditNodeId)
  const close = useWorkflowStore((s) => s.closePromptEditor)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const characterDefinitions = useWorkflowStore((s) => s.characterDefinitions)
  const node = nodeId ? nodes.find((n) => n.id === nodeId) : undefined

  const nodeType = node?.type
  const fields = getPromptFields(nodeType)
  const data = (node?.data ?? {}) as Record<string, unknown>

  // Persistence keys for the per-field Edit⇄Final toggle. Use the node's actual
  // data field names (e.g. image nodes → "prompt"/"negativePrompt"), so the
  // mode state in `data.__promptFinalView` is shared with the config panel for
  // the same node — toggling here mirrors there and vice-versa.
  const promptKey = fields?.prompt ?? "prompt"
  const negativeKey = fields?.negative ?? "negativePrompt"

  // Read `nodes` through a ref inside the ref-builders so LIVE prompt edits
  // (which replace the store's nodes array every keystroke) don't rebuild the
  // `@`-reference set and disrupt the editor. These memos re-run only when the
  // topology or the node's own reference fields change.
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes

  const nodeRefs = useMemo(
    () => (nodeId ? getUpstreamNodes(nodeId, nodesRef.current, edges) : []),
    [nodeId, edges],
  )

  // Per-open snapshot of label → non-empty upstream output. Same deps as the
  // nodeRefs memo: refreshes on wiring changes, not on keystrokes (nodesRef
  // keeps live prompt edits from rebuilding it). The modal is a blocking
  // overlay so WIRING can't change mid-session; upstream VALUES still can
  // (background runs, collab) — accepted stale-until-reopen, matching the
  // spec's freshness contract.
  const refMap = useMemo(
    () => (nodeId ? buildNodeRefMap(nodeId, nodesRef.current, edges) : new Map<string, string>()),
    [nodeId, edges],
  )

  const refData = node?.data as {
    referenceImageUrls?: unknown
    referenceImageOrder?: unknown
    extraRefs?: unknown
    characterDefinitionIds?: readonly string[]
  } | undefined
  const connectedReferences = useMemo(() => {
    if (!nodeId) return []
    const srcs = getConnectedSources(nodeId, edges, nodesRef.current)
    const attachedIds = refData?.characterDefinitionIds ?? []
    const attachedChars = characterDefinitions.filter((c) => attachedIds.includes(c.id))
    return buildImageConnectedReferences({
      data: (nodesRef.current.find((n) => n.id === nodeId)?.data ?? {}) as unknown as ConnectedRefsData,
      sources: srcs,
      nodes: nodesRef.current,
      attachedChars,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, edges, characterDefinitions, refData?.referenceImageUrls, refData?.referenceImageOrder, refData?.extraRefs, refData?.characterDefinitionIds])
  const referenceImages = useMemo(
    () => connectedReferencesToRefImages(connectedReferences),
    [connectedReferences],
  )

  // Snippet pools for this node's modality. Hooks must run unconditionally
  // (nodeType may be undefined — useSnippetPool returns [] for undefined media),
  // so they sit above the early return below.
  const snippetMedia = getSnippetMedia(nodeType)
  const promptSnippets = useSnippetPool(snippetMedia, "prompt")
  const negativeSnippets = useSnippetPool(snippetMedia, "negative")

  // Per-field Edit⇄Final toggle + assembled segments. All unconditional (above
  // the early return); the segments are read from `data` so they're valid even
  // before the field locals below are derived. Provider-less nodes get the flat
  // text path (no provenance colors) automatically — provider is undefined.
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", promptKey)
  const negativeFieldMode = usePromptFieldMode(nodeId ?? "", negativeKey)
  const finalPrompt = useFinalPromptSegments({
    userPrompt: typeof data[promptKey] === "string" ? (data[promptKey] as string) : undefined,
    style: typeof data.style === "string" ? data.style : undefined,
    negativePrompt: typeof data[negativeKey] === "string" ? (data[negativeKey] as string) : undefined,
    consumerNodeId: nodeId ?? undefined,
    nodes,
    edges,
    provider: typeof data.provider === "string" ? data.provider : undefined,
    connectedReferences,
    snippets: promptSnippets,
    negativeSnippets,
  })

  if (!nodeId || !node || !nodeType || !fields) return null

  const promptField = fields.prompt
  const negativeField = fields.negative
  const promptLabel = fields.promptLabel ?? "Prompt"
  const nodeLabel = typeof data.label === "string" && data.label ? data.label : nodeType
  const Icon = getPromptIcon(nodeType)
  const promptValue = typeof data[promptField] === "string" ? (data[promptField] as string) : ""
  const negativeValue = negativeField && typeof data[negativeField] === "string" ? (data[negativeField] as string) : ""

  /** Write a field live, dropping any upstream binding on it (edit ⇒ manual). */
  function writeField(field: string, value: string) {
    const patch: Record<string, unknown> = { [field]: value }
    const fm = data.fieldMappings as FieldMappings | undefined
    if (fm && fm[field]) {
      patch.fieldMappings = Object.fromEntries(Object.entries(fm).filter(([k]) => k !== field))
    }
    updateNodeData(nodeId!, patch)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    // ⌘/Ctrl+E toggles the modal closed (the canvas handler is suppressed while
    // this dialog — aria-modal — is open, so close from here).
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e") {
      e.preventDefault()
      close()
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) close() }}>
      <DialogContent className="sm:max-w-[680px]" onKeyDown={onKeyDown}>
        <DialogHeader>
          <DialogTitle className="text-primary flex items-center gap-2">
            <Icon className="w-4 h-4" />
            Edit prompt
          </DialogTitle>
          <DialogDescription>
            {nodeLabel} — changes apply to the node instantly.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 min-h-[28px]">
              <label className="text-xs font-medium text-muted-foreground">{promptLabel}</label>
              <span className="inline-flex items-center gap-0.5">
                <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
                <SnippetMenuButton pool={promptSnippets} value={promptValue} onInsert={(v) => writeField(promptField, v)} target="prompt" media={snippetMedia} />
                <PromptHelperButton
                  size="md"
                  nodeType={nodeType}
                  currentPrompt={promptValue}
                  provider={typeof data.provider === "string" ? data.provider : undefined}
                  aspectRatio={typeof data.aspectRatio === "string" ? data.aspectRatio : undefined}
                  duration={typeof data.duration === "number" ? data.duration : undefined}
                  onAccept={(text, mc) => {
                    writeField(promptField, text)
                    if (mc) updateNodeData(nodeId!, { [mc.field]: mc.value })
                  }}
                />
              </span>
            </div>
            {promptFieldMode.mode === "final" ? (
              <PromptFieldFinalView
                segments={finalPrompt.promptSegments}
                plainText={finalPrompt.promptText}
                placeholder="Final prompt preview — node has no prompt yet"
                minHeightRem={10 * 1.5}
              />
            ) : (
              <PromptEditor
                value={promptValue}
                onChange={(v) => writeField(promptField, v)}
                placeholder="Describe what you want to generate…  Type @ for references, { for variables"
                rows={10}
                referenceImages={referenceImages}
                nodeRefs={nodeRefs}
                refMap={refMap}
                snippets={promptSnippets}
              />
            )}
          </div>
          {negativeField && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 min-h-[28px]">
                <label className="text-xs font-medium text-muted-foreground">Negative prompt</label>
                <span className="inline-flex items-center gap-0.5">
                  <PromptFieldModeToggle mode={negativeFieldMode.mode} onToggle={negativeFieldMode.toggle} />
                  <SnippetMenuButton pool={negativeSnippets} value={negativeValue} onInsert={(v) => writeField(negativeField, v)} target="negative" media={snippetMedia} />
                </span>
              </div>
              {negativeFieldMode.mode === "final" ? (
                <PromptFieldFinalView
                  segments={finalPrompt.negativeSegments}
                  plainText={finalPrompt.negativeText}
                  placeholder="Final negative prompt preview — nothing to avoid yet"
                  routingCaption={negativeRoutingCaption(finalPrompt.negativeRouting)}
                  minHeightRem={3 * 1.5}
                />
              ) : (
                <PromptEditor
                  value={negativeValue}
                  onChange={(v) => writeField(negativeField, v)}
                  placeholder="What to avoid (optional)…"
                  rows={3}
                  referenceImages={referenceImages}
                  nodeRefs={nodeRefs}
                  refMap={refMap}
                  snippets={negativeSnippets}
                />
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
