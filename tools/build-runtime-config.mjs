// Standalone (no TS import): builds window.__NODARO_RUNTIME__ for /config.js at
// container boot. Mirrors backend/src/lib/surface-profile.ts's parse+gate
// semantics; the drift stays honest because both degrade to "no override".
import { readFileSync } from "node:fs"

const pick = (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined)

/**
 * d2 gate for the writer (RESOLVED — Branch B, business+). Keep in lock-step
 * with surfaceGateOpen() (backend). Community omits the surface block so the
 * frontend getter sees `undefined` and inherits the code default.
 */
function surfaceGateOpenForEdition(edition) {
  return edition === "business" || edition === "cloud"
}

function parseSurface(raw, edition) {
  const trimmed = raw && raw.trim()
  if (!trimmed || !surfaceGateOpenForEdition(edition)) return undefined
  try {
    const text = trimmed.startsWith("@") ? readFileSync(trimmed.slice(1), "utf8") : trimmed
    const obj = JSON.parse(text)
    return obj && typeof obj === "object" ? obj : undefined
  } catch (err) {
    // MUST be stderr, never stdout: the CLI entry's stdout is redirected verbatim
    // into /config.js (start.sh). A stray stdout line here lands as line 1 of the
    // file, breaks the `window.__NODARO_RUNTIME__=…;` assignment (JS syntax error),
    // and takes ALL runtime config down with it. stderr is not redirected.
    console.error("[start.sh] surface profile ignored (unreadable/invalid):", err.message)
    return undefined
  }
}

export function buildRuntimeConfig(env) {
  const cfg = {
    apiUrl: pick(env.RUNTIME_API_URL),
    supabaseUrl: pick(env.RUNTIME_SUPABASE_URL),
    supabaseAnonKey: pick(env.RUNTIME_SUPABASE_ANON_KEY),
    freecutUrl: pick(env.RUNTIME_FREECUT_URL),
    audiomassUrl: pick(env.RUNTIME_AUDIOMASS_URL),
    defaultLocale: pick(env.RUNTIME_DEFAULT_LOCALE),
    surface: parseSurface(env.RUNTIME_SURFACE_PROFILE, env.EDITION),
    moderation: env.RUNTIME_UPLOAD_MODERATION === "true" ? { uploadImage: true } : undefined,
  }
  for (const k of Object.keys(cfg)) if (cfg[k] === undefined) delete cfg[k]
  return cfg
}

// CLI entry: `node build-runtime-config.mjs` prints the /config.js line.
if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = buildRuntimeConfig(process.env)
  process.stdout.write("window.__NODARO_RUNTIME__=" + JSON.stringify(cfg) + ";\n")
  console.error("[start.sh] frontend runtime config:", Object.keys(cfg).join(",") || "(none — build-time values)")
}
