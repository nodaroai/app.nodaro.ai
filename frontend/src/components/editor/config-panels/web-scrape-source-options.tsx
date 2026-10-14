import type { ScraperActorId } from "@nodaro/shared/social"
import { SelectItem } from "@/components/ui/select"
import { AdminOnlyPill } from "@/components/nodes/hidden-from-users-mark"
import { useT } from "@/lib/i18n"
import {
  isWebScrapeSourceHiddenFromUsers,
  isWebScrapeSourceUnavailable,
  useSurfaceAvailability,
} from "@/lib/surface-availability"

/**
 * Which Web Scrape sources this viewer is offered.
 *
 * A source can be the same capability as a dedicated node — the Instagram source
 * is the Instagram node's scraper — and then it follows that node's
 * availability: withheld in Admin → Availability, it is withdrawn here too. The
 * backend decides (and refuses the run regardless); this only keeps the dropdown
 * honest. The browser is told the RESULT (`webScrapeSources` on
 * GET /v1/surface/availability), never the source → node mapping.
 *
 * The node's CURRENT source is always kept, even when withdrawn: an existing
 * node must never render an empty select. It is tagged as unavailable, and once
 * the user picks something else it is gone from the list.
 */
export function offeredWebScrapeSources(
  options: ReadonlyArray<ScraperActorId>,
  current: ScraperActorId,
): ScraperActorId[] {
  return options.filter((id) => id === current || !isWebScrapeSourceUnavailable(id))
}

interface SourceItemsProps {
  readonly options: ReadonlyArray<ScraperActorId>
  readonly current: ScraperActorId
  readonly label: (id: ScraperActorId) => string
}

/** The `<SelectItem>`s of the source dropdown. Subscribes to availability itself,
 *  so options that were rendered before the fetch landed still narrow. */
export function WebScrapeSourceItems({ options, current, label }: SourceItemsProps) {
  useSurfaceAvailability()
  const t = useT()
  return (
    <>
      {offeredWebScrapeSources(options, current).map((id) => (
        <SelectItem key={id} value={id}>
          {label(id)}
          {isWebScrapeSourceUnavailable(id) && ` (${t("inputcfg.sourceUnavailableTag")})`}
          {isWebScrapeSourceHiddenFromUsers(id) && <AdminOnlyPill className="ms-2" />}
        </SelectItem>
      ))}
    </>
  )
}

/** Says why the run will be refused, under the dropdown of a node that still
 *  points at a withdrawn source. Renders nothing otherwise. */
export function WebScrapeSourceNotice({ actor }: { readonly actor: ScraperActorId }) {
  useSurfaceAvailability()
  const t = useT()
  if (!isWebScrapeSourceUnavailable(actor)) return null
  return (
    <p role="status" className="text-xs text-amber-600 dark:text-amber-400">
      {t("inputcfg.sourceUnavailable")}
    </p>
  )
}
