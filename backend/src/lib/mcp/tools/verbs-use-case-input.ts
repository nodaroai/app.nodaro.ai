/**
 * A use-case run verb's input, as one value: its tool's name, its argument
 * shape (the tool's `inputSchema`) and the route body those arguments make.
 * The run verb registers the shape and posts the body (plus the lane fields:
 * who asked, and the reviewer); `estimate_use_case` validates the same
 * arguments against the same shape and posts the same body to the type's
 * `/estimate` route — so a quote is for exactly the run the arguments start.
 */
import type { z } from "zod"

/** A tool error, answered before any request. */
export type UseCaseToolError = { content: { type: "text"; text: string }[]; isError: true }

/** The body a verb's arguments make, or the tool error to answer instead. */
export type UseCaseVerbBody = { readonly payload: Record<string, unknown> } | { readonly error: UseCaseToolError }

export interface UseCaseVerbInput<S extends z.ZodRawShape = z.ZodRawShape> {
  /** The run verb's tool name. */
  readonly tool: string
  /** The run verb's arguments (its `inputSchema`). */
  readonly shape: S
  /** The route body the arguments make, without the lane fields (who asked, the reviewer). A method, so a
   *  table of verbs of different shapes can hold them all (`UseCaseVerbInput` with the default shape). */
  body(args: z.infer<z.ZodObject<S>>): UseCaseVerbBody
}

/** A verb's input, its arguments' type read from its shape. */
export function useCaseVerbInput<S extends z.ZodRawShape>(input: UseCaseVerbInput<S>): UseCaseVerbInput<S> {
  return input
}
