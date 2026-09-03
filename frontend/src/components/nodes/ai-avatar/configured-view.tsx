"use client"

// Configured state of the AI Avatar node: the picked look (or source image) on
// the left — portrait, engine/source badge, name + meta, and the way to change
// it — and on the right the speech setup: the voice strip + the script (text
// mode) or the wired-audio status (audio mode). Everything renders from the
// node's own data first; the HeyGen catalog only enriches what it can.

import { useCallback, useMemo, type ChangeEvent, type KeyboardEvent, type MouseEvent } from "react"
import { AudioLines, Image as ImageIcon, Link2, Loader2, Upload, User, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import { tx, useT } from "@/lib/i18n"
import type { AiAvatarData } from "@/types/nodes"
import { CachedImage } from "@/components/ui/cached-image"
import { useFileUpload } from "@/hooks/use-file-upload"
import { useHeygenAvatars, avatarSupportsV, voiceSelectionPatch } from "@/components/heygen/heygen-catalog"
import { AI_AVATAR_ENGINE_OPTIONS } from "@/components/editor/config-panels/model-options"
import { VoiceRow } from "./voice-row"
import { formatScriptMeta } from "./catalog-helpers"
import type { AiAvatarWiringInfo } from "./use-ai-avatar-wiring"
import { FIELD_SURFACE, GHOST_BUTTON, KICKER, META_MONO, PANEL_BG, PANEL_EDGE } from "./styles"

/** Longest script HeyGen accepts (mirrors the config panel's maxLength). */
const SCRIPT_MAX = 5000

interface ConfiguredViewProps {
  readonly data: AiAvatarData
  readonly wiring: AiAvatarWiringInfo
  readonly onUpdate: (patch: Partial<AiAvatarData>) => void
  /** Catalog mode: show the quick pick again. */
  readonly onChangeAvatar: () => void
}

function stop(e: MouseEvent | KeyboardEvent) {
  e.stopPropagation()
}

/** Last path segment of an uploaded/pasted image URL, for the title line. */
function fileNameOf(url: string): string {
  try {
    const path = new URL(url).pathname
    const last = decodeURIComponent(path.split("/").filter(Boolean).pop() ?? "")
    return last || tx("node.sourceImage")
  } catch {
    return tx("node.sourceImage")
  }
}

function capitalize(s: string): string {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

export function ConfiguredView({ data, wiring, onUpdate, onChangeAvatar }: ConfiguredViewProps) {
  const t = useT()
  const source = data.avatarSource ?? "avatar"
  const mode = data.speechMode ?? "text"
  const engine = data.engine ?? "avatar-iv"
  const isImage = source === "image"

  // ── Catalog enrichment (gender, V support) — optional ─────────────────────
  const { data: avatars = [] } = useHeygenAvatars()
  const catalogLook = useMemo(
    () => (!isImage && data.avatarId ? avatars.find((a) => a.avatarId === data.avatarId) : undefined),
    [avatars, data.avatarId, isImage],
  )
  const supportsV = catalogLook ? avatarSupportsV(catalogLook) : data.avatarSupportsV

  // ── The picture on the left ───────────────────────────────────────────────
  const imageWired = isImage && wiring.image
  const portraitUrl = isImage
    ? (wiring.upstreamImageUrl ?? (imageWired ? undefined : data.imageUrl))
    : (catalogLook?.previewImageUrl ?? data.avatarPreviewUrl)

  const engineLabel = AI_AVATAR_ENGINE_OPTIONS.find((o) => o.value === engine)?.label?.replace(/^HeyGen\s+/, "") ?? engine
  const title = isImage
    ? (imageWired ? t("node.wiredFrom", { source: wiring.imageSourceLabel ?? t("node.theImageInput") }) : fileNameOf(data.imageUrl ?? ""))
    : (catalogLook?.name ?? data.avatarName ?? t("node.selectedAvatar"))
  const subtitle = isImage
    ? (imageWired ? t("node.arrivesAtRunTime") : t("node.uploadedPortrait"))
    : [
        catalogLook?.gender ? capitalize(catalogLook.gender) : "",
        supportsV === true ? t("node.avatarVReady") : supportsV === false ? "Avatar IV" : "",
      ].filter(Boolean).join(" · ")

  // ── Replace image (image mode, not wired) ─────────────────────────────────
  const { upload, isUploading } = useFileUpload()
  const handleReplace = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ""
      if (!file) return
      try {
        const result = await upload(file)
        onUpdate({ imageUrl: result.url })
      } catch {
        // surfaced by useFileUpload; nothing else to do on the card
      }
    },
    [upload, onUpdate],
  )

  // ── Script (text mode) ────────────────────────────────────────────────────
  const scriptWired = mode === "text" && wiring.script
  const script = data.script ?? ""
  const shownScript = scriptWired ? (wiring.upstreamScript ?? "") : script
  const scriptMeta = formatScriptMeta(shownScript, data.voiceSpeed ?? 1)

  return (
    <div className="grid grid-cols-[168px_minmax(0,1fr)] h-full min-h-0" data-testid="ai-avatar-configured">
      {/* ── Left: the look ─────────────────────────────────────────────── */}
      <div className={cn("flex flex-col min-h-0 border-r", PANEL_EDGE, PANEL_BG)}>
        <div className="relative flex-1 min-h-0 overflow-hidden bg-muted/40">
          {portraitUrl ? (
            <CachedImage
              src={portraitUrl}
              alt={isImage ? t("node.sourceImage") : title}
              thumbnail
              thumbnailWidth={512}
              className="w-full h-full object-cover object-top"
            />
          ) : (
            <div className="w-full h-full grid place-items-center text-muted-foreground/40">
              {isImage ? <ImageIcon className="size-8" /> : <User className="size-8" />}
            </div>
          )}
          <span
            className={cn(
              "absolute top-2 left-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[8.5px] tracking-[0.08em] uppercase whitespace-nowrap",
              isImage ? "bg-sky-700/90 text-sky-50" : "bg-violet-600/90 text-violet-50",
            )}
          >
            {isImage ? <Upload className="size-2.5" /> : <Zap className="size-2.5" />}
            {isImage ? t("node.sourceImage") : engineLabel}
          </span>
        </div>

        <div className="flex flex-col gap-0.5 px-3 pt-2.5 pb-2 min-w-0">
          <span className="text-[12px] font-medium text-foreground truncate" title={title}>{title}</span>
          {subtitle && <span className="text-[10.5px] text-muted-foreground truncate">{subtitle}</span>}
        </div>

        <div className="px-3 pb-3">
          {isImage ? (
            imageWired ? (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70">
                <Link2 className="size-2.5" /> {t("node.wiredInputTakesPriority")}
              </span>
            ) : (
              <label className={cn(GHOST_BUTTON, "w-full", isUploading && "opacity-70 cursor-progress")} onClick={stop}>
                {isUploading ? <Loader2 className="size-3 animate-spin" /> : null}
                {isUploading ? t("pipe.uploading") : t("node.replaceImage")}
                <input type="file" accept="image/*" className="hidden" disabled={isUploading} aria-label={t("node.replaceImage")} onChange={handleReplace} />
              </label>
            )
          ) : (
            <button type="button" className={cn(GHOST_BUTTON, "w-full")} onClick={(e) => { stop(e); onChangeAvatar() }}>
              {t("node.changeAvatar")}
            </button>
          )}
        </div>
      </div>

      {/* ── Right: speech ──────────────────────────────────────────────── */}
      <div className="flex flex-col min-h-0 min-w-0">
        {mode === "text" ? (
          <>
            <VoiceRow
              voiceId={data.voiceId}
              voiceName={data.voiceName}
              onSelectVoice={(v) => onUpdate(voiceSelectionPatch(v))}
            />
            <div className="flex-1 min-h-0 flex flex-col gap-2 px-3 pt-2.5 pb-3">
              <div className="flex items-center justify-between gap-2 shrink-0">
                <span className={KICKER}>{scriptWired ? t("node.scriptWiredFrom", { source: wiring.scriptSourceLabel ?? t("node.theInput") }) : t("node.scriptTextTts")}</span>
                <span className={META_MONO}>{scriptMeta}</span>
              </div>
              {scriptWired ? (
                <div className={cn(FIELD_SURFACE, "flex-1 min-h-0 overflow-y-auto nowheel px-3 py-2 text-[12px] leading-relaxed text-foreground/80 whitespace-pre-wrap")}>
                  {wiring.upstreamScript ?? <span className="text-muted-foreground/60">{t("node.theScriptArrivesFromThe")}</span>}
                </div>
              ) : (
                <textarea
                  className={cn(
                    FIELD_SURFACE,
                    "nodrag nopan nowheel flex-1 min-h-0 w-full resize-none px-3 py-2 text-[12px] leading-relaxed text-foreground/85",
                    "placeholder:text-muted-foreground/50 outline-none focus:border-[#ff0073]/60 focus:bg-background/60 transition-colors",
                  )}
                  value={script}
                  maxLength={SCRIPT_MAX}
                  placeholder={t("cfgext.aiAvPhScript")}
                  aria-label={t("node.avatarScript")}
                  onChange={(e) => onUpdate({ script: e.target.value || undefined })}
                  onClick={stop}
                  onKeyDown={stop}
                />
              )}
            </div>
          </>
        ) : (
          <>
            <div className={cn("shrink-0 flex items-center gap-2.5 px-3 py-2 border-b", PANEL_EDGE)} data-testid="ai-avatar-audio-row">
              <span className="grid place-items-center w-7 h-7 rounded-md border border-border/60 bg-muted/40 text-muted-foreground shrink-0">
                <AudioLines className="size-3" />
              </span>
              <span className="flex flex-col min-w-0">
                <span className="text-[12px] text-foreground truncate leading-tight">{t("node.wiredAudio")}</span>
                <span className="text-[10.5px] text-muted-foreground truncate leading-tight">
                  {wiring.audio ? t("node.fromSource", { source: wiring.audioSourceLabel ?? t("node.theAudioInput") }) : t("node.nothingConnectedYet")}
                </span>
              </span>
            </div>
            <div className="flex-1 min-h-0 flex flex-col gap-2 px-3 pt-2.5 pb-3">
              <div className="flex items-center justify-between gap-2 shrink-0">
                <span className={KICKER}>{t("node.audioWired")}</span>
                <span className={META_MONO}>{t("node.maxTenMin")}</span>
              </div>
              <div className={cn(FIELD_SURFACE, "flex-1 min-h-0 px-3 py-2 text-[12px] leading-relaxed text-foreground/70")}>
                {wiring.audio
                  ? t("node.avatarLipSyncsToAudio")
                  : t("node.connectAudioNodeHint")}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
