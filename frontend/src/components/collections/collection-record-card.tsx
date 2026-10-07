import { ExternalLink, Trash2 } from "lucide-react"
import { collectionRecordHeadline, type CollectionRecord } from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { MetaAdMedia } from "@/components/nodes/meta-ad-media"
import { useT } from "@/lib/i18n"
import { formatDateTime } from "@/lib/i18n/format"
import { recordAuthor, recordStill } from "@/lib/collection-record-view"
import { initialOf } from "@/lib/post-display"
import { httpLink, linkSiteName } from "@/lib/post-site"

const FIELDS_SHOWN = 4

/**
 * One record: headline (a link when it has one), when it was saved, "Open in
 * <site>" for its link, its text, its picture, its fields, a delete. The
 * picture goes through the image proxy (an Instagram CDN link refuses a
 * direct load) and keeps a letter tile when the link has expired.
 */
export function CollectionRecordCard({ record, busy, onDelete }: { readonly record: CollectionRecord; readonly busy?: boolean; readonly onDelete: () => void }) {
  const t = useT()
  const headline = collectionRecordHeadline(record)
  const still = recordStill(record)
  const link = httpLink(record.url)
  const site = linkSiteName(link)
  const fieldEntries = Object.entries(record.fields)
  const body = record.text.trim() && record.text.trim() !== headline ? record.text.trim() : ""

  return (
    <article className="flex gap-3 rounded-lg border bg-card p-3" aria-busy={busy || undefined}>
      {still && <MetaAdMedia src={still} initial={initialOf(recordAuthor(record).label || headline)} className="h-16 w-16 shrink-0 rounded-md" initialClassName="text-[15px]" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <h3 className="min-w-0 flex-1 text-sm font-medium leading-snug" dir="auto">
            {link ? (
              <a href={link} target="_blank" rel="noopener noreferrer" className="hover:underline" title={t("collections.openLink")}>
                {headline}
              </a>
            ) : (
              headline
            )}
          </h3>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
            aria-label={t("collections.deleteRecord")}
            onClick={onDelete}
            disabled={busy}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
          <span>{t("collections.savedOn", { date: formatDateTime(record.createdAt) })}</span>
          {link && site && (
            <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-[#FF0073] hover:underline">
              {t("post.openIn", { site })}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </p>
        {body && (
          <p className="mt-1.5 line-clamp-3 whitespace-pre-line text-sm text-muted-foreground" dir="auto">
            {body}
          </p>
        )}
        {fieldEntries.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1">
            {fieldEntries.slice(0, FIELDS_SHOWN).map(([key, value]) => (
              <li key={key} className="max-w-full truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground" dir="auto">
                {`${key}${t("common.labelColon")}${String(value)}`}
              </li>
            ))}
            {fieldEntries.length > FIELDS_SHOWN && (
              <li className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground">{t("collections.fieldsMore", { n: fieldEntries.length - FIELDS_SHOWN })}</li>
            )}
          </ul>
        )}
      </div>
    </article>
  )
}
