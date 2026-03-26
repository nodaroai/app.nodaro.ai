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

interface ActionMenuProps {
  mediaType: MediaType
  onShare?: () => void
  onEdit?: () => void
  onHide?: () => void
}

export function ActionMenu({ mediaType, onShare, onEdit, onHide }: ActionMenuProps) {
  const canEdit = mediaType !== "text"
  const shareLabel = CAN_NATIVE_SHARE ? "Share" : "Copy Link"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <GlassButton title="More actions">
          <MoreVertical className="w-3.5 h-3.5" />
        </GlassButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[140px]">
        {onShare && (
          <DropdownMenuItem onClick={onShare}>
            <Share2 className="w-4 h-4 mr-2" />
            {shareLabel}
          </DropdownMenuItem>
        )}
        {canEdit && onEdit && (
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="w-4 h-4 mr-2" />
            Edit
          </DropdownMenuItem>
        )}
        {(onShare || (canEdit && onEdit)) && onHide && <DropdownMenuSeparator />}
        {onHide && (
          <DropdownMenuItem onClick={onHide}>
            <EyeOff className="w-4 h-4 mr-2" />
            Hide
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
