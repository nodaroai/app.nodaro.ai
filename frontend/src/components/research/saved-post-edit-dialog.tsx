"use client"

import { useEffect, useState } from "react"
import { SAVED_POST_MAX_TAGS, SAVED_POST_NOTE_MAX, type SavedPost } from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useT } from "@/lib/i18n"
import { parseTagInput } from "./saved-post-card"

/** Change a save's note and tags. */
export function SavedPostEditDialog({
  save,
  onOpenChange,
  onSubmit,
  busy,
}: {
  /** The save being edited; null keeps the dialog closed. */
  readonly save: SavedPost | null
  readonly onOpenChange: (open: boolean) => void
  readonly onSubmit: (input: { note: string; tags: string[] }) => void
  readonly busy?: boolean
}) {
  const t = useT()
  const [note, setNote] = useState("")
  const [tags, setTags] = useState("")

  useEffect(() => {
    if (!save) return
    setNote(save.note)
    setTags(save.tags.join(", "))
  }, [save])

  return (
    <Dialog open={save !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t("inspiration.edit")}</DialogTitle>
          <DialogDescription className="truncate" dir="auto">
            {save ? (save.post.title || save.post.text).replace(/\s+/g, " ").trim() || save.url : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t("inspiration.note")}
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, SAVED_POST_NOTE_MAX))}
              placeholder={t("inspiration.notePlaceholder")}
              rows={4}
              dir="auto"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t("inspiration.tags")}
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t("inspiration.tagsPlaceholder")} dir="auto" />
            <span className="text-xs font-normal text-muted-foreground">{t("inspiration.tagsHint", { n: SAVED_POST_MAX_TAGS })}</span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button onClick={() => onSubmit({ note: note.trim(), tags: parseTagInput(tags) })} disabled={busy}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
