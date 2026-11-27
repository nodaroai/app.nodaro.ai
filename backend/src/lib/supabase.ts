import { createClient } from "@supabase/supabase-js"
import { config } from "./config.js"
import { getRuntimeEnv } from "./runtime-env.js"

/** The request header that names this server's environment to the database (`video_route_request_env()`). */
export const RUNTIME_ENV_HEADER = "x-nodaro-env"

/**
 * The header's value for an environment name, or null when the name cannot be
 * carried as it is: an HTTP header takes printable ASCII only, and a value
 * outside it would make EVERY database call fail. Such a name is not sent at
 * all (the database then names no environment for this server: nothing that
 * is scoped to an environment is enforced for it, which is alerted at boot and
 * refused when an admin tries to turn enforcement on).
 */
export function runtimeEnvHeaderValue(env: string): string | null {
  return /^[\x21-\x7E]{1,64}$/.test(env) ? env : null
}

const RUNTIME_ENV_VALUE = runtimeEnvHeaderValue(getRuntimeEnv())

/** Whether this server can name its environment to the database. */
export const RUNTIME_ENV_NAMEABLE = RUNTIME_ENV_VALUE !== null

if (!RUNTIME_ENV_NAMEABLE) {
  console.error(`[ALERT] this server's environment name cannot be sent to the database (it must be 1-64 printable ASCII characters with no space). Rules scoped to an environment (enforcing unpaid routed charges) cannot apply to it.`)
}
import { registerLlmMeteredSchemaClient } from "./llm-metered-schema-gate.js"

export const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  db: {
    schema: "public",
  },
  // Staging and production share one database. Every call names the environment
  // of the server making it, so a rule that belongs to one environment (an
  // unpaid routed charge it enforces) is applied to that environment's own
  // reservations and funding only. Read in SQL, from the service role alone.
  global: {
    headers: RUNTIME_ENV_VALUE === null ? {} : { [RUNTIME_ENV_HEADER]: RUNTIME_ENV_VALUE },
  },
})

// R33: the metered-LLM schema gate probes with this client (handed over, so the
// gate never imports this module — config.ts reads the gate, and this imports config).
registerLlmMeteredSchemaClient(supabase)
