import { useMemo, useState } from "react"
import { Loader2, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { useT } from "@/lib/i18n"
import { useImportGalleryWords } from "@/ee/hooks/queries/use-gallery-moderation-queries"
import { DEFAULT_LANGUAGE, LanguageSelect, languageForModel } from "./moderation-languages"
import { moderationErrorText } from "./moderation-errors"

/** The most words one import may carry (the server's limit). */
const MAX_IMPORT = 1000

/**
 * The words in what was pasted: a JSON list of words (`["a", "b"]`), a JSON
 * object with a `words` list, or plain text — one word or phrase per line,
 * or separated by commas.
 */
export function parseWordList(text: string): string[] {
  const trimmed = text.trim()
  if (trimmed === "") return []
  try {
    const parsed: unknown = JSON.parse(trimmed)
    const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && Array.isArray((parsed as { words?: unknown }).words) ? (parsed as { words: unknown[] }).words : null
    if (list) return [...new Set(list.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter((item) => item !== ""))]
  } catch {
    // Not JSON — read it as plain text.
  }
  return [...new Set(trimmed.split(/[\n,]+/).map((item) => item.trim()).filter((item) => item !== ""))]
}

export function ImportWordsDialog({ open, onOpenChange }: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const [text, setText] = useState("")
  const [language, setLanguage] = useState(DEFAULT_LANGUAGE)
  const importWords = useImportGalleryWords()
  const words = useMemo(() => parseWordList(text), [text])
  const tooMany = words.length > MAX_IMPORT

  async function submit() {
    try {
      const result = await importWords.mutateAsync({ words, language: languageForModel(language) })
      toast.success(t("galleryModeration.imported", { added: result.added, skipped: result.skipped.length }))
      setText("")
      onOpenChange(false)
    } catch (error) {
      toast.error(moderationErrorText(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !importWords.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("galleryModeration.importTitle")}</DialogTitle>
          <DialogDescription>{t("galleryModeration.importHelp")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'["word1", "word2", "a short phrase"]'}
            className="h-56 max-h-[40dvh] resize-none overflow-y-auto font-mono text-xs field-sizing-fixed"
            dir="auto"
            disabled={importWords.isPending}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <LanguageSelect value={language} onChange={setLanguage} disabled={importWords.isPending} />
            <span className={tooMany ? "text-xs text-red-600" : "text-xs text-muted-foreground"}>
              {tooMany ? t("galleryModeration.importTooMany", { max: MAX_IMPORT }) : t("galleryModeration.importCount", { n: words.length })}
            </span>
          </div>
          <Button className="w-full" onClick={() => void submit()} disabled={importWords.isPending || words.length === 0 || tooMany}>
            {importWords.isPending ? <Loader2 className="h-4 w-4 animate-spin me-1.5" /> : <Upload className="h-4 w-4 me-1.5" />}
            {t("galleryModeration.importButton", { n: words.length })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
