/**
 * Every Camera Motion injection was approved on screen (the Camera Motion Lab,
 * 2026-08/09). A cinematic label alone did not drive the model — "camera
 * trucks to the left" barely moved the image and "orbits to the left" went a
 * random way — so each option carries a description of what the camera
 * physically does, tested take by take on a base frame built for its family.
 *
 * The approved wording is pinned here with the clip that approved it. Changing
 * an injection means re-running it on its base frame first; a new option needs
 * its own approved take before it joins this list.
 */
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { CAMERA_MOTIONS } from "../camera-motions"

interface ApprovedInjection {
  readonly id: string
  readonly approvedClip: string
  readonly injection: string
}

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/camera-motion-approved.json", import.meta.url), "utf8"),
) as { readonly unapproved: readonly string[]; readonly approved: readonly ApprovedInjection[] }

const byId = new Map(CAMERA_MOTIONS.map((motion) => [motion.id, motion]))

describe("Camera Motion injections", () => {
  it.each(fixture.approved.map((row) => [row.id, row] as const))("%s sends its lab-approved wording", (id, row) => {
    expect(byId.get(id)?.promptHint).toBe(row.injection)
  })

  it("has an approved take for every option but the ones never built", () => {
    const approved = new Set(fixture.approved.map((row) => row.id))
    const unaccounted = CAMERA_MOTIONS.map((motion) => motion.id).filter((id) => !approved.has(id))
    expect(unaccounted.sort()).toEqual([...fixture.unapproved].sort())
  })

  // An edit-type transition's real-world trigger gets drawn into the scene:
  // "finger tap" put a finger on screen, and the compact term is sent as-is.
  it("never names a transition's physical trigger in the compact term", () => {
    for (const id of ["screen-tap", "phone-flip"]) {
      expect(byId.get(id)?.term ?? "").not.toMatch(/finger|phone|hand|tap|click/i)
    }
  })
})
