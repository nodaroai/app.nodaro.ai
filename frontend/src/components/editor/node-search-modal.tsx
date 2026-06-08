"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useReactFlow } from "@xyflow/react"
import { Search, X, Cpu, MapPin } from "lucide-react"
import { cn } from "@/lib/utils"
import { CachedImage } from "@/components/ui/cached-image"
import { getNodeThumbnailUrl, getNodeVideoUrl, getNodePickerVisual } from "@/lib/node-thumbnail"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { NODE_DEF_MAP, type WorkflowNode } from "@/types/nodes"
import { RatioIcon } from "./config-panels/aspect-ratio-selector"

interface NodeSearchModalProps {
  readonly open: boolean
  readonly onClose: () => void
}

interface NodeSearchHit {
  readonly node: WorkflowNode
  readonly thumbnailUrl: string | undefined
  readonly videoUrl: string | undefined
  readonly pickerVisual: ReactNode | undefined
  readonly label: string
  readonly typeLabel: string
  readonly prompt: string | undefined
  readonly metaChips: ReadonlyArray<{ key: string; value: string; icon?: "ratio" }>
}

const NODE_TYPE_LABELS: Record<string, string> = {
  "generate-image": "Generate Image",
  "edit-image": "Edit Image",
  "image-to-image": "Image to Image",
  "modify-image": "Modify Image",
  "upload-image": "Upload Image",
  "image-to-video": "Image to Video",
  "text-to-video": "Text to Video",
  "video-to-video": "Video to Video",
  "modify-video": "Modify Video",
  "extend-video": "Extend Video",
  "loop-video": "Loop Video",
  "combine-videos": "Combine Videos",
  "render-video": "Render Video",
  "text-to-speech": "Text to Speech",
  "text-to-audio": "Text to Audio",
  "voice-clone": "Voice Clone",
  "voice-design": "Voice Design",
  "voice-changer": "Voice Changer",
  "voice-remix": "Voice Remix",
  "generate-music": "Generate Music",
  "dubbing": "Dubbing",
  "lip-sync": "Lip Sync",
  "speech-to-video": "Speech to Video",
  "ai-writer": "AI Writer",
  "llm-chat": "LLM Chat",
  "generate-script": "Generate Script",
  "image-to-text": "Image to Text",
  "transcribe": "Transcribe",
  "text-prompt": "Text",
  "character": "Character",
  "location": "Location",
  "object": "Object/Props",
  "creature": "Animal/Creature",
  "face": "Face",
  "scene": "Scene",
  "list": "List",
  "reduce": "Reduce",
  "skip": "Skip",
}

function typeLabel(type: string | undefined): string {
  if (!type) return "Unknown"
  return NODE_TYPE_LABELS[type] ?? type
}

function buildSearchHaystack(node: WorkflowNode): string {
  const data = (node.data ?? {}) as Record<string, unknown>
  const parts: Array<string | undefined> = [
    node.type,
    typeLabel(node.type),
    typeof data.label === "string" ? data.label : undefined,
    typeof data.prompt === "string" ? data.prompt : undefined,
    typeof data.negativePrompt === "string" ? data.negativePrompt : undefined,
    typeof data.provider === "string" ? data.provider : undefined,
    Array.isArray(data.providers) ? (data.providers as string[]).join(" ") : undefined,
    typeof data.model === "string" ? data.model : undefined,
    typeof data.aspectRatio === "string" ? data.aspectRatio : undefined,
    typeof data.resolution === "string" ? data.resolution : undefined,
    typeof data.quality === "string" ? data.quality : undefined,
    typeof data.style === "string" ? data.style : undefined,
    typeof data.value === "string" ? data.value : undefined,
    typeof data.text === "string" ? data.text : undefined,
  ]
  return parts.filter((p): p is string => !!p && p.length > 0).join("  ").toLowerCase()
}

function buildMetaChips(node: WorkflowNode): NodeSearchHit["metaChips"] {
  const data = (node.data ?? {}) as Record<string, unknown>
  const out: Array<{ key: string; value: string; icon?: "ratio" }> = []
  const provider = typeof data.provider === "string" ? data.provider : undefined
  const providers = Array.isArray(data.providers) ? (data.providers as string[]) : undefined
  if (providers && providers.length > 1) {
    out.push({ key: "provider", value: `${providers.length} models` })
  } else if (provider) {
    out.push({ key: "provider", value: provider })
  } else if (typeof data.model === "string") {
    out.push({ key: "model", value: data.model })
  }
  if (typeof data.aspectRatio === "string" && data.aspectRatio) {
    out.push({ key: "aspect", value: data.aspectRatio, icon: "ratio" })
  }
  if (typeof data.resolution === "string" && data.resolution) {
    out.push({ key: "resolution", value: data.resolution })
  }
  const repeat = data.repeatCount as number | undefined
  if (typeof repeat === "number" && repeat > 1) {
    out.push({ key: "repeat", value: `× ${repeat}` })
  }
  return out
}

/** Workflow-scoped node search modal. Cmd/Ctrl+F opens it. */
export function NodeSearchModal({ open, onClose }: NodeSearchModalProps) {
  const [query, setQuery] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  // Gate hover-driven selectedIndex so a row the cursor happens to be
  // resting on doesn't hijack the highlight at open time. Flips true on
  // the first mousemove after each open.
  const mouseHasMovedRef = useRef(false)

  const nodes = useWorkflowStore((s) => s.nodes)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  // "Currently focused" = either the settings-panel-open node OR React
  // Flow's selected node (single click without opening settings). Both
  // states represent "user is looking at this node right now" from the
  // user's POV, so the "Here" badge should fire on either. Selector
  // returns a string|null primitive, so Zustand's default Object.is
  // equality only triggers a re-render when the actual focused id
  // changes — not on every nodes-array mutation.
  const currentlyFocusedNodeId = useWorkflowStore((s) => {
    if (s.selectedNodeId) return s.selectedNodeId
    return s.nodes.find((n) => n.selected)?.id ?? null
  })
  const { setCenter, getNode } = useReactFlow()

  useEffect(() => {
    if (!open) return
    setQuery("")
    setSelectedIndex(0)
    mouseHasMovedRef.current = false
    requestAnimationFrame(() => inputRef.current?.focus())
    // Mouse-driven selection only activates after the user actually
    // moves the cursor — opening the modal while the cursor happens to
    // rest over a row would otherwise fire synthetic onMouseEnter at
    // mount and hijack the keyboard-driven default selection.
    const onMove = () => {
      mouseHasMovedRef.current = true
    }
    document.addEventListener("mousemove", onMove, { once: true, capture: true })
    return () => document.removeEventListener("mousemove", onMove, { capture: true })
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open, onClose])

  const tokens = useMemo(
    () => query.trim().toLowerCase().split(/\s+/).filter((t) => t.length > 0),
    [query],
  )

  const hits = useMemo<NodeSearchHit[]>(() => {
    if (!open) return []
    const list: NodeSearchHit[] = []
    for (const n of nodes as WorkflowNode[]) {
      if (!n.type) continue
      if (n.type === "sticky-note") continue
      const def = NODE_DEF_MAP.get(n.type as never)
      void def

      if (tokens.length > 0) {
        const haystack = buildSearchHaystack(n)
        if (!tokens.every((t) => haystack.includes(t))) continue
      }

      const data = (n.data ?? {}) as Record<string, unknown>
      const label =
        (typeof data.label === "string" && data.label.trim().length > 0
          ? data.label
          : typeLabel(n.type)) as string

      list.push({
        node: n,
        thumbnailUrl: getNodeThumbnailUrl(n),
        videoUrl: getNodeVideoUrl(n),
        pickerVisual: getNodePickerVisual(n),
        label,
        typeLabel: typeLabel(n.type),
        prompt: typeof data.prompt === "string" ? data.prompt : undefined,
        metaChips: buildMetaChips(n),
      })
    }
    // Place the currently-focused node at the top of an empty query so
    // the user can quickly see "where am I" — it's marked with a badge
    // in the row, but ordering reinforces that.
    if (tokens.length === 0 && currentlyFocusedNodeId) {
      const idx = list.findIndex((h) => h.node.id === currentlyFocusedNodeId)
      if (idx > 0) {
        const [pinned] = list.splice(idx, 1)
        list.unshift(pinned)
      }
    }
    return list.slice(0, 50)
  }, [open, nodes, tokens, currentlyFocusedNodeId])

  useEffect(() => {
    if (selectedIndex >= hits.length) setSelectedIndex(Math.max(0, hits.length - 1))
  }, [hits.length, selectedIndex])

  // Focus a node on the canvas — pan + zoom + select. `keepOpen=true` is
  // used by ArrowRight to peek-navigate without dismissing the modal so
  // the user can keep browsing.
  const focusNode = useCallback(
    (nodeId: string, keepOpen = false) => {
      const target = getNode(nodeId)
      if (!target) return
      const w = (target.measured?.width ?? 200) as number
      const h = (target.measured?.height ?? 150) as number
      setCenter(target.position.x + w / 2, target.position.y + h / 2, { zoom: 1, duration: 400 })
      selectNode(nodeId)
      if (!keepOpen) onClose()
    },
    [getNode, setCenter, selectNode, onClose],
  )

  // Window capture-phase keydown listener — fires BEFORE document-capture
  // listeners (workflow-canvas's neighbor-navigation + React Flow's
  // built-in arrow-nudge). Without this, arrow keys would both move the
  // selection in our list AND move the canvas's selected node 5px. The
  // `stopImmediatePropagation()` also blocks any other window-capture
  // listener registered after us from acting on the same event.
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      const key = e.key
      const interesting =
        key === "Escape" ||
        key === "ArrowDown" ||
        key === "ArrowUp" ||
        key === "ArrowRight" ||
        key === "ArrowLeft" ||
        key === "Enter"
      if (!interesting) return
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      if (key === "Escape") {
        onClose()
      } else if (key === "ArrowDown") {
        setSelectedIndex((i) => Math.min(i + 1, hits.length - 1))
      } else if (key === "ArrowUp") {
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (key === "ArrowRight") {
        // Peek-navigate: focus the canvas without closing.
        const hit = hits[selectedIndex]
        if (hit) {
          focusNode(hit.node.id, true)
          // Empty-query mode pins the focused node to index 0 in the
          // next render — snap our cursor there so a subsequent
          // ArrowDown moves to the next item instead of pointing at
          // whatever just shifted into the old selectedIndex slot.
          if (tokens.length === 0) setSelectedIndex(0)
        }
      } else if (key === "Enter") {
        const hit = hits[selectedIndex]
        if (hit) focusNode(hit.node.id, false)
      }
      // ArrowLeft is consumed (preventDefault above) but has no action —
      // reserved for a future "back" gesture.
    }
    window.addEventListener("keydown", handler, { capture: true })
    return () => window.removeEventListener("keydown", handler, { capture: true })
  }, [open, hits, selectedIndex, focusNode, onClose])

  // Scroll the active row into view when arrow keys cross it.
  useEffect(() => {
    if (!open) return
    const el = resultsRef.current?.querySelector<HTMLElement>(`[data-row-index="${selectedIndex}"]`)
    el?.scrollIntoView({ block: "nearest" })
  }, [open, selectedIndex])

  if (!open) return null

  const activeHit = hits[selectedIndex]

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4">
      <div className="absolute inset-0 bg-black/50" aria-hidden />
      <div
        ref={containerRef}
        className={cn(
          "relative w-full max-w-4xl",
          "bg-white dark:bg-[#1E1E1E]",
          "border border-[#E2E8F0] dark:border-[#2D2D2D]",
          "rounded-xl shadow-2xl overflow-hidden",
          "animate-in fade-in-0 zoom-in-95 duration-150",
          "flex flex-col",
        )}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#E2E8F0] dark:border-[#2D2D2D]">
          <Search className="w-5 h-5 text-[#94A3B8] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedIndex(0)
            }}
            placeholder="Search nodes — type, name, model, aspect ratio, prompt…"
            aria-label="Search nodes in this workflow"
            className="flex-1 bg-transparent border-none outline-none text-base text-[#1E293B] dark:text-white placeholder:text-[#94A3B8]"
          />
          <span className="text-[10px] text-[#94A3B8] shrink-0 tabular-nums">
            {hits.length} {hits.length === 1 ? "node" : "nodes"}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-[#F1F5F9] dark:hover:bg-[#2D2D2D] transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4 text-[#64748B]" />
          </button>
        </div>

        {/* Two-pane body: list on left, preview on right */}
        <div className="flex min-h-[420px] max-h-[65vh]">
          {/* Result list */}
          <div ref={resultsRef} className="flex-1 min-w-0 overflow-y-auto py-1 border-r border-[#E2E8F0] dark:border-[#2D2D2D] node-menu-surface">
            {hits.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-[#94A3B8]">
                {query ? "No nodes match your search." : "This workflow has no nodes yet."}
              </div>
            ) : (
              hits.map((hit, i) => {
                const isActive = i === selectedIndex
                const isCanvasFocused = hit.node.id === currentlyFocusedNodeId
                return (
                  <button
                    key={hit.node.id}
                    data-row-index={i}
                    type="button"
                    onMouseEnter={() => {
                      // Skip the mount-time synthetic mouseenter; only
                      // respect hover after the user has actually
                      // moved the cursor.
                      if (mouseHasMovedRef.current) setSelectedIndex(i)
                    }}
                    onClick={() => focusNode(hit.node.id, false)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                      // Mouse hover already moves selection via
                      // onMouseEnter (line below), so the `isActive`
                      // background IS the hover visual. Keep no
                      // separate `hover:bg-...` rule — otherwise
                      // arrow-keying away from a row the mouse is
                      // resting on shows TWO highlighted rows (the
                      // keyboard-selected one via isActive AND the
                      // mouse-rest one via CSS :hover).
                      isActive && "bg-[#F1F5F9] dark:bg-[#2D2D2D]",
                    )}
                  >
                    <div className="w-12 h-12 rounded-md bg-muted/40 flex items-center justify-center shrink-0 overflow-hidden">
                      {hit.videoUrl ? (
                        <video
                          src={hit.videoUrl}
                          poster={hit.thumbnailUrl}
                          className="w-full h-full object-cover"
                          autoPlay
                          loop
                          muted
                          playsInline
                          preload="metadata"
                        />
                      ) : hit.thumbnailUrl ? (
                        <CachedImage
                          src={hit.thumbnailUrl}
                          alt=""
                          className="w-full h-full object-cover"
                          thumbnail
                          thumbnailWidth={96}
                        />
                      ) : hit.pickerVisual ? (
                        <div className="w-full h-full flex items-center justify-center [&>*]:max-w-full [&>*]:max-h-full">
                          {hit.pickerVisual}
                        </div>
                      ) : (
                        <Cpu className="w-5 h-5 text-muted-foreground/60" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[#1E293B] dark:text-white truncate">
                          {hit.label}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#F1F5F9] dark:bg-[#2D2D2D] text-[#64748B] dark:text-[#94A3B8] shrink-0">
                          {hit.typeLabel}
                        </span>
                        {isCanvasFocused && (
                          <span
                            className="text-[9.5px] px-1.5 py-0.5 rounded-full bg-[#ff0073]/15 text-[#ff0073] font-semibold uppercase tracking-wide shrink-0 flex items-center gap-1"
                            title="Currently focused on the canvas"
                          >
                            <MapPin className="w-2.5 h-2.5" />
                            Here
                          </span>
                        )}
                      </div>
                      {hit.metaChips.length > 0 && (
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-[#64748B] dark:text-[#94A3B8] flex-wrap">
                          {hit.metaChips.map((chip, ci) => (
                            <span key={`${chip.key}-${ci}`} className="flex items-center gap-1">
                              {chip.icon === "ratio" && (
                                <span className="text-[#94A3B8]">
                                  <RatioIcon value={chip.value} label={chip.value} />
                                </span>
                              )}
                              <span>{chip.value}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </button>
                )
              })
            )}
          </div>

          {/* Preview pane (selected hit) */}
          <div className="w-[42%] shrink-0 hidden md:flex flex-col bg-[#F8FAFC] dark:bg-[#181818]">
            {activeHit ? <PreviewPane hit={activeHit} /> : <div className="m-auto text-sm text-[#94A3B8]">—</div>}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-[#E2E8F0] dark:border-[#2D2D2D] bg-[#F8FAFC] dark:bg-[#1A1A1A]">
          <div className="flex items-center gap-4 text-[10px] text-[#94A3B8] flex-wrap">
            <KbdHint keys={["↑", "↓"]} label="Navigate" />
            <KbdHint keys={["→"]} label="Peek (keep open)" />
            <KbdHint keys={["Enter"]} label="Focus & close" />
            <KbdHint keys={["Esc"]} label="Close" />
          </div>
        </div>
      </div>
    </div>
  )
}

/** Right-pane large preview for the selected hit. Image / picker visual
 *  on top, then label + type + meta chips, then a truncated prompt if
 *  the node carries one. */
function PreviewPane({ hit }: { hit: NodeSearchHit }) {
  return (
    <div className="flex-1 flex flex-col p-4 gap-3 min-h-0">
      <div className="aspect-square w-full max-h-[260px] rounded-lg bg-muted/30 dark:bg-[#222] flex items-center justify-center overflow-hidden">
        {hit.videoUrl ? (
          <video
            src={hit.videoUrl}
            poster={hit.thumbnailUrl}
            className="w-full h-full object-contain"
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
          />
        ) : hit.thumbnailUrl ? (
          <CachedImage
            src={hit.thumbnailUrl}
            alt={hit.label}
            className="w-full h-full object-contain"
          />
        ) : hit.pickerVisual ? (
          <div className="w-full h-full flex items-center justify-center [&>*]:max-w-full [&>*]:max-h-full">
            {hit.pickerVisual}
          </div>
        ) : (
          <Cpu className="w-12 h-12 text-muted-foreground/40" />
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-[#1E293B] dark:text-white truncate">
          {hit.label}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#F1F5F9] dark:bg-[#2D2D2D] text-[#64748B] dark:text-[#94A3B8]">
          {hit.typeLabel}
        </span>
      </div>
      {hit.metaChips.length > 0 && (
        <div className="flex items-center gap-2 text-[11px] text-[#64748B] dark:text-[#94A3B8] flex-wrap">
          {hit.metaChips.map((chip, ci) => (
            <span key={`${chip.key}-${ci}`} className="flex items-center gap-1">
              {chip.icon === "ratio" && (
                <span className="text-[#94A3B8]">
                  <RatioIcon value={chip.value} label={chip.value} />
                </span>
              )}
              <span>{chip.value}</span>
            </span>
          ))}
        </div>
      )}
      {hit.prompt && (
        <div className="text-[11px] text-[#475569] dark:text-[#94A3B8] leading-relaxed line-clamp-6 mt-1">
          {hit.prompt}
        </div>
      )}
    </div>
  )
}

function KbdHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((k) => (
        <kbd
          key={k}
          className="px-1.5 py-0.5 bg-white dark:bg-[#252525] rounded border border-[#E2E8F0] dark:border-[#3D3D3D] font-mono"
        >
          {k}
        </kbd>
      ))}
      {label}
    </span>
  )
}
