// @test-watches docker-compose.community.yml tools/generate-selfhost-keys.mjs
/**
 * A self-hosted install in production refuses to start on the public default
 * Supabase keys shipped with docker-compose.community.yml (anyone can read
 * them; the service role key bypasses row level security), and on keys that
 * the configured JWT secret did not sign. Local development and the
 * quick-start demo (PUBLIC_URL on this machine) are untouched.
 *
 * The shipped defaults are read from the compose file and fresh keys come
 * from the real generator, so no key material lives in this file.
 */
import { describe, it, expect } from "vitest"
import { execFileSync } from "node:child_process"
import { createHmac } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  SELFHOST_DEFAULT_JWT_SECRET,
  SELFHOST_MINT_KEYS_COMMAND,
  SELFHOST_MINT_SECRET_ONLY_COMMAND,
  isLoopbackUrl,
  selfhostKeyFindings,
  selfhostKeysEnforced,
  selfhostKeysProblem,
  selfhostKeysWarning,
  usesBundledSupabase,
} from "../selfhost-keys-settings.js"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const compose = readFileSync(resolve(root, "docker-compose.community.yml"), "utf8")

/** Every `${NAME:-default}` default the compose file gives NAME (all must agree). */
function composeDefaults(name: string): string[] {
  return [...compose.matchAll(new RegExp(`\\$\\{${name}:-([^}]+)\\}`, "g"))].map((m) => m[1]!)
}

function shippedDefault(name: string): string {
  const all = composeDefaults(name)
  expect(all.length, `${name} has a default in the compose file`).toBeGreaterThan(0)
  expect(new Set(all).size, `every ${name} default in the compose file is the same`).toBe(1)
  return all[0]!
}

/** A matched set from the real generator (tools/generate-selfhost-keys.mjs). */
function mintedSet(): { secret: string; anon: string; service: string } {
  const out = execFileSync(process.execPath, [resolve(root, "tools", "generate-selfhost-keys.mjs")], { encoding: "utf8" })
  const value = (name: string) => out.match(new RegExp(`^${name}=(.+)$`, "m"))?.[1] ?? ""
  return { secret: value("SUPABASE_JWT_SECRET"), anon: value("SUPABASE_ANON_KEY"), service: value("SUPABASE_SERVICE_ROLE_KEY") }
}

const DEFAULTS = {
  secret: shippedDefault("SUPABASE_JWT_SECRET"),
  anon: shippedDefault("SUPABASE_ANON_KEY"),
  service: shippedDefault("SUPABASE_SERVICE_ROLE_KEY"),
}

const BUNDLED_URL = shippedDefault("SUPABASE_URL")
const PUBLIC_INSTALL = { NODE_ENV: "production", PUBLIC_URL: "https://studio.example.com", SUPABASE_URL: BUNDLED_URL }
const withDefaults = { ...PUBLIC_INSTALL, SUPABASE_JWT_SECRET: DEFAULTS.secret, SUPABASE_ANON_KEY: DEFAULTS.anon, SUPABASE_SERVICE_ROLE_KEY: DEFAULTS.service }

function withOwn(set = mintedSet()) {
  return { ...PUBLIC_INSTALL, SUPABASE_JWT_SECRET: set.secret, SUPABASE_ANON_KEY: set.anon, SUPABASE_SERVICE_ROLE_KEY: set.service }
}

describe("the shipped defaults", () => {
  it("the compose file's default secret is the one the rule knows", () => {
    expect(DEFAULTS.secret).toBe(SELFHOST_DEFAULT_JWT_SECRET)
  })

  it("the compose file's default keys are recognized as public defaults (they are signed with the shipped secret)", () => {
    const findings = selfhostKeyFindings({ ...PUBLIC_INSTALL, SUPABASE_ANON_KEY: DEFAULTS.anon, SUPABASE_SERVICE_ROLE_KEY: DEFAULTS.service })
    expect(findings).toEqual([
      { variable: "SUPABASE_SERVICE_ROLE_KEY", reason: "public-default" },
      { variable: "SUPABASE_ANON_KEY", reason: "public-default" },
    ])
  })

  it("any key signed with the shipped secret is a public default, not only the two shipped ones", () => {
    const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url")
    const input = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role: "service_role", iss: "supabase", iat: 1 })}`
    const forged = `${input}.${createHmac("sha256", SELFHOST_DEFAULT_JWT_SECRET).update(input).digest("base64url")}`
    expect(selfhostKeyFindings({ ...PUBLIC_INSTALL, SUPABASE_SERVICE_ROLE_KEY: forged })).toEqual([
      { variable: "SUPABASE_SERVICE_ROLE_KEY", reason: "public-default" },
    ])
  })
})

describe("production on the public defaults is refused", () => {
  it("names every offending variable and the command to mint new keys, never a value", () => {
    const problem = selfhostKeysProblem(withDefaults)
    expect(problem).not.toBeNull()
    for (const name of ["SUPABASE_JWT_SECRET", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY"]) expect(problem).toContain(name)
    expect(problem).toContain(SELFHOST_MINT_KEYS_COMMAND)
    expect(problem).toContain("row level security")
    for (const value of [DEFAULTS.secret, DEFAULTS.anon, DEFAULTS.service]) expect(problem).not.toContain(value)
    // Not even a recognizable piece of a key.
    for (const key of [DEFAULTS.anon, DEFAULTS.service]) expect(problem).not.toContain(key.split(".")[2]!)
  })

  it.each([
    ["SUPABASE_JWT_SECRET", { SUPABASE_JWT_SECRET: SELFHOST_DEFAULT_JWT_SECRET }],
    ["SUPABASE_SERVICE_ROLE_KEY", { SUPABASE_SERVICE_ROLE_KEY: DEFAULTS.service }],
    ["SUPABASE_ANON_KEY", { SUPABASE_ANON_KEY: DEFAULTS.anon }],
  ])("one default left (%s) is enough to refuse, and only that variable is named", (name, override) => {
    // An own set whose secret is kept when only a key is the default, so no
    // other variable is flagged.
    const own = withOwn()
    const env = name === "SUPABASE_JWT_SECRET"
      ? { ...PUBLIC_INSTALL, ...override } // keys unset: nothing else to judge
      : { ...own, ...override }
    const findings = selfhostKeyFindings(env).map((f) => f.variable)
    expect(findings).toEqual([name])
    expect(selfhostKeysProblem(env)).toContain(name)
  })

  it("an unset or blank PUBLIC_URL is production too: only an explicit address on this machine is exempt", () => {
    expect(selfhostKeysProblem({ ...withDefaults, PUBLIC_URL: undefined })).not.toBeNull()
    expect(selfhostKeysProblem({ ...withDefaults, PUBLIC_URL: "  " })).not.toBeNull()
    expect(selfhostKeysProblem({ ...withDefaults, PUBLIC_URL: "not a url" })).not.toBeNull()
  })

  it("a LAN address is a network: refused", () => {
    expect(selfhostKeysProblem({ ...withDefaults, PUBLIC_URL: "http://192.168.1.20:3000" })).not.toBeNull()
    expect(selfhostKeysProblem({ ...withDefaults, PUBLIC_URL: "http://nodaro.lan:3000" })).not.toBeNull()
  })
})

describe("own keys are accepted", () => {
  it("a set minted by the generator starts in production", () => {
    expect(selfhostKeysProblem(withOwn())).toBeNull()
    expect(selfhostKeyFindings(withOwn())).toEqual([])
  })

  it("keys from another run than the secret are refused on the bundled stack: the auth and database services would refuse every request", () => {
    const a = mintedSet()
    const b = mintedSet()
    const env = { ...PUBLIC_INSTALL, SUPABASE_JWT_SECRET: a.secret, SUPABASE_ANON_KEY: b.anon, SUPABASE_SERVICE_ROLE_KEY: b.service }
    expect(selfhostKeyFindings(env)).toEqual([
      { variable: "SUPABASE_SERVICE_ROLE_KEY", reason: "not-signed-by-secret" },
      { variable: "SUPABASE_ANON_KEY", reason: "not-signed-by-secret" },
    ])
    const problem = selfhostKeysProblem(env)
    expect(problem).toMatch(/SUPABASE_SERVICE_ROLE_KEY is not signed by SUPABASE_JWT_SECRET/)
    expect(problem).toContain(SELFHOST_MINT_KEYS_COMMAND)
    for (const value of [a.secret, b.anon, b.service]) expect(problem).not.toContain(value)
  })

  it("a key that is not a signed token at all is refused on the bundled stack", () => {
    const own = withOwn()
    expect(selfhostKeyFindings({ ...own, SUPABASE_ANON_KEY: "not-a-jwt" })).toEqual([
      { variable: "SUPABASE_ANON_KEY", reason: "not-signed-by-secret" },
    ])
  })

  it("an install that does not pass the secret to the app (an older compose file) is judged on its keys alone", () => {
    const own = mintedSet()
    expect(selfhostKeysProblem({ ...PUBLIC_INSTALL, SUPABASE_ANON_KEY: own.anon, SUPABASE_SERVICE_ROLE_KEY: own.service })).toBeNull()
    expect(selfhostKeysProblem({ ...PUBLIC_INSTALL, SUPABASE_ANON_KEY: own.anon, SUPABASE_SERVICE_ROLE_KEY: DEFAULTS.service })).toMatch(/SUPABASE_SERVICE_ROLE_KEY/)
  })
})

describe("a managed Supabase project", () => {
  const MANAGED = { NODE_ENV: "production", PUBLIC_URL: "https://studio.example.com", SUPABASE_URL: "https://abcdefgh.supabase.co" }

  it("its own keys start, JWT or not, and are never matched against the bundled secret", () => {
    const other = mintedSet()
    expect(selfhostKeysProblem({ ...MANAGED, SUPABASE_SERVICE_ROLE_KEY: "sb_secret_example", SUPABASE_ANON_KEY: "sb_publishable_example" })).toBeNull()
    expect(selfhostKeysProblem({ ...MANAGED, SUPABASE_JWT_SECRET: mintedSet().secret, SUPABASE_ANON_KEY: other.anon, SUPABASE_SERVICE_ROLE_KEY: other.service })).toBeNull()
  })

  it("the bundled auth still runs on the default secret: refused, with the command that mints only the secret", () => {
    const problem = selfhostKeysProblem({ ...MANAGED, SUPABASE_JWT_SECRET: SELFHOST_DEFAULT_JWT_SECRET, SUPABASE_SERVICE_ROLE_KEY: "sb_secret_example" })
    expect(problem).toContain("SUPABASE_JWT_SECRET")
    expect(problem).toContain(SELFHOST_MINT_SECRET_ONLY_COMMAND)
    // Appending a whole new set would overwrite the project's own keys.
    expect(problem).not.toContain(SELFHOST_MINT_KEYS_COMMAND)
  })

  it("the shipped default keys are refused there too, pointing at the project's own keys", () => {
    const problem = selfhostKeysProblem({ ...MANAGED, SUPABASE_SERVICE_ROLE_KEY: DEFAULTS.service })
    expect(problem).toContain("SUPABASE_SERVICE_ROLE_KEY")
    expect(problem).toMatch(/your Supabase project's own keys/)
  })
})

describe("development and the quick-start demo are unaffected", () => {
  it.each([["development"], ["test"], [undefined]])("NODE_ENV=%s with the defaults on a public address: no refusal, no warning", (nodeEnv) => {
    const env = { ...withDefaults, NODE_ENV: nodeEnv }
    expect(selfhostKeysEnforced(env)).toBe(false)
    expect(selfhostKeysProblem(env)).toBeNull()
    expect(selfhostKeysWarning(env)).toBeNull()
  })

  it.each([
    ["http://localhost:3000"],
    ["http://127.0.0.1:3000"],
    ["http://127.1.2.3:8080/"],
    ["http://[::1]:3000"],
    ["http://studio.localhost:3000"],
  ])("the quick-start in production on %s starts, with a loud warning", (publicUrl) => {
    const env = { ...withDefaults, PUBLIC_URL: publicUrl }
    expect(selfhostKeysProblem(env)).toBeNull()
    const warning = selfhostKeysWarning(env)
    expect(warning).toMatch(/public default Supabase keys/)
    expect(warning).toContain(SELFHOST_MINT_KEYS_COMMAND)
    for (const value of [DEFAULTS.secret, DEFAULTS.anon, DEFAULTS.service]) expect(warning).not.toContain(value)
  })

  it("no warning once the keys are the install's own", () => {
    expect(selfhostKeysWarning({ ...withOwn(), PUBLIC_URL: "http://localhost:3000" })).toBeNull()
  })
})

describe("the classifiers", () => {
  it("isLoopbackUrl: this machine only, never a LAN or a public host", () => {
    for (const url of ["http://localhost:3000", "https://localhost", "http://127.0.0.1", "http://127.255.0.9:1", "http://[::1]:3000", "http://a.localhost"]) {
      expect(isLoopbackUrl(url), url).toBe(true)
    }
    for (const url of [undefined, "", "localhost:3000", "http://10.0.0.5", "http://192.168.0.2:3000", "https://example.com", "http://localhost.example.com", "http://128.0.0.1"]) {
      expect(isLoopbackUrl(url), String(url)).toBe(false)
    }
  })

  it("usesBundledSupabase: the in-container proxy the compose file points at, not a managed project", () => {
    expect(usesBundledSupabase({ SUPABASE_URL: BUNDLED_URL })).toBe(true)
    expect(usesBundledSupabase({ SUPABASE_URL: "http://127.0.0.1:3000/supabase" })).toBe(true)
    expect(usesBundledSupabase({ SUPABASE_URL: "https://abcdefgh.supabase.co" })).toBe(false)
    expect(usesBundledSupabase({})).toBe(false)
  })
})
