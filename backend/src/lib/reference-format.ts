/**
 * Whether reference roles render in the hybrid form server-side. Mirrors the
 * image determination in `routes/generate-image.ts` (the `buildAssembleInput`
 * `referenceFormat` gate): test or explicit-legacy → false; non-production or
 * explicit hybrid → true; else (production default) → false.
 *
 * Used to drive `ResolveVideoReferenceCoreArgs.hybridRoles` from the backend
 * video resolvers (`payload-builder.ts`, `routes/generate-video.ts`) so the
 * video side gates on the SAME env signal as the image side.
 */
export function backendHybridRoles(): boolean {
  if (process.env.NODE_ENV === "test" || process.env.IMAGE_REFERENCE_FORMAT === "legacy") return false
  return process.env.NODE_ENV !== "production" || process.env.IMAGE_REFERENCE_FORMAT === "hybrid"
}
