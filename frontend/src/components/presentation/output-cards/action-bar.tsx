import type { ComponentType } from "react"
import { Share2, Pencil, Download, Link, EyeOff } from "lucide-react"
import { copyUrl, downloadFile, type MediaType } from "./shared"
import { CAN_NATIVE_SHARE } from "./share-utils"
import { useT } from "@/lib/i18n"

interface ActionBarProps {
  mediaType: MediaType
  url?: string
  label: string
  onShare?: () => void
  onEdit?: () => void
  onHide?: () => void
}

function ActionBarButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="flex flex-col items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
    >
      <div className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center">
        <Icon className="w-4 h-4" />
      </div>
      <span className="text-[10px]">{label}</span>
    </button>
  )
}

export function ActionBar({ mediaType, url, label, onShare, onEdit, onHide }: ActionBarProps) {
  const t = useT()
  const canEdit = mediaType !== "text"
  const hasMedia = mediaType !== "text" && !!url

  const ext = mediaType === "image" ? "png" : mediaType === "video" ? "mp4" : "mp3"
  const filename = `${label.replace(/\s+/g, "-").toLowerCase()}.${ext}`
  const shareLabel = CAN_NATIVE_SHARE ? t("common.share") : t("present.copyLink")

  return (
    <div className="flex md:hidden justify-around py-2 px-2 border-t border-border/30 bg-muted/20 rounded-b-xl">
      {onShare && <ActionBarButton icon={Share2} label={shareLabel} onClick={onShare} />}
      {canEdit && onEdit && <ActionBarButton icon={Pencil} label={t("common.edit")} onClick={onEdit} />}
      {hasMedia && (
        <ActionBarButton icon={Download} label={t("common.download")} onClick={() => downloadFile(url!, filename)} />
      )}
      {hasMedia && <ActionBarButton icon={Link} label={t("present.copyLink")} onClick={() => copyUrl(url!)} />}
      {onHide && <ActionBarButton icon={EyeOff} label={t("common.hide")} onClick={onHide} />}
    </div>
  )
}
