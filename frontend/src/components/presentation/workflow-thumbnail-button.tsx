/**
 * Present → Thumbnail: the workflow's picture — its card on the dashboard, and
 * the cover a template takes when it is published or updated from this
 * workflow (the publish route copies `workflows.thumbnail_url`).
 *
 * Any image uploads straight to it, so a cover no longer needs a node placed on
 * the canvas and deleted again. Right-clicking an image node (a generated
 * result or an Upload Image) does the same from the canvas.
 */
import { useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ImageIcon, Loader2, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useFileUpload } from "@/hooks/use-file-upload"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useT } from "@/lib/i18n"
import { createClient } from "@/lib/supabase"

const VIDEO_URL = /\.(mp4|webm|mov|m4v)(\?|#|$)/i

export const workflowThumbnailKey = (workflowId: string) => ["workflow-thumbnail", workflowId] as const

async function readWorkflowThumbnail(workflowId: string): Promise<string | null> {
  const { data, error } = await createClient()
    .from("workflows")
    .select("thumbnail_url")
    .eq("id", workflowId)
    .maybeSingle()
  if (error) throw error
  const url = (data as { thumbnail_url?: unknown } | null)?.thumbnail_url
  return typeof url === "string" && url.trim() !== "" ? url : null
}

export function WorkflowThumbnailButton({ workflowId }: { readonly workflowId: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const setWorkflowThumbnail = useWorkflowStore((s) => s.setWorkflowThumbnail)
  const { upload, isUploading } = useFileUpload()
  const current = useQuery({
    queryKey: workflowThumbnailKey(workflowId),
    queryFn: () => readWorkflowThumbnail(workflowId),
    enabled: open,
  })

  const onFile = async (file: File | undefined) => {
    if (!file) return
    try {
      const { url } = await upload(file)
      if (await setWorkflowThumbnail(url)) queryClient.setQueryData(workflowThumbnailKey(workflowId), url)
    } catch (err) {
      toast.error(t("present.thumbnailUploadFailed"), {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      // The same file can be chosen again after a failure.
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  const url = current.data ?? null

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="border-border text-muted-foreground hover:text-foreground hover:bg-muted"
      >
        <ImageIcon className="h-4 w-4 me-1" />
        {t("present.thumbnailButton")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("present.thumbnailTitle")}</DialogTitle>
            <DialogDescription>{t("present.thumbnailDesc")}</DialogDescription>
          </DialogHeader>

          <div className="aspect-video w-full overflow-hidden rounded-lg border border-border bg-muted flex items-center justify-center">
            {current.isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : url && VIDEO_URL.test(url) ? (
              <video src={url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
            ) : url ? (
              <img src={url} alt={t("present.thumbnailTitle")} className="h-full w-full object-cover" />
            ) : (
              <p className="text-sm text-muted-foreground">{t("present.thumbnailNone")}</p>
            )}
          </div>

          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            data-testid="thumbnail-file"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <Button onClick={() => inputRef.current?.click()} disabled={isUploading} className="w-full">
            {isUploading ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <Upload className="h-4 w-4 me-2" />}
            {url ? t("present.thumbnailReplace") : t("present.thumbnailUpload")}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t("present.thumbnailHint", { action: t("cfgshared.setAsThumbnail") })}
          </p>
        </DialogContent>
      </Dialog>
    </>
  )
}
