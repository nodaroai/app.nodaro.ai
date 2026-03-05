import { useState, useCallback } from "react"
import { Rocket, Copy, Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import { publishApp } from "@/lib/api"

interface PublishDialogProps {
  workflowId: string
}

export function PublishDialog({ workflowId }: PublishDialogProps) {
  const [open, setOpen] = useState(false)
  const [publishName, setPublishName] = useState("")
  const [publishSlug, setPublishSlug] = useState("")
  const [publishDesc, setPublishDesc] = useState("")
  const [publishing, setPublishing] = useState(false)
  const [publishedSlug, setPublishedSlug] = useState<string | null>(null)
  const [publishCopied, setPublishCopied] = useState(false)

  const handlePublish = useCallback(async () => {
    if (!publishName.trim()) {
      toast.error("Name is required")
      return
    }
    setPublishing(true)
    try {
      const slug = publishSlug.trim() || undefined
      const result = await publishApp({
        workflowId,
        name: publishName.trim(),
        slug,
        description: publishDesc.trim() || undefined,
      })
      setPublishedSlug(result.slug)
      toast.success("App published!")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to publish")
    } finally {
      setPublishing(false)
    }
  }, [workflowId, publishName, publishSlug, publishDesc])

  const publishedUrl = publishedSlug
    ? `${window.location.origin}/app/${publishedSlug}`
    : ""

  const handleCopyPublished = useCallback(() => {
    if (publishedUrl) {
      navigator.clipboard.writeText(publishedUrl)
      setPublishCopied(true)
      toast.success("Link copied")
      setTimeout(() => setPublishCopied(false), 2000)
    }
  }, [publishedUrl])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Rocket className="h-4 w-4 mr-1" />
          Publish
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Publish App</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Publish as a standalone mini-app with its own URL, persistent run history, and versioning.
          </p>

          {publishedSlug ? (
            <>
              <div className="flex gap-2">
                <Input value={publishedUrl} readOnly className="text-xs" />
                <Button variant="outline" size="sm" onClick={handleCopyPublished}>
                  {publishCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => window.open(publishedUrl, "_blank")}
              >
                Open App
              </Button>
            </>
          ) : (
            <>
              <div>
                <label className="text-sm font-medium mb-1 block">App Name *</label>
                <Input
                  value={publishName}
                  onChange={(e) => setPublishName(e.target.value)}
                  placeholder="My AI App"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">URL Slug</label>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground shrink-0">/app/</span>
                  <Input
                    value={publishSlug}
                    onChange={(e) => setPublishSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                    placeholder="auto-generated"
                    className="text-xs"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">Optional base slug — a random suffix is always appended for uniqueness</p>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Description</label>
                <Input
                  value={publishDesc}
                  onChange={(e) => setPublishDesc(e.target.value)}
                  placeholder="What does this app do?"
                />
              </div>
              <Button
                onClick={handlePublish}
                disabled={publishing || !publishName.trim()}
                className="w-full text-white hover:opacity-90"
                style={{ backgroundColor: "#ff0073" }}
              >
                {publishing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Rocket className="h-4 w-4 mr-2" />
                )}
                Publish App
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
