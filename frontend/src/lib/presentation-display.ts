import type { PresentationDisplay, LoopColumn } from "@/types/nodes"

/** Element size pixel values for each context */
export const ELEMENT_SIZES = {
  cardsImage: { sm: 64, md: 128, lg: 256 },
  tableThumbnail: { sm: 40, md: 64, lg: 96 },
  imageOutput: { sm: "max-h-[200px]", md: "max-h-[400px]", lg: "max-h-[70vh]" },
  videoOutput: { sm: "max-h-[200px]", md: "max-h-[400px]", lg: "max-h-[70vh]" },
  audioOutput: { sm: "h-10", md: "h-14", lg: "h-20" },
} as const

/** Default columns by output type */
const DEFAULT_COLUMNS: Record<string, 1 | 2 | 3 | 4> = {
  image: 2,
  video: 1,
  audio: 1,
  text: 1,
  loop: 1,
}

/** Check if a column type is a media type */
export function isMediaColumn(type: string): boolean {
  return type === "image-url" || type === "video-url" || type === "audio-url"
}

function hasMediaColumns(columns: LoopColumn[]): boolean {
  return columns.some((c) => isMediaColumn(c.type))
}

const MIME_PREFIXES: Record<string, string> = {
  "image-url": "image/",
  "video-url": "video/",
  "audio-url": "audio/",
}

/** Map a LoopColumn type to its MIME prefix */
export function colTypeToMimePrefix(colType: string): string {
  return MIME_PREFIXES[colType] ?? "application/"
}

/** Resolve display settings: cardMeta overrides node defaults, then auto-defaults */
export function resolveDisplay(
  nodeDisplay: PresentationDisplay | undefined,
  cardDisplay: Partial<PresentationDisplay> | undefined,
  outputType: string,
  loopColumns?: LoopColumn[],
): Required<PresentationDisplay> {
  const merged = { ...nodeDisplay, ...cardDisplay }
  return {
    columns: merged.columns ?? DEFAULT_COLUMNS[outputType] ?? 1,
    elementSize: merged.elementSize ?? "md",
    viewMode: merged.viewMode ?? (
      outputType === "loop"
        ? (loopColumns && hasMediaColumns(loopColumns) ? "cards" : "table")
        : ""
    ),
  }
}

/** Clamp columns for narrow viewports */
export function responsiveColumns(columns: number, isMobile: boolean): number {
  return isMobile ? Math.min(columns, 2) : columns
}
