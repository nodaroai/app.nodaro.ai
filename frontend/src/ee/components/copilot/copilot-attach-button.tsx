/**
 * Attach a file from the machine, mid-conversation.
 *
 * The `@` picker reaches what the user has already saved; this is for the photo
 * still sitting on their desktop. It uploads through the same route the canvas
 * uses, then hands back a MENTION — so from that point on an attachment and a
 * picked file are the same thing, travelling as an id the server resolves.
 *
 * Shared by both composers, which own their mention lists differently (the rail
 * keeps them in the copilot store, the home dock in local state), so this
 * reports upward rather than writing anywhere itself.
 */
import { useRef, useState } from "react"
import { Loader2, Paperclip } from "lucide-react"
import { COPILOT_STRINGS as S } from "@/ee/lib/copilot/strings"
import { useFileUpload } from "@/hooks/use-file-upload"
import { MEDIA_MENTION_KINDS, type CopilotMention } from "@/ee/lib/copilot/types"

/** What the upload route accepts, as a file-input filter. */
const ACCEPT = "image/*,video/*,audio/*"

interface CopilotAttachButtonProps {
  onAttached: (mention: CopilotMention) => void
  disabled?: boolean
}

export function CopilotAttachButton({ onAttached, disabled }: CopilotAttachButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const { upload, isUploading } = useFileUpload()
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File): Promise<void> {
    setError(null)
    let result: Awaited<ReturnType<typeof upload>>
    try {
      result = await upload(file)
    } catch {
      // The hook has already recorded the reason; a composer is the wrong place
      // to explain a storage quota, and the library page says it properly.
      setError(S.attachFailed)
      return
    }
    // No id, no mention. The model can only use a file it can NAME to the
    // server — handing it a URL is the one thing `edit_workflow` refuses, so an
    // upload that produced no asset row is an attachment that cannot be used,
    // and saying so beats a chip that silently does nothing.
    if (!result.assetId) {
      setError(S.attachNoId)
      return
    }
    const kind = MEDIA_MENTION_KINDS.find((k) => k === result.category)
    if (!kind) {
      setError(S.attachWrongKind)
      return
    }
    onAttached({
      id: result.assetId,
      name: result.filename,
      kind,
      imageUrl: result.thumbnailUrl ?? (kind === "image" ? result.url : null),
    })
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          // Cleared before the await so picking the SAME file twice still fires
          // a change event the second time.
          e.target.value = ""
          if (file) void handleFile(file)
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || isUploading}
        aria-label={S.attach}
        title={error ?? S.attach}
        className={`w-6 h-6 rounded-md border flex items-center justify-center transition-colors disabled:opacity-50 ${
          error
            ? "border-[var(--copilot-strong)] text-[var(--copilot-fail)]"
            : "border-border text-[var(--copilot-muted)] hover:text-[var(--copilot-mention)] hover:border-[var(--copilot-strong)]"
        }`}
      >
        {isUploading ? (
          <Loader2 className="w-3 h-3 animate-spin" strokeWidth={2} />
        ) : (
          <Paperclip className="w-3 h-3" strokeWidth={2} />
        )}
      </button>
    </>
  )
}
