import { describe, it, expect, vi, beforeEach } from "vitest"
import { Command } from "commander"
import { objectsCommand } from "../objects.js"

/**
 * Mocked SDK shape — every method the objects command touches needs an
 * impl. The `client` constant lives in module scope so each test can reach
 * into it via `client.objects.<method>` and assert the calls without
 * threading mocks through commander.
 *
 * Note on `process.exit`: the CLI's `handleError` calls `process.exit(1)` on
 * any thrown error, and we don't want that mid-test. We mock it to throw
 * instead so vitest sees a normal rejection and the test can assert on it.
 */
const mocks = {
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  permanentDelete: vi.fn(),
  restore: vi.fn(),
  generate: vi.fn(),
  generateAsset: vi.fn(),
  generateMotion: vi.fn(),
  approveMainImage: vi.fn(),
  recaption: vi.fn(),
  jobsGet: vi.fn(),
}

vi.mock("../../client.js", () => ({
  buildClient: () => ({
    objects: {
      list: mocks.list,
      get: mocks.get,
      create: mocks.create,
      update: mocks.update,
      delete: mocks.delete,
      permanentDelete: mocks.permanentDelete,
      restore: mocks.restore,
      generate: mocks.generate,
      generateAsset: mocks.generateAsset,
      generateMotion: mocks.generateMotion,
      approveMainImage: mocks.approveMainImage,
      recaption: mocks.recaption,
    },
    jobs: { get: mocks.jobsGet },
  }),
  handleError: (err: unknown) => {
    // Surface the underlying error to vitest instead of process.exiting.
    throw err
  },
}))

// Don't print anything from `success`/`emit`/etc during the tests.
vi.mock("../../output.js", async () => {
  const actual = await vi.importActual<typeof import("../../output.js")>("../../output.js")
  return {
    ...actual,
    emit: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    dim: vi.fn(),
    warn: vi.fn(),
    table: vi.fn(),
  }
})

/**
 * Build a fresh `objects` command tree, attach it to a Command program, and
 * dispatch the given argv. Commander parses the first two argv elements as
 * `[node, script]`, so each test's args go AFTER those two placeholders.
 */
async function runCmd(...args: string[]): Promise<void> {
  const program = new Command().exitOverride()
  program.addCommand(objectsCommand())
  await program.parseAsync(["node", "test", ...args])
}

describe("objects command", () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset()
  })

  it("list invokes client.objects.list with no options by default", async () => {
    mocks.list.mockResolvedValueOnce({ objects: [] })
    await runCmd("objects", "list", "--json")
    expect(mocks.list).toHaveBeenCalledTimes(1)
    expect(mocks.list).toHaveBeenCalledWith({ archived: undefined, projectId: undefined })
  })

  it("list --archived forwards archived=true", async () => {
    mocks.list.mockResolvedValueOnce({ objects: [] })
    await runCmd("objects", "list", "--archived", "--json")
    expect(mocks.list).toHaveBeenCalledWith({ archived: true, projectId: undefined })
  })

  it("list --project scopes to a project id", async () => {
    mocks.list.mockResolvedValueOnce({ objects: [] })
    await runCmd("objects", "list", "--project", "prj-1", "--json")
    expect(mocks.list).toHaveBeenCalledWith({ archived: undefined, projectId: "prj-1" })
  })

  it("get <id> calls objects.get with the id", async () => {
    mocks.get.mockResolvedValueOnce({ id: "obj-1", name: "Lantern" })
    await runCmd("objects", "get", "obj-1", "--json")
    expect(mocks.get).toHaveBeenCalledWith("obj-1")
  })

  it("create requires --node-id and forwards every supplied field", async () => {
    mocks.create.mockResolvedValueOnce({ id: "new-id" })
    await runCmd(
      "objects",
      "create",
      "Antique Lantern",
      "--node-id",
      "node-1",
      "--description",
      "weathered brass",
      "--category",
      "furniture",
      "--style",
      "realistic",
      "--json",
    )
    expect(mocks.create).toHaveBeenCalledWith({
      nodeId: "node-1",
      projectId: undefined,
      name: "Antique Lantern",
      description: "weathered brass",
      category: "furniture",
      style: "realistic",
    })
  })

  it("update errors when no fields supplied", async () => {
    await expect(runCmd("objects", "update", "obj-1")).rejects.toThrow(
      /nothing to update/,
    )
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("update only forwards the keys the user supplied", async () => {
    mocks.update.mockResolvedValueOnce({ id: "obj-1", updatedAt: "2026-05-21T00:00:00.000Z" })
    await runCmd("objects", "update", "obj-1", "--name", "New Name", "--json")
    expect(mocks.update).toHaveBeenCalledWith("obj-1", { name: "New Name" })
    // Confirm we didn't accidentally smuggle empty strings for other fields.
    const patch = mocks.update.mock.calls[0][1] as Record<string, unknown>
    expect(patch.description).toBeUndefined()
    expect(patch.styleLock).toBeUndefined()
  })

  it("update --style-lock parses 'true' / 'false' into booleans", async () => {
    mocks.update.mockResolvedValueOnce({ id: "obj-1", updatedAt: "2026-05-21T00:00:00.000Z" })
    await runCmd("objects", "update", "obj-1", "--style-lock", "false", "--json")
    expect(mocks.update).toHaveBeenCalledWith("obj-1", { styleLock: false })
  })

  it("update --style-lock rejects garbage values", async () => {
    await expect(
      runCmd("objects", "update", "obj-1", "--style-lock", "yes", "--json"),
    ).rejects.toThrow(/style-lock must be/)
  })

  it("update --expected-updated-at threads the optimistic-concurrency token", async () => {
    mocks.update.mockResolvedValueOnce({ id: "obj-1", updatedAt: "2026-05-21T00:00:01.000Z" })
    await runCmd(
      "objects",
      "update",
      "obj-1",
      "--name",
      "New",
      "--expected-updated-at",
      "2026-05-21T00:00:00.000Z",
      "--json",
    )
    expect(mocks.update).toHaveBeenCalledWith("obj-1", {
      name: "New",
      expectedUpdatedAt: "2026-05-21T00:00:00.000Z",
    })
  })

  it("delete soft-deletes via the SDK by default", async () => {
    mocks.delete.mockResolvedValueOnce({ success: true, archived: true })
    await runCmd("objects", "delete", "obj-1", "--json")
    expect(mocks.delete).toHaveBeenCalledWith("obj-1")
    expect(mocks.permanentDelete).not.toHaveBeenCalled()
  })

  it("delete --permanent routes to permanentDelete", async () => {
    mocks.permanentDelete.mockResolvedValueOnce({ success: true, permanent: true })
    await runCmd("objects", "delete", "obj-1", "--permanent", "--json")
    expect(mocks.permanentDelete).toHaveBeenCalledWith("obj-1")
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it("restore calls objects.restore with the id", async () => {
    mocks.restore.mockResolvedValueOnce({ id: "obj-1", name: "Lantern" })
    await runCmd("objects", "restore", "obj-1", "--json")
    expect(mocks.restore).toHaveBeenCalledWith("obj-1")
  })

  it("generate requires --name and forwards count + attach", async () => {
    mocks.generate.mockResolvedValueOnce({ jobId: "j1" })
    await runCmd(
      "objects",
      "generate",
      "--name",
      "Antique Lantern",
      "--count",
      "1",
      "--json",
    )
    expect(mocks.generate).toHaveBeenCalledTimes(1)
    const arg = mocks.generate.mock.calls[0][0] as Record<string, unknown>
    expect(arg.name).toBe("Antique Lantern")
    expect(arg.count).toBe(1)
  })

  it("generate parses --count 4 as the literal 4 union member", async () => {
    mocks.generate.mockResolvedValueOnce({ jobIds: ["j1", "j2", "j3", "j4"] })
    await runCmd("objects", "generate", "--name", "Lantern", "--count", "4", "--json")
    expect(mocks.generate.mock.calls[0][0]).toMatchObject({ count: 4 })
  })

  it("generate forwards --seed-prompt-hint to the SDK", async () => {
    mocks.generate.mockResolvedValueOnce({ jobId: "j1" })
    await runCmd(
      "objects",
      "generate",
      "--name",
      "Lantern",
      "--seed-prompt-hint",
      "antique brass lantern",
      "--json",
    )
    expect(mocks.generate.mock.calls[0][0]).toMatchObject({
      seedPromptHint: "antique brass lantern",
    })
  })

  it("approve-main-image forwards id + candidate-job-id", async () => {
    mocks.approveMainImage.mockResolvedValueOnce({
      sourceImageUrl: "https://r2/x.png",
      canonicalDescription: "...",
    })
    await runCmd(
      "objects",
      "approve-main-image",
      "obj-1",
      "--candidate-job-id",
      "job-1",
      "--json",
    )
    expect(mocks.approveMainImage).toHaveBeenCalledWith("obj-1", "job-1", undefined)
  })

  it("approve-main-image forwards --expected-updated-at when supplied", async () => {
    mocks.approveMainImage.mockResolvedValueOnce({
      sourceImageUrl: "https://r2/x.png",
      canonicalDescription: "fresh caption",
    })
    await runCmd(
      "objects",
      "approve-main-image",
      "obj-1",
      "--candidate-job-id",
      "job-1",
      "--expected-updated-at",
      "2026-05-21T00:00:00.000Z",
      "--json",
    )
    expect(mocks.approveMainImage).toHaveBeenCalledWith(
      "obj-1",
      "job-1",
      "2026-05-21T00:00:00.000Z",
    )
  })

  it("recaption calls objects.recaption with the id", async () => {
    mocks.recaption.mockResolvedValueOnce({ canonicalDescription: "fresh" })
    await runCmd("objects", "recaption", "obj-1", "--json")
    expect(mocks.recaption).toHaveBeenCalledWith("obj-1")
  })

  it("generate-asset infers attachToColumn from canonical asset types", async () => {
    // The CLI fetches the object first to pull `name` + `description` so it
    // can fill those into the SDK payload. Mock both calls.
    mocks.get.mockResolvedValueOnce({ id: "obj-1", name: "Lantern", description: null })
    mocks.generateAsset.mockResolvedValueOnce({ jobId: "asset-job-1" })
    await runCmd(
      "objects",
      "generate-asset",
      "--asset-type",
      "angles",
      "--variant",
      "front",
      "--attach-to-object-id",
      "obj-1",
      "--json",
    )
    const arg = mocks.generateAsset.mock.calls[0][0] as Record<string, unknown>
    expect(arg.assetType).toBe("angles")
    expect(arg.attachToColumn).toBe("angles")
    expect(arg.attachToObjectId).toBe("obj-1")
    expect(arg.attachName).toBe("front")
  })

  it("generate-asset maps --asset-type motion to the motion_clips column", async () => {
    mocks.get.mockResolvedValueOnce({ id: "obj-1", name: "Lantern", description: null })
    mocks.generateAsset.mockResolvedValueOnce({ jobId: "asset-job-2" })
    await runCmd(
      "objects",
      "generate-asset",
      "--asset-type",
      "motion",
      "--variant",
      "swing",
      "--attach-to-object-id",
      "obj-1",
      "--json",
    )
    expect(mocks.generateAsset.mock.calls[0][0]).toMatchObject({
      attachToColumn: "motion_clips",
    })
  })

  it("generate-asset requires --attach-to-column for custom asset types", async () => {
    mocks.get.mockResolvedValueOnce({ id: "obj-1", name: "Lantern", description: null })
    await expect(
      runCmd(
        "objects",
        "generate-asset",
        "--asset-type",
        "custom",
        "--variant",
        "my-custom",
        "--attach-to-object-id",
        "obj-1",
        "--json",
      ),
    ).rejects.toThrow(/--attach-to-column is required/)
    expect(mocks.generateAsset).not.toHaveBeenCalled()
  })

  it("'nodaro objects generate-motion' invokes SDK.generateMotion with object defaults", async () => {
    // Mirrors the location generate-motion CLI surface, but with object-
    // specific defaults: provider=kling-turbo (not kling), aspect=1:1
    // (not 16:9) — product-showcase framing, not cinematic.
    mocks.generateMotion.mockResolvedValueOnce({ jobId: "motion-job-1" })
    await runCmd(
      "objects",
      "generate-motion",
      "--name",
      "Antique Lantern",
      "--motion-prompt",
      "slow rotation 360°",
      "--source-image-url",
      "https://r2.example/lantern.png",
      "--json",
    )
    expect(mocks.generateMotion).toHaveBeenCalledTimes(1)
    const arg = mocks.generateMotion.mock.calls[0][0] as Record<string, unknown>
    expect(arg.name).toBe("Antique Lantern")
    expect(arg.motionPrompt).toBe("slow rotation 360°")
    expect(arg.sourceImageUrl).toBe("https://r2.example/lantern.png")
    // Object-specific defaults from commander: kling-turbo + 1:1, NOT kling +
    // 16:9 (which are locations' defaults).
    expect(arg.provider).toBe("kling-turbo")
    expect(arg.style).toBe("realistic")
    expect(arg.aspectRatio).toBe("1:1")
    // Optional fields the user didn't supply must not silently appear on the
    // payload — they round-trip undefined so the route's Zod treats them as
    // omitted rather than empty strings.
    expect(arg.canonicalDescription).toBeUndefined()
    expect(arg.attachToObjectId).toBeUndefined()
    expect(arg.attachName).toBeUndefined()
  })

  it("generate-motion forwards optional attach + aspect-ratio override (4:3)", async () => {
    mocks.generateMotion.mockResolvedValueOnce({ jobId: "motion-job-2" })
    await runCmd(
      "objects",
      "generate-motion",
      "--name",
      "Lantern",
      "--motion-prompt",
      "orbit pan",
      "--source-image-url",
      "https://r2.example/lantern.png",
      "--provider",
      "seedance-2",
      "--style",
      "anime",
      "--canonical-description",
      "weathered brass lantern hanging by chain",
      "--attach-to-object-id",
      "obj-77",
      "--attach-name",
      "orbit-pan",
      "--aspect-ratio",
      "4:3",
      "--seed-prompt-hint",
      "antique brass",
      "--json",
    )
    expect(mocks.generateMotion).toHaveBeenCalledWith({
      name: "Lantern",
      motionPrompt: "orbit pan",
      sourceImageUrl: "https://r2.example/lantern.png",
      provider: "seedance-2",
      style: "anime",
      canonicalDescription: "weathered brass lantern hanging by chain",
      attachToObjectId: "obj-77",
      attachName: "orbit-pan",
      aspectRatio: "4:3",
      seedPromptHint: "antique brass",
    })
  })

  it("generate-motion errors when --motion-prompt is missing", async () => {
    // Commander rejects missing required options BEFORE our action runs; we
    // assert the SDK was never called and exitOverride surfaces the error.
    await expect(
      runCmd(
        "objects",
        "generate-motion",
        "--name",
        "Lantern",
        "--source-image-url",
        "https://r2.example/lantern.png",
        "--json",
      ),
    ).rejects.toThrow()
    expect(mocks.generateMotion).not.toHaveBeenCalled()
  })
})
