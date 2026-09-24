// The Underwater Giants tutorial.
//
// Shares the headline + IN→OUT + step-chain frame with Social Media Autopilot,
// because the design deliberately reuses it: both templates are "one input, one
// published post", and giving them different furniture would have made two
// things look unrelated that are not.
//
// What is new here is the TRACED SCENE. This template runs the same eight-step
// journey eight times over, so the way to teach it is to follow ONE scene all
// the way down — its prompt, its still, its motion, its clip in the timeline —
// rather than describe the machine. Clicking a clip re-traces everything.

import { useMemo, useState } from "react"
import { nodeText, nodeMedia } from "../derive-tutorial-data"
import { TutorialAudio } from "../tutorial-audio"
import { TutorialVideo } from "../tutorial-video"
import { TutorialLightbox, useLightbox } from "../tutorial-lightbox"
import { useT, type MessageKey } from "@/lib/i18n"
import { useLocalizeNodeLabel } from "@/lib/i18n/labels"
import type { TutorialBodyProps } from "../tutorial-registry"
import type { WorkflowNode } from "@/types/nodes"
import "./autopilot.css"
import "./underwater.css"

const HEADLINE = "tut.uwHeadline" satisfies MessageKey
const SUBLINE = "tut.uwSubline" satisfies MessageKey
const CHIPS = ["tut.uwChipScenes", "tut.uwChipReel", "tut.uwChipVertical"] as const satisfies readonly MessageKey[]

/** Labels in this template carry stray double spaces ("Scene 7  Text Prompt"),
 *  so every lookup goes through the same normaliser rather than exact text. */
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase()

/** `kind` / `title` / `line` are message keys, translated at render; `node` is the lookup label. */
const STEPS = [
  { n: 1, kind: "tut.kindYouEdit", title: "tut.uwStep1Title", line: "tut.uwStep1Line", node: "Scene N Text Prompt" },
  { n: 2, kind: "tut.kindDraws", title: "tut.uwStep2Title", line: "tut.uwStep2Line", node: "Generate Image" },
  { n: 3, kind: "tut.kindAnimates", title: "tut.uwStep3Title", line: "tut.uwStep3Line", node: "Generate Video" },
  { n: 4, kind: "tut.kindEdits", title: "tut.uwStep4Title", line: "tut.uwStep4Line", node: "Combine Videos" },
  { n: 5, kind: "tut.kindScores", title: "tut.uwStep5Title", line: "tut.uwStep5Line", node: "Suno Generate" },
  { n: 6, kind: "tut.kindFinishes", title: "tut.uwStep6Title", line: "tut.uwStep6Line", node: "Merge · Trim · Format" },
  { n: 7, kind: "tut.kindPosts", title: "tut.uwStep7Title", line: "tut.uwStep7Line", node: "Instagram Post" },
] as const

const SCENE_COUNT = 8

export default function UnderwaterBody({ nodes }: TutorialBodyProps) {
  const [scene, setScene] = useState(1)
  const lightbox = useLightbox()
  const t = useT()
  const localizeNode = useLocalizeNodeLabel()

  const byLabel = useMemo(() => {
    const m = new Map<string, WorkflowNode>()
    for (const n of nodes) {
      const l = (n.data as Record<string, unknown> | undefined)?.label
      if (typeof l === "string" && !m.has(norm(l))) m.set(norm(l), n)
    }
    return m
  }, [nodes])

  const get = (label: string) => byLabel.get(norm(label))
  const scenePrompt = (i: number) => nodeText(get(`Scene ${i} Text Prompt`))
  const sceneStill = (i: number) => nodeMedia(get(`Scene ${i}`))
  const sceneShot = (i: number) => nodeMedia(get(`Scene ${i} video`))
  const sceneMotion = (i: number) => nodeText(get(`Scene ${i} video`))

  const stills = Array.from({ length: SCENE_COUNT }, (_, i) => sceneStill(i + 1))
  const finalReel = nodeMedia(get("Social Media Format")) ?? nodeMedia(get("Trim Video"))
  const music = nodeMedia(get("Suno Generate"))
  const caption = nodeText(get("Caption / Post Text"))
  const postThumb = nodeMedia(get("Instagram Post")) ?? stills[0]

  const preview = (label: string): React.ReactNode => {
    switch (label) {
      case "Scene N Text Prompt":
        return <span className="uw-clamp">{scenePrompt(scene) || "—"}</span>
      case "Generate Image": {
        const url = sceneStill(scene)
        return (
          <div className="uw-trace">
            {url && (
              <span
                className="uw-still tl-openable"
                style={{ backgroundImage: `url(${url})` }}
                role="button"
                tabIndex={0}
                aria-label={t("tut.openSceneStill", { n: scene })}
                onClick={() => lightbox.show(url, t("tut.sceneN", { n: scene }))}
              />
            )}
            <span>
              <span className="uw-scene-tag">{t("tut.sceneN", { n: String(scene).padStart(2, "0") })}</span>
              <span className="uw-ref">
                {/* The insight the sticky notes never state but the graph does. */}
                {scene === 1
                  ? t("tut.uwFirstImageNote")
                  : t("tut.uwRefNote", { n: scene - 1 })}
              </span>
            </span>
          </div>
        )
      }
      case "Generate Video":
        return <span className="uw-clamp">{sceneMotion(scene) || "—"}</span>
      case "Combine Videos":
        return (
          <div>
            <div className="uw-timeline">
              {stills.map((url, i) => (
                <button
                  key={i}
                  type="button"
                  className="uw-clip"
                  data-active={scene === i + 1}
                  style={url ? { backgroundImage: `url(${url})` } : undefined}
                  onClick={() => setScene(i + 1)}
                  aria-label={t("tut.traceScene", { n: i + 1 })}
                  aria-pressed={scene === i + 1}
                />
              ))}
            </div>
            <div className="uw-note">
              {t("tut.uwClipNote", { n: scene, total: SCENE_COUNT, s: (scene - 1) * 5 })}
            </div>
          </div>
        )
      case "Suno Generate":
        return music ? (
          <div>
            <span className="uw-clamp uw-clamp--short">{nodeText(get("Suno Text Prompt"))}</span>
            <div style={{ marginTop: 8 }}>
              <TutorialAudio src={music} label={t("tut.theScore")} />
            </div>
          </div>
        ) : (
          "—"
        )
      case "Merge · Trim · Format":
        return (
          <div className="uw-specs">
            <span>{t("tut.uwSpecMusic")}</span>
            <span>{t("tut.uwSpecTrim")}</span>
            <span>{t("tut.uwSpecFormat")}</span>
          </div>
        )
      case "Instagram Post":
        return (
          <div className="ap-post-mini">
            <span
              className="ap-post-mini-img"
              style={postThumb ? { backgroundImage: `url(${postThumb})` } : undefined}
            />
            <span className="ap-live-text">{t("tut.liveOnInstagram")}</span>
          </div>
        )
      default:
        return "—"
    }
  }

  return (
    <div className="ap">
      <header className="ap-headline">
        <div style={{ minWidth: 0 }}>
          <h1>{t(HEADLINE)}</h1>
          <p className="ap-subline">{t(SUBLINE)}</p>
        </div>
        <div className="ap-headline-chips">
          {CHIPS.map((c) => (
            <span key={c} className="nd-chip">
              {t(c)}
            </span>
          ))}
        </div>
      </header>

      <div className="ap-hero">
        <section className="ap-card">
          <header className="ap-card-head">
            <span className="ap-io-badge">{t("tut.badgeIn")}</span>
            <div>
              <div className="ap-card-title">{t("tut.uwInTitle")}</div>
              <div className="ap-card-sub">{t("tut.uwInSub")}</div>
            </div>
          </header>
          <div className="ap-card-body">
            <div className="ap-input">
              {/* The traced scene, so IN and the chain always agree. */}
              <div className="uw-scene-tag" style={{ marginBottom: 8 }}>
                {t("tut.sceneOf", { n: String(scene).padStart(2, "0"), total: SCENE_COUNT })}
              </div>
              {scenePrompt(scene) || "—"}
            </div>
          </div>
        </section>

        <div className="ap-connector">
          <span className="ap-connector-bar" />
          <span className="ap-connector-text">
            {t("tut.uwConnector1")}
            <br />
            {t("tut.uwConnector2")}
          </span>
        </div>

        <section className="ap-card ap-card--out">
          <header className="ap-card-head">
            <span className="ap-io-badge ap-io-badge--out">{t("tut.badgeOut")}</span>
            <div style={{ minWidth: 0 }}>
              <div className="ap-card-title">{t("tut.uwOutTitle")}</div>
              <div className="ap-card-sub">{t("tut.uwOutSub")}</div>
            </div>
          </header>
          <div className="ap-out-body">
            <div className="uw-reel">
              {finalReel ? (
                <TutorialVideo src={finalReel} poster={stills[0] ?? undefined} />
              ) : (
                <div className="ap-post-img" />
              )}
            </div>
            <div className="ap-out-right">
              <div className="nd-eyebrow">{t("tut.uwEightShots")}</div>
              <div className="uw-shots">
                {stills.map((url, i) => (
                  <button
                    key={i}
                    type="button"
                    className="uw-shot"
                    data-active={scene === i + 1}
                    style={url ? { backgroundImage: `url(${url})` } : undefined}
                    onClick={() => setScene(i + 1)}
                    aria-label={t("tut.traceScene", { n: i + 1 })}
                    aria-pressed={scene === i + 1}
                  />
                ))}
              </div>
              {caption && (
                <>
                  <div className="nd-eyebrow" style={{ marginTop: 6 }}>
                    {t("tut.theCaption")}
                  </div>
                  <p className="ap-hook">{caption.slice(0, 280)}</p>
                </>
              )}
            </div>
          </div>
        </section>
      </div>

      <div className="ap-chain-head">
        <h2>{t("tut.uwChainHeading")}</h2>
        <p className="ap-chain-note">
          {t("tut.uwFollowingScene", { n: String(scene).padStart(2, "0") })}
        </p>
      </div>

      <div className="ap-chain">
        {STEPS.map((step, i) => (
          <span key={step.n} style={{ display: "contents" }}>
            {i > 0 && <span className="ap-link" />}
            <section className={`ap-step${i === STEPS.length - 1 ? " ap-step--last" : ""}`}>
              <div className="ap-step-top">
                <span className="ap-step-badge">{step.n}</span>
                <span className="ap-step-kind">{t(step.kind)}</span>
              </div>
              <div className="ap-step-title">{t(step.title)}</div>
              <div className="ap-step-line">{t(step.line)}</div>
              <div className="ap-preview">{preview(step.node)}</div>
              <div className="ap-step-node">{localizeNode(step.node)}</div>
            </section>
          </span>
        ))}
      </div>

      {lightbox.open && (
        <TutorialLightbox src={lightbox.open.src} alt={lightbox.open.alt} onClose={lightbox.hide} />
      )}
    </div>
  )
}
