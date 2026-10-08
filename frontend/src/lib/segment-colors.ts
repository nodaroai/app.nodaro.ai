/** Distinct overlay tints, cycled by position — brand pink first. Shared by the
 *  Refine regions outlines and Speaker View's region editor (U4). */
export const SEGMENT_COLORS = [
  "#ff0073",
  "#38bdf8",
  "#34d399",
  "#fbbf24",
  "#a78bfa",
  "#fb923c",
  "#22d3ee",
  "#f472b6",
] as const

export const segmentColor = (position: number): string => SEGMENT_COLORS[position % SEGMENT_COLORS.length]!
