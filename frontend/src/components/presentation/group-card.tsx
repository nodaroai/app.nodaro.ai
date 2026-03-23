import { useState } from "react"
import { ChevronDown, ChevronRight, Trash2, Plus } from "lucide-react"
import { cn } from "@/lib/utils"

interface GroupCardProps {
  title: string
  children: React.ReactNode
  isEditing?: boolean
  onTitleChange?: (title: string) => void
  onDelete?: () => void
  onAddRichtext?: () => void
}

export function GroupCard({
  title,
  children,
  isEditing,
  onTitleChange,
  onDelete,
  onAddRichtext,
}: GroupCardProps) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2 border-b border-purple-500/20 bg-purple-500/5",
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

      {/* Body */}
      {!collapsed && (
        <div className="p-3 space-y-3">
          {children}
        </div>
      )}
    </div>
  )
}
