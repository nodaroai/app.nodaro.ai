// The Social Media Autopilot tutorial.
//
// Leads with a headline rather than a step rail: the promise fits in a sentence
// — paste text, get a published carousel — so the page states it, puts IN beside
// OUT so the whole trade reads at a glance, and opens the seven steps below.
//
// The teaching device is a TRACED SLIDE, the same idea Underwater Giants uses
// for scenes. This template does the same work ten times over, so following ONE
// slide the whole way down — its written line, its place in the script, the
// image drawn for it — says more than describing the machine. Every strip and
// chip that names a slide selects it.

import { useMemo, useState } from "react"
import { nodeText, nodeMedia, nodeOutputText } from "../derive-tutorial-data"
import { TutorialLightbox, useLightbox } from "../tutorial-lightbox"
import { useT } from "@/lib/i18n"
import { useLocalizeNodeLabel } from "@/lib/i18n/labels"
import type { TutorialBodyProps } from "../tutorial-registry"
import type { WorkflowNode } from "@/types/nodes"
import { neighbours, parseSlides, type Slide } from "./autopilot-slides"
import {
  CAPTION_LABEL,
  CHAIN_HEADING,
  HEADLINE,
  HEADLINE_CHIPS,
  HERO,
  POST_CAPTION,
  STEPS,
  SUBLINE,
} from "./autopilot-content"
import "./autopilot.css"

function allMedia(node: WorkflowNode | undefined): string[] {
  const results = (node?.data as Record<string, unknown> | undefined)?.generatedResults
  if (!Array.isArray(results)) return []
  return results
    .map((r) => (r as Record<string, unknown>)?.url)
    .filter((u): u is string => typeof u === "string")
}

const firstLine = (t: string) => t.split("\n").map((l) => l.trim()).find(Boolean) ?? ""
const hashtags = (t: string) => (t.match(/#[\w֐-׿]+/g) ?? []).join(" ")

export default function AutopilotBody({ nodes }: TutorialBodyProps) {
  const [slide, setSlide] = useState(1)
  const lightbox = useLightbox()
  const t = useT()
  const localizeNode = useLocalizeNodeLabel()

  const byLabel = useMemo(() => {
    const map = new Map<string, WorkflowNode>()
    for (const n of nodes) {
      const label = (n.data as Record<string, unknown> | undefined)?.label
      if (typeof label === "string" && !map.has(label)) map.set(label, n)
    }
    return map
  }, [nodes])

  const idea = byLabel.get("Text Prompt")
  const imageNode = byLabel.get("Generate Image")
  const captionNode = byLabel.get("LLM Chat-Hook Generator")
  const postNode = byLabel.get("Instagram Post")
  const copyNode = byLabel.get("LLM Chat")

  const images = allMedia(imageNode)
  const slides = useMemo(() => parseSlides(nodeOutputText(copyNode)), [copyNode])
  const caption = nodeOutputText(captionNode) || nodeOutputText(copyNode)
  const hook = firstLine(caption)
  const tags = hashtags(caption)
  const postUrl = nodeMedia(postNode)

  // Driven by whichever list is longer: a run can draw ten images from nine
  // written lines, and hiding either would misreport what actually happened.
  const count = Math.max(images.length, slides.length)
  const imageFor = (n: number) => images[n - 1]
  const { prev, current, next } = neighbours(slides, slide)

  const SlideChip = ({ s, muted }: { s?: Slide; muted?: boolean }) =>
    s ? (
      <button
        type="button"
        className={`ap-slide-chip${muted ? " ap-slide-chip--muted" : ""}`}
        data-active={s.n === slide}
        onClick={() => setSlide(s.n)}
        aria-pressed={s.n === slide}
      >
        <span className="ap-chip-n">{s.n}</span> {s.text.slice(0, 54)}
      </button>
    ) : null

  const previewFor = (label: string): React.ReactNode => {
    switch (label) {
      case "LLM Chat":
        return <span className="ap-clamp">{current ? current.text : "—"}</span>
      case "Carousel Script":
        // In context: the slide before and after, so the sequence is visible.
        return (
          <div className="ap-chips-col">
            <SlideChip s={prev} muted />
            <SlideChip s={current} />
            <SlideChip s={next} muted />
          </div>
        )
      case "Generate Image": {
        const url = imageFor(slide)
        return url ? (
          <div
            className="ap-step-img tl-openable"
            style={{ backgroundImage: `url(${url})` }}
            role="button"
            tabIndex={0}
            aria-label={t("tut.openSlide", { n: slide })}
            onClick={() => lightbox.show(url, t("tut.slideN", { n: slide }))}
          />
        ) : (
          "—"
        )
      }
      case "Instagram Post":
        return (
          <div className="ap-post-mini">
            <span
              className="ap-post-mini-img"
              style={postUrl || images[0] ? { backgroundImage: `url(${postUrl ?? images[0]})` } : undefined}
            />
            <span className="ap-live-text">{t("tut.liveOnInstagram")}</span>
          </div>
        )
      case "LLM Chat-Hook Generator":
        return hook || "—"
      default: {
        const node = byLabel.get(label)
        return (nodeOutputText(node) || nodeText(node)).slice(0, 260) || "—"
      }
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
          {HEADLINE_CHIPS.map((c) => (
            <span key={c} className="nd-chip">
              {t(c)}
            </span>
          ))}
        </div>
      </header>

      <div className="ap-hero">
        <section className="ap-card">
          <header className="ap-card-head">
            <span className="ap-io-badge">{t(HERO.in.badge)}</span>
            <div>
              <div className="ap-card-title">{t(HERO.in.title)}</div>
              <div className="ap-card-sub">{t(HERO.in.sub)}</div>
            </div>
          </header>
          <div className="ap-card-body">
            <div className="ap-input">{nodeText(idea).slice(0, 520) || "—"}</div>
          </div>
        </section>

        <div className="ap-connector">
          <span className="ap-connector-bar" />
          <span className="ap-connector-text">
            {t(HERO.connector[0])}
            <br />
            {t(HERO.connector[1])}
          </span>
        </div>

        <section className="ap-card ap-card--out">
          <header className="ap-card-head">
            <span className="ap-io-badge ap-io-badge--out">{t(HERO.out.badge)}</span>
            <div style={{ minWidth: 0 }}>
              <div className="ap-card-title">{t(HERO.out.title)}</div>
              <div className="ap-card-sub">{t(HERO.out.sub)}</div>
            </div>
            {postUrl && (
              <span className="ap-live">
                <span className="ap-live-dot" />
                {t("tut.published")}
              </span>
            )}
          </header>
          <div className="ap-out-body">
            <div className="ap-post">
              <div
                className="ap-post-img tl-openable"
                style={imageFor(slide) ? { backgroundImage: `url(${imageFor(slide)})` } : undefined}
                role="button"
                tabIndex={0}
                aria-label={t("tut.openSlide", { n: slide })}
                onClick={() => {
                  const url = imageFor(slide)
                  if (url) lightbox.show(url, t("tut.slideN", { n: slide }))
                }}
              />
              <div className="ap-post-cap">{t(POST_CAPTION, { n: slide })}</div>
            </div>
            <div className="ap-out-right">
              {count > 0 && (
                <>
                  {/* All of them, not "the other nine": the strip is the index
                      of the carousel, and one of them is the traced slide. */}
                  <div className="nd-eyebrow">{t("tut.allSlides", { n: count })}</div>
                  <div className="ap-thumbs" style={{ gridTemplateColumns: `repeat(${count}, 1fr)` }}>
                    {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
                      <button
                        key={n}
                        type="button"
                        className="ap-thumb"
                        data-active={n === slide}
                        style={imageFor(n) ? { backgroundImage: `url(${imageFor(n)})` } : undefined}
                        onClick={() => setSlide(n)}
                        aria-label={t("tut.followSlide", { n })}
                        aria-pressed={n === slide}
                      />
                    ))}
                  </div>
                </>
              )}
              {hook && (
                <>
                  <div className="nd-eyebrow" style={{ marginTop: 6 }}>
                    {t(CAPTION_LABEL)}
                  </div>
                  <p className="ap-hook">{hook}</p>
                  {tags && <p className="ap-tags">{tags}</p>}
                </>
              )}
            </div>
          </div>
        </section>
      </div>

      <div className="ap-chain-head">
        <h2>{t(CHAIN_HEADING.title)}</h2>
        <p className="ap-chain-note">
          {t("tut.followingSlide", { n: slide })}
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
              <div className="ap-preview">{previewFor(step.label)}</div>
              <div className="ap-step-node">{localizeNode(step.label)}</div>
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
