"use client"

import { useMemo, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { PromptEditor } from "@/components/editor/config-panels/prompt-editor"
import { PromptHelperButton } from "@/components/editor/config-panels/prompt-helper-button"
import { SnippetMenuButton } from "@/components/editor/config-panels/snippet-menu-button"
import {
  PromptFieldFinalView,
} from "@/components/editor/config-panels/prompt-field-final-view"
import {
  useFinalPromptSegments,
} from "@/components/editor/config-panels/use-final-prompt-segments"
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
import { NODE_DEF_MAP } from "@/types/nodes"
import type { FieldMappings } from "@/types/nodes"

const EDIT_MODE_STORAGE_KEY = "nodaro-prompt-edit-mode"

function readStoredMode(): boolean {
  try {
    return localStorage.getItem(EDIT_MODE_STORAGE_KEY) !== "final"
  } catch {
    return true // default: edit
  }
}

function writeStoredMode(isEditing: boolean) {
  try {
    localStorage.setItem(EDIT_MODE_STORAGE_KEY, isEditing ? "edit" : "final")
  } catch {}
}

/**
 * Quick-edit Prompt modal. Mounted ONCE at the editor root; opens for whichever
 * node id is in the store's `promptEditNodeId`. Two modes controlled by a single
 * EDIT toggle in the header:
 *
 * - **Final (EDIT off):** read-only provenance-coloured view of the assembled
 *   prompt; Generate with AI available; negative and snippets hidden for clarity.
 * - **Edit (EDIT on):** live PromptEditor(s) for prompt + negative, with snippet
 *   menus and Generate with AI.
 *
 * Last-used mode is remembered in `localStorage` and restored on next open.
 * Edits apply LIVE to the node (no Save button) — same as the config panel.
 */
export function PromptQuickEditModal() {
  const nodeId = useWorkflowStore((s) => s.promptEditNodeId)
  const close = useWorkflowStore((s) => s.closePromptEditor)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const characterDefinitions = useWorkflowStore((s) => s.characterDefinitions)
  const node = nodeId ? nodes.find((n) => n.id === nodeId) : undefined

  // Single modal-level edit toggle; persisted to localStorage across opens.
  const [isEditing, setIsEditingRaw] = useState<boolean>(readStoredMode)
  function setIsEditing(v: boolean) {
    setIsEditingRaw(v)
    writeStoredMode(v)
  }

  const nodeType = node?.type
  const fields = getPromptFields(nodeType)
  const data = (node?.data ?? {}) as Record<string, unknown>

  // Stable upstream-nodes ref: only rebuilds on topology changes, not keystrokes.
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes

  const nodeRefs = useMemo(
    () => (nodeId ? getUpstreamNodes(nodeId, nodesRef.current, edges) : []),
    [nodeId, edges],
  )

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

  const snippetMedia = getSnippetMedia(nodeType)
  const promptSnippets = useSnippetPool(snippetMedia, "prompt")
  const negativeSnippets = useSnippetPool(snippetMedia, "negative")

  const finalPrompt = useFinalPromptSegments({
    userPrompt: typeof data[fields?.prompt ?? "prompt"] === "string"
      ? (data[fields?.prompt ?? "prompt"] as string)
      : undefined,
    style: typeof data.style === "string" ? data.style : undefined,
    negativePrompt: typeof data[fields?.negative ?? "negativePrompt"] === "string"
      ? (data[fields?.negative ?? "negativePrompt"] as string)
      : undefined,
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
  const promptValue = typeof data[promptField] === "string" ? (data[promptField] as string) : ""
  const negativeValue = negativeField && typeof data[negativeField] === "string" ? (data[negativeField] as string) : ""

  const typeDef = NODE_DEF_MAP.get(nodeType)
  const typeLabel = typeDef?.label ?? nodeType
  const userLabel = typeof data.label === "string" && data.label ? data.label : undefined
  // Show the user-given name in gray only when it differs from the type's default label.
  const customName = userLabel && userLabel !== typeDef?.label ? userLabel : undefined
  const Icon = getPromptIcon(nodeType)

  function writeField(field: string, value: string) {
    const patch: Record<string, unknown> = { [field]: value }
    const fm = data.fieldMappings as FieldMappings | undefined
    if (fm && fm[field]) {
      patch.fieldMappings = Object.fromEntries(Object.entries(fm).filter(([k]) => k !== field))
    }
    updateNodeData(nodeId!, patch)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e") {
      e.preventDefault()
      close()
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) close() }}>
      <DialogContent className="sm:max-w-[680px]" onKeyDown={onKeyDown}>
        {/* Header: node type title + optional gray custom name + EDIT toggle */}
        <DialogHeader className="pr-8">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="text-primary flex items-center gap-2">
              <Icon className="w-4 h-4 shrink-0" />
              {typeLabel}
              {customName && (
                <span className="text-muted-foreground font-normal text-sm ml-0.5">{customName}</span>
              )}
            </DialogTitle>
            <div className="flex items-center gap-2 shrink-0">
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label
                htmlFor="prompt-edit-toggle"
                className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground cursor-pointer select-none"
              >
                Edit
              </label>
              <Switch
                id="prompt-edit-toggle"
                checked={isEditing}
                onCheckedChange={setIsEditing}
              />
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3">
          {/* Prompt field */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 min-h-[28px]">
              <label className="text-xs font-medium text-muted-foreground">
                {isEditing ? "Edit Prompt" : "Final Prompt"}
              </label>
              <span className="inline-flex items-center gap-0.5">
                {isEditing && (
                  <SnippetMenuButton
                    pool={promptSnippets}
                    value={promptValue}
                    onInsert={(v) => writeField(promptField, v)}
                    target="prompt"
                    media={snippetMedia}
                  />
                )}
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
            {isEditing ? (
              <PromptEditor
                value={promptValue}
                onChange={(v) => writeField(promptField, v)}
                placeholder="Describe what you want to generate…  Type @ for references, { for variables"
                rows={12}
                referenceImages={referenceImages}
                nodeRefs={nodeRefs}
                refMap={refMap}
                snippets={promptSnippets}
              />
            ) : (
              <PromptFieldFinalView
                segments={finalPrompt.promptSegments}
                plainText={finalPrompt.promptText}
                placeholder="Final prompt preview — node has no prompt yet"
                minHeightRem={12 * 1.5}
              />
            )}
          </div>

          {/* Negative field — only in edit mode */}
          {isEditing && negativeField && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 min-h-[28px]">
                <label className="text-xs font-medium text-muted-foreground">Edit Negative Prompt</label>
                <SnippetMenuButton
                  pool={negativeSnippets}
                  value={negativeValue}
                  onInsert={(v) => writeField(negativeField, v)}
                  target="negative"
                  media={snippetMedia}
                />
              </div>
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
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
