import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { publishToCommunity } from "@/lib/api"
import { tx, useT, type MessageKey } from "@/lib/i18n"

interface PublishDialogProps {
  entityType: "character" | "location" | "object" | "creature"
  entityId: string
  defaultTitle?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** One full sentence per entity type — the noun's gender changes the rest of the Hebrew sentence. */
const PUBLISH_DESCRIPTION_KEYS: Record<PublishDialogProps["entityType"], MessageKey> = {
  character: "community.publishDescCharacter",
  location: "community.publishDescLocation",
  object: "community.publishDescObject",
  creature: "community.publishDescCreature",
}

/** Split a comma-separated tag string into a clean, de-duped list. */
function parseTags(raw: string): string[] {
  const seen = new Set<string>()
  for (const part of raw.split(",")) {
    const t = part.trim()
    if (t) seen.add(t)
  }
  return [...seen]
}

export function PublishDialog({
  entityType,
  entityId,
  defaultTitle,
  open,
  onOpenChange,
}: PublishDialogProps) {
  const t = useT()
  const [title, setTitle] = useState(defaultTitle ?? "")
  const [description, setDescription] = useState("")
  const [category, setCategory] = useState("")
  const [style, setStyle] = useState("")
  const [tags, setTags] = useState("")
  const [attestation, setAttestation] = useState(false)
  const [likenessAttestation, setLikenessAttestation] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const isCharacter = entityType === "character"

  // Reset the form whenever the dialog (re)opens so a stale draft from a
  // previous entity doesn't bleed through. Prefill the title from the entity.
  useEffect(() => {
    if (!open) return
    setTitle(defaultTitle ?? "")
    setDescription("")
    setCategory("")
    setStyle("")
    setTags("")
    setAttestation(false)
    setLikenessAttestation(false)
    setSubmitting(false)
  }, [open, defaultTitle])

  const canSubmit =
    !!title.trim() && attestation && (!isCharacter || likenessAttestation) && !submitting

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const result = await publishToCommunity(entityType, entityId, {
        title: title.trim(),
        description: description.trim() || undefined,
        category: category.trim() || undefined,
        style: style.trim() || undefined,
        tags: parseTags(tags),
        attestation: true,
        likenessAttestation: isCharacter ? likenessAttestation : undefined,
      })
      toast.success(tx("community.publishedToCommunity"), {
        description: result.slug ? tx("community.slugLabel", { slug: result.slug }) : undefined,
      })
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tx("pubDialog.publishFailed"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Opened from inside the character/location/object studio modals, which are
          fixed overlays at z-[100]–z-[1000]. Raise this dialog (content + backdrop)
          above them so it isn't rendered behind the studio (was invisible on click). */}
      <DialogContent className="sm:max-w-lg z-[10000]" overlayClassName="z-[10000]">
        <DialogHeader>
          <DialogTitle>{t("studio.shareToCommunity")}</DialogTitle>
          <DialogDescription>
            {t(PUBLISH_DESCRIPTION_KEYS[entityType])}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="publish-title">{t("present.title")}</Label>
            <Input
              id="publish-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("community.titlePlaceholder")}
              maxLength={120}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="publish-description">{t("common.description")}</Label>
            <Textarea
              id="publish-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("community.descriptionPlaceholder")}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="publish-category">{t("pubTemplate.categoryLabel")}</Label>
              <Input
                id="publish-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder={t("common.optional")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="publish-style">{t("field.style")}</Label>
              <Input
                id="publish-style"
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                placeholder={t("common.optional")}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="publish-tags">{t("marketplace.tagsLabel")}</Label>
            <Input
              id="publish-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={t("community.tagsPlaceholder")}
            />
          </div>

          <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
            <label className="flex items-start gap-2.5 cursor-pointer text-sm">
              <Checkbox
                checked={attestation}
                onCheckedChange={(v) => setAttestation(!!v)}
                className="mt-0.5"
              />
              <span className="text-muted-foreground">
                {t("community.attestRights")}
              </span>
            </label>

            {isCharacter && (
              <>
                <label className="flex items-start gap-2.5 cursor-pointer text-sm">
                  <Checkbox
                    checked={likenessAttestation}
                    onCheckedChange={(v) => setLikenessAttestation(!!v)}
                    className="mt-0.5"
                  />
                  <span className="text-muted-foreground">
                    {t("community.attestLikeness")}
                  </span>
                </label>
                <p className="text-xs text-muted-foreground/80 ps-7">
                  {t("community.likenessPublicNote")}
                </p>
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? t("community.publishing") : t("pubDialog.trigger")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default PublishDialog
