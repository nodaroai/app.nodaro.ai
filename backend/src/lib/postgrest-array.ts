/**
 * A text[] value for a PostgREST array filter (`.overlaps`, `.contains`,
 * `.containedBy`), every element quoted. Given an array, postgrest-js joins
 * the elements with commas and no quoting, so an element holding a comma
 * splits in two (a filter that silently misses) and one holding a quote or a
 * brace breaks the filter. A string value is passed through as written.
 */
export function postgresTextArray(values: readonly string[]): string {
  return `{${values.map((value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`
}
