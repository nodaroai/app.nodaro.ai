import { config } from "../../lib/config.js"

/**
 * Whether the fal.ai provider is configured. Gates every fal code path the
 * same way `REPLICATE_API_TOKEN`/`KIE_API_KEY` gate theirs — when `FAL_KEY`
 * is empty (the self-host default) the provider stays inert.
 */
export const falEnabled = (): boolean => !!config.FAL_KEY
