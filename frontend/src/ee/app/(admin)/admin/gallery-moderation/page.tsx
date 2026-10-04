import { useState } from "react"
import { Loader2, Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useT } from "@/lib/i18n"
import { useAddGalleryWord, useGalleryModeration } from "@/ee/hooks/queries/use-gallery-moderation-queries"
import { TERM_MAX_LENGTH, WordCard } from "./word-card"
import { BlockedCreators } from "./blocked-creators"
import { moderationErrorText } from "./moderation-errors"

/**
 * Admin → Gallery moderation. What stays out of the public gallery:
 *   - banned words — in any language, with the translations found for each
 *     (the admin deletes the wrong ones) and the phrases that stay allowed;
 *   - blocked creators — nothing they made reaches the gallery.
 * Enforced on every gallery listing by `backend/src/lib/gallery-moderation.ts`;
 * a change shows there within a minute. Removing a single item, or many, is
 * done from the gallery itself.
 *
 * DIRECTION: logical Tailwind properties only — `rtl:` / `ltr:` variants are
 * banned repo-wide (see the review page's note).
 */
export default function AdminGalleryModerationPage() {
  const t = useT()
  const { data, isLoading, isError } = useGalleryModeration()
  const addWord = useAddGalleryWord()
  const [word, setWord] = useState("")
  const [lastAdded, setLastAdded] = useState<string | null>(null)

  async function submitWord() {
    const value = word.trim()
    if (!value) return
    try {
      const { suggested } = await addWord.mutateAsync({ word: value })
      setWord("")
      setLastAdded(value)
      if (suggested) toast.success(t("galleryModeration.wordAdded", { word: value }))
      else toast.warning(t("galleryModeration.noSuggestions", { word: value }))
    } catch (error) {
      toast.error(moderationErrorText(error))
    }
  }

  return (
    <div className="space-y-8 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("galleryModeration.title")}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{t("galleryModeration.subtitle")}</p>
      </header>

      {isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : isError || !data ? (
        <p className="text-sm text-red-600">{t("galleryModeration.loadFailed")}</p>
      ) : (
        <>
          <section className="space-y-3">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">{t("galleryModeration.wordsTitle")}</h2>
              <p className="max-w-3xl text-sm text-muted-foreground">{t("galleryModeration.wordsHelp")}</p>
            </div>
            <form
              className="flex max-w-md gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void submitWord()
              }}
            >
              <Input value={word} onChange={(e) => setWord(e.target.value)} placeholder={t("galleryModeration.wordPlaceholder")} maxLength={TERM_MAX_LENGTH} disabled={addWord.isPending} />
              <Button type="submit" disabled={addWord.isPending || word.trim() === ""}>
                {addWord.isPending ? <Loader2 className="h-4 w-4 animate-spin me-1" /> : <Plus className="h-4 w-4 me-1" />}
                {addWord.isPending ? t("galleryModeration.finding") : t("galleryModeration.addWord")}
              </Button>
            </form>
            {data.words.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("galleryModeration.noWords")}</p>
            ) : (
              <ul className="space-y-2">
                {data.words.map((entry) => (
                  <WordCard key={entry.word} entry={entry} defaultOpen={entry.word === lastAdded} />
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">{t("galleryModeration.creatorsTitle")}</h2>
              <p className="max-w-3xl text-sm text-muted-foreground">{t("galleryModeration.creatorsHelp")}</p>
            </div>
            <BlockedCreators creators={data.bannedUsers} />
          </section>
        </>
      )}
    </div>
  )
}
