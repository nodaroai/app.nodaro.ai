/**
 * The Copilot's second door: describe a workflow from the home page and land
 * in the editor with it already being built.
 *
 * A DOCK, not a card in the grid — it floats over the page at the bottom and
 * stays put while the workflow list scrolls under it. The × collapses it to a
 * pill rather than dismissing it: the old behaviour wrote a localStorage flag
 * and left no way back, so one stray click removed the feature permanently.
 *
 * `@` works here even though the hop into the editor carries ONE string. A
 * mention is not UI state that has to survive the navigation — `buildWireMessage`
 * appends it to the prose as a `[references]` line, so it travels inside
 * `source_prompt` exactly like the rest of the sentence, and the editor's own
 * message list splits it back into chips. Attachments still cannot travel that
 * way: a file would have to go as a URL, and `edit_workflow` refuses
 * model-authored addresses (#898).
 *
 * State is LOCAL on purpose. The editor composer binds its draft and mentions
 * to the module-level copilot store — which the panel shares and the failed
 * handoff seeds — so binding this one to the same store would let two surfaces
 * overwrite each other's text.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowRight, AtSign, Bot, Loader2, X } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { useCopilotUiStore } from "@/hooks/use-copilot-ui-store"
import { SHORTCUTS, formatBinding, isMacPlatform, matchShortcut } from "@/lib/shortcuts"
import { CopilotApiError, createCopilotThread } from "@/ee/lib/copilot/api"
import { COPILOT_MESSAGE_MAX_CHARS } from "@/ee/lib/copilot/constants"
import { activeMentionQuery, buildWireMessage, insertMentionName } from "@/ee/lib/copilot/mentions"
import { useCopilotMentions } from "@/ee/lib/copilot/use-copilot-mentions"
import { COPILOT_STRINGS as S } from "@/ee/lib/copilot/strings"
import { CopilotMentionPicker, MENTION_LIST_ID, MentionThumb } from "./copilot-mention-picker"
import type { CopilotMention } from "@/ee/lib/copilot/types"

/**
 * Remembering the collapsed state is per browser; there is nothing here worth a
 * round-trip. The key is the one the dismissal used, deliberately: an existing
 * "1" now means collapsed-to-a-pill, which is what those users wanted and can
 * finally undo.
 */
const DOCK_KEY = "nodaro.copilot.home.dismissed"

/** Matches `bottom-6`; the spacer has to clear the gap as well as the dock. */
const DOCK_BOTTOM_PX = 24
/** So the last row of workflow cards does not end flush against the glass. */
const DOCK_GAP_PX = 16

const SUGGESTIONS: ReadonlyArray<{ text: string; dot: string }> = [
  { text: "Product shot workflow", dot: "var(--copilot-mention)" },
  { text: "Ad creatives for my brand", dot: "var(--primary)" },
  { text: "Script → narrated video", dot: "var(--copilot-ok)" },
  { text: "Character set", dot: "#818CF8" },
]

/**
 * The design's glass, in tokens rather than its raw white alphas: on light mode
 * `--copilot-panel` IS white, so a 10%-white border is invisible against it.
 */
const GLASS =
  "bg-[var(--copilot-panel)]/60 dark:bg-[var(--copilot-panel)]/55 " +
  "backdrop-blur-[30px] backdrop-saturate-[160%] border border-border " +
  "shadow-[0_20px_56px_rgba(15,23,42,0.14)] dark:shadow-[0_20px_56px_rgba(0,0,0,0.5)]"

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(DOCK_KEY) === "1"
  } catch {
    // Private mode, or site data blocked. Showing it is the better default.
    return false
  }
}

export default function CopilotHomeComposer() {
  const navigate = useNavigate()
  const openPanel = useCopilotUiStore((s) => s.openPanel)
  const { user } = useAuth()
  const userId = user?.id

  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [prompt, setPrompt] = useState("")
  const [mentions, setMentions] = useState<CopilotMention[]>([])
  const [building, setBuilding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState<string | null>(null)
  const [activeMentionId, setActiveMentionId] = useState<string | undefined>(undefined)

  const inputRef = useRef<HTMLInputElement>(null)
  const dockRef = useRef<HTMLDivElement>(null)
  const [dockHeight, setDockHeight] = useState(0)

  // Every project's, not one project's: the home page has no project context,
  // and the workflow this creates lands in the default project regardless.
  // Passing no user id while collapsed is what disables the queries — a pill
  // should not cost a list request per entity kind on every visit to the home
  // page.
  const entityUserId = collapsed ? undefined : userId
  const { mentions: mentionSources, loading: mentionsLoading } = useCopilotMentions(undefined, entityUserId)

  /**
   * The dock is fixed, so it covers whatever the page's last rows are. The
   * spacer below the grid is what lets them scroll clear of it — measured
   * rather than guessed, because chips wrap and the error line appears, and a
   * constant would drift the first time either does. Before paint, so the
   * bottom of the page does not jump from 0 to the dock's height on mount.
   */
  useLayoutEffect(() => {
    const el = dockRef.current
    if (!el) return
    const measure = () => setDockHeight(el.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [collapsed])

  const collapsedRef = useRef(collapsed)
  collapsedRef.current = collapsed

  const setDock = useCallback((next: boolean) => {
    setCollapsed(next)
    try {
      window.localStorage.setItem(DOCK_KEY, next ? "1" : "0")
    } catch {
      // Not worth surfacing: it reverts next visit, nothing is lost.
    }
    if (!next) requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  // The same key that toggles the rail in the editor. NOT the design's ⌘K:
  // that is already `SHORTCUTS.search` ("Search projects & workflows"), so
  // binding it here would shadow a global the user knows.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!matchShortcut(e, SHORTCUTS.copilot)) return
      e.preventDefault()
      setDock(!collapsedRef.current)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [setDock])

  const shortcutLabel = formatBinding(SHORTCUTS.copilot.bindings[0], isMacPlatform())

  const syncQuery = (value: string, caret: number) => {
    const active = activeMentionQuery(value, caret)
    setQuery(active ? active.query : null)
  }

  const pick = (mention: CopilotMention) => {
    const el = inputRef.current
    const caret = el?.selectionStart ?? prompt.length
    // The name stays in the sentence, at the caret — a chip alone tells the
    // model WHO without telling it WHERE. See `insertMentionName`.
    const { text, caret: nextCaret } = insertMentionName(prompt, caret, mention.name)
    setMentions((prev) => (prev.some((m) => m.id === mention.id) ? prev : [...prev, mention]))
    setPrompt(text)
    setQuery(null)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(nextCaret, nextCaret)
    })
  }

  const openPicker = () => {
    const el = inputRef.current
    const next = prompt && !/\s$/.test(prompt) ? `${prompt} @` : `${prompt}@`
    setPrompt(next)
    setQuery("")
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(next.length, next.length)
    })
  }

  // What the references line costs, so the input's own cap can leave room for
  // it. Without this a maxed-out paste plus a mention is a 400 from the server
  // AFTER the click — the one moment the user has no idea what went wrong.
  const refsOverhead = mentions.length > 0 ? buildWireMessage("", mentions).length + 2 : 0
  const promptLimit = Math.max(1, COPILOT_MESSAGE_MAX_CHARS - refsOverhead)

  const build = async (text: string) => {
    const body = text.trim()
    if (!body || building) return
    // The cap above bounds typing, not pasting-then-mentioning, so the wire
    // message is checked for real before anything is spent.
    const wire = buildWireMessage(body, mentions)
    if (wire.length > COPILOT_MESSAGE_MAX_CHARS) {
      setError(S.homeTooLong)
      return
    }
    setBuilding(true)
    setError(null)
    setQuery(null)
    try {
      // One call creates the workflow (carrying the prompt as its
      // `source_prompt`) and the thread. The editor reads that back and sends
      // it as the first message, so a reload mid-hop loses nothing.
      const { thread, workflow } = await createCopilotThread({ prompt: wire })
      openPanel()
      // Encoded, though every id here is a UUID the server just minted: it
      // costs nothing, and the day one of them stops being a UUID this line
      // does not quietly become a broken route.
      navigate(
        `/projects/${encodeURIComponent(workflow.projectId)}/workflows/${encodeURIComponent(workflow.id)}` +
          `?copilot=${encodeURIComponent(thread.id)}`,
      )
    } catch (err) {
      // The server's own words where they help the user act — "too many open
      // copilot conversations" is the case this exists for. The rate limiter's
      // is an internal detail ("Limit: 5 per 60s") and gets our sentence.
      setError(
        err instanceof CopilotApiError && err.code !== "rate_limit_exceeded" ? err.message : S.homeBuildFailed,
      )
      setBuilding(false)
    }
  }

  return (
    <>
      <div aria-hidden style={{ height: dockHeight + DOCK_BOTTOM_PX + DOCK_GAP_PX }} />
      {/* The wrapper spans the dock's full width but must not swallow clicks
          on the cards behind it — only the glass itself is interactive. */}
      <div
        ref={dockRef}
        className="fixed left-1/2 -translate-x-1/2 z-40 w-[660px] max-w-[calc(100vw-2rem)] pointer-events-none"
        style={{ bottom: DOCK_BOTTOM_PX }}
      >
        {collapsed ? (
          <CollapsedPill shortcut={shortcutLabel} onOpen={() => setDock(false)} />
        ) : (
          <div className="pointer-events-auto relative">
            {query !== null && (
              <CopilotMentionPicker
                query={query}
                mentions={mentionSources}
                onPick={pick}
                onActiveChange={setActiveMentionId}
                onClose={() => setQuery(null)}
                insetClassName="left-0 right-0"
                loading={mentionsLoading}
              />
            )}

            <div className={`rounded-2xl px-3 pt-3 pb-2.5 flex flex-col gap-2.5 ${GLASS}`}>
              <div className="flex items-center gap-2.5">
                <Bot className="w-3.5 h-3.5 text-primary" strokeWidth={1.7} />
                <span className="text-[12.5px] font-semibold text-foreground">{S.title}</span>
                <span className="text-[11.5px] text-[var(--copilot-dim)] hidden sm:inline truncate">
                  {S.homeTagline}
                </span>
                <button
                  type="button"
                  onClick={() => setDock(true)}
                  aria-label={S.homeCollapse}
                  title={`${S.homeCollapse} (${shortcutLabel})`}
                  className="ml-auto w-[26px] h-[26px] flex-none rounded-[7px] border border-border bg-[var(--copilot-surface)] text-[var(--copilot-muted)] hover:text-foreground flex items-center justify-center transition-colors"
                >
                  <X className="w-[11px] h-[11px]" strokeWidth={2.2} />
                </button>
              </div>

              {mentions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {mentions.map((mention) => (
                    <span
                      key={`${mention.kind}:${mention.id}`}
                      className="inline-flex items-center gap-1.5 pl-1 pr-1.5 py-[3px] rounded-[7px] text-[11.5px] text-foreground whitespace-nowrap bg-[var(--copilot-mention)]/10 border border-[var(--copilot-mention)]/40"
                    >
                      <MentionThumb mention={mention} size={16} />
                      {mention.name}
                      <button
                        type="button"
                        aria-label={`Remove ${mention.name}`}
                        onClick={() => {
                          setMentions((prev) => prev.filter((m) => m.id !== mention.id))
                          // "…or remove a mention" is the advice the length
                          // error gives; taking it must clear the error.
                          if (error) setError(null)
                        }}
                        className="w-3.5 h-3.5 leading-none text-[13px] text-[var(--copilot-muted)] hover:text-foreground"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <form
                className="flex items-center gap-2.5"
                onSubmit={(e) => {
                  e.preventDefault()
                  void build(prompt)
                }}
              >
                <button
                  type="button"
                  onClick={openPicker}
                  disabled={building}
                  aria-label={S.mention}
                  className="w-[26px] h-[26px] flex-none rounded-[7px] border border-border bg-[var(--copilot-surface)] text-[var(--copilot-muted)] hover:text-[var(--copilot-mention)] flex items-center justify-center transition-colors disabled:opacity-50"
                >
                  <AtSign className="w-3 h-3" strokeWidth={2} />
                </button>
                <input
                  ref={inputRef}
                  value={prompt}
                  disabled={building}
                  maxLength={promptLimit}
                  placeholder={S.homePlaceholder}
                  aria-label={S.homePlaceholder}
                  // Focus never leaves the input while the picker is open, so
                  // the combobox wiring is what tells a screen reader a list
                  // appeared and which row the arrow keys are on.
                  role="combobox"
                  aria-expanded={query !== null}
                  aria-controls={query !== null ? MENTION_LIST_ID : undefined}
                  aria-activedescendant={query !== null ? activeMentionId : undefined}
                  aria-autocomplete="list"
                  onChange={(e) => {
                    setPrompt(e.target.value)
                    // "Too long" is answered by editing, so leaving it on
                    // screen while they edit tells them the fix did not work.
                    if (error) setError(null)
                    syncQuery(e.target.value, e.target.selectionStart ?? e.target.value.length)
                  }}
                  onClick={(e) => syncQuery(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
                  // The picker listens on the window in capture phase, so
                  // leaving it open after the composer loses focus would
                  // swallow arrow keys and Escape for the whole page.
                  onBlur={() => setQuery(null)}
                  className="flex-1 min-w-0 bg-transparent border-none outline-none text-[13.5px] text-foreground placeholder:text-[var(--copilot-dim)] disabled:cursor-not-allowed"
                />
                <button
                  type="submit"
                  disabled={building || prompt.trim().length === 0}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-[9px] bg-primary text-primary-foreground text-[12.5px] font-semibold whitespace-nowrap disabled:opacity-50 transition-opacity"
                >
                  {building ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                  {S.homeBuild}
                  {!building && <ArrowRight className="w-3 h-3" strokeWidth={2.4} />}
                </button>
              </form>

              {error && (
                <div role="alert" className="text-[11.5px] text-[var(--copilot-fail)]">
                  {error}
                </div>
              )}

              {/* The openers stay put when something fails — losing them makes
                  a retry harder at exactly the moment the user needs it easier.
                  Below `sm` they wrap to three rows and the dock swallows a
                  third of a phone screen, so there they are dropped. */}
              <div className="hidden sm:flex gap-1.5 flex-wrap">
                {SUGGESTIONS.map(({ text, dot }) => (
                  <button
                    key={text}
                    type="button"
                    disabled={building}
                    onClick={() => void build(text)}
                    className="flex items-center gap-[7px] px-2.5 py-[5px] rounded-full border border-border bg-[var(--copilot-surface)] text-[11.5px] text-[var(--copilot-muted)] whitespace-nowrap hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    <span className="w-1 h-1 rounded-full" style={{ background: dot }} aria-hidden />
                    {text}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

/**
 * The whole dock, folded down to the smallest thing that still says what it is
 * and how to get it back. This is what × leaves behind — there is deliberately
 * no state in which the Copilot is gone from this page.
 */
function CollapsedPill({ shortcut, onOpen }: { shortcut: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={S.homeExpand}
      title={`${S.title} (${shortcut})`}
      className={`pointer-events-auto mx-auto flex items-center gap-2.5 px-4 py-2.5 rounded-full ${GLASS}`}
    >
      <Bot className="w-3.5 h-3.5 text-primary" strokeWidth={1.7} />
      <span className="text-[12.5px] font-semibold text-foreground">{S.title}</span>
      <span className="font-mono text-[11px] text-[var(--copilot-dim)]">{shortcut}</span>
    </button>
  )
}
