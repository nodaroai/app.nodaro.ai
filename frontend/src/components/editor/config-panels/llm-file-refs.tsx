"use client"

import { useEffect, useRef, useState } from "react"
import { FileText, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"
import { uploadFile } from "@/lib/api"
import {
  LLM_REFERENCE_FILES_MAX,
  LLM_REFERENCE_FILES_MAX_TOTAL_BYTES,
  LLM_REFERENCE_FILES_MAX_PAGES,
  LLM_REFERENCE_FILE_MIME_TYPES,
} from "@nodaro/shared/llm-models"

const MB = 1024 * 1024

/** The name a file link shows: its last path segment. */
export function fileRefName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() || url)
  } catch {
    return url
  }
}

/**
 * The documents a Generate Text node sends its model (`referenceFileUrls`):
 * PDFs uploaded here (the platform's upload, stored as a document) or a public
 * link pasted in. Shown only for a model that reads files (`llmAcceptsFiles`);
 * the server reads, checks and counts each file before the run holds anything.
 * A file larger than the call's whole limit is refused before it is uploaded;
 * the run checks the files' total (links included) when it starts.
 */
export function LlmFileRefs({
  urls,
  onChange,
}: {
  urls: readonly string[]
  onChange: (urls: string[] | undefined) => void
}) {
  const t = useT()
  const input = useRef<HTMLInputElement>(null)
  // The links as they are NOW: an upload that lands after another change
  // (a removal, a pasted link) adds to those, never to the list it started from.
  const latest = useRef(urls)
  useEffect(() => {
    latest.current = urls
  }, [urls])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const full = urls.length >= LLM_REFERENCE_FILES_MAX
  const mb = Math.round(LLM_REFERENCE_FILES_MAX_TOTAL_BYTES / MB)

  const set = (next: string[]) => onChange(next.length ? next : undefined)

  async function upload(file: File) {
    setError(null)
    if (!LLM_REFERENCE_FILE_MIME_TYPES.includes(file.type) && !file.name.toLowerCase().endsWith(".pdf")) {
      setError(t("txtcfg.fileNotPdf"))
      return
    }
    if (file.size > LLM_REFERENCE_FILES_MAX_TOTAL_BYTES) {
      setError(t("txtcfg.filesTooLarge", { mb }))
      return
    }
    setBusy(true)
    try {
      const result = await uploadFile(file)
      set([...latest.current, result.url])
    } catch {
      setError(t("txtcfg.fileUploadFailed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2" data-testid="llm-file-refs">
      <div className="flex items-center gap-2">
        <FileText className="w-3.5 h-3.5 text-gray-500" />
        <span className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">{t("txtcfg.files")}</span>
        <span className="text-[11px] text-muted-foreground ms-auto">{urls.length}/{LLM_REFERENCE_FILES_MAX}</span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t("txtcfg.filesHint", { max: LLM_REFERENCE_FILES_MAX, mb, pages: LLM_REFERENCE_FILES_MAX_PAGES })}
      </p>
      {urls.length > 0 && (
        <ul className="space-y-1">
          {urls.map((url, idx) => (
            <li key={`${url}-${idx}`} className="flex items-center gap-2 text-xs bg-[#F8FAFC] dark:bg-[#121212] rounded px-2 py-1">
              <span className="truncate flex-1" title={url} dir="auto">{fileRefName(url)}</span>
              <button
                type="button"
                onClick={() => set(urls.filter((_, i) => i !== idx))}
                className="text-gray-400 hover:text-red-500"
                aria-label={t("txtcfg.removeRef")}
              >
                <X className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <div className="flex gap-2">
          <input
            ref={input}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ""
              if (file) void upload(file)
            }}
          />
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs flex-1" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? <Loader2 className="w-3 h-3 me-1 animate-spin" /> : null}
            {busy ? t("txtcfg.uploadingFile") : t("txtcfg.uploadPdf")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs flex-1"
            disabled={busy}
            onClick={() => {
              const url = window.prompt(t("txtcfg.pasteFileUrl"))
              if (url && /^https:\/\//.test(url.trim())) set([...urls, url.trim()])
            }}
          >
            {t("txtcfg.addFileLink")}
          </Button>
        </div>
      )}
      {error && <p className="text-[11px] text-red-500" role="alert">{error}</p>}
    </div>
  )
}
