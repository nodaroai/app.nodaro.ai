/**
 * The image routes beside generate-image — image-to-image, edit-image,
 * split-image, generate-mask — have typed overloads on `nodes.run` /
 * `runAndWait`, so an app stops sending them as an untyped
 * `Record<string, unknown>`.
 *
 * vitest does not typecheck: the `expectTypeOf` pins and `@ts-expect-error`
 * lines below are checked by `tsc --noEmit -p packages/client`, run by hand.
 * Nothing in CI runs that, or this SDK vitest suite — a known coverage gap.
 * The runtime cases pin the wire (path + body passthrough, session fields
 * included).
 *
 * The params types check a body TYPED as them (`satisfies EditImageParams`,
 * or an annotated variable). A body written inline that a typed overload
 * rejects falls through to the untyped `run(type: string, …)` overload and
 * still compiles — pinned below so the docs keep saying so.
 * The field lists are held to the route Zod bodies by
 * backend/src/routes/__tests__/sdk-image-params-contract.test.ts.
 */
import { describe, it, expect, expectTypeOf, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../index.js"
import type {
  EditImageParams,
  GenerateImageParams,
  GenerateMaskJobOutput,
  GenerateMaskOutput,
  GenerateMaskParams,
  GenerateMaskRequest,
  GenerationSessionParams,
  ImageJobStarted,
  ImageToImageParams,
  ModifyImageProvider,
  NodeJobOutput,
  RunNodeResult,
  SplitImageParams,
  SplitImageResult,
  TaskChainedEditProvider,
} from "../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}

type FetchMock = ReturnType<typeof vi.fn> & typeof fetch

/** Answers the POST with `runBody`, then every status poll with a completed job writing `output`. */
function runThenCompleted(runBody: unknown, output: Record<string, unknown> = {}): FetchMock {
  return vi.fn((_url: string, init: { method: string }) => {
    if (init.method === "POST") return mockOk(runBody)
    return mockOk({ data: { id: "job-1", progress: 100, status: "completed", output_data: output } })
  }) as unknown as FetchMock
}

function client(fetchMock: FetchMock) {
  return createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
}

/** The path and JSON body of the first request. */
function firstPost(fetchMock: FetchMock): { path: string; body: Record<string, unknown> } {
  const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }]
  expect(init.method).toBe("POST")
  return { path: new URL(url).pathname, body: JSON.parse(init.body) as Record<string, unknown> }
}

const SESSION = { sessionId: "00000000-0000-4000-8000-0000000000aa", origin: "create-image" }

describe("the typed overloads (compile-time pins)", () => {
  it("run answers a typed job start for the three job routes, and the tiles for split-image", () => {
    type Nodes = ReturnType<typeof createClient>["nodes"]
    const nodes = {} as Nodes
    const lazy = <T>(f: () => T) => f
    expectTypeOf(lazy(() => nodes.run("image-to-image", { imageUrl: "u", prompt: "p" }))).returns.resolves.toEqualTypeOf<ImageJobStarted>()
    expectTypeOf(lazy(() => nodes.run("edit-image", { imageUrl: "u" }))).returns.resolves.toEqualTypeOf<ImageJobStarted>()
    expectTypeOf(lazy(() => nodes.run("generate-mask", { imageUrl: "u", prompt: "the car" }))).returns.resolves.toEqualTypeOf<ImageJobStarted>()
    expectTypeOf(lazy(() => nodes.run("split-image", { imageUrl: "u", gridCols: 2, gridRows: 1, names: ["a", "b"] }))).returns.resolves.toEqualTypeOf<SplitImageResult>()
    expectTypeOf<ImageJobStarted["jobId"]>().toEqualTypeOf<string>()
    expectTypeOf<SplitImageResult["images"]>().toEqualTypeOf<{ name: string; url: string }[]>()
  })

  it("runAndWait resolves the job's output; generate-mask's carries imageUrl + maskUrl, typed", () => {
    type Nodes = ReturnType<typeof createClient>["nodes"]
    const nodes = {} as Nodes
    const lazy = <T>(f: () => T) => f
    expectTypeOf(lazy(() => nodes.runAndWait("image-to-image", { imageUrl: "u", prompt: "p" }))).returns.resolves.toEqualTypeOf<NodeJobOutput>()
    expectTypeOf(lazy(() => nodes.runAndWait("edit-image", { taskId: "t", provider: "grok-2-segment" }))).returns.resolves.toEqualTypeOf<NodeJobOutput>()
    expectTypeOf(lazy(() => nodes.runAndWait("generate-mask", { imageUrl: "u", prompt: "the car" }))).returns.resolves.toEqualTypeOf<GenerateMaskJobOutput>()
    expectTypeOf<GenerateMaskJobOutput["maskUrl"]>().toEqualTypeOf<string>()
    expectTypeOf<GenerateMaskJobOutput["imageUrl"]>().toEqualTypeOf<string>()
    // One source: the job output is the shared contract on top of NodeJobOutput (assignable both ways),
    // and the params are the shared request plus the session fields.
    expectTypeOf<GenerateMaskJobOutput>().toEqualTypeOf<NodeJobOutput & GenerateMaskOutput>()
    expectTypeOf<GenerateMaskJobOutput>().toExtend<GenerateMaskOutput>()
    expectTypeOf<GenerateMaskParams>().toExtend<GenerateMaskRequest & GenerationSessionParams>()
    expectTypeOf<Pick<GenerateMaskParams, keyof GenerateMaskRequest>>().toEqualTypeOf<Pick<GenerateMaskRequest, keyof GenerateMaskRequest>>()
    // A generic caller (type only known as a type parameter) gets the mask output too.
    const generic = <T extends string>(type: T) => nodes.runAndWait(type, {})
    expectTypeOf(lazy(() => generic("generate-mask"))).returns.resolves.toEqualTypeOf<GenerateMaskJobOutput>()
  })

  it("the params take the platform's own vocabularies", () => {
    expectTypeOf<ImageToImageParams["provider"]>().toEqualTypeOf<ModifyImageProvider | undefined>()
    expectTypeOf<Extract<EditImageParams, { taskId: string }>["provider"]>().toEqualTypeOf<TaskChainedEditProvider>()
    expectTypeOf<TaskChainedEditProvider>().toEqualTypeOf<"grok-2-edit" | "grok-2-segment">()
    expectTypeOf<GenerateImageParams["baseImageUrl"]>().toEqualTypeOf<string | undefined>()
    expectTypeOf<GenerateImageParams["maskUrl"]>().toEqualTypeOf<string | undefined>()
  })

  it("rejects the bodies the routes would refuse", () => {
    // @ts-expect-error — recraft-upscale takes an image URL, not a Grok task id
    const taskOnUrlProvider: EditImageParams = { taskId: "t", provider: "recraft-upscale" }
    // @ts-expect-error — exactly one source: an image URL or a task id, never both
    const bothSources: EditImageParams = { imageUrl: "u", taskId: "t", provider: "grok-2-segment" }
    // @ts-expect-error — the Grok task ops take a task id, not an image URL
    const urlOnTaskProvider: EditImageParams = { imageUrl: "u", provider: "grok-2-edit" }
    // @ts-expect-error — not an image-to-image model
    const unknownProvider: ImageToImageParams = { imageUrl: "u", prompt: "p", provider: "not-a-model" }
    // @ts-expect-error — not a resolution the route accepts
    const badResolution: ImageToImageParams = { imageUrl: "u", prompt: "p", resolution: "16K" }
    // @ts-expect-error — prompt is required on image-to-image
    const noPrompt: ImageToImageParams = { imageUrl: "u" }
    // @ts-expect-error — what to mask is required
    const noMaskPrompt: GenerateMaskParams = { imageUrl: "u" }
    // @ts-expect-error — split-image needs the grid
    const noGrid: SplitImageParams = { imageUrl: "u", names: ["a"] }
    expect([taskOnUrlProvider, bothSources, urlOnTaskProvider, unknownProvider, badResolution, noPrompt, noMaskPrompt, noGrid]).toHaveLength(8)
  })

  it("`satisfies` checks an inline body and keeps the typed answer; without it a rejected body falls through untyped", () => {
    type Nodes = ReturnType<typeof createClient>["nodes"]
    const nodes = {} as Nodes
    const lazy = <T>(f: () => T) => f
    // The docs' example form: literal providers survive `satisfies`, so the typed overload is chosen.
    expectTypeOf(lazy(() => nodes.run("edit-image", { imageUrl: "u", provider: "topaz-image-upscale", upscaleFactor: "4" } satisfies EditImageParams))).returns.resolves.toEqualTypeOf<ImageJobStarted>()
    expectTypeOf(lazy(() => nodes.runAndWait("generate-mask", { imageUrl: "u", prompt: "the car" } satisfies GenerateMaskParams))).returns.resolves.toEqualTypeOf<GenerateMaskJobOutput>()
    // @ts-expect-error — under `satisfies`, a task id on recraft-upscale is refused
    lazy(() => nodes.run("edit-image", { taskId: "t", provider: "recraft-upscale" } satisfies EditImageParams))
    // Inline and unchecked, the same body compiles against the untyped overload.
    expectTypeOf(lazy(() => nodes.run("edit-image", { taskId: "t", provider: "recraft-upscale" }))).returns.resolves.toEqualTypeOf<RunNodeResult>()
    expectTypeOf(lazy(() => nodes.run("image-to-image", { imageUrl: "u" }))).returns.resolves.toEqualTypeOf<RunNodeResult>()
  })
})

describe("the wire: each route's path, and the body passed through as sent", () => {
  it("image-to-image posts to /v1/image-to-image and resolves the job start", async () => {
    const fetchMock = runThenCompleted({ jobId: "j-i2i", adjustments: [] })
    const params: ImageToImageParams = { imageUrl: "https://x/a.png", prompt: "watercolor", provider: "flux-fill", maskUrl: "https://x/m.png", resolution: "2K", ...SESSION }
    const started = await client(fetchMock).nodes.run("image-to-image", params)
    expect(started.jobId).toBe("j-i2i")
    expect(firstPost(fetchMock)).toEqual({ path: "/v1/image-to-image", body: params })
  })

  it("edit-image posts either source form to /v1/edit-image", async () => {
    const byUrl = runThenCompleted({ jobId: "j-edit" })
    await client(byUrl).nodes.run("edit-image", { imageUrl: "https://x/a.png", provider: "topaz-image-upscale", upscaleFactor: "4", ...SESSION })
    expect(firstPost(byUrl)).toEqual({ path: "/v1/edit-image", body: { imageUrl: "https://x/a.png", provider: "topaz-image-upscale", upscaleFactor: "4", ...SESSION } })

    const byTask = runThenCompleted({ jobId: "j-grok" }, { imageUrl: "https://r2/out.png" })
    const output = await client(byTask).nodes.runAndWait("edit-image", { taskId: "kie-123", provider: "grok-2-edit", prompt: "make it night", maskIndexes: [0, 2], ...SESSION })
    expect(firstPost(byTask)).toEqual({ path: "/v1/edit-image", body: { taskId: "kie-123", provider: "grok-2-edit", prompt: "make it night", maskIndexes: [0, 2], ...SESSION } })
    expect(output.imageUrl).toBe("https://r2/out.png")
  })

  it("split-image posts to /v1/split-image and answers the tiles (no job, no poll)", async () => {
    const tiles = [{ name: "front", url: "https://r2/front.png" }, { name: "back", url: "https://r2/back.png" }]
    const fetchMock = runThenCompleted({ images: tiles })
    const params: SplitImageParams = { imageUrl: "https://x/sheet.png", gridCols: 2, gridRows: 1, names: ["front", "back"] }
    const result = await client(fetchMock).nodes.run("split-image", params)
    expect(result.images).toEqual(tiles)
    expect(firstPost(fetchMock)).toEqual({ path: "/v1/split-image", body: params })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("generate-mask posts to /v1/generate-mask; runAndWait resolves the image + mask pair", async () => {
    const pair = { imageUrl: "https://x/a.png", maskUrl: "https://r2/mask.png" }
    const fetchMock = runThenCompleted({ jobId: "j-mask" }, pair)
    const output = await client(fetchMock).nodes.runAndWait("generate-mask", { imageUrl: "https://x/a.png", prompt: "the red car", threshold: 0.4, ...SESSION }, { pollMs: 1 })
    expect(firstPost(fetchMock)).toEqual({ path: "/v1/generate-mask", body: { imageUrl: "https://x/a.png", prompt: "the red car", threshold: 0.4, ...SESSION } })
    expect(output).toEqual(pair)
  })

  it("generate-image's inpaint fields travel under their own names", async () => {
    const fetchMock = runThenCompleted({ jobId: "j-inpaint" })
    const params: GenerateImageParams = { prompt: "a red hat", provider: "gpt-image-2", baseImageUrl: "https://x/base.png", maskUrl: "https://x/m.png", strength: 0.7, guidanceScale: 5, ...SESSION }
    await client(fetchMock).nodes.run("generate-image", params)
    expect(firstPost(fetchMock)).toEqual({ path: "/v1/generate-image", body: params })
  })
})
