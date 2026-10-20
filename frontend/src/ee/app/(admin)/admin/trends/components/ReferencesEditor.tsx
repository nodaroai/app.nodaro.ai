// Fixed references: pictures sent with every run of the trend (a logo, a
// prop), each with the prompt line that says what it is. Hidden from users.
// Pictures are copied into the trend's storage as they are added.

import { useState } from "react"
import { Plus, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useTrendMedia } from "@/ee/hooks/queries/use-admin-queries"
import { MAX_IMAGES_PER_SLOT, MAX_REFERENCES, newUid, type FormReference } from "../model"
import { MediaPicker } from "./MediaPicker"
import { uploadLocalFile } from "./uploads"

interface Props {
  readonly trendId: string
  readonly references: FormReference[]
  /** Functional: pictures arrive asynchronously, one after another. */
  readonly onChange: (fn: (refs: FormReference[]) => FormReference[]) => void
}

export function ReferencesEditor({ trendId, references, onChange }: Props) {
  const update = (uid: string, fn: (r: FormReference) => FormReference) =>
    onChange((refs) => refs.map((r) => (r.uid === uid ? fn(r) : r)))

  return (
    <div className="flex flex-col gap-3">
      {references.length === 0 && <p className="text-sm text-muted-foreground">No fixed references.</p>}
      {references.map((r, i) => (
        <ReferenceCard
          key={r.uid}
          trendId={trendId}
          index={i}
          reference={r}
          onAddImage={(url) => update(r.uid, (x) => ({ ...x, images: [...x.images, url].slice(0, MAX_IMAGES_PER_SLOT) }))}
          onChange={(fn) => update(r.uid, fn)}
          onRemove={() => onChange((refs) => refs.filter((x) => x.uid !== r.uid))}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-9 self-start"
        disabled={references.length >= MAX_REFERENCES}
        onClick={() => onChange((refs) => [...refs, { uid: newUid(), images: [], line: "" }])}
      >
        <Plus className="mr-1 h-4 w-4" /> Add reference ({references.length} / {MAX_REFERENCES})
      </Button>
    </div>
  )
}

interface CardProps {
  readonly trendId: string
  readonly index: number
  readonly reference: FormReference
  readonly onAddImage: (url: string) => void
  readonly onChange: (fn: (r: FormReference) => FormReference) => void
  readonly onRemove: () => void
}

function ReferenceCard({ trendId, index, reference, onAddImage, onChange, onRemove }: CardProps) {
  const media = useTrendMedia(trendId)
  const [uploading, setUploading] = useState(false)
  const n = index + 1
  const full = reference.images.length >= MAX_IMAGES_PER_SLOT

  const store = async (url: string) => {
    try {
      onAddImage((await media.mutateAsync({ url, kind: "reference" })).url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not store the picture")
    }
  }
  const fromFiles = async (files: File[]) => {
    setUploading(true)
    try {
      for (const f of files.slice(0, MAX_IMAGES_PER_SLOT - reference.images.length)) await store(await uploadLocalFile(f))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Reference {n}</span>
        <Button type="button" variant="ghost" size="sm" className="h-9 w-9 p-0 text-destructive" aria-label={`Remove reference ${n}`} onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {reference.images.map((url, j) => (
          <div key={url + j} className="relative">
            <img src={url} alt={`Reference ${n}, picture ${j + 1}`} className="h-20 w-20 rounded object-cover" />
            <button
              type="button"
              aria-label={`Remove picture ${j + 1} of reference ${n}`}
              className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full border bg-background shadow"
              onClick={() => onChange((r) => ({ ...r, images: r.images.filter((_, k) => k !== j) }))}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <MediaPicker
        accept="image/*"
        multiple
        uploadLabel={`Add picture (${reference.images.length} / ${MAX_IMAGES_PER_SLOT})`}
        busy={uploading || media.isPending}
        disabled={full}
        onFiles={(files) => void fromFiles(files)}
        onUrl={(url) => void store(url)}
      />
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Prompt line</span>
        <Textarea
          rows={2}
          maxLength={500}
          value={reference.line}
          aria-invalid={!reference.line.trim()}
          placeholder="The logo printed on the mug"
          onChange={(e) => {
            const line = e.target.value
            onChange((r) => ({ ...r, line }))
          }}
        />
        <span className="text-right text-xs text-muted-foreground tabular-nums">{reference.line.length} / 500</span>
      </label>
    </div>
  )
}
