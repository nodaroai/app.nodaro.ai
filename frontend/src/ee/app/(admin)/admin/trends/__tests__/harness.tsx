/**
 * Shared by the Trends admin tests: a fetch stub keyed by "METHOD path" (the
 * real `@/lib/api` calls run against it, so the request shapes and the error
 * mapping are the shipped ones), fixtures, and a render helper.
 */
import { vi } from "vitest"
import { render } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import type { ReactElement } from "react"
import { toast } from "sonner"
import type {
  AdminTrendData,
  AdminTrendDetail,
  AdminTrendListItem,
  AdminTrendRun,
  AdminTrendSlot,
  TrendEngineEnvironment,
} from "@/lib/api"

export interface Reply {
  readonly status?: number
  readonly body: unknown
}
type Route = (init?: RequestInit) => Reply | Promise<Reply>

export const routes: Record<string, Route> = {}

export const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const key = `${init?.method ?? "GET"} ${url}`
  const route = routes[key]
  if (!route) throw new Error(`unexpected fetch: ${key}`)
  const reply = await route(init)
  const status = reply.status ?? 200
  return { ok: status < 400, status, json: async () => reply.body } as unknown as Response
})

/** The bodies sent to `key`, parsed. */
export function sentTo(key: string): unknown[] {
  return fetchMock.mock.calls
    .filter(([url, init]) => `${init?.method ?? "GET"} ${url}` === key)
    .map(([, init]) => (init?.body === undefined ? undefined : JSON.parse(String(init.body))))
}

export function resetRoutes() {
  for (const k of Object.keys(routes)) delete routes[k]
  fetchMock.mockClear()
}

export const TREND_ID = "00000000-0000-4000-8000-0000000000a1"
export const RUN_ID = "00000000-0000-4000-8000-0000000000b1"

export function slot(over: Partial<AdminTrendSlot> = {}): AdminTrendSlot {
  return {
    key: "dancer",
    label: { en: "Dancer", he: "רקדנית" },
    kind: "person",
    required: true,
    roleName: "the woman on the left",
    defaults: { body: "new" },
    ...over,
  } as AdminTrendSlot
}

export function draft(over: Partial<AdminTrendData> = {}): AdminTrendData {
  return {
    name: { en: "Office dance" },
    source: { videoUrl: "https://cdn.test/trends/a1/src.mp4", durationSec: 12, width: 720, height: 1280 },
    previewStart: 2,
    slots: [slot()],
    references: [],
    trendPrompt: "Keep the camera moves.",
    examples: [],
    ...over,
  }
}

export function detail(over: Partial<AdminTrendDetail> = {}, data: Partial<AdminTrendData> = {}): AdminTrendDetail {
  return {
    trend: {
      id: TREND_ID,
      slug: "office-dance",
      status: "draft",
      tags: ["dance"],
      badges: [],
      sortOrder: 0,
      draftVersion: 1,
      publishedVersion: null,
      createdAt: "2026-10-20T08:00:00.000Z",
      updatedAt: "2026-10-20T09:00:00.000Z",
    },
    draft: draft(data),
    published: null,
    revision: "rev-1",
    ...over,
  }
}

export function listItem(over: Partial<AdminTrendListItem> = {}): AdminTrendListItem {
  return {
    id: TREND_ID,
    slug: "office-dance",
    status: "published",
    name: "Office dance",
    slotCount: 2,
    draftVersion: 3,
    publishedVersion: 2,
    tags: ["dance"],
    badges: ["trending"],
    sortOrder: 5,
    updatedAt: "2026-10-20T09:00:00.000Z",
    ...over,
  }
}

export function run(over: Partial<AdminTrendRun> = {}): AdminTrendRun {
  return {
    jobId: RUN_ID,
    status: "completed",
    progress: 100,
    error: null,
    createdAt: "2026-10-20T10:00:00.000Z",
    completedAt: "2026-10-20T10:03:00.000Z",
    trend: { id: TREND_ID, slug: "office-dance", version: 1, name: "Office dance" },
    example: 1,
    slots: [{ key: "dancer", label: "Dancer", kind: "person", images: ["https://cdn.test/me.png"], fromExample: false }],
    preview: false,
    resolution: "480p",
    draft: true,
    videoUrl: "https://cdn.test/out.mp4",
    posterUrl: null,
    creditsCharged: 40,
    fullQuality: null,
    fullQualityUntil: null,
    ownerIsAdmin: true,
    ...over,
  }
}

export const ENVIRONMENTS: TrendEngineEnvironment[] = [
  {
    env: "production",
    pluginBuildId: "1.40.0",
    supports: { castSwap: { roleKinds: ["person"], fixedReferences: true, fullQuality: true, resolutions: ["480p", "720p", "1080p"], trendRun: true } },
    updatedAt: "2026-10-20T07:00:00.000Z",
  },
]

export function renderWith(ui: ReactElement, path = "/admin/trends", pattern = "/admin/trends") {
  // The app's own default (lib/query-client.ts): an unhandled mutation error toasts.
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false, onError: (e) => toast.error(e instanceof Error ? e.message : "Something went wrong") },
    },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={pattern} element={ui} />
          <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
