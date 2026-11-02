// The source clip from a link: the content rights declaration with its box
// (unticked until the admin ticks it for this link; a changed link unticks
// it), a field for a link to a video's page and "Get video" (Enter too), off
// until the box is ticked. A link it does not take is said at once, with no
// request. A video whose length the platform can read shows first so the part
// to use is picked before anything downloads; any other downloads whole, its
// progress shown, with Cancel. Failures are worded here (`LINK_FAILURES`). The
// copy never names the sites the link may come from (see link-copy guard).

import { useId, useState } from "react"
import { Loader2, RotateCcw, Video, X } from "lucide-react"
import type { MediaEditorParts } from "virtual:media-editor"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { LINK_FAILURES, RETRYABLE, isVideoLink, type SourceLink } from "./link"
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
  const { state, declaration, reloadDeclaration, confirmed, setConfirmed, fetch, download, reset } = link
  const busy = state.step === "probing" || state.step === "downloading"
  const off = disabled || busy || state.step === "range"

  // A link this intake does not take is said at once; one it takes waits for the box.
  const needsTick = !confirmed && isVideoLink(text)
  const submit = () => {
    if (off || needsTick || text.trim() === "") return
    fetch(text)
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={fieldId} className="text-xs font-medium text-muted-foreground">
        …or a link to where the video is
      </label>
      <div className="flex min-w-0 gap-2">
        <Input
          id={fieldId}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          className="h-11 min-w-0 flex-1"
          placeholder="https://…"
          aria-describedby={statusId}
          value={text}
          disabled={off}
          onChange={(e) => {
            setText(e.target.value)
            // Another link is another confirmation.
            setConfirmed(false)
            if (state.step === "failed") reset()
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              submit()
            }
          }}
        />
        <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={off || needsTick || text.trim() === ""} onClick={submit}>
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Video className="mr-1 h-4 w-4" />}
          Get video
        </Button>
      </div>

      {declaration.status === "ready" ? (
        <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
          <Checkbox
            checked={confirmed}
            onCheckedChange={(v) => setConfirmed(v === true)}
            disabled={off}
            aria-label="I confirm the declaration for this link"
            className="mt-0.5"
          />
          <span>{declaration.declaration.text}</span>
        </label>
      ) : declaration.status === "failed" ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-destructive">{declaration.message}</span>
          <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={reloadDeclaration}>
            Try again
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Loading the declaration…</p>
      )}

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
              <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={off || !confirmed} onClick={() => (state.section ? download(state.section) : fetch(state.url))}>
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
