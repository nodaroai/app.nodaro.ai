import { useState } from "react"
import { Check, ChevronDown, Loader2, Plus, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import {
  useEditGalleryWord,
  useRemoveGalleryWord,
  type GalleryWordEdit,
  type GalleryWordEntry,
} from "@/ee/hooks/queries/use-gallery-moderation-queries"
import { moderationErrorText } from "./moderation-errors"

/** The stored limits (backend `GALLERY_MODERATION_LIMITS`): a word or translation, and an allowed phrase. */
export const TERM_MAX_LENGTH = 60
const PHRASE_MAX_LENGTH = 120

function ChipList({
  items,
  busy,
  onRemove,
}: {
  readonly items: readonly string[]
  readonly busy: boolean
  readonly onRemove: (item: string) => void
}) {
  const t = useT()
  if (items.length === 0) return <p className="text-xs text-muted-foreground">{t("galleryModeration.none")}</p>
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li key={item} className="inline-flex items-center gap-1 rounded-full border border-zinc-200 dark:border-zinc-700 bg-muted/40 ps-2.5 pe-1 py-0.5 text-xs">
          <bdi>{item}</bdi>
          <button
            type="button"
            disabled={busy}
            onClick={() => onRemove(item)}
            className="rounded-full p-0.5 text-muted-foreground hover:bg-zinc-200 hover:text-foreground dark:hover:bg-zinc-700 disabled:opacity-50"
            aria-label={t("galleryModeration.removeChip", { item })}
          >
            <X className="h-3 w-3" />
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Suggested allowed phrases: none applies until it is approved here. */
function SuggestedList({
  items,
  busy,
  onApprove,
  onDismiss,
}: {
  readonly items: readonly string[]
  readonly busy: boolean
  readonly onApprove: (items: readonly string[]) => void
  readonly onDismiss: (item: string) => void
}) {
  const t = useT()
  return (
    <div className="space-y-2 rounded-md border border-dashed border-amber-400/60 bg-amber-50/40 p-2 dark:bg-amber-950/10">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t("galleryModeration.suggested")}</p>
        {items.length > 1 && (
          <Button type="button" size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => onApprove(items)}>
            <Check className="h-3.5 w-3.5 me-1" />
            {t("galleryModeration.approveAll")}
          </Button>
        )}
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <li key={item} className="inline-flex items-center gap-1 rounded-full border border-dashed border-zinc-300 dark:border-zinc-600 ps-2.5 pe-1 py-0.5 text-xs">
            <bdi>{item}</bdi>
            <button
              type="button"
              disabled={busy}
              onClick={() => onApprove([item])}
              className="rounded-full p-0.5 text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 disabled:opacity-50"
              aria-label={t("galleryModeration.approve", { item })}
              title={t("galleryModeration.approve", { item })}
            >
              <Check className="h-3 w-3" />
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onDismiss(item)}
              className="rounded-full p-0.5 text-muted-foreground hover:bg-zinc-200 hover:text-foreground dark:hover:bg-zinc-700 disabled:opacity-50"
              aria-label={t("galleryModeration.dismiss", { item })}
              title={t("galleryModeration.dismiss", { item })}
            >
              <X className="h-3 w-3" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function AddInline({
  placeholder,
  maxLength,
  busy,
  onAdd,
}: {
  readonly placeholder: string
  readonly maxLength: number
  readonly busy: boolean
  readonly onAdd: (text: string) => Promise<boolean>
}) {
  const t = useT()
  const [text, setText] = useState("")
  async function submit() {
    const value = text.trim()
    if (!value) return
    if (await onAdd(value)) setText("")
  }
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} maxLength={maxLength} className="h-8 text-sm" disabled={busy} />
      <Button type="submit" size="sm" variant="outline" disabled={busy || text.trim() === ""}>
        <Plus className="h-3.5 w-3.5 me-1" />
        {t("galleryModeration.add")}
      </Button>
    </form>
  )
}

/** One banned word: its translations, the phrases that stay allowed and those waiting for approval. */
export function WordCard({ entry, defaultOpen }: { readonly entry: GalleryWordEntry; readonly defaultOpen: boolean }) {
  const t = useT()
  const isRtl = useAppDir() === "rtl"
  const [open, setOpen] = useState(defaultOpen)
  const edit = useEditGalleryWord()
  const remove = useRemoveGalleryWord()
  const busy = edit.isPending || remove.isPending
  const pending = entry.suggestedExceptions ?? []

  async function save(change: Omit<GalleryWordEdit, "word">): Promise<boolean> {
    try {
      await edit.mutateAsync({ word: entry.word, ...change })
      return true
    } catch (error) {
      toast.error(moderationErrorText(error))
      return false
    }
  }

  async function removeWord() {
    try {
      await remove.mutateAsync({ word: entry.word })
      toast.success(t("galleryModeration.wordRemoved", { word: entry.word }))
    } catch (error) {
      toast.error(moderationErrorText(error))
    }
  }

  return (
    <li className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card">
      <div className="flex items-center gap-2 px-4 py-3">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex flex-1 flex-wrap items-center gap-2 text-start" aria-expanded={open}>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", !open && (isRtl ? "rotate-90" : "-rotate-90"))} />
          <bdi className="font-semibold">{entry.word}</bdi>
          <span className="text-xs text-muted-foreground">
            {t("galleryModeration.counts", { translations: entry.translations.length, exceptions: entry.exceptions.length })}
          </span>
          {pending.length > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
              {t("galleryModeration.pendingBadge", { n: pending.length })}
            </span>
          )}
        </button>
        {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        <Button variant="ghost" size="sm" onClick={removeWord} disabled={busy} className="text-red-600 hover:text-red-700">
          <Trash2 className="h-3.5 w-3.5 me-1" />
          {t("galleryModeration.removeWord")}
        </Button>
      </div>
      {open && (
        <div className="space-y-4 border-t border-zinc-200 dark:border-zinc-800 px-4 py-3">
          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("galleryModeration.translations")}</h3>
            <ChipList items={entry.translations} busy={busy} onRemove={(item) => void save({ removeTranslations: [item] })} />
            <AddInline
              placeholder={t("galleryModeration.addTranslation")}
              maxLength={TERM_MAX_LENGTH}
              busy={busy}
              onAdd={(text) => save({ addTranslations: [text] })}
            />
          </section>
          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("galleryModeration.exceptions")}</h3>
            <p className="text-xs text-muted-foreground">{t("galleryModeration.exceptionsHelp")}</p>
            <ChipList items={entry.exceptions} busy={busy} onRemove={(item) => void save({ removeExceptions: [item] })} />
            {pending.length > 0 && (
              <SuggestedList
                items={pending}
                busy={busy}
                onApprove={(items) => void save({ approveExceptions: items })}
                onDismiss={(item) => void save({ dismissExceptions: [item] })}
              />
            )}
            <AddInline
              placeholder={t("galleryModeration.addException")}
              maxLength={PHRASE_MAX_LENGTH}
              busy={busy}
              onAdd={(text) => save({ addExceptions: [text] })}
            />
          </section>
        </div>
      )}
    </li>
  )
}
