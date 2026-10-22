// Tag labels: the label users see for each catalog tag, per language. A tag
// stays a plain string on its trends (what the catalog filters on); its labels
// apply at once to the public tag list. A tag with no label reads as itself.

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { AdminTrendTag, TrendLocalizedText } from "@/lib/api"
import { useAdminTrendTags, useSaveTrendTagLabels } from "@/ee/hooks/queries/use-admin-queries"
import { LocalizedField } from "./LocalizedField"

const MAX_LABEL = 100

/** The labels a save would keep: trimmed, empty ones dropped. */
function kept(labels: Partial<TrendLocalizedText>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [locale, text] of Object.entries(labels)) {
    const t = typeof text === "string" ? text.trim() : ""
    if (t) out[locale] = t
  }
  return out
}

const sameLabels = (a: Record<string, string>, b: Record<string, string>) =>
  Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k] === v)

export function TagLabelsDialog({ open, onOpenChange }: { readonly open: boolean; readonly onOpenChange: (o: boolean) => void }) {
  const { data, isLoading, error } = useAdminTrendTags(open)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tag labels</DialogTitle>
          <DialogDescription>
            What users see for each tag, per language. A tag with no label shows as itself. Labels apply at once.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : error ? (
          <p className="py-4 text-sm text-destructive">{error instanceof Error ? error.message : "Failed to load the tags"}</p>
        ) : (data ?? []).length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No tags yet. Add tags on a trend first.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {(data ?? []).map((t) => (
              <TagRow key={t.tag} tag={t} />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

function TagRow({ tag }: { readonly tag: AdminTrendTag }) {
  const save = useSaveTrendTagLabels()
  const server = kept(tag.labels)
  const serverKey = JSON.stringify(server)
  const [labels, setLabels] = useState<TrendLocalizedText>({ en: "", ...tag.labels })
  const [seen, setSeen] = useState(serverKey)
  if (seen !== serverKey) {
    // The server's labels moved (a save landed, or another admin's): show them.
    setSeen(serverKey)
    setLabels({ en: "", ...tag.labels })
  }
  const next = kept(labels)
  const dirty = !sameLabels(next, server)
  const onError = (err: Error) => toast.error(err.message)

  return (
    <li data-tag-row={tag.tag} className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium" dir="auto">
          {tag.tag}
        </span>
        <span className="text-xs text-muted-foreground">
          {tag.trends} trend{tag.trends === 1 ? "" : "s"} · {tag.published} published
        </span>
      </div>
      <LocalizedField label={tag.tag} value={labels} onChange={setLabels} maxLength={MAX_LABEL} optional />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          className="min-h-9"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ tag: tag.tag, labels: next }, { onError })}
        >
          {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Save
        </Button>
        {Object.keys(server).length > 0 && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-9"
            disabled={save.isPending}
            onClick={() => save.mutate({ tag: tag.tag, labels: {} }, { onError })}
          >
            Clear
          </Button>
        )}
      </div>
    </li>
  )
}
