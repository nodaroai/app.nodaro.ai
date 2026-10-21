// Add media: upload a local file, or paste an address (a library asset's URL).

import { useRef, useState } from "react"
import { Link2, Loader2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { isHttpUrl } from "./uploads"

interface Props {
  readonly accept: "video/*" | "image/*"
  readonly uploadLabel: string
  readonly busy?: boolean
  readonly disabled?: boolean
  readonly multiple?: boolean
  readonly onFiles: (files: File[]) => void
  readonly onUrl: (url: string) => void
}

export function MediaPicker({ accept, uploadLabel, busy, disabled, multiple, onFiles, onUrl }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState("")
  const off = disabled || busy

  const submitUrl = () => {
    if (!isHttpUrl(url)) return
    onUrl(url.trim())
    setUrl("")
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        aria-label={uploadLabel}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ""
          if (files.length > 0) onFiles(files)
        }}
      />
      <Button type="button" variant="outline" size="sm" className="min-h-9" disabled={off} onClick={() => fileRef.current?.click()}>
        {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
        {uploadLabel}
      </Button>
      <div className="flex min-w-0 flex-1 gap-2">
        <Input
          className="h-9 min-w-0 flex-1"
          placeholder="…or paste a URL"
          aria-label={`${uploadLabel}: URL`}
          value={url}
          disabled={off}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              submitUrl()
            }
          }}
        />
        <Button type="button" variant="outline" size="sm" className="min-h-9" disabled={off || !isHttpUrl(url)} onClick={submitUrl}>
          <Link2 className="mr-1 h-4 w-4" /> Add
        </Button>
      </div>
    </div>
  )
}
