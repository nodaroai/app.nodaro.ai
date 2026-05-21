import { useCallback, useEffect, useRef, useState } from "react"
import type { ChatEnabledStage } from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { usePipelineChat } from "./use-pipeline-chat"
import { ChatHistory } from "./chat-history"
import { ChatInput } from "./chat-input"

interface Props {
  pipelineId: string
  stage: ChatEnabledStage
  /**
   * Called after a successful Apply lands. The parent uses this to
   * refetch the pipeline so the panel sees the new attempt + the stage's
   * approved status. The hook also invalidates the relevant React Query
   * caches, but the parent's refetch makes the UI update synchronous.
   */
  onApplied?: () => void
}

const STORAGE_KEY = "nodaro-pipeline-chat-width"
const MIN_WIDTH = 280
const MAX_WIDTH = 640
const DEFAULT_WIDTH = 380
const AUTO_COLLAPSE_VIEWPORT = 1280

/**
 * Phase 1D.2b — Adjacent chat panel mounted next to PipelinePanel
 * (which is fixed at right:0 width 420px). This panel renders to the
 * left of it.
 *
 * Features:
 *  - Resize handle on left edge; width clamps to [280, 640] and is
 *    persisted to localStorage(`nodaro-pipeline-chat-width`).
 *  - Minimize button collapses to a 32px tab showing the turn count.
 *  - Auto-collapse when the viewport drops below 1280px (with manual
 *    override — once the user clicks "expand", they stay expanded).
 *  - Composes ChatHistory + ChatInput around a single usePipelineChat
 *    instance.
 */
export function ChatPanel({ pipelineId, stage, onApplied }: Props) {
  const {
    turns,
    remaining,
    isAtCap,
    sendMessage,
    applyProposal,
    isSending,
    isApplying,
    applyError,
  } = usePipelineChat(pipelineId, stage)

  // ── width + persistence ───────────────────────────────────────────
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_WIDTH
    try {
      const raw = window.localStorage?.getItem(STORAGE_KEY)
      const n = raw ? Number(raw) : NaN
      if (!Number.isFinite(n)) return DEFAULT_WIDTH
      return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n))
    } catch {
      // localStorage may be unavailable (SSR / private mode / jsdom);
      // fall back to the default width.
      return DEFAULT_WIDTH
    }
  })

  useEffect(() => {
    try {
      window.localStorage?.setItem(STORAGE_KEY, String(width))
    } catch {
      // localStorage may be unavailable (SSR / private mode); ignore.
    }
  }, [width])

  // ── collapse state ────────────────────────────────────────────────
  const [collapsed, setCollapsed] = useState<boolean>(
    () =>
      typeof window !== "undefined" &&
      window.innerWidth < AUTO_COLLAPSE_VIEWPORT,
  )
  const userOverrode = useRef(false)

  useEffect(() => {
    if (typeof window === "undefined") return
    function onResize() {
      if (userOverrode.current) return
      setCollapsed(window.innerWidth < AUTO_COLLAPSE_VIEWPORT)
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  const toggleCollapsed = useCallback(() => {
    userOverrode.current = true
    setCollapsed((v) => !v)
  }, [])

  // ── resize drag ───────────────────────────────────────────────────
  const dragging = useRef(false)
  function onMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault()
    dragging.current = true
    document.body.style.cursor = "col-resize"
  }
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return
      // Pipeline panel is 420px wide on the right. Chat panel sits to
      // its left starting at `right: 420px`. Width is measured from the
      // mouse X to the chat panel's right edge (= window.innerWidth − 420).
      const rightEdge = window.innerWidth - 420
      const w = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, rightEdge - e.clientX))
      setWidth(w)
    }
    function onUp() {
      if (dragging.current) {
        dragging.current = false
        document.body.style.cursor = ""
      }
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
  }, [])

  // Surface the onApplied callback after the apply mutation lands. The
  // hook already invalidates caches; this exists so the parent can run
  // additional side effects (e.g. refetch the pipeline record).
  const lastAppliedCount = useRef(0)
  useEffect(() => {
    const appliedCount = turns.filter((t) => t.applied_to_attempt_id).length
    if (appliedCount > lastAppliedCount.current) {
      lastAppliedCount.current = appliedCount
      onApplied?.()
    }
  }, [turns, onApplied])

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={toggleCollapsed}
        className="fixed top-0 h-full z-40 w-8 border-l border-zinc-200 dark:border-[#2D2D2D] bg-zinc-50 dark:bg-[#121212] hover:bg-zinc-100 dark:hover:bg-[#1E1E1E] flex flex-col items-center justify-start pt-4 text-xs text-zinc-700 dark:text-zinc-200"
        style={{ right: 420 }}
        data-testid="chat-panel-collapsed"
        title="Open chat"
      >
        <span aria-hidden>💬</span>
        <span className="mt-1 font-medium">{turns.length}</span>
      </button>
    )
  }

  return (
    <aside
      className="fixed top-0 h-full z-40 border-l border-zinc-200 dark:border-[#2D2D2D] bg-zinc-50 dark:bg-[#121212] flex flex-col"
      style={{ right: 420, width }}
      data-testid="chat-panel"
    >
      <div
        className="absolute left-0 top-0 h-full w-1 cursor-col-resize hover:bg-[#ff0073]/40"
        onMouseDown={onMouseDown}
        data-testid="chat-panel-resize-handle"
      />
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E]">
        <div>
          <div className="text-xs uppercase text-zinc-500 dark:text-zinc-400">
            Refine
          </div>
          <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 capitalize">
            {stage.replace(/_/g, " ")} chat
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={toggleCollapsed}
          data-testid="chat-panel-collapse-btn"
          aria-label="Collapse chat"
        >
          —
        </Button>
      </div>
      <ChatHistory
        turns={turns}
        onApplyProposal={applyProposal}
        isApplying={isApplying}
        applyError={applyError}
      />
      <ChatInput
        onSend={sendMessage}
        isSending={isSending}
        isAtCap={isAtCap}
        remaining={remaining}
      />
    </aside>
  )
}
