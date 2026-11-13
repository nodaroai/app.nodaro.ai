import { CoverButton } from "@/components/ui/cover-button"
import { useState, useRef, useCallback, useEffect } from "react"
import { Upload, Link } from "lucide-react"
import { toast } from "sonner"
import { useFileUpload } from "@/hooks/use-file-upload"
import { useLinkImport } from "@/hooks/use-link-import"
import { useMediaEditor } from "@/components/editor/media-editor"
import { RightsDeclarationBox } from "@/components/content-rights/rights-declaration-box"
import { isNodeLinkRightsTicked, tickNodeLinkRights, untickNodeLinkRights, useNodeLinkRightsTicked } from "@/lib/node-link-rights"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { cn } from "@/lib/utils"
import type { InputMode } from "@/types/nodes"
import type { PromptContext } from "@/lib/prompt-context"
import { GlassCard } from "../output-cards/shared"
import { PromptHelperButton } from "@/components/editor/config-panels/prompt-helper-button"
import { tx, useT } from "@/lib/i18n"
import { editableTextDir } from "@/lib/user-text-dir"

/** Deterministic waveform bar heights for decorative display */
export const WAVEFORM_HEIGHTS = [18, 14, 22, 16, 20]

/** Precomputed styles for waveform bars to avoid per-render allocation */
const WAVEFORM_BAR_STYLES = WAVEFORM_HEIGHTS.map((h, i) => ({
  height: `${h}px`,
  animation: `waveform-bar ${0.6 + i * 0.15}s ease-in-out infinite`,
  animationDelay: `${i * 0.1}s`,
}))

/** Animated decorative waveform bars */
export function WaveformBars({ color = "bg-[#ff0073]/60" }: { color?: string }) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      {WAVEFORM_BAR_STYLES.map((style, i) => (
        <div key={i} className={`w-1 ${color} rounded-full`} style={style} />
      ))}
    </div>
  )
}

interface UseMediaUploadOptions {
  mimePrefix: "image/" | "video/" | "audio/"
  nodeId: string
  isFullscreen: boolean
  inputValues: Record<string, Record<string, unknown>>
  onUpdateInput: (nodeId: string, key: string, value: unknown) => void
  url?: string
}

/** Shared upload logic for image, video, and audio input cards */
export function useMediaUpload({ mimePrefix, nodeId, isFullscreen, inputValues, onUpdateInput, url }: UseMediaUploadOptions) {
  const { isUploading } = useFileUpload()
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [urlValue, setUrlValue] = useState("")
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const effectiveUrl = isFullscreen
    ? (inputValues[nodeId]?.url as string ?? url)
    : url

  const updateUrl = useCallback((newUrl: string) => {
    if (isFullscreen) {
      onUpdateInput(nodeId, "url", newUrl)
    } else {
      useWorkflowStore.getState().updateNodeData(nodeId, { url: newUrl })
    }
  }, [nodeId, isFullscreen, onUpdateInput])

  const linkImport = useLinkImport(nodeId)
  const pendingLink = urlValue.trim()
  const rightsTicked = useNodeLinkRightsTicked(nodeId, pendingLink)
  const mediaEditor = useMediaEditor({
    onComplete: async (results) => {
      const result = results[0]
      if (!result) return
      const resultUrl = result.processedUrl ?? result.uploadResult.url
      updateUrl(resultUrl)
    },
  })

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith(mimePrefix)) return
    mediaEditor.openEditor([file])
  }, [mimePrefix, mediaEditor])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const { importLink } = linkImport
  const { openEditor } = mediaEditor
  const handleUrlSubmit = useCallback(async () => {
    const link = urlValue.trim()
    if (!link) return
    // A video or audio link is used as it is. A picture link is imported and
    // opened in the "Adjust image" editor, as a picked file is: an import of
    // someone's link, so it waits for the content rights box ticked for it.
    // A picture link that cannot be copied is used as it is (with a notice);
    // one the platform refuses to import is not used at all.
    if (mimePrefix !== "image/") {
      setUrlValue("")
      setShowUrlInput(false)
      updateUrl(link)
      return
    }
    if (!isNodeLinkRightsTicked(nodeId, link)) return
    setUrlValue("")
    setShowUrlInput(false)
    const outcome = await importLink(link, openEditor)
    if (outcome === "unconfirmed") {
      // A changed declaration unticked the box: the link waits for it again.
      setUrlValue(link)
      setShowUrlInput(true)
      return
    }
    // The platform will not import this link: it is not used as it is either.
    if (outcome === "refused") toast.error(tx("linkImport.refused"))
    if (outcome !== "failed") return
    updateUrl(link)
    toast.warning(tx("linkImport.addedAsIs"))
  }, [urlValue, updateUrl, mimePrefix, importLink, openEditor, nodeId])

  const handleRemove = useCallback(() => {
    updateUrl("")
  }, [updateUrl])

  // The content rights box under a picture link; a video or audio link, used as it is, has none.
  const rights: UrlRights | undefined = mimePrefix === "image/" && pendingLink
    ? { checked: rightsTicked, onCheckedChange: (checked) => (checked ? tickNodeLinkRights(nodeId, pendingLink) : untickNodeLinkRights(nodeId)) }
    : undefined

  return {
    rights,
    effectiveUrl,
    isUploading: isUploading || linkImport.isImporting,
    isDragOver,
    setIsDragOver,
    showUrlInput,
    setShowUrlInput,
    urlValue,
    setUrlValue,
    fileInputRef,
    handleFile,
    handleDrop,
    handleUrlSubmit,
    handleRemove,
    mediaEditor,
  }
}

/** The content rights box under a picture link: ticked for this link on this card. */
export interface UrlRights {
  readonly checked: boolean
  readonly onCheckedChange: (checked: boolean) => void
}

/** Inline URL input row shared across upload cards; with `rights` (a picture link), Set waits for its box. */
export function UrlInputRow({
  urlValue,
  onChange,
  onSubmit,
  rights,
}: {
  urlValue: string
  onChange: (value: string) => void
  onSubmit: () => void
  rights?: UrlRights
}) {
  const t = useT()
  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={urlValue}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
          placeholder={t("apps.previewMediaPlaceholder")}
          className="flex-1 bg-muted/30 border border-border rounded-lg px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-[#ff0073]/50"
          autoFocus
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={rights !== undefined && !rights.checked}
          className="px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 text-muted-foreground rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t("present.set")}
        </button>
      </div>
      {rights && <RightsDeclarationBox checked={rights.checked} onCheckedChange={rights.onCheckedChange} />}
    </div>
  )
}

/** Upload spinner shown during file upload */
export function UploadSpinner({ size = "md" }: { size?: "sm" | "md" }) {
  const t = useT()
  const dim = size === "sm" ? "w-6 h-6" : "w-8 h-8"
  return (
    <div className="flex flex-col items-center gap-2">
      <div className={`${dim} border-2 border-[#ff0073]/40 border-t-[#ff0073] rounded-full animate-spin`} />
      <span className="text-xs text-muted-foreground">{t("inputcfg.uploading")}</span>
    </div>
  )
}

/** Drop zone for drag-and-drop file upload */
export function FileDropZone({
  isDragOver,
  setIsDragOver,
  onDrop,
  onClick,
  isUploading,
  accept,
  fileInputRef,
  onFileChange,
  label,
  height = "h-28 sm:h-40",
  onShowUrl,
}: {
  isDragOver: boolean
  setIsDragOver: (v: boolean) => void
  onDrop: (e: React.DragEvent) => void
  onClick: () => void
  isUploading: boolean
  accept: string
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onFileChange: (file: File) => void
  label: string
  height?: string
  /** "Or paste a URL": none for an input that takes a file only (a cloned voice's recordings). */
  onShowUrl?: () => void
}) {
  const t = useT()
  return (
    <div
      className={`relative flex flex-col items-center justify-center ${height} border-2 border-dashed rounded-lg transition-all duration-200 cursor-pointer ${
        isDragOver
          ? "border-[#ff0073]/60 bg-[#ff0073]/5"
          : "border-muted-foreground/20 hover:border-[#ff0073]/50 bg-muted/10"
      }`}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={onDrop}
      onClick={onClick}
    >
      {isUploading ? (
        <UploadSpinner size={height === "h-24" ? "sm" : "md"} />
      ) : (
        <>
          <Upload className={height === "h-24" ? "w-6 h-6 text-muted-foreground mb-1" : "w-6 h-6 sm:w-8 sm:h-8 text-muted-foreground mb-1 sm:mb-2"} />
          <span className="text-xs text-muted-foreground">{label}</span>
          {onShowUrl && (
            <button
              type="button"
              className="mt-2 py-1.5 px-2 text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors touch-manipulation"
              onClick={(e) => { e.stopPropagation(); onShowUrl() }}
            >
              <Link className="w-3 h-3" /> {t("present.orPasteUrl")}
            </button>
          )}
        </>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFileChange(file)
          e.target.value = ""
        }}
      />
      <CoverButton label={t("common.upload")} onActivate={onClick} />
    </div>
  )
}

export const INPUT_CLS = "w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-[#ff0073]/50 focus:ring-1 focus:ring-[#ff0073]/30 transition-all duration-200"

interface PresentationTextInputProps {
  label: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
  readOnly?: boolean
  mode: InputMode
  minLines?: number
  icon?: React.ReactNode
  promptHelper?: PromptContext
  /** The most characters the app user may enter (the exposed input's limit): the box takes no more and a counter shows against it. */
  maxLength?: number
}

/** Shared text/parameter input supporting prompt, multiline, oneline, and inline modes */
export function PresentationTextInput({ label, value, placeholder, onChange, readOnly, mode, minLines, icon, promptHelper, maxLength }: PresentationTextInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (mode !== "prompt" && mode !== "multiline") return
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    const minH = mode === "multiline" ? (minLines ?? 3) * 24 : 80
    el.style.height = `${Math.max(minH, el.scrollHeight)}px`
  }, [value, mode, minLines])

  const labelContent = icon ? <>{icon}<span dir="auto">{label}</span></> : <span dir="auto">{label}</span>
  const labelCls = cn(
    "text-xs font-medium text-muted-foreground uppercase tracking-wider",
    icon && "flex items-center gap-1.5",
  )

  const helperBtn = promptHelper && (
    <PromptHelperButton
      nodeType={promptHelper.nodeType}
      currentPrompt={value}
      provider={promptHelper.provider}
      aspectRatio={promptHelper.aspectRatio}
      duration={promptHelper.duration}
      onAccept={onChange}
    />
  )

  const counter = maxLength !== undefined && (
    <p
      data-testid="field-char-count"
      className={cn("mt-1 text-end font-mono text-[11px]", value.length >= maxLength ? "text-amber-500" : "text-muted-foreground")}
    >
      {value.length}/{maxLength}
    </p>
  )

  if (mode === "inline") {
    return (
      <GlassCard>
        <div className="flex items-center gap-3">
          <label className={cn(labelCls, "whitespace-nowrap shrink-0")}>{labelContent}</label>
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            readOnly={readOnly}
            dir={editableTextDir(value)}
            maxLength={maxLength}
            className={cn(INPUT_CLS, "flex-1", readOnly && "opacity-70 cursor-default")}
          />
          {helperBtn}
        </div>
        {counter}
      </GlassCard>
    )
  }

  if (mode === "oneline") {
    return (
      <GlassCard>
        <div className="flex items-center justify-between mb-3">
          <label className={labelCls}>{labelContent}</label>
          {helperBtn}
        </div>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          readOnly={readOnly}
          dir={editableTextDir(value)}
          maxLength={maxLength}
          className={cn(INPUT_CLS, readOnly && "opacity-70 cursor-default")}
        />
        {counter}
      </GlassCard>
    )
  }

  const minH = mode === "multiline" ? (minLines ?? 3) * 24 : 80
  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-3">
        <label className={labelCls}>{labelContent}</label>
        {helperBtn}
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        dir={editableTextDir(value)}
        maxLength={maxLength}
        style={{ minHeight: `${minH}px` }}
        className={cn(INPUT_CLS, "max-h-[40vh] overflow-y-auto resize-none", readOnly && "opacity-70 cursor-default")}
      />
      {counter}
    </GlassCard>
  )
}
