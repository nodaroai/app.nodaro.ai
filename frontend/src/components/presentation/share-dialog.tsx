import { useState, useCallback } from "react"
import { Share2, Copy, Check, Loader2, Link2Off } from "lucide-react"
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
import { shareWorkflow, unshareWorkflow } from "@/lib/api"

interface ShareDialogProps {
  workflowId: string
}

export function ShareDialog({ workflowId }: ShareDialogProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [shareToken, setShareToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const shareUrl = shareToken
    ? `${window.location.origin}/present/${shareToken}`
    : ""

  const handleShare = useCallback(async () => {
    setLoading(true)
    try {
      const result = await shareWorkflow(workflowId)
      setShareToken(result.shareToken)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to share")
    } finally {
      setLoading(false)
    }
  }, [workflowId])

  const handleRevoke = useCallback(async () => {
    setLoading(true)
    try {
      await unshareWorkflow(workflowId)
      setShareToken(null)
      toast.success("Sharing disabled")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke")
    } finally {
      setLoading(false)
    }
  }, [workflowId])

  const handleCopy = useCallback(() => {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      toast.success("Link copied")
      setTimeout(() => setCopied(false), 2000)
    }
  }, [shareUrl])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Share2 className="h-4 w-4 mr-1" />
          Share
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share Workflow</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Share this workflow as a presentation. Anyone with the link can run it (they pay their own credits).
          </p>

          {shareToken ? (
            <>
              <div className="flex gap-2">
                <Input value={shareUrl} readOnly className="text-xs" />
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleRevoke}
                disabled={loading}
                className="w-full"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Link2Off className="h-4 w-4 mr-2" />
                )}
                Revoke Sharing
              </Button>
            </>
          ) : (
            <Button
              onClick={handleShare}
              disabled={loading}
              className="w-full text-white hover:opacity-90"
              style={{ backgroundColor: "#ff0073" }}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Share2 className="h-4 w-4 mr-2" />
              )}
              Generate Share Link
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
