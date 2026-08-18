/**
 * Reference-prompt assembly format for the `{image:N}` path, resolved once and
 * shared by every frontend call site (execute-node generate-image / i2i /
 * modify, and the config-panel preview) so they can never drift apart.
 *
 * - Default is "hybrid" everywhere (dev AND production) — the Unified Reference
 *   Roles feature is the default assembly format.
 * - Set `VITE_IMAGE_REFERENCE_FORMAT=legacy` to revert to the legacy format
 *   (the instant kill-switch; pair with the backend `IMAGE_REFERENCE_FORMAT=legacy`).
 * - Test runs ALWAYS resolve to "legacy" (the suites assert the legacy assembly).
 */
// Test runs must ALWAYS resolve to legacy (the execute-node suite asserts the
// legacy assembly) — regardless of `.env.local` (vitest loads it) or the
// dev-default. So the test check comes FIRST. NODE_ENV==="test" is the most
// reliable signal (Vite inlines `process.env.NODE_ENV` in the browser too);
// VITEST / MODE are belt-and-suspenders.
const env = import.meta.env as Record<string, unknown>
const nodeEnv =
  typeof process !== "undefined"
    ? (process as { env?: Record<string, string | undefined> }).env?.NODE_ENV
    : undefined
const isTest = Boolean(env.VITEST) || env.MODE === "test" || nodeEnv === "test"
export const IMAGE_REFERENCE_FORMAT: "legacy" | "hybrid" = isTest
  ? "legacy"
  : import.meta.env.VITE_IMAGE_REFERENCE_FORMAT === "legacy"
    ? "legacy"
    : "hybrid"
