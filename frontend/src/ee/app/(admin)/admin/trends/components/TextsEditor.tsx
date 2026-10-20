// What users read: the name and description (per language, saved with the
// draft, so they change for users at the next publish), and the catalog fields
// on the trend itself — its address (slug) and tags — which apply at once.

import { useState } from "react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import type { AdminTrendRow, TrendLocalizedText } from "@/lib/api"
import { usePatchTrend } from "@/ee/hooks/queries/use-admin-queries"
import { LocalizedField } from "./LocalizedField"

interface Props {
  readonly trend: AdminTrendRow
  readonly name: TrendLocalizedText
  readonly description: TrendLocalizedText
  readonly onChange: (next: { name?: TrendLocalizedText; description?: TrendLocalizedText }) => void
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

const parseTags = (s: string) => [...new Set(s.split(",").map((t) => t.trim()).filter(Boolean))]

export function TextsEditor({ trend, name, description, onChange }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <LocalizedField label="Name" value={name} maxLength={200} onChange={(n) => onChange({ name: n })} />
      <LocalizedField
        label="Description"
        optional
        multiline
        value={description}
        maxLength={2000}
        onChange={(d) => onChange({ description: d })}
      />
      <CatalogFields trend={trend} />
    </div>
  )
}

/** Slug and tags: written to the trend row through PATCH when a field is left. */
function CatalogFields({ trend }: { readonly trend: AdminTrendRow }) {
  const patch = usePatchTrend(trend.id)
  const [slug, setSlug] = useState(trend.slug)
  const [tags, setTags] = useState(trend.tags.join(", "))
  const serverKey = `${trend.slug}\n${trend.tags.join(",")}`
  const [seen, setSeen] = useState(serverKey)
  if (seen !== serverKey) {
    // The server's slug or tags moved: show what it has.
    setSeen(serverKey)
    setSlug(trend.slug)
    setTags(trend.tags.join(", "))
  }
  const slugOk = SLUG_RE.test(slug) && slug !== "runs"
  const onError = (err: Error) => toast.error(err.message)

  const commitSlug = () => {
    if (slug === trend.slug) return
    if (!slugOk) {
      toast.error("A slug is 1–64 of a–z, 0–9 and -, starting with a letter or digit.")
      setSlug(trend.slug)
      return
    }
    patch.mutate({ slug }, { onSuccess: () => toast.success("Slug saved"), onError })
  }
  const commitTags = () => {
    const next = parseTags(tags)
    if (next.join(",") === trend.tags.join(",")) return
    if (next.some((t) => t.length > 100) || next.length > 30) {
      toast.error("At most 30 tags of up to 100 characters.")
      return
    }
    patch.mutate({ tags: next }, { onSuccess: () => toast.success("Tags saved"), onError })
  }

  return (
    <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
      <p className="text-xs text-muted-foreground sm:col-span-2">These apply at once, without publishing.</p>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Slug</span>
        <Input
          className="h-9 font-mono"
          value={slug}
          autoCapitalize="none"
          aria-invalid={!slugOk}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          onBlur={commitSlug}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Tags</span>
        <Input
          className="h-9"
          value={tags}
          placeholder="dance, office"
          onChange={(e) => setTags(e.target.value)}
          onBlur={commitTags}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        <span className="text-xs text-muted-foreground">Comma separated.</span>
      </label>
    </div>
  )
}
