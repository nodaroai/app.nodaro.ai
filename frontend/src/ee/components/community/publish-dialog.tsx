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

interface PublishDialogProps {
  entityType: "character" | "location" | "object"
  entityId: string
  defaultTitle?: string
  open: boolean
  onOpenChange: (open: boolean) => void
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
      toast.success("Published to community", {
        description: result.slug ? `Slug: ${result.slug}` : undefined,
      })
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to publish")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share to community</DialogTitle>
          <DialogDescription>
            Publish this {entityType} to the public community library so others can discover and
            clone it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="publish-title">Title</Label>
            <Input
              id="publish-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="A short, descriptive name"
              maxLength={120}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="publish-description">Description</Label>
            <Textarea
              id="publish-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What makes this worth sharing? (optional)"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="publish-category">Category</Label>
              <Input
                id="publish-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="publish-style">Style</Label>
              <Input
                id="publish-style"
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="publish-tags">Tags</Label>
            <Input
              id="publish-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="Comma-separated, e.g. sci-fi, hero, portrait"
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
                I have the rights to share this and consent to it being public.
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
                    I have the rights/consent of any real person depicted, who is 18+.
                  </span>
                </label>
                <p className="text-xs text-muted-foreground/80 pl-7">
                  Published images are visible to everyone; the generated likeness will be public.
                </p>
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? "Publishing…" : "Publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default PublishDialog
