// A full-depth clip's stored scene descriptions (decided 2026-10-28). The
// depth clip carries no scene, so making it also describes the ORIGINAL clip
// once: the whole clip (a full run's) and the 4 s preview window (a preview
// run's). Each run rewrites its text for the new cast; the admin may correct
// either here. Saving writes the text only — the clip stays approved and up
// to date. A clip made before descriptions existed has none: making the depth
// clip again writes them. The preview's text is made for one preview start:
// once the start moves, runs use the full description cut to the preview
// instead, and the box says so.

import { useEffect, useId, useState } from "react"
import { Loader2, Save } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { AdminTrendFaceMask, AdminTrendSceneDescriptionWhich } from "@/lib/api"
import { useSaveTrendSceneDescription } from "@/ee/hooks/queries/use-admin-queries"

/** The server's cap on each text. */
export const SCENE_DESCRIPTION_MAX = 4000

interface Props {
  readonly trendId: string
  readonly faceMask: AdminTrendFaceMask
  /** The saved draft's preview start (null: no preview; its text is shown only with one, or when one is stored). */
  readonly previewStart: number | null
  readonly dirty: boolean
  readonly revision: string
  readonly onRevision: (revision: string) => void
  readonly onWriteError: (err: Error) => void
}

const FIELDS: ReadonlyArray<{ which: AdminTrendSceneDescriptionWhich; label: string; key: "sceneDescription" | "previewSceneDescription" }> = [
  { which: "full", label: "Full run", key: "sceneDescription" },
  { which: "preview", label: "Preview (4 s)", key: "previewSceneDescription" },
]

export function SceneDescriptionEditor({ trendId, faceMask, previewStart, dirty, revision, onRevision, onWriteError }: Props) {
  const shown = FIELDS.filter((f) => f.which === "full" || previewStart !== null || !!faceMask.previewSceneDescription)
  // The preview's text was made for another start: runs use the full text, cut to the preview.
  const previewStale = !!faceMask.previewSceneDescription && faceMask.previewSceneDescriptionStart !== previewStart
  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed p-2" aria-label="Scene description">
      <span className="text-xs font-medium">Scene description — made from the original clip; each run rewrites it for the new cast</span>
      {shown.map((f) => (
        <SceneDescriptionField
          key={f.which}
          trendId={trendId}
          which={f.which}
          label={f.label}
          saved={faceMask[f.key] ?? ""}
          note={
            f.which === "preview" && previewStale
              ? "The preview start changed since this was made; runs use the full description cut to the preview"
              : undefined
          }
          dirty={dirty}
          revision={revision}
          onRevision={onRevision}
          onWriteError={onWriteError}
        />
      ))}
    </div>
  )
}

function SceneDescriptionField({
  trendId,
  which,
  label,
  saved,
  dirty,
  revision,
  onRevision,
  onWriteError,
  note,
}: Omit<Props, "faceMask" | "previewStart"> & {
  readonly which: AdminTrendSceneDescriptionWhich
  readonly label: string
  readonly saved: string
  readonly note?: string
}) {
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
        {label}
      </label>
      {!saved && (
        <p className="text-xs text-amber-700 dark:text-amber-400">Make the depth clip again to get a description.</p>
      )}
      {note && <p className="text-xs text-amber-700 dark:text-amber-400">{note}</p>}
      <Textarea id={id} value={text} onChange={(e) => setText(e.target.value)} rows={6} className="text-xs" disabled={save.isPending} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          className="min-h-9"
          disabled={!canSave}
          onClick={() =>
            save.mutate(
              { which, text: text.trim(), revision },
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
