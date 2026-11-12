import { describe, it, expect, vi, beforeEach } from "vitest"

const m = vi.hoisted(() => ({ apiJson: vi.fn() }))
vi.mock("@/lib/api", () => ({ apiJson: m.apiJson }))

import { splitIntoLayersApi } from "../api"
import { definition } from "../definition.generated"

beforeEach(() => { m.apiJson.mockReset().mockResolvedValue({ jobId: "job-1" }) })

const call = (body: Record<string, unknown>) => [`/v1/${definition.type}`, { body, workflowId: true, label: "apiErr.startSplitIntoLayers" }]

describe("splitIntoLayersApi", () => {
  it("POSTs the image, Max layers, the size, the description and the user as a workflow job", async () => {
    await expect(splitIntoLayersApi({ imageUrl: "https://media.test/a.png", maxLayers: 12, size: "2K", prompt: "the logo" }, "user-1")).resolves.toEqual({ jobId: "job-1" })
    expect(m.apiJson).toHaveBeenCalledWith(...call({ imageUrl: "https://media.test/a.png", maxLayers: 12, size: "2K", prompt: "the logo", userId: "user-1" }))
  })

  it("leaves out an empty description (the main elements are found without one) and the user when there is none", async () => {
    await splitIntoLayersApi({ imageUrl: "https://media.test/a.png", maxLayers: 9, size: "1K" })
    expect(m.apiJson).toHaveBeenLastCalledWith(...call({ imageUrl: "https://media.test/a.png", maxLayers: 9, size: "1K" }))
    await splitIntoLayersApi({ imageUrl: "https://media.test/a.png", maxLayers: 9, size: "auto", prompt: "" })
    expect(m.apiJson).toHaveBeenLastCalledWith(...call({ imageUrl: "https://media.test/a.png", maxLayers: 9, size: "auto" }))
  })
})
