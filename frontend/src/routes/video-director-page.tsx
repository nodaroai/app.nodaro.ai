import { useCallback, useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { runVideoDirector, getJobStatusLean } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useT, type MessageKey } from "@/lib/i18n"

type Genre = "explainer" | "product-launch"

interface GenreOption {
  value: Genre
  labelKey: MessageKey
  hintKey: MessageKey
  placeholderKey: MessageKey
}

// Message KEYS, not sentences — this list is module-level so it can't call the
// `t` hook; the render site translates.
const GENRE_OPTIONS: GenreOption[] = [
  {
    value: "explainer",
    labelKey: "vd.genreExplainer",
    hintKey: "vd.genreExplainerHint",
    placeholderKey: "vd.genreExplainerPlaceholder",
  },
  {
    value: "product-launch",
    labelKey: "vd.genreProductLaunch",
    hintKey: "vd.genreProductLaunchHint",
    placeholderKey: "vd.genreProductLaunchPlaceholder",
  },
]

const MAX_BRIEF = 8000

/**
 * Maps numeric progress values (10→30→50→70→80→100) to a step message KEY.
 * Returns a key rather than a sentence so the mapping stays pure and
 * locale-independent — the caller translates it.
 */
export function progressToStepLabel(progress: number): MessageKey {
  if (progress <= 10) return "vd.stepAuthoring"
  if (progress <= 30) return "vd.stepSpeech"
  if (progress <= 50) return "vd.stepCaptions"
  if (progress <= 70) return "vd.stepShots"
  if (progress <= 80) return "vd.stepRendering"
  return "vd.stepFinishing"
}

type Phase = "idle" | "running" | "completed" | "failed"

export default function VideoDirectorPage() {
  const t = useT()
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
      setErrorMessage(err instanceof Error ? err.message : t("vd.failedStart"))
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
          setErrorMessage(job.error_message ?? t("vd.generationFailed"))
        }
      } catch (err) {
        stopPolling()
        setPhase("failed")
        setErrorMessage(err instanceof Error ? err.message : t("vd.pollingError"))
      }
    }, 2500)
  }, [genre, brief, phase, stopPolling, t])

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
        <h1 className="mb-2 text-lg font-medium text-foreground">{t("vd.title")}</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {t("vd.subtitle")}
        </p>

        {/* Genre selector */}
        <div className="mb-4">
          <span className="mb-1 block text-xs text-muted-foreground">{t("vd.genre")}</span>
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
                    {t(opt.labelKey)}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-tight text-muted-foreground">
                    {t(opt.hintKey)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Brief textarea */}
        <div className="mb-4">
          <label className="mb-1 block text-xs text-muted-foreground" htmlFor="vd-brief">
            {t("vd.brief")}
          </label>
          <Textarea
            id="vd-brief"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            disabled={isRunning}
            placeholder={t(selectedGenreOption.placeholderKey)}
            maxLength={MAX_BRIEF}
            rows={4}
            className="resize-none bg-card"
          />
          <div className="mt-0.5 text-right text-[10px] text-muted-foreground">
            {t("vd.charCount", { n: brief.length, max: MAX_BRIEF })}
          </div>
        </div>

        {/* Credit / time note */}
        <p className="mb-4 text-xs text-muted-foreground">
          {t("vd.creditNote")}
        </p>

        {/* Generate / progress / result area */}
        {phase === "idle" && (
          <Button onClick={handleGenerate} disabled={!brief.trim()}>
            {t("vd.generate")}
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
                {t(progressToStepLabel(progress))}
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
                {t("vd.viewInMyFiles")}
              </Link>
              <Button onClick={handleReset}>{t("vd.makeAnother")}</Button>
            </div>
          </div>
        )}

        {phase === "completed" && !videoUrl && (
          <div className="rounded-md border border-yellow-500/40 bg-yellow-500/5 p-4 text-sm text-muted-foreground">
            {t("vd.noUrlPre")}{" "}
            <Link to="/my-files" className="text-primary hover:underline">
              {t("vd.myFiles")}
            </Link>{" "}
            {t("vd.noUrlPost")}
            <div className="mt-3">
              <Button onClick={handleReset}>{t("vd.makeAnother")}</Button>
            </div>
          </div>
        )}

        {phase === "failed" && (
          <div className="rounded-md border border-red-500/40 bg-red-500/5 p-4">
            <p className="mb-3 text-sm text-red-400">
              {errorMessage ?? t("vd.failedGeneric")}
            </p>
            <Button onClick={handleReset}>{t("vd.tryAgain")}</Button>
          </div>
        )}
      </div>
    </div>
  )
}
