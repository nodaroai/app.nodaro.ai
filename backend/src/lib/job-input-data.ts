/**
 * Build the `jobs.input_data` JSONB payload from a Zod-parsed request body.
 *
 * Stores the full user-submitted config so it can be looked up later by
 * `jobId` to reconstruct "what config produced this result". Strips the
 * legacy `userId` body fallback (the authoritative user id comes from
 * `req.userId` set by the auth middleware).
 *
 * `workflowId` / `forcePrivate` are read from the raw body via the
 * `extractWorkflowId` / `extractForcePrivate` helpers and persisted in
 * dedicated columns, so they're not in the Zod schemas and don't need to
 * be excluded here.
 *
 * For uniformity and future-proofing: when the body has a `prompt` field,
 * mirror it to `userPrompt`. Routes that derive a different prompt before
 * sending to the AI provider override `prompt` after this helper spread;
 * `userPrompt` then stays as the original user submission. Routes with no
 * derivation end up with `prompt === userPrompt` — intentional, so consumers
 * (gallery, debug UI, downstream queries) can always read both fields without
 * special-casing.
 */
export function buildJobInputData(
  body: Record<string, unknown>,
  type: string,
): Record<string, unknown> {
  const { userId: _userId, ...rest } = body as Record<string, unknown> & {
    userId?: string
  }
  if (typeof rest.prompt === "string" && rest.userPrompt === undefined) {
    rest.userPrompt = rest.prompt
  }
  return { ...rest, type }
}
