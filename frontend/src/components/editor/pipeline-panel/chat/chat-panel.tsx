import { useCallback, useEffect, useRef, useState } from "react"
import type { ChatEnabledStage } from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { usePipelineChat } from "./use-pipeline-chat"
import { ChatHistory } from "./chat-history"
import { ChatInput } from "./chat-input"
import { useT } from "@/lib/i18n"
import { useLocaleStore } from "@/lib/locale-store"
import { STAGE_LABEL_KEYS } from "../stage-labels"

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
 * (which is fixed at the inline end, width 420px). This panel renders on
 * its inline-start side — left of it in LTR, right of it in RTL.
 *
 * Features:
 *  - Resize handle on the free (inline-start) edge; width clamps to [280, 640] and is
 *    persisted to localStorage(`nodaro-pipeline-chat-width`).
 *  - Minimize button collapses to a 32px tab showing the turn count.
 *  - Auto-collapse when the viewport drops below 1280px (with manual
 *    override — once the user clicks "expand", they stay expanded).
 *  - Composes ChatHistory + ChatInput around a single usePipelineChat
 *    instance.
 */
export function ChatPanel({ pipelineId, stage, onApplied }: Props) {
  const t = useT()
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
      // The pipeline panel is 420px wide on the inline END (right in LTR,
      // left in RTL). The chat panel docks against it at `inset-inline-end:
      // 420px`, so its docked edge sits at x = innerWidth − 420 (LTR) or
      // x = 420 (RTL), and the width runs from there to the mouse.
      const rtl = useLocaleStore.getState().dir === "rtl"
      const dragged = rtl ? e.clientX - 420 : window.innerWidth - 420 - e.clientX
      const w = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragged))
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
        className="fixed top-0 h-full z-40 w-8 border-s border-zinc-200 dark:border-[#2D2D2D] bg-zinc-50 dark:bg-[#121212] hover:bg-zinc-100 dark:hover:bg-[#1E1E1E] flex flex-col items-center justify-start pt-4 text-xs text-zinc-700 dark:text-zinc-200"
        style={{ insetInlineEnd: 420 }}
        data-testid="chat-panel-collapsed"
        title={t("pipe.openChat")}
      >
        <span aria-hidden>💬</span>
        <span className="mt-1 font-medium">{turns.length}</span>
      </button>
    )
  }

  return (
    <aside
      className="fixed top-0 h-full z-40 border-s border-zinc-200 dark:border-[#2D2D2D] bg-zinc-50 dark:bg-[#121212] flex flex-col"
      style={{ insetInlineEnd: 420, width }}
      data-testid="chat-panel"
    >
      <div
        className="absolute start-0 top-0 h-full w-1 cursor-col-resize hover:bg-[#ff0073]/40"
        onMouseDown={onMouseDown}
        data-testid="chat-panel-resize-handle"
      />
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E]">
        <div>
          <div className="text-xs uppercase text-zinc-500 dark:text-zinc-400">
            {t("pipe.refine")}
          </div>
          <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 capitalize">
            {t("pipe.stageChatTitle", { stage: t(STAGE_LABEL_KEYS[stage]) })}
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={toggleCollapsed}
          data-testid="chat-panel-collapse-btn"
          aria-label={t("pipe.collapseChat")}
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
