/**
 * Hand a background scrape to the video worker and answer the request with its
 * job id. The BullMQ name is the job type itself (`web-scrape`, `site-capture`,
 * `meta-ads-scrape`, `instagram-scrape`): the worker's pickup claim writes that
 * name into `jobs.job_type`, so the row keeps the type it was inserted with,
 * and the job budget registry is keyed by it.
 *
 * The answer is the one these routes always gave: `{ jobId, status: "pending" }`
 * at once. The job waits for its slot, if it has to, on the worker
 * (lib/concurrency-lanes/worker-admit.ts), never in the request.
 */
import type { FastifyReply, FastifyRequest } from "fastify"
import { videoQueue } from "../queue.js"
import { enqueueRouteJob } from "../enqueue-route-job.js"
import type { BackgroundScrapeJobBase } from "./common.js"

import type { BackgroundScrapeJobType } from "./job-types.js"

export async function enqueueBackgroundScrape(
  req: FastifyRequest,
  reply: FastifyReply,
  jobType: BackgroundScrapeJobType,
  data: BackgroundScrapeJobBase & Record<string, unknown>,
): Promise<void> {
  // The BullMQ id is the row's id: a scrape waiting for capacity can then be
  // found on the queue by its row (the never-started sweep spares it). A
  // queue that refuses the job fails it from `pending` with its key released
  // and refunds it, confirmed (no provider or analysis call has run, so a
  // full refund is right) — lib/enqueue-route-job.ts.
  await enqueueRouteJob(req, reply, data.jobId, () => videoQueue.add(jobType, data, { jobId: data.jobId }))
  if (reply.sent) return
  reply.send({ jobId: data.jobId, status: "pending" })
}
