import { Heart } from "lucide-react"
import { CreditCost, CreditGate } from "@/components/ui/credit-cost"
import { PreviewVideo } from "@/components/ui/preview-video"
import { CachedImage } from "@/components/ui/cached-image"
import { creditUnitLabel } from "@/lib/credit-units"
import { cn } from "@/lib/utils"
import type { TemplateBrowseCard } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { modelChipLabels, templateBadge, type TemplateBadge } from "./template-facts"

/** The pill a template wears when it is new or often cloned. */
export function TemplateBadgePill({ badge, className }: { readonly badge: TemplateBadge; readonly className?: string }) {
  const t = useT()
  return (
    <span
      className={cn(
        "flex-none rounded-full border border-[var(--home-line-2)] bg-[var(--home-raised)] px-2 py-[3px] text-[10px] font-semibold text-[var(--primary)]",
        className,
      )}
    >
      {badge === "new" ? t("templates.badgeNew") : t("templates.badgePopular")}
    </span>
  )
}

/** "~120 credits · 7 nodes" — the credit half renders only on editions with credits. */
export function TemplateMeta({
  template,
  className,
}: {
  readonly template: Pick<TemplateBrowseCard, "estimatedCredits" | "estimatedPerMinuteCredits" | "nodeCount">
  readonly className?: string
}) {
  const t = useT()
  return (
    <span className={cn("flex items-center gap-1 text-[10px] text-[var(--home-muted)]", className)}>
      <CreditGate>
        <CreditCost credits={template.estimatedCredits} perMinute={template.estimatedPerMinuteCredits} prefix="~" suffix={creditUnitLabel(t("credits.unit.other"))} />
        <span aria-hidden>·</span>
      </CreditGate>
      <span>{t("templates.nodes", { n: template.nodeCount })}</span>
    </span>
  )
}

/**
 * The template's media, or the design's stripes when it has none. 4:3 by
 * default (the detail's related row); the browse card and the Clone panel
 * pass `aspect-video`.
 */
export function TemplateCover({
  template,
  className,
  children,
}: {
  readonly template: Pick<TemplateBrowseCard, "name" | "previewMediaUrl" | "previewMediaType">
  readonly className?: string
  readonly children?: React.ReactNode
}) {
  return (
    <div className={cn("home-stripes relative aspect-[4/3] overflow-hidden rounded-[10px]", className)}>
      {template.previewMediaUrl &&
        (template.previewMediaType === "video" ? (
          <PreviewVideo src={template.previewMediaUrl} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <CachedImage
            src={template.previewMediaUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
            thumbnail
          />
        ))}
      {children}
    </div>
  )
}

interface TemplateMarketplaceCardProps {
  readonly template: TemplateBrowseCard
  readonly isFavorited: boolean
  readonly onToggleFavorite: (templateId: string) => void
  readonly onOpen: (template: TemplateBrowseCard) => void
  /** The moment "new" is measured against; fixed per visit by the page. */
  readonly now: number
}

/**
 * A browse card: 16:9 preview with model chips, name, meta, badge — the
 * reference card is 285×205 at six a row. The whole card opens the template
 * (a stretched button under the name, so the accessible name is the
 * template's); the heart sits above it.
 */
export function TemplateMarketplaceCard({ template, isFavorited, onToggleFavorite, onOpen, now }: TemplateMarketplaceCardProps) {
  const t = useT()
  const chips = modelChipLabels(template.providersUsed)
  const badge = templateBadge(template, now)

  return (
    <article className="group relative rounded-[14px] border border-[var(--home-line-2)] bg-[var(--home-card)] p-2 transition-colors hover:border-[var(--home-muted)] focus-within:border-[var(--home-muted)]">
      <TemplateCover template={template} className="aspect-video">
        {chips.length > 0 && (
          <span className="absolute end-2 top-2 flex gap-1">
            {chips.map((chip) => (
              <span
                key={chip}
                className="rounded-full border border-[var(--home-line-2)] bg-[var(--home-panel)] px-[7px] py-0.5 text-[9px] font-semibold text-[var(--home-fg-2)]"
              >
                {chip}
              </span>
            ))}
          </span>
        )}
      </TemplateCover>

      <div className="flex items-center justify-between gap-2 px-1 pt-2.5 pb-1">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => onOpen(template)}
            className="block w-full truncate text-start text-[13px] font-semibold text-[var(--home-strong)] after:absolute after:inset-0 after:rounded-[14px] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-[var(--primary)]"
          >
            {template.name}
          </button>
          <TemplateMeta template={template} className="mt-[3px]" />
        </div>
        {badge && <TemplateBadgePill badge={badge} />}
      </div>

      <button
        type="button"
        aria-label={isFavorited ? t("templates.unfavorite") : t("templates.favorite")}
        aria-pressed={isFavorited}
        onClick={() => onToggleFavorite(template.id)}
        // `.templates-fav` (globals.css): always visible where there is no
        // hover — a touch screen would otherwise tap an invisible button —
        // and hover/focus-revealed where there is.
        className="templates-fav absolute start-4 top-4 z-10 grid size-7 place-items-center rounded-full bg-black/45 text-white transition-opacity hover:bg-black/65 focus-visible:outline-none"
      >
        <Heart className={cn("size-3.5", isFavorited && "fill-[var(--primary)] text-[var(--primary)]")} aria-hidden />
      </button>
    </article>
  )
}

/** Skeleton card for loading state */
export function TemplateMarketplaceCardSkeleton() {
  return (
    <div className="animate-pulse rounded-[14px] border border-[var(--home-line-2)] bg-[var(--home-card)] p-2" aria-hidden>
      <div className="aspect-video rounded-[10px] bg-[var(--home-raised)]" />
      <div className="space-y-2 px-1 pt-2.5 pb-1">
        <div className="h-3.5 w-3/4 rounded bg-[var(--home-raised)]" />
        <div className="h-2.5 w-1/2 rounded bg-[var(--home-raised)]" />
      </div>
    </div>
  )
}
