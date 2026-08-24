/**
 * The hop from the home page into the editor.
 *
 * The home composer creates the workflow (carrying the typed prompt as its
 * `source_prompt`) and its thread, then navigates here with `?copilot=<id>`.
 * This sends that prompt as the first message, once.
 *
 * Sending on the user's behalf spends credits and mutates a graph, so every
 * decision is made TWICE: once when the effect runs, and again after the fetch,
 * immediately before the send. That is not belt-and-braces — the two moments
 * are genuinely different states.
 *
 * `sendCopilotMessage` carries no workflow identity: it reads the editor's
 * CURRENT workflow at send time and find-or-creates a thread on it. So a hop
 * whose fetch resolves after the user has opened a different workflow would
 * spend a turn on that one and let the model write nodes into it. The re-check
 * below is what stops that, and it is why the fetch is bounded and cancellable
 * rather than open-ended.
 */
import { useEffect, useRef } from "react"
import { useSearchParams } from "react-router-dom"
import { getAuthHeaders } from "@/lib/api"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { sendCopilotMessage } from "@/ee/lib/copilot/turn-engine"
import { copilotState, setCopilotState } from "@/ee/lib/copilot/turn-store"
import { COPILOT_STRINGS as S } from "@/ee/lib/copilot/strings"
import type { CopilotThread } from "@/ee/lib/copilot/types"

/** Survives a remount of the panel; a handoff is once per workflow, per session. */
const handedOff = new Set<string>()

/** A stalled request must not hold a pending spend open indefinitely. */
const FETCH_TIMEOUT_MS = 10_000

async function fetchSourcePrompt(workflowId: string, signal: AbortSignal): Promise<string | null> {
  const res = await fetch(`/v1/workflows/${encodeURIComponent(workflowId)}`, {
    headers: await getAuthHeaders(),
    signal,
  })
  if (!res.ok) throw new Error(`workflow fetch failed (${res.status})`)
  const body = (await res.json()) as { data?: { sourcePrompt?: string | null } }
  const prompt = body.data?.sourcePrompt
  return typeof prompt === "string" && prompt.trim().length > 0 ? prompt : null
}

export function useCopilotHandoff(thread: CopilotThread | null, workflowId: string | null): void {
  const [params, setParams] = useSearchParams()
  const arrivedFor = params.get("copilot")
  const running = useRef(false)

  // Unmount-only. It must NOT be the effect's own cleanup: consuming the
  // parameter changes `arrivedFor`, which is a dependency, so React tears the
  // effect down and back up mid-hop — and an effect-scoped cancel would abort
  // the send this hook exists to make.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    // Wait for the thread to resolve before deciding anything — until then the
    // parameter cannot be matched, so it must not be consumed either.
    if (!arrivedFor || !workflowId || !thread) return
    if (running.current) return

    // Consume the parameter HERE, synchronously, whatever we go on to decide.
    //
    // Deferring it until after the fetch meant a stale setter fired against
    // whatever page the user had moved to by then — and with `replace: true`
    // it wiped that page's own query state unrecoverably. Consuming it up front
    // also clears a parameter this hook DECLINES, instead of leaving it in the
    // URL reopening the rail on every editor tab switch.
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete("copilot")
        return next
      },
      { replace: true },
    )

    if (thread.id !== arrivedFor || thread.userTurnCount !== 0) return
    if (handedOff.has(workflowId)) return

    running.current = true
    handedOff.add(workflowId)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    /**
     * The hop did not produce a turn. Put the sentence back in the composer
     * and say so.
     *
     * This is the ONLY recovery available: the URL parameter was consumed with
     * `replace: true`, so it is gone from the address bar and from history —
     * neither a reload nor Back can re-arm the hop. The draft is what "try
     * again" means here, and the store outlives the panel, so seeding it works
     * even while the editor is on another tab.
     */
    const handBack = (text: string | null, notice: string) => {
      handedOff.delete(workflowId)
      setCopilotState({
        ...(text && !copilotState().draft ? { draft: text } : {}),
        notice,
      })
    }

    void (async () => {
      let prompt: string | null = null
      try {
        prompt = await fetchSourcePrompt(workflowId, controller.signal)
        if (!prompt) return
        // The panel went away mid-hop — an editor tab switch unmounts it. The
        // sentence must not die with it silently.
        if (!alive.current) return handBack(prompt, S.handoffInterrupted)

        // The state that mattered when the effect ran is not necessarily the
        // state now. These two are terminal for this workflow and deliberately
        // silent: the user is looking at something else, and seeding a draft
        // into a different workflow's composer would be worse than nothing.
        if (useWorkflowStore.getState().workflowId !== workflowId) return
        if (copilotState().threadId !== thread.id) return

        await sendCopilotMessage(prompt)

        // `sendCopilotMessage` RESOLVES whether or not it sent anything — a
        // read-only workflow, a failed save and the re-entry latch are all
        // early returns, not throws. Asking whether a turn started is the only
        // way to know; catching would have caught nothing.
        if (alive.current && copilotState().turn.userText !== prompt.trim()) {
          handBack(prompt, S.handoffSendFailed)
        }
      } catch {
        // Only the read can throw (a non-2xx, a timeout, a dropped network).
        if (alive.current) handBack(prompt, S.handoffFetchFailed)
      } finally {
        clearTimeout(timer)
        running.current = false
      }
    })()

    // No cleanup here on purpose — see the `alive` ref above.
    // `params` is deliberately NOT a dependency: it changes as a RESULT of
    // this effect, so listing it would re-run the effect on its own
    // consumption. `arrivedFor` is the part of it this hook actually reads.
  }, [arrivedFor, thread, workflowId, setParams])
}
