import type { FieldMappings, GeneratedResult } from "@/types/nodes"

// Gif to Video: an animated GIF (wired image or the node's own upload) → MP4.
export type GifToVideoData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  /** Source GIF URL — set by the node's built-in upload dropzone OR resolved
   *  from an upstream image producer edge (an uploaded .gif). */
  gifUrl?: string
  /** Asset id when the GIF was uploaded via the node's own dropzone. */
  assetId?: string
  /** Extend a short GIF by looping up to the target window. A sub-floor GIF is
   *  looped regardless; this toggle governs stretching an already-valid GIF. */
  loopToMinimum: boolean
  /** Target duration when looping (2-8s). */
  targetDuration: number
  /** true → minterpolate (smooth). false → preserve the GIF's stepped timing. */
  interpolate: boolean
  /** Colour transparent GIFs are flattened onto. */
  alphaBackground: "white" | "black"
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}
