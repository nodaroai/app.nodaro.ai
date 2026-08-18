import { useCallback, useEffect, useRef, useState } from "react"
import { getAuthHeaders } from "@/lib/api"
import { CONNECT_START_NETWORK_MESSAGE, interpretConnectStart } from "@/lib/cloud-connect-start"
import {
  PROVIDER_META,
  cloudCoverageSummary,
  groupProviderTiles,
  providerTiles,
  type ProviderMeta,
  type ProviderSource,
} from "@/lib/provider-tiles"
import { ProviderKeyTile } from "./provider-key-tile"
import { Link } from "react-router-dom"

/**
 * /setup — self-host install health screen.
 *
 * Public (works before login: a broken Supabase config breaks login itself)
 * and registered only on non-cloud builds. Polls GET /v1/setup/status every
 * 5s and renders the design-handoff layout: summary bar, per-service cards
 * with latency sparklines, and one provider-key table with a remediation
 * callout.
 *
 * Colors are literal, not theme tokens, ON PURPOSE — this is a standalone
 * diagnostics page with a single committed look, reached with no app chrome
 * and often before any theme preference exists. Theme tokens would make it
 * render two different ways for no benefit.
 */

interface CheckResult {
  readonly ok: boolean
  readonly status: string
  readonly latencyMs: number | null
  readonly hint?: string
}

interface ProvidersCheck {
  readonly ok: boolean
  /** Live Nodaro Cloud connection — a first-class provider, not an env var. */
  readonly nodaroCloud?: boolean
  /** How nodaro.ai is authenticated: the OAuth connection, NODARO_API_KEY
   *  from .env, or an API key pasted in the app ("app" — editable tile). */
  readonly nodaroSource?: "oauth" | "env" | "app" | null
  /** One entry per provider, nodaro.ai included — the grid renders this. */
  readonly keys: Record<string, boolean>
  /** Where each set key comes from: env | app (pasted here) | oauth | null. */
  readonly sources?: Record<string, ProviderSource>
  /** Labels, env var, what it powers, and whether nodaro.ai covers it. */
  readonly meta?: Record<string, ProviderMeta>
  readonly hint?: string
}

/** The instance encryption key — presence and provenance, never the key. */
interface EncryptionCheck {
  readonly ok: boolean
  readonly status: "ok" | "missing"
  readonly source?: "env" | "generated"
  readonly envVar?: string
  readonly hint?: string
}

interface SetupStatus {
  readonly edition: string
  readonly timestamp: string
  readonly hasUsers?: boolean
  readonly checks: {
    readonly database: CheckResult
    readonly redis: CheckResult
    readonly storage: CheckResult
    readonly providers: ProvidersCheck
    readonly encryption?: EncryptionCheck
  }
}

const POLL_INTERVAL_MS = 5000
/** Sparkline width: the last N polls. ~80s of history at a 5s cadence. */
const SAMPLE_WINDOW = 16

const INK = "#0b0d12"
const PAPER = "#f6f5f2"
const SURFACE = "#fffefc"
const MUTED = "#5b5f68"
const SUBTLE = "#8a8e96"
const FAINT = "#a3a7ae"
const ACCENT = "#ff0073"
const OK = "#16a34a"
const WARN = "#d97706"
const DANGER = "#dc2626"

const SANS = "'Space Grotesk Variable', 'Geist Variable', system-ui, sans-serif"
const MONO = "'JetBrains Mono Variable', 'Geist Mono Variable', ui-monospace, monospace"

const codeStyle: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 12.5,
  background: "rgba(11,13,18,.06)",
  padding: "2px 6px",
  borderRadius: 5,
}

/** Caption shown next to the latency figure, per backend status value. */
const STATUS_CAPTION: Record<string, string> = {
  ok: "connected",
  error: "unreachable",
  migrations_missing: "migrations missing",
  not_configured: "not configured",
}

type Severity = "up" | "degraded" | "down"

const SEVERITY_COLOR: Record<Severity, string> = {
  up: OK,
  degraded: WARN,
  down: DANGER,
}

/**
 * Three states, not two: "not configured" and "migrations missing" are
 * operator to-dos, not outages, and the amber dot says so. Anything else
 * that isn't ok is a red outage.
 */
function severityOf(check: CheckResult): Severity {
  if (check.ok) return "up"
  if (check.status === "not_configured" || check.status === "migrations_missing") return "degraded"
  return "down"
}

interface ServiceView {
  readonly id: "database" | "redis" | "storage"
  readonly name: string
  readonly detail: string
  readonly check: CheckResult
}

// The provider grid is DERIVED from the backend's `checks.providers.keys`
// (see lib/provider-tiles.ts) — the backend holds the keys, so it owns which
// providers exist; this page only labels them. Until the first status
// arrives, render the known set so the layout does not jump.
const PROVIDER_PLACEHOLDER_KEYS: Readonly<Record<string, boolean>> = Object.fromEntries(
  Object.keys(PROVIDER_META).map((id) => [id, false]),
)

function clockOf(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * Hints come from the backend verbatim (it owns the remediation copy — a new
 * provider or a renamed env var updates the page for free). This only adds
 * the design's typographic treatment on top: SCREAMING_SNAKE env-var names
 * become inline code chips.
 */
/**
 * Backend hints are written as "<what is wrong> - <what to do>". Split on the
 * first such separator so the callout gets the design's heading + body without
 * this page restating the diagnosis in its own words (which drifts). A hint
 * with no separator degrades to body-only.
 */
function splitHint(text: string): { head: string | null; body: string } {
  const at = text.indexOf(" - ")
  if (at === -1) return { head: null, body: text }
  const body = text.slice(at + 3)
  return { head: text.slice(0, at), body: body.charAt(0).toUpperCase() + body.slice(1) }
}

function withCodeChips(text: string) {
  return text.split(/(\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b)/g).map((part, i) =>
    /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(part) ? (
      <code key={i} style={codeStyle}>
        {part}
      </code>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}

/**
 * Latency sparkline. Bars are REAL samples collected from the polls (the
 * design prototype's were synthetic); the window fills from the right, so a
 * freshly-opened page shows a couple of bars rather than fabricated history.
 * Heights normalize to the window max, floored at 30% so a fast sample is
 * still visible.
 */
function Sparkline({ samples }: { readonly samples: readonly number[] }) {
  const peak = Math.max(1, ...samples)
  const empty = Math.max(0, SAMPLE_WINDOW - samples.length)
  return (
    <div style={{ display: "flex", gap: 3, height: 26, alignItems: "flex-end" }} aria-hidden>
      {Array.from({ length: empty }, (_, i) => (
        <span
          key={`empty-${i}`}
          style={{ flex: 1, height: "12%", background: "rgba(11,13,18,.05)", borderRadius: 2 }}
        />
      ))}
      {samples.map((value, i) => (
        <span
          key={`s-${i}`}
          style={{
            flex: 1,
            height: `${Math.round(30 + (value / peak) * 70)}%`,
            background: "rgba(11,13,18,.14)",
            borderRadius: 2,
          }}
        />
      ))}
    </div>
  )
}

/**
 * The instance encryption key: what makes pasted provider keys and social
 * connections storable. Presence + provenance only (the backend never sends
 * the key). "generated" = start.sh minted it on first boot and keeps it in
 * the app-data volume — the one file to back up with the database.
 */
function EncryptionCard({ check }: { readonly check: EncryptionCheck }) {
  const severity: Severity = check.ok ? "up" : "down"
  return (
    <div
      style={{
        background: SURFACE,
        border: "1px solid rgba(11,13,18,.09)",
        borderRadius: 16,
        padding: "20px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>Encryption</span>
          <span style={{ fontFamily: MONO, fontSize: 11, color: SUBTLE }}>instance key · pasted keys, social tokens</span>
        </div>
        <span
          aria-label={check.ok ? "key present" : "key missing"}
          style={{ width: 9, height: 9, borderRadius: 999, background: SEVERITY_COLOR[severity], marginTop: 6, flexShrink: 0 }}
        />
      </div>
      {check.ok ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 14, color: INK }}>
            key present &middot;{" "}
            <span style={{ fontFamily: MONO, fontSize: 12, color: MUTED }}>
              {check.source === "generated" ? "generated on first boot" : `from ${check.envVar ?? "environment"}`}
            </span>
          </span>
          {check.source === "generated" && (
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: MUTED }}>
              lives in the app-data volume (/data/nodaro/encryption-key) — back it up with the database
            </span>
          )}
        </div>
      ) : (
        <span style={{ fontSize: 12.5, lineHeight: 1.45, color: "#b60a43" }}>{check.hint ?? "No instance encryption key."}</span>
      )}
    </div>
  )
}

function ServiceCard({
  service,
  samples,
}: {
  readonly service: ServiceView
  readonly samples: readonly number[]
}) {
  const { check } = service
  const severity = severityOf(check)
  const caption = STATUS_CAPTION[check.status] ?? check.status
  return (
    <div
      style={{
        background: SURFACE,
        border: "1px solid rgba(11,13,18,.09)",
        borderRadius: 16,
        padding: "20px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{service.name}</span>
          <span style={{ fontFamily: MONO, fontSize: 11, color: SUBTLE }}>{service.detail}</span>
        </div>
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: SEVERITY_COLOR[severity],
            marginTop: 6,
            flex: "none",
          }}
        />
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontFamily: MONO, fontSize: 32, fontWeight: 500, letterSpacing: "-0.02em" }}>
          {check.latencyMs ?? "—"}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 12, color: SUBTLE }}>
          {check.latencyMs !== null ? `ms · ${caption}` : caption}
        </span>
      </div>
      {check.ok ? (
        <Sparkline samples={samples} />
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: MUTED, lineHeight: 1.5 }}>
          {withCodeChips(check.hint ?? "")}
        </p>
      )}
    </div>
  )
}

/** Paste-ready provider-key block for the .env next to
 *  docker-compose.community.yml. Mirrors the compose passthrough list. */
const ENV_TEMPLATE = `# Nodaro self-host \u2014 provider keys. Paste into the .env next to
# docker-compose.community.yml, uncomment what you use, then: docker compose up -d
# (Or skip this file: paste keys on /setup \u2192 Install health \u2014 a key set here
# WINS over one pasted on the screen.)
# nodaro.ai: click "Connect nodaro.ai" in the app (OAuth, no key) \u2014 OR paste a
# personal API token from app.nodaro.ai \u2192 Settings \u2192 API. Runs alongside the others.

# NODARO_API_KEY=          # nodaro.ai \u2014 every model, one account (billed to that account)
# KIE_API_KEY=             # kie.ai \u2014 broadest media-model coverage
# REPLICATE_API_TOKEN=     # replicate.com
# ANTHROPIC_API_KEY=       # console.anthropic.com \u2014 LLM nodes
# GEMINI_API_KEY=          # aistudio.google.com \u2014 LLM + video analysis
# ELEVENLABS_API_KEY=      # elevenlabs.io \u2014 speech + voice
# FAL_KEY=                 # fal.ai
# HEYGEN_API_KEY=          # heygen.com \u2014 AI Avatar + Cinematic Avatar nodes (or connect nodaro.ai)
# BEEBLE_API_KEY=          # beeble.ai \u2014 Relight & Switch node (or connect nodaro.ai)
# APIFY_API_TOKEN=         # apify.com \u2014 Web Scrape node (or connect nodaro.ai)
`

export default function SetupPage() {
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [apiDown, setApiDown] = useState(false)
  const [spinning, setSpinning] = useState(false)
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)
  // Rolling latency history per service, oldest first (see Sparkline).
  const [samples, setSamples] = useState<Record<string, number[]>>({})
  const [tab, setTab] = useState<"setup" | "health">("setup")
  const [envCopied, setEnvCopied] = useState(false)
  const [envHelpOpen, setEnvHelpOpen] = useState(false)
  const [connectPending, setConnectPending] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const spinTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/v1/setup/status", { cache: "no-store" })
      if (!res.ok) throw new Error(`status ${res.status}`)
      const json = (await res.json()) as SetupStatus
      setStatus(json)
      setApiDown(false)
      setSamples((prev) => {
        const next: Record<string, number[]> = { ...prev }
        for (const id of ["database", "redis", "storage"] as const) {
          const ms = json.checks[id].latencyMs
          if (ms === null) continue
          next[id] = [...(prev[id] ?? []), ms].slice(-SAMPLE_WINDOW)
        }
        return next
      })
    } catch {
      setApiDown(true)
    } finally {
      setCheckedAt(new Date())
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [load])

  useEffect(() => () => {
    if (spinTimer.current) clearTimeout(spinTimer.current)
  }, [])

  const handleRefresh = () => {
    setSpinning(true)
    if (spinTimer.current) clearTimeout(spinTimer.current)
    spinTimer.current = setTimeout(() => setSpinning(false), 700)
    void load()
  }

  const services: ServiceView[] = status
    ? [
        { id: "database", name: "Database", detail: "Supabase / Postgres", check: status.checks.database },
        { id: "redis", name: "Redis", detail: "queue + cache", check: status.checks.redis },
        { id: "storage", name: "Storage", detail: "object storage", check: status.checks.storage },
      ]
    : []

  const upCount = services.filter((s) => s.check.ok).length
  const keysSet = status ? Object.values(status.checks.providers.keys).filter(Boolean).length : 0
  const keysTotal = status ? Object.keys(status.checks.providers.keys).length : Object.keys(PROVIDER_META).length
  const keysMissing = keysTotal - keysSet
  // Tiles + what connecting nodaro.ai would clear, straight from the backend's
  // list. Until the first status arrives, render the known set so the layout
  // does not jump.
  const tiles = providerTiles({
    keys: status?.checks.providers.keys ?? PROVIDER_PLACEHOLDER_KEYS,
    sources: status?.checks.providers.sources,
    meta: status?.checks.providers.meta,
  })
  const coverage = cloudCoverageSummary(tiles)
  // Core keys unlock model families; the node-specific ones (HeyGen, Beeble,
  // Apify) sit apart so three niche keys do not read as a general requirement.
  const tileGroups = groupProviderTiles(tiles)
  const refresh = load
  const latencies = services.map((s) => s.check.latencyMs).filter((v): v is number => v !== null)
  const avgLatency = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : null

  const anyDown = services.some((s) => severityOf(s.check) === "down")
  const overallLabel = apiDown
    ? "API unreachable"
    : !status
      ? "Checking…"
      : anyDown
        ? "Degraded"
        : upCount === services.length && status.checks.providers.ok
          ? "All systems go"
          : "Needs attention"

  const liveDotColor = apiDown ? DANGER : anyDown ? WARN : OK

  // Guided-setup derivations (mock 2026-08-13): steps from live state.
  const step1Done = status?.hasUsers === true
  const step2Done = status?.checks.providers.ok === true
  const currentStep = !step1Done ? 1 : !step2Done ? 2 : 3
  const progressPct = Math.round((((step1Done ? 1 : 0) + (step2Done ? 1 : 0)) / 3) * 100)
  const steps = [
    {
      n: 1,
      done: step1Done,
      accent: false,
      altKeys: false,
      where: "THIS SERVER",
      title: "Create your server login",
      desc: "Your operator account for this server only \u2014 it is NOT a nodaro.ai account (that one comes in step 2, if you want it).",
      cta: "Create account",
      href: "/signup?from=setup",
    },
    {
      n: 2,
      done: step2Done,
      accent: true,
      altKeys: true,
      where: "OPENS NODARO.AI",
      title: "Connect a model provider",
      desc: "Connect briefly leaves this server: it opens nodaro.ai, you sign in or create a free account THERE, approve, and you're back here connected (1,500 free credits). Or stay local with your own API keys \u2014 both run side by side.",
      cta: "Connect nodaro.ai",
      href: "/integrations",
    },
    {
      n: 3,
      done: false,
      accent: false,
      altKeys: false,
      where: "THIS SERVER",
      title: "Create your first workflow",
      desc: "Open the canvas and generate something.",
      cta: "Open Nodaro",
      href: "/projects",
    },
  ]
  const currentStepLabel = `Setup \u00b7 step ${currentStep} of 3`
  const healthSummaryLine = apiDown
    ? "API unreachable"
    : !status
      ? "Checking\u2026"
      : anyDown
        ? "Some services need attention"
        : avgLatency !== null
          ? `All services connected \u00b7 ${avgLatency}ms avg latency`
          : "All services connected"

  // One-click cloud connect: call the start endpoint directly and jump to
  // the nodaro.ai consent — no stop at /integrations (founder: the extra hop
  // read as "it sent me back to the editor", 2026-08-15). When the instance
  // cannot hand back a consent URL the reason is shown HERE, under the
  // button, and "use my own keys" becomes the way forward — never a silent
  // navigation (2026-08-16: production had the feature switched off and the
  // page hopped to /integrations with no message). Unauthenticated -> login.
  const startCloudConnect = async () => {
    if (connectPending) return
    setConnectPending(true)
    setConnectError(null)
    try {
      const headers = await getAuthHeaders()
      if (!headers.Authorization) {
        window.location.href = "/login?redirect=/setup"
        return
      }
      const res = await fetch("/v1/nodaro-connect/start", {
        method: "POST",
        headers,
      })
      const json: unknown = await res.json().catch(() => null)
      const outcome = interpretConnectStart(res.status, json)
      if (outcome.kind === "redirect") {
        localStorage.setItem("nodaro_connect_from", "setup")
        window.location.href = outcome.url
        return
      }
      setConnectError(outcome.message)
    } catch {
      setConnectError(CONNECT_START_NETWORK_MESSAGE)
    } finally {
      setConnectPending(false)
    }
  }


  return (
    <div
      style={{
        minHeight: "100vh",
        background: PAPER,
        fontFamily: SANS,
        color: INK,
        padding: "56px 32px 80px",
        boxSizing: "border-box",
        display: "flex",
        justifyContent: "center",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <style>{`
        @keyframes nd-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .35; transform: scale(.82); } }
        @keyframes nd-spin { to { transform: rotate(360deg); } }
        .nd-refresh:hover { background: ${ACCENT} !important; }
        .nd-back:hover { color: ${ACCENT}; }
        /* Summary bar: a GRID, not wrapping flex. Flex with a wider first
           basis re-divides the leftover space per row, so once the bar wraps
           the second row's cells no longer line up under the first row's
           (measured: 30px off at 560px). Fixed tracks keep every column on
           the same axis at any width, and the desktop step keeps the
           mockup's wider Overall cell. */
        .nd-summary { display: grid; grid-template-columns: 1.4fr 1fr 1fr 1fr; column-gap: 24px; row-gap: 18px; }
        @media (max-width: 720px) { .nd-summary { grid-template-columns: 1fr 1fr; } }
        @media (max-width: 420px) { .nd-summary { grid-template-columns: 1fr; } }
        @media (prefers-reduced-motion: reduce) {
          .nd-live-dot, .nd-spin-glyph { animation: none !important; }
        }
      `}</style>

      <div style={{ width: "100%", maxWidth: 940, display: "flex", flexDirection: "column", gap: 32 }}>
        {/* 1. Header */}
        <header
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 24,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
            <img
              src="/logo.svg"
              alt="Nodaro"
              width={44}
              height={44}
              style={{ width: 44, height: 44, borderRadius: 12, display: "block" }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <h1 style={{ margin: 0, fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em" }}>
                  Set up your install
                </h1>
                {status && (
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 11,
                      letterSpacing: ".08em",
                      textTransform: "uppercase",
                      padding: "4px 8px",
                      border: "1px solid rgba(11,13,18,.16)",
                      borderRadius: 999,
                      color: MUTED,
                    }}
                  >
                    {status.edition}
                  </span>
                )}
              </div>
              <p style={{ margin: 0, fontSize: 15, color: MUTED }}>Three steps to a working Nodaro server. Health checks are below.</p>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: MONO, fontSize: 12, color: MUTED }}
              aria-live="polite"
            >
              <span
                className="nd-live-dot"
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: liveDotColor,
                  animation: "nd-pulse 2s ease-in-out infinite",
                }}
              />
              <span>{checkedAt ? clockOf(checkedAt) : "--:--:--"}</span>
            </div>
            <button
              type="button"
              className="nd-refresh"
              onClick={handleRefresh}
              aria-label="Refresh install health"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                background: INK,
                color: PAPER,
                border: "none",
                borderRadius: 10,
                padding: "10px 16px",
                fontFamily: SANS,
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              <span
                className="nd-spin-glyph"
                aria-hidden
                style={{ display: "inline-block", animation: spinning ? "nd-spin .7s linear" : undefined }}
              >
                ↻
              </span>
              <span>Refresh</span>
            </button>
          </div>
        </header>


        {/* Tab strip: guided setup is the landing; health is one click away. */}
        <div style={{ display: "inline-flex", gap: 4, background: "rgba(11,13,18,.05)", borderRadius: 14, padding: 5, alignSelf: "flex-start" }}>
          {([["setup", currentStepLabel], ["health", "Install health"]] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{
                border: "none",
                cursor: "pointer",
                fontFamily: SANS,
                fontSize: 14,
                fontWeight: 600,
                padding: "10px 18px",
                borderRadius: 10,
                background: tab === id ? SURFACE : "transparent",
                color: tab === id ? INK : MUTED,
                boxShadow: tab === id ? "0 1px 4px rgba(11,13,18,.08)" : "none",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "setup" && status && (
          <section style={{ background: SURFACE, border: "1px solid rgba(11,13,18,.09)", borderRadius: 16, overflow: "hidden" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                flexWrap: "wrap",
                padding: "20px 26px",
                borderBottom: "1px solid rgba(11,13,18,.07)",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: ".14em", color: SUBTLE }}>GUIDED SETUP</span>
                <span style={{ fontSize: 17, fontWeight: 700 }}>Step {currentStep} of 3 · {steps[currentStep - 1]?.title}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ display: "flex", gap: 5 }}>
                  {steps.map((st) => (
                    <span key={st.n} style={{ width: 44, height: 5, borderRadius: 99, background: st.done ? ACCENT : st.n === currentStep ? ACCENT : "rgba(11,13,18,.10)", opacity: st.done ? 1 : st.n === currentStep ? 0.9 : 1 }} />
                  ))}
                </div>
                <span style={{ fontFamily: MONO, fontSize: 12, color: SUBTLE }}>{progressPct}%</span>
              </div>
            </div>

            {steps.map((st) => {
              const active = st.n === currentStep
              const locked = st.n > currentStep
              return (
                <div
                  key={st.n}
                  style={{
                    display: "flex",
                    alignItems: active ? "flex-start" : "center",
                    gap: 20,
                    padding: active ? "26px 26px" : "18px 26px",
                    borderBottom: st.n < 3 ? "1px solid rgba(11,13,18,.06)" : "none",
                  }}
                >
                  <span
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: "50%",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flex: "none",
                      fontWeight: 700,
                      fontSize: 15,
                      background: st.done ? "#dcfce7" : active ? ACCENT : "rgba(11,13,18,.06)",
                      color: st.done ? "#166534" : active ? "#fff" : FAINT,
                    }}
                  >
                    {st.done ? "\u2713" : st.n}
                  </span>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: active ? 19 : 16, fontWeight: 700, color: locked ? FAINT : INK }}>{st.title}</span>
                      <span
                        style={{
                          fontFamily: MONO,
                          fontSize: 9.5,
                          letterSpacing: ".1em",
                          color: st.where === "OPENS NODARO.AI" ? "oklch(0.45 0.09 205)" : SUBTLE,
                          border: `1px solid ${st.where === "OPENS NODARO.AI" ? "#bfe3ea" : "rgba(11,13,18,.14)"}`,
                          background: st.where === "OPENS NODARO.AI" ? "#f2fafc" : "transparent",
                          borderRadius: 5,
                          padding: "3px 7px",
                          whiteSpace: "nowrap",
                          opacity: locked ? 0.55 : 1,
                        }}
                      >
                        {st.where}
                      </span>
                      {active && (
                        <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: ".1em", color: "#b60a43", background: "#fce4ec", borderRadius: 999, padding: "4px 10px" }}>
                          DO THIS NOW
                        </span>
                      )}
                    </div>
                    {active && (
                      <div style={{ fontSize: 14.5, color: MUTED, marginTop: 7, maxWidth: 640 }}>{st.desc}</div>
                    )}
                  </div>
                  {active ? (
                    <span
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-end",
                        gap: 10,
                        alignSelf: "center",
                      }}
                    >
                      {st.accent ? (
                        <button
                          onClick={startCloudConnect}
                          disabled={connectPending}
                          style={{
                            border: "none",
                            cursor: connectPending ? "wait" : "pointer",
                            background: ACCENT,
                            color: "#fff",
                            fontFamily: SANS,
                            fontWeight: 700,
                            fontSize: 14.5,
                            padding: "12px 22px",
                            borderRadius: 11,
                            whiteSpace: "nowrap",
                            opacity: connectPending ? 0.75 : 1,
                          }}
                        >
                          {connectPending ? "Opening nodaro.ai\u2026" : <>{st.cta} &rarr;</>}
                        </button>
                      ) : (
                        <a
                          href={st.href}
                          style={{
                            background: INK,
                            color: "#fff",
                            fontWeight: 700,
                            fontSize: 14.5,
                            padding: "12px 22px",
                            borderRadius: 11,
                            textDecoration: "none",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {st.cta} &rarr;
                        </a>
                      )}
                      {st.altKeys && (
                        <button
                          onClick={() => setTab("health")}
                          style={{
                            border: "none",
                            background: connectError ? INK : "transparent",
                            cursor: "pointer",
                            fontFamily: MONO,
                            fontSize: 11.5,
                            letterSpacing: ".08em",
                            color: connectError ? "#fff" : INK,
                            textDecoration: connectError ? "none" : "underline",
                            textUnderlineOffset: 4,
                            whiteSpace: "nowrap",
                            padding: connectError ? "9px 14px" : 0,
                            borderRadius: connectError ? 9 : 0,
                          }}
                        >
                          USE MY OWN KEYS &rarr;
                        </button>
                      )}
                      {st.accent && connectError && (
                        <p
                          role="alert"
                          data-testid="cloud-connect-error"
                          style={{
                            margin: 0,
                            maxWidth: 300,
                            fontSize: 12.5,
                            lineHeight: 1.45,
                            color: "#b60a43",
                            textAlign: "right",
                          }}
                        >
                          {connectError}
                        </p>
                      )}
                    </span>
                  ) : (
                    <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: ".12em", color: FAINT }}>
                      {st.done ? "DONE" : st.n === currentStep + 1 ? "UP NEXT" : "LOCKED"}
                    </span>
                  )}
                </div>
              )
            })}
          </section>
        )}

        {tab === "setup" && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
              fontSize: 14.5,
              color: MUTED,
            }}
          >
            <span>{healthSummaryLine}</span>
            <button
              onClick={() => setTab("health")}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontFamily: MONO,
                fontSize: 12,
                letterSpacing: ".08em",
                color: INK,
                textDecoration: "underline",
                textUnderlineOffset: 4,
              }}
            >
              VIEW INSTALL HEALTH &rarr;
            </button>
          </div>
        )}

        {tab === "health" && (<>

        {/* 2. Summary bar */}
        <div
          className="nd-summary"
          style={{
            background: INK,
            color: PAPER,
            borderRadius: 16,
            padding: "22px 26px",
          }}
        >
          {[
            { label: "Overall", value: overallLabel },
            { label: "Services", value: status ? `${upCount}/${services.length} up` : "—" },
            { label: "Provider keys", value: status ? `${keysSet}/${keysTotal} set` : "—" },
            { label: "Latency", value: avgLatency !== null ? `${avgLatency}ms avg` : "—" },
          ].map((cell) => (
            <div key={cell.label} style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  color: "rgba(246,245,242,.5)",
                }}
              >
                {cell.label}
              </span>
              <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>{cell.value}</span>
            </div>
          ))}
        </div>

        {apiDown && (
          <div
            style={{
              display: "flex",
              gap: 14,
              alignItems: "flex-start",
              padding: "20px 22px",
              background: SURFACE,
              border: "1px solid rgba(11,13,18,.09)",
              borderRadius: 16,
            }}
          >
            <span style={{ width: 3, alignSelf: "stretch", background: DANGER, borderRadius: 2, flex: "none" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>API unreachable</span>
              <span style={{ fontSize: 14, color: MUTED, lineHeight: 1.55, maxWidth: "62ch" }}>
                The frontend is up but the backend is not answering. Check the container logs
                (docker compose logs -f) and that port 3000 is not blocked.
              </span>
            </div>
          </div>
        )}

        {/* 3. Service cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
          {status
            ? [
                ...services.map((s) => <ServiceCard key={s.id} service={s} samples={samples[s.id] ?? []} />),
                ...(status.checks.encryption ? [<EncryptionCard key="encryption" check={status.checks.encryption} />] : []),
              ]
            : Array.from({ length: 3 }, (_, i) => (
                <div
                  key={`skeleton-${i}`}
                  style={{
                    background: SURFACE,
                    border: "1px solid rgba(11,13,18,.09)",
                    borderRadius: 16,
                    padding: "20px 22px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                  }}
                >
                  <div style={{ height: 34, background: "rgba(11,13,18,.06)", borderRadius: 6 }} />
                  <div style={{ height: 32, width: "50%", background: "rgba(11,13,18,.06)", borderRadius: 6 }} />
                  <div style={{ height: 26, background: "rgba(11,13,18,.06)", borderRadius: 6 }} />
                </div>
              ))}
        </div>

        {/* 4. Provider keys */}
        <section
          style={{
            background: SURFACE,
            border: "1px solid rgba(11,13,18,.09)",
            borderRadius: 16,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              padding: "20px 22px",
              borderBottom: "1px solid rgba(11,13,18,.07)",
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>Provider keys</span>
              <span style={{ fontFamily: MONO, fontSize: 11, color: SUBTLE }}>paste here or set in .env &middot; relates to step 2</span>
            </div>
            {status && (() => {
              // Choosing the cloud path must not read as a warning: with a
              // live Nodaro connection the grid is green even when every
              // personal key is missing (founder, 2026-08-13).
              const viaCloud = status.checks.providers.nodaroCloud === true
              const warnState = !viaCloud && keysMissing > 0
              return (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 13,
                    fontWeight: 500,
                    color: warnState ? "#92400e" : "#166534",
                    background: warnState ? "#fef3c7" : "#dcfce7",
                    borderRadius: 999,
                    padding: "6px 12px",
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: warnState ? WARN : OK,
                    }}
                  />
                  <span>
                    {viaCloud
                      ? "connected via nodaro.ai"
                      : keysMissing > 0
                        ? `${keysMissing} missing`
                        : "all set"}
                  </span>
                </span>
              )
            })()}
          </div>

          {/* nodaro.ai featured band — one OAuth connect replaces every key
              in the grid below (founder mock 2026-08-14). Green when live. */}
          {(() => {
            const connected = status?.checks.providers.nodaroCloud === true
            return (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 18,
                  flexWrap: "wrap",
                  padding: "20px 22px",
                  borderBottom: "1px solid rgba(11,13,18,.05)",
                  borderLeft: `4px solid ${connected ? OK : ACCENT}`,
                  background: connected
                    ? "linear-gradient(90deg,#f0fdf4,rgba(240,253,244,0))"
                    : "linear-gradient(90deg,#fdf2f6,rgba(253,242,246,0))",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 260, flex: 1 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 17, fontWeight: 700 }}>nodaro.ai</span>
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 10.5,
                        letterSpacing: ".1em",
                        color: connected ? "#166534" : "#b60a43",
                        background: connected ? "#dcfce7" : "#fce4ec",
                        borderRadius: 999,
                        padding: "4px 10px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {connected ? "CONNECTED" : "FASTEST WAY"}
                    </span>
                  </span>
                  <span style={{ fontSize: 14.5, color: MUTED }}>
                    {connected ? (
                      <>
                        This install generates through your nodaro.ai account &mdash; image, video, speech, LLM,
                        avatars, relight and web scrape without the keys they would need; paste a key only to call
                        that vendor directly.
                        {coverage.uncoveredMissing.length > 0 && (
                          <>
                            {" "}Still needs its own key:{" "}
                            {coverage.uncoveredMissing.map((t) => t.name).join(", ")}.
                          </>
                        )}
                      </>
                    ) : coverage.coveredMissing > 0 ? (
                      <>
                        <strong style={{ color: INK, fontWeight: 600 }}>
                          One click clears {coverage.coveredMissing} of the {keysMissing} missing
                        </strong>
                        {" \u2014 OAuth sign-in, no API keys to manage."}
                        {coverage.uncoveredMissing.length > 0 && (
                          <>
                            {" "}Not covered (own key needed):{" "}
                            {coverage.uncoveredMissing.map((t) => t.name).join(", ")}.
                          </>
                        )}
                      </>
                    ) : (
                      <>One account, every model &mdash; OAuth sign-in, runs alongside your keys.</>
                    )}
                  </span>
                  {!connected && connectError && (
                    <span
                      role="alert"
                      data-testid="cloud-connect-error"
                      style={{ fontSize: 12.5, lineHeight: 1.45, color: "#b60a43", marginTop: 6 }}
                    >
                      {connectError} The keys below work without it.
                    </span>
                  )}
                </div>
                {connected ? (
                  <a
                    href="/integrations"
                    style={{
                      fontFamily: MONO,
                      fontSize: 12,
                      letterSpacing: ".08em",
                      color: INK,
                      textDecoration: "underline",
                      textUnderlineOffset: 4,
                      whiteSpace: "nowrap",
                    }}
                  >
                    MANAGE &rarr;
                  </a>
                ) : (
                  status?.hasUsers === false ? (
                    <a
                      href="/signup?from=setup"
                      style={{
                        background: ACCENT,
                        color: "#fff",
                        fontWeight: 700,
                        fontSize: 14.5,
                        padding: "12px 22px",
                        borderRadius: 11,
                        textDecoration: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Connect nodaro.ai &rarr;
                    </a>
                  ) : (
                    <button
                      onClick={startCloudConnect}
                      disabled={connectPending}
                      style={{
                        border: "none",
                        cursor: connectPending ? "wait" : "pointer",
                        background: ACCENT,
                        color: "#fff",
                        fontFamily: SANS,
                        fontWeight: 700,
                        fontSize: 14.5,
                        padding: "12px 22px",
                        borderRadius: 11,
                        whiteSpace: "nowrap",
                        opacity: connectPending ? 0.75 : 1,
                      }}
                    >
                      {connectPending ? "Opening nodaro.ai\u2026" : <>Connect nodaro.ai &rarr;</>}
                    </button>
                  )
                )}
              </div>
            )
          })()}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
            {tileGroups.core.map((tile) => (
              <ProviderKeyTile key={tile.id} tile={tile} onChanged={() => void refresh()} />
            ))}
          </div>
          {tileGroups.nodeSpecific.length > 0 && (
            <>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  padding: "14px 22px 6px",
                  borderTop: "1px solid rgba(11,13,18,.05)",
                }}
              >
                <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: SUBTLE }}>
                  Used by specific nodes
                </span>
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: FAINT }}>
                  only needed for the node each one names &mdash; leave them empty otherwise
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
                {tileGroups.nodeSpecific.map((tile) => (
                  <ProviderKeyTile key={tile.id} tile={tile} onChanged={() => void refresh()} />
                ))}
              </div>
            </>
          )}

          {/* Answers "where does the key go?" in plain words — expandable
              numbered steps, because "put it in the .env" assumes terminal
              fluency the reader may not have (founder, 2026-08-14). */}
          <div style={{ borderTop: "1px solid rgba(11,13,18,.05)" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                flexWrap: "wrap",
                fontFamily: MONO,
                fontSize: 11.5,
                color: SUBTLE,
                padding: "12px 22px",
              }}
            >
              <span>
                prefer a file? keys can also live in a plain-text <span style={{ color: INK }}>.env</span> in your install
                folder &mdash; a key set there wins over one pasted here &mdash; this list refreshes on its own
              </span>
              <span style={{ display: "inline-flex", gap: 18 }}>
                <button
                  onClick={() => setEnvHelpOpen((v) => !v)}
                  style={{
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    fontFamily: MONO,
                    fontSize: 11.5,
                    letterSpacing: ".08em",
                    color: INK,
                    textDecoration: "underline",
                    textUnderlineOffset: 4,
                    padding: 0,
                  }}
                >
                  {envHelpOpen ? "HIDE STEPS" : "HOW? \u2192"}
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard
                      .writeText(ENV_TEMPLATE)
                      .then(() => {
                        setEnvCopied(true)
                        setTimeout(() => setEnvCopied(false), 2000)
                      })
                      .catch(() => {})
                  }}
                  style={{
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    fontFamily: MONO,
                    fontSize: 11.5,
                    letterSpacing: ".08em",
                    color: envCopied ? "#166534" : INK,
                    textDecoration: envCopied ? "none" : "underline",
                    textUnderlineOffset: 4,
                    whiteSpace: "nowrap",
                    padding: 0,
                  }}
                >
                  {envCopied ? "COPIED \u2713" : "COPY .ENV TEMPLATE"}
                </button>
              </span>
            </div>
            {envHelpOpen && (
              <ol
                style={{
                  listStyle: "decimal",
                  margin: 0,
                  padding: "2px 22px 16px 40px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 7,
                  fontSize: 13.5,
                  color: MUTED,
                  maxWidth: "72ch",
                }}
              >
                <li>
                  Open the folder where you installed Nodaro &mdash; the one that contains{" "}
                  <code style={{ fontFamily: MONO, fontSize: 12, color: INK }}>docker-compose.community.yml</code>.
                </li>
                <li>
                  Create (or open) a file named <code style={{ fontFamily: MONO, fontSize: 12, color: INK }}>.env</code>{" "}
                  there, in any text editor, and paste the template &mdash; the COPY button above fills your clipboard.
                </li>
                <li>
                  Put your key after the <code style={{ fontFamily: MONO, fontSize: 12, color: INK }}>=</code> and remove
                  the <code style={{ fontFamily: MONO, fontSize: 12, color: INK }}>#</code> at the start of that line.
                </li>
                <li>
                  In a terminal in that folder, run{" "}
                  <code style={{ fontFamily: MONO, fontSize: 12, color: INK }}>docker compose -f docker-compose.community.yml up -d</code>{" "}
                  &mdash; or paste these steps into your AI assistant and it will drive.
                </li>
              </ol>
            )}
          </div>

          {status && !status.checks.providers.ok && (
            <div
              style={{
                display: "flex",
                gap: 14,
                alignItems: "flex-start",
                padding: "20px 22px",
                background: "rgba(255,49,89,.05)",
              }}
            >
              <span style={{ width: 3, alignSelf: "stretch", background: ACCENT, borderRadius: 2, flex: "none" }} />
              {(() => {
                const { head, body } = splitHint(status.checks.providers.hint ?? "")
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {head && <span style={{ fontSize: 14, fontWeight: 600 }}>{head}</span>}
                    <span style={{ fontSize: 14, color: MUTED, lineHeight: 1.55, maxWidth: "62ch" }}>
                      {withCodeChips(body)}
                    </span>
                  </div>
                )
              })()}
            </div>
          )}
        </section>

        {/* 5. Footer */}
        </>)}

        <footer
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
            fontFamily: MONO,
            fontSize: 12,
            color: SUBTLE,
          }}
        >
          <span>
            {checkedAt ? `Last checked ${clockOf(checkedAt)} · refreshes every 5s` : "Checking…"}
          </span>
          <Link
            to="/"
            className="nd-back"
            style={{
              fontFamily: SANS,
              fontSize: 14,
              fontWeight: 500,
              color: INK,
              textDecoration: "none",
              borderBottom: "1px solid rgba(11,13,18,.25)",
              paddingBottom: 1,
            }}
          >
            Back to app →
          </Link>
        </footer>
      </div>
    </div>
  )
}

