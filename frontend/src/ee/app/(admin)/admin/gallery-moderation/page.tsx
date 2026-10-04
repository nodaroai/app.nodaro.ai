import { useState } from "react"
import { Loader2, Plus, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useT } from "@/lib/i18n"
import { useAddGalleryWord, useGalleryModeration } from "@/ee/hooks/queries/use-gallery-moderation-queries"
import { TERM_MAX_LENGTH, WordCard } from "./word-card"
import { BlockedCreators } from "./blocked-creators"
import { BlockedPatterns } from "./blocked-patterns"
import { AdminGalleryGrid } from "./admin-gallery-grid"
import { ImportWordsDialog } from "./import-words-dialog"
import { DEFAULT_LANGUAGE, LanguageSelect, languageForModel } from "./moderation-languages"
import { moderationErrorText } from "./moderation-errors"

/**
 * Admin → Gallery moderation, in three tabs:
 *   - the gallery itself, as visitors see it, with who made each item — hide
 *     one item, many, or every item of a creator;
 *   - banned words — typed one by one or imported as a list, in a chosen
 *     language, each with its translations and allowed phrases;
 *   - blocked creators.
 * Enforced on every gallery listing by `backend/src/lib/gallery-moderation.ts`;
 * a change shows in the gallery within a minute.
 *
 * DIRECTION: logical Tailwind properties only — `rtl:` / `ltr:` variants are
 * banned repo-wide (see the review page's note).
 */
export default function AdminGalleryModerationPage() {
  const t = useT()
  const { data, isLoading, isError } = useGalleryModeration()
  const addWord = useAddGalleryWord()
  const [word, setWord] = useState("")
  const [language, setLanguage] = useState(DEFAULT_LANGUAGE)
  const [importOpen, setImportOpen] = useState(false)
  const [lastAdded, setLastAdded] = useState<string | null>(null)
  const filling = data?.filling ?? []

  async function submitWord() {
    const value = word.trim()
    if (!value) return
    try {
      const { suggested } = await addWord.mutateAsync({ word: value, language: languageForModel(language) })
      setWord("")
      setLastAdded(value)
      if (suggested) toast.success(t("galleryModeration.wordAdded", { word: value }))
      else toast.warning(t("galleryModeration.noSuggestions", { word: value }))
    } catch (error) {
      toast.error(moderationErrorText(error))
    }
  }

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("galleryModeration.title")}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{t("galleryModeration.subtitle")}</p>
      </header>

      <Tabs defaultValue="gallery">
        <TabsList>
          <TabsTrigger value="gallery">{t("galleryModeration.tabGallery")}</TabsTrigger>
          <TabsTrigger value="words">{t("galleryModeration.wordsTitle")}</TabsTrigger>
          <TabsTrigger value="creators">{t("galleryModeration.creatorsTitle")}</TabsTrigger>
        </TabsList>

        <TabsContent value="gallery" className="pt-4">
          <AdminGalleryGrid />
        </TabsContent>

        <TabsContent value="words" className="space-y-3 pt-4">
          <p className="max-w-3xl text-sm text-muted-foreground">{t("galleryModeration.wordsHelp")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <form
              className="flex flex-1 flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void submitWord()
              }}
            >
              <Input
                value={word}
                onChange={(e) => setWord(e.target.value)}
                placeholder={t("galleryModeration.wordPlaceholder")}
                maxLength={TERM_MAX_LENGTH}
                disabled={addWord.isPending}
                className="max-w-xs"
              />
              <LanguageSelect value={language} onChange={setLanguage} disabled={addWord.isPending} />
              <Button type="submit" disabled={addWord.isPending || word.trim() === ""}>
                {addWord.isPending ? <Loader2 className="h-4 w-4 animate-spin me-1" /> : <Plus className="h-4 w-4 me-1" />}
                {addWord.isPending ? t("galleryModeration.finding") : t("galleryModeration.addWord")}
              </Button>
            </form>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4 me-1" />
              {t("galleryModeration.importList")}
            </Button>
          </div>
          {filling.length > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("galleryModeration.filling", { n: filling.length })}
            </p>
          )}
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : isError || !data ? (
            <p className="text-sm text-red-600">{t("galleryModeration.loadFailed")}</p>
          ) : data.words.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("galleryModeration.noWords")}</p>
          ) : (
            <ul className="space-y-2">
              {data.words.map((entry) => (
                <WordCard key={entry.word} entry={entry} defaultOpen={entry.word === lastAdded} />
              ))}
            </ul>
          )}
          <ImportWordsDialog open={importOpen} onOpenChange={setImportOpen} />
        </TabsContent>

        <TabsContent value="creators" className="space-y-3 pt-4">
          <p className="max-w-3xl text-sm text-muted-foreground">{t("galleryModeration.creatorsHelp")}</p>
          {data ? (
            <div className="space-y-8">
              <BlockedCreators creators={data.bannedUsers} />
              <BlockedPatterns patterns={data.emailPatterns ?? []} />
            </div>
          ) : isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  )
}
