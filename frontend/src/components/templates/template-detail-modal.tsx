import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, ArrowRight, Heart } from "lucide-react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { RowArrows } from "@/components/dashboard/home/home-section"
import { useRowScroller } from "@/components/dashboard/home/home-ui"
import { browseTemplates, type TemplateBrowseCard } from "@/lib/api"
import { useTemplateDetail } from "@/hooks/queries/use-template-marketplace-queries"
import { useT } from "@/lib/i18n"
import { useLocalizeNodeLabel } from "@/lib/i18n/labels"
import { useAppDir } from "@/lib/locale-store"
import { cn } from "@/lib/utils"
import { ReadMoreText } from "./read-more-text"
import { ReadOnlyCanvas } from "./read-only-canvas"
import { TemplateResultsRail } from "./template-results-rail"
import { flowSteps, modelChipLabels, relatedTemplates, templateBadge, templateCreatorName } from "./template-facts"
import { TemplateBadgePill, TemplateCover, TemplateMeta } from "./template-marketplace-card"

/** The flow strip's chip colours, cycled in canvas order. */
export const FLOW_STEP_COLORS = ["#22d3ee", "#6c5cff", "#ff2a7f", "#f5a524", "#00c2b8"] as const

const RELATED_MAX = 6

/** What the header can paint before the full detail (with its snapshot) arrives. */
export type TemplateSummary = Pick<
  TemplateBrowseCard,
  | "id"
  | "slug"
  | "name"
  | "description"
  | "creatorDisplayName"
  | "createdAt"
  | "cloneCount"
  | "estimatedCredits"
  | "nodeCount"
  | "complexity"
  | "providersUsed"
  | "outputTypes"
  | "category"
  | "previewMediaUrl"
  | "previewMediaType"
>

interface TemplateDetailModalProps {
  readonly slug: string | null
  readonly open: boolean
  /** The browse card when the grid has it — paints the header before the detail loads. */
  readonly fallback: TemplateBrowseCard | null
  readonly now: number
  readonly favoriteIds: readonly string[]
  /** Absent when nobody is signed in — favorites need an account. */
  readonly onToggleFavorite?: (templateId: string) => void
  readonly onClose: () => void
  readonly onPreviewCanvas: () => void
  readonly onOpenTemplate: (slug: string) => void
}

const HEADING = "text-sm font-bold text-[var(--home-strong)]"
const CHIP = "rounded-full bg-[var(--home-raised)] px-2.5 py-[3px] text-[11px] font-semibold text-[var(--home-fg-2)]"
const MARKDOWN_COMPONENTS: React.ComponentProps<typeof Markdown>["components"] = {
  a: ({ href, children, ...props }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--primary)] hover:underline" {...props}>
      {children}
    </a>
  ),
}

/**
 * State 2 of the Templates page, kept to one screen: the flow in a box of its
 * own with nothing drawn over it, then the title, the description (the
 * author's write-up when there is one, folded to three lines with "Read
 * more"), the model chips, the flow strip and templates like it. No figures —
 * Asaf cut credits / nodes / complexity and kept the models. Cloning happens
 * from the canvas preview, so the one action here is "Preview on canvas".
 *
 * It renders from `useTemplateDetail(slug)`, not from the browse card: a
 * pasted `?template=` link must work when the card is not on the loaded page.
 */
export function TemplateDetailModal({
  slug,
  open,
  fallback,
  now,
  favoriteIds,
  onToggleFavorite,
  onClose,
  onPreviewCanvas,
  onOpenTemplate,
}: TemplateDetailModalProps) {
  const t = useT()
  const isRtl = useAppDir() === "rtl"
  const BackIcon = isRtl ? ArrowRight : ArrowLeft
  const ForwardIcon = isRtl ? ArrowLeft : ArrowRight
  const { data: detail, isLoading, isError } = useTemplateDetail(slug)
  // A template that is gone must not keep painting from the stale card.
  const summary: TemplateSummary | null = detail ?? (isError ? null : fallback)
  const isFavorited = summary !== null && favoriteIds.includes(summary.id)
  const localizeLabel = useLocalizeNodeLabel()
  const steps = useMemo(
    () => flowSteps(detail?.snapshotNodes ?? []).map((step) => ({ ...step, label: localizeLabel(step.label) })),
    [detail, localizeLabel],
  )

  const { data: relatedPage } = useQuery({
    queryKey: ["templates-related", summary?.category ?? ""],
    queryFn: () => browseTemplates({ category: summary?.category, sort: "popular", limit: RELATED_MAX + 1 }),
    enabled: open && !!summary?.category,
    staleTime: 60_000,
  })
  const related = summary ? relatedTemplates(relatedPage?.data ?? [], summary.id, RELATED_MAX) : []
  const relatedScroller = useRowScroller(related.length)

  const badge = summary ? templateBadge(summary, now) : null
  const models = summary ? modelChipLabels(summary.providersUsed, 8) : []

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-[var(--home-scrim)] backdrop-blur-[6px]"
        className="templates-page block max-h-[calc(100vh-56px)] w-[min(920px,calc(100vw-40px))] max-w-none gap-0 overflow-y-auto rounded-[22px] border-[var(--home-line)] bg-[var(--home-panel)] p-0 text-[var(--home-fg)] shadow-[0_30px_80px_rgba(0,0,0,0.45)] [scrollbar-width:thin] sm:max-w-none"
      >
        {/* Top row: back on the start side; creator, badge and heart on the end */}
        <div className="flex items-center justify-between gap-3 px-4 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-full border border-[var(--home-line)] bg-[var(--home-panel)] px-3 py-1.5 text-xs font-semibold text-[var(--home-fg-2)] transition-colors hover:text-[var(--home-strong)]"
          >
            <BackIcon className="size-3.5" aria-hidden />
            {t("templates.backToTemplates")}
          </button>
          {summary && (
            <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-[var(--home-muted)]">
              <span className="inline-block size-4 rounded-full bg-[var(--primary)]" aria-hidden />
              <span>{t("preview.by", { name: templateCreatorName() })}</span>
              {badge && <TemplateBadgePill badge={badge} />}
              {onToggleFavorite && (
                <button
                  type="button"
                  aria-pressed={isFavorited}
                  aria-label={isFavorited ? t("templates.unfavorite") : t("templates.favorite")}
                  onClick={() => onToggleFavorite(summary.id)}
                  className="grid size-6 place-items-center rounded-full border border-[var(--home-line-2)] bg-[var(--home-raised)] transition-colors hover:border-[var(--home-muted)]"
                >
                  <Heart className={cn("size-3", isFavorited ? "fill-[var(--primary)] text-[var(--primary)]" : "text-[var(--home-fg-2)]")} aria-hidden />
                </button>
              )}
            </div>
          )}
        </div>

        {/* The flow, in a box of its own: nothing is ever drawn over it */}
        <div
          className="templates-dots relative mx-4 mt-3 h-[clamp(220px,32vh,320px)] overflow-hidden rounded-[14px] border border-[var(--home-line-2)] bg-[var(--home-card)] [--templates-dot-gap:16px]"
          aria-busy={isLoading}
        >
          {detail && (
            <ReadOnlyCanvas
              key={detail.id}
              nodes={detail.snapshotNodes}
              edges={detail.snapshotEdges}
              interactive={false}
              className="absolute inset-0"
            />
          )}
        </div>
        {detail && <TemplateResultsRail snapshotNodes={detail.snapshotNodes} className="mx-4 mt-3" />}

        {/* Title, description, the one action, and a line of facts */}
        <div className="px-7 pt-5">
          {summary ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                <div className="min-w-0 max-w-[600px]">
                  <DialogTitle className="text-[26px] font-extrabold leading-[1.15] tracking-[-0.5px] text-[var(--home-strong)] [text-wrap:pretty]">
                    <span dir="auto">{summary.name}</span>
                  </DialogTitle>
                  <DialogDescription className="sr-only">{summary.description ?? summary.name}</DialogDescription>
                  {(detail?.markdownDescription || summary.description) && (
                    <ReadMoreText textKey={summary.id} className="mt-1.5">
                      {detail?.markdownDescription ? (
                        <div dir="auto" className="prose prose-sm max-w-none text-[var(--home-fg-2)] dark:prose-invert [&_p+p]:mt-2.5">
                          <Markdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                            {detail.markdownDescription}
                          </Markdown>
                        </div>
                      ) : (
                        <p dir="auto" className="text-sm leading-6 text-[var(--home-fg-2)] [text-wrap:pretty]">{summary.description}</p>
                      )}
                    </ReadMoreText>
                  )}
                  {models.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {models.map((model) => (
                        <span key={model} className={CHIP}>
                          {model}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onPreviewCanvas}
                  className="templates-preview-cta flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--primary)] px-[22px] py-3 text-sm font-bold text-white transition-colors hover:bg-[var(--home-accent-hover)]"
                >
                  {t("templates.previewOnCanvas")}
                  <ForwardIcon className="size-4" aria-hidden />
                </button>
              </div>
            </>
          ) : (
            <div aria-busy={isLoading}>
              <DialogTitle className="text-[26px] font-extrabold leading-[1.15] text-[var(--home-strong)]">
                {isError ? t("templates.notFound") : <span className="sr-only">{t("templates.loadingCanvas")}</span>}
              </DialogTitle>
              <DialogDescription className="sr-only">{t("templates.title")}</DialogDescription>
              {isLoading && (
                <div className="animate-pulse space-y-3" aria-hidden>
                  <div className="h-7 w-2/3 rounded bg-[var(--home-raised)]" />
                  <div className="h-4 w-1/2 rounded bg-[var(--home-raised)]" />
                </div>
              )}
            </div>
          )}
        </div>

        {summary && (
          <div className="flex flex-col gap-5 px-7 pb-6 pt-4">
            {/* Flow strip */}
            {steps.length > 0 && (
              <div className="home-row-scroll flex items-center overflow-x-auto py-1" aria-label={t("templates.howItWorks")}>
                {steps.map((step, index) => (
                  <div key={step.type} className="flex flex-none items-center">
                    <div className="flex items-center gap-2 whitespace-nowrap rounded-[10px] border border-[var(--home-line)] bg-[var(--home-card)] px-3 py-2 text-xs font-semibold text-[var(--home-strong)]">
                      <span
                        className="inline-block size-2 rounded-[2px]"
                        style={{ background: FLOW_STEP_COLORS[index % FLOW_STEP_COLORS.length] }}
                        aria-hidden
                      />
                      {step.label}
                      {step.count > 1 && <span className="text-[var(--home-muted)]">{t("templates.stepCount", { n: step.count })}</span>}
                    </div>
                    {index < steps.length - 1 && (
                      <div className="relative h-px w-[34px] bg-[var(--home-line)]" aria-hidden>
                        <span className="absolute -top-1 end-[-2px] text-[11px] text-[var(--home-dim)]">{isRtl ? "‹" : "›"}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* More like this */}
            {related.length > 0 && (
              <div>
                <div className="flex items-baseline justify-between">
                  <h3 className={HEADING}>{t("templates.moreLikeThis")}</h3>
                  <RowArrows scroller={relatedScroller} />
                </div>
                <div ref={relatedScroller.rowRef} className="home-row-scroll mt-3 flex gap-2.5 overflow-x-auto pb-1">
                  {related.map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => onOpenTemplate(card.slug)}
                      className="w-[170px] flex-none rounded-xl border border-[var(--home-line-2)] bg-[var(--home-card)] p-1.5 text-start transition-colors hover:border-[var(--home-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                    >
                      <TemplateCover template={card} className="rounded-lg" />
                      <div className="truncate px-1 pt-2 text-xs font-semibold text-[var(--home-strong)]"><span dir="auto">{card.name}</span></div>
                      <TemplateMeta template={card} className="px-1 pb-1 pt-0.5" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
