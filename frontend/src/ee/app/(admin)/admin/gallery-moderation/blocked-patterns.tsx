import { useState } from "react"
import { Loader2, ShieldBan } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useT } from "@/lib/i18n"
import { useBlockEmailPattern, useUnblockEmailPattern, type GalleryBlockedPattern } from "@/ee/hooks/queries/use-gallery-moderation-queries"
import { moderationErrorText } from "./moderation-errors"

/** Block every account whose email matches a pattern — the ones there now and the ones made later. */
export function BlockedPatterns({ patterns }: { readonly patterns: readonly GalleryBlockedPattern[] }) {
  const t = useT()
  const [pattern, setPattern] = useState("")
  const block = useBlockEmailPattern()
  const unblock = useUnblockEmailPattern()

  async function submit() {
    const value = pattern.trim()
    if (!value) return
    try {
      await block.mutateAsync({ pattern: value })
      setPattern("")
      toast.success(t("galleryModeration.patternBlocked"))
    } catch (error) {
      toast.error(moderationErrorText(error))
    }
  }

  async function remove(entry: GalleryBlockedPattern) {
    try {
      await unblock.mutateAsync({ pattern: entry.pattern })
      toast.success(t("galleryModeration.patternUnblocked"))
    } catch (error) {
      toast.error(moderationErrorText(error))
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{t("galleryModeration.patternsTitle")}</h3>
        <p className="max-w-3xl text-xs text-muted-foreground">{t("galleryModeration.patternsHelp")}</p>
      </div>
      <form
        className="flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="seriesname*@example.com" dir="ltr" maxLength={120} disabled={block.isPending} />
        <Button type="submit" disabled={block.isPending || pattern.trim() === ""}>
          {block.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldBan className="h-4 w-4 me-1" />}
          {t("galleryModeration.block")}
        </Button>
      </form>
      {patterns.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("galleryModeration.noPatterns")}</p>
      ) : (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-800">
          {patterns.map((entry) => (
            <li key={entry.pattern} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-sm" dir="ltr">
                  {entry.pattern}
                </p>
                <p className="text-xs text-muted-foreground">{t("galleryModeration.patternMatches", { n: entry.matches })}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => void remove(entry)} disabled={unblock.isPending}>
                {t("galleryModeration.unblock")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
