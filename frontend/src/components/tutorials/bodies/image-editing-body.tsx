// The "Get started with image editing" tutorial.
//
// This template is a fan-out, not a pipeline, so it gets a three-column layout
// instead of the step chain the other tutorials use: the original on the left,
// nine results in the middle, and — for whichever result you click — what
// actually produced it on the right.
//
// The teaching point the layout has to carry is that every edit reads the SAME
// original, so nothing stacks and nothing degrades. That is why the results are
// a flat grid rather than a chain, and why the original never changes while you
// click around it.

import { useMemo, useState } from "react"
import { optimizedImageUrl } from "@/lib/image"
import { formatCreditUnits } from "@/lib/credit-units"
import { deriveEditFanOut } from "./image-editing-edits"
import {
  CRITIC_LINE,
  EDIT_ORDER,
  EDIT_PROSE,
  FACTS,
  HEADLINE,
  IN_COLUMN,
  NO_SETTINGS,
  OUT_COLUMN,
  SUBLINE,
} from "./image-editing-content"
import type { TutorialBodyProps } from "../tutorial-registry"
import "./image-editing.css"

/** Which rail step each column belongs to. */
const STEP = { in: 1, out: 2, trace: 3 } as const

/** Ties each result tile to the column it updates, for assistive tech. */
const TRACE_ID = "ied-trace"

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

export default function ImageEditingBody({
  nodes,
  edges,
  focus,
  estimatedCredits,
  onRunNode,
}: TutorialBodyProps) {
  const { step, focusStep } = focus
  const { base, critic, edits } = useMemo(
    () => deriveEditFanOut(nodes, edges, EDIT_ORDER),
    [nodes, edges],
  )

  // Which result is being traced. An index rather than a node id so a template
  // whose ids moved still opens on something.
  const [selected, setSelected] = useState(0)
  const traced = edits[Math.min(selected, Math.max(edits.length - 1, 0))]
  const prose = traced ? EDIT_PROSE[traced.nodeId] : undefined

  /**
   * Dimming is a RAIL gesture, and only a rail gesture.
   *
   * Hovering a column still focuses its step — that is useful, it moves the
   * rail's counter — but it must not quiet the others, because the one
   * interaction this tutorial has is clicking a tile and reading the trace
   * beside it. Dimming on column hover puts the answer at half strength exactly
   * while the cursor is on the question.
   */
  const [inColumns, setInColumns] = useState(false)
  const columnState = (n: number) => ({
    "data-focused": step === n,
    "data-dimmed": !inColumns && step !== 0 && step !== n,
  })

  if (!base) {
    return <div className="nd-state">This tutorial&rsquo;s workflow could not be read.</div>
  }

  return (
    <div className="ied">
      <header className="ied-band">
        <div>
          <h2 className="ied-headline">{HEADLINE}</h2>
          <p className="ied-subline">{SUBLINE}</p>
        </div>
        <div className="nd-chips">
          {FACTS.map((f) => (
            <span key={f} className="nd-chip">
              {f}
            </span>
          ))}
        </div>
      </header>

      <div
        className="ied-cols"
        onMouseEnter={() => setInColumns(true)}
        onMouseLeave={() => setInColumns(false)}
      >
        {/* --- IN: the one image everything reads --------------------------- */}
        <section
          className="ied-panel"
          {...columnState(STEP.in)}
          onMouseEnter={() => focusStep(STEP.in)}
        >
          <header className="ied-head">
            <span className="ied-badge">IN</span>
            <div className="ied-head-text">
              <div className="ied-title">{IN_COLUMN.title}</div>
              <div className="ied-sub">{IN_COLUMN.sub}</div>
            </div>
            {base.chips.length > 0 && <span className="ied-meta">{base.chips.join(" · ")}</span>}
          </header>

          <div className="ied-panel-body">
            {base.imageUrl && (
              <img
                className="ied-base"
                src={optimizedImageUrl(base.imageUrl, { width: 900, quality: 82 })}
                alt="The original image every edit reads"
              />
            )}

            {base.prompt && <pre className="ied-prompt">{base.prompt}</pre>}

            {critic && (
              <div className="ied-critic">
                <div className="ied-critic-top">
                  {critic.score !== null && <span className="ied-score">{critic.score}</span>}
                  <span className="nd-eyebrow">
                    {["Image critic", critic.mode, critic.approved ? "passed" : "below threshold"]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <p className="ied-critic-body">
                  {CRITIC_LINE}
                  {critic.threshold !== null && ` Threshold ${critic.threshold}.`}
                </p>
              </div>
            )}
          </div>
        </section>

        {/* --- the fan ------------------------------------------------------ */}
        <div className="ied-fan" aria-hidden="true">
          <span className="ied-fan-bar" />
          <span className="ied-fan-label">
            FANS
            <br />
            OUT
          </span>
        </div>

        {/* --- OUT: the nine results ---------------------------------------- */}
        <section
          className="ied-panel ied-payoff"
          {...columnState(STEP.out)}
          onMouseEnter={() => focusStep(STEP.out)}
        >
          <header className="ied-head">
            <span className="ied-badge ied-badge-accent">OUT</span>
            <div className="ied-head-text">
              <div className="ied-title">
                {edits.length} {OUT_COLUMN.noun}
              </div>
              <div className="ied-sub">{OUT_COLUMN.sub}</div>
            </div>
            <span className="ied-meta ied-meta-accent">CLICK TO FOLLOW</span>
          </header>

          <div className="ied-grid">
            {edits.map((edit, i) => (
              <button
                key={edit.nodeId}
                type="button"
                className="ied-tile"
                data-selected={i === selected}
                aria-pressed={i === selected}
                // The click's whole effect happens in ANOTHER column, which a
                // sighted user sees and a screen-reader user otherwise would
                // not: name the region the tile drives, and let it announce.
                aria-controls={TRACE_ID}
                onClick={() => setSelected(i)}
              >
                {edit.resultUrl && (
                  <img
                    src={optimizedImageUrl(edit.resultUrl, { width: 420, quality: 78 })}
                    alt=""
                    loading="lazy"
                  />
                )}
                <span className="ied-tile-label">
                  {EDIT_PROSE[edit.nodeId]?.name ?? edit.nodeLabel}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* --- TRACE: what made the selected result ------------------------- */}
        <section
          id={TRACE_ID}
          className="ied-panel"
          // Polite, not assertive: the reader should finish the sentence it is
          // on before hearing the new trace.
          aria-live="polite"
          {...columnState(STEP.trace)}
          onMouseEnter={() => focusStep(STEP.trace)}
        >
          {traced && (
            <>
              <header className="ied-head">
                <span className="ied-badge ied-badge-accent">{pad(traced.index)}</span>
                <div className="ied-head-text">
                  <div className="ied-title">{prose?.name ?? traced.nodeLabel}</div>
                  <div className="ied-sub">{prose?.sub ?? "How this result was made"}</div>
                </div>
              </header>

              <div className="ied-panel-body">
                <div className="ied-compare">
                  <figure>
                    <figcaption className="nd-eyebrow">Before</figcaption>
                    {base.imageUrl && (
                      <img
                        className="ied-before"
                        src={optimizedImageUrl(base.imageUrl, { width: 420, quality: 78 })}
                        alt="The original"
                      />
                    )}
                  </figure>
                  <span className="ied-compare-arrow" aria-hidden="true" />
                  <figure>
                    <figcaption className="nd-eyebrow ied-eyebrow-accent">After</figcaption>
                    {traced.resultUrl && (
                      <img
                        className="ied-after"
                        src={optimizedImageUrl(traced.resultUrl, { width: 420, quality: 78 })}
                        alt={prose?.name ?? traced.nodeLabel}
                      />
                    )}
                  </figure>
                </div>

                <div>
                  <div className="nd-eyebrow">What drove it</div>
                  <div className="ied-driver">
                    <div className="nd-eyebrow ied-eyebrow-accent">{traced.driverKind}</div>
                    <div className="ied-driver-value">{traced.driverValue || NO_SETTINGS}</div>
                  </div>
                </div>

                {prose?.why && (
                  <div>
                    <div className="nd-eyebrow">Why it matters</div>
                    <p className="ied-why">{prose.why}</p>
                  </div>
                )}

                <div className="ied-node-row">
                  <span className="nd-eyebrow">Node</span>
                  <span className="ied-node-name">{traced.nodeLabel}</span>
                  {traced.model && <span className="ied-node-model">{traced.model}</span>}
                </div>

                <button type="button" className="ied-run" onClick={onRunNode}>
                  <span>Open this template</span>
                  {estimatedCredits > 0 && (
                    <span className="ied-run-cost">{formatCreditUnits(estimatedCredits)} to run it all</span>
                  )}
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
