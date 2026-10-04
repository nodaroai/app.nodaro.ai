/**
 * The Copilot in the middle of an empty canvas — the first thing a new
 * workflow offers: say what to build, pick an opener, or start by hand.
 *
 * It never sends a message itself. The panel registers the editor callbacks a
 * send needs (save, run) when it mounts, so a message typed here is handed to
 * the rail with `sendFromCenter`, which opens it; the panel sends it once it
 * is up (copilot-panel.tsx). Adding a node — here, from the right-click menu,
 * the toolbar, anywhere — moves the Copilot to the rail as well, through the
 * canvas's own rules (copilot-placement.ts).
 *
 * Rendered by the core `CopilotCenterSlot`, which plays the exit (`leaving`)
 * before unmounting. It floats on the canvas, so it wears the canvas's own
 * surfaces (`--node-card`, `--pill-fg`, ...), not the rail's `--copilot-*` ramp.
 */
import { useEffect, useRef, useState } from "react"
import { ArrowRight } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { useClickOutside } from "@/hooks/use-click-outside"
import { useCopilotUiStore } from "@/hooks/use-copilot-ui-store"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useT } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import { START_MANUALLY_NODE_TYPES, quickAddEntries } from "@/lib/quick-add-nodes"
import { formatBinding, isMacPlatform } from "@/lib/shortcuts"
import { cn } from "@/lib/utils"
import { COPILOT_KEYS as K, COPILOT_SUGGESTIONS } from "@/ee/lib/copilot/strings"
import { useCopilotStore } from "@/ee/lib/copilot/turn-store"
import type { CopilotCenterProps } from "@/components/editor/workflow-editor/copilot-panel-slot"
import { firstNameOf } from "@/ee/lib/copilot/first-name"
import { CopilotOwnAi } from "./copilot-own-ai"
import { CopilotSettingsButton, CopilotSettingsControls, useCopilotSettingsChange } from "./copilot-settings"

/** The last "Ask Copilot…" request the middle acted on — module-wide, so a remount does not repeat it. */
let handledFocusTick = 0

/** Long enough not to compete with the editor's own first load. */
const PANEL_PREFETCH_DELAY_MS = 1500

export default function CopilotCenter({ leaving, onCreate, onContextMenu }: CopilotCenterProps) {
  const t = useT()
  const isRtl = useAppDir() === "rtl"
  const { user } = useAuth()
  const workflowId = useWorkflowStore((s) => s.workflowId)
  const draft = useCopilotStore((s) => s.draft)
  const setDraft = useCopilotStore((s) => s.setDraft)
  const sendFromCenter = useCopilotUiStore((s) => s.sendFromCenter)
  const focusTick = useCopilotUiStore((s) => s.focusTick)
  const setSettings = useCopilotSettingsChange()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const settingsRef = useRef<HTMLDivElement>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  useClickOutside(settingsRef, () => setSettingsOpen(false), settingsOpen)

  // The rail's panel is its own chunk, loaded the first time the rail opens.
  // Fetched while the person reads the middle, so a message sent from here
  // does not also wait for the download.
  useEffect(() => {
    const timer = window.setTimeout(() => void import("./copilot-panel").catch(() => {}), PANEL_PREFETCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [])

  // "Ask Copilot…" from the canvas menu while the Copilot sits here.
  useEffect(() => {
    if (focusTick <= handledFocusTick) return
    handledFocusTick = focusTick
    inputRef.current?.focus()
  }, [focusTick])

  const firstName = firstNameOf(user?.email, user?.user_metadata?.full_name as string | undefined)
  const quickNodes = quickAddEntries(START_MANUALLY_NODE_TYPES)
  const sendKeys = formatBinding({ key: "Enter", mods: ["mod"] }, isMacPlatform())

  const send = (text: string) => {
    const message = text.trim()
    if (!message || !workflowId) return
    // The rail's composer shares this draft; it must not open holding the sent text.
    setDraft("")
    sendFromCenter(message, workflowId)
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden px-6 py-10">
      <div
        onContextMenu={onContextMenu}
        className={cn(
          "w-full max-w-[640px] flex flex-col items-center gap-[18px] transition-[opacity,transform] duration-[350ms] ease-[cubic-bezier(.2,.8,.2,1)]",
          leaving
            ? cn("pointer-events-none opacity-0 scale-[.92]", isRtl ? "translate-x-[30%]" : "-translate-x-[30%]")
            : "pointer-events-auto opacity-100 animate-in fade-in-0 zoom-in-95 duration-300",
        )}
      >
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--pill-fg-muted)]/75">{t("canvas.pageEmpty")}</div>
        <h2 className="text-[36px] leading-tight font-semibold text-[var(--pill-fg)] tracking-[-0.022em] text-center">
          {firstName ? t(K.centerHeading, { name: firstName }) : t(K.centerHeadingAnon)}
        </h2>

        <div className="w-full rounded-[14px] border border-border bg-[var(--node-card)] ring-1 ring-primary/[0.08] shadow-[0_20px_60px_rgba(15,23,42,0.12)] dark:shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send(draft)
              }
            }}
            placeholder={t(K.centerPlaceholder)}
            rows={3}
            dir="auto"
            className="w-full bg-transparent border-none outline-none resize-none text-[var(--pill-fg)] text-[15px] leading-[1.5] px-5 pt-[18px] pb-2 placeholder:text-[var(--pill-fg-muted)]/65"
          />
          <div className="flex items-center gap-2.5 px-3 pt-2.5 pb-3 border-t border-[var(--node-border)]">
            <div ref={settingsRef} className="relative">
              <CopilotSettingsButton surface="canvas" open={settingsOpen} onToggle={() => setSettingsOpen((v) => !v)} />
              {settingsOpen && (
                <div className="absolute start-0 top-[calc(100%+8px)] z-20 w-[360px] p-3 rounded-[10px] border border-border bg-[var(--copilot-panel)] shadow-xl">
                  <CopilotSettingsControls onChange={setSettings} />
                </div>
              )}
            </div>
            <kbd className="ms-auto font-sans text-[11.5px] text-[var(--pill-fg-muted)]/60">{sendKeys}</kbd>
            <button
              type="button"
              // Always lit, as the call to action of an empty canvas; with nothing typed it points at the box.
              onClick={() => (draft.trim() ? send(draft) : inputRef.current?.focus())}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 transition-colors"
            >
              {t(K.build)}
              <ArrowRight className={cn("w-3.5 h-3.5", isRtl && "rotate-180")} strokeWidth={2.4} />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {COPILOT_SUGGESTIONS.map(({ textKey }) => {
            const text = t(textKey)
            return (
              <button
                key={textKey}
                type="button"
                onClick={() => send(text)}
                className="px-[13px] py-[7px] rounded-full border border-border bg-[var(--node-card)] text-[12.5px] text-[var(--pill-fg-muted)] hover:text-[var(--pill-fg)] hover:border-primary/50 transition-colors"
              >
                {text}
              </button>
            )
          })}
        </div>

        {quickNodes.length > 0 && (
          <>
            <div className="w-full flex items-center gap-3 mt-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--pill-fg-muted)]/50">
              <span className="flex-1 h-px bg-[var(--node-border)]" aria-hidden />
              {t(K.orStartManually)}
              <span className="flex-1 h-px bg-[var(--node-border)]" aria-hidden />
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {quickNodes.map((entry) => (
                <button
                  key={entry.type}
                  type="button"
                  onClick={() => onCreate(entry.type)}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-[9px] border border-border bg-[var(--node-card)] text-[13px] text-[var(--node-label)] hover:border-[var(--pill-fg-muted)]/40 transition-colors"
                >
                  <span className={cn("w-2 h-2 flex-none rounded-[2px]", entry.swatchClass)} aria-hidden />
                  {t(entry.labelKey)}
                </button>
              ))}
            </div>
            <p className="text-[11.5px] text-[var(--pill-fg-muted)]/60">{t(K.rightClickHint)}</p>
          </>
        )}

        <div className="mt-1 w-full">
          <CopilotOwnAi />
        </div>
      </div>
    </div>
  )
}
