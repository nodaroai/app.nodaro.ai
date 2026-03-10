#!/usr/bin/env npx tsx
/**
 * KIE.ai Pricing Verification Script
 *
 * Runs test configs against the KIE API and compares expected vs actual credit costs.
 * Uses balance-before / balance-after to measure actual cost per call.
 *
 * Usage:
 *   npx tsx backend/scripts/verify-kie-pricing.ts [options]
 *
 * Options:
 *   --category <cat>       Filter by category: image|video|text-to-video|audio|other|all (default: all)
 *   --model <key>          Run only tests matching this model key (substring match)
 *   --include-expensive    Include tests marked skipByDefault
 *   --manual               Manual balance mode (prompt before each test)
 *   --dry-run              List tests without running them
 *   --output <file>        JSON output file path (default: kie-pricing-report.json)
 *   --delay <ms>           Delay between tests in ms (default: 2000)
 *   --discover-only        Only run balance endpoint discovery, then exit
 */

import * as fs from "node:fs"
import * as path from "node:path"
import * as readline from "node:readline"

// Load .env from project root for local development
try {
  const envPath = path.resolve(import.meta.dirname ?? __dirname, "../../.env")
  const envContent = fs.readFileSync(envPath, "utf-8")
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let val = trimmed.slice(eqIdx + 1).trim()
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = val
  }
} catch {
  // .env file not found — rely on process.env
}

import {
  ALL_TEST_CONFIGS,
  IMAGE_TEST_CONFIGS,
  VIDEO_TEST_CONFIGS,
  AUDIO_TEST_CONFIGS,
  OTHER_TEST_CONFIGS,
  TEST_IMAGE_URL,
  TEST_AUDIO_URL,
  TEST_VIDEO_URL,
  type TestConfig,
} from "./kie-test-matrix.js"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KIE_API_BASE = "https://api.kie.ai"
const KIE_API_KEY = process.env.KIE_API_KEY ?? ""
const DEFAULT_DELAY_MS = 2000

// Polling constants (match client.ts)
const MAX_POLL_ATTEMPTS = 60
const MAX_POLL_ATTEMPTS_VIDEO = 120

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

interface CliOptions {
  category: string
  model: string | null
  includeExpensive: boolean
  manual: boolean
  dryRun: boolean
  output: string
  delayMs: number
  discoverOnly: boolean
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2)
  const opts: CliOptions = {
    category: "all",
    model: null,
    includeExpensive: false,
    manual: false,
    dryRun: false,
    output: "kie-pricing-report.json",
    delayMs: DEFAULT_DELAY_MS,
    discoverOnly: false,
  }
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--category":
        opts.category = args[++i] ?? "all"
        break
      case "--model":
        opts.model = args[++i] ?? null
        break
      case "--include-expensive":
        opts.includeExpensive = true
        break
      case "--manual":
        opts.manual = true
        break
      case "--dry-run":
        opts.dryRun = true
        break
      case "--output":
        opts.output = args[++i] ?? opts.output
        break
      case "--delay":
        opts.delayMs = parseInt(args[++i] ?? String(DEFAULT_DELAY_MS), 10)
        break
      case "--discover-only":
        opts.discoverOnly = true
        break
      case "--help":
      case "-h":
        printUsage()
        process.exit(0)
    }
  }
  return opts
}

function printUsage(): void {
  console.log(`
KIE.ai Pricing Verification Script

Usage: npx tsx backend/scripts/verify-kie-pricing.ts [options]

Options:
  --category <cat>       image | video | text-to-video | audio | other | all (default: all)
  --model <key>          Substring filter on modelKey
  --include-expensive    Include skipByDefault tests (VEO3, etc.)
  --manual               Manually enter balance before/after each test
  --dry-run              List tests without running
  --output <file>        JSON report path (default: kie-pricing-report.json)
  --delay <ms>           Delay between tests (default: 2000)
  --discover-only        Only discover balance endpoint
  -h, --help             Show this help
`)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function pollDelay(attempt: number): number {
  if (attempt <= 5) return 2000
  if (attempt <= 15) return Math.min(2000 + (attempt - 5) * 1000, 10000)
  return 10000
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${KIE_API_KEY}`,
  }
}

/** Replace {{IMAGE}}, {{AUDIO}}, {{VIDEO}} placeholders in input */
function resolveInputPlaceholders(input: Record<string, unknown>): Record<string, unknown> {
  const resolved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      resolved[key] = value
        .replace("{{IMAGE}}", TEST_IMAGE_URL)
        .replace("{{AUDIO}}", TEST_AUDIO_URL)
        .replace("{{VIDEO}}", TEST_VIDEO_URL)
    } else if (Array.isArray(value)) {
      resolved[key] = value.map((v) =>
        typeof v === "string"
          ? v.replace("{{IMAGE}}", TEST_IMAGE_URL).replace("{{AUDIO}}", TEST_AUDIO_URL).replace("{{VIDEO}}", TEST_VIDEO_URL)
          : v
      )
    } else {
      resolved[key] = value
    }
  }
  return resolved
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()))
  })
}

// ---------------------------------------------------------------------------
// Balance discovery
// ---------------------------------------------------------------------------

interface BalanceInfo {
  endpoint: string | null
  balanceField: string | null
}

const BALANCE_ENDPOINTS = [
  "/api/v1/account/balance",
  "/api/v1/user/balance",
  "/api/v1/credits/balance",
  "/api/v1/account/info",
  "/api/v1/user/info",
  "/api/v1/balance",
]

async function discoverBalanceEndpoint(): Promise<BalanceInfo> {
  console.log("\n--- Balance Endpoint Discovery ---\n")

  for (const endpoint of BALANCE_ENDPOINTS) {
    const url = `${KIE_API_BASE}${endpoint}`
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${KIE_API_KEY}` },
        signal: AbortSignal.timeout(10_000),
      })
      const text = await res.text()
      console.log(`  ${res.status} ${endpoint}`)
      if (text.length < 2000) {
        console.log(`       ${text.substring(0, 500)}`)
      } else {
        console.log(`       (${text.length} bytes, truncated) ${text.substring(0, 300)}...`)
      }

      if (res.ok) {
        // Try to parse and find a balance field
        try {
          const json = JSON.parse(text)
          const balanceField = findBalanceField(json)
          if (balanceField) {
            console.log(`\n  [OK] Found balance endpoint: ${endpoint}`)
            console.log(`       Balance field path: ${balanceField.path}`)
            console.log(`       Current balance: ${balanceField.value}\n`)
            return { endpoint, balanceField: balanceField.path }
          }
        } catch {
          // Not JSON
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`  ERR  ${endpoint} -> ${msg}`)
    }
  }

  console.log("\n  [WARN] No balance endpoint found. Use --manual mode.\n")
  return { endpoint: null, balanceField: null }
}

interface BalanceFieldResult {
  path: string
  value: number
}

/** Recursively search JSON for a field that looks like a balance/credits value */
function findBalanceField(obj: unknown, prefix = ""): BalanceFieldResult | null {
  if (obj === null || obj === undefined) return null
  if (typeof obj !== "object") return null

  const candidates = ["balance", "credits", "credit", "remaining", "available", "amount", "total"]
  const record = obj as Record<string, unknown>

  for (const [key, value] of Object.entries(record)) {
    const currentPath = prefix ? `${prefix}.${key}` : key
    const lowerKey = key.toLowerCase()

    if (typeof value === "number" && candidates.some((c) => lowerKey.includes(c))) {
      return { path: currentPath, value }
    }

    if (typeof value === "object" && value !== null) {
      const found = findBalanceField(value, currentPath)
      if (found) return found
    }
  }

  return null
}

/** Get current balance from discovered endpoint */
async function getBalance(balanceInfo: BalanceInfo): Promise<number | null> {
  if (!balanceInfo.endpoint || !balanceInfo.balanceField) return null

  try {
    const res = await fetch(`${KIE_API_BASE}${balanceInfo.endpoint}`, {
      headers: { Authorization: `Bearer ${KIE_API_KEY}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null

    const json = await res.json()
    const parts = balanceInfo.balanceField.split(".")
    let current: unknown = json
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== "object") return null
      current = (current as Record<string, unknown>)[part]
    }
    return typeof current === "number" ? current : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// API callers (raw fetch, no imports from provider system)
// ---------------------------------------------------------------------------

interface TaskResult {
  success: boolean
  taskId?: string
  error?: string
  resultUrl?: string
  costTime?: number
}

/** Standard: POST /api/v1/jobs/createTask + poll recordInfo */
async function runStandardTask(model: string, input: Record<string, unknown>): Promise<TaskResult> {
  const body = { model, input }
  const res = await fetch(`${KIE_API_BASE}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })

  const text = await res.text()
  if (!res.ok) return { success: false, error: `HTTP ${res.status}: ${text.substring(0, 300)}` }

  let data: { code?: number; message?: string; data?: { taskId?: string } }
  try {
    data = JSON.parse(text)
  } catch {
    return { success: false, error: `Invalid JSON: ${text.substring(0, 200)}` }
  }

  if (data.code !== 0 && data.code !== 200) {
    return { success: false, error: `API code ${data.code}: ${data.message ?? text.substring(0, 200)}` }
  }

  const taskId = data.data?.taskId
  if (!taskId) return { success: false, error: `No taskId in response` }

  return pollRecordInfo(taskId)
}

/** Poll GET /api/v1/jobs/recordInfo */
async function pollRecordInfo(taskId: string): Promise<TaskResult> {
  let attempts = 0
  while (attempts < MAX_POLL_ATTEMPTS_VIDEO) {
    attempts++
    await sleep(pollDelay(attempts))

    let res: Response
    try {
      res = await fetch(`${KIE_API_BASE}/api/v1/jobs/recordInfo?taskId=${taskId}`, {
        headers: { Authorization: `Bearer ${KIE_API_KEY}` },
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      continue
    }

    if (!res.ok) continue

    let data: { data?: { state?: string; resultJson?: string; failMsg?: string; costTime?: number } }
    try {
      data = JSON.parse(await res.text())
    } catch {
      continue
    }

    const state = data.data?.state
    if (state === "success") {
      let resultUrl: string | undefined
      try {
        const rj = JSON.parse(data.data?.resultJson ?? "{}")
        resultUrl = rj.resultUrls?.[0] ?? rj.audioUrl ?? rj.videoUrl
      } catch { /* ok */ }
      return { success: true, taskId, resultUrl, costTime: data.data?.costTime }
    }
    if (state === "fail") {
      return { success: false, taskId, error: `Task failed: ${data.data?.failMsg ?? "unknown"}` }
    }
    // waiting, queuing, generating — keep polling
    if (attempts % 10 === 0) {
      process.stdout.write(` [poll ${attempts}, state=${state}]`)
    }
  }
  return { success: false, taskId, error: `Timed out after ${MAX_POLL_ATTEMPTS_VIDEO} polls` }
}

/** VEO: POST /api/v1/veo/generate + poll /api/v1/veo/record-info */
async function runVeoTask(input: Record<string, unknown>): Promise<TaskResult> {
  const body = { ...input }
  const res = await fetch(`${KIE_API_BASE}/api/v1/veo/generate`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })

  const text = await res.text()
  if (!res.ok) return { success: false, error: `HTTP ${res.status}: ${text.substring(0, 300)}` }

  let data: { code?: number; message?: string; msg?: string; data?: { taskId?: string } }
  try {
    data = JSON.parse(text)
  } catch {
    return { success: false, error: `Invalid JSON: ${text.substring(0, 200)}` }
  }

  if (data.code !== 0 && data.code !== 200) {
    return { success: false, error: `API code ${data.code}: ${data.message ?? data.msg ?? text.substring(0, 200)}` }
  }

  const taskId = data.data?.taskId
  if (!taskId) return { success: false, error: `No taskId in response` }

  // Poll VEO record-info
  let attempts = 0
  while (attempts < MAX_POLL_ATTEMPTS_VIDEO) {
    attempts++
    await sleep(pollDelay(attempts))

    let detailRes: Response
    try {
      detailRes = await fetch(`${KIE_API_BASE}/api/v1/veo/record-info?taskId=${taskId}`, {
        headers: { Authorization: `Bearer ${KIE_API_KEY}` },
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      continue
    }
    if (!detailRes.ok) continue

    let detail: { data?: { successFlag?: number; response?: { resultUrls?: string[] }; errorMessage?: string } }
    try {
      detail = JSON.parse(await detailRes.text())
    } catch {
      continue
    }

    const flag = detail.data?.successFlag
    if (flag === 1) {
      return { success: true, taskId, resultUrl: detail.data?.response?.resultUrls?.[0] }
    }
    if (flag === 2 || flag === 3) {
      return { success: false, taskId, error: `VEO failed: ${detail.data?.errorMessage ?? `flag=${flag}`}` }
    }
    if (attempts % 10 === 0) {
      process.stdout.write(` [veo-poll ${attempts}, flag=${flag}]`)
    }
  }
  return { success: false, taskId, error: `VEO timed out after ${MAX_POLL_ATTEMPTS_VIDEO} polls` }
}

/** Kling 3.0: same as standard (uses createTask + recordInfo) */
async function runKling3Task(input: Record<string, unknown>): Promise<TaskResult> {
  return runStandardTask("kling-3.0/video", input)
}

/** Suno: POST /api/v1/generate + poll /api/v1/generate/record-info */
async function runSunoTask(input: Record<string, unknown>): Promise<TaskResult> {
  const body = { ...input }
  const res = await fetch(`${KIE_API_BASE}/api/v1/generate`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })

  const text = await res.text()
  if (!res.ok) return { success: false, error: `HTTP ${res.status}: ${text.substring(0, 300)}` }

  let data: { code?: number; msg?: string; message?: string; data?: { taskId?: string } }
  try {
    data = JSON.parse(text)
  } catch {
    return { success: false, error: `Invalid JSON: ${text.substring(0, 200)}` }
  }

  if (data.code !== 0 && data.code !== 200) {
    return { success: false, error: `API code ${data.code}: ${data.msg ?? data.message ?? text.substring(0, 200)}` }
  }

  const taskId = data.data?.taskId
  if (!taskId) return { success: false, error: `No taskId in response` }

  // Poll Suno record-info
  let attempts = 0
  while (attempts < MAX_POLL_ATTEMPTS) {
    attempts++
    await sleep(pollDelay(attempts))

    let detailRes: Response
    try {
      detailRes = await fetch(`${KIE_API_BASE}/api/v1/generate/record-info?taskId=${taskId}`, {
        headers: { Authorization: `Bearer ${KIE_API_KEY}` },
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      continue
    }
    if (!detailRes.ok) continue

    let detail: { data?: { status?: string; failReason?: string; response?: { sunoData?: unknown[] } } }
    try {
      detail = JSON.parse(await detailRes.text())
    } catch {
      continue
    }

    const status = detail.data?.status
    if (status === "SUCCESS" || status === "FIRST_SUCCESS") {
      return { success: true, taskId }
    }
    if (status === "FAILED") {
      return { success: false, taskId, error: `Suno failed: ${detail.data?.failReason ?? "unknown"}` }
    }
    if (attempts % 10 === 0) {
      process.stdout.write(` [suno-poll ${attempts}, status=${status}]`)
    }
  }
  return { success: false, taskId, error: `Suno timed out after ${MAX_POLL_ATTEMPTS} polls` }
}

/** Flux Kontext: POST /api/v1/flux/kontext/generate + poll /api/v1/flux/kontext/record-info */
async function runKontextTask(model: string, input: Record<string, unknown>): Promise<TaskResult> {
  const body = { model, ...input }
  const res = await fetch(`${KIE_API_BASE}/api/v1/flux/kontext/generate`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })

  const text = await res.text()
  if (!res.ok) return { success: false, error: `HTTP ${res.status}: ${text.substring(0, 300)}` }

  let data: { code?: number; msg?: string; message?: string; data?: { taskId?: string } }
  try {
    data = JSON.parse(text)
  } catch {
    return { success: false, error: `Invalid JSON: ${text.substring(0, 200)}` }
  }

  if (data.code !== 0 && data.code !== 200) {
    return { success: false, error: `API code ${data.code}: ${data.msg ?? data.message ?? text.substring(0, 200)}` }
  }

  const taskId = data.data?.taskId
  if (!taskId) return { success: false, error: `No taskId in response` }

  // Poll Kontext record-info
  let attempts = 0
  while (attempts < MAX_POLL_ATTEMPTS) {
    attempts++
    await sleep(pollDelay(attempts))

    let detailRes: Response
    try {
      detailRes = await fetch(`${KIE_API_BASE}/api/v1/flux/kontext/record-info?taskId=${taskId}`, {
        headers: { Authorization: `Bearer ${KIE_API_KEY}` },
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      continue
    }
    if (!detailRes.ok) continue

    let detail: { data?: { state?: string; resultJson?: string; failMsg?: string } }
    try {
      detail = JSON.parse(await detailRes.text())
    } catch {
      continue
    }

    const state = detail.data?.state
    if (state === "success") {
      let resultUrl: string | undefined
      try {
        const rj = JSON.parse(detail.data?.resultJson ?? "{}")
        resultUrl = rj.resultUrls?.[0] ?? rj.imageUrl
      } catch { /* ok */ }
      return { success: true, taskId, resultUrl }
    }
    if (state === "fail") {
      return { success: false, taskId, error: `Kontext failed: ${detail.data?.failMsg ?? "unknown"}` }
    }
    if (attempts % 10 === 0) {
      process.stdout.write(` [kontext-poll ${attempts}, state=${state}]`)
    }
  }
  return { success: false, taskId, error: `Kontext timed out after ${MAX_POLL_ATTEMPTS} polls` }
}

/** Runway: POST /api/v1/runway/generate + poll /api/v1/runway/record-detail */
async function runRunwayTask(input: Record<string, unknown>): Promise<TaskResult> {
  const body = { ...input }
  const res = await fetch(`${KIE_API_BASE}/api/v1/runway/generate`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })

  const text = await res.text()
  if (!res.ok) return { success: false, error: `HTTP ${res.status}: ${text.substring(0, 300)}` }

  let data: { code?: number; msg?: string; message?: string; data?: { taskId?: string } }
  try {
    data = JSON.parse(text)
  } catch {
    return { success: false, error: `Invalid JSON: ${text.substring(0, 200)}` }
  }

  if (data.code !== 0 && data.code !== 200) {
    return { success: false, error: `API code ${data.code}: ${data.msg ?? data.message ?? text.substring(0, 200)}` }
  }

  const taskId = data.data?.taskId
  if (!taskId) return { success: false, error: `No taskId in response` }

  // Poll Runway record-detail
  let attempts = 0
  while (attempts < MAX_POLL_ATTEMPTS_VIDEO) {
    attempts++
    await sleep(pollDelay(attempts))

    let detailRes: Response
    try {
      detailRes = await fetch(`${KIE_API_BASE}/api/v1/runway/record-detail?taskId=${taskId}`, {
        headers: { Authorization: `Bearer ${KIE_API_KEY}` },
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      continue
    }
    if (!detailRes.ok) continue

    let detail: { data?: { state?: string; resultJson?: string; failMsg?: string; resultUrl?: string; videoUrl?: string } }
    try {
      detail = JSON.parse(await detailRes.text())
    } catch {
      continue
    }

    const state = detail.data?.state
    if (state === "success") {
      const resultUrl = detail.data?.resultUrl ?? detail.data?.videoUrl
      return { success: true, taskId, resultUrl }
    }
    if (state === "fail") {
      return { success: false, taskId, error: `Runway failed: ${detail.data?.failMsg ?? "unknown"}` }
    }
    if (attempts % 10 === 0) {
      process.stdout.write(` [runway-poll ${attempts}, state=${state}]`)
    }
  }
  return { success: false, taskId, error: `Runway timed out after ${MAX_POLL_ATTEMPTS_VIDEO} polls` }
}

/** Luma Modify: POST /api/v1/modify/generate + poll /api/v1/modify/record-info */
async function runLumaTask(input: Record<string, unknown>): Promise<TaskResult> {
  const body = { ...input }
  const res = await fetch(`${KIE_API_BASE}/api/v1/modify/generate`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })

  const text = await res.text()
  if (!res.ok) return { success: false, error: `HTTP ${res.status}: ${text.substring(0, 300)}` }

  let data: { code?: number; msg?: string; message?: string; data?: { taskId?: string } }
  try {
    data = JSON.parse(text)
  } catch {
    return { success: false, error: `Invalid JSON: ${text.substring(0, 200)}` }
  }

  if (data.code !== 0 && data.code !== 200) {
    return { success: false, error: `API code ${data.code}: ${data.msg ?? data.message ?? text.substring(0, 200)}` }
  }

  const taskId = data.data?.taskId
  if (!taskId) return { success: false, error: `No taskId in response` }

  // Poll Luma record-info
  let attempts = 0
  while (attempts < MAX_POLL_ATTEMPTS_VIDEO) {
    attempts++
    await sleep(pollDelay(attempts))

    let detailRes: Response
    try {
      detailRes = await fetch(`${KIE_API_BASE}/api/v1/modify/record-info?taskId=${taskId}`, {
        headers: { Authorization: `Bearer ${KIE_API_KEY}` },
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      continue
    }
    if (!detailRes.ok) continue

    let detail: { data?: { state?: string; resultJson?: string; failMsg?: string; successFlag?: number; response?: { resultUrls?: string[] }; errorMessage?: string } }
    try {
      detail = JSON.parse(await detailRes.text())
    } catch {
      continue
    }

    // Luma may use state or successFlag
    const state = detail.data?.state
    const flag = detail.data?.successFlag

    if (state === "success" || flag === 1) {
      let resultUrl: string | undefined
      try {
        if (detail.data?.resultJson) {
          const rj = JSON.parse(detail.data.resultJson)
          resultUrl = rj.resultUrls?.[0] ?? rj.videoUrl
        } else {
          resultUrl = detail.data?.response?.resultUrls?.[0]
        }
      } catch { /* ok */ }
      return { success: true, taskId, resultUrl }
    }
    if (state === "fail" || flag === 2 || flag === 3) {
      return { success: false, taskId, error: `Luma failed: ${detail.data?.failMsg ?? detail.data?.errorMessage ?? "unknown"}` }
    }
    if (attempts % 10 === 0) {
      process.stdout.write(` [luma-poll ${attempts}, state=${state}, flag=${flag}]`)
    }
  }
  return { success: false, taskId, error: `Luma timed out after ${MAX_POLL_ATTEMPTS_VIDEO} polls` }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function runTest(config: TestConfig): Promise<TaskResult> {
  const input = resolveInputPlaceholders(config.input)

  switch (config.apiType) {
    case "standard":
      return runStandardTask(config.kieModel, input)
    case "veo":
      return runVeoTask({ model: config.kieModel, ...input })
    case "kling3":
      return runKling3Task(input)
    case "suno":
      return runSunoTask(input)
    case "kontext":
      return runKontextTask(config.kieModel, input)
    case "runway":
      return runRunwayTask(input)
    case "luma":
      return runLumaTask(input)
    default:
      return { success: false, error: `Unknown apiType: ${config.apiType}` }
  }
}

// ---------------------------------------------------------------------------
// Test filtering
// ---------------------------------------------------------------------------

function filterConfigs(opts: CliOptions): TestConfig[] {
  let configs: TestConfig[]

  switch (opts.category) {
    case "image":
      configs = IMAGE_TEST_CONFIGS
      break
    case "video":
      configs = VIDEO_TEST_CONFIGS.filter((c) => c.category === "video")
      break
    case "text-to-video":
      configs = VIDEO_TEST_CONFIGS.filter((c) => c.category === "text-to-video")
      break
    case "audio":
      configs = AUDIO_TEST_CONFIGS
      break
    case "other":
      configs = OTHER_TEST_CONFIGS
      break
    case "all":
    default:
      configs = ALL_TEST_CONFIGS
      break
  }

  if (opts.model) {
    const pattern = opts.model.toLowerCase()
    configs = configs.filter((c) => c.modelKey.toLowerCase().includes(pattern))
  }

  if (!opts.includeExpensive) {
    configs = configs.filter((c) => !c.skipByDefault)
  }

  return configs
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

interface TestResult {
  modelKey: string
  category: string
  kieModel: string
  configDesc: string
  expectedKieCredits: number
  expectedCostUsd: number
  actualKieCredits: number | null
  actualCostUsd: number | null
  creditsDiff: number | null
  costDiffUsd: number | null
  match: boolean | null
  taskSuccess: boolean
  taskId: string | null
  error: string | null
  balanceBefore: number | null
  balanceAfter: number | null
  durationSec: number
}

function printTable(results: TestResult[]): void {
  console.log("\n" + "=".repeat(140))
  console.log(
    padRight("Model Key", 28) +
    padRight("Category", 16) +
    padRight("Config", 30) +
    padRight("Expected Cr", 12) +
    padRight("Actual Cr", 12) +
    padRight("Diff", 8) +
    padRight("Match", 8) +
    padRight("Status", 10) +
    padRight("Time", 8)
  )
  console.log("-".repeat(140))

  for (const r of results) {
    const match = r.match === null ? "N/A" : r.match ? "YES" : "*** NO ***"
    const actualCr = r.actualKieCredits !== null ? String(r.actualKieCredits) : "-"
    const diff = r.creditsDiff !== null ? (r.creditsDiff >= 0 ? `+${r.creditsDiff}` : String(r.creditsDiff)) : "-"
    const status = r.taskSuccess ? "OK" : "FAIL"
    const time = `${r.durationSec}s`

    console.log(
      padRight(r.modelKey, 28) +
      padRight(r.category, 16) +
      padRight(r.configDesc.substring(0, 28), 30) +
      padRight(String(r.expectedKieCredits), 12) +
      padRight(actualCr, 12) +
      padRight(diff, 8) +
      padRight(match, 8) +
      padRight(status, 10) +
      padRight(time, 8)
    )
    if (r.error) {
      console.log(`  ERROR: ${r.error.substring(0, 120)}`)
    }
  }

  console.log("=".repeat(140))

  // Summary
  const total = results.length
  const succeeded = results.filter((r) => r.taskSuccess).length
  const matched = results.filter((r) => r.match === true).length
  const mismatched = results.filter((r) => r.match === false).length
  const noBalance = results.filter((r) => r.match === null && r.taskSuccess).length

  console.log(`\nSummary: ${total} tests, ${succeeded} succeeded, ${matched} matched, ${mismatched} MISMATCHED, ${noBalance} no balance data`)

  if (mismatched > 0) {
    console.log("\nMISMATCHED MODELS (expected != actual KIE credits):")
    for (const r of results.filter((r) => r.match === false)) {
      console.log(`  ${r.modelKey}: expected ${r.expectedKieCredits}, actual ${r.actualKieCredits} (diff: ${r.creditsDiff})`)
    }
  }
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str.substring(0, len) : str + " ".repeat(len - str.length)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs()

  console.log("KIE.ai Pricing Verification Script")
  console.log("===================================\n")

  if (!KIE_API_KEY) {
    console.error("ERROR: KIE_API_KEY not set. Set it in .env or environment.")
    process.exit(1)
  }
  console.log(`API Key: ${KIE_API_KEY.substring(0, 8)}...${KIE_API_KEY.substring(KIE_API_KEY.length - 4)}`)

  // Discover balance endpoint
  const balanceInfo = await discoverBalanceEndpoint()
  const hasAutoBalance = balanceInfo.endpoint !== null
  const useManual = opts.manual || !hasAutoBalance

  if (opts.discoverOnly) {
    rl.close()
    process.exit(0)
  }

  if (useManual && !opts.dryRun) {
    console.log("Running in MANUAL mode: you will be prompted for balance before/after each test.")
    if (!hasAutoBalance) {
      console.log("(No automatic balance endpoint found)")
    }
  }

  // Filter test configs
  const configs = filterConfigs(opts)
  if (configs.length === 0) {
    console.log("No tests match the given filters.")
    rl.close()
    process.exit(0)
  }

  // Estimate total cost
  const totalEstimatedCredits = configs.reduce((sum, c) => sum + c.expectedKieCredits, 0)
  const totalEstimatedCost = configs.reduce((sum, c) => sum + c.expectedCostUsd, 0)
  const totalEstimatedTime = configs.reduce((sum, c) => sum + c.estimatedTimeSec, 0)

  console.log(`\nTests to run: ${configs.length}`)
  console.log(`Estimated KIE credits: ${totalEstimatedCredits}`)
  console.log(`Estimated USD cost: $${totalEstimatedCost.toFixed(2)}`)
  console.log(`Estimated time: ~${Math.ceil(totalEstimatedTime / 60)} minutes\n`)

  // Dry run — just list
  if (opts.dryRun) {
    console.log(padRight("Model Key", 28) + padRight("Category", 16) + padRight("Config", 40) + padRight("KIE Cr", 8) + padRight("Cost", 8) + padRight("API", 10) + "Skip?")
    console.log("-".repeat(120))
    for (const c of configs) {
      console.log(
        padRight(c.modelKey, 28) +
        padRight(c.category, 16) +
        padRight(c.configDesc.substring(0, 38), 40) +
        padRight(String(c.expectedKieCredits), 8) +
        padRight(`$${c.expectedCostUsd.toFixed(3)}`, 8) +
        padRight(c.apiType, 10) +
        (c.skipByDefault ? "skip" : "")
      )
    }
    rl.close()
    process.exit(0)
  }

  // Confirmation
  const confirm = await prompt("Proceed? (y/N): ")
  if (confirm.toLowerCase() !== "y") {
    console.log("Aborted.")
    rl.close()
    process.exit(0)
  }

  // Run tests
  const results: TestResult[] = []
  let aborted = false

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n\nInterrupted! Writing partial results...\n")
    aborted = true
  })

  for (let i = 0; i < configs.length; i++) {
    if (aborted) break

    const config = configs[i]
    const testNum = `[${i + 1}/${configs.length}]`
    process.stdout.write(`\n${testNum} ${config.modelKey} — ${config.configDesc}`)

    // Get balance before
    let balanceBefore: number | null = null
    if (useManual) {
      const beforeStr = await prompt(`\n  Enter KIE balance BEFORE (or 'skip' to skip this test): `)
      if (beforeStr.toLowerCase() === "skip") {
        console.log("  Skipped.")
        continue
      }
      balanceBefore = parseFloat(beforeStr)
      if (isNaN(balanceBefore)) balanceBefore = null
    } else {
      balanceBefore = await getBalance(balanceInfo)
      if (balanceBefore !== null) {
        process.stdout.write(` [balance: ${balanceBefore}]`)
      }
    }

    // Run the test
    const startTime = Date.now()
    let taskResult: TaskResult
    try {
      taskResult = await runTest(config)
    } catch (err) {
      taskResult = {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
    const durationSec = Math.round((Date.now() - startTime) / 1000)

    // Get balance after
    let balanceAfter: number | null = null
    if (taskResult.success) {
      if (useManual) {
        const afterStr = await prompt(`\n  Task succeeded. Enter KIE balance AFTER: `)
        balanceAfter = parseFloat(afterStr)
        if (isNaN(balanceAfter)) balanceAfter = null
      } else {
        // Small delay for balance to settle
        await sleep(1000)
        balanceAfter = await getBalance(balanceInfo)
        if (balanceAfter !== null) {
          process.stdout.write(` [balance after: ${balanceAfter}]`)
        }
      }
    }

    // Compute actual cost
    let actualKieCredits: number | null = null
    let actualCostUsd: number | null = null
    let creditsDiff: number | null = null
    let costDiffUsd: number | null = null
    let match: boolean | null = null

    if (balanceBefore !== null && balanceAfter !== null && taskResult.success) {
      actualKieCredits = Math.round((balanceBefore - balanceAfter) * 100) / 100
      actualCostUsd = Math.round(actualKieCredits * 0.005 * 10000) / 10000
      creditsDiff = Math.round((actualKieCredits - config.expectedKieCredits) * 100) / 100
      costDiffUsd = Math.round((actualCostUsd - config.expectedCostUsd) * 10000) / 10000
      // Allow 0.5 credit tolerance for rounding
      match = Math.abs(creditsDiff) <= 0.5
    }

    const status = taskResult.success ? " OK" : " FAIL"
    process.stdout.write(status)
    if (match === false) {
      process.stdout.write(` *** MISMATCH: expected ${config.expectedKieCredits}, actual ${actualKieCredits} ***`)
    } else if (match === true) {
      process.stdout.write(` (credits verified: ${actualKieCredits})`)
    }
    console.log(` [${durationSec}s]`)

    results.push({
      modelKey: config.modelKey,
      category: config.category,
      kieModel: config.kieModel,
      configDesc: config.configDesc,
      expectedKieCredits: config.expectedKieCredits,
      expectedCostUsd: config.expectedCostUsd,
      actualKieCredits,
      actualCostUsd,
      creditsDiff,
      costDiffUsd,
      match,
      taskSuccess: taskResult.success,
      taskId: taskResult.taskId ?? null,
      error: taskResult.error ?? null,
      balanceBefore,
      balanceAfter,
      durationSec,
    })

    // Delay between tests
    if (i < configs.length - 1 && !aborted) {
      await sleep(opts.delayMs)
    }
  }

  // Print results
  printTable(results)

  // Write JSON report
  const reportPath = path.resolve(opts.output)
  const report = {
    timestamp: new Date().toISOString(),
    options: opts,
    balanceEndpoint: balanceInfo.endpoint,
    totalTests: results.length,
    succeeded: results.filter((r) => r.taskSuccess).length,
    matched: results.filter((r) => r.match === true).length,
    mismatched: results.filter((r) => r.match === false).length,
    results,
  }
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(`\nJSON report written to: ${reportPath}`)

  rl.close()

  // Exit with error code if mismatches found
  const mismatches = results.filter((r) => r.match === false)
  if (mismatches.length > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error("\nFatal error:", err)
  rl.close()
  process.exit(1)
})
