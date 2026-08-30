// The Welcome Demo tutorial.
//
// Bespoke to this lesson: two rows, because the workflow is two parallel chains
// (sentence → image → motion, and narration → voice) meeting at Final Cut. The
// point being taught is the shape of that flow, so the layout IS the lesson —
// which is why this body shares no geometry with the other tutorial.

import { useMemo } from "react"
import { formatCreditUnits } from "@/lib/credit-units"
import type { TutorialBodyProps } from "../tutorial-registry"
import { nodeText, nodeMedia, nodeField } from "../derive-tutorial-data"
import { TutorialVideo } from "../tutorial-video"
import { TutorialAudio } from "../tutorial-audio"
import {
  FINAL_INPUTS,
  GROUP_TITLES,
  IDEA_CALLOUT,
  NODE_IDS,
} from "./welcome-demo-content"
import "./welcome-demo.css"

const STEP = { idea: 1, image: 2, video: 3, audio: 4, final: 5 } as const

/** Model ids the graph stores → the names the product shows. */
const MODEL_LABELS: Record<string, string> = {
  "z-image": "Z-Image",
  "seedance-2-fast": "Seedance 2 Fast",
  "elevenlabs-turbo": "ElevenLabs Turbo",
}
const label = (id: string | null) => (id ? (MODEL_LABELS[id] ?? id) : null)

function Chips({ items }: { items: Array<string | null> }) {
  const shown = items.filter((v): v is string => !!v)
  if (!shown.length) return null
  return (
    <div className="nd-chips">
      {shown.map((c) => (
        <span key={c} className="nd-chip">
          {c}
        </span>
      ))}
    </div>
  )
}

export default function WelcomeDemoBody({
  nodes,
  focus,
  estimatedCredits,
  onRunNode,
}: TutorialBodyProps) {
  const { step, focusStep } = focus
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const node = (id: string) => byId.get(id)

  const image = node(NODE_IDS.image)
  const video = node(NODE_IDS.video)
  const voice = node(NODE_IDS.voice)
  const final = node(NODE_IDS.final)

  const imageModel = nodeField(image, "provider")
  // Already resolved by the page from `startCostModel`, so the rail chip and
  // this button always quote the same number.
  const cost = estimatedCredits

  const groupState = (n: number) => ({
    "data-focused": step === n,
    "data-dimmed": step !== 0 && step !== n,
  })

  const header = (n: number, key: keyof typeof GROUP_TITLES) => (
    <header className="wd-head">
      <span className="wd-badge">{String(n).padStart(2, "0")}</span>
      <div>
        <div className="wd-title">{GROUP_TITLES[key].title}</div>
        <div className="wd-sub">{GROUP_TITLES[key].sub}</div>
      </div>
    </header>
  )

  return (
    <div className="wd">
      <div className="wd-row-1">
        <section className="wd-group" {...groupState(STEP.idea)} onMouseEnter={() => focusStep(STEP.idea)}>
          {header(STEP.idea, "idea")}
          <div className="wd-body">
            <div className="wd-prompt">{nodeText(node(NODE_IDS.idea))}</div>
            <div className="wd-callout">
              <span className="wd-dot" />
              <span>{IDEA_CALLOUT}</span>
            </div>
          </div>
        </section>

        <section className="wd-group" {...groupState(STEP.image)} onMouseEnter={() => focusStep(STEP.image)}>
          {header(STEP.image, "image")}
          <div className="wd-body">
            {nodeMedia(image) && (
              <div className="wd-media">
                <img src={nodeMedia(image) as string} alt="Generated scene" />
              </div>
            )}
            <Chips items={[label(imageModel), nodeField(image, "aspectRatio")]} />
            <button type="button" className="wd-run" onClick={onRunNode}>
              <span className="wd-run-label">Run this node</span>
              {cost > 0 && <span className="wd-run-cost">{formatCreditUnits(cost)}</span>}
            </button>
          </div>
        </section>

        <section className="wd-group" {...groupState(STEP.video)} onMouseEnter={() => focusStep(STEP.video)}>
          {header(STEP.video, "video")}
          <div className="wd-body">
            {nodeMedia(video) && (
              // The real clip, not a poster: this step is about motion, and a
              // still would be arguing the opposite of the lesson. It loops
              // silently on its own; the controls are there to stop it, hear it
              // or fill the screen with it.
              <TutorialVideo
                src={nodeMedia(video) as string}
                poster={nodeMedia(image) ?? undefined}
                autoPlay
                badge={
                  nodeField(video, "duration") ? (
                    <span className="wd-duration">
                      0:{String(nodeField(video, "duration")).padStart(2, "0")}
                    </span>
                  ) : undefined
                }
              />
            )}
            <p className="wd-note">{nodeText(video)}</p>
            <Chips items={[label(nodeField(video, "provider")), "start frame from 02"]} />
          </div>
        </section>
      </div>

      <div className="wd-row-2">
        <section className="wd-group" {...groupState(STEP.audio)} onMouseEnter={() => focusStep(STEP.audio)}>
          {header(STEP.audio, "audio")}
          <div className="wd-body">
            <div className="wd-columns">
              <div>
                <div className="nd-eyebrow">Narration</div>
                <div className="wd-prompt" style={{ marginTop: 8 }}>
                  {nodeText(node(NODE_IDS.narration))}
                </div>
              </div>
              <div>
                <div className="nd-eyebrow">Voiceover</div>
                <div className="wd-card" style={{ marginTop: 8 }}>
                  <span className="wd-avatar">
                    {(nodeField(voice, "voiceDisplayName") ?? "V").slice(0, 1).toUpperCase()}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div className="wd-voice-name">
                      {nodeField(voice, "voiceDisplayName") ?? "Voiceover"}
                    </div>
                    <div className="wd-voice-meta">{label(nodeField(voice, "provider"))}</div>
                    <Chips
                      items={[
                        nodeField(voice, "speed") && `speed ${nodeField(voice, "speed")}`,
                        nodeField(voice, "stability") && `stability ${nodeField(voice, "stability")}`,
                      ]}
                    />
                    {/* Naming the voice is not the same as hearing it, and this
                        step is entirely about how it sounds. */}
                    {nodeMedia(voice) && (
                      <div className="wd-voice-player">
                        <TutorialAudio
                          src={nodeMedia(voice) as string}
                          label={nodeField(voice, "voiceDisplayName") ?? "voiceover"}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="wd-group" {...groupState(STEP.final)} onMouseEnter={() => focusStep(STEP.final)}>
          {header(STEP.final, "final")}
          <div className="wd-body">
            <div className="wd-final">
              <div>
                {FINAL_INPUTS.map((input) => (
                  <div key={input} className="wd-input">
                    <span className="wd-dot wd-dot--audio" />
                    <span>{input}</span>
                  </div>
                ))}
                <Chips
                  items={[
                    nodeField(final, "voiceoverVolume") && `voice ${nodeField(final, "voiceoverVolume")}%`,
                    nodeField(final, "backgroundVolume") && `bed ${nodeField(final, "backgroundVolume")}%`,
                  ]}
                />
              </div>
              {nodeMedia(final) && (
                <div className="wd-final-media">
                  {/* This is the merged file — video AND voice. It starts paused
                      and unmuted, because a silent autoplay would demonstrate
                      the opposite of what this step is about. */}
                  <TutorialVideo
                    src={nodeMedia(final) as string}
                    poster={nodeMedia(image) ?? undefined}
                    muted={false}
                  />
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
