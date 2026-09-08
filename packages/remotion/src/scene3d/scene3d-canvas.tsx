/**
 * Frame-exact Scene3D canvas — the ONE renderer shared by the browser preview
 * and the Remotion export, for BOTH schema versions.
 *
 * Deliberately native three.js (no @react-three/fiber): r3f ships its own React
 * reconciler pinned to React 18, while this monorepo pins React 19 for the
 * frontend and Remotion bundles its own tree — a shared r3f component would
 * have to exist twice. An imperative canvas has no reconciler at all, so the
 * SAME component renders in the editor and in the render worker, and the pixels
 * come from the same deterministic sample.
 *
 * v1 builds synchronously from the plan. v2 must first FETCH and VALIDATE its
 * assets, so its build is async — but the readiness contract is unchanged and
 * strengthened: `onFirstDraw` fires only after a real frame has been drawn from
 * fully validated bytes, and every failure (no WebGL, bad digest, missing
 * entity root, unsupported feature) goes to `onContextError`, which the Remotion
 * wrapper turns into `cancelRender`. There is no path that draws a placeholder.
 *
 * This module must NOT import `remotion` — the frontend imports it directly.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import * as THREE from "three"
import type { Scene3DRenderHandle } from "./handle"
import { raycastVisibleSceneObjects } from "./handle"
import { buildScene3DScene } from "./scene-builder"
import type { Scene3DPlan } from "@nodaro/shared"
import type { Scene3DAssetResolver } from "./v2/asset-resolver"
import { isScene3DPlanV2 } from "./v2/plan-shape"
import { loadScene3DV2 } from "./v2/load"
import { buildScene3DV2Scene } from "./v2/scene-builder-v2"
import type { Scene3DReadinessWarning } from "./v2/errors"

/**
 * Either schema version — the contract's own union. The canvas dispatches on
 * `schemaVersion` and never asks its caller which one it is holding.
 */
export type Scene3DAnyPlan = Scene3DPlan

export interface Scene3DCanvasProps {
  plan: Scene3DAnyPlan
  /** Zero-based frame to display. The only time input this component accepts. */
  frame: number
  className?: string
  style?: React.CSSProperties
  /** Ids to highlight (selection lives in the host UI). */
  selectedObjectIds?: readonly string[]
  /** Fired with the object id under the pointer, or null when clicking empty space. */
  onSelectObject?: (objectId: string | null) => void
  /**
   * Resolves v2 asset ids to bytes. REQUIRED for a v2 plan — the plan itself
   * carries ids and digests only, never a transport URL. Ignored for v1.
   */
  assetResolver?: Scene3DAssetResolver
  /**
   * Called once the first frame has actually been drawn — for v2 that means
   * after every asset has been downloaded, digest-verified and validated. The
   * Remotion wrapper uses it to release its `delayRender` handle.
   */
  onFirstDraw?: () => void
  /**
   * WebGL is unavailable, the context was lost, or a v2 asset failed. In the
   * browser this is a degraded preview; in an export it MUST fail the render
   * rather than encode a placeholder — the Remotion wrapper maps it to
   * `cancelRender`.
   */
  onContextError?: (error: Error) => void
  /** Non-fatal readiness notes from a v2 load (unmatched colour binding, …). */
  onReadinessWarnings?: (warnings: readonly Scene3DReadinessWarning[]) => void
}

const FALLBACK_STYLE: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: 24,
  textAlign: "center",
  fontFamily: "system-ui, sans-serif",
  fontSize: 14,
  lineHeight: 1.5,
  color: "#e5e7eb",
  background: "#18181b",
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function Scene3DCanvas({
  plan,
  frame,
  className,
  style,
  selectedObjectIds,
  onSelectObject,
  assetResolver,
  onFirstDraw,
  onContextError,
  onReadinessWarnings,
}: Scene3DCanvasProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const handleRef = useRef<Scene3DRenderHandle | null>(null)
  const drawnRef = useRef(false)
  const contextDisposalRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [contextError, setContextError] = useState<string | null>(null)
  // Bumped when an ASYNC (v2) build lands, so the draw effect runs again.
  const [buildTick, setBuildTick] = useState(0)

  const selectionKey = (selectedObjectIds ?? []).join(" ")

  // Keep the latest callbacks without re-creating the WebGL context.
  const onContextErrorRef = useRef(onContextError)
  onContextErrorRef.current = onContextError
  const onFirstDrawRef = useRef(onFirstDraw)
  onFirstDrawRef.current = onFirstDraw
  const onWarningsRef = useRef(onReadinessWarnings)
  onWarningsRef.current = onReadinessWarnings
  // Read through a ref so a fresh resolver object on every host render does not
  // re-download the whole scene; `hasResolver` below still triggers a reload
  // when one ARRIVES (the frontend resolves credentials asynchronously).
  const assetResolverRef = useRef(assetResolver)
  assetResolverRef.current = assetResolver
  const hasResolver = assetResolver !== undefined

  const fail = useCallback((message: string) => {
    setContextError(message)
    onContextErrorRef.current?.(new Error(message))
  }, [])

  // ONE WebGL context per mount. Deliberately not keyed on `plan`: a host that
  // re-creates an equal plan object on every render would otherwise churn
  // contexts (browsers cap them at ~16 and start dropping the oldest).
  useLayoutEffect(() => {
    // StrictMode replays setup immediately after cleanup on the same canvas.
    // Cancel its deferred context loss before constructing the replacement.
    if (contextDisposalRef.current !== null) {
      clearTimeout(contextDisposalRef.current)
      contextDisposalRef.current = null
    }
    const canvas = canvasRef.current
    if (!canvas) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        // Chromium screenshots the page AFTER the draw call returns; without a
        // preserved drawing buffer the capture can come back blank.
        preserveDrawingBuffer: true,
      })
    } catch (err) {
      fail(`WebGL is unavailable in this browser (${describeError(err)}).`)
      return
    }

    renderer.setPixelRatio(1)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    rendererRef.current = renderer
    drawnRef.current = false
    setContextError(null)

    const onLost = (event: Event) => {
      event.preventDefault()
      fail("The WebGL context was lost while rendering the 3D scene.")
    }
    canvas.addEventListener("webglcontextlost", onLost)

    return () => {
      canvas.removeEventListener("webglcontextlost", onLost)
      renderer.dispose()
      contextDisposalRef.current = setTimeout(() => {
        renderer.forceContextLoss()
        contextDisposalRef.current = null
      }, 0)
      rendererRef.current = null
    }
  }, [fail])

  // Rebuild the three graph when the plan changes. Plans are immutable
  // revisions, so identity IS the content.
  useLayoutEffect(() => {
    if (!rendererRef.current) return

    if (!isScene3DPlanV2(plan)) {
      let handle: Scene3DRenderHandle
      try {
        handle = buildScene3DScene(plan)
      } catch (error) {
        fail(`Failed to build the 3D scene: ${describeError(error)}`)
        return
      }
      handleRef.current = handle
      return () => {
        handle.dispose()
        handleRef.current = null
      }
    }

    // v2: fetch + verify + validate every asset BEFORE anything is drawn.
    // The AbortSignal matters — StrictMode double-invokes this effect and a
    // plan can change mid-flight; without it the first load would finish into
    // a handle the second one has already replaced.
    const controller = new AbortController()
    let built: Scene3DRenderHandle | null = null
    let cancelled = false

    void (async () => {
      try {
        const loaded = await loadScene3DV2(plan, {
          resolver: assetResolverRef.current,
          signal: controller.signal,
        })
        if (cancelled || controller.signal.aborted) return
        built = buildScene3DV2Scene(loaded)
        handleRef.current = built
        if (loaded.warnings.length > 0) onWarningsRef.current?.(loaded.warnings)
        setBuildTick((tick) => tick + 1)
      } catch (error) {
        if (cancelled || controller.signal.aborted) return
        if (error instanceof Error && error.name === "AbortError") return
        fail(`Failed to load the 3D scene: ${describeError(error)}`)
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
      built?.dispose()
      if (handleRef.current === built) handleRef.current = null
    }
  }, [plan, hasResolver, fail])

  // Draw the requested frame. Layout effect means synchronous, before paint, so
  // a screenshot taken right after the React commit sees this frame.
  useLayoutEffect(() => {
    const renderer = rendererRef.current
    const handle = handleRef.current
    // For v2 this is the pre-readiness state: NOT an error, and deliberately
    // NOT a first draw either, so `delayRender` stays held.
    if (!renderer || !handle) return
    try {
      // Exact-frame output: one device pixel per plan pixel, regardless of the
      // CSS box the preview is laid out in. Sized HERE rather than in its own
      // effect so it cannot be skipped when the renderer is re-created without
      // the plan dimensions changing (React StrictMode's double-invoke does
      // exactly that, and three's default backing store is 300x150).
      if (renderer.domElement.width !== plan.width || renderer.domElement.height !== plan.height) {
        renderer.setSize(plan.width, plan.height, false)
      }
      handle.setSelected(selectedObjectIds ?? [])
      handle.applyFrame(frame)
      renderer.render(handle.scene, handle.camera)
    } catch (err) {
      fail(`Failed to draw the 3D scene: ${describeError(err)}`)
      return
    }
    if (!drawnRef.current) {
      drawnRef.current = true
      onFirstDrawRef.current?.()
    }
    // selectionKey (not the array) keeps a fresh array literal from redrawing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, plan, selectionKey, buildTick, fail])

  // A context error before the first draw would otherwise leave an export
  // waiting on a handle that never resolves.
  useEffect(() => {
    if (contextError) drawnRef.current = true
  }, [contextError])

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const handle = handleRef.current
      const canvas = canvasRef.current
      if (!handle || !canvas || !onSelectObject) return
      const rect = canvas.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      )
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(pointer, handle.camera)
      // `true` (recursive) so a hit on any exported sub-mesh of a v2 entity
      // still resolves; `userData.objectId` maps it back to the SEMANTIC
      // entity rather than to the Blender mesh that happened to be in front.
      const hits = raycastVisibleSceneObjects(raycaster, handle.raycastTargets)
      const objectId = hits.length > 0 ? (hits[0].object.userData.objectId as string) : null
      onSelectObject(objectId ?? null)
    },
    [onSelectObject],
  )

  if (contextError) {
    const objectCount = plan.objects?.length ?? 0
    return (
      <div className={className} style={{ ...FALLBACK_STYLE, ...style }} role="alert">
        <strong>3D preview unavailable</strong>
        <span>{contextError}</span>
        <span style={{ color: "#a1a1aa" }}>
          The scene is safe — {objectCount} object
          {objectCount === 1 ? "" : "s"} and its camera are still stored, and rendering to video
          does not depend on this preview. Try a different browser, enable hardware acceleration,
          or reload the tab.
        </span>
      </div>
    )
  }

  return (
    <canvas
      ref={canvasRef}
      className={className}
      width={plan.width}
      height={plan.height}
      onPointerDown={onSelectObject ? handlePointerDown : undefined}
      style={{ width: "100%", height: "100%", display: "block", ...style }}
    />
  )
}
