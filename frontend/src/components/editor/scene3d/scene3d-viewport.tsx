"use client"

import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry"
import { MonitorX } from "lucide-react"
import { hasWebGL } from "@/lib/scene3d/webgl"
import { useT } from "@/lib/i18n"
import { planDimensions, planRevisionId } from "@/lib/scene3d/plan-view"
import { validateScene3DAnyPlan } from "@/lib/scene3d/validate-plan"
import { scene3DV2Text } from "@/lib/scene3d/v2-strings"
import type { Scene3DAssetResolver } from "@remotion-pkg/scene3d/v2/asset-resolver"
import type { Scene3DReadinessWarning } from "@remotion-pkg/scene3d/v2/errors"

/**
 * The three.js viewport lives in `packages/remotion` so the browser preview and
 * the MP4 export draw the SAME scene from the SAME sampler — a preview that
 * diverges from the render is worse than no preview.
 *
 * It is imported through the existing `@remotion-pkg` source alias (the route
 * `motion-graphics-player-preview.tsx` already takes), from the package's
 * render-runtime-free `scene3d` entry point — that subpath pulls three + React
 * only, never `remotion`. Loaded LAZILY: three is ~600KB and the vast majority
 * of editor sessions never open a 3D node.
 *
 * The canvas draws BOTH schema versions. v1 builds synchronously from the plan;
 * v2 must first download, digest-verify and validate its assets, which is why
 * this component grew a readiness state — see `Scene3DViewportProps`.
 */
const Scene3DCanvas = lazy(() =>
  import("@remotion-pkg/scene3d").then((m) => ({ default: m.Scene3DCanvas })),
)

/**
 * A WebGL context can also die AFTER it mounts (GPU reset, tab discarded), and
 * the lazy chunk itself can fail to load. The boundary keeps both inside the
 * viewport: the surrounding panel — object list, numeric editors, revision
 * history — keeps working on the scene data, which is what the spec requires.
 */
class ViewportBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function Unavailable({ reason }: { reason: string }) {
  const t = useT()
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 h-full w-full rounded-md border border-dashed border-[var(--border-primary)] bg-muted/20 p-3 text-center">
      <MonitorX className="w-5 h-5 text-muted-foreground/60" />
      <p className="text-[11px] text-muted-foreground">{reason}</p>
      <p className="text-[10px] text-muted-foreground/70">{t("cfgext.scene3dDataIntact")}</p>
    </div>
  )
}

export interface Scene3DViewportProps {
  /** The RAW stored plan. Validated here — never handed to the GPU unchecked. */
  plan: Record<string, unknown>
  /** Zero-based frame to draw. The parent owns playback so the transport, the
   *  numeric editors and the canvas can never disagree about "now". */
  frame: number
  selectedObjectIds?: readonly string[]
  /** Click-to-select in the viewport; `null` when the click hit empty space.
   *  For a v2 scene the id is the SEMANTIC entity, not the mesh that was hit. */
  onSelectObject?: (objectId: string | null) => void
  /**
   * Authorized bytes for a v2 scene's assets. REQUIRED for v2 — the plan holds
   * ids and digests only. Ignored for v1. Memoize it per revision at the call
   * site: a new object identity on every render would reload the whole scene.
   */
  assetResolver?: Scene3DAssetResolver
  /** Non-fatal notes from a v2 load (an unmatched colour binding, a frozen
   *  animation). They never change pixels; the panel may surface them. */
  onReadinessWarnings?: (warnings: readonly Scene3DReadinessWarning[]) => void
}

export function Scene3DViewport({
  plan,
  frame,
  selectedObjectIds,
  onSelectObject,
  assetResolver,
  onReadinessWarnings,
}: Scene3DViewportProps) {
  const t = useT()
  const V2_TEXT = scene3DV2Text(t)
  const webgl = useMemo(() => hasWebGL(), [])
  const { width, height } = planDimensions(plan)
  const style = useMemo(
    () => ({ width: "100%", aspectRatio: String(width / height) }),
    [width, height],
  )

  // Validate ONCE per plan object, before the lazy chunk is even asked for.
  // The canvas allocates a GPU buffer per object, walks the parent chain, and
  // for v2 downloads whatever the manifest declares — so an imported or
  // agent-authored plan with a huge object array, a parent cycle or a 4 GiB
  // asset budget has to be refused HERE. After the chunk loads is after the
  // damage. The plan itself is left untouched on the node either way.
  const validation = useMemo(() => validateScene3DAnyPlan(plan), [plan])
  const revisionId = planRevisionId(plan) ?? null
  const isV2 = validation.ok && validation.version === 2

  /**
   * Failure is remembered WITH the revision it happened on.
   *
   * A dead WebGL context and a failed asset download are both terminal for the
   * canvas instance that hit them — the canvas keeps its own error state for
   * the life of its mount. So recovery is a REMOUNT, and the only honest
   * trigger for one is "the scene changed": a later revision (a retry, a
   * repaired build, a parent that can now serve its assets) must be able to
   * draw. Keying the canvas on the revision unconditionally would instead
   * rebuild a WebGL context on every v1 numeric nudge — each nudge is a new
   * revision — so the remount key only moves after a failure.
   */
  const [failure, setFailure] = useState<{ revisionId: string | null; message: string } | null>(null)
  const recoveryRef = useRef(0)
  const [recovery, setRecovery] = useState(0)
  useEffect(() => {
    if (failure && failure.revisionId !== revisionId) {
      recoveryRef.current += 1
      setRecovery(recoveryRef.current)
      setFailure(null)
    }
  }, [failure, revisionId])
  const contextError = failure && failure.revisionId === revisionId ? failure.message : null

  const handleContextError = useCallback(
    (err: Error) => setFailure({ revisionId: planRevisionId(plan) ?? null, message: err.message }),
    [plan],
  )

  /**
   * v2 assets are fetched, digest-checked and validated before the first draw,
   * so there is a real interval with nothing on screen. It is reported rather
   * than left blank, and a failure during it is shown INSTEAD of a frame —
   * there is no path that draws partial data.
   *
   * "Drawn" is stored as the plan it was drawn FOR, not as a boolean reset by
   * an effect: child effects run before parent effects, so a reset effect here
   * would fire immediately AFTER the canvas reported its first draw and pin the
   * overlay over a scene that is already on screen.
   */
  const [drawnPlan, setDrawnPlan] = useState<Record<string, unknown> | null>(null)
  const drawn = drawnPlan === plan
  const handleFirstDraw = useCallback(() => setDrawnPlan(plan), [plan])

  if (!validation.ok) {
    return (
      <div style={style}>
        <Unavailable reason={`${t("cfgext.scene3dInvalidPlan")} — ${validation.issue}`} />
      </div>
    )
  }

  // Checked BEFORE WebGL: a v2 scene with no way to fetch its bytes cannot be
  // drawn by any browser, and "this needs WebGL" would send the user off after
  // a graphics problem they do not have. It is a wiring answer, not a GPU one.
  if (isV2 && !assetResolver) {
    return (
      <div style={style}>
        <Unavailable reason={`${V2_TEXT.assetsUnavailable} — ${V2_TEXT.noResolver}`} />
      </div>
    )
  }

  if (!webgl || contextError) {
    return (
      <div style={style}>
        <Unavailable
          reason={
            !webgl
              ? t("cfgext.scene3dNoWebgl")
              : // A v2 failure is usually an ASSET failure, and its message
                // carries the renderer's `SCENE_*` code — showing it beats
                // "context lost", which would send the user hunting for a GPU
                // problem they do not have. v1 keeps the copy it always had:
                // there are no assets there, so context loss is the only cause.
                isV2
                ? (contextError ?? t("cfgext.scene3dContextLost"))
                : t("cfgext.scene3dContextLost")
          }
        />
      </div>
    )
  }

  return (
    <div className="rounded-md overflow-hidden border border-[var(--border-primary)] relative" style={style}>
      <ViewportBoundary fallback={<Unavailable reason={t("cfgext.scene3dViewportCrashed")} />}>
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-full w-full text-[11px] text-muted-foreground">
              {t("cfgext.scene3dLoadingViewport")}
            </div>
          }
        >
          <Scene3DCanvas
            key={recovery}
            plan={validation.plan}
            frame={frame}
            selectedObjectIds={selectedObjectIds}
            onSelectObject={onSelectObject}
            assetResolver={assetResolver}
            onFirstDraw={handleFirstDraw}
            onReadinessWarnings={onReadinessWarnings}
            onContextError={handleContextError}
          />
        </Suspense>
      </ViewportBoundary>
      {isV2 && !drawn && (
        <div
          role="status"
          className="absolute inset-0 flex items-center justify-center bg-background/70 text-[11px] text-muted-foreground"
        >
          {V2_TEXT.loadingAssets}
        </div>
      )}
    </div>
  )
}
