#!/usr/bin/env node
/**
 * Mint a matched Supabase self-host key set: JWT_SECRET + ANON_KEY +
 * SERVICE_ROLE_KEY. The two keys are HS256 JWTs SIGNED WITH THE SECRET —
 * all three must come from the same run or GoTrue/PostgREST will reject
 * every request (the classic self-host failure mode).
 *
 * Usage:
 *   node tools/generate-selfhost-keys.mjs            # print .env lines
 *   node tools/generate-selfhost-keys.mjs >> .env    # append to .env
 *
 * The community compose ships WORKING DEFAULT keys for local play (see
 * docker-compose.community.yml). Run this script and set the printed values
 * in .env before exposing an install to a network — the defaults are public
 * knowledge by definition. A production install (PUBLIC_URL not an address
 * on this machine) refuses to start on them, and names this command
 * (backend/src/lib/selfhost-keys-settings.ts).
 */
import { createHmac, randomBytes } from "node:crypto"

function b64url(input) {
  return Buffer.from(input).toString("base64url")
}

function signHS256(payload, secret) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const body = b64url(JSON.stringify(payload))
  const sig = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url")
  return `${header}.${body}.${sig}`
}

const secret = randomBytes(32).toString("hex")
const iat = Math.floor(Date.now() / 1000)
// 10 years — same convention as Supabase's own self-host key generator.
const exp = iat + 10 * 365 * 24 * 60 * 60

const anon = signHS256({ role: "anon", iss: "supabase", iat, exp }, secret)
const service = signHS256({ role: "service_role", iss: "supabase", iat, exp }, secret)

console.log(`SUPABASE_JWT_SECRET=${secret}`)
console.log(`SUPABASE_ANON_KEY=${anon}`)
console.log(`SUPABASE_SERVICE_ROLE_KEY=${service}`)
