"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { PromptEditor } from "@/components/editor/config-panels/prompt-editor"
import { PromptHelperButton } from "@/components/editor/config-panels/prompt-helper-button"
import { FinalPromptPreview } from "@/components/editor/config-panels/final-prompt-preview"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { getPromptFields } from "@/lib/prompt-fields"
import { getPromptIcon } from "./prompt-edit-button"
import { getUpstreamNodes } from "@/lib/node-refs"
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

  const [showFinal, setShowFinal] = useState(false)

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

  // Reset the final-prompt panel each time the modal opens for a node.
  useEffect(() => { setShowFinal(false) }, [nodeId])

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
            </div>
            <PromptEditor
              value={promptValue}
              onChange={(v) => writeField(promptField, v)}
              placeholder="Describe what you want to generate…  Type @ for references, { for variables"
              rows={10}
              referenceImages={referenceImages}
              nodeRefs={nodeRefs}
            />
          </div>
          {negativeField && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Negative prompt</label>
              <PromptEditor
                value={negativeValue}
                onChange={(v) => writeField(negativeField, v)}
                placeholder="What to avoid (optional)…"
                rows={3}
                referenceImages={referenceImages}
                nodeRefs={nodeRefs}
              />
            </div>
          )}
        </div>

        {/* Final prompt — what's actually sent after @-refs, {} variables,
            cinematography hints + style are resolved. */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowFinal((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {showFinal ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {showFinal ? "Hide final prompt" : "Show final prompt"}
          </button>
          {showFinal && (
            <div className="max-h-60 overflow-y-auto">
              <FinalPromptPreview
                userPrompt={promptValue}
                style={typeof data.style === "string" ? data.style : undefined}
                negativePrompt={negativeValue}
                consumerNodeId={nodeId}
                nodes={nodes}
                edges={edges}
                provider={typeof data.provider === "string" ? data.provider : undefined}
                connectedReferences={connectedReferences}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
