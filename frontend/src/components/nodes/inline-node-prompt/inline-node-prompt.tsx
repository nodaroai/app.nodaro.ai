// frontend/src/components/nodes/inline-node-prompt/inline-node-prompt.tsx
import { useEffect, useRef, useState } from "react"
import { PromptEditor } from "@/components/editor/config-panels/prompt-editor"
import { PromptHelperButton } from "@/components/editor/config-panels/prompt-helper-button"
import { SnippetMenuButton } from "@/components/editor/config-panels/snippet-menu-button" // AUDIT FIX: real module + props are pool/value/onInsert/target/media
import { PROMPT_EDITOR_PORTAL_ATTR } from "@/components/editor/config-panels/prompt-editor/prompt-editor-portal"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { getPromptFields, getSnippetMedia } from "@/lib/prompt-fields"
import { usePromptEditorRefs } from "./use-prompt-editor-refs"
import { InlineFinalPrompt } from "./inline-final-prompt"
import type { FieldMappings } from "@/types/nodes" // FieldMappings is exported from @/types/nodes (verified)

export interface InlineNodePromptProps {
  readonly nodeId: string
  readonly nodeType: string
  readonly data: Record<string, unknown>
  readonly provider?: string
  readonly aspectRatio?: string
  readonly duration?: number
  /** Lifts the editor's focus state to the node so it can reveal the run pill
   *  while the prompt is being edited (the pill is otherwise hover-only). */
  readonly onFocusChange?: (focused: boolean) => void
}

const DRAG_THRESHOLD_PX = 2

export function InlineNodePrompt({ nodeId, nodeType, data, provider, aspectRatio, duration, onFocusChange }: InlineNodePromptProps) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const openPromptEditor = useWorkflowStore((s) => s.openPromptEditor)
  const { referenceImages, nodeRefs, refMap, promptSnippets } = usePromptEditorRefs(nodeId)
  const fields = getPromptFields(nodeType)
  const promptField = fields?.prompt ?? "prompt"
  const promptValue = typeof data[promptField] === "string" ? (data[promptField] as string) : ""
  // Edit / Final / Both view (persisted on node data via the index signature).
  // "Final" renders the assembled prompt through the SAME machinery as the
  // config panel's final view (useNodeFinalPrompt) → node-Final == panel == run.
  const rawView = data.inlinePromptView
  const view: "edit" | "final" | "both" = rawView === "final" ? "final" : rawView === "both" ? "both" : "edit"
  const showEditor = view !== "final"
  const showFinal = view !== "edit"

  const [isFocused, setIsFocusedRaw] = useState(false)
  // Lift focus to the node (reveals the run pill while editing) alongside local state.
  const setIsFocused = (f: boolean) => { setIsFocusedRaw(f); onFocusChange?.(f) }
  // AUDIT FIX: keep `nodrag` active while a body-portaled suggestion menu
  // (@/{/ ) is open — TipTap blurs into the portal, which would otherwise flip
  // isFocused false and drop nodrag mid-interaction. The floating renderer marks
  // its mount with PROMPT_EDITOR_PORTAL_ATTR; observe body childList for it.
  const [suggestionOpen, setSuggestionOpen] = useState(false)
  useEffect(() => {
    const check = () => setSuggestionOpen(!!document.querySelector(`[${PROMPT_EDITOR_PORTAL_ATTR}]`))
    const mo = new MutationObserver(check)
    mo.observe(document.body, { childList: true })
    return () => mo.disconnect()
  }, [])
  const nodragActive = isFocused || suggestionOpen
  // Click-vs-drag gesture on the UNFOCUSED editor (mirrors text-prompt-node.tsx).
  // While unfocused the wrapper is NOT `nodrag`, so without this React Flow would
  // hijack the first mousedown into a node drag. We preventDefault on mousedown
  // (deferring native focus so we can discriminate click from drag), then on
  // mouseUp focus the editor only if it was a click (didMove === false).
  const dragGestureRef = useRef<{ down: boolean; didMove: boolean; downX: number; downY: number }>({
    down: false,
    didMove: false,
    downX: 0,
    downY: 0,
  })

  // Mirror prompt-quick-edit-modal writeField: write the field + clear a stale
  // fieldMapping for it (inline edit overrides an upstream-driven prompt).
  function writeField(value: string) {
    const patch: Record<string, unknown> = { [promptField]: value }
    const fm = data.fieldMappings as FieldMappings | undefined
    if (fm && fm[promptField]) {
      patch.fieldMappings = Object.fromEntries(Object.entries(fm).filter(([k]) => k !== promptField))
    }
    updateNodeData(nodeId, patch)
  }

  return (
    <div
      // nopan always; nodrag only while focused so an unfocused click can still
      // be discriminated as click-vs-drag by React Flow. `relative` anchors the
      // focus-only edit affordances. No border/divider — the prompt flows
      // seamlessly below the preview on the same node surface. `inline-node-prompt`
      // marks the region so the canvas double-click (focus-zoom) bows out here.
      className={`inline-node-prompt nopan ${nodragActive ? "nodrag" : ""} relative flex flex-col px-2.5 pt-1.5 pb-3`}
      onDoubleClick={(e) => {
        // Double-click inside the prompt escalates to the full edit modal. Scope
        // to the editor surface so the snippet/AI header buttons are untouched;
        // stop the event so React Flow's node double-click (focus-zoom) — which
        // the canvas also suppresses via the `.inline-node-prompt` guard — never
        // fires alongside it.
        const target = e.target as HTMLElement | null
        if (!target?.closest(".prompt-editor-surface")) return
        e.preventDefault()
        e.stopPropagation()
        openPromptEditor(nodeId)
      }}
      onMouseDown={(e) => {
        // Only the editor area participates in the gesture; clicks on the
        // header (Prompt label, snippet/AI buttons) pass through untouched.
        const target = e.target as HTMLElement | null
        if (!target?.closest(".prompt-editor-surface")) return
        // Already focused — let the editor own the gesture (text selection).
        if (isFocused) {
          e.stopPropagation()
          return
        }
        // Defer browser-default focus so we can tell click from drag, and stop
        // React Flow from hijacking this mousedown into a node drag.
        dragGestureRef.current = { down: true, didMove: false, downX: e.clientX, downY: e.clientY }
        e.preventDefault()
      }}
      onMouseMove={(e) => {
        const g = dragGestureRef.current
        if (!g.down) return
        if (Math.abs(e.clientX - g.downX) > DRAG_THRESHOLD_PX || Math.abs(e.clientY - g.downY) > DRAG_THRESHOLD_PX) {
          g.didMove = true
        }
      }}
      onMouseUp={(e) => {
        const g = dragGestureRef.current
        if (!g.down) return
        const didMove = g.didMove
        dragGestureRef.current = { down: false, didMove: false, downX: 0, downY: 0 }
        const target = e.target as HTMLElement | null
        if (!target?.closest(".prompt-editor-surface")) return
        // A drag: don't focus (the user was selecting/dragging). A click: focus
        // the TipTap editable (matches text-prompt-node focusing its textarea).
        if (didMove) return
        e.currentTarget.querySelector<HTMLElement>(".ProseMirror")?.focus()
      }}
    >
      {/* Header row: the Edit/Final/Both view toggle (ALWAYS visible, `nodrag`
          so a click doesn't start a node drag) on the left; the edit affordances
          (snippets + Generate-with-AI) on the right, ONLY while editing — in a
          row ABOVE the text so they never overlap it. */}
      <div className="nodrag flex items-center justify-between gap-1 mb-1 px-0.5">
        <div className="inline-flex items-center overflow-hidden rounded-md border border-border/60 text-[10px] leading-none">
          {(["edit", "final", "both"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={view === m}
              title={m === "edit" ? "Edit prompt" : m === "final" ? "Show the assembled final prompt" : "Show edit + final"}
              onClick={() => updateNodeData(nodeId, { inlinePromptView: m })}
              className={`px-1.5 py-0.5 capitalize transition-colors ${
                view === m
                  ? "bg-muted text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        {showEditor && isFocused && (
          <div className="flex items-center gap-0.5">
            <SnippetMenuButton
              pool={promptSnippets}
              value={promptValue}
              onInsert={(v) => writeField(v)}
              target="prompt"
              media={getSnippetMedia(nodeType)}
            />
            <PromptHelperButton
              size="sm"
              nodeType={nodeType}
              currentPrompt={promptValue}
              provider={provider}
              aspectRatio={aspectRatio}
              duration={duration}
              onAccept={(text, mc) => { writeField(text); if (mc) updateNodeData(nodeId, { [mc.field]: mc.value }) }}
            />
          </div>
        )}
      </div>

      {/* nowheel: scrolling a long prompt scrolls the editor, not the canvas.
          `prompt-editor-surface` scopes the click-vs-drag gesture to the editor.
          `bare` drops the box chrome so the editor blends into the node card. */}
      {showEditor && (
        <div className="nowheel prompt-editor-surface">
          <PromptEditor
            bare
            value={promptValue}
            onChange={writeField}
            placeholder="Describe what you want to generate… Type @ for references, { for variables"
            rows={2}
            maxRows={6}
            referenceImages={referenceImages}
            nodeRefs={nodeRefs}
            refMap={refMap}
            snippets={promptSnippets}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
          />
        </div>
      )}
      {/* Final view (read-only assembled prompt) — same hook as the config
          panel. `nodrag`/`nowheel` so the Copy button + scroll work on canvas. */}
      {showFinal && (
        <div className="nodrag nowheel">
          <InlineFinalPrompt nodeId={nodeId} />
        </div>
      )}
    </div>
  )
}
