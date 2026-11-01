// One background-scrape attempt's bound (BACKGROUND_SCRAPE_ATTEMPT_MAX_MS,
// @nodaro/render-rules) holds every wait an attempt makes, and the clocks that
// read it are at least as long: the reconcile sweep of a saved Apify run, and
// the editor's poll budget.
import { describe, expect, it } from "vitest"
import {
  BACKGROUND_SCRAPE_ATTEMPT_MAX_MS, BACKGROUND_SCRAPE_POLL_BUDGET_MS,
  VIDEO_WORKER_LOCK_DURATION_MS, VIDEO_WORKER_STALLED_INTERVAL_MS,
} from "@nodaro/render-rules"
import { ACTORS } from "../../../providers/apify/actors.js"
import { META_ADS_ACTOR } from "../../../providers/apify/meta-ads.js"
import { INSTAGRAM_ACTOR } from "../../../providers/apify/instagram.js"
import { SITE_CAPTURE_ACTOR } from "../../../providers/apify/site-capture-actor.js"
import { POLL_BUDGET_MS } from "../../../providers/nodaro/client.js"
import { SITE_CAPTURE_RELAY_BUDGET_MS } from "../site-capture.js"
import { SCRAPE_MEDIA_DEADLINE_MS } from "../common.js"
import { STALE_THRESHOLD_MS } from "../../reconcile/types.js"

/** What an attempt does after its provider wait or its media deadline: the last analysis call in flight, the completion and the commit. */
const SETTLE_SLACK_MS = 5 * 60_000

describe("background scrape attempt bound", () => {
  it("holds every provider wait and the media/analysis deadline, with room to settle", () => {
    const waits = [
      ...Object.values(ACTORS).map((a) => a.timeoutSecs * 1_000),
      META_ADS_ACTOR.timeoutSecs * 1_000,
      INSTAGRAM_ACTOR.timeoutSecs * 1_000,
      SITE_CAPTURE_ACTOR.waitSecs * 1_000,
      POLL_BUDGET_MS, // a relay's poll of the connected cloud's job
      SITE_CAPTURE_RELAY_BUDGET_MS,
      SCRAPE_MEDIA_DEADLINE_MS,
    ]
    for (const w of waits) expect(w + SETTLE_SLACK_MS).toBeLessThanOrEqual(BACKGROUND_SCRAPE_ATTEMPT_MAX_MS)
  })

  it("the sweep of a saved Apify run waits at least one attempt", () => {
    expect(STALE_THRESHOLD_MS["apify-run"]).toBeGreaterThanOrEqual(BACKGROUND_SCRAPE_ATTEMPT_MAX_MS)
    // A relayed scrape's cloud job is swept on the relay's own, longer clock.
    expect(STALE_THRESHOLD_MS["nodaro-cloud"]).toBeGreaterThanOrEqual(BACKGROUND_SCRAPE_ATTEMPT_MAX_MS)
  })

  it("the editor's poll budget outlasts a deploy: an attempt, the re-pick delay, and a whole attempt again", () => {
    expect(BACKGROUND_SCRAPE_POLL_BUDGET_MS).toBeGreaterThanOrEqual(
      2 * BACKGROUND_SCRAPE_ATTEMPT_MAX_MS + VIDEO_WORKER_LOCK_DURATION_MS + VIDEO_WORKER_STALLED_INTERVAL_MS,
    )
  })
})
