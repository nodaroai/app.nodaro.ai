// Which template slugs have a guided tutorial, and what renders them.
//
// A slug that is NOT in this registry has no guided view — that is the whole
// point. Tutorial mode is opt-in per template, and each entry brings its own
// body component, so the next tutorial can look different from this one without
// touching the shell or any tutorial already shipped.

import { lazy, type ComponentType, type LazyExoticComponent } from "react"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import type { TutorialFocus } from "./use-tutorial-focus"
import { tx, type MessageKey, type TFunction } from "@/lib/i18n"

/** A rail step as the shell shows it — already translated. */
export interface TutorialStep {
  n: number
  title: string
  sub: string
}

/** A rail step as the registry authors it: dictionary keys, translated by `getTutorial`. */
interface TutorialStepKeys {
  n: number
  title: MessageKey
  sub: MessageKey
}

/** Props every tutorial body receives from the shell. */
export interface TutorialBodyProps {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  focus: TutorialFocus
  /** Credits the template's own metadata reports — never a hardcoded figure. */
  estimatedCredits: number
  onRunNode: () => void
}

export interface TutorialDefinition {
  /** Rail heading. Falls back to the template name when absent. */
  title?: string
  /** Rail description. Falls back to the template description. */
  summary?: string
  steps: TutorialStep[]
  /** Rough reading time shown as a rail chip. */
  minutes: number
  /** Optional reassurance block in the rail. */
  note?: { eyebrow: string; body: string }
  /**
   * Model whose cost is the headline figure, when the template's total is the
   * wrong thing to quote. The Welcome Demo is a FINISHED run — every result is
   * already there — so its total (hundreds of credits) reads as a price tag on
   * something free to look at. What a newcomer actually spends is the cost of
   * the one node they press Run on.
   */
  startCostModel?: string
  /**
   * Replaces the credits chip in the rail. For a tutorial you READ rather than
   * run, a price is the wrong headline entirely — this one is three finished
   * runs to compare, so it says so instead of quoting a total nobody spends.
   */
  chip?: string
  Body: LazyExoticComponent<ComponentType<TutorialBodyProps>>
}

/**
 * The authored form of a definition. Every piece of copy is a dictionary key,
 * so the registry can live at module level; `getTutorial` translates it at the
 * moment it is asked, in the language the reader has chosen.
 */
interface TutorialEntry extends Omit<TutorialDefinition, "title" | "summary" | "steps" | "note" | "chip"> {
  title?: MessageKey
  summary?: MessageKey
  steps: TutorialStepKeys[]
  note?: { eyebrow: MessageKey; body: MessageKey }
  chip?: MessageKey
}

const REGISTRY: Record<string, TutorialEntry> = {
  "multi-reference-control": {
    title: "tut.regMrcTitle",
    summary: "tut.regMrcSummary",
    minutes: 3,
    steps: [
      { n: 1, title: "tut.mrcAddRefsTitle", sub: "tut.regMrcStep1Sub" },
      // The stored token is `{image:N}`; the editor — and this tutorial — show
      // it as an `@image:N` chip, which is the form the user actually sees.
      { n: 2, title: "tut.mrcWritePromptTitle", sub: "tut.regMrcStep2Sub" },
      { n: 3, title: "common.generate", sub: "tut.mrcGenerateSub" },
      { n: 4, title: "tut.mrcMakeItYours", sub: "tut.regMrcStep4Sub" },
    ],
    Body: lazy(() => import("./bodies/multi-reference-body")),
  },

  "welcome-demo": {
    title: "welcome.eyebrow",
    summary: "tut.regWdSummary",
    minutes: 4,
    startCostModel: "z-image",
    note: {
      eyebrow: "tut.wdNoteEyebrow",
      body: "tut.wdNoteBody",
    },
    steps: [
      { n: 1, title: "tut.wdIdeaTitle", sub: "tut.wdIdeaSub" },
      { n: 2, title: "tut.wdImageTitle", sub: "tut.regWdStep2Sub" },
      { n: 3, title: "tut.wdVideoTitle", sub: "tut.regWdStep3Sub" },
      { n: 4, title: "tut.wdAudioTitle", sub: "tut.regWdStep4Sub" },
      { n: 5, title: "tut.wdFinalTitle", sub: "tut.regWdStep5Sub" },
    ],
    Body: lazy(() => import("./bodies/welcome-demo-body")),
  },

  "person-node-basics": {
    title: "tut.regPnTitle",
    summary: "tut.regPnSummary",
    minutes: 5,
    chip: "tut.regPnChip",
    note: {
      eyebrow: "tut.pnNoteEyebrow",
      body: "tut.pnNoteBody",
    },
    steps: [
      // No number here on purpose: the card counts the picks off the node, and a
      // multi-value field (this person carries two ethnicities) makes any figure
      // written down here disagree with what is on screen.
      { n: 1, title: "tut.pnLesson1Title", sub: "tut.pnLesson1Sub" },
      { n: 2, title: "tut.pnLesson2Title", sub: "tut.pnLesson2Sub" },
      { n: 3, title: "tut.pnRailStep3Title", sub: "tut.pnRailStep3Sub" },
    ],
    Body: lazy(() => import("./bodies/person-node-body")),
  },

  "suno-music-basics": {
    title: "tut.regSunoTitle",
    summary: "tut.regSunoSummary",
    minutes: 6,
    chip: "tut.regSunoChip",
    note: {
      eyebrow: "tut.regSunoNoteEyebrow",
      body: "tut.regSunoNoteBody",
    },
    steps: [
      { n: 1, title: "tut.regSunoStep1Title", sub: "tut.regSunoStep1Sub" },
      { n: 2, title: "tut.regSunoStep2Title", sub: "tut.regSunoStep2Sub" },
      { n: 3, title: "tut.regSunoStep3Title", sub: "tut.regSunoStep3Sub" },
    ],
    Body: lazy(() => import("./bodies/suno-music-body")),
  },

  "social-media-autopilot": {
    title: "tut.regApTitle",
    summary: "tut.regApSummary",
    minutes: 4,
    chip: "tut.apChipUnattended",
    steps: [
      { n: 1, title: "tut.regApStep1Title", sub: "tut.regApStep1Sub" },
      { n: 2, title: "tut.regApStep2Title", sub: "tut.regApStep2Sub" },
      { n: 3, title: "tut.regApStep3Title", sub: "tut.regApStep3Sub" },
    ],
    Body: lazy(() => import("./bodies/autopilot-body")),
  },

  "get-started-with-image-editing": {
    title: "tut.regIedTitle",
    summary: "tut.regIedSummary",
    minutes: 4,
    // A price is the wrong headline: all nine edits are already generated and
    // reading them costs nothing. What is worth counting is how many there are.
    chip: "tut.iedChipEdits",
    note: {
      eyebrow: "tut.regIedNoteEyebrow",
      body: "tut.regIedNoteBody",
    },
    steps: [
      { n: 1, title: "tut.theOriginal", sub: "tut.regIedStep1Sub" },
      { n: 2, title: "tut.regIedStep2Title", sub: "tut.regIedStep2Sub" },
      { n: 3, title: "tut.regIedStep3Title", sub: "tut.regIedStep3Sub" },
    ],
    Body: lazy(() => import("./bodies/image-editing-body")),
  },

  "camera-coverage": {
    title: "tut.regCcvTitle",
    summary: "tut.regCcvSummary",
    minutes: 4,
    // A finished run: every image is already generated and reading them costs
    // nothing. What a newcomer actually spends is the ten-image fan-out.
    chip: "tut.regCcvChip",
    note: {
      eyebrow: "tut.regCcvNoteEyebrow",
      body: "tut.regCcvNoteBody",
    },
    // One step per column. This template is not IN → OUT: there is a plan you
    // see before you spend, so the body is three columns and the rail follows.
    steps: [
      { n: 1, title: "tut.ccvInTitle", sub: "tut.regCcvStep1Sub" },
      { n: 2, title: "tut.ccvListTitle", sub: "tut.regCcvStep2Sub" },
      { n: 3, title: "tut.ccvOutTitle", sub: "tut.regCcvStep3Sub" },
    ],
    Body: lazy(() => import("./bodies/camera-coverage-body")),
  },

  "one-character-any-scene": {
    title: "tut.regOcTitle",
    summary: "tut.regOcSummary",
    minutes: 4,
    // Every result is already generated; reading them costs nothing. What is
    // worth counting is the recipes.
    chip: "tut.regOcChip",
    // The IN column already says "same two, every time"; the rail adds the
    // one thing a first-timer gets wrong.
    note: {
      eyebrow: "tut.regOcNoteEyebrow",
      body: "tut.regOcNoteBody",
    },
    // One step per column: the sources, the recipes, the result.
    steps: [
      { n: 1, title: "tut.ocInTitle", sub: "tut.regOcStep1Sub" },
      { n: 2, title: "tut.ocRecipesTitle", sub: "tut.regOcStep2Sub" },
      { n: 3, title: "tut.theResult", sub: "tut.regOcStep3Sub" },
    ],
    Body: lazy(() => import("./bodies/one-character-body")),
  },

  "underwater-giants": {
    title: "tut.regUwTitle",
    summary: "tut.regUwSummary",
    minutes: 5,
    chip: "tut.uwChipScenes",
    steps: [
      { n: 1, title: "tut.regUwStep1Title", sub: "tut.regUwStep1Sub" },
      { n: 2, title: "tut.regUwStep2Title", sub: "tut.regUwStep2Sub" },
      { n: 3, title: "tut.regUwStep3Title", sub: "tut.regUwStep3Sub" },
    ],
    Body: lazy(() => import("./bodies/underwater-body")),
  },
}

// Own-property checks, not `in` / plain indexing: a template slug is chosen by
// whoever publishes it, so `constructor` or `toString` is a slug someone can
// actually create, and both would otherwise resolve through Object.prototype —
// handing the card a function where a tutorial definition belongs.
//
// The copy comes back translated with `t` — the caller's, or the live locale's
// when none is given — so a reader sees the rail in the language they chose.
export function getTutorial(slug: string | undefined, t: TFunction = tx): TutorialDefinition | null {
  if (!slug || !Object.hasOwn(REGISTRY, slug)) return null
  const entry = REGISTRY[slug]
  return {
    ...entry,
    title: entry.title && t(entry.title),
    summary: entry.summary && t(entry.summary),
    steps: entry.steps.map((step) => ({ n: step.n, title: t(step.title), sub: t(step.sub) })),
    note: entry.note && { eyebrow: t(entry.note.eyebrow), body: t(entry.note.body) },
    chip: entry.chip && t(entry.chip),
  }
}

/** Slugs with a guided view — used to decide whether to link to /tutorials/:slug. */
export function hasTutorial(slug: string | undefined | null): boolean {
  return !!slug && Object.hasOwn(REGISTRY, slug)
}
