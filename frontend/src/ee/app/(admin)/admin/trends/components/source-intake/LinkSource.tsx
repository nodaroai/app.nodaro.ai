// The source clip from a link: a field for a YouTube, TikTok, Instagram, X or
// Facebook link and "Get video" (Enter too). A link it does not take is said at
// once, with no request. A YouTube video shows first so the part to use is
// picked before anything downloads; any other downloads whole, its progress
// shown, with Cancel. Failures are worded here (`LINK_FAILURES`).

import { useId, useState } from "react"
import { Loader2, RotateCcw, Video, X } from "lucide-react"
import type { MediaEditorParts } from "virtual:media-editor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LINK_FAILURES, RETRYABLE, type SourceLink } from "./link"
import { YouTubeRange } from "./YouTubeRange"

interface Props {
  readonly parts: MediaEditorParts
  readonly link: SourceLink
  readonly disabled?: boolean
}

export function LinkSource({ parts, link, disabled }: Props) {
  const fieldId = useId()
  const statusId = useId()
  const [text, setText] = useState("")
  const { state, fetch, download, reset } = link
  const busy = state.step === "probing" || state.step === "downloading"
  const off = disabled || busy || state.step === "range"

  const submit = () => {
    if (off || text.trim() === "") return
    fetch(text)
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={fieldId} className="text-xs font-medium text-muted-foreground">
        …or a link to a YouTube, TikTok, Instagram, X or Facebook video
      </label>
      <div className="flex min-w-0 gap-2">
        <Input
          id={fieldId}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          className="h-11 min-w-0 flex-1"
          placeholder="https://www.youtube.com/watch?v=…"
          aria-describedby={statusId}
          value={text}
          disabled={off}
          onChange={(e) => {
            setText(e.target.value)
            if (state.step === "failed") reset()
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              submit()
            }
          }}
        />
        <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={off || text.trim() === ""} onClick={submit}>
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Video className="mr-1 h-4 w-4" />}
          Get video
        </Button>
      </div>

      <div id={statusId} className="flex flex-col gap-2">
        {state.step === "probing" && (
          <p role="status" className="text-xs text-muted-foreground">
            Checking the link…
          </p>
        )}
        {state.step === "downloading" && (
          <div className="flex items-center gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span role="status" className="text-xs text-muted-foreground tabular-nums">
                Downloading… {state.percent}%
              </span>
              <div
                role="progressbar"
                aria-label="Download"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={state.percent}
                className="h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div className="h-full bg-primary transition-[width]" style={{ width: `${state.percent}%` }} />
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={reset}>
              <X className="mr-1 h-4 w-4" /> Cancel
            </Button>
          </div>
        )}
        {state.step === "failed" && (
          <div className="flex flex-wrap items-center gap-2">
            <p role="alert" className="min-w-0 flex-[1_1_220px] text-xs text-destructive">
              {LINK_FAILURES[state.failure]}
            </p>
            {RETRYABLE.has(state.failure) && (
              <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => (state.section ? download(state.section) : fetch(state.url))}>
                <RotateCcw className="mr-1 h-4 w-4" /> Try again
              </Button>
            )}
          </div>
        )}
      </div>

      {state.step === "range" && (
        <YouTubeRange
          key={state.youtubeId}
          parts={parts}
          youtubeId={state.youtubeId}
          durationSec={state.durationSec}
          onDownload={download}
          onCancel={reset}
        />
      )}
    </div>
  )
}
