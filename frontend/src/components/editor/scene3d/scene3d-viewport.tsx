"use client"

import { Component, Suspense, useCallback, useMemo, useState, type ReactNode } from "react"
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry"
import { MonitorX } from "lucide-react"
import { hasWebGL } from "@/lib/scene3d/webgl"
import { useT } from "@/lib/i18n"
import { planDimensions } from "@/lib/scene3d/plan-view"
import { validateScene3DPlan } from "@/lib/scene3d/validate-plan"

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
  /** Click-to-select in the viewport; `null` when the click hit empty space. */
  onSelectObject?: (objectId: string | null) => void
}

export function Scene3DViewport({ plan, frame, selectedObjectIds, onSelectObject }: Scene3DViewportProps) {
  const t = useT()
  const webgl = useMemo(() => hasWebGL(), [])
  const [contextError, setContextError] = useState<string | null>(null)
  const { width, height } = planDimensions(plan)
  const style = useMemo(
    () => ({ width: "100%", aspectRatio: String(width / height) }),
    [width, height],
  )
  const handleContextError = useCallback((err: Error) => setContextError(err.message), [])

  // Validate ONCE per plan object, before the lazy chunk is even asked for.
  // The canvas allocates a GPU buffer per object and walks the parent chain, so
  // an imported/agent-authored plan with a huge object array or a parent cycle
  // has to be refused HERE — after the chunk loads is after the damage. The
  // plan itself is left untouched on the node either way.
  const validation = useMemo(() => validateScene3DPlan(plan), [plan])

  if (!validation.ok) {
    return (
      <div style={style}>
        <Unavailable reason={`${t("cfgext.scene3dInvalidPlan")} — ${validation.issue}`} />
      </div>
    )
  }

  if (!webgl || contextError) {
    return (
      <div style={style}>
        <Unavailable
          reason={webgl ? t("cfgext.scene3dContextLost") : t("cfgext.scene3dNoWebgl")}
        />
      </div>
    )
  }

  return (
    <div className="rounded-md overflow-hidden border border-[var(--border-primary)]" style={style}>
      <ViewportBoundary fallback={<Unavailable reason={t("cfgext.scene3dViewportCrashed")} />}>
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-full w-full text-[11px] text-muted-foreground">
              {t("cfgext.scene3dLoadingViewport")}
            </div>
          }
        >
          <Scene3DCanvas
            plan={validation.plan}
            frame={frame}
            selectedObjectIds={selectedObjectIds}
            onSelectObject={onSelectObject}
            onContextError={handleContextError}
          />
        </Suspense>
      </ViewportBoundary>
    </div>
  )
}
