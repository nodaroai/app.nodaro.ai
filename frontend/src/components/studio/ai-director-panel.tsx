import { useRef, useState, useEffect } from "react"
import { pipelinesApi } from "@/lib/pipelines-api"

/**
 * Phase 3 cinematic — AI DIRECTOR panel (mockup screens 3/8 — Autopilot rail).
 *
 * The director's chat stream (engine narration + the writer's messages), an
 * ACTIVE RENDER QUEUE, INTERACTIVE SUGGESTIONS cards, and a chat input wired
 * to the pipeline's Guided-mode chat (`postChat` on the script stage). The
 * narration `lines` are passed in from the studio's live SSE feed.
 */

export interface DirectorLine {
  type: string
  text: string
}

const SUGGESTIONS = [
  "+ Apply drone zoom to SH-01",
  "+ Inject steam bursts FX to SH-01",
  "+ Grade emerald light to SH-01",
] as const

const LABEL = "font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground"

export function AiDirectorPanel({
  pipelineId,
  lines,
  running,
  expanded = false,
}: {
  pipelineId: string
  lines: DirectorLine[]
  running: boolean
  /** Autopilot mode — the director takes over, so the panel widens. */
  expanded?: boolean
}) {
  const [sent, setSent] = useState<string[]>([])
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const feedRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight })
  }, [lines, sent])

  const send = async () => {
    const msg = draft.trim()
    if (!msg || busy) return
    setBusy(true)
    setErr(null)
    setSent((s) => [...s, msg])
    setDraft("")
    try {
      await pipelinesApi.postChat(pipelineId, "script", msg)
    } catch (e) {
      // Chat only works in guided mode at the script gate; surface softly.
      setErr(e instanceof Error ? e.message : "Director is busy")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={`flex shrink-0 flex-col border-l border-[#1d1d1d] bg-[#0a0a0a] transition-[width] duration-300 ${
        expanded ? "w-[460px]" : "w-[340px]"
      }`}
    >
      <div className="flex items-center justify-between border-b border-[#1d1d1d] px-4 py-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-foreground">
            <span className={`h-2 w-2 rounded-full ${running ? "animate-pulse bg-[#ff0073]" : "bg-muted-foreground"}`} />
            AI Director
          </div>
          <div className={LABEL}>Nodaro Spatial Copilot API</div>
        </div>
        <span className="rounded border border-[#ff0073]/40 bg-[#ff0073]/10 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-[#ff0073]">
          Auto Drive
        </span>
      </div>

      <div ref={feedRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {sent.length === 0 && lines.length === 0 && (
          <p className="font-mono text-[10px] text-muted-foreground">
            The director will narrate here as your film is built.
          </p>
        )}

        {/* Interleave: render the writer's sent messages first, then the
            engine's narration as director turns (chronology is approximate —
            the SSE feed is the authoritative director stream). */}
        {sent.map((m, i) => (
          <div key={`s${i}`} className="ml-8 rounded-lg border border-sky-500/30 bg-sky-500/5 p-2">
            <div className="mb-1 text-right font-mono text-[9px] font-bold uppercase tracking-wider text-sky-300">
              You (writer-spec)
            </div>
            <p className="text-right text-[11px] text-foreground">{m}</p>
          </div>
        ))}

        {lines.slice(-40).map((l, i) => (
          <div key={`l${i}`} className="mr-4 rounded-lg border border-[#2a2a2a] bg-[#111] p-2">
            <div className="mb-1 font-mono text-[9px] font-bold uppercase tracking-wider text-[#ff0073]">
              ✦ Nodaro AI Director
            </div>
            <p className="text-[11px] leading-relaxed text-foreground">{l.text}</p>
          </div>
        ))}
      </div>

      <div className="border-t border-[#1d1d1d] p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[#ff0073]">≡</span>
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-foreground">
            Interactive Suggestions
          </span>
        </div>
        <div className="space-y-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setDraft(s.replace(/^\+\s*/, ""))}
              className="flex w-full items-center justify-between rounded-md border border-[#2a2a2a] bg-[#111] px-2 py-1.5 text-left font-mono text-[10px] uppercase tracking-wider text-foreground hover:border-[#ff0073]/50"
            >
              {s}
              <span className="text-[#ff0073]">→</span>
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-[#1d1d1d] p-3">
        {err && <p className="mb-1 font-mono text-[9px] text-amber-400">{err}</p>}
        <div className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void send()
            }}
            placeholder="Tell your Director… (@ to summon index)"
            className="flex-1 rounded-md border border-[#2a2a2a] bg-[#111] px-2 py-1.5 text-[11px] text-foreground outline-none focus:border-[#ff0073]"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!draft.trim() || busy}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#ff0073] text-white disabled:opacity-40"
          >
            →
          </button>
        </div>
        <div className="mt-1.5 flex items-center justify-between font-mono text-[9px] text-muted-foreground">
          <span>Active Model: Kling 3.0</span>
          <span>Type @ to inject cast</span>
        </div>
      </div>
    </div>
  )
}
