/**
 * Replace {} placeholders in a field value with upstream text.
 *
 * ONLY handles {} injection. Does NOT inject into empty fields.
 * Empty-field fallback (d.prompt || inputs.prompt) stays in per-node
 * execution code — the resolver doesn't decide which field is "primary."
 */
export function injectUpstream(
  fieldValue: string | undefined,
  upstream: string | undefined,
): string | undefined {
  if (!fieldValue || !upstream) return fieldValue
  if (fieldValue.includes("{}")) return fieldValue.replaceAll("{}", upstream)
  return fieldValue
}
