/**
 * "It is working, and here is what on."
 *
 * Between pressing send and the first token there could be ten or twenty
 * seconds of save, handshake, prompt cache read and tool calls, and the panel
 * showed NOTHING for all of it — the user's own bubble and then blank space.
 * People read that as a crash and sent the message again, which costs another
 * turn. This pill is the fix: it appears the instant a turn starts and names
 * the step the copilot is on.
 *
 * The timer lives HERE rather than in the store or the conversation. A second
 * tick in either of those re-renders the whole message list and re-fires the
 * scroll-to-bottom effect, which would fight the user every time they scrolled
 * up to read something.
 */
import { useEffect, useState } from "react"
import { COPILOT_STRINGS as S } from "@/ee/lib/copilot/strings"
import type { CopilotActivity } from "@/ee/lib/copilot/types"

interface CopilotLivePillProps {
  /** The step to name. The newest activity wins; before the first one, a default. */
  activities: readonly CopilotActivity[]
  startedAt: number | null
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`
}

export function CopilotLivePill({ activities, startedAt }: CopilotLivePillProps) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (startedAt === null) return
    // Mounted only while the turn streams, so the interval ends with the turn;
    // there is no "stop the clock" branch to get wrong.
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [startedAt])

  const step = activities.length > 0 ? activities[activities.length - 1]!.label : S.stepStarting

  return (
    <div className="self-start flex items-center gap-2.5 px-3 py-[7px] rounded-full bg-[var(--copilot-surface)] border border-border">
      <span className="w-[7px] h-[7px] flex-none rounded-full bg-primary animate-pulse" aria-hidden />
      <span className="text-xs text-foreground whitespace-nowrap">{step}</span>
      {startedAt !== null && (
        <>
          <span className="w-px h-[11px] bg-[var(--copilot-strong)]" aria-hidden />
          {/* The step label is worth announcing; a clock ticking once a second
              inside a log region is not. */}
          <span className="font-mono text-[11px] text-[var(--copilot-dim)] tabular-nums" aria-hidden>
            {formatElapsed(now - startedAt)}
          </span>
        </>
      )}
    </div>
  )
}

/**
 * Where the answer will appear, until it does.
 *
 * Three bars rather than a spinner: a spinner says "wait", these say "text is
 * coming and it is about this long", which is what stops the second send.
 */
export function CopilotAnswerSkeleton() {
  return (
    <div className="flex flex-col gap-[7px] py-0.5" aria-hidden data-testid="copilot-answer-skeleton">
      {["w-full", "w-[88%]", "w-[54%]"].map((width, i) => (
        <span key={width} className={`relative h-2 rounded overflow-hidden bg-[var(--copilot-surface)] ${width}`}>
          <span
            className="absolute inset-0 bg-gradient-to-r from-transparent via-foreground/10 to-transparent animate-pulse"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        </span>
      ))}
    </div>
  )
}
