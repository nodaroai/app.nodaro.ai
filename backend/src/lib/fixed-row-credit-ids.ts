/**
 * The one price row each single-row node reserves on.
 *
 * These nodes have no provider choice and no length or tier lever: every run
 * is charged one row. That row is named here ONCE, and read by the lanes that
 * charge it — the route's credit guard and reservation, the workflow run
 * (payload-builder) — and by the price the node advertises (`node-registry.ts`
 * `CREDIT_BAND_SOURCES` → `GET /v1/nodes` and the generated `**Credit cost:**`
 * line of `backend/skills/nodes/<type>.md`).
 *
 * Why: the advertised price used to fall back to a node-type ALIAS row
 * (`"forced-alignment"`, `"audio-isolation"`, `"remove-background"` in
 * `STATIC_CREDIT_COSTS`) that nothing charges, so a reprice of the real row
 * left the docs quoting the alias — Remove Background's skill said 10 while a
 * run is charged 3. `__tests__/node-registry-credit-bands.test.ts` pins every
 * id here to what `buildPayload` reserves.
 *
 * Pure: no imports.
 */
export const FORCED_ALIGNMENT_CREDIT_ID = "elevenlabs-forced-alignment"
export const AUDIO_ISOLATION_CREDIT_ID = "elevenlabs-isolation"
export const REMOVE_BACKGROUND_CREDIT_ID = "recraft-remove-bg"

/** Node type → its one row. The band sources and the guard test read this. */
export const FIXED_ROW_CREDIT_IDS = {
  "forced-alignment": FORCED_ALIGNMENT_CREDIT_ID,
  "audio-isolation": AUDIO_ISOLATION_CREDIT_ID,
  "remove-background": REMOVE_BACKGROUND_CREDIT_ID,
} as const satisfies Record<string, string>
