/**
 * Topaz image upscale's worker and the deployment's link-import switch: a job
 * queued before an admin turned outside links off is refused in the worker,
 * final, before the picture is read, re-encoded or sent to the model. A
 * picture on this deployment's own storage still runs, and with links on
 * nothing changes. (The route and the workflow stamp refuse earlier; this is
 * the last door for a job that was already queued.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Reading and re-encoding the picture: what the worker does before the model.
vi.mock("@/providers/kie/video.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../kie/video.js")>()),
  ensureImageForProvider: vi.fn(async (url: string) => url),
}))
vi.mock("@/lib/image-source-size.js", () => ({
  probeImageDisplaySize: vi.fn(async () => ({ width: 1024, height: 1024 })),
  sourceImageForAutoAspect: vi.fn(async () => undefined),
}))
// The worker's call to the model.
vi.mock("@/providers/replicate/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../client.js")>()),
  runReplicatePrediction: vi.fn(async () => ({ output: "https://out.example/i.png", metrics: {} })),
}))

import { runTopazImageUpscale } from "../topaz.js"
import { runReplicatePrediction } from "../client.js"
import { ensureImageForProvider } from "../../kie/video.js"
import { probeImageDisplaySize } from "../../../lib/image-source-size.js"
import { LinkImportsDisabledError } from "../../../lib/link-imports.js"
import { __resetSurfaceProfileCacheForTests } from "../../../lib/surface-profile.js"

const OUTSIDE = "https://cdn.example/photo.png"
const OWN_STORAGE = "https://media.nodaro.test"
const OWN = `${OWN_STORAGE}/uploads/images/photo.png`
const savedR2 = process.env.R2_PUBLIC_URL

function linksOff(off: boolean): void {
  if (off) process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ imports: { links: false } })
  else delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.R2_PUBLIC_URL = OWN_STORAGE
})

afterEach(() => {
  linksOff(false)
  if (savedR2 === undefined) delete process.env.R2_PUBLIC_URL
  else process.env.R2_PUBLIC_URL = savedR2
})

describe("Topaz image upscale's worker and the link-import switch", () => {
  it("links off: a queued job's outside link is refused, final, before the picture is read, re-encoded or sent", async () => {
    linksOff(true)
    await expect(runTopazImageUpscale(OUTSIDE, { upscale_factor: "2" })).rejects.toBeInstanceOf(LinkImportsDisabledError)
    expect(ensureImageForProvider).not.toHaveBeenCalled()
    expect(probeImageDisplaySize).not.toHaveBeenCalled()
    expect(runReplicatePrediction).not.toHaveBeenCalled()
  })

  it("links off: a picture on this deployment's own storage still runs", async () => {
    linksOff(true)
    await runTopazImageUpscale(OWN, { upscale_factor: "2" })
    expect(runReplicatePrediction).toHaveBeenCalledTimes(1)
  })

  it("links on: an outside link runs as before", async () => {
    linksOff(false)
    await runTopazImageUpscale(OUTSIDE, { upscale_factor: "2" })
    expect(ensureImageForProvider).toHaveBeenCalledTimes(1)
    expect(runReplicatePrediction).toHaveBeenCalledTimes(1)
  })
})
