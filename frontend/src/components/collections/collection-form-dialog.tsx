import { useEffect, useState } from "react"
import { COLLECTION_DESCRIPTION_MAX, COLLECTION_NAME_MAX, type Collection } from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useT } from "@/lib/i18n"

/** Create a collection, or change one's name and description. */
export function CollectionFormDialog({
  open,
  collection,
  onOpenChange,
  onSubmit,
  busy,
}: {
  readonly open: boolean
  /** The collection being edited; null creates a new one. */
  readonly collection: Collection | null
  readonly onOpenChange: (open: boolean) => void
  readonly onSubmit: (input: { name: string; description: string }) => void
  readonly busy?: boolean
}) {
  const t = useT()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")

  useEffect(() => {
    if (!open) return
    setName(collection?.name ?? "")
    setDescription(collection?.description ?? "")
  }, [open, collection])

  const trimmed = name.trim()
  const canSubmit = trimmed.length > 0 && trimmed.length <= COLLECTION_NAME_MAX && description.length <= COLLECTION_DESCRIPTION_MAX && !busy

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{collection ? t("collections.edit") : t("collections.new")}</DialogTitle>
          <DialogDescription>{t("collections.description")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (canSubmit) onSubmit({ name: trimmed, description: description.trim() })
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor="collection-name" className="text-sm font-medium">
              {t("collections.nameLabel")}
            </label>
            <Input
              id="collection-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("collections.namePlaceholder")}
              maxLength={COLLECTION_NAME_MAX}
              autoFocus
              dir="auto"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="collection-description" className="text-sm font-medium">
              {t("collections.descriptionLabel")}
            </label>
            <Textarea
              id="collection-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("collections.descriptionPlaceholder")}
              maxLength={COLLECTION_DESCRIPTION_MAX}
              rows={3}
              dir="auto"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {collection ? t("common.save") : t("collections.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
