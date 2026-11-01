/**
 * A stand-in for the video queue in the background-scrape route tests: `add`
 * records what the route enqueued and runs the REAL handler for it at once,
 * detached — what the video worker does on pickup with lanes off — so a test
 * of the route still sees the scrape run and settle after the answer.
 *
 * The payload goes through JSON first, as BullMQ stores it, so a field that
 * does not survive the queue fails here too.
 *
 *   vi.mock("../../lib/queue.js", async () => ({ videoQueue: (await import("./helpers/inline-scrape-worker.js")).inlineScrapeQueue }))
 */
import { vi } from "vitest"

export interface EnqueuedScrape {
  readonly name: string
  readonly data: Record<string, unknown>
}

/** Every job the routes enqueued, in order (cleared by `resetInlineScrapeQueue`). */
export const enqueuedScrapes: EnqueuedScrape[] = []
/** Anything a handler threw (a settle never does). */
export const scrapeHandlerErrors: unknown[] = []

export const inlineScrapeQueue = {
  add: vi.fn(async (name: string, data: Record<string, unknown>) => {
    const payload = JSON.parse(JSON.stringify(data)) as Record<string, unknown>
    enqueuedScrapes.push({ name, data: payload })
    const { backgroundScrapeHandlers } = await import("../../../workers/handlers/background-scrape.js")
    const handler = backgroundScrapeHandlers[name]
    if (!handler) throw new Error(`no video-worker handler for ${name}`)
    const ctx = { jobId: String(payload.jobId), jobUserId: payload.userId as string | undefined, usageLogId: payload.usageLogId as string | undefined, shouldWatermark: false }
    void handler({ id: `bull-${enqueuedScrapes.length}`, name, data: payload } as never, ctx).catch((err: unknown) => {
      scrapeHandlerErrors.push(err)
    })
    return { id: `bull-${enqueuedScrapes.length}` }
  }),
}

export function resetInlineScrapeQueue(): void {
  enqueuedScrapes.length = 0
  scrapeHandlerErrors.length = 0
}
