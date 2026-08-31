/**
 * Whether reference roles render in the hybrid form server-side. THE single
 * determination, not a mirror of one: `routes/generate-image.ts`'s
 * `buildAssembleInput` `referenceFormat` gate calls it too, so the image and
 * video sides cannot drift. Test runs or an explicit
 * `IMAGE_REFERENCE_FORMAT=legacy` → false; otherwise → true (HYBRID IS THE
 * DEFAULT everywhere, incl. production). Set `IMAGE_REFERENCE_FORMAT=legacy` to
 * revert (pair with the frontend `VITE_IMAGE_REFERENCE_FORMAT=legacy`).
 *
 * Also drives `ResolveVideoReferenceCoreArgs.hybridRoles` from the backend
 * video resolvers (`payload-builder.ts`, `routes/generate-video.ts`).
 */
export function backendHybridRoles(): boolean {
  if (process.env.NODE_ENV === "test" || process.env.IMAGE_REFERENCE_FORMAT === "legacy") return false
  return true
}
