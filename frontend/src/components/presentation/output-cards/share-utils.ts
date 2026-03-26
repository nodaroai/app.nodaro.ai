import { toast } from "sonner"
import { copyUrl } from "./shared"

export async function shareMedia(params: {
  url?: string
  text?: string
  title: string
  type: "image" | "video" | "audio" | "text"
}): Promise<void> {
  const { url, text, title, type } = params

  // Text results: share text content
  if (type === "text" && text) {
    if (CAN_NATIVE_SHARE) {
      try {
        await navigator.share({ title, text })
        return
      } catch {
        // User cancelled or API error — fall through to clipboard
      }
    }
    await navigator.clipboard.writeText(text)
    toast.success("Text copied to clipboard")
    return
  }

  if (!url) return

  // Media results: share URL
  if (CAN_NATIVE_SHARE) {
    try {
      await navigator.share({ title, url })
      return
    } catch {
      // User cancelled or API error — fall through to clipboard
    }
  }

  // Fallback: copy URL
  copyUrl(url)
}

/** True if native share is available — computed once at module load */
export const CAN_NATIVE_SHARE = typeof navigator !== "undefined" && !!navigator.share
