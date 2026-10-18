/**
 * `@nodaro/sdk/competitors` — the `competitors` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export type {
  // Competitors (`client.competitors`): tracked brands, scans and action cards.
  TrackedCompetitor,
  CompetitorDetail,
  CompetitorListResult,
  CompetitorHistory,
  CompetitorHistoryPoint,
  CompetitorHistoryPlatform,
  CompetitorPeriod,
  CompetitorPeriodPlatform,
  CompetitorPeriodFollowers,
  CompetitorCompareInput,
  CompetitorCompareResult,
  CompetitorScan,
  CompetitorScanSummary,
  CompetitorScanCounts,
  CompetitorPost,
  CompetitorCardsResult,
  CompetitorBrandTally,
  CompetitorPlatformTally,
  CompetitorSearch,
  CompetitorSearchKind,
  CompetitorDiscovery,
  CompetitorAccounts,
  CompetitorAccountKey,
  CompetitorAboutPlatform,
  CompetitorSchedule,
  CreateCompetitorInput,
  UpdateCompetitorInput,
  ActionCard,
  ActionCardKind,
  ActionCardPriority,
  // What works for a brand, and "did it work?" on the cards you acted on.
  CompetitorLessonsResult,
  BrandLessons,
  BrandLesson,
  BrandLessonKind,
  BrandPlatformLessons,
  CompetitorActionsResult,
  CardAction,
  CardActionResult,
  CardOutcome,
  CardOutcomeState,
  CardSnapshot,
  CardVerdict,
  AdviceRecord,
  AdviceFamily,
  MarkCardInput,
  UpdateCardActionInput,
} from "@nodaro/shared/social"

export { CompetitorsResource } from "../resources/competitors.js"
