/**
 * The background scrapes' job types and the run a job of one of them saves —
 * a leaf (constants and types only), so the lane registry, the reconcile cron
 * and the cancel path can name them without loading a scrape.
 *
 * Each job type is the node type its row is inserted with AND the BullMQ name
 * of its video-worker job (the pickup claim writes the name into `job_type`).
 */
import { INSTAGRAM_SCRAPE_NODE_TYPE, META_ADS_SCRAPE_NODE_TYPE } from "@nodaro/shared/social"

export const WEB_SCRAPE_JOB_TYPE = "web-scrape"
export const SITE_CAPTURE_JOB_TYPE = "site-capture"
export const META_ADS_SCRAPE_JOB_TYPE = META_ADS_SCRAPE_NODE_TYPE
export const INSTAGRAM_SCRAPE_JOB_TYPE = INSTAGRAM_SCRAPE_NODE_TYPE

export type BackgroundScrapeJobType =
  | typeof WEB_SCRAPE_JOB_TYPE
  | typeof SITE_CAPTURE_JOB_TYPE
  | typeof META_ADS_SCRAPE_JOB_TYPE
  | typeof INSTAGRAM_SCRAPE_JOB_TYPE

export const BACKGROUND_SCRAPE_JOB_TYPES: ReadonlySet<string> = new Set<BackgroundScrapeJobType>([
  WEB_SCRAPE_JOB_TYPE, SITE_CAPTURE_JOB_TYPE, META_ADS_SCRAPE_JOB_TYPE, INSTAGRAM_SCRAPE_JOB_TYPE,
])

/**
 * The external run a scrape started, saved on its row the moment it exists
 * (`provider_kind` + `provider_task_id`), so an interrupted job re-attaches to
 * THAT run and never starts a second one: the connected nodaro.ai account's
 * cloud job (`nodaro-cloud`, the exclusive-node relay's kind) or this
 * install's Apify actor run (`apify-run`).
 */
export type ScrapeRunKind = "nodaro-cloud" | "apify-run"

export interface SavedScrapeRun {
  readonly kind: ScrapeRunKind
  readonly id: string
}

export function isScrapeRunKind(kind: unknown): kind is ScrapeRunKind {
  return kind === "nodaro-cloud" || kind === "apify-run"
}
