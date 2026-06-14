"use client"

import { useMemo, useRef, useState } from "react"
import {
  AlignLeft,
  AudioLines,
  AudioWaveform,
  BookOpen,
  Box,
  Clapperboard,
  Eye,
  FastForward,
  FileText,
  Film,
  ImageIcon,
  Layers,
  Mic,
  Music,
  Scissors,
  Shapes,
  Sparkles,
  Type,
  Users,
  VenetianMask,
  Volume2,
  Wand2,
  Waypoints,
  type LucideIcon,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
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
import { getUpstreamNodes, buildNodeRefMap } from "@/lib/node-refs"
import { getConnectedSources } from "@/components/editor/config-panels/helpers"
import {
  buildImageConnectedReferences,
  connectedReferencesToRefImages,
  type ConnectedRefsData,
} from "@/components/editor/config-panels/connected-references"
import { NODE_DEF_MAP } from "@/types/nodes"
import { QuickConfigSelect, getQuickConfigs } from "./node-quick-configs"
import { RunNodeButton } from "./run-node-button"
import { buildCreditModelIdentifier } from "@/components/editor/config-panels/helpers"
import { buildVideoCreditModelIdentifier } from "@nodaro/shared"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
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

/** Map node type → its Lucide icon (mirrors the add-node-popup registry). */
const NODE_TYPE_ICON_MAP: Readonly<Record<string, LucideIcon>> = {
  // Image
  "generate-image": ImageIcon,
  "modify-image": Layers,
  "generate-mask": VenetianMask,
  "image-to-text": Eye,
  "image-critic": Eye,
  // Video
  "generate-video": Clapperboard,
  "text-to-video": Clapperboard,
  "image-to-video": Clapperboard,
  "video-to-video": Film,
  "extend-video": FastForward,
  "speech-to-video": AudioLines,
  "motion-transfer": Waypoints,
  "cinematic-avatar": Clapperboard,
  "video-sfx": AudioWaveform,
  "video-retake": Scissors,
  // Audio
  "generate-music": Music,
  "suno-generate": Music,
  "suno-cover": Music,
  "suno-extend": FastForward,
  "suno-replace-section": Scissors,
  "suno-upload-extend": FastForward,
  "suno-lyrics": FileText,
  "suno-style-boost": Sparkles,
  "text-to-audio": Volume2,
  "text-to-speech": Mic,
  "voice-design": Wand2,
  "voice-remix": Mic,
  "lip-sync": Users,
  // Text / LLM
  "text-prompt": Type,
  "llm-chat": Sparkles,
  "generate-script": BookOpen,
  "forced-alignment": AlignLeft,
  // FX
  "motion-graphics": Shapes,
  "3d-title": Box,
}

function getNodeTypeIcon(nodeType: string | undefined): LucideIcon {
  return (nodeType && NODE_TYPE_ICON_MAP[nodeType]) || Sparkles
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
 * Both text areas have fixed height and scroll rather than grow. Quick-config
 * dropdowns and a Run button live in the footer. Pressing Run closes the modal.
 * Last-used mode is remembered in `localStorage` and restored on next open.
 * Edits apply LIVE to the node (no Save button) — same as the config panel.
 */
export function PromptQuickEditModal() {
  const nodeId = useWorkflowStore((s) => s.promptEditNodeId)
  const close = useWorkflowStore((s) => s.closePromptEditor)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
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
  const providerStr = typeof data.provider === "string" ? data.provider : undefined
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
    // Route by media so the preview matches what the runtime actually sends:
    //  - image nodes assemble via buildImagePrompt (reference composition);
    //  - video nodes predict the video provider's routing with NO image
    //    "Use these references…/Compose them into a single image" wrapper;
    //  - audio / text fall through to the provider-less path.
    // Passing `provider` (the image path) for EVERY node was the bug — it
    // rendered an image-composition prompt for video nodes that the video
    // backend never produces.
    provider: snippetMedia === "image" ? providerStr : undefined,
    videoProvider: snippetMedia === "video" ? providerStr : undefined,
    connectedReferences: snippetMedia === "image" ? connectedReferences : undefined,
    snippets: promptSnippets,
    negativeSnippets,
  })

  // Credit computation — hooks must be called unconditionally (React rules).
  // The identifier is undefined for node types without variable pricing,
  // so useModelCredits returns its fallback and the value is unused.
  const imageCreditsId = nodeType === "generate-image"
    ? buildCreditModelIdentifier(
        (data.provider as string | undefined) ?? "nano-banana-pro",
        data,
      )
    : undefined
  const videoCreditsId = nodeType === "generate-video"
    ? buildVideoCreditModelIdentifier(
        (data.provider as string | undefined) ?? "",
        data.duration as number | string | undefined,
        data.sound as boolean | undefined,
        "image-to-video",
        (data.videoSize as string | undefined) ?? (data.mode as string | undefined),
        data.resolution as string | undefined,
        Array.isArray(data.referenceVideoUrls) && (data.referenceVideoUrls as unknown[]).length > 0,
      )
    : undefined
  const imageCredits = useModelCredits(imageCreditsId, 1)
  const videoCredits = useModelCredits(videoCreditsId, 25)

  if (!nodeId || !node || !nodeType || !fields) return null

  const promptField = fields.prompt
  const negativeField = fields.negative
  const promptValue = typeof data[promptField] === "string" ? (data[promptField] as string) : ""
  const negativeValue = negativeField && typeof data[negativeField] === "string" ? (data[negativeField] as string) : ""

  // Height arithmetic to keep the modal at a stable size when toggling modes.
  //
  // PromptEditor box model: wrapper border (1px×2 = 2px = 0.125rem) + .prompt-editor__content
  // which has CSS padding: 0.5rem 0.75rem (= 1rem vertical) and
  // min-height: rows×1.5rem set on the content div. The ProseMirror child
  // inherits that min-height. Total editor height = rows×1.5rem + 1rem + 0.125rem.
  // EDITOR_OVERHEAD = 1.125rem (1rem padding + 0.125rem border).
  //
  // PromptFieldFinalView: outer div with border + px-3 py-2 (border-box).
  // At minHeightRem = rows×1.5 + EDITOR_OVERHEAD the component is the same
  // height as the corresponding PromptEditor.
  //
  // scrollable=true makes both components fixed-height (maxHeight = minHeight),
  // so the modal height is stable regardless of content or typing.
  //
  // When node has negative: final view absorbs the negative section's height:
  //   space-y-3 gap (0.75rem) + neg label row (1.75rem) + space-y-1.5 (0.375rem)
  //   + neg editor height (NEG_ROWS×1.5 + EDITOR_OVERHEAD = 5.625rem) = 8.5rem.
  const PROMPT_ROWS = 14
  const NEG_ROWS = 3
  const EDITOR_OVERHEAD = 1.125 // 1rem content padding + 0.125rem border (2px)
  const NEG_SECTION_HEIGHT = 0.75 + 1.75 + 0.375 + NEG_ROWS * 1.5 + EDITOR_OVERHEAD
  const promptMinHeightRem = PROMPT_ROWS * 1.5 + EDITOR_OVERHEAD
  const finalMinHeightRem = negativeField
    ? promptMinHeightRem + NEG_SECTION_HEIGHT
    : promptMinHeightRem

  const typeDef = NODE_DEF_MAP.get(nodeType)
  const typeLabel = typeDef?.label ?? nodeType
  const userLabel = typeof data.label === "string" && data.label ? data.label : undefined
  // Show the user-given name in gray only when it differs from the type's default label.
  const customName = userLabel && userLabel !== typeDef?.label ? userLabel : undefined
  const Icon = getNodeTypeIcon(nodeType)

  // Node running state for the footer RunNodeButton.
  const executionStatus = typeof data.executionStatus === "string" ? data.executionStatus : undefined
  const isRunning = executionStatus === "running" || executionStatus === "pending"
  const quickConfigs = getQuickConfigs(nodeType)
  const credits = nodeType === "generate-image" ? imageCredits
    : nodeType === "generate-video" ? videoCredits
    : undefined

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

  function handleRun(nid: string) {
    runSingleNode?.(nid)
    close()
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) close() }}>
      <DialogContent className="sm:max-w-[680px]" showCloseButton={false} onKeyDown={onKeyDown}>
        {/* Header: node type icon + title + optional gray custom name + EDIT toggle */}
        <DialogHeader>
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
                  provider={providerStr}
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
                rows={PROMPT_ROWS}
                scrollable
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
                minHeightRem={finalMinHeightRem}
                scrollable
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
                rows={NEG_ROWS}
                scrollable
                referenceImages={referenceImages}
                nodeRefs={nodeRefs}
                refMap={refMap}
                snippets={negativeSnippets}
              />
            </div>
          )}
        </div>

        {/* Footer: quick-config dropdowns on the left, Run button on the right */}
        <Separator />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 flex-wrap min-w-0">
            {quickConfigs.map((control) => (
              <QuickConfigSelect
                key={control.field}
                nodeId={nodeId!}
                control={control}
                value={data[control.field] != null ? String(data[control.field]) : ""}
                data={data}
                disabled={isRunning}
              />
            ))}
          </div>
          <RunNodeButton
            nodeId={nodeId!}
            isRunning={isRunning}
            onRun={handleRun}
            credits={credits}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
