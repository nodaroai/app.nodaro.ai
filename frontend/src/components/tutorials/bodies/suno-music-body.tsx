// The Suno Music tutorial.
//
// Bespoke to this lesson: a run stepper over a three-stage chain — the options
// you pick FEED Suno Generate, which MAKES a track. The template is the same
// idea run seven times, each run changing one thing, so showing all of them at
// once would bury the only thing worth noticing. One run at a time, and the
// track is playable, because "it sounds different" is the whole argument.

import { useMemo, useState } from "react"
import { TutorialAudio } from "../tutorial-audio"
import { useT } from "@/lib/i18n"
import { useLocalizeNodeLabel } from "@/lib/i18n/labels"
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
  const t = useT()
  const localizeNode = useLocalizeNodeLabel()

  if (runs.length === 0) return <div className="nd-state">{t("tut.noRunsToShow")}</div>

  const run = runs[Math.min(index, runs.length - 1)]
  // Mid-sentence, so the family's canvas name in lower case ("Added music genre.").
  const change = describeChange(runs[index - 1], run, t, (kind) =>
    localizeNode(KIND_LABELS[kind] ?? kind.replace(/-/g, " ")).toLowerCase(),
  )
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
          <div className="nd-eyebrow">{t("tut.runEyebrow")}</div>
          <div className="sm-run-count">
            {t("tut.ofTotal", { n: String(index + 1).padStart(2, "0"), total })}
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
              aria-label={t("tut.runN", { n: i + 1 })}
              aria-current={i === index}
            >
              {String(i + 1).padStart(2, "0")}
            </button>
          ))}
        </div>
        <p className="sm-change">{change}</p>
        <div className="sm-nav">
          <button type="button" onClick={() => setIndex((i) => i - 1)} disabled={index === 0}>
            {t("common.previous")}
          </button>
          <button
            type="button"
            className="sm-next"
            onClick={() => setIndex((i) => i + 1)}
            disabled={index >= runs.length - 1}
          >
            {t("tut.nextRun")}
          </button>
        </div>
      </div>

      <div className="sm-stages">
        {/* 1 — the picks */}
        <section className="sm-panel">
          <header className="sm-head">
            <span className="sm-badge">1</span>
            <div>
              <div className="sm-title">{t("tut.sunoPicksTitle")}</div>
              <div className="sm-sub">{t("tut.sunoPicksSub")}</div>
            </div>
          </header>
          <div className="sm-body">
            {families.map((kind) => {
              const used = run.inputs.filter((i) => i.kind === kind)
              return (
                <div key={kind} className="sm-card" data-unused={used.length === 0}>
                  <div className="sm-card-head">
                    <span className="sm-card-name">{localizeNode(KIND_LABELS[kind] ?? kind)}</span>
                    {used.length === 0 && <span className="sm-tag">{t("tut.notInThisRun")}</span>}
                    {used.length > 1 && <span className="sm-tag">{t("tut.secondLayered")}</span>}
                  </div>
                  <div className="sm-card-body">
                    {used.length === 0 ? (
                      <span className="sm-value">{t("tut.any")}</span>
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
          <span className="sm-connector-label">{t("tut.feeds")}</span>
        </div>

        {/* 2 — the generator */}
        <section className="sm-panel">
          <header className="sm-head">
            <span className="sm-badge">2</span>
            <div>
              <div className="sm-title">{localizeNode("Suno Generate")}</div>
              <div className="sm-sub">{t("tut.sunoGenSub")}</div>
            </div>
          </header>
          <div className="sm-body">
            <div className="sm-style">
              <div className="nd-eyebrow">{t("tut.styleDescription")}</div>
              <p className="sm-style-note">{t("tut.styleAutoNote")}</p>
              <p className="sm-style-text">{run.styleDescription || "—"}</p>
            </div>

            <div className="nd-eyebrow">{t("tut.yourPromptOptional")}</div>
            <div className="sm-prompt" data-filled={!!run.prompt}>
              {run.prompt || t("tut.emptyInRun")}
            </div>

            <div className="sm-toggle-row">
              <span>{t("tut.instrumental")}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="sm-toggle-state" data-on={run.instrumental}>
                  {run.instrumental ? t("tut.on") : t("tut.off")}
                </span>
                <span className="sm-toggle" data-on={run.instrumental} aria-hidden="true">
                  <span className="sm-knob" />
                </span>
              </span>
            </div>

            <div className="nd-chips">
              {run.model && <span className="nd-chip">Suno {run.model}</span>}
              <span className="nd-chip">
                {run.inputs.length === 1 ? t("tut.oneNodeConnected") : t("tut.nodesConnected", { n: run.inputs.length })}
              </span>
            </div>

            <button type="button" className="sm-run" onClick={onRunNode}>
              {t("tut.runWithOptions")}
            </button>
          </div>
        </section>

        <div className="sm-connector">
          <span className="sm-connector-bar" />
          <span className="sm-connector-label">{t("tut.makes")}</span>
        </div>

        {/* 3 — the track */}
        <section className="sm-panel sm-panel--payoff">
          <header className="sm-head">
            <span className="sm-badge sm-badge--payoff">3</span>
            <div>
              <div className="sm-title">{t("tut.trackTitle")}</div>
              <div className="sm-sub">{t("tut.trackSub")}</div>
            </div>
          </header>
          <div className="sm-body" style={{ padding: "18px 16px" }}>
            <div className="sm-track-eyebrow">{t("tut.trackN", { n: String(index + 1).padStart(2, "0") })}</div>
            <h2 className="sm-track-title">{run.styleDescription.split(",")[0] || t("common.untitled")}</h2>
            <p className="sm-track-desc">{change}</p>

            {run.audioUrl ? (
              <div className="sm-player">
                {/* Keyed on the run so switching runs loads the new track rather
                    than leaving the previous one playing under a new title. */}
                <TutorialAudio key={run.id} src={run.audioUrl} label={t("tut.trackLabel", { n: index + 1 })} />
                <div className="sm-caption">
                  {t("tut.generatedWithSuno", { model: run.model ?? DEFAULT_SUNO_MODEL })}
                </div>
              </div>
            ) : (
              <p className="sm-track-desc" style={{ marginTop: 14 }}>
                {t("tut.noSavedAudio")}
              </p>
            )}

            <div className="sm-why">
              <div className="nd-eyebrow">{t("tut.whySoundsDifferent")}</div>
              <p className="sm-why-body">{change}</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
