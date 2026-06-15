"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useReactFlow } from "@xyflow/react"
import { Search, X, Cpu, MapPin, ArrowLeft, ArrowRight, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { CachedImage } from "@/components/ui/cached-image"
import { getNodeThumbnailUrl, getNodeVideoUrl, getNodePickerVisual, getNodeConfigSummary } from "@/lib/node-thumbnail"
import { getNodeConnectors, focusedNodeHandles, partitionConnectors, type NodeConnector } from "@/lib/node-connectors"
import { handleTypeIcon } from "@/lib/handle-type-icon"
import { nearestNodeInDirection } from "@/lib/node-spatial-nav"
import { focusNodeInViewport } from "@/lib/focus-node-in-viewport"
import { optimizedImageUrl } from "@/lib/image"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useClickOutside } from "@/hooks/use-click-outside"
import { type WorkflowNode } from "@/types/nodes"
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
  /** Valid connectors between the focused canvas node and this row's node
   *  (empty when no node is focused or none connect). `connectors` is the flat
   *  From-first list (keyboard Tab order); `from`/`to` are the memoized split. */
  readonly connectors: ReadonlyArray<NodeConnector>
  readonly from: ReadonlyArray<NodeConnector>
  readonly to: ReadonlyArray<NodeConnector>
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
  "describe-to-picker": "Describe to Picker",
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
    // Selected picker values (resolved to catalog labels) so a node is
    // findable by what it holds — e.g. typing "calm" finds the Mood node.
    getNodeConfigSummary(node).map((c) => c.value).join(" "),
  ]
  return parts.filter((p): p is string => !!p && p.length > 0).join("  ").toLowerCase()
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
  const edges = useWorkflowStore((s) => s.edges)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const focusNodeOnCanvas = useWorkflowStore((s) => s.focusNodeOnCanvas)
  const onConnect = useWorkflowStore((s) => s.onConnect)
  const deleteEdge = useWorkflowStore((s) => s.deleteEdge)
  // "Currently focused" = the canonical `focusedNodeId` (kept in sync with the
  // canvas selection by the store). Falls back to selection state for safety.
  // Drives the "Here" badge AND which node the connector strips target. Returns
  // a string|null primitive so Zustand's Object.is equality only re-renders on
  // an actual focus change, not on every nodes-array mutation.
  const currentlyFocusedNodeId = useWorkflowStore(
    (s) => s.focusedNodeId ?? s.selectedNodeId ?? s.nodes.find((n) => n.selected)?.id ?? null,
  )
  // Keyboard "connector mode": null = browsing the list; a number = the focused
  // connector index within the selected row's strip (Tab dives in, Esc/↑↓ exit).
  const [connectorIndex, setConnectorIndex] = useState<number | null>(null)
  // Which multi-handle From/To group is mouse-expanded, as `${nodeId}:from|to`.
  const [expandedDir, setExpandedDir] = useState<string | null>(null)
  const { setCenter, getNode } = useReactFlow()

  useEffect(() => {
    if (!open) return
    setQuery("")
    setSelectedIndex(0)
    setConnectorIndex(null)
    setExpandedDir(null)
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

  useClickOutside(containerRef, onClose, open)

  const tokens = useMemo(
    () => query.trim().toLowerCase().split(/\s+/).filter((t) => t.length > 0),
    [query],
  )

  const hits = useMemo<NodeSearchHit[]>(() => {
    if (!open) return []
    const focusedNode = currentlyFocusedNodeId
      ? (nodes as WorkflowNode[]).find((n) => n.id === currentlyFocusedNodeId)
      : undefined
    // Hoist the focused node's handle sets out of the per-row loop — they depend
    // only on its type, and `hits` re-runs on every connect/disconnect.
    const focusedHandles = focusedNode ? focusedNodeHandles(focusedNode.type) : undefined
    // Node ids with a LIVE edge to/from the focused node — the ground truth for
    // "already connected" (independent of connector enumeration). Drives the
    // top-of-list ranking so wired neighbours surface first.
    const connectedIds = new Set<string>()
    if (focusedNode) {
      for (const e of edges) {
        if (e.source === focusedNode.id) connectedIds.add(e.target)
        else if (e.target === focusedNode.id) connectedIds.add(e.source)
      }
    }

    const makeHit = (n: WorkflowNode): NodeSearchHit => {
      const data = (n.data ?? {}) as Record<string, unknown>
      const label =
        (typeof data.label === "string" && data.label.trim().length > 0
          ? data.label
          : typeLabel(n.type)) as string
      const connectors =
        focusedNode && focusedNode.id !== n.id
          ? getNodeConnectors(
              { id: focusedNode.id, type: focusedNode.type },
              { id: n.id, type: n.type },
              edges,
              // From/To buttons collapse handles, so allow more than the old
              // compact-chip cap — the expanded list shows them all.
              { focusedHandles, max: 8 },
            )
          : []
      // Partition into From/To ONCE here (memoized), so the render path reads
      // hit.from / hit.to instead of re-splitting on every keystroke/selection.
      const { from, to } = partitionConnectors(connectors)
      return {
        node: n,
        thumbnailUrl: getNodeThumbnailUrl(n),
        videoUrl: getNodeVideoUrl(n),
        pickerVisual: getNodePickerVisual(n),
        label,
        typeLabel: typeLabel(n.type),
        prompt: typeof data.prompt === "string" ? data.prompt : undefined,
        metaChips: getNodeConfigSummary(n),
        connectors,
        from,
        to,
      }
    }

    const list: NodeSearchHit[] = []
    for (const n of nodes as WorkflowNode[]) {
      if (!n.type) continue
      if (n.type === "sticky-note") continue
      if (tokens.length > 0) {
        const haystack = buildSearchHaystack(n)
        if (!tokens.every((t) => haystack.includes(t))) continue
      }
      list.push(makeHit(n))
    }

    // Rank rows: already-connected to the focused node first, then connectable
    // (a valid wire exists), then the rest. V8's sort is stable, so search
    // ranking is preserved within each tier. The focused node itself has no
    // self-connectors and isn't in connectedIds, so it sorts down here — then
    // gets pinned to the very top below.
    const rank = (h: NodeSearchHit) =>
      connectedIds.has(h.node.id) ? 2 : h.connectors.length > 0 ? 1 : 0
    list.sort((a, b) => rank(b) - rank(a))

    // Keep the currently-focused node ("Here") pinned to the very top and always
    // present as the connector anchor — even when the active query filters it
    // out (inject it back). The render marks this row sticky so it stays visible
    // while the rest of the list scrolls underneath.
    if (focusedNode) {
      const idx = list.findIndex((h) => h.node.id === focusedNode.id)
      if (idx > 0) {
        const [pinned] = list.splice(idx, 1)
        list.unshift(pinned)
      } else if (idx === -1) {
        list.unshift(makeHit(focusedNode))
      }
    }
    return list.slice(0, 50)
  }, [open, nodes, edges, tokens, currentlyFocusedNodeId])

  useEffect(() => {
    if (selectedIndex >= hits.length) setSelectedIndex(Math.max(0, hits.length - 1))
  }, [hits.length, selectedIndex])

  // Jump to a node on the canvas (pan + zoom + select) and dismiss the modal.
  const focusNode = useCallback(
    (nodeId: string) => {
      focusNodeInViewport(getNode, setCenter, selectNode, nodeId)
      onClose()
    },
    [getNode, setCenter, selectNode, onClose],
  )

  // Connect / disconnect the edge a connector represents — live on the canvas,
  // modal stays open so the user can keep wiring.
  const toggleConnector = useCallback(
    (c: NodeConnector) => {
      if (c.connected && c.edgeId) deleteEdge(c.edgeId)
      else onConnect({ source: c.source, sourceHandle: c.sourceHandle, target: c.target, targetHandle: c.targetHandle })
    },
    [deleteEdge, onConnect],
  )

  // Leaving a row exits its keyboard connector focus. `expandedDir` is keyed by
  // node id AND gated on the active row at render, so a stale value can't expand
  // the wrong row — leave it (clicking a connector also moves selectedIndex, and
  // clearing it here would collapse the group the click just opened).
  useEffect(() => {
    setConnectorIndex(null)
  }, [selectedIndex])

  // Re-targeting the focused node (Alt+←/→) recomputes every row's connectors,
  // so a stale keyboard connector cursor (or mouse expansion) would point at the
  // wrong connector / out of bounds. Reset both when the focused node changes.
  useEffect(() => {
    setConnectorIndex(null)
    setExpandedDir(null)
  }, [currentlyFocusedNodeId])

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
      // Alt+Left / Alt+Right — re-target the focused node on the canvas (which
      // re-points the connector strips) WITHOUT panning. Other Alt combos pass
      // through untouched.
      if (e.altKey && !e.ctrlKey && !e.metaKey && (key === "ArrowLeft" || key === "ArrowRight")) {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        if (currentlyFocusedNodeId) {
          const neighbor = nearestNodeInDirection(
            nodes,
            currentlyFocusedNodeId,
            key === "ArrowLeft" ? "ArrowLeft" : "ArrowRight",
          )
          if (neighbor) focusNodeOnCanvas(neighbor)
        }
        return
      }

      const interesting =
        key === "Escape" || key === "ArrowDown" || key === "ArrowUp" ||
        key === "ArrowRight" || key === "ArrowLeft" || key === "Enter" || key === "Tab"
      if (!interesting) return

      const hit = hits[selectedIndex]
      const connectors = hit?.connectors ?? []
      // Tab with nothing to dive into: let it pass (don't trap focus / dead-end
      // it) — return BEFORE consuming so default focus movement still works.
      if (key === "Tab" && connectors.length === 0) return

      // Consume so arrow / Tab never leak to the canvas behind (no stray pan or
      // selection move) — the modal owns these keys while it's open. This also
      // removes the old ArrowRight "peek" that panned the canvas.
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()

      const inConnectorMode = connectorIndex !== null
      const cycle = (delta: number) =>
        setConnectorIndex((ci) => (ci === null ? ci : (ci + delta + connectors.length) % connectors.length))

      if (key === "Escape") {
        if (inConnectorMode) setConnectorIndex(null)
        else onClose()
      } else if (key === "ArrowDown") {
        setConnectorIndex(null)
        setSelectedIndex((i) => Math.min(i + 1, hits.length - 1))
      } else if (key === "ArrowUp") {
        setConnectorIndex(null)
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (key === "Tab") {
        if (!inConnectorMode) setConnectorIndex(0)
        else cycle(e.shiftKey ? -1 : 1)
      } else if (key === "Enter") {
        if (connectorIndex !== null && connectors[connectorIndex]) toggleConnector(connectors[connectorIndex])
        else if (hit) focusNode(hit.node.id)
      } else if (key === "ArrowLeft" || key === "ArrowRight") {
        // In connector mode, plain left/right move between connectors;
        // otherwise a deliberate no-op. Consumed above either way, so they
        // never reach the canvas (fixes the left/right-pans-canvas bug).
        if (inConnectorMode && connectors.length > 0) cycle(key === "ArrowRight" ? 1 : -1)
      }
    }
    window.addEventListener("keydown", handler, { capture: true })
    return () => window.removeEventListener("keydown", handler, { capture: true })
  }, [open, hits, selectedIndex, focusNode, onClose, connectorIndex, toggleConnector, nodes, currentlyFocusedNodeId, focusNodeOnCanvas])

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
                // From = result → focused (an INPUT of the focused node);
                // To = focused → result (an OUTPUT of the focused node).
                const fromGroup = hit.from
                const toGroup = hit.to
                const focusedConn = isActive && connectorIndex !== null ? hit.connectors[connectorIndex] : null
                const focusedKey = focusedConn?.key ?? null
                const fromKey = `${hit.node.id}:from`
                const toKey = `${hit.node.id}:to`
                // A group expands only on the ACTIVE row (no stale expansion left
                // on inactive rows), via mouse (expandedDir) OR keyboard focus.
                const groupExpanded = (group: ReadonlyArray<NodeConnector>, key: string) =>
                  isActive &&
                  group.length > 1 &&
                  (expandedDir === key || (focusedConn != null && group.some((c) => c.key === focusedConn.key)))
                const fromExpanded = groupExpanded(fromGroup, fromKey)
                const toExpanded = groupExpanded(toGroup, toKey)
                const onToggleConn = (c: NodeConnector) => {
                  setSelectedIndex(i)
                  setConnectorIndex(hit.connectors.findIndex((x) => x.key === c.key))
                  toggleConnector(c)
                }
                return (
                  <div
                    key={hit.node.id}
                    data-row-index={i}
                    onMouseEnter={() => {
                      // Skip the mount-time synthetic mouseenter; only respect
                      // hover after the user has actually moved the cursor.
                      if (mouseHasMovedRef.current) setSelectedIndex(i)
                    }}
                    className={cn(
                      "w-full flex items-center gap-2 px-4 py-2.5 transition-colors",
                      // The focused "Here" row stays pinned + visible at the top
                      // while the rest of the list scrolls underneath. It needs an
                      // opaque background so scrolled rows don't bleed through.
                      isCanvasFocused &&
                        "sticky top-0 z-20 border-b border-[#E2E8F0] dark:border-[#2D2D2D]",
                      // onMouseEnter moves selection, so `isActive` IS the hover
                      // visual — no separate hover:bg (avoids double-highlight).
                      // active bg and the focused row's opaque base are mutually
                      // exclusive so the two `bg-*` utilities never conflict.
                      isActive
                        ? "bg-[#F1F5F9] dark:bg-[#2D2D2D]"
                        : isCanvasFocused && "bg-white dark:bg-[#1E1E1E]",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => focusNode(hit.node.id)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    >
                    <div className="w-12 h-12 rounded-md bg-muted/40 flex items-center justify-center shrink-0 overflow-hidden">
                      {hit.videoUrl ? (
                        <video
                          src={hit.videoUrl}
                          poster={optimizedImageUrl(hit.thumbnailUrl, { width: 96 })}
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
                          {hit.metaChips.map((chip, mi) => (
                            <span key={`${chip.key}-${mi}`} className="flex items-center gap-1">
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
                    {hit.connectors.length > 0 && (
                      <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end max-w-[58%]">
                        {fromGroup.length > 0 && (
                          <ConnectorGroup
                            dir="from"
                            group={fromGroup}
                            expanded={fromExpanded}
                            focusedKey={focusedKey}
                            onToggle={onToggleConn}
                            onExpandToggle={() => {
                              setSelectedIndex(i)
                              setExpandedDir((p) => (p === fromKey ? null : fromKey))
                            }}
                          />
                        )}
                        {toGroup.length > 0 && (
                          <ConnectorGroup
                            dir="to"
                            group={toGroup}
                            expanded={toExpanded}
                            focusedKey={focusedKey}
                            onToggle={onToggleConn}
                            onExpandToggle={() => {
                              setSelectedIndex(i)
                              setExpandedDir((p) => (p === toKey ? null : toKey))
                            }}
                          />
                        )}
                      </div>
                    )}
                  </div>
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
            <KbdHint keys={["Tab"]} label="Connectors" />
            <KbdHint keys={["Enter"]} label="Focus / toggle" />
            <KbdHint keys={["⌥", "←→"]} label="Move focus" />
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
            poster={optimizedImageUrl(hit.thumbnailUrl, { width: 640 })}
            className="w-full h-full object-contain"
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
          />
        ) : hit.thumbnailUrl ? (
          // Preview box is ≤260px tall; a 640px variant is retina-crisp without
          // pulling the 2048px FULL_VIEW_OPTS original on every row selection.
          <CachedImage
            src={hit.thumbnailUrl}
            alt={hit.label}
            className="w-full h-full object-contain"
            thumbnail
            thumbnailWidth={640}
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

/** From/To connector control for ONE direction of a result row (relative to the
 *  focused node): `from` = wire that node INTO the focused node (its input),
 *  `to` = wire the focused node's output INTO that node. A single handle toggles
 *  directly; multiple handles collapse to a summary button that expands to a
 *  per-handle toggle list. Arrow shows direction; the type icon + color mirror
 *  the handle pip of the connection's type. */
function ConnectorGroup({
  dir,
  group,
  expanded,
  focusedKey,
  onToggle,
  onExpandToggle,
}: {
  readonly dir: "from" | "to"
  readonly group: ReadonlyArray<NodeConnector>
  readonly expanded: boolean
  readonly focusedKey: string | null
  readonly onToggle: (c: NodeConnector) => void
  readonly onExpandToggle: () => void
}) {
  const Arrow = dir === "from" ? ArrowLeft : ArrowRight
  const dirLabel = dir === "from" ? "From" : "To"
  const tip = dir === "from" ? "input from this node" : "output to this node"
  const color = group[0]?.color
  const typeIcon = handleTypeIcon(group[0]?.type)

  const pill = (
    key: string,
    opts: {
      connected: boolean
      focused: boolean
      label: string
      title: string
      // Distinct accessible name per pill — visible label is just "From"/"To"
      // or a handle name, so without this every row's pill reads identically.
      ariaLabel: string
      onClick: () => void
      leading: ReactNode
      caret?: boolean
      // A multi-handle summary is an expander, not a toggle, so it omits
      // aria-pressed (its "any connected" state was misleading). Direct toggles
      // (single handle / expanded chip) leave this false and get aria-pressed.
      isExpander?: boolean
    },
  ) => (
    <button
      key={key}
      type="button"
      {...(opts.isExpander ? {} : { "aria-pressed": opts.connected })}
      aria-label={opts.ariaLabel}
      title={opts.title}
      onClick={(e) => {
        e.stopPropagation()
        opts.onClick()
      }}
      className={cn(
        "flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10.5px] border transition-colors max-w-[140px]",
        opts.connected
          ? "bg-[#ff0073]/12 border-[#ff0073]/45 text-[#ff0073]"
          : "border-[#E2E8F0] dark:border-[#3D3D3D] text-[#64748B] dark:text-[#94A3B8] hover:border-[#94A3B8]",
        opts.focused && "ring-2 ring-[#ff0073]/70",
      )}
    >
      {opts.leading}
      <span className="truncate" aria-hidden>{opts.label}</span>
      {opts.caret && <ChevronDown className="w-3 h-3 shrink-0 opacity-70" />}
    </button>
  )

  const dirGlyphs = (
    <>
      <Arrow className="w-3 h-3 shrink-0" />
      <span aria-hidden className="shrink-0 flex items-center [&>svg]:w-3 [&>svg]:h-3" style={color ? { color } : undefined}>
        {typeIcon}
      </span>
    </>
  )

  if (group.length === 1) {
    const c = group[0]
    return pill(c.key, {
      connected: c.connected,
      focused: focusedKey === c.key,
      label: dirLabel,
      title: `${c.connected ? "Disconnect" : "Connect"} — ${dirLabel.toLowerCase()} (${c.label}), ${tip}`,
      ariaLabel: `${dirLabel} ${c.label}: ${c.connected ? "connected" : "not connected"}`,
      onClick: () => onToggle(c),
      leading: dirGlyphs,
    })
  }

  if (!expanded) {
    const connCount = group.filter((c) => c.connected).length
    return pill(`${dir}-summary`, {
      connected: connCount > 0,
      focused: group.some((c) => c.key === focusedKey),
      label: connCount > 0 ? `${dirLabel} · ${connCount}` : dirLabel,
      title: `${dirLabel} — ${group.length} options (${tip})`,
      ariaLabel: `${dirLabel}: ${group.length} connection options${connCount > 0 ? `, ${connCount} connected` : ""}`,
      isExpander: true,
      onClick: onExpandToggle,
      caret: true,
      leading: dirGlyphs,
    })
  }

  return (
    <span className="flex items-center gap-1 flex-wrap rounded-full bg-black/[0.03] dark:bg-white/[0.04] pl-1.5 pr-0.5 py-0.5">
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground/80">
        {dirGlyphs}
        {dirLabel}
      </span>
      {group.map((c) =>
        pill(c.key, {
          connected: c.connected,
          focused: focusedKey === c.key,
          label: c.label,
          title: `${c.connected ? "Disconnect" : "Connect"} ${c.label} (${tip})`,
          ariaLabel: `${c.connected ? "Disconnect" : "Connect"} ${c.label}, ${dirLabel.toLowerCase()} ${tip}`,
          onClick: () => onToggle(c),
          leading: (
            // Per-handle color (not the group header's) so a future mixed-type
            // group stays correct.
            <span
              aria-hidden
              className="w-2 h-2 rounded-full shrink-0"
              style={c.connected ? { backgroundColor: "#ff0073" } : { border: `1.5px solid ${c.color ?? "#94A3B8"}` }}
            />
          ),
        }),
      )}
    </span>
  )
}
