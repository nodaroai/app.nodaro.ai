import { expect, it, vi } from "vitest"
const assetBytes = vi.hoisted(() => vi.fn().mockResolvedValue(new ArrayBuffer(4)))
vi.mock("@/lib/nodaro-client", () => ({ nodaroClient: { scene3d: { assetBytes } } }))
import { createAuthenticatedScene3DAssetResolver } from "../authenticated-asset-resolver"
it("authorizes reused assets through the current revision rather than their origin", async () => {
  const ref = { assetId: "geometry", kind: "glb" as const, role: "entity-geometry" as const,
    sha256: "a".repeat(64), byteLength: 4, originRevisionId: "old-revision" }
  await createAuthenticatedScene3DAssetResolver("current-revision").resolve(ref, new AbortController().signal)
  expect(assetBytes).toHaveBeenCalledWith("current-revision", ref, expect.objectContaining({ signal: expect.any(AbortSignal) }))
})
