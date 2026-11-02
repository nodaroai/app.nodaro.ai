/**
 * A plugin's `tk.http.videoQueue.add` cannot name an import's way in: the keys
 * a route sets for `importRightsOf` (workers/shared.ts) are dropped from the
 * job data, as the host-owned headers are from a plugin's requests. Everything
 * else, the confirmation included, reaches the queue as sent.
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue({ id: "queued" }) }, redis: {} }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: async () => false }))

import { videoQueue } from "../../queue.js"
import { buildToolkit, pluginJobData } from "../toolkit.js"

describe("pluginJobData", () => {
  it("drops the way-in keys and keeps everything else, without touching the input", () => {
    const data = { jobId: "j1", url: "https://youtu.be/abc", confirmationId: "c1", importVia: "mcp", importAppId: "app-1", importAuthorizationId: "a1" }
    expect(pluginJobData(data)).toEqual({ jobId: "j1", url: "https://youtu.be/abc", confirmationId: "c1" })
    expect(data).toHaveProperty("importVia", "mcp")
  })
})

describe("tk.http.videoQueue.add", () => {
  it("enqueues the plugin's data without a way in, and answers what the queue answers", async () => {
    const tk = buildToolkit()
    const answer = await tk.http.videoQueue.add("trim-audio", { jobId: "j1", importVia: "app", importAppId: "x" }, { attempts: 2 })
    expect(answer).toEqual({ id: "queued" })
    expect(vi.mocked(videoQueue.add)).toHaveBeenCalledWith("trim-audio", { jobId: "j1" }, { attempts: 2 })
  })
})
