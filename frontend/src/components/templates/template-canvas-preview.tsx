import { useCallback, useRef } from "react"
import { useReactFlow, useViewport } from "@xyflow/react"
import { ArrowLeft, ArrowRight, Loader2, Minus, Plus } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { CreditGate } from "@/components/ui/credit-cost"
import type { TemplateBrowseCard } from "@/lib/api"
import { useTemplateDetail } from "@/hooks/queries/use-template-marketplace-queries"
import { useT } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import { chromeInsets } from "./chrome-insets"
import { ReadOnlyCanvas } from "./read-only-canvas"
import { templateCreatorName } from "./template-facts"
import { TemplateCover } from "./template-marketplace-card"
import { TemplateResultsRail } from "./template-results-rail"
import { useCloneTemplate } from "./use-clone-template"

const PILL = "flex items-center gap-2 rounded-[10px] border border-[var(--home-line)] bg-[var(--home-panel)]"

/** "− 47% +": lives inside the canvas so it can reach the React Flow instance. */
function ZoomPill() {
  const t = useT()
  const { zoomIn, zoomOut } = useReactFlow()
  const { zoom } = useViewport()
  return (
    <div className={`${PILL} absolute end-[18px] top-[14px] z-10 gap-1 px-1.5 py-1 text-xs text-[var(--home-muted)]`}>
      <button type="button" aria-label={t("templates.zoomOut")} onClick={() => zoomOut()} className="grid size-6 place-items-center rounded-md hover:bg-[var(--home-raised)] hover:text-[var(--home-fg)]">
        <Minus className="size-3.5" aria-hidden />
      </button>
      <span className="min-w-[38px] text-center font-semibold text-[var(--home-strong)]">{Math.round(zoom * 100)}%</span>
      <button type="button" aria-label={t("templates.zoomIn")} onClick={() => zoomIn()} className="grid size-6 place-items-center rounded-md hover:bg-[var(--home-raised)] hover:text-[var(--home-fg)]">
        <Plus className="size-3.5" aria-hidden />
      </button>
    </div>
  )
}

interface TemplateCanvasPreviewProps {
  readonly slug: string | null
  readonly open: boolean
  readonly fallback: TemplateBrowseCard | null
  readonly onBack: () => void
}

/**
 * State 3 of the Templates page: the whole template on a full-screen,
 * read-only canvas — pan and zoom, nothing else — with the Clone panel in the
 * corner. Both "Clone workflow" and "Clone & customize" copy the template
 * into the caller's default project and open the copy in the editor.
 */
export function TemplateCanvasPreview({ slug, open, fallback, onBack }: TemplateCanvasPreviewProps) {
  const t = useT()
  const isRtl = useAppDir() === "rtl"
  const BackIcon = isRtl ? ArrowRight : ArrowLeft
  const ForwardIcon = isRtl ? ArrowLeft : ArrowRight
  const { data: detail, isLoading, isError } = useTemplateDetail(slug)
  // A template that is gone must not keep painting from the stale card.
  const summary = detail ?? (isError ? null : fallback)
  const { clone, isCloning } = useCloneTemplate()
  const startClone = () => summary && clone({ slug: summary.slug, name: summary.name })
  // The chrome floating over the canvas; the first frame leaves it the room it takes.
  const topBarRef = useRef<HTMLDivElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const fitInsets = useCallback(
    (canvas: DOMRect) =>
      chromeInsets(canvas, [topBarRef, railRef, panelRef].flatMap((ref) => (ref.current ? [ref.current.getBoundingClientRect()] : []))),
    [],
  )

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onBack()}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-[var(--home-bg)]"
        className="templates-page templates-dots @container fixed inset-0 top-0 start-0 block h-full w-full max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 bg-[var(--home-bg)] p-0 text-[var(--home-fg)] shadow-none [--templates-dot-gap:20px] sm:max-w-none"
      >
        <DialogTitle className="sr-only">{summary?.name ?? t("templates.title")}</DialogTitle>
        <DialogDescription className="sr-only">{t("templates.readOnly")}</DialogDescription>

        {detail ? (
          <ReadOnlyCanvas key={detail.id} nodes={detail.snapshotNodes} edges={detail.snapshotEdges} interactive fitInsets={fitInsets} className="absolute inset-0">
            <ZoomPill />
          </ReadOnlyCanvas>
        ) : (
          <div className="absolute inset-0 grid place-items-center text-[13px] text-[var(--home-muted)]">
            {isError ? t("templates.notFound") : isLoading ? t("templates.loadingCanvas") : null}
          </div>
        )}

        {/* Top bar: back pill at the start, the read-only pill centred; the zoom
            pill is the canvas's own, on the end side, so a column is kept free. */}
        <div ref={topBarRef} className="pointer-events-none absolute inset-x-0 top-0 z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-[18px] py-[14px] pe-[140px]">
          <button
            type="button"
            onClick={onBack}
            className={`${PILL} pointer-events-auto min-w-0 max-w-full justify-self-start px-3.5 py-2 text-[13px] font-semibold text-[var(--home-strong)] transition-colors hover:bg-[var(--home-raised)]`}
          >
            <BackIcon className="size-4 flex-none" aria-hidden />
            <span className="truncate">{summary?.name ?? t("templates.backToTemplates")}</span>
          </button>
          <div className={`${PILL} pointer-events-auto gap-3 py-1.5 pe-1.5 ps-3.5 text-[13px] text-[var(--home-fg-2)]`}>
            <span className="whitespace-nowrap">
              {t("templates.readOnly")}
              <span className="text-[var(--home-muted)]"> · {t("templates.inspector.hint")}</span>
            </span>
            <button
              type="button"
              onClick={startClone}
              disabled={!summary || isCloning}
              className="whitespace-nowrap rounded-[7px] bg-[var(--primary)] px-3 py-[7px] text-xs font-bold text-white transition-colors hover:bg-[var(--home-accent-hover)] disabled:opacity-60"
            >
              {t("templates.cloneWorkflow")}
            </button>
          </div>
        </div>

        {/* The results, playable with sound — the canvas behind is inert by design. */}
        {detail && (
          <div ref={railRef} className="absolute bottom-[18px] start-[18px] z-10 max-w-[min(760px,calc(100%-400px))] @max-[900px]:hidden">
            <TemplateResultsRail snapshotNodes={detail.snapshotNodes} />
          </div>
        )}

        {/* Clone panel */}
        {summary && (
          <div ref={panelRef} className="templates-clone-panel absolute bottom-[18px] end-[18px] z-10 w-[340px] @max-[900px]:inset-x-[18px] @max-[900px]:w-auto">
            <div className="relative overflow-hidden rounded-[17px] bg-[var(--home-panel)] p-[18px]">
              <div className="templates-clone-glow" aria-hidden />
              <div className="relative flex items-center justify-between">
                <span className="text-[9px] font-bold uppercase tracking-[1.4px] text-[var(--primary)]">{t("templates.templateEyebrow")}</span>
                <span className="text-[10px] text-[var(--home-muted)]">{t("preview.by", { name: templateCreatorName() })}</span>
              </div>
              <div className="relative mt-1.5 text-[22px] font-extrabold leading-[1.15] tracking-[-0.4px] text-[var(--home-strong)]">{summary.name}</div>
              <TemplateCover template={summary} className="relative mt-3 aspect-video border border-[var(--home-line-2)]" />
              {summary.description && (
                <p className="relative mt-2.5 text-xs leading-relaxed text-[var(--home-fg-2)] [text-wrap:pretty]">{summary.description}</p>
              )}
              <button
                type="button"
                onClick={startClone}
                disabled={isCloning}
                className="templates-clone-cta relative mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl px-4 py-[13px] text-sm font-bold text-white disabled:opacity-70"
              >
                {isCloning ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {t("templates.cloneAndCustomize")}
                {!isCloning && <ForwardIcon className="size-4" aria-hidden />}
              </button>
              <p className="relative mt-2.5 text-center text-[11px] text-[var(--home-muted)]">
                {t("templates.cloneHelper")}
                <CreditGate>
                  <span> {t("templates.cloneHelperCredits")}</span>
                </CreditGate>
              </p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
