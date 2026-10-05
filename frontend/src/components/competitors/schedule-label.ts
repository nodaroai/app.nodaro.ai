import type { CompetitorSchedule } from "@nodaro/shared"
import type { MessageKey } from "@/lib/i18n"

/** A brand's scan schedule, as the person reads it. */
export const SCHEDULE_LABEL: Readonly<Record<CompetitorSchedule, MessageKey>> = {
  off: "competitors.scheduleOff",
  weekly: "competitors.scheduleWeekly",
  daily: "competitors.scheduleDaily",
}
