import { useCallback, useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { runVideoDirector, getJobStatusLean } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

type Genre = "explainer" | "product-launch"

interface GenreOption {
  value: Genre
  label: string
  hint: string
  placeholder: string
}

const GENRE_OPTIONS: GenreOption[] = [
  {
    value: "explainer",
    label: "Explainer",
    hint: "Narrated overview that teaches an idea, process, or product.",
    placeholder: "What should it explain? e.g. How a CDN works",
  },
  {
    value: "product-launch",
    label: "Product Launch",
    hint: "High-energy reveal that builds excitement for a new product.",
    placeholder: "Describe the product, audience, and tone.",
  },
]

/**
 * Maps numeric progress values (10→30→50→70→80→100) to human-readable step labels.
 * Kept as a pure helper so it's easy to unit-test.
 */
export function progressToStepLabel(progress: number): string {
  if (progress <= 10) return "Authoring script…"
  if (progress <= 30) return "Generating speech…"
  if (progress <= 50) return "Aligning captions…"
  if (progress <= 70) return "Resolving shot sequence…"
  if (progress <= 80) return "Rendering video…"
  return "Finishing up…"
}

type Phase = "idle" | "running" | "completed" | "failed"

export default function VideoDirectorPage() {
  const [genre, setGenre] = useState<Genre>("explainer")
  const [brief, setBrief] = useState("")
  const [phase, setPhase] = useState<Phase>("idle")
  const [progress, setProgress] = useState(0)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Clean up polling on unmount.
  useEffect(() => {
    return () => {
      if (pollRef.current != null) clearInterval(pollRef.current)
    }
  }, [])

  const stopPolling = useCallback(() => {
    if (pollRef.current != null) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const handleGenerate = useCallback(async () => {
    const trimmed = brief.trim()
    if (!trimmed || phase === "running") return

    setPhase("running")
    setProgress(10)
    setErrorMessage(null)
    setVideoUrl(null)

    let jobId: string
    try {
      const result = await runVideoDirector({ genre, brief: trimmed })
      jobId = result.jobId
    } catch (err) {
      setPhase("failed")
      setErrorMessage(err instanceof Error ? err.message : "Failed to start video director")
      return
    }

    pollRef.current = setInterval(async () => {
      try {
        const job = await getJobStatusLean(jobId)

        if (job.progress != null) {
          setProgress(job.progress)
        }

        if (job.status === "completed") {
          stopPolling()
          setVideoUrl(job.output_data?.videoUrl ?? null)
          setProgress(100)
          setPhase("completed")
        } else if (job.status === "failed") {
          stopPolling()
          setPhase("failed")
          setErrorMessage(job.error_message ?? "Video generation failed.")
        }
      } catch (err) {
        stopPolling()
        setPhase("failed")
        setErrorMessage(err instanceof Error ? err.message : "Polling error")
      }
    }, 2500)
  }, [genre, brief, phase, stopPolling])

  const handleReset = useCallback(() => {
    stopPolling()
    setPhase("idle")
    setProgress(0)
    setVideoUrl(null)
    setErrorMessage(null)
  }, [stopPolling])

  const selectedGenreOption = GENRE_OPTIONS.find((o) => o.value === genre)!
  const isRunning = phase === "running"

  return (
    <div className="flex h-full flex-col items-center gap-8 overflow-y-auto p-8">
      <div className="w-full max-w-xl">
        <h1 className="mb-2 text-lg font-medium text-foreground">Video Director</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Turn a brief into a finished, narrated video.
        </p>

        {/* Genre selector */}
        <div className="mb-4">
          <span className="mb-1 block text-xs text-muted-foreground">Genre</span>
          <div className="grid grid-cols-2 gap-2">
            {GENRE_OPTIONS.map((opt) => {
              const active = genre === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={isRunning}
                  onClick={() => setGenre(opt.value)}
                  aria-pressed={active}
                  className={`rounded-md border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    active
                      ? "border-primary bg-primary/10"
                      : "bg-card hover:border-primary/50"
                  }`}
                >
                  <span className="block text-sm font-medium text-foreground">
                    {opt.label}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-tight text-muted-foreground">
                    {opt.hint}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Brief textarea */}
        <div className="mb-4">
          <label className="mb-1 block text-xs text-muted-foreground" htmlFor="vd-brief">
            Brief
          </label>
          <Textarea
            id="vd-brief"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            disabled={isRunning}
            placeholder={selectedGenreOption.placeholder}
            maxLength={8000}
            rows={4}
            className="resize-none bg-card"
          />
          <div className="mt-0.5 text-right text-[10px] text-muted-foreground">
            {brief.length} / 8000
          </div>
        </div>

        {/* Credit / time note */}
        <p className="mb-4 text-xs text-muted-foreground">
          Costs credits and takes approximately 2–4 minutes to complete.
        </p>

        {/* Generate / progress / result area */}
        {phase === "idle" && (
          <Button onClick={handleGenerate} disabled={!brief.trim()}>
            Generate
          </Button>
        )}

        {phase === "running" && (
          <div className="rounded-md border bg-card p-4">
            <div className="mb-2 flex items-center gap-2">
              {/* Spinner */}
              <span
                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"
                aria-hidden
              />
              <span className="text-sm text-foreground">
                {progressToStepLabel(progress)}
              </span>
            </div>
            {/* Progress bar */}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-primary transition-all duration-700"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">{progress}%</p>
          </div>
        )}

        {phase === "completed" && videoUrl && (
          <div className="space-y-4">
            <video
              key={videoUrl}
              src={videoUrl}
              controls
              className="w-full rounded-md border bg-black"
            />
            <div className="flex flex-wrap gap-3">
              <Link
                to="/my-files"
                className="rounded-md border px-4 py-2 text-sm text-foreground hover:border-primary/50"
              >
                View in My Files →
              </Link>
              <Button onClick={handleReset}>Make another</Button>
            </div>
          </div>
        )}

        {phase === "completed" && !videoUrl && (
          <div className="rounded-md border border-yellow-500/40 bg-yellow-500/5 p-4 text-sm text-muted-foreground">
            Video generated but the URL was not returned. Check{" "}
            <Link to="/my-files" className="text-primary hover:underline">
              My Files
            </Link>{" "}
            for your output.
            <div className="mt-3">
              <Button onClick={handleReset}>Make another</Button>
            </div>
          </div>
        )}

        {phase === "failed" && (
          <div className="rounded-md border border-red-500/40 bg-red-500/5 p-4">
            <p className="mb-3 text-sm text-red-400">
              {errorMessage ?? "Video generation failed. Please try again."}
            </p>
            <Button onClick={handleReset}>Try again</Button>
          </div>
        )}
      </div>
    </div>
  )
}
