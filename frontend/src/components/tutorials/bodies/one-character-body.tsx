// The "One Character, Any Scene" tutorial.
//
// Two images, five recipes, no masks. A three-column fan-out: IN (the two
// sources with their numbers) → the five recipes (click one; see what it takes
// and what it teaches) → OUT (the result, plus a HOW IT ADDS UP strip that
// shows the borrowed fragments beside the final image).
//
// The teaching point the layout has to carry: every recipe reads the SAME two
// sources; what changes is which part of each one you name, and which number
// you name it on. So the sources never move while you click around — the
// design making "same two images" visible — and recipe 2 (identical
// qualifiers, swapped numbers) is the whole lesson in one line.

import { useMemo, useState } from "react"
import { optimizedImageUrl } from "@/lib/image"
import type { TutorialBodyProps } from "../tutorial-registry"
import { deriveOneCharacterGraph, type Recipe, type RecipeBorrow, type RecipeSource } from "./one-character-recipes"
import {
  ADDS_UP_EYEBROW,
  BLANK_TILE_LABEL,
  FACTS,
  HEADLINE,
  IN_COLUMN,
  NODE_EYEBROW,
  NOT_RUN,
  RECIPE_ORDER,
  RECIPES_COLUMN,
  RESULT_CAPTION,
  RESULT_CHIP,
  SAME_TWO,
  SOURCE_ROLES,
  SUBLINE,
  TAKES_EYEBROW,
  copyFor,
  cropFor,
} from "./one-character-content"
import "./one-character.css"

/** Which rail step each column belongs to. */
const STEP = { sources: 1, recipes: 2, result: 3 } as const

/** Ties each recipe row to the columns it drives, for assistive tech. */
const DETAIL_ID = "occ-detail"

/** One rendition per image, shared wherever it appears — a click swaps to a
 *  picture the browser already has instead of showing the previous one for
 *  the half second a larger cut takes to arrive. */
const src = (url: string, width = 720) => optimizedImageUrl(url, { width, quality: 82 })

function sourceRole(source: RecipeSource): string {
  return SOURCE_ROLES[source.position] ?? (source.kind === "uploaded" ? "uploaded image" : "generated image")
}

/** A `{image:N}` / `{image:N:part}` chip: teal marks a whole source, pink a borrowed fragment. */
function TokenChip({ n, qualifier, small = false }: { n: number; qualifier?: string | null; small?: boolean }) {
  const bare = !qualifier
  return (
    <span className="occ-token" data-bare={bare} data-small={small}>
      {bare ? `{image:${n}}` : `{image:${n}:${qualifier}}`}
    </span>
  )
}

/** The prompt line of a recipe row: plain runs as text, tokens as chips. */
function PromptLine({ recipe }: { recipe: Recipe }) {
  return (
    <span className="occ-prompt">
      {recipe.parts.map((p, i) =>
        p.n === null ? (
          <span key={i}>{p.text}</span>
        ) : (
          <TokenChip key={i} n={p.n} qualifier={p.qualifier} small />
        ),
      )}
    </span>
  )
}

/** One tile of the HOW IT ADDS UP strip: the window into a source that this
 *  qualifier borrows — or a blank, honestly-labelled panel when nothing in the
 *  source can stand for it (see the crop map). */
function PartTile({ borrow }: { borrow: RecipeBorrow }) {
  const crop = cropFor(borrow.qualifier)
  const url = borrow.source?.imageUrl
  return (
    <div className="occ-part">
      {crop.blank || !url ? (
        <div className="occ-crop occ-crop-blank" role="img" aria-label={`${borrow.token}: ${crop.caption}`}>
          {crop.blank ? BLANK_TILE_LABEL : NOT_RUN}
        </div>
      ) : (
        <div
          className="occ-crop"
          role="img"
          aria-label={`${borrow.token}: ${crop.caption}`}
          style={{ backgroundImage: `url(${src(url, 900)})`, backgroundSize: crop.size, backgroundPosition: crop.position }}
        />
      )}
      <TokenChip n={borrow.n} qualifier={borrow.qualifier} small />
      <div className="occ-part-caption">{crop.caption}</div>
    </div>
  )
}

export default function OneCharacterBody({ nodes, edges, focus }: TutorialBodyProps) {
  const { step, focusStep } = focus
  const graph = useMemo(() => deriveOneCharacterGraph(nodes, edges, RECIPE_ORDER), [nodes, edges])
  const { sources, recipes } = graph
  const count = recipes.length

  // The selected recipe, 1-based — a position rather than a node id so a
  // template whose ids moved still opens on something. It opens on recipe 1,
  // the baseline; the sequence is authored so the lessons build.
  const [pick, setPick] = useState(1)
  const selected = Math.min(Math.max(pick, 1), Math.max(count, 1))
  const current = recipes[selected - 1]
  const copy = current ? copyFor(current.key, current.index) : null

  // Dimming is a RAIL gesture, and only a rail gesture: hovering a column
  // still focuses its step (the rail's counter moves) but must not quiet the
  // others — the one interaction here is clicking a recipe and reading, in
  // the next column over, what it borrowed and what came out.
  const [inColumns, setInColumns] = useState(false)
  const columnState = (n: number) => ({
    "data-focused": step === n,
    "data-dimmed": !inColumns && step !== 0 && step !== n,
  })

  if (!current || !copy || sources.length === 0) {
    return <div className="nd-state">This tutorial&rsquo;s workflow could not be read.</div>
  }

  const meta = [current.resolution, current.aspectRatio].filter(Boolean).join(" · ")

  return (
    <div className="occ">
      <header className="occ-band">
        <div>
          <h2 className="occ-headline">{HEADLINE}</h2>
          <p className="occ-subline">{SUBLINE}</p>
        </div>
        <div className="nd-chips">
          {[`${sources.length} sources`, `${count} recipes`, ...FACTS].map((f) => (
            <span key={f} className="nd-chip">
              {f}
            </span>
          ))}
        </div>
      </header>

      <div className="occ-cols" onMouseEnter={() => setInColumns(true)} onMouseLeave={() => setInColumns(false)}>
        {/* --- 1 · the two sources -------------------------------------------- */}
        <section className="occ-panel" {...columnState(STEP.sources)} onMouseEnter={() => focusStep(STEP.sources)}>
          <header className="occ-head">
            <span className="occ-badge">IN</span>
            <div className="occ-head-text">
              <div className="occ-title">{IN_COLUMN.title}</div>
              <div className="occ-sub">{IN_COLUMN.sub}</div>
            </div>
          </header>
          <div className="occ-panel-body occ-sources">
            {sources.map((s) => (
              <figure key={s.nodeId} className="occ-source">
                {s.imageUrl ? (
                  <img className="occ-source-img" src={src(s.imageUrl)} alt={`Source ${s.position}: ${sourceRole(s)}`} />
                ) : (
                  <div className="occ-source-img occ-empty">{NOT_RUN}</div>
                )}
                <figcaption className="occ-source-cap">
                  <TokenChip n={s.position} />
                  <span className="occ-source-role">{sourceRole(s)}</span>
                </figcaption>
              </figure>
            ))}
            <div className="occ-note">
              <div className="occ-eyebrow occ-eyebrow-teal">{SAME_TWO.eyebrow}</div>
              <p>{SAME_TWO.body}</p>
            </div>
          </div>
        </section>

        {/* --- 2 · the five recipes ------------------------------------------ */}
        <section className="occ-panel" {...columnState(STEP.recipes)} onMouseEnter={() => focusStep(STEP.recipes)}>
          <header className="occ-head">
            <span className="occ-badge occ-badge-tint">2</span>
            <div className="occ-head-text">
              <div className="occ-title">{RECIPES_COLUMN.title}</div>
              <div className="occ-sub">{RECIPES_COLUMN.sub}</div>
            </div>
            <span className="occ-meta occ-meta-accent">{RECIPES_COLUMN.meta}</span>
          </header>

          <div className="occ-rows">
            {recipes.map((r) => (
              <button
                key={r.nodeId}
                type="button"
                className="occ-row"
                data-selected={r.index === selected}
                aria-pressed={r.index === selected}
                // The click's whole effect happens in the columns beside this
                // one — name the region it drives, and let it announce.
                aria-controls={DETAIL_ID}
                onClick={() => setPick(r.index)}
              >
                <span className="occ-row-num">{r.index}</span>
                <span className="occ-row-text">
                  <PromptLine recipe={r} />
                  <span className="occ-row-name">{copyFor(r.key, r.index).name}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="occ-panel-body occ-recipe-detail">
            <div className="occ-inset">
              <div className="occ-eyebrow">{TAKES_EYEBROW}</div>
              <ul className="occ-takes">
                {current.borrows.map((b) => (
                  <li key={`${b.n}:${b.qualifier}`} className="occ-take">
                    {b.source?.imageUrl ? (
                      <img className="occ-take-thumb" src={src(b.source.imageUrl, 160)} alt="" />
                    ) : (
                      <span className="occ-take-thumb occ-empty" />
                    )}
                    <TokenChip n={b.n} qualifier={b.qualifier} small />
                    <span className="occ-take-note">{copy.notes[`${b.n}:${b.qualifier}`] ?? `${b.qualifier || "the whole image"} from source ${b.n}`}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="occ-lesson">
              <div className="occ-eyebrow occ-eyebrow-accent">{copy.lessonKind}</div>
              <p>{copy.lesson}</p>
            </div>

            <div className="occ-noderow">
              <span className="occ-eyebrow">{NODE_EYEBROW}</span>
              <span className="occ-noderow-label">{current.label}</span>
              {current.provider && <span className="occ-noderow-model">{current.provider}</span>}
            </div>
          </div>
        </section>

        {/* --- 3 · the result and the breakdown ------------------------------ */}
        <section
          className="occ-panel occ-payoff"
          {...columnState(STEP.result)}
          onMouseEnter={() => focusStep(STEP.result)}
          id={DETAIL_ID}
          aria-live="polite"
        >
          <header className="occ-head">
            <span className="occ-badge occ-badge-accent">OUT</span>
            <div className="occ-head-text">
              <div className="occ-title">{copy.outTitle}</div>
              <div className="occ-sub">{copy.outSub}</div>
            </div>
            {meta && <span className="occ-meta">{meta}</span>}
          </header>

          <div className="occ-panel-body occ-out">
            {current.resultUrl ? (
              <img className="occ-hero" src={src(current.resultUrl, 1200)} alt={`Recipe ${current.index}: ${copy.name}`} />
            ) : (
              <div className="occ-hero occ-empty">{NOT_RUN}</div>
            )}

            <div className="occ-rule">
              <span className="occ-eyebrow">{ADDS_UP_EYEBROW}</span>
              <span className="occ-rule-line" />
            </div>

            <div className="occ-strip">
              {current.borrows.map((b) => (
                <PartTile key={`${b.n}:${b.qualifier}`} borrow={b} />
              ))}
              <span className="occ-equals" aria-hidden="true">
                =
              </span>
              <div className="occ-part occ-part-result">
                {current.resultUrl ? (
                  <div className="occ-crop occ-crop-result" role="img" aria-label="The result" style={{ backgroundImage: `url(${src(current.resultUrl, 900)})` }} />
                ) : (
                  <div className="occ-crop occ-crop-blank">{NOT_RUN}</div>
                )}
                <span className="occ-result-chip">{RESULT_CHIP}</span>
                <div className="occ-part-caption">{RESULT_CAPTION}</div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
