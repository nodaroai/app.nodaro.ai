/**
 * A video node's OWN Motion setting (`motionEnabled` + `motion`) as the clause
 * its prompt carries, e.g. "dynamic motion".
 *
 * Only the node types that offer the setting add it: the legacy Image to Video
 * node, and Generate Video in either mode (with or without a start frame). A
 * legacy Text to Video node has no such setting. `nodeType` is the node's REAL
 * type: the editor re-types Generate Video to image-to-video / text-to-video
 * before composing, so a re-typed node must still pass "generate-video". The
 * editor applied it only with a start frame while workflow runs applied it
 * always; one rule for both is what keeps them in step.
 *
 * Separate from the Motion node wired into a Settings input, whose clause comes
 * from `getParameterPromptHint` through the cinematography collectors.
 */
export const OWN_MOTION_NODE_TYPES: ReadonlySet<string> = new Set(["image-to-video", "generate-video"])

/**
 * The step the Motion control shows before one is picked, and so the step an
 * enabled setting runs with when none is stored. Ticking the checkbox stores
 * no step, so the prompt used to get nothing while the panel showed Moderate.
 */
export const DEFAULT_OWN_MOTION = "moderate"

export function ownMotionHint(nodeType: string, data: Readonly<Record<string, unknown>>): string | undefined {
  if (!OWN_MOTION_NODE_TYPES.has(nodeType) || !data.motionEnabled) return undefined
  const step = typeof data.motion === "string" && data.motion ? data.motion : DEFAULT_OWN_MOTION
  return `${step} motion`
}
