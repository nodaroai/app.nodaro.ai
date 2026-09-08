// @vitest-environment jsdom
import { StrictMode } from "react"
import { render, cleanup, act, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The v2 readiness contract, at the component boundary.
 *
 * The one thing that must never happen is `onFirstDraw` firing before the
 * assets are real — the Remotion wrapper turns it into `continueRender`, and a
 * released handle over an empty scene is exactly how a placeholder MP4 gets
 * encoded and billed. Everything here is about WHEN that callback fires and
 * what happens when it must not fire at all.
 */
const state = vi.hoisted(() => ({
  lost: new WeakSet<HTMLCanvasElement>(),
  draw: vi.fn(),
  dispose: vi.fn(),
}))
vi.mock("three", async (original) => ({
  ...(await original<typeof import("three")>()),
  WebGLRenderer: class {
    shadowMap = { enabled: false, type: 0 }
    domElement: HTMLCanvasElement
    outputColorSpace = ""
    constructor({ canvas }: { canvas: HTMLCanvasElement }) {
      if (state.lost.has(canvas)) throw new Error("The canvas context was lost")
      this.domElement = canvas
    }
    setPixelRatio() {}
    setSize(width: number, height: number) {
      this.domElement.width = width
      this.domElement.height = height
    }
    render() {
      state.draw(this.shadowMap.enabled)
    }
    dispose() {
      state.dispose()
    }
    forceContextLoss() {
      state.lost.add(this.domElement)
    }
  },
}))

const { Scene3DCanvas } = await import("../scene3d-canvas")
const { makeGlb } = await import("../v2/__tests__/glb-fixtures")
const { makeLoadableScene, memoryResolver } = await import("../v2/__tests__/v2-fixtures")
const { makePlan } = await import("./fixtures")

const CAR = makeGlb({
  nodes: [
    { name: "car", entityRootId: "car", children: [{ name: "car/body", mesh: true }] },
  ],
})

const CAR_ENTITY = {
  id: "car",
  name: "CarEntity",
  visual: { kind: "asset" as const, assetId: "glb", rootNodeId: "car" },
}

/** Let the loader's promise chain settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/**
 * Wait for the load to actually finish.
 *
 * A fixed number of microtask turns is not enough: `GLTFLoader.parse` runs its
 * own promise chain, so under load the settle() above can return before the
 * build lands. Polling on the OUTCOME keeps the assertion honest instead of
 * making it depend on how busy the machine is.
 */
async function until(assertion: () => void): Promise<void> {
  // `waitFor` already wraps its polling in `act`; nesting it inside another
  // `act` deadlocks, because the outer one never yields to the timers the
  // inner one is waiting on.
  await waitFor(assertion, { timeout: 2000 })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.lost = new WeakSet()
})
afterEach(() => cleanup())

describe("v2 readiness gating", () => {
  it("does NOT report a first draw until every asset has loaded", async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { plan, bytes } = makeLoadableScene({ glb: CAR, objects: [CAR_ENTITY] })
    const resolver = {
      async resolve(ref: { assetId: string }) {
        await gate
        return bytes[ref.assetId]
      },
    }
    const onFirstDraw = vi.fn()
    const onContextError = vi.fn()

    render(
      <Scene3DCanvas
        plan={plan}
        frame={0}
        assetResolver={resolver}
        onFirstDraw={onFirstDraw}
        onContextError={onContextError}
      />,
    )

    await settle()
    // The gate is still closed: nothing has been drawn and nothing has failed.
    expect(onFirstDraw).not.toHaveBeenCalled()
    expect(onContextError).not.toHaveBeenCalled()
    expect(state.draw).not.toHaveBeenCalled()

    release?.()
    await until(() => expect(onFirstDraw).toHaveBeenCalledTimes(1))

    expect(state.draw).toHaveBeenCalled()
    expect(onContextError).not.toHaveBeenCalled()
  })

  it("reports a fatal error (never a first draw) when a digest does not match", async () => {
    const { plan, bytes } = makeLoadableScene({ glb: CAR, objects: [CAR_ENTITY] })
    const tampered = { ...bytes, glb: makeGlb({ nodes: [{ name: "other", entityRootId: "car", mesh: true }] }) }
    const onFirstDraw = vi.fn()
    const onContextError = vi.fn()

    render(
      <Scene3DCanvas
        plan={plan}
        frame={0}
        assetResolver={memoryResolver(tampered)}
        onFirstDraw={onFirstDraw}
        onContextError={onContextError}
      />,
    )
    await until(() => expect(onContextError).toHaveBeenCalledTimes(1))

    expect(onContextError.mock.calls[0][0].message).toMatch(/SCENE_ASSET_INVALID/)
    expect(onFirstDraw).not.toHaveBeenCalled()
    expect(state.draw).not.toHaveBeenCalled()
  })

  it("fails when a v2 plan arrives with no resolver at all", async () => {
    const { plan } = makeLoadableScene({})
    const onContextError = vi.fn()
    render(<Scene3DCanvas plan={plan} frame={0} onContextError={onContextError} />)
    await until(() => expect(onContextError).toHaveBeenCalled())
    expect(onContextError.mock.calls[0][0].message).toMatch(/no asset resolver was supplied/)
  })

  it("surfaces a missing entity root as a fatal error", async () => {
    const { plan, resolver } = makeLoadableScene({
      glb: CAR,
      objects: [
        { ...CAR_ENTITY, visual: { kind: "asset" as const, assetId: "glb", rootNodeId: "ghost" } },
      ],
    })
    const onContextError = vi.fn()
    render(
      <Scene3DCanvas plan={plan} frame={0} assetResolver={resolver} onContextError={onContextError} />,
    )
    await until(() => expect(onContextError).toHaveBeenCalled())
    expect(onContextError.mock.calls[0][0].message).toMatch(/SCENE_ASSET_BINDING/)
  })

  it("aborts the in-flight load when the component unmounts", async () => {
    let sawAbort = false
    const { plan, bytes } = makeLoadableScene({ glb: CAR, objects: [CAR_ENTITY] })
    const resolver = {
      async resolve(ref: { assetId: string }, signal: AbortSignal) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 50)
          signal.addEventListener("abort", () => {
            sawAbort = true
            clearTimeout(timer)
            reject(new DOMException("aborted", "AbortError"))
          })
        })
        return bytes[ref.assetId]
      },
    }
    const onContextError = vi.fn()
    const { unmount } = render(
      <Scene3DCanvas plan={plan} frame={0} assetResolver={resolver} onContextError={onContextError} />,
    )
    await settle()
    unmount()
    await settle()
    expect(sawAbort).toBe(true)
    // An abort is a lifecycle event, not a scene defect: it must not be
    // reported as a render failure.
    expect(onContextError).not.toHaveBeenCalled()
  })

  it("survives StrictMode's double invoke and still reports exactly one first draw", async () => {
    const { plan, resolver } = makeLoadableScene({ glb: CAR, objects: [CAR_ENTITY] })
    const onFirstDraw = vi.fn()
    const onContextError = vi.fn()
    render(
      <StrictMode>
        <Scene3DCanvas
          plan={plan}
          frame={0}
          assetResolver={resolver}
          onFirstDraw={onFirstDraw}
          onContextError={onContextError}
        />
      </StrictMode>,
    )
    await until(() => expect(onFirstDraw).toHaveBeenCalledTimes(1))
    expect(onContextError).not.toHaveBeenCalled()
  })

  it("reports readiness warnings without failing the render", async () => {
    const { plan, resolver } = makeLoadableScene({
      glb: makeGlb({ nodes: [{ name: "car", entityRootId: "car", translation: [3, 0, 0],
        children: [{ name: "car/body", mesh: true }] }] }),
      objects: [
        {
          ...CAR_ENTITY,
          position: [2, 0, 0],
        },
      ],
    })
    const onReadinessWarnings = vi.fn()
    const onFirstDraw = vi.fn()
    render(
      <Scene3DCanvas
        plan={plan}
        frame={0}
        assetResolver={resolver}
        onFirstDraw={onFirstDraw}
        onReadinessWarnings={onReadinessWarnings}
      />,
    )
    await until(() => expect(onFirstDraw).toHaveBeenCalledTimes(1))
    expect(onReadinessWarnings).toHaveBeenCalledWith([
      expect.objectContaining({ code: "SCENE_ENTITY_TRANSFORM_IGNORED" }),
    ])
  })

  it("does not release render readiness when an editable material role has no material", async () => {
    const { plan, resolver } = makeLoadableScene({ glb: CAR, objects: [{ ...CAR_ENTITY,
      materialBindings: [{ role: "identity", materialName: "ghost", color: "#ff0000" }],
    }] })
    const onFirstDraw = vi.fn()
    const onContextError = vi.fn()
    render(<Scene3DCanvas plan={plan} frame={0} assetResolver={resolver}
      onFirstDraw={onFirstDraw} onContextError={onContextError} />)
    await until(() => expect(onContextError).toHaveBeenCalledTimes(1))
    expect(onFirstDraw).not.toHaveBeenCalled()
    expect(state.draw).not.toHaveBeenCalled()
  })

  it("redraws when the frame changes, without reloading the assets", async () => {
    const seen: string[] = []
    const { plan, bytes } = makeLoadableScene({ glb: CAR, objects: [CAR_ENTITY] })
    const resolver = memoryResolver(bytes, (assetId) => seen.push(assetId))
    const { rerender } = render(<Scene3DCanvas plan={plan} frame={0} assetResolver={resolver} />)
    await until(() => expect(state.draw).toHaveBeenCalledTimes(1))
    const afterLoad = seen.length

    rerender(<Scene3DCanvas plan={plan} frame={12} assetResolver={resolver} />)
    await settle()
    expect(state.draw).toHaveBeenCalledTimes(2)
    expect(seen.length).toBe(afterLoad)
  })
})

describe("v1 plans still take the synchronous path", () => {
  it("turns off shadow mapping when a shadowed v2 scene is replaced by Basic", async () => {
    const { plan, resolver } = makeLoadableScene({ glb: CAR, objects: [CAR_ENTITY] })
    const shadowed = { ...plan, lighting: { ...plan.lighting, preset: "clay-studio-v2" as const } }
    const { rerender } = render(<Scene3DCanvas plan={shadowed} frame={0} assetResolver={resolver} />)
    await until(() => expect(state.draw).toHaveBeenLastCalledWith(true))
    rerender(<Scene3DCanvas plan={makePlan()} frame={0} />)
    expect(state.draw).toHaveBeenLastCalledWith(false)
  })

  it("draws immediately with no resolver and no awaiting", () => {
    const onFirstDraw = vi.fn()
    render(<Scene3DCanvas plan={makePlan()} frame={0} onFirstDraw={onFirstDraw} />)
    // No `settle()` — a v1 plan must not become async just because v2 exists.
    expect(onFirstDraw).toHaveBeenCalledTimes(1)
    expect(state.draw).toHaveBeenCalledTimes(1)
  })
})
