import { useCallback, useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { Puzzle, X, Heart, Coins, Sparkles, FileText } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { APP_CATEGORIES, CATEGORY_COLORS, OUTPUT_TYPE_ICON } from "@/lib/app-categories"
import type { AppBrowseCard } from "@/lib/api"
import type { ComponentMetadata } from "@nodaro-shared/component-types"

interface ComponentPreviewModalProps {
  card: AppBrowseCard | null
  isFavorited: boolean
  onToggleFavorite: (appId: string) => void
  onAdd: (card: AppBrowseCard) => void
  onClose: () => void
}

const HEADING_ID = "component-preview-title"

export function ComponentPreviewModal({
  card,
  isFavorited,
  onToggleFavorite,
  onAdd,
  onClose,
}: ComponentPreviewModalProps) {
  const addBtnRef = useRef<HTMLButtonElement>(null)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    },
    [onClose],
  )

  useEffect(() => {
    if (!card) return
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [card, handleKeyDown])

  useEffect(() => {
    if (card) addBtnRef.current?.focus()
  }, [card])

  if (!card) return null

  const meta = (card.componentMetadata ?? {
    inputs: [],
    outputs: [],
    exposedSettings: [],
  }) as unknown as ComponentMetadata

  const inputs = meta.inputs ?? []
  const outputs = meta.outputs ?? []
  const settings = meta.exposedSettings ?? []
  const hasAnyMetadata = inputs.length + outputs.length + settings.length > 0

  const categoryLabel = APP_CATEGORIES.find((c) => c.value === card.category)?.label ?? "Other"
  const categoryColor = CATEGORY_COLORS[card.category] ?? CATEGORY_COLORS.other
  const creatorLabel = card.creatorDisplayName || "Community"

  return createPortal(
    <div
      className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={HEADING_ID}
        className="relative bg-card border border-border rounded-xl max-w-3xl w-full max-h-[85vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-border">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-md bg-purple-500/10 flex items-center justify-center shrink-0">
              {card.iconUrl ? (
                <img src={card.iconUrl} alt="" className="w-7 h-7 rounded-sm object-cover" />
              ) : (
                <Puzzle className="w-5 h-5 text-purple-400" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h2 id={HEADING_ID} className="text-lg font-semibold text-foreground truncate">
                {card.name}
              </h2>
              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                <span className="truncate">by {creatorLabel}</span>
                <span>·</span>
                <span className="flex items-center gap-0.5">
                  <Coins className="w-3 h-3" />
                  {card.estimatedCredits} CR
                </span>
                <span>·</span>
                <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", categoryColor)}>
                  {categoryLabel}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                className="p-2 rounded-full hover:bg-muted transition-colors"
                onClick={() => onToggleFavorite(card.id)}
                aria-label={isFavorited ? "Unfavorite" : "Favorite"}
              >
                <Heart
                  className={cn(
                    "w-4 h-4 transition-colors",
                    isFavorited ? "fill-[#ff0073] text-[#ff0073]" : "text-muted-foreground",
                  )}
                />
              </button>
              <button
                type="button"
                className="p-2 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                onClick={onClose}
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {card.description ? (
            <p className="text-sm text-muted-foreground mt-3 whitespace-pre-wrap">
              {card.description}
            </p>
          ) : (
            <p className="text-sm italic text-muted-foreground/70 mt-3">
              No description provided.
            </p>
          )}
        </div>

        {/* Body */}
        <div className="grid md:grid-cols-2 gap-6 p-5">
          {/* Left column: metadata lists */}
          <div className="order-2 md:order-1 space-y-4">
            {!hasAnyMetadata && (
              <p className="text-xs text-muted-foreground italic">
                No metadata published for this component.
              </p>
            )}

            {inputs.length > 0 && (
              <section>
                <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Inputs
                </h3>
                <ul className="space-y-1.5">
                  {inputs.map((h) => (
                    <li key={h.id} className="flex items-center gap-2 text-sm text-foreground">
                      <span className="text-muted-foreground shrink-0">
                        {OUTPUT_TYPE_ICON[h.type] ?? <FileText className="w-3 h-3" />}
                      </span>
                      <span className="truncate" title={h.name}>
                        {h.name}
                      </span>
                      {h.required && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium uppercase tracking-wide shrink-0">
                          Required
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {outputs.length > 0 && (
              <section>
                <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Outputs
                </h3>
                <ul className="space-y-1.5">
                  {outputs.map((h) => (
                    <li key={h.id} className="flex items-center gap-2 text-sm text-foreground">
                      <span className="text-muted-foreground shrink-0">
                        {OUTPUT_TYPE_ICON[h.type] ?? <FileText className="w-3 h-3" />}
                      </span>
                      <span className="truncate" title={h.name}>
                        {h.name}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {settings.length > 0 && (
              <section>
                <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Settings ({settings.length})
                </h3>
                <ul className="space-y-1.5">
                  {settings.map((s) => (
                    <li
                      key={`${s.nodeId}:${s.field}`}
                      className="text-sm text-foreground truncate"
                      title={s.label}
                    >
                      {s.label}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          {/* Right column: preview media */}
          <div className="order-1 md:order-2">
            <div className="aspect-video rounded-lg overflow-hidden bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-zinc-800 dark:to-zinc-900">
              {card.previewMediaUrl ? (
                card.previewMediaType === "video" ? (
                  <video
                    src={card.previewMediaUrl}
                    className="w-full h-full object-cover"
                    autoPlay
                    muted
                    loop
                    playsInline
                  />
                ) : (
                  <img
                    src={card.previewMediaUrl}
                    alt={card.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                )
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground/50">
                  <Sparkles className="w-8 h-8 mb-2" />
                  <p className="text-xs">No preview available</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end p-4 border-t border-border">
          <Button
            ref={addBtnRef}
            onClick={() => onAdd(card)}
            className="text-white hover:opacity-90"
            style={{ backgroundColor: "#ff0073" }}
          >
            + Add to Workflow
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
