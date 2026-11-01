// A full-depth clip's stored scene description (decided 2026-10-28). The
// depth clip carries no scene, so making it also describes the ORIGINAL
// clip once: the whole clip. Each run rewrites that text for the new cast,
// a preview run cut to its 4 s window (one text for every run, decided
// 2026-11-01: there is no preview text of its own; an older make's stays in
// storage, unused, and is not shown). The admin may correct it here. Saving
// writes the text only — the clip stays approved and up to date. A clip made
// before descriptions existed has none: making the depth clip again writes
// it. With a preview, a disclosure under the box shows what a preview keeps
// of the text as it stands (scene-cut.ts, the engine's own cut).

import { useEffect, useId, useState } from "react"
import { Loader2, Save } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { AdminTrendFaceMask } from "@/lib/api"
import { useSaveTrendSceneDescription } from "@/ee/hooks/queries/use-admin-queries"
import { previewCut } from "../scene-cut"

/** The server's cap on the text. */
export const SCENE_DESCRIPTION_MAX = 4000

interface Props {
  readonly trendId: string
  readonly faceMask: AdminTrendFaceMask
  /** The saved draft's preview start (null: no preview, so no preview line). */
  readonly previewStart: number | null
  /** The source clip's length (seconds; absent: unknown), which holds the preview's window. */
  readonly durationSec?: number
  readonly dirty: boolean
  readonly revision: string
  readonly onRevision: (revision: string) => void
  readonly onWriteError: (err: Error) => void
}

export function SceneDescriptionEditor(props: Props) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed p-2" aria-label="Scene description">
      <span className="text-xs font-medium">Scene description — made from the original clip; each run rewrites it for the new cast</span>
      <SceneDescriptionField {...props} saved={props.faceMask.sceneDescription ?? ""} />
    </div>
  )
}

function SceneDescriptionField({
  trendId,
  previewStart,
  durationSec,
  saved,
  dirty,
  revision,
  onRevision,
  onWriteError,
}: Omit<Props, "faceMask"> & { readonly saved: string }) {
  const id = useId()
  const save = useSaveTrendSceneDescription(trendId)
  // The text being edited, from the saved one (and again whenever that changes).
  const [text, setText] = useState(saved)
  useEffect(() => setText(saved), [saved])
  const edited = text !== saved
  const tooLong = text.trim().length > SCENE_DESCRIPTION_MAX
  const canSave = edited && text.trim().length > 0 && !tooLong && !dirty && !save.isPending
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium">
        Full run
      </label>
      {!saved && (
        <p className="text-xs text-amber-700 dark:text-amber-400">Make the depth clip again to get a description.</p>
      )}
      <Textarea
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        className="text-xs"
        disabled={save.isPending}
        aria-describedby={previewStart !== null ? `${id}-preview` : undefined}
      />
      {previewStart !== null && (
        <p id={`${id}-preview`} className="text-xs text-muted-foreground">
          Previews use these lines, cut to the 4 s window.
        </p>
      )}
      {previewStart !== null && text.trim().length > 0 && (
        <details className="text-xs">
          <summary className="min-h-9 cursor-pointer py-2 text-muted-foreground">What a preview keeps (from {previewStart} s)</summary>
          <pre className="whitespace-pre-wrap break-words rounded bg-muted p-2 font-sans" data-testid="scene-preview-cut">
            {previewCut(text, previewStart, durationSec) || "Nothing: no line of it falls in the preview."}
          </pre>
        </details>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          className="min-h-9"
          disabled={!canSave}
          onClick={() =>
            save.mutate(
              { which: "full", text: text.trim(), revision },
              {
                onSuccess: (w) => {
                  onRevision(w.revision)
                  toast.success("Scene description saved")
                },
                onError: onWriteError,
              },
            )
          }
        >
          {save.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
          Save
        </Button>
        {edited && (
          <Button type="button" variant="ghost" className="min-h-9" disabled={save.isPending} onClick={() => setText(saved)}>
            Discard
          </Button>
        )}
        <span className={tooLong ? "text-xs text-destructive" : "text-xs tabular-nums text-muted-foreground"}>
          {text.trim().length} / {SCENE_DESCRIPTION_MAX}
        </span>
        {edited && dirty && <span className="text-xs text-muted-foreground">Save the draft first.</span>}
      </div>
    </div>
  )
}
