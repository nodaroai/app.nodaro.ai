/**
 * A REAL Supabase client whose requests never leave the process: every
 * request is recorded (method, URL, body) and answered by `answer`. For tests
 * that pin what a query actually sends — the URL a gateway sees, its length,
 * the body of an RPC — rather than which builder methods were called.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

export interface CapturedRequest {
  readonly method: string
  readonly url: URL
  /** The full request line's target, as a gateway measures it. */
  readonly href: string
  readonly body: unknown
}

export interface CannedAnswer {
  readonly status?: number
  readonly body?: unknown
  /** The exact count a `count: "exact"` read answers in its Content-Range. */
  readonly count?: number
}

export const CAPTURE_BASE = "http://supabase.test"

export function capturingSupabase(answer: (req: CapturedRequest) => CannedAnswer = () => ({})) {
  const requests: CapturedRequest[] = []
  const fetchStub = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? "GET").toUpperCase()
    const rawBody = typeof init?.body === "string" ? init.body : undefined
    const req: CapturedRequest = { method, url: new URL(href), href, body: rawBody ? JSON.parse(rawBody) : undefined }
    requests.push(req)
    const a = answer(req)
    const status = a.status ?? 200
    const headers = { "content-type": "application/json", "content-range": `0-0/${a.count ?? "*"}` }
    const body = method === "HEAD" ? null : JSON.stringify(a.body ?? [])
    return new Response(body, { status, headers })
  }
  const client: SupabaseClient = createClient(CAPTURE_BASE, "service-role-key", {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: fetchStub },
  })
  return { client, requests }
}
