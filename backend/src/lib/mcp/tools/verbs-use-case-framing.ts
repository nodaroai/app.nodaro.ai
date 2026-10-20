/**
 * The framing source of a use-case verb that frames (decided 2026-10-17/20):
 * `framing_source` — one wording and one body mapper for every verb whose
 * route takes `framingSource` (Tighten Episode first; Clip Pack and Speaker
 * Layout reuse it). Its own module so every verb says it the same way.
 *
 * The route is the gate: `tracking` needs Speaker Frames (refused 403 where it
 * is not available to the caller); `auto` follows faces while it is, else the
 * even split, silently.
 */
import { z } from "zod"
import { USE_CASE_FRAMING_SOURCES, type UseCaseFramingSource } from "@nodaro/render-rules"

/** The framing-source field, spread into a verb's input schema. */
export const framingSourceInputShape = {
  framing_source: z
    .enum(USE_CASE_FRAMING_SOURCES as unknown as [UseCaseFramingSource, ...UseCaseFramingSource[]])
    .optional()
    .describe(
      'How a framed episode follows its speakers: "static" (default) splits the frame evenly by speaker; "tracking" follows faces with Speaker Frames ' +
        "(charged per started block of 1,000 sampled frames; a camera shared by several speakers keeps the even split until faces are named; " +
        'refused 403 where Speaker Frames is not available to you); "auto" follows faces while Speaker Frames is available to you, else the even split. ' +
        "Ignored without a framing.",
    ),
}

export type FramingSourceArgs = { readonly framing_source?: UseCaseFramingSource }

/** The body's `framingSource`, only when given. */
export function framingSourcePayload(args: FramingSourceArgs): { readonly framingSource?: UseCaseFramingSource } {
  return args.framing_source !== undefined ? { framingSource: args.framing_source } : {}
}
