import { unitQuoteCreditId } from "@nodaro/shared/credits"
import { COMPETITOR_SCAN_PAGE_CREDIT_ID, SCAN_PAGE_CREDIT_COSTS, TOPIC_SCAN_PAGE_CREDIT_ID } from "@nodaro/shared/social"
import { useModelCredits } from "@/hooks/use-model-credit-cost"

/** The per-page rates a scan is charged at: a brand's and a topic's. */
export type ScanPageRateId = typeof COMPETITOR_SCAN_PAGE_CREDIT_ID | typeof TOPIC_SCAN_PAGE_CREDIT_ID

/** The base price of a scan of this many pages, before the live price table loads. */
export function scanPagesBaseCredits(rateId: ScanPageRateId, pages: number): number {
  return pages <= 0 ? 0 : Math.round(pages) * (SCAN_PAGE_CREDIT_COSTS[rateId] ?? 0)
}

/**
 * The price of a scan of this many Social Search pages at `rateId`: the
 * server's price of the whole scan (`<rate>:<pages>u`), the base price of a
 * page × pages until it loads. Nothing to scan costs nothing.
 */
export function useScanPagesPrice(rateId: ScanPageRateId, pages: number): number {
  return useModelCredits(pages > 0 ? unitQuoteCreditId(rateId, pages) : undefined, scanPagesBaseCredits(rateId, pages))
}
