/**
 * Whether reference roles render in the hybrid form server-side. Mirrors the
 * image determination in `routes/generate-image.ts` (the `buildAssembleInput`
 * `referenceFormat` gate): test or explicit `IMAGE_REFERENCE_FORMAT=legacy` →
 * false; otherwise → true (HYBRID IS THE DEFAULT everywhere, incl. production).
 * Set `IMAGE_REFERENCE_FORMAT=legacy` to revert (pair with the frontend
 * `VITE_IMAGE_REFERENCE_FORMAT=legacy`).
 *
 * Used to drive `ResolveVideoReferenceCoreArgs.hybridRoles` from the backend
 * video resolvers (`payload-builder.ts`, `routes/generate-video.ts`) so the
 * video side gates on the SAME env signal as the image side.
 */
export function backendHybridRoles(): boolean {
  if (process.env.NODE_ENV === "test" || process.env.IMAGE_REFERENCE_FORMAT === "legacy") return false
  return true
}
