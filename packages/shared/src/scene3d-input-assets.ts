import { z } from "zod"

/** Immutable 3D inputs are selected by revision and artifact, never by URL or caller receipt. */
export const scene3DInputAssetSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/),
  revisionId: z.uuid(),
  assetId: z.uuid(),
  label: z.string().min(1).max(64).regex(/^[^\u0000-\u001f]+$/).optional(),
}).strict()

export const scene3DInputAssetsSchema = z.array(scene3DInputAssetSchema).max(8).superRefine((values, ctx) => {
  if (new Set(values.map(value => value.id)).size !== values.length ||
      new Set(values.map(value => value.assetId)).size !== values.length) {
    ctx.addIssue({ code: "custom", message: "Scene input assets must have unique identities" })
  }
})

export type Scene3DInputAsset = z.infer<typeof scene3DInputAssetSchema>

/** Both workflow engines refuse unsupported imports before starting a paid Basic run. */
export function scene3DInputAssetsForEngine(value: unknown, engine: string | undefined): Scene3DInputAsset[] {
  const assets = scene3DInputAssetsSchema.parse(value ?? [])
  if (assets.length && engine !== "blender-cloud" && engine !== "blender-local") {
    throw new Error("Imported 3D assets require an advanced scene engine")
  }
  return assets
}
