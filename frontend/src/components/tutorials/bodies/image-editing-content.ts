// The only hand-written content in this tutorial.
//
// Names, one-line mechanisms and the "why it matters" paragraphs have no home in
// the graph, so they live here. Everything else — the images, the prompts, the
// picker values, the model names, even the grid order's fallback — is read off
// the template snapshot by `image-editing-edits.ts`.
//
// Keyed by node id, which is what ties a paragraph to the edit it explains. An
// id that is no longer in the template is simply unused; an edit with no entry
// still renders, using its canvas label.

export interface EditProse {
  /** Short name shown on the tile and in the trace header. */
  name: string
  /** One line naming the mechanism, under the name. */
  sub: string
  /** Why this edit is worth understanding. */
  why: string
}

/**
 * Grid order — the reading order of the nine results, left to right, top to
 * bottom. Written prompts first, then the picker-driven edits, then the two
 * structural ones. It is also the fallback ordering the derivation uses.
 */
export const EDIT_ORDER = [
  "node_6",
  "node_7",
  "node_9",
  "node_11",
  "node_15",
  "node_19",
  "node_21",
  "node_28",
  "node_29",
] as const

export const EDIT_PROSE: Record<string, EditProse> = {
  node_6: {
    name: "Jacket to navy",
    sub: "A written instruction",
    why: "The plainest kind of edit: say what to change and what to leave alone. Naming the thing you want kept is what stops the model from redrawing the face along with the jacket.",
  },
  node_7: {
    name: "Golden hour",
    sub: "Driven by a Lighting node",
    why: "No prompt at all. The Lighting node holds the choice, and the edit reads it — so relighting the shot is a dropdown, not a sentence you have to get right.",
  },
  node_9: {
    name: "Teal and orange",
    sub: "Driven by a Color / Look node",
    why: "A grade, not a repaint. The same picture with a film look applied — the kind of change you would otherwise describe badly in three lines of prompt.",
  },
  node_11: {
    name: "Anime, painted",
    sub: "Two Style nodes at once",
    why: "Two Style nodes feed this one edit and the result blends both. Style is not a single slot — stack them and you get a look neither one describes on its own.",
  },
  node_15: {
    name: "Atomic age, 1950s",
    sub: "Driven by an Era node",
    why: "An era carries wardrobe, palette and film stock together. This one also runs on a different model from its neighbours, which is a per-node choice, not a setting for the whole canvas.",
  },
  node_19: {
    name: "Cyberpunk",
    sub: "Driven by a Style node",
    why: "The same Style node as the anime edit, set to a different value. One node type covers the whole catalogue, so trying another look is one click.",
  },
  node_21: {
    name: "85mm portrait",
    sub: "Driven by a Lens node",
    why: "Optics, not content. Focal length changes compression and depth of field — the subject is untouched and the photograph is a different photograph.",
  },
  node_28: {
    name: "Background removed",
    sub: "No settings at all",
    why: "Nothing to configure and nothing to write. It takes the subject out on transparency, ready to drop onto anything.",
  },
  node_29: {
    name: "Tokyo at night",
    sub: "A written instruction",
    why: "A background replacement asks for two things at once: the new place, and the lighting on the subject matched to it. Ask for only the first and the cut-out look gives it away.",
  },
}

/** The headline band above the three columns. */
export const HEADLINE = "One image in. Nine different edits out."

export const SUBLINE =
  "Every edit reads the same original, so nothing stacks and nothing degrades. Click any result to see exactly what produced it."

export const FACTS = ["9 edits", "1 shared original", "nothing is destructive"]

export const IN_COLUMN = {
  title: "The original",
  sub: "Generated once, then never touched again",
}

/** The count is read off the graph, so the heading says "9 results" without
 *  anyone having to keep the word "Nine" true. */
export const OUT_COLUMN = {
  noun: "results",
  sub: "Click one to see what made it",
}

/** Sits under the critic's score. The critic is the one node here that saves
 *  money rather than making a picture, which is why it gets the room. */
export const CRITIC_LINE =
  "Scores the original before you spend anything editing it."

/** Shown in the trace column when an edit has no configuration to name. */
export const NO_SETTINGS = "No settings"
