// Prose for the Camera Coverage tutorial.
//
// ONLY text that has no home in the workflow lives here. The reference prompt,
// the brief, the shot lines, every image and every count are read off the
// template snapshot at render time, so republishing the template cannot leave
// this file lying. The copy is the design handoff's, verbatim; the only thing
// composed at runtime is the shot count, which is the one figure that could
// silently drift from the template.

export const HEADLINE = "One frame in. Ten angles of the same moment out."

export const SUBLINE =
  "Character, wardrobe, location and light never change. Only the camera does. You see the shot list before you spend anything, and you can rewrite any line of it."

/** Headline chips after the derived "N shots" one. */
export const FACTS = ["6 nodes, not 25", "cuttable as a sequence"] as const

/** "ten", so a sentence can say "ten runs" the way the design does, without
 *  hardcoding a figure the template may one day contradict. Past twelve, digits. */
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"]
export function countWord(n: number): string {
  return WORDS[n] ?? String(n)
}
function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// --- column 1: the reference frame ------------------------------------------

export const IN_COLUMN = {
  title: "The reference frame",
  sub: "One image. This is the scene.",
} as const

export const REFERENCE_PROMPT_EYEBROW = "Reference prompt"

/**
 * The brief, condensed. The full brief on the canvas is nine rules; these are
 * the five load-bearing ones, in the brief's own order. It is a control, not
 * an output — hence teal, the same colour role the Image Critic has in the
 * image-editing tutorial.
 */
export const BRIEF = {
  eyebrow: "The coverage brief · edit this to change the plan",
  rules: [
    "Real coverage order: wide, two mediums, two close-ups, over-the-shoulder, reverse, insert, dynamic angle, profile.",
    "One camera angle per line. Never stack two angle terms.",
    "Camera position, not movement. Motion is added later.",
    "Screen direction stays consistent, so the cuts do not jump.",
    "Leave breathing room. Every frame must work as a start frame for animation.",
  ],
} as const

// --- column 2: the shot list ------------------------------------------------

export const LIST_COLUMN = {
  title: "The shot list",
  sub: (count: number) => `${capital(countWord(count))} lines, editable before you spend`,
  meta: "Click a line",
} as const

export const LEVER = {
  eyebrow: "The lever",
  body: (count: number) => `This list is what turns one image node into ${countWord(count)} runs.`,
} as const

/**
 * Short names for what each line IS, by position. Authored, because the lines
 * themselves are 25-word camera setups and the list has to be scannable. The
 * positions follow the brief's coverage order (wide, two mediums, two close-ups,
 * over-the-shoulder, reverse, insert, dynamic angle, profile), which is what
 * makes a position-keyed label safe — and the seed contract test checks each
 * label against the line it names, so a re-published run that changes the
 * order fails there rather than mislabelling shots in the tutorial.
 */
export const SHOT_KINDS: readonly string[] = [
  "Wide establishing",
  "Medium, waist-up",
  "Medium, three-quarter",
  "Close-up, profile",
  "Tight close-up",
  "Over-the-shoulder",
  "Reverse angle",
  "Insert detail",
  "Low angle",
  "Clean profile",
]

/** The kind for a 1-based shot position; a plain fallback past the authored ten. */
export function kindFor(index: number): string {
  return SHOT_KINDS[index - 1] ?? `Shot ${index}`
}

// --- column 3: the contact sheet --------------------------------------------

export const OUT_COLUMN = {
  title: "The contact sheet",
  sub: (count: number) => `${capital(countWord(count))} shots of the same moment, one node`,
} as const

export const statusLine = (generated: number, count: number) => `${generated} of ${count} generated`

export const shotTag = (index: number, count: number) => `Shot ${String(index).padStart(2, "0")} of ${count}`

export const SHEET_EYEBROW = (count: number) => `All ${countWord(count)}, in cutting order`

/** The three spec rows under the selected shot. ANCHOR is the point of the whole
 *  tutorial: every one of the runs is fed the same reference frame. */
export const SPECS = {
  anchor: { key: "Anchor", value: "the reference frame" },
  prompt: { key: "Prompt", value: (index: number) => `row ${index} of the list` },
  node: { key: "Node", value: (label: string, index: number) => `${label}, run ${index}` },
} as const

export const NOT_RUN = "not run yet"
