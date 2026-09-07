import { beforeAll, describe, expect, it, vi } from "vitest"
import { fileURLToPath } from "node:url"
import { createScene3DPlaybackToolkit } from "../scene3d-playback-toolkit.js"
import type { PluginSceneArtifactToolkit } from "../scene3d-artifact-contract.js"

const root = fileURLToPath(new URL("../../../../", import.meta.url))
const fixturesPath = fileURLToPath(new URL("../../../../../packages/remotion/src/scene3d/v2/__tests__/v2-fixtures.ts", import.meta.url))
const glbPath = fileURLToPath(new URL("../../../../../packages/remotion/src/scene3d/v2/__tests__/glb-fixtures.ts", import.meta.url))
const builderPath = fileURLToPath(new URL("../../../../scripts/build-scene3d-reader.mjs", import.meta.url))

beforeAll(async () => { const { buildScene3DReader } = await import(builderPath); await buildScene3DReader(root) })

async function fixture() {
  const { makeLoadableScene } = await import(fixturesPath)
  const { makeGlb } = await import(glbPath)
  const { plan, bytes } = makeLoadableScene({ glb: makeGlb({ nodes: [{ name: "car", entityRootId: "car",
    children: [{ name: "body", mesh: true, materialName: "paint" }] }] }), objects: [{ id: "car", name: "Car",
    visual: { kind: "asset", assetId: "glb", rootNodeId: "car" } }] })
  const read = vi.fn(async (input: { artifactId: string }) => {
    const buffer = bytes[input.artifactId]
    if (!buffer) throw new Error("Artifact unavailable")
    return new Uint8Array(buffer)
  })
  const artifacts = { read } as unknown as PluginSceneArtifactToolkit
  return { plan, read, toolkit: createScene3DPlaybackToolkit(artifacts),
    scope: { jobId: "job", userId: "owner", revisionId: plan.revisionId } }
}

describe("the compiled server scene reader", () => {
  it("inspects real GLB bytes through the job's owned artifact reader", async () => {
    const f = await fixture()
    await expect(f.toolkit.inspectGlb({ ...f.scope, artifactId: "glb" })).resolves.toEqual({
      animationClipNames: [], meshNodeCount: 1, triangleCount: 1,
    })
    expect(f.read).toHaveBeenCalledWith({ ...f.scope, artifactId: "glb" }, undefined)
  })
  it("validates the full scene with the compiled Three reader", async () => {
    const f = await fixture()
    await expect(f.toolkit.validate({ ...f.scope, plan: f.plan })).resolves.toEqual({ warnings: [] })
    expect(f.read.mock.calls.map(([input]) => input.artifactId).sort()).toEqual(["cam", "glb"])
  })
  it("rejects a different revision before reading and propagates cancellation", async () => {
    const f = await fixture()
    await expect(f.toolkit.validate({ ...f.scope, revisionId: "wrong", plan: f.plan })).rejects.toThrow("revision")
    expect(f.read).not.toHaveBeenCalled()
    await expect(f.toolkit.validate({ ...f.scope, plan: f.plan }, { signal: AbortSignal.abort() })).rejects.toThrow()
  })
  it("rejects bytes that differ from the plan even if the artifact reader supplies them", async () => {
    const f = await fixture()
    f.read.mockResolvedValue(new Uint8Array([1, 2, 3]))
    await expect(f.toolkit.validate({ ...f.scope, plan: f.plan })).rejects.toThrow(/byte length|SHA-256/)
  })
  it("refuses an editable material that does not exist in the exported geometry", async () => {
    const f = await fixture()
    const plan = { ...f.plan, objects: [{ ...f.plan.objects[0], materialBindings: [{ role: "body", materialName: "ghost" }] }] }
    await expect(f.toolkit.validate({ ...f.scope, plan })).rejects.toThrow(/ghost.*not in this entity/)
  })
})
