/** Filter the dense `string[]` from a fanned-out upstream (empty/whitespace-only strings = failed iterations). */
export function filterSurvivors(items: string[]): string[] {
  return items.filter((s) => s.trim() !== "")
}
