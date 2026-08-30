// The Multi-Reference Control tutorial.
//
// Bespoke to this lesson: three step groups side by side with the references
// wired into the prompt, then a closing row. The teaching move is the live link
// between a `{image:N}` token and the picture it points at, so hovering a token
// lights the reference, its contribution row, and the explanation at once.

import { useMemo, useRef } from "react"
import { optimizedImageUrl } from "@/lib/image"
import { formatCreditUnits } from "@/lib/credit-units"
import { deriveTutorialGraph, tokenizePrompt } from "../derive-tutorial-data"
import type { TutorialBodyProps } from "../tutorial-registry"
import {
  CLOSING_COLUMNS,
  CONTRIBUTIONS,
  DEFAULT_HINT,
  GROUP_TITLES,
  REFERENCE_ROLES,
  TOKEN_HINTS,
} from "./multi-reference-content"
import { useFanWires } from "./use-fan-wires"
import "./multi-reference.css"

/** Which rail step each group belongs to. */
const STEP = { a: 1, b: 2, c: 3, d: 4 } as const

export default function MultiReferenceBody({
  nodes,
  edges,
  focus,
  estimatedCredits,
  onRunNode,
}: TutorialBodyProps) {
  const { step, reference, focusStep, focusReference, clearReference } = focus
  const graph = useMemo(() => deriveTutorialGraph(nodes, edges), [nodes, edges])
  const parts = useMemo(() => tokenizePrompt(graph.prompt), [graph.prompt])
  const refByPosition = useMemo(
    () => new Map(graph.references.map((r) => [r.position, r])),
    [graph.references],
  )

  const wrapRef = useRef<HTMLDivElement>(null)
  const dotRefs = useRef<Array<HTMLElement | null>>([])
  const promptRef = useRef<HTMLDivElement>(null)
  const wires = useFanWires(wrapRef, dotRefs, promptRef, graph.references.length)

  // Dimming is a RAIL gesture. Hovering a token also focuses step 2, but it
  // must not dim — the whole point of that interaction is to look from the
  // token to the reference it names, and a dimmed group A hides exactly what
  // the user was told to look at. So while a reference is held, every group
  // stays at full strength (this is what the prototype does, and the README's
  // dim rule is written against rail hover only).
  const groupState = (n: number) => ({
    "data-focused": step === n,
    "data-dimmed": reference === 0 && step !== 0 && step !== n,
  })

  const hint = reference ? (TOKEN_HINTS[reference] ?? DEFAULT_HINT) : DEFAULT_HINT

  return (
    <div className="mrc" ref={wrapRef}>
      <svg className="mrc-wires" width={wires.width} height={wires.height} aria-hidden="true">
        <defs>
          <linearGradient id="mrc-wire" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#2ee6d6" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#2ee6d6" stopOpacity="0.75" />
          </linearGradient>
        </defs>
        {wires.paths.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="url(#mrc-wire)" strokeWidth={2} />
        ))}
        {wires.target && <circle cx={wires.target.x} cy={wires.target.y} r={4} fill="#2ee6d6" />}
      </svg>

      <div className="mrc-row">
        {/* --- 01 references --- */}
        <section className="mrc-group" {...groupState(STEP.a)} onMouseEnter={() => focusStep(STEP.a)}>
          <header className="mrc-head">
            <span className="mrc-badge">01</span>
            <div>
              <div className="mrc-title">{GROUP_TITLES.a.title}</div>
              <div className="mrc-sub">{GROUP_TITLES.a.sub}</div>
            </div>
          </header>
          <div className="mrc-panel-body">
            {graph.references.map((ref, i) => (
              <div key={ref.nodeId} className="mrc-ref" data-lit={reference === ref.position}>
                <div
                  className="mrc-thumb"
                  style={ref.imageUrl ? { backgroundImage: `url(${ref.imageUrl})` } : undefined}
                />
                <div className="mrc-ref-text">
                  <div className="mrc-ref-name">
                    <span className="mrc-num">{ref.position}</span>
                    <span>{ref.name}</span>
                  </div>
                  <div className="mrc-ref-role">{REFERENCE_ROLES[ref.position] ?? "a reference"}</div>
                </div>
                <span
                  className="mrc-dot"
                  ref={(el) => {
                    dotRefs.current[i] = el
                  }}
                />
              </div>
            ))}
          </div>
        </section>

        {/* --- 02 prompt --- */}
        <section className="mrc-group" {...groupState(STEP.b)} onMouseEnter={() => focusStep(STEP.b)}>
          <header className="mrc-head">
            <span className="mrc-badge">02</span>
            <div>
              <div className="mrc-title">{GROUP_TITLES.b.title}</div>
              <div className="mrc-sub">{GROUP_TITLES.b.sub}</div>
            </div>
          </header>
          <div className="mrc-panel-body">
            <div className="mrc-prompt" ref={promptRef}>
              {parts.map((part, i) =>
                part.token === null ? (
                  <span key={i}>{part.text}</span>
                ) : (
                  <button
                    key={i}
                    type="button"
                    className="mrc-token"
                    data-lit={reference === part.token}
                    onMouseEnter={() => focusReference(part.token as number, STEP.b)}
                    onMouseLeave={clearReference}
                    onFocus={() => focusReference(part.token as number, STEP.b)}
                    onBlur={clearReference}
                  >
                    {/* Mirror the editor's reference chip: thumbnail + `@image:N`.
                        The prompt still STORES `{image:N}` — that is what you
                        type — but showing the raw braces here would teach a form
                        nobody sees once they open the node. */}
                    {refByPosition.get(part.token)?.imageUrl && (
                      <img
                        className="mrc-token-thumb"
                        src={optimizedImageUrl(refByPosition.get(part.token)!.imageUrl!, {
                          width: 48,
                          quality: 80,
                        })}
                        alt=""
                      />
                    )}
                    <span className="mrc-token-label">@image:{part.token}</span>
                  </button>
                ),
              )}
            </div>

            <div className="mrc-explain">
              <div className="nd-eyebrow">What this line does</div>
              <div className="mrc-explain-body">{hint}</div>
            </div>

            {graph.modelChips.length > 0 && (
              <div className="nd-chips">
                {graph.modelChips.map((c) => (
                  <span key={c} className="nd-chip">
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* --- 03 result --- */}
        <section className="mrc-group" {...groupState(STEP.c)} onMouseEnter={() => focusStep(STEP.c)}>
          <header className="mrc-head">
            <span className="mrc-badge">03</span>
            <div>
              <div className="mrc-title">{GROUP_TITLES.c.title}</div>
              <div className="mrc-sub">{GROUP_TITLES.c.sub}</div>
            </div>
          </header>
          <div className="mrc-panel-body">
            {graph.resultImageUrl && (
              <img className="mrc-result" src={graph.resultImageUrl} alt="Generated result" />
            )}
            <div>
              {graph.references.map((ref) => (
                <div key={ref.nodeId} className="mrc-contrib" data-lit={reference === ref.position}>
                  <span className="mrc-num">{ref.position}</span>
                  <span>{CONTRIBUTIONS[ref.position] ?? ref.name}</span>
                </div>
              ))}
            </div>
            <button type="button" className="mrc-run" onClick={onRunNode}>
              <span className="mrc-run-label">Run this node</span>
              {estimatedCredits > 0 && <span className="mrc-run-cost">{formatCreditUnits(estimatedCredits)}</span>}
            </button>
          </div>
        </section>
      </div>

      {/* --- 04 closing --- */}
      <section className="mrc-group" {...groupState(STEP.d)} onMouseEnter={() => focusStep(STEP.d)}>
        <div className="mrc-closing">
          {CLOSING_COLUMNS.map((col, i) => (
            <div key={col.eyebrow ?? col.title ?? i}>
              {i === 0 ? (
                <div className="mrc-closing-lead">
                  <span className="mrc-badge">04</span>
                  <div>
                    <div className="mrc-title">{col.title}</div>
                    <div className="mrc-closing-body">{col.body}</div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="nd-eyebrow">{col.eyebrow}</div>
                  <div className="mrc-closing-body">{col.body}</div>
                </>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
