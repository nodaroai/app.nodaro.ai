import { describe, it, expect } from "vitest"
import { needsContainerRemux, buildRemuxArgs } from "../ffmpeg-utils.js"

it("pass-through containers", () => {
  expect(needsContainerRemux("/a/b/clip.mp4")).toBe(false)
  expect(needsContainerRemux("clip.webm")).toBe(false)
  expect(needsContainerRemux("clip.mov")).toBe(false)
  expect(needsContainerRemux("clip.mkv")).toBe(true)
  expect(needsContainerRemux("clip.avi")).toBe(true)
})
it("audio recipe: copy aac/mp3, re-encode everything else, skip when no audio", () => {
  expect(buildRemuxArgs("in.mkv", "out.mp4", "aac").join(" ")).toContain("-c:a copy")
  expect(buildRemuxArgs("in.mkv", "out.mp4", "opus").join(" ")).toContain("-c:a aac")
  expect(buildRemuxArgs("in.avi", "out.mp4", "pcm_s16le").join(" ")).toContain("-c:a aac")
  expect(buildRemuxArgs("in.mkv", "out.mp4", null).join(" ")).not.toContain("-c:a")
  expect(buildRemuxArgs("in.mkv", "out.mp4", "aac").join(" ")).toContain("-c:v copy")
})
