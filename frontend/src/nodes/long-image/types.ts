import type { LongImageLength, LongImageMode, LongImageResolution } from "@nodaro/render-rules"
import type { FieldMappings, GeneratedResult } from "@/types/nodes"

/** Long Image: the node's data. Every field here is a node setting gen:skills documents. */
export type LongImageData = {
  [key: string]: unknown
  label: string
  /**
   * "webpage" (default): a webpage design, with an optional style picture and
   * an optional subject picture. "ecommerce": a product detail page from one to
   * three product pictures.
   */
  mode?: LongImageMode
  /** Product page only: "short" (about 2-5 sections), "medium" (default, 6-10) or "long" (11-18), all in one picture. */
  length?: LongImageLength
  /** "1K" or "2K" (default). */
  resolution?: LongImageResolution
  /**
   * What to make, up to 20,000 characters. Name the product pictures @image_1,
   * @image_2 and @image_3 (by the input each is wired to), and the webpage
   * pictures @style and @subject. Wired text (the "prompt" input) wins.
   */
  prompt?: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  currentJobId?: string
  currentJobProgress?: number
  /** The "image" output: the active take. */
  generatedImageUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}
