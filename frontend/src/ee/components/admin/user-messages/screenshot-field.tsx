/**
 * One screenshot per message: pick, upload, name it, remove it.
 *
 * The link text is REQUIRED whenever an image is attached, and the field says
 * why. Loops cannot put a variable in an image `src`, so the screenshot goes
 * into the email as a link — which makes these words the only thing the
 * recipient sees before clicking. That is the same reason the spec asked for
 * alt text: an email that depends on an image nobody loads is an email that
 * says nothing.
 */
import { useRef, useState } from "react"
import { Loader2, Paperclip, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  ACCEPTED_SCREENSHOT_TYPES,
  uploadAdminScreenshot,
} from "@/ee/hooks/queries/use-admin-messages"

export function ScreenshotField({
  imageUrl,
  imageLabel,
  onChange,
  onUploadingChange,
  disabled,
}: {
  readonly imageUrl: string
  readonly imageLabel: string
  readonly onChange: (next: { imageUrl: string; imageLabel: string }) => void
  /**
   * Raised while bytes are in flight. The PARENT needs this, not just this
   * component: with the upload state kept local, Send stayed enabled during it,
   * and clicking Send sent the message without the screenshot, showed a success
   * toast, and closed the dialog — the admin never learning that the thing they
   * attached was dropped. That is precisely the silent loss this feature exists
   * to avoid, so the flag has to reach whatever owns the Send button.
   */
  readonly onUploadingChange?: (uploading: boolean) => void
  readonly disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const setBusy = (busy: boolean) => {
    setUploading(busy)
    onUploadingChange?.(busy)
  }

  const handlePick = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      const url = await uploadAdminScreenshot(file)
      onChange({
        imageUrl: url,
        // Seed the link text from the filename so the required field is never
        // an empty roadblock — the admin can still rewrite it.
        imageLabel: imageLabel || "See the screenshot",
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setBusy(false)
      // Clear the input so re-picking the same file fires onChange again.
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  const missingLabel = Boolean(imageUrl) && imageLabel.trim().length === 0

  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium">Screenshot (optional)</Label>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_SCREENSHOT_TYPES.join(",")}
        className="hidden"
        onChange={(e) => void handlePick(e.target.files?.[0])}
        data-testid="screenshot-input"
      />

      {imageUrl ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
            <img
              src={imageUrl}
              alt=""
              className="h-10 w-10 rounded object-cover"
            />
            <span className="flex-1 truncate text-xs text-muted-foreground">{imageUrl}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => onChange({ imageUrl: "", imageLabel: "" })}
              aria-label="Remove screenshot"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="space-y-1">
            <Label htmlFor="image-label" className="text-xs font-medium">
              Link text <span className="text-destructive">*</span>
            </Label>
            <Input
              id="image-label"
              value={imageLabel}
              disabled={disabled}
              placeholder="See the screenshot"
              onChange={(e) => onChange({ imageUrl, imageLabel: e.target.value })}
              aria-invalid={missingLabel}
            />
            <p className="text-[11px] text-muted-foreground">
              The image is sent as a link, so these words are all the recipient sees
              until they click. Required.
            </p>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Paperclip className="mr-1.5 h-3.5 w-3.5" />
          )}
          {uploading ? "Uploading..." : "Attach a screenshot"}
        </Button>
      )}
    </div>
  )
}
