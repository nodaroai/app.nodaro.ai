// The chrome every tutorial shares: app bar, mode switch, step rail, and the
// read-only Canvas mode. A tutorial's own design lives entirely in its body
// component — the shell owns navigation and focus state, nothing visual about
// the lesson itself.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { surfaceBrandName } from "@/lib/surface-selectors"
import { X } from "lucide-react"
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  useNodesInitialized,
  useReactFlow,
  type Node,
  type Edge,
} from "@xyflow/react"
// Required wherever a ReactFlow is mounted. Without it `.react-flow__viewport`
// loses `transform-origin: 0 0` and scales about its centre, so a correctly
// computed fit still renders the graph far off frame.
import "@xyflow/react/dist/style.css"
import { nodeTypes } from "@/components/nodes"
import { orderNodesParentFirst } from "@/components/editor/workflow-editor/group-coords"
import { migrateSnapshot } from "./migrate-snapshot"
import { useRevealDecision } from "./use-reveal-decision"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import type { TutorialFocus } from "./use-tutorial-focus"
import type { TutorialStep } from "./tutorial-registry"
import "./tutorial-theme.css"

interface TutorialShellProps {
  title: string
  summary: string
  breadcrumb: string
  steps: TutorialStep[]
  chips: string[]
  focus: TutorialFocus
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  /** Optional reassurance block above the rail footer, e.g. "nothing here costs
   *  anything to look at". Tutorials that have nothing to reassure omit it. */
  note?: { eyebrow: string; body: string }
  onRun: () => void
  runLabel: string
  runDisabled?: boolean
  children: ReactNode
}

/** Module-level so the selector identity is stable across renders. */
const COUNT_HIDDEN = { includeHiddenNodes: true } as const

/**
 * Fit once the nodes have been measured, and only then let the canvas be seen.
 *
 * The thing that looked like a broken fit was really a missing loading state:
 * these templates carry dozens of image nodes, and until they measure, React
 * Flow paints edges toward positions the nodes have not reached yet — which
 * reads exactly like lines running off to nowhere.
 *
 * `nodesInitialized` is the signal those old 120/400/900ms retries were
 * guessing at. It is read TWICE, because the two forms are computed by
 * different code paths: the default returns a store flag maintained by
 * `adoptUserNodes`, while `includeHiddenNodes` walks `nodeLookup` and checks
 * measurement directly. On the Multi-Reference Control snapshot the store flag
 * never turns true — even though all eight of its nodes measure correctly in
 * the DOM — so the direct walk is what reports that canvas ready.
 *
 * Neither is trusted as the only path — see `useRevealDecision`, which owns the
 * deadline that keeps "permanently invisible" unreachable.
 */
function FitWhenReady({ empty, onReady }: { empty: boolean; onReady: () => void }) {
  const storeFlag = useNodesInitialized()
  const measured = useNodesInitialized(COUNT_HIDDEN)
  const reveal = useRevealDecision(storeFlag || measured, empty)
  const { fitView } = useReactFlow()
  const done = useRef(false)

  useEffect(() => {
    if (!reveal || done.current) return
    done.current = true
    // With no nodes there is nothing to frame.
    if (!empty) fitView({ padding: 0.1, minZoom: 0.02 })
    // Reveal on the next frame, after the fit transform has been applied, so the
    // first thing anyone sees is the finished framing rather than the jump to it.
    requestAnimationFrame(onReady)
  }, [reveal, empty, fitView, onReady])

  return null
}

/**
 * Canvas mode renders the snapshot through the real node components but with a
 * plain ReactFlow — NOT the editor's WorkflowCanvas, which is wired to the
 * workflow store and autosave. A tutorial must never be able to mutate the
 * template it is teaching.
 */
function TutorialCanvasMode({ nodes, edges }: { nodes: WorkflowNode[]; edges: WorkflowEdge[] }) {
  const prepared = useMemo(() => {
    // Migrate first: an edge pointing at a handle that has since been renamed is
    // dropped by React Flow without a word, which is how this canvas ended up
    // drawing nodes and no connections.
    const migrated = migrateSnapshot(nodes, edges)
    // Sticky notes are dropped on purpose. In a tutorial their content is
    // already presented, better, in Tutorial mode — and in the larger templates
    // they are poster-sized, so leaving them in buries the machine that Canvas
    // mode exists to show. Nothing is lost: the editor still has them.
    const visible = migrated.nodes.filter((n) => n.type !== "sticky-note")
    return {
      // React Flow requires a parent to precede its children.
      nodes: orderNodesParentFirst(visible as unknown as Node[]),
      edges: migrated.edges as unknown as Edge[],
    }
  }, [nodes, edges])
  const stickyCount = nodes.filter((n) => n.type === "sticky-note").length

  const [ready, setReady] = useState(false)

  return (
    <div className="nd-canvas-mode" data-ready={ready}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={prepared.nodes}
          edges={prepared.edges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          edgesFocusable={false}
          // A whole workflow is far wider than the pane, so the fit lands well
          // below React Flow's default 0.5 floor.
          minZoom={0.02}
          proOptions={{ hideAttribution: true }}
          style={{ background: "var(--nd-canvas)" }}
        >
          <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="rgba(255,255,255,0.055)" />
          <FitWhenReady empty={prepared.nodes.length === 0} onReady={() => setReady(true)} />
        </ReactFlow>
      </ReactFlowProvider>
      {!ready && <div className="nd-canvas-loading">Loading canvas…</div>}
      <div className="nd-canvas-note">
        Full canvas — every node editable in the editor. Switch back to Tutorial mode for the guided steps.
      </div>
      <div className="nd-canvas-stats">
        {/* Count what is on screen, and say plainly what is not. */}
        {nodes.length - stickyCount} nodes
        {stickyCount > 0 ? ` / ${stickyCount} sticky notes hidden` : ""}
      </div>
    </div>
  )
}

export function TutorialShell({
  title,
  summary,
  breadcrumb,
  steps,
  chips,
  focus,
  nodes,
  edges,
  note,
  onRun,
  runLabel,
  runDisabled,
  children,
}: TutorialShellProps) {
  const { view, setView, step, focusStep, clearStep } = focus

  return (
    <div className="nd-tutorial">
      <header className="nd-bar">
        {/* The shared <NodaroLogo> picks its asset with Tailwind `dark:` classes,
            which key off the APP's theme. This page is always dark and never sets
            that class, so in a light-themed app it would render the dark-on-light
            mark and near-black text onto a near-black bar. Pin the dark-background
            asset instead of inheriting a theme this page does not follow. */}
        <Link to="/projects" className="nd-wordmark" aria-label={surfaceBrandName()}>
          <img src="/logo-dark.svg?v=4" alt="" className="nd-logo" />
          <span>odaro</span>
        </Link>
        <span className="nd-bar-divider" />
        <nav className="nd-crumb" aria-label="Breadcrumb">
          <Link to="/projects?tab=tutorials">{breadcrumb}</Link>
          <span className="nd-crumb-sep">/</span>
          <span className="nd-crumb-leaf">{title}</span>
        </nav>
        <span className="nd-pill">TUTORIAL</span>

        <span className="nd-spacer" />

        <div className="nd-switch" role="tablist" aria-label="View mode">
          <button
            type="button"
            role="tab"
            aria-selected={view === "tutorial"}
            data-active={view === "tutorial"}
            onClick={() => setView("tutorial")}
          >
            Tutorial mode
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "canvas"}
            data-active={view === "canvas"}
            onClick={() => setView("canvas")}
          >
            Canvas mode
          </button>
        </div>

        <button type="button" className="nd-cta" onClick={onRun} disabled={runDisabled}>
          {runLabel}
        </button>
        {/* A full-screen takeover needs an obvious way out. The logo and the
            breadcrumb both lead home too, but neither reads as "close this". */}
        <Link to="/projects?tab=tutorials" className="nd-close" aria-label="Close tutorial" title="Close tutorial">
          <X className="h-4 w-4" />
        </Link>
      </header>

      <div className="nd-stage">
        {view === "canvas" ? (
          <TutorialCanvasMode nodes={nodes} edges={edges} />
        ) : (
          <div className="nd-scroll">
            <aside className="nd-rail" onMouseLeave={clearStep}>
              <div className="nd-rail-head">
                <div className="nd-eyebrow">Guided tutorial</div>
                <h1 className="nd-rail-title">{title}</h1>
                <p className="nd-rail-desc">{summary}</p>
                <div className="nd-chips">
                  {chips.map((c) => (
                    <span key={c} className="nd-chip">
                      {c}
                    </span>
                  ))}
                </div>
              </div>

              <div className="nd-steps">
                {steps.map((s) => (
                  <button
                    key={s.n}
                    type="button"
                    className="nd-step"
                    data-active={step === s.n}
                    onMouseEnter={() => focusStep(s.n)}
                    onFocus={() => focusStep(s.n)}
                    onClick={() => focusStep(s.n)}
                  >
                    <span className="nd-badge">{String(s.n).padStart(2, "0")}</span>
                    <span>
                      <span className="nd-step-title">{s.title}</span>
                      <span className="nd-step-sub">{s.sub}</span>
                    </span>
                  </button>
                ))}
              </div>

              {note && (
                <div className="nd-rail-note">
                  <div className="nd-eyebrow">{note.eyebrow}</div>
                  <p>{note.body}</p>
                </div>
              )}

              <div className="nd-rail-foot">
                <span>Hover a step to focus it</span>
                <span className="nd-rail-count">
                  {step === 0 ? "overview" : `step ${step} of ${steps.length}`}
                </span>
              </div>
            </aside>

            <main className="nd-body">{children}</main>
          </div>
        )}
      </div>
    </div>
  )
}
