// The Suno Music tutorial.
//
// Bespoke to this lesson: a run stepper over a three-stage chain — the options
// you pick FEED Suno Generate, which MAKES a track. The template is the same
// idea run seven times, each run changing one thing, so showing all of them at
// once would bury the only thing worth noticing. One run at a time, and the
// track is playable, because "it sounds different" is the whole argument.

import { useMemo, useState } from "react"
import { TutorialAudio } from "../tutorial-audio"
import type { TutorialBodyProps } from "../tutorial-registry"
import { DEFAULT_SUNO_MODEL } from "@nodaro/shared"
import { deriveSunoRuns, describeChange, INPUT_ORDER } from "./suno-runs"
import "./suno-music.css"

/** Node type → the name on its card. */
const KIND_LABELS: Record<string, string> = {
  "music-genre": "Music Genre",
  "music-mood": "Music Mood",
  instrumentation: "Instrumentation",
  "voice-character": "Voice Character",
  "voice-delivery": "Voice Delivery",
}

export default function SunoMusicBody({ nodes, edges, onRunNode }: TutorialBodyProps) {
  const runs = useMemo(() => deriveSunoRuns(nodes, edges), [nodes, edges])
  const [index, setIndex] = useState(0)

  if (runs.length === 0) return <div className="nd-state">This template has no runs to show.</div>

  const run = runs[Math.min(index, runs.length - 1)]
  const change = describeChange(runs[index - 1], run)
  const total = String(runs.length).padStart(2, "0")

  // Every family the template uses anywhere, so a family this run leaves out
  // still holds its place — the absence is part of the lesson.
  const families = INPUT_ORDER.filter((kind) =>
    runs.some((r) => r.inputs.some((i) => i.kind === kind)),
  )

  return (
    <div className="sm">
      <div className="sm-stepper">
        <div>
          <div className="nd-eyebrow">Run</div>
          <div className="sm-run-count">
            {String(index + 1).padStart(2, "0")} of {total}
          </div>
        </div>
        <span className="sm-divider" />
        <div className="sm-pills">
          {runs.map((r, i) => (
            <button
              key={r.id}
              type="button"
              className="sm-pill"
              data-active={i === index}
              onClick={() => setIndex(i)}
              aria-label={`Run ${i + 1}`}
              aria-current={i === index}
            >
              {String(i + 1).padStart(2, "0")}
            </button>
          ))}
        </div>
        <p className="sm-change">{change}</p>
        <div className="sm-nav">
          <button type="button" onClick={() => setIndex((i) => i - 1)} disabled={index === 0}>
            Previous
          </button>
          <button
            type="button"
            className="sm-next"
            onClick={() => setIndex((i) => i + 1)}
            disabled={index >= runs.length - 1}
          >
            Next run
          </button>
        </div>
      </div>

      <div className="sm-stages">
        {/* 1 — the picks */}
        <section className="sm-panel">
          <header className="sm-head">
            <span className="sm-badge">1</span>
            <div>
              <div className="sm-title">The options you pick</div>
              <div className="sm-sub">Dropdowns on the style nodes. No writing.</div>
            </div>
          </header>
          <div className="sm-body">
            {families.map((kind) => {
              const used = run.inputs.filter((i) => i.kind === kind)
              return (
                <div key={kind} className="sm-card" data-unused={used.length === 0}>
                  <div className="sm-card-head">
                    <span className="sm-card-name">{KIND_LABELS[kind] ?? kind}</span>
                    {used.length === 0 && <span className="sm-tag">Not in this run</span>}
                    {used.length > 1 && <span className="sm-tag">Second one, layered</span>}
                  </div>
                  <div className="sm-card-body">
                    {used.length === 0 ? (
                      <span className="sm-value">Any</span>
                    ) : (
                      used
                        .flatMap((u) => u.picks)
                        .map((pick, i) => (
                          <span key={`${pick}-${i}`} className="sm-value">
                            {pick}
                          </span>
                        ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <div className="sm-connector">
          <span className="sm-connector-bar" />
          <span className="sm-connector-label">FEEDS</span>
        </div>

        {/* 2 — the generator */}
        <section className="sm-panel">
          <header className="sm-head">
            <span className="sm-badge">2</span>
            <div>
              <div className="sm-title">Suno Generate</div>
              <div className="sm-sub">Where the picks turn into audio</div>
            </div>
          </header>
          <div className="sm-body">
            <div className="sm-style">
              <div className="nd-eyebrow">Style description</div>
              <p className="sm-style-note">Written automatically from every option on the left.</p>
              <p className="sm-style-text">{run.styleDescription || "—"}</p>
            </div>

            <div className="nd-eyebrow">Your prompt (optional)</div>
            <div className="sm-prompt" data-filled={!!run.prompt}>
              {run.prompt || "Empty in this run"}
            </div>

            <div className="sm-toggle-row">
              <span>Instrumental</span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="sm-toggle-state" data-on={run.instrumental}>
                  {run.instrumental ? "ON" : "OFF"}
                </span>
                <span className="sm-toggle" data-on={run.instrumental} aria-hidden="true">
                  <span className="sm-knob" />
                </span>
              </span>
            </div>

            <div className="nd-chips">
              {run.model && <span className="nd-chip">Suno {run.model}</span>}
              <span className="nd-chip">
                {run.inputs.length} node{run.inputs.length === 1 ? "" : "s"} connected
              </span>
            </div>

            <button type="button" className="sm-run" onClick={onRunNode}>
              Run with these options
            </button>
          </div>
        </section>

        <div className="sm-connector">
          <span className="sm-connector-bar" />
          <span className="sm-connector-label">MAKES</span>
        </div>

        {/* 3 — the track */}
        <section className="sm-panel sm-panel--payoff">
          <header className="sm-head">
            <span className="sm-badge sm-badge--payoff">3</span>
            <div>
              <div className="sm-title">The track it made</div>
              <div className="sm-sub">Already generated, free to play</div>
            </div>
          </header>
          <div className="sm-body" style={{ padding: "18px 16px" }}>
            <div className="sm-track-eyebrow">Track {String(index + 1).padStart(2, "0")}</div>
            <h2 className="sm-track-title">{run.styleDescription.split(",")[0] || "Untitled"}</h2>
            <p className="sm-track-desc">{change}</p>

            {run.audioUrl ? (
              <div className="sm-player">
                {/* Keyed on the run so switching runs loads the new track rather
                    than leaving the previous one playing under a new title. */}
                <TutorialAudio key={run.id} src={run.audioUrl} label={`track ${index + 1}`} />
                <div className="sm-caption">
                  Generated with Suno {run.model ?? DEFAULT_SUNO_MODEL}
                </div>
              </div>
            ) : (
              <p className="sm-track-desc" style={{ marginTop: 14 }}>
                This run has no saved audio.
              </p>
            )}

            <div className="sm-why">
              <div className="nd-eyebrow">Why it sounds different</div>
              <p className="sm-why-body">{change}</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
