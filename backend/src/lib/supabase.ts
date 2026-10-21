import { createClient } from "@supabase/supabase-js"
import { config } from "./config.js"
import { registerLlmMeteredSchemaClient } from "./llm-metered-schema-gate.js"

export const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  db: {
    schema: "public",
  },
})

// R33: the metered-LLM schema gate probes with this client (handed over, so the
// gate never imports this module — config.ts reads the gate, and this imports config).
registerLlmMeteredSchemaClient(supabase)
