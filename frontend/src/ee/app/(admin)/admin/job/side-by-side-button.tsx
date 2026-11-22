import { useEffect, useRef, useState } from "react"
import { Download, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getAuthHeaders } from "@/lib/api"

/**
 * The admin job page's "Download side by side" for a finished Video Remake
 * run (`POST /v1/video-remake/:jobId/side-by-side`, which lets an
 * administrator have any run's, a trend run's included): the run's original
 * clip and its result in one video. The first press starts the render and the
 * button asks again every few seconds until the file is there, then offers it.
 */

/** The job types a Video Remake run carries. */
const VIDEO_REMAKE_JOB_TYPES = new Set(["cast-swap", "cast-swap-full-quality"])

/** Whether the job is a finished Video Remake run, the only kind with a side by side. */
export function hasSideBySide(job: { readonly status: string; readonly job_type: string | null; readonly input_data: Record<string, unknown> | null }): boolean {
  if (job.status !== "completed") return false
  return (job.job_type !== null && VIDEO_REMAKE_JOB_TYPES.has(job.job_type)) || job.input_data?.type === "cast-swap"
}

/** How often the button asks again while the file is made, and while another of the account's is made first. */
export const SIDE_BY_SIDE_POLL_MS = 3000
export const SIDE_BY_SIDE_WAITING_POLL_MS = 6000
/** How long it keeps asking before it says so. */
const GIVE_UP_MS = 10 * 60_000

export type SideBySideAnswer =
  | { readonly status: "ready"; readonly url: string; readonly fileName: string }
  | { readonly status: "making" | "waiting" }
  | { readonly status: "error"; readonly message: string }

/** One ask: the file, still being made, or why not (the server's sentence). */
export async function askSideBySide(jobId: string): Promise<SideBySideAnswer> {
  const res = await fetch(`/v1/video-remake/${encodeURIComponent(jobId)}/side-by-side`, {
    method: "POST",
    headers: { ...(await getAuthHeaders()), "Content-Type": "application/json" },
    body: "{}",
  })
  const body = (await res.json().catch(() => null)) as { data?: Record<string, unknown>; error?: { message?: string } } | null
  const data = body?.data
  if (res.ok && data?.status === "ready" && typeof data.url === "string") {
    return { status: "ready", url: data.url, fileName: typeof data.fileName === "string" ? data.fileName : "side-by-side.mp4" }
  }
  if (res.status === 202 && (data?.status === "making" || data?.status === "waiting")) return { status: data.status }
  // Asked too often: the render goes on, so this is "ask again later", never a failure.
  if (res.status === 429) return { status: "making" }
  return { status: "error", message: body?.error?.message ?? `Couldn't make the side by side (${res.status}).` }
}

type State = { readonly kind: "idle" } | { readonly kind: "making"; readonly waiting: boolean } | { readonly kind: "ready"; readonly url: string; readonly fileName: string } | { readonly kind: "error"; readonly message: string }

export function SideBySideButton({ jobId }: { jobId: string }) {
  const [state, setState] = useState<State>({ kind: "idle" })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const start = () => {
    const startedAt = Date.now()
    const ask = async () => {
      let answer: SideBySideAnswer
      try {
        answer = await askSideBySide(jobId)
      } catch {
        answer = { status: "error", message: "Couldn't reach the server. Try again." }
      }
      if (answer.status === "ready") return setState({ kind: "ready", url: answer.url, fileName: answer.fileName })
      if (answer.status === "error") return setState({ kind: "error", message: answer.message })
      if (Date.now() - startedAt > GIVE_UP_MS) return setState({ kind: "error", message: "It is taking longer than expected. Try again later." })
      setState({ kind: "making", waiting: answer.status === "waiting" })
      timer.current = setTimeout(() => void ask(), answer.status === "waiting" ? SIDE_BY_SIDE_WAITING_POLL_MS : SIDE_BY_SIDE_POLL_MS)
    }
    setState({ kind: "making", waiting: false })
    void ask()
  }

  if (state.kind === "ready") {
    return (
      <Button asChild variant="outline" size="sm">
        <a href={state.url} download={state.fileName} target="_blank" rel="noopener noreferrer">
          <Download className="h-4 w-4" /> Download side by side
        </a>
      </Button>
    )
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={start} disabled={state.kind === "making"}>
        {state.kind === "making" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {state.kind === "making" ? (state.waiting ? "Waiting for another side by side…" : "Making side by side…") : "Side by side"}
      </Button>
      {state.kind === "error" && <span className="text-sm text-destructive">{state.message}</span>}
    </span>
  )
}
