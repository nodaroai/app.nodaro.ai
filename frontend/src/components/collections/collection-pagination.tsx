import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import { cn } from "@/lib/utils"

export const PAGE_SIZES = [6, 12, 24] as const
export type PageSize = (typeof PAGE_SIZES)[number]
export const DEFAULT_PAGE_SIZE: PageSize = 6

/**
 * The page numbers to offer: the first and the last, the current one and its
 * neighbours, with a gap where numbers are skipped — a list of thousands of
 * pages never renders thousands of buttons.
 */
export function pageWindow(page: number, pageCount: number): Array<number | "gap"> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1)
  const wanted = new Set([1, 2, pageCount - 1, pageCount, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pageCount))
  const sorted = [...wanted].sort((a, b) => a - b)
  const out: Array<number | "gap"> = []
  for (const n of sorted) {
    const prev = out[out.length - 1]
    if (typeof prev === "number" && n - prev > 1) out.push("gap")
    out.push(n)
  }
  return out
}

/** Per-page sizes, Prev / numbers / Next, and "Page x of y" — the footer of a records list. */
export function CollectionPagination({
  page,
  pageCount,
  pageSize,
  onPage,
  onPageSize,
  disabled,
}: {
  readonly page: number
  readonly pageCount: number
  readonly pageSize: PageSize
  readonly onPage: (page: number) => void
  readonly onPageSize: (size: PageSize) => void
  readonly disabled?: boolean
}) {
  const t = useT()
  const isRtl = useAppDir() === "rtl"
  const numberClass = "h-8 min-w-[34px] px-0 text-[13px] font-semibold"
  return (
    <nav className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-[13px]" aria-label={t("collections.pageOf", { page, pages: pageCount })}>
      <div className="flex items-center gap-2 text-muted-foreground">
        <span>{t("collections.perPage")}</span>
        {PAGE_SIZES.map((size) => (
          <Button
            key={size}
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={size === pageSize}
            className={cn("h-8 min-w-[36px] px-2.5 text-[13px]", size === pageSize ? "bg-muted text-foreground" : "bg-transparent text-muted-foreground")}
            onClick={() => onPageSize(size)}
            disabled={disabled}
          >
            {size}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <Button type="button" variant="outline" size="sm" className="h-8 text-[13px]" onClick={() => onPage(page - 1)} disabled={disabled || page <= 1}>
          <ChevronLeft className={cn("me-1 h-3.5 w-3.5", isRtl && "rotate-180")} />
          {t("collections.prevPage")}
        </Button>
        {pageWindow(page, pageCount).map((item, i) =>
          item === "gap" ? (
            <span key={`gap-${i}`} className="px-1 text-muted-foreground">
              …
            </span>
          ) : (
            <Button
              key={item}
              type="button"
              variant={item === page ? "default" : "outline"}
              size="sm"
              aria-label={t("collections.goToPage", { n: item })}
              aria-current={item === page ? "page" : undefined}
              className={cn(numberClass, item === page && "bg-[#c8237f] text-white hover:bg-[#e02d91]")}
              onClick={() => onPage(item)}
              disabled={disabled}
            >
              {item}
            </Button>
          ),
        )}
        <Button type="button" variant="outline" size="sm" className="h-8 text-[13px]" onClick={() => onPage(page + 1)} disabled={disabled || page >= pageCount}>
          {t("collections.nextPage")}
          <ChevronRight className={cn("ms-1 h-3.5 w-3.5", isRtl && "rotate-180")} />
        </Button>
      </div>
      <span className="text-muted-foreground">{t("collections.pageOf", { page, pages: pageCount })}</span>
    </nav>
  )
}
