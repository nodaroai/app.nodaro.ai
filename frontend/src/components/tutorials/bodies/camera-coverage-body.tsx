// The Camera Coverage tutorial.
//
// This template is not IN → OUT; there is a plan you see before you spend. So
// it gets three columns: the reference frame (and the brief that governs the
// plan), the shot list — ten lines, one per run — and the contact sheet, with
// whichever shot is selected shown large beside the line that made it.
//
// The teaching point the layout has to carry: the list is the lever. It is
// what turns one image node into ten runs, and every one of those runs is fed
// the SAME reference frame — which is why the frame and the brief never change
// while you click around the shots.

import { useMemo, useState } from "react"
import { optimizedImageUrl } from "@/lib/image"
import { useT } from "@/lib/i18n"
import type { TutorialBodyProps } from "../tutorial-registry"
import { deriveCoverageGraph } from "./camera-coverage-graph"
import {
  BRIEF,
  FACTS,
  HEADLINE,
  IN_COLUMN,
  LEVER,
  LIST_COLUMN,
  NOT_RUN,
  OUT_COLUMN,
  REFERENCE_PROMPT_EYEBROW,
  SHEET_EYEBROW,
  SPECS,
  SUBLINE,
  kindFor,
  shotTag,
  statusLine,
} from "./camera-coverage-content"
import "./camera-coverage.css"

/** Which rail step each column belongs to. */
const STEP = { frame: 1, list: 2, sheet: 3 } as const

/** Ties each shot row and tile to the detail it updates, for assistive tech. */
const DETAIL_ID = "ccv-detail"

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

/**
 * ONE rendition per shot, shared by its tile and the hero. Clicking a tile
 * then swaps the hero to an image the browser already has, instead of
 * requesting a larger cut and showing the previous shot for the half second
 * it takes to arrive — which read as "the click did nothing".
 */
function shotSrc(url: string): string {
  return optimizedImageUrl(url, { width: 720, quality: 80 })
}

export default function CameraCoverageBody({ nodes, edges, focus }: TutorialBodyProps) {
  const { step, focusStep } = focus
  const t = useT()
  const graph = useMemo(() => deriveCoverageGraph(nodes, edges, t), [nodes, edges, t])
  const { shots } = graph
  const count = shots.length

  // The selected shot, 1-based. A position rather than a node id so a template
  // whose ids moved still opens on something — and it opens on shot 1, the
  // wide, because the sheet is in cutting order.
  const [shot, setShot] = useState(1)
  const selected = Math.min(Math.max(shot, 1), Math.max(count, 1))
  const current = shots[selected - 1]
  const generated = shots.filter((s) => s.imageUrl).length

  /**
   * Dimming is a RAIL gesture, and only a rail gesture. Hovering a column still
   * focuses its step — that moves the rail's counter — but it must not quiet
   * the others: the one interaction here is clicking a line and reading the
   * shot it became in the next column over.
   */
  const [inColumns, setInColumns] = useState(false)
  const columnState = (n: number) => ({
    "data-focused": step === n,
    "data-dimmed": !inColumns && step !== 0 && step !== n,
  })

  if (!graph.anchor || !current) {
    return <div className="nd-state">{t("tut.workflowUnreadable")}</div>
  }

  return (
    <div className="ccv">
      <header className="ccv-band">
        <div>
          <h2 className="ccv-headline">{t(HEADLINE)}</h2>
          <p className="ccv-subline">{t(SUBLINE)}</p>
        </div>
        <div className="nd-chips">
          {[t("tut.shotsCount", { n: count }), ...FACTS.map((f) => t(f))].map((f) => (
            <span key={f} className="nd-chip">
              {f}
            </span>
          ))}
        </div>
      </header>

      <div
        className="ccv-cols"
        onMouseEnter={() => setInColumns(true)}
        onMouseLeave={() => setInColumns(false)}
      >
        {/* --- 1 · the reference frame ---------------------------------------- */}
        <section
          className="ccv-panel"
          {...columnState(STEP.frame)}
          onMouseEnter={() => focusStep(STEP.frame)}
        >
          <header className="ccv-head">
            <span className="ccv-badge">{t("tut.badgeIn")}</span>
            <div className="ccv-head-text">
              <div className="ccv-title">{t(IN_COLUMN.title)}</div>
              <div className="ccv-sub">{t(IN_COLUMN.sub)}</div>
            </div>
            {graph.anchor.aspectRatio && <span className="ccv-meta">{graph.anchor.aspectRatio}</span>}
          </header>

          <div className="ccv-panel-body">
            {graph.anchor.imageUrl ? (
              <img
                className="ccv-frame"
                src={optimizedImageUrl(graph.anchor.imageUrl, { width: 900, quality: 82 })}
                alt={t("tut.ccvFrameAlt")}
              />
            ) : (
              <div className="ccv-frame ccv-empty">{t(NOT_RUN)}</div>
            )}

            {graph.anchor.prompt && (
              <div className="ccv-inset">
                <div className="ccv-eyebrow">{t(REFERENCE_PROMPT_EYEBROW)}</div>
                <div className="ccv-prompt">{graph.anchor.prompt}</div>
              </div>
            )}

            <div className="ccv-brief">
              <div className="ccv-eyebrow ccv-eyebrow-teal">{t(BRIEF.eyebrow)}</div>
              <ul className="ccv-rules">
                {BRIEF.rules.map((rule) => (
                  <li key={rule}>{t(rule)}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* --- 2 · the shot list ---------------------------------------------- */}
        <section
          className="ccv-panel"
          {...columnState(STEP.list)}
          onMouseEnter={() => focusStep(STEP.list)}
        >
          <header className="ccv-head">
            <span className="ccv-badge ccv-badge-tint">2</span>
            <div className="ccv-head-text">
              <div className="ccv-title">{t(LIST_COLUMN.title)}</div>
              <div className="ccv-sub">{LIST_COLUMN.sub(count, t)}</div>
            </div>
            <span className="ccv-meta ccv-meta-accent">{t(LIST_COLUMN.meta)}</span>
          </header>

          <div className="ccv-lines">
            {shots.map((s) => (
              <button
                key={s.index}
                type="button"
                className="ccv-line"
                data-selected={s.index === selected}
                aria-pressed={s.index === selected}
                // The click's whole effect happens in ANOTHER column, which a
                // sighted user sees and a screen-reader user otherwise would
                // not: name the region the row drives, and let it announce.
                aria-controls={DETAIL_ID}
                onClick={() => setShot(s.index)}
              >
                <span className="ccv-line-num">{pad(s.index)}</span>
                <span className="ccv-line-text">
                  <span className="ccv-line-kind">{kindFor(s.index, t)}</span>
                  <span className="ccv-line-body">{s.line || "—"}</span>
                </span>
              </button>
            ))}
          </div>

          <footer className="ccv-lever">
            <span className="ccv-eyebrow">{t(LEVER.eyebrow)}</span>
            <span className="ccv-lever-body">{LEVER.body(count, t)}</span>
          </footer>
        </section>

        {/* --- 3 · the contact sheet ------------------------------------------ */}
        <section
          className="ccv-panel ccv-payoff"
          {...columnState(STEP.sheet)}
          onMouseEnter={() => focusStep(STEP.sheet)}
        >
          <header className="ccv-head">
            <span className="ccv-badge ccv-badge-accent">{t("tut.badgeOut")}</span>
            <div className="ccv-head-text">
              <div className="ccv-title">{t(OUT_COLUMN.title)}</div>
              <div className="ccv-sub">{OUT_COLUMN.sub(count, t)}</div>
            </div>
            <span className="ccv-status" data-complete={generated === count}>
              <span className="ccv-status-dot" aria-hidden="true" />
              {statusLine(generated, count, t)}
            </span>
          </header>

          <div className="ccv-panel-body">
            {/* Polite, not assertive: the reader should finish the sentence it
                is on before hearing the new shot. */}
            <div className="ccv-hero-row" id={DETAIL_ID} aria-live="polite">
              <div className="ccv-hero">
                {current.imageUrl ? (
                  <img
                    src={shotSrc(current.imageUrl)}
                    alt={t("tut.shotAlt", { n: current.index, kind: kindFor(current.index, t) })}
                  />
                ) : (
                  <div className="ccv-empty">{t(NOT_RUN)}</div>
                )}
              </div>
              <div className="ccv-detail">
                <div className="ccv-eyebrow ccv-eyebrow-accent">{shotTag(current.index, count, t)}</div>
                <div className="ccv-kind">{kindFor(current.index, t)}</div>
                <div className="ccv-detail-line">{current.line}</div>
                <dl className="ccv-specs">
                  <div>
                    <dt>{t(SPECS.anchor.key)}</dt>
                    <dd>{t(SPECS.anchor.value)}</dd>
                  </div>
                  <div>
                    <dt>{t(SPECS.prompt.key)}</dt>
                    <dd>{SPECS.prompt.value(current.index, t)}</dd>
                  </div>
                  {graph.fanOut && (
                    <div>
                      <dt>{t(SPECS.node.key)}</dt>
                      <dd>{SPECS.node.value(graph.fanOut.label, current.index, t)}</dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>

            <div className="ccv-sheet">
              <div className="ccv-eyebrow">{SHEET_EYEBROW(count, t)}</div>
              <div className="ccv-grid">
                {shots.map((s) => (
                  <button
                    key={s.index}
                    type="button"
                    className="ccv-tile"
                    data-selected={s.index === selected}
                    aria-pressed={s.index === selected}
                    aria-controls={DETAIL_ID}
                    aria-label={t("tut.shotAlt", { n: s.index, kind: kindFor(s.index, t) })}
                    onClick={() => setShot(s.index)}
                  >
                    {s.imageUrl ? (
                      <img
                        src={shotSrc(s.imageUrl)}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <span className="ccv-tile-empty">{t(NOT_RUN)}</span>
                    )}
                    <span className="ccv-tile-label">{pad(s.index)}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
