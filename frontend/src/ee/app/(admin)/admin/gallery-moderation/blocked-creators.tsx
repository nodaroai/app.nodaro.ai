import { useState } from "react"
import { Loader2, ShieldBan } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useT } from "@/lib/i18n"
import { uiLocale } from "@/lib/i18n/format"
import { useBlockCreatorByEmail, useUnblockCreator, type GalleryBannedCreator } from "@/ee/hooks/queries/use-gallery-moderation-queries"
import { moderationErrorText } from "./moderation-errors"

/** The creators whose work never reaches the gallery: block by email, unblock in one click. */
export function BlockedCreators({ creators }: { readonly creators: readonly GalleryBannedCreator[] }) {
  const t = useT()
  const [email, setEmail] = useState("")
  const block = useBlockCreatorByEmail()
  const unblock = useUnblockCreator()

  async function blockByEmail() {
    const value = email.trim()
    if (!value) return
    try {
      await block.mutateAsync({ email: value })
      setEmail("")
      toast.success(t("galleryModeration.creatorBlocked"))
    } catch (error) {
      toast.error(moderationErrorText(error))
    }
  }

  async function unblockCreator(creator: GalleryBannedCreator) {
    try {
      await unblock.mutateAsync({ userId: creator.userId })
      toast.success(t("galleryModeration.creatorUnblocked"))
    } catch (error) {
      toast.error(moderationErrorText(error))
    }
  }

  return (
    <div className="space-y-3">
      <form
        className="flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void blockByEmail()
        }}
      >
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("galleryModeration.emailPlaceholder")} maxLength={320} disabled={block.isPending} />
        <Button type="submit" disabled={block.isPending || email.trim() === ""}>
          {block.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldBan className="h-4 w-4 me-1" />}
          {t("galleryModeration.block")}
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">{t("galleryModeration.blockFromGalleryHint")}</p>

      {creators.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("galleryModeration.noCreators")}</p>
      ) : (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-800">
          {creators.map((creator) => (
            <li key={creator.userId} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  <bdi>{creator.email ?? creator.userId}</bdi>
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {creator.name ? <bdi>{creator.name}</bdi> : null}
                  {creator.name && creator.addedAt ? " · " : null}
                  {creator.addedAt
                    ? t("galleryModeration.blockedOn", { date: new Date(creator.addedAt).toLocaleDateString(uiLocale(), { day: "numeric", month: "short", year: "numeric" }) })
                    : null}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => void unblockCreator(creator)} disabled={unblock.isPending}>
                {t("galleryModeration.unblock")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
