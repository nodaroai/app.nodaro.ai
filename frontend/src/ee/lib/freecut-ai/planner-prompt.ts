/**
 * The instructions the planner model gets for one Edit with AI request, and the
 * shape its answer must have. It only chooses which abilities the person asked
 * for and what each needs (how the music sounds, what to change in the
 * picture, which look, how many clips); the edit itself is done by the agents.
 */
import { EDIT_STEPS, LOOKS } from "./edit-plan"

export const PLANNER_MODEL = "gemini-3.6-flash"
/** Little thinking: the request is short, and the person is waiting for the work to start. */
export const PLANNER_EFFORT = "low" as const

export function plannerSystemPrompt(): string {
  return [
    "You plan an automatic edit of a video in a browser video editor. Read the person's request and choose which of these abilities it asks for:",
    "- pauses: cut the silent pauses between sentences.",
    "- fillers: remove filler sounds such as um, uh and hesitations.",
    "- mistakes: remove mistakes, restarts, repeated takes and off-topic parts.",
    "- captions: add captions that follow the speech, word by word.",
    "- music: put background music under the voice.",
    "- broll: add short generated cutaway shots (b-roll) over what is said.",
    "- titles: put short texts on the screen as they are said: a headline, key words in color, a big number, a list. Not the captions.",
    "- picture: change anything inside the picture: the background, a person, clothes, hair, a car, an object, the sky, or the style (cartoon, anime, vintage).",
    "- color: a color grade: warm, cool, vivid, or black and white.",
    "- zoom: punch-in zooms on the key lines.",
    "- phone: a vertical 9:16 phone version that follows the face.",
    "- layout: every speaker of the recording in a part of their own (set layout: stacked, side, grid or pip).",
    "- cameras: switch between several cameras, to whoever speaks.",
    "- clips: short clips made from the best moments, each in its own tab.",
    "- trailer: a short teaser made from the strongest moments.",
    "- chapters: a chapter list with times.",
    'If the request asks for a general improvement ("make it better", "edit it for me"), choose pauses, fillers, captions and music.',
    "Otherwise choose only what the request asks for. Never add an ability the person did not ask for. When it asks for none of them, answer with an empty steps list.",
    'For "picture", write "instruction": one English instruction for a video editing model that says exactly what to change and that everything else, the person\'s face, lips and movements included, stays the same; and "what": the thing being changed, in the language of the request, in a few words.',
    'For "music", write "musicStyle": the music in English for a music generator: genre, mood, instruments and energy, always instrumental, at most 20 words, following what the person said.',
    `For "color", write "look": one of ${LOOKS.join(", ")}. For "clips", write "clips": how many (1 to 6, 2 when the request does not say).`,
    'Anything the request asks for that is none of these abilities goes in "cannot", as short phrases in the language of the request.',
    '"reply" is one short friendly sentence in the language of the request: what you will do, and what was left out, if anything.',
    'Fields an ability you did not choose would need are empty strings ("") or the defaults (look "warm", clips 2).',
  ].join("\n")
}

/** The answer's shape, for the structured call: validated (and asked again) by the platform. No nulls: an unused field is empty. */
export const PLANNER_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    steps: { type: "array", items: { type: "string", enum: [...EDIT_STEPS] } },
    musicStyle: { type: "string" },
    picture: {
      type: "object",
      properties: { instruction: { type: "string" }, what: { type: "string" } },
      required: ["instruction", "what"],
    },
    look: { type: "string", enum: [...LOOKS] },
    clips: { type: "integer" },
    layout: { type: "string", enum: ["stacked", "side", "grid", "pip"] },
    reply: { type: "string" },
    cannot: { type: "array", items: { type: "string" } },
  },
  required: ["steps", "musicStyle", "picture", "look", "clips", "layout", "reply", "cannot"],
}
