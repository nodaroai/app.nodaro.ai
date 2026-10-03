import { MoreVertical, Share2, Pencil, EyeOff } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { GlassButton, type MediaType } from "./shared"
import { CAN_NATIVE_SHARE } from "./share-utils"
import { useT } from "@/lib/i18n"

interface ActionMenuProps {
  mediaType: MediaType
  onShare?: () => void
  onEdit?: () => void
  onHide?: () => void
}

export function ActionMenu({ mediaType, onShare, onEdit, onHide }: ActionMenuProps) {
  const t = useT()
  const canEdit = mediaType !== "text"
  const shareLabel = CAN_NATIVE_SHARE ? t("common.share") : t("present.copyLink")

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <GlassButton title={t("present.moreActions")}>
          <MoreVertical className="w-3.5 h-3.5" />
        </GlassButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[140px]">
        {onShare && (
          <DropdownMenuItem onClick={onShare}>
            <Share2 className="w-4 h-4 me-2" />
            {shareLabel}
          </DropdownMenuItem>
        )}
        {canEdit && onEdit && (
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="w-4 h-4 me-2" />
            {t("common.edit")}
          </DropdownMenuItem>
        )}
        {(onShare || (canEdit && onEdit)) && onHide && <DropdownMenuSeparator />}
        {onHide && (
          <DropdownMenuItem onClick={onHide}>
            <EyeOff className="w-4 h-4 me-2" />
            {t("common.hide")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
