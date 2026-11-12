import { describe, it, expect } from "vitest"
import { videoStartFrameOnlyProblem } from "@nodaro/shared/models"
import { buildGrokVideo15Request } from "../grok-video-15.js"

/**
 * The start-frame-only rule judges the frames the builder actually SENDS: for
 * every wiring shape and clip length, `videoStartFrameOnlyProblem` refuses a
 * 1080p run exactly when the body the builder makes would carry something
 * besides the start frame (`last_frame_url`, `loop_url` or `keyframes`) — the
 * bodies the provider refuses at 1080p (a staging run, 2026-11-12). So the
 * routes, the workflow run and the editor, which all call the rule, cannot
 * refuse a run the provider would take, nor let through one it would refuse.
 */
describe("videoStartFrameOnlyProblem agrees with the bodies buildGrokVideo15Request sends", () => {
  const START = "https://cdn.example/start.png"
  const END = "https://cdn.example/end.png"
  const MIDS = ["https://cdn.example/m1.png", "https://cdn.example/m2.png", "https://cdn.example/m3.png", "https://cdn.example/m4.png", "https://cdn.example/m5.png"]
  const ENDS: Array<[string, string | undefined]> = [["no end frame", undefined], ["an end frame", END], ["a loop", START]]

  for (const resolution of ["480p", "720p", "1080p", "1080P"]) {
    for (const [endLabel, endFrameUrl] of ENDS) {
      it(`${resolution}, ${endLabel}, 0–5 in-between frames, 1–15s`, () => {
        for (let k = 0; k <= MIDS.length; k++) {
          for (let durationSec = 1; durationSec <= 15; durationSec++) {
            const inBetweenFrameUrls = MIDS.slice(0, k)
            const { input } = buildGrokVideo15Request({ prompt: "a walk", durationSec, resolution, startFrameUrl: START, endFrameUrl, inBetweenFrameUrls })
            const sendsMoreThanStart =
              typeof input.last_frame_url === "string" || typeof input.loop_url === "string" || Array.isArray(input.keyframes)
            const refused = videoStartFrameOnlyProblem("grok-imagine-video-1.5", {
              resolution,
              durationSec,
              hasEndFrame: endFrameUrl !== undefined,
              inBetweenFrameCount: inBetweenFrameUrls.length,
            }) !== undefined
            expect(refused, `${k} frame(s), ${durationSec}s`).toBe(input.resolution === "1080p" && sendsMoreThanStart)
          }
        }
      })
    }
  }
})
