// Which template slugs have a guided tutorial, and what renders them.
//
// A slug that is NOT in this registry has no guided view — that is the whole
// point. Tutorial mode is opt-in per template, and each entry brings its own
// body component, so the next tutorial can look different from this one without
// touching the shell or any tutorial already shipped.

import { lazy, type ComponentType, type LazyExoticComponent } from "react"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import type { TutorialFocus } from "./use-tutorial-focus"

export interface TutorialStep {
  n: number
  title: string
  sub: string
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

const REGISTRY: Record<string, TutorialDefinition> = {
  "multi-reference-control": {
    title: "Multi-Reference Control",
    summary: "Five source images, one generated image. Point at a picture instead of describing it.",
    minutes: 3,
    steps: [
      { n: 1, title: "Add your references", sub: "Five uploads into one References handle" },
      // The stored token is `{image:N}`; the editor — and this tutorial — show
      // it as an `@image:N` chip, which is the form the user actually sees.
      { n: 2, title: "Write the prompt", sub: "Point at positions with @image:N" },
      { n: 3, title: "Generate", sub: "One image, five sources" },
      { n: 4, title: "Make it yours", sub: "Swap one image, rerun, compare" },
    ],
    Body: lazy(() => import("./bodies/multi-reference-body")),
  },

  "welcome-demo": {
    title: "Welcome to Nodaro",
    summary:
      "One sentence became an image, the image became motion, and a voice line tied it together. This canvas is a finished run.",
    minutes: 4,
    startCostModel: "z-image",
    note: {
      eyebrow: "Nothing here costs anything to look at",
      body: "Every result is already generated. Edit the Scene Idea and press Run on Scene Image when you want it to be yours.",
    },
    steps: [
      { n: 1, title: "Scene Idea", sub: "One sentence, in plain words" },
      { n: 2, title: "Scene Image", sub: "Z-Image, the first thing worth running" },
      { n: 3, title: "Animate", sub: "Seedance 2 Fast, 5 seconds" },
      { n: 4, title: "Narration and Voiceover", sub: "A second chain, running in parallel" },
      { n: 5, title: "Final Cut", sub: "Video and voice merged" },
    ],
    Body: lazy(() => import("./bodies/welcome-demo-body")),
  },

  "person-node-basics": {
    title: "Getting Started with the Person Node",
    summary:
      "Pick attributes from dropdowns and the node writes the character prompt for you. Three runs, from one node to a full stack.",
    minutes: 5,
    chip: "3 runs",
    note: {
      eyebrow: "The pattern",
      body: "Compose images from modular blocks. Swap any node to iterate fast.",
    },
    steps: [
      // No number here on purpose: the card counts the picks off the node, and a
      // multi-value field (this person carries two ethnicities) makes any figure
      // written down here disagree with what is on screen.
      { n: 1, title: "Meet the Person node", sub: "Picks become a written prompt" },
      { n: 2, title: "Same node, different character", sub: "Change the picks, change everything" },
      { n: 3, title: "Stack nodes for scene control", sub: "Backdrop, Framing and Mood on top" },
    ],
    Body: lazy(() => import("./bodies/person-node-body")),
  },

  "suno-music-basics": {
    title: "Making music with nodes",
    summary:
      "You do not write a song description. You pick options, and the nodes write it for you.",
    minutes: 6,
    chip: "7 runs",
    note: {
      eyebrow: "How to use this tutorial",
      body: "Step through the runs. Each one changes exactly one thing from the run before it, so the difference you hear is the option that moved.",
    },
    steps: [
      { n: 1, title: "Pick options on the style nodes", sub: "Genre, mood, instrumentation, voice" },
      { n: 2, title: "Send them into Suno Generate", sub: "The picks become the style description" },
      { n: 3, title: "Get a finished track", sub: "Play it, then change one option" },
    ],
    Body: lazy(() => import("./bodies/suno-music-body")),
  },

  "social-media-autopilot": {
    title: "Social Media Autopilot",
    summary:
      "Paste an idea. Seven nodes split it into slides, draw an image for each one, write the caption, and post it.",
    minutes: 4,
    chip: "runs unattended",
    steps: [
      { n: 1, title: "Give it one block of text", sub: "Nothing else to fill in" },
      { n: 2, title: "It writes and draws ten slides", sub: "Copy per slide, an image each" },
      { n: 3, title: "It captions and publishes", sub: "Formatted for the feed, then posted" },
    ],
    Body: lazy(() => import("./bodies/autopilot-body")),
  },

  "get-started-with-image-editing": {
    title: "Get started with image editing",
    summary:
      "One image is generated once, and nine independent edits each read that same original. Nothing stacks, so nothing degrades.",
    minutes: 4,
    // A price is the wrong headline: all nine edits are already generated and
    // reading them costs nothing. What is worth counting is how many there are.
    chip: "9 edits",
    note: {
      eyebrow: "This is a fan-out, not a chain",
      body: "Every edit reads the original directly. Change one and the other eight are unaffected — that is the whole idea.",
    },
    steps: [
      { n: 1, title: "The original", sub: "Generated once, then scored" },
      { n: 2, title: "Nine edits, one source", sub: "Each reads the same image" },
      { n: 3, title: "Follow any result", sub: "Click a tile to see what made it" },
    ],
    Body: lazy(() => import("./bodies/image-editing-body")),
  },

  "camera-coverage": {
    title: "Camera Coverage — one frame, ten angles",
    summary:
      "One reference frame in, ten shots of the same scene out. Only the camera changes — a director's coverage plan you can cut together, from a single image.",
    minutes: 4,
    // A finished run: every image is already generated and reading them costs
    // nothing. What a newcomer actually spends is the ten-image fan-out.
    chip: "10 shots",
    note: {
      eyebrow: "The lever is the list",
      body: "One image node, ten rows. The list fans it out so ten shots cost six nodes, not twenty-five — and editing one line re-shoots one angle.",
    },
    // One step per column. This template is not IN → OUT: there is a plan you
    // see before you spend, so the body is three columns and the rail follows.
    steps: [
      { n: 1, title: "The reference frame", sub: "One image, and the brief that governs the plan" },
      { n: 2, title: "The shot list", sub: "Ten lines you can read — and rewrite — before you spend" },
      { n: 3, title: "The contact sheet", sub: "Ten shots of one moment, from one image node" },
    ],
    Body: lazy(() => import("./bodies/camera-coverage-body")),
  },

  "underwater-giants": {
    title: "Underwater Giants",
    summary:
      "Write eight scenes. Each becomes an image, then a five second shot, edited together with music and posted as a reel.",
    minutes: 5,
    chip: "8 scenes",
    steps: [
      { n: 1, title: "Write eight scenes", sub: "One paragraph each" },
      { n: 2, title: "Stills, then motion", sub: "Each scene anchored to the last" },
      { n: 3, title: "Scored, cut and posted", sub: "34 seconds, vertical" },
    ],
    Body: lazy(() => import("./bodies/underwater-body")),
  },
}

// Own-property checks, not `in` / plain indexing: a template slug is chosen by
// whoever publishes it, so `constructor` or `toString` is a slug someone can
// actually create, and both would otherwise resolve through Object.prototype —
// handing the card a function where a tutorial definition belongs.
export function getTutorial(slug: string | undefined): TutorialDefinition | null {
  if (!slug || !Object.hasOwn(REGISTRY, slug)) return null
  return REGISTRY[slug]
}

/** Slugs with a guided view — used to decide whether to link to /tutorials/:slug. */
export function hasTutorial(slug: string | undefined | null): boolean {
  return !!slug && Object.hasOwn(REGISTRY, slug)
}
