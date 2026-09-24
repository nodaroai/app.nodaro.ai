// Prose for the Social Media Autopilot tutorial.
//
// The step chain names the nodes it reads from; everything shown inside a step
// (excerpts, slide lines, thumbnails, the caption, the post) comes off those
// nodes at render time.
//
// Copy is held as dictionary keys and translated at render.

import type { MessageKey } from "@/lib/i18n"

export const HEADLINE: MessageKey = "tut.apHeadline"
export const SUBLINE: MessageKey = "tut.apSubline"
export const HEADLINE_CHIPS: readonly MessageKey[] = ["tut.apChipSlidesMax", "tut.apChipImagePerSlide", "tut.apChipUnattended"]

interface HeroCard {
  badge: MessageKey
  title: MessageKey
  sub: MessageKey
}

export const HERO: { in: HeroCard; out: HeroCard; connector: readonly [MessageKey, MessageKey] } = {
  in: { badge: "tut.badgeIn", title: "tut.apInTitle", sub: "tut.apInSub" },
  out: { badge: "tut.badgeOut", title: "tut.uwOutTitle", sub: "tut.apOutSub" },
  connector: ["tut.uwConnector1", "tut.uwConnector2"],
}

export const CHAIN_HEADING: { title: MessageKey; note: MessageKey } = {
  title: "tut.uwChainHeading",
  note: "tut.apChainNote",
}

/**
 * The seven steps, each pointing at the node whose real output it previews.
 * `node` is matched by label first, then by type — the template's ids are
 * generated, but the labels are authored and stable.
 */
export const STEPS: ReadonlyArray<{ n: number; kind: MessageKey; title: MessageKey; line: MessageKey; label: string }> = [
  { n: 1, kind: "tut.kindReads", title: "tut.apStep1Title", line: "tut.apStep1Line", label: "Text Prompt" },
  { n: 2, kind: "tut.kindConstrains", title: "tut.apStep2Title", line: "tut.apStep2Line", label: "System" },
  { n: 3, kind: "tut.kindWrites", title: "tut.apStep3Title", line: "tut.apStep3Line", label: "LLM Chat" },
  { n: 4, kind: "tut.kindSplits", title: "tut.apStep4Title", line: "tut.apStep4Line", label: "Carousel Script" },
  { n: 5, kind: "tut.kindDraws", title: "tut.apStep5Title", line: "tut.apStep5Line", label: "Generate Image" },
  { n: 6, kind: "tut.kindWrites", title: "tut.theCaption", line: "tut.apStep6Line", label: "LLM Chat-Hook Generator" },
  { n: 7, kind: "tut.kindPosts", title: "tut.apStep7Title", line: "tut.apStep7Line", label: "Instagram Post" },
]

export const SLIDE_PREVIEW_COUNT = 2
export const OTHER_SLIDES_LABEL: MessageKey = "tut.apOtherSlides"
export const CAPTION_LABEL: MessageKey = "tut.apCaptionLabel"
/** `{n}` is the slide on show. */
export const POST_CAPTION: MessageKey = "tut.apPostCaption"
