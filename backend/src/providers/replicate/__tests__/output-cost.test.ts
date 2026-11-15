import { beforeEach, expect, it, vi } from "vitest"
import { probeVideoStreamDurationSource } from "../../video/ffmpeg-utils.js"
import { replicateOutputCost } from "../output-cost.js"
vi.mock("../../video/ffmpeg-utils.js", () => ({probeVideoStreamDurationSource:vi.fn()}))
beforeEach(() => vi.resetAllMocks())
it("uses measured output seconds", async () => {
  vi.mocked(probeVideoStreamDurationSource).mockResolvedValue(29.133333)
  expect(await replicateOutputCost("lipsync-2-pro","https://result/video.mp4")).toBeCloseTo(2.42535,5)
})
it.each([0,-1,NaN,Infinity])("does not manufacture a cost for invalid duration %s", async seconds => {
  vi.mocked(probeVideoStreamDurationSource).mockResolvedValue(seconds)
  expect(await replicateOutputCost("lipsync-2-pro","https://result/video.mp4")).toBeNull()
})
it("leaves GPU billed models alone and tolerates an unreadable output", async () => {
  expect(await replicateOutputCost("wav2lip","https://result/video.mp4")).toBeNull()
  expect(probeVideoStreamDurationSource).not.toHaveBeenCalled()
  vi.mocked(probeVideoStreamDurationSource).mockRejectedValue(new Error("unavailable"))
  expect(await replicateOutputCost("lipsync-2-pro","https://result/video.mp4")).toBeNull()
})
