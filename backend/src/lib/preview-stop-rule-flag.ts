/**
 * Is the preview stop rule on for this deployment? (`PREVIEW_STOP_RULE_ENABLED`,
 * decided 2026-10-05: on in staging, off in production until Render final.)
 *
 * Read at CALL time, never cached at module load. Off means every surface
 * behaves exactly as it did before the rule existed: nothing gated, refused,
 * warned about or left out of an estimate. Kept alone in its own module so
 * tests can switch it without mocking the whole config.
 */
import { config } from "./config.js"

export function previewStopRuleEnabled(): boolean {
  return config.PREVIEW_STOP_RULE_ENABLED === true
}
