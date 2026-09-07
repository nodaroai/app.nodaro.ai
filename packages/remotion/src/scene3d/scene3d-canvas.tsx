/**
 * Frame-exact Scene3D canvas — the ONE renderer shared by the browser preview
 * and the Remotion export.
 *
 * Deliberately native three.js (no @react-three/fiber): r3f ships its own React
 * reconciler pinned to React 18, while this monorepo pins React 19 for the
 * frontend and Remotion bundles its own tree — a shared r3f component would
 * have to exist twice. An imperative canvas has no reconciler at all, so the
 * SAME component renders in the editor and in the render worker, and the pixels
 * come from the same `sampleScene3DFrame` call.
 *
 * This module must NOT import `remotion` — the frontend imports it directly.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import * as THREE from "three"
import { buildScene3DScene, type Scene3DSceneHandle } from "./scene-builder"
import type { Scene3DPlan } from "./types"

export interface Scene3DCanvasProps {
  plan: Scene3DPlan
  /** Zero-based frame to display. The only time input this component accepts. */
  frame: number
  className?: string
  style?: React.CSSProperties
  /** Ids to highlight (selection lives in the host UI). */
  selectedObjectIds?: readonly string[]
  /** Fired with the object id under the pointer, or null when clicking empty space. */
  onSelectObject?: (objectId: string | null) => void
  /**
   * Called once the first frame has actually been drawn. The Remotion wrapper
   * uses it to release its `delayRender` handle.
   */
  onFirstDraw?: () => void
  /**
   * WebGL is unavailable or the context was lost. In the browser this is a
   * degraded preview; in an export it MUST fail the render rather than encode
   * a placeholder — the Remotion wrapper maps it to `cancelRender`.
   */
  onContextError?: (error: Error) => void
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

export function Scene3DCanvas({
  plan,
  frame,
  className,
  style,
  selectedObjectIds,
  onSelectObject,
  onFirstDraw,
  onContextError,
}: Scene3DCanvasProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const handleRef = useRef<Scene3DSceneHandle | null>(null)
  const drawnRef = useRef(false)
  const contextDisposalRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [contextError, setContextError] = useState<string | null>(null)

  const selectionKey = (selectedObjectIds ?? []).join(" ")

  // Keep the latest callbacks without re-creating the WebGL context.
  const onContextErrorRef = useRef(onContextError)
  onContextErrorRef.current = onContextError
  const onFirstDrawRef = useRef(onFirstDraw)
  onFirstDrawRef.current = onFirstDraw

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
      fail(
        `WebGL is unavailable in this browser (${err instanceof Error ? err.message : String(err)}).`,
      )
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
    let handle: Scene3DSceneHandle
    try {
      handle = buildScene3DScene(plan)
    } catch (error) {
      fail(`Failed to build the 3D scene: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    handleRef.current = handle
    return () => {
      handle.dispose()
      handleRef.current = null
    }
  }, [plan, fail])


  // Draw the requested frame. Layout effect means synchronous, before paint, so
  // a screenshot taken right after the React commit sees this frame.
  useLayoutEffect(() => {
    const renderer = rendererRef.current
    const handle = handleRef.current
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
      fail(`Failed to draw the 3D scene: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    if (!drawnRef.current) {
      drawnRef.current = true
      onFirstDrawRef.current?.()
    }
    // selectionKey (not the array) keeps a fresh array literal from redrawing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, plan, selectionKey, fail])

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
      const hits = raycaster.intersectObjects([...handle.meshes.values()], false)
      const objectId = hits.length > 0 ? (hits[0].object.userData.objectId as string) : null
      onSelectObject(objectId ?? null)
    },
    [onSelectObject],
  )

  if (contextError) {
    return (
      <div className={className} style={{ ...FALLBACK_STYLE, ...style }} role="alert">
        <strong>3D preview unavailable</strong>
        <span>{contextError}</span>
        <span style={{ color: "#a1a1aa" }}>
          The scene is safe — {plan.objects?.length ?? 0} object
          {(plan.objects?.length ?? 0) === 1 ? "" : "s"} and its camera are still stored, and
          rendering to video does not depend on this preview. Try a different browser, enable
          hardware acceleration, or reload the tab.
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
