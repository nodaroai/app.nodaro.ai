import { useState } from "react"
import { ChevronDown, ChevronRight, Trash2, Plus, Eye, EyeOff, Square, RectangleHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"

interface GroupCardProps {
  title: string
  children: React.ReactNode
  isEditing?: boolean
  showTitle?: boolean
  showBackground?: boolean
  onTitleChange?: (title: string) => void
  onShowTitleChange?: (show: boolean) => void
  onShowBackgroundChange?: (show: boolean) => void
  onDelete?: () => void
  onAddRichtext?: () => void
}

export function GroupCard({
  title,
  children,
  isEditing,
  showTitle = true,
  showBackground = true,
  onTitleChange,
  onShowTitleChange,
  onShowBackgroundChange,
  onDelete,
  onAddRichtext,
}: GroupCardProps) {
  const [collapsed, setCollapsed] = useState(false)

  // No title, no background → just render children directly
  if (!showTitle && !showBackground && !isEditing) {
    return <div className="space-y-3">{children}</div>
  }

  // No title but has background → card with no header
  if (!showTitle && !isEditing) {
    return (
      <div className={cn(
        "rounded-xl overflow-hidden",
        showBackground && "border border-border bg-card",
      )}>
        <div className={cn(showBackground ? "p-3 space-y-3" : "space-y-3")}>
          {children}
        </div>
      </div>
    )
  }

  return (
    <div className={cn(
      "rounded-xl overflow-hidden",
      showBackground && "border border-border bg-card",
    )}>
      {/* Header */}
      {showTitle && (
        <div
          className={cn(
            "flex items-center gap-2 px-3 py-2",
            showBackground && "border-b border-purple-500/20 bg-purple-500/5",
            !isEditing && "cursor-pointer select-none",
          )}
          onClick={isEditing ? undefined : () => setCollapsed((c) => !c)}
          role={isEditing ? undefined : "button"}
          tabIndex={isEditing ? undefined : 0}
          onKeyDown={
            isEditing
              ? undefined
              : (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    setCollapsed((c) => !c)
                  }
                }
          }
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setCollapsed((c) => !c)
            }}
            className="shrink-0 text-purple-400 hover:text-purple-300 transition-colors"
            aria-label={collapsed ? "Expand group" : "Collapse group"}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>

          {isEditing ? (
            <input
              type="text"
              value={title}
              onChange={(e) => onTitleChange?.(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 min-w-0 bg-transparent border-none text-sm font-medium text-purple-300 placeholder:text-purple-400/40 focus:outline-none focus:ring-0"
              placeholder="Group title..."
            />
          ) : (
            <span className="flex-1 min-w-0 text-sm font-medium text-purple-300 truncate">
              {title}
            </span>
          )}

          {isEditing && (
            <div className="flex items-center gap-1 shrink-0">
              {onAddRichtext && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onAddRichtext()
                  }}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors"
                  title="Add rich text block"
                >
                  <Plus className="h-3 w-3" />
                  Text
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete()
                  }}
                  className="flex items-center justify-center w-6 h-6 text-muted-foreground/50 hover:text-red-400 rounded-md hover:bg-red-500/10 transition-colors"
                  title="Remove group"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Edit controls for hidden title — show inline toggle bar */}
      {isEditing && !showTitle && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-muted-foreground border-b border-border/30">
          <span className="text-purple-400 truncate flex-1">{title || "Untitled group"}</span>
          {onAddRichtext && (
            <button
              type="button"
              onClick={onAddRichtext}
              className="flex items-center gap-1 px-2 py-0.5 hover:text-foreground rounded hover:bg-muted transition-colors"
              title="Add rich text"
            >
              <Plus className="h-3 w-3" />Text
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="flex items-center justify-center w-5 h-5 hover:text-red-400 rounded hover:bg-red-500/10 transition-colors"
              title="Remove group"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      {/* Display toggles — edit mode only */}
      {isEditing && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/20">
          <button
            type="button"
            onClick={() => onShowTitleChange?.(!showTitle)}
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded text-[11px] transition-colors",
              showTitle ? "text-purple-400 bg-purple-500/10" : "text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted",
            )}
            title={showTitle ? "Hide title" : "Show title"}
          >
            {showTitle ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            Title
          </button>
          <button
            type="button"
            onClick={() => onShowBackgroundChange?.(!showBackground)}
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded text-[11px] transition-colors",
              showBackground ? "text-purple-400 bg-purple-500/10" : "text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted",
            )}
            title={showBackground ? "Hide background" : "Show background"}
          >
            {showBackground ? <RectangleHorizontal className="h-3 w-3" /> : <Square className="h-3 w-3" />}
            Background
          </button>
        </div>
      )}

      {/* Body */}
      {!collapsed && (
        <div className={cn(showBackground ? "p-3 space-y-3" : "space-y-3")}>
          {children}
        </div>
      )}
    </div>
  )
}
