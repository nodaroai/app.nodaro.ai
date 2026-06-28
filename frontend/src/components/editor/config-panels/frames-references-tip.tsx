/**
 * Inline informational hint shown when a video node has BOTH a start/end
 * frame AND one or more reference images wired. Explains that, with references
 * attached, the frame is approximated through the prompt rather than used as a
 * pixel-exact keyframe. Guidance only — never blocks or validates (mirrors the
 * no-false-positive rule and the sibling `SeedanceReferenceTip`).
 */
export function FramesAndReferencesTip({
  hasFrame,
  hasReference,
}: {
  hasFrame: boolean
  hasReference: boolean
}) {
  if (!hasFrame || !hasReference) return null
  return (
    <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
      With references attached, the start/end frame is{" "}
      <span className="font-medium">approximated via the prompt</span>, not pixel-exact. For an exact
      frame, remove the references.
    </p>
  )
}
