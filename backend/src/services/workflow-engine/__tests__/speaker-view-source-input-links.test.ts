/**
 * Speaker View's source check (speaker-view-source.ts) downloads its source
 * video to measure it, at run start and at a feeder's dispatch — before the
 * nodes' own input-link judgment runs. Where the deployment refuses media
 * inputs from other sites (`imports.inputLinks: "refuse"`, lib/input-links.ts),
 * a source on another site is refused there first, never downloaded; one on
 * this deployment's own storage is measured as before. Without the lever
 * nothing changes.
 */
import { describe, expect, it, vi, afterEach } from "vitest"
import type { MeasuredClip } from "../../../lib/clip-measure.js"
import { speakerViewRunStartSourceCheck, type SpeakerViewSourceDeps } from "../speaker-view-source.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"
import { OUTSIDE_HOST, OWN_STORAGE, REFUSE_PROFILE, useProfile } from "../../../lib/__tests__/helpers/input-link-profiles.js"

vi.mock("@/lib/app-reports.js", () => ({ insertAppReport: vi.fn(async () => true) }))

const savedR2 = process.env.R2_PUBLIC_URL
afterEach(() => {
  useProfile(undefined)
  if (savedR2 === undefined) delete process.env.R2_PUBLIC_URL
  else process.env.R2_PUBLIC_URL = savedR2
})

const node = (id: string, type: string, data: Record<string, unknown> = {}): SimpleNode => ({ id, type, data }) as SimpleNode
const wire = (source: string, target: string, targetHandle: string): SimpleEdge => ({ id: `${source}-${target}`, source, target, sourceHandle: null, targetHandle }) as SimpleEdge

function check(video: string) {
  process.env.R2_PUBLIC_URL = OWN_STORAGE
  const nodes = [node("clip", "upload-video", { url: video }), node("sv", "speaker-view", { label: "Vertical cut" })]
  const edges = [wire("clip", "sv", "video")]
  const nodeStates = { clip: { status: "completed", output: { videoUrl: video } } } as unknown as Record<string, NodeExecutionState>
  const measure = vi.fn(async (_url: string): Promise<MeasuredClip> => ({ durationMs: 14_600, width: 3840, height: 2160, faces: "present" }))
  const deps: SpeakerViewSourceDeps = { measure, videoModeLive: () => true }
  return { run: () => speakerViewRunStartSourceCheck({ runNodes: nodes, nodes, edges, nodeStates, deps }), measure }
}

describe("Speaker View's source check and input links", () => {
  it("no lever: a source on another site is measured, as before", async () => {
    const { run, measure } = check(`${OUTSIDE_HOST}/clip.mp4`)
    await expect(run()).resolves.toBeNull()
    expect(measure).toHaveBeenCalledTimes(1)
  })

  it("refuse: a source on another site is refused before it is downloaded, the run not started", async () => {
    useProfile(REFUSE_PROFILE.profile)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { run, measure } = check(`${OUTSIDE_HOST}/clip.mp4`)
    await expect(run()).resolves.toMatch(/turned off on this deployment.*Speaker View node "Vertical cut".*did not start/)
    expect(measure).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("refuse: a source on this deployment's own storage is measured, as before", async () => {
    useProfile(REFUSE_PROFILE.profile)
    const { run, measure } = check(`${OWN_STORAGE}/videos/clip.mp4`)
    await expect(run()).resolves.toBeNull()
    expect(measure).toHaveBeenCalledTimes(1)
  })
})
