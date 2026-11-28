import { expect, it } from "vitest"
import { routedEstimateData } from "../routed-estimate-inputs.js"

const source = { id: "picture", type: "upload-image" }
const video = { id: "video", type: "generate-video", data: { provider: "seedance-2-5" } }

it("prices a connected frame with the image service even before its result exists", () => {
  expect(routedEstimateData(video, [source, video], [
    { source: "picture", target: "video", targetHandle: "startFrame" },
  ], 2)).toMatchObject({ hasStartFrame: true, hasEndFrame: false, unknownReferenceVideos: 2 })
})

it("keeps a lone end frame and selected-node fallback as frame inputs", () => {
  expect(routedEstimateData(video, [source, video], [
    { source: "picture", target: "video", targetHandle: "endFrame" },
  ])).toMatchObject({ hasStartFrame: false, hasEndFrame: true })
  expect(routedEstimateData({ ...video, data: { ...video.data, selectedStartFrameNodeId: "picture" } }, [source, video], []))
    .toMatchObject({ hasStartFrame: true })
})

it("does not treat reference images, dangling selections or caller flags as start frames", () => {
  const input = { ...video, data: { ...video.data, hasStartFrame: true, selectedStartFrameNodeId: "missing" } }
  expect(routedEstimateData(input, [source, video], [
    { source: "picture", target: "video", targetHandle: "imageReferences" },
  ])).toMatchObject({ hasStartFrame: false, hasEndFrame: false })
  expect(input.data.hasStartFrame).toBe(true)
})
