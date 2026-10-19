/**
 * The preview refusals' copy (en), by where the run is refused and by what
 * holds it (`previewHoldKind`, @nodaro/render-rules): a render at Preview is
 * fixed by setting it to Final, a use-case node with review on by turning its
 * "Review before render" off. "any" is both remedies, for a graph both kinds
 * actually hold. Not knowing what held a run (a bare code with no kind
 * recorded) reads as a render: the wording render users have always seen.
 * Every refusal site takes its text from here.
 *
 * The render texts are the ones clients have always seen (pinned by a test);
 * the editor's localized copy (`previewGate.*`) follows the same table. The
 * review texts name no node type (decided 2026-10-18): every node that has
 * "Review before render" holds a run the same way, whichever type it is.
 */
import type { PreviewHoldKind } from "@nodaro/render-rules"

/** Where a run that holds a review is refused. */
export type PreviewRefusalSituation =
  /** Nobody is there to review it: a trigger, an API / SDK / MCP call, an app run. */
  | "headless"
  /** A sub-workflow holds it. */
  | "nested"
  /** A workflow published as a component holds it. */
  | "componentPublish"
  /** A component's run holds it. */
  | "componentRun"

const COPY: Readonly<Record<PreviewRefusalSituation, Readonly<Record<PreviewHoldKind, string>>>> = {
  headless: {
    render:
      "This workflow stops for a review: its render is set to Preview, and only a run started in the Nodaro editor or on an app's own page can stop for one. " +
      "Open it there to run it, or set the render to Final (or send a Final quality override for it).",
    review:
      "This workflow stops for a review: a node in it has “Review before render” on, and only a run started in the Nodaro editor or on an app's own page can stop for one. " +
      "Open it there to run it, or turn off “Review before render” on every node that has it on.",
    any:
      "This workflow stops for a review, and only a run started in the Nodaro editor or on an app's own page can stop for one. " +
      "Open it there to run it, or set any render at Preview to Final (or send a Final quality override for it) and turn off “Review before render” on every node that has it on.",
  },
  nested: {
    render: "This sub-workflow stops for a review (its render is set to Preview), and a nested workflow cannot. Set that render to Final.",
    review:
      "This sub-workflow stops for a review (a node in it has “Review before render” on), and a nested workflow cannot. " +
      "Turn off “Review before render” on every node that has it on.",
    any:
      "This sub-workflow stops for a review, and a nested workflow cannot. " +
      "Set any render at Preview to Final and turn off “Review before render” on every node that has it on.",
  },
  componentPublish: {
    render: "A component cannot stop for a review: set its render to Final before publishing it.",
    review: "A component cannot stop for a review: turn off “Review before render” on every node that has it on before publishing it.",
    any:
      "A component cannot stop for a review: set any render at Preview to Final and turn off “Review before render” on every node that has it on before publishing it.",
  },
  componentRun: {
    render: "A component cannot stop for a review: its render must be set to Final.",
    review: "A component cannot stop for a review: every node in it must have “Review before render” off.",
    any: "A component cannot stop for a review: any render at Preview must be set to Final, and every node in it must have “Review before render” off.",
  },
}

/** The refusal's text for `situation`, naming the remedy for what holds the run. */
export function previewRefusalMessage(situation: PreviewRefusalSituation, kind: PreviewHoldKind = "render"): string {
  return COPY[situation][kind]
}
