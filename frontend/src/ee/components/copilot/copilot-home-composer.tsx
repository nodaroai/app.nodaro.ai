/**
 * The Copilot's second door: describe a workflow from the home page and land
 * in the editor with it already being built.
 *
 * A floating glass composer rather than another card in the grid — the home
 * page is a list of things you already made, and this is the one control that
 * makes a new one. It can be dismissed, and it stays dismissed.
 *
 * No `@` here on purpose. A mention would have to survive the hop into the
 * editor, and the handoff carries the workflow's `source_prompt` — one string.
 * Mentioning inside the editor works and is one click further.
 */
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowRight, Bot, Loader2, X } from "lucide-react"
import { CopilotApiError, createCopilotThread } from "@/ee/lib/copilot/api"
import { COPILOT_STRINGS as S } from "@/ee/lib/copilot/strings"
import { useCopilotUiStore } from "@/hooks/use-copilot-ui-store"

/** Remembering the dismissal is per browser; there is nothing here worth a round-trip. */
const DISMISSED_KEY = "nodaro.copilot.home.dismissed"

const SUGGESTIONS: ReadonlyArray<{ text: string; dot: string }> = [
  { text: "Product shot workflow", dot: "var(--copilot-mention)" },
  { text: "Ad creatives for my brand", dot: "var(--primary)" },
  { text: "Script → narrated video", dot: "var(--copilot-ok)" },
  { text: "Character set", dot: "#818CF8" },
]

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "1"
  } catch {
    // Private mode, or site data blocked. Showing it is the better default.
    return false
  }
}

export default function CopilotHomeComposer() {
  const navigate = useNavigate()
  const openPanel = useCopilotUiStore((s) => s.openPanel)
  const [dismissed, setDismissed] = useState(readDismissed)
  const [prompt, setPrompt] = useState("")
  const [building, setBuilding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (dismissed) return null

  const dismiss = () => {
    setDismissed(true)
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1")
    } catch {
      // Not worth surfacing: it reappears next visit, nothing is lost.
    }
  }

  const build = async (text: string) => {
    const body = text.trim()
    if (!body || building) return
    setBuilding(true)
    setError(null)
    try {
      // One call creates the workflow (carrying the prompt as its
      // `source_prompt`) and the thread. The editor reads that back and sends
      // it as the first message, so a reload mid-hop loses nothing.
      const { thread, workflow } = await createCopilotThread({ prompt: body })
      openPanel()
      navigate(`/projects/${workflow.projectId}/workflows/${workflow.id}?copilot=${thread.id}`)
    } catch (err) {
      // The server's own words where it has them: "too many open copilot
      // conversations" and "temporarily unavailable" are both actionable, and
      // flattening them into "try again" sends the user round a loop against a
      // cap they cannot see.
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
    <div className="mb-5 rounded-2xl border border-border bg-[var(--copilot-panel)]/80 backdrop-blur-xl px-3 pt-3 pb-2.5 shadow-[0_20px_56px_rgba(0,0,0,0.12)] dark:shadow-[0_20px_56px_rgba(0,0,0,0.5)]">
      <div className="flex items-center gap-2.5">
        <Bot className="w-3.5 h-3.5 text-primary" strokeWidth={1.7} />
        <span className="text-[12.5px] font-semibold text-foreground">{S.title}</span>
        <span className="text-[11.5px] text-[var(--copilot-dim)] hidden sm:inline">{S.homeTagline}</span>
        <button
          type="button"
          onClick={dismiss}
          aria-label={S.homeDismiss}
          className="ml-auto w-[26px] h-[26px] flex-none rounded-[7px] border border-border bg-[var(--copilot-surface)] text-[var(--copilot-muted)] hover:text-foreground flex items-center justify-center transition-colors"
        >
          <X className="w-[11px] h-[11px]" strokeWidth={2.2} />
        </button>
      </div>

      <form
        className="flex items-center gap-2.5 mt-2.5"
        onSubmit={(e) => {
          e.preventDefault()
          void build(prompt)
        }}
      >
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={building}
          // Matches the server's own cap: a longer paste would come back a 400.
          maxLength={16000}
          placeholder={S.homePlaceholder}
          aria-label={S.homePlaceholder}
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
        <div role="alert" className="mt-2 text-[11.5px] text-[var(--copilot-fail)]">
          {error}
        </div>
      )}
      {/* The openers stay put when something fails — losing them makes a
          retry harder at exactly the moment the user needs it easier. */}
      <div className="flex gap-1.5 flex-wrap mt-2">
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
  )
}
