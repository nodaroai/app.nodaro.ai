/**
 * The short workflow link, /editor/<workflowId> — what assistants are taught to
 * share and what the Shared page links to: it opens the editor at the
 * workflow's full address, under its own project, and anything the viewer
 * cannot read is not found.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom"

const db = vi.hoisted(() => ({ row: null as { project_id: string | null } | null, error: null as Error | null, asked: [] as string[] }))

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, id: string) => ({
          maybeSingle: async () => {
            db.asked.push(`${table}.${columns} where ${column}=${id}`)
            return { data: db.row, error: db.error }
          },
        }),
      }),
    }),
  }),
}))

import EditorLinkPage from "../editor-link-page"

const WORKFLOW = "0b9a6f8e-1111-4222-8333-444455556666"
const PROJECT = "7c1d2e3f-aaaa-4bbb-8ccc-ddddeeeeffff"

function Editor() {
  const { id, workflowId } = useParams()
  return <p>editor of {workflowId} in {id}</p>
}

function open(path: string, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/editor/:workflowId" element={<EditorLinkPage />} />
          <Route path="/projects/:id/workflows/:workflowId" element={<Editor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  db.row = null
  db.error = null
  db.asked = []
})

describe("/editor/<workflowId>", () => {
  it("opens the editor at the workflow's full address, under its own project", async () => {
    db.row = { project_id: PROJECT }
    open(`/editor/${WORKFLOW}`)
    expect(await screen.findByText(`editor of ${WORKFLOW} in ${PROJECT}`)).toBeInTheDocument()
    expect(db.asked).toEqual([`workflows.project_id where id=${WORKFLOW}`])
  })

  it("a workflow moved since the last click opens under its new project", async () => {
    // One cache across both visits, remembering answers as long as the app's
    // own does (lib/query-client.ts), as in the browser.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000, gcTime: 5 * 60_000 } } })
    db.row = { project_id: PROJECT }
    const first = open(`/editor/${WORKFLOW}`, client)
    expect(await screen.findByText(`editor of ${WORKFLOW} in ${PROJECT}`)).toBeInTheDocument()
    first.unmount()

    const MOVED_TO = "9e8d7c6b-5a49-4382-9716-151413121110"
    db.row = { project_id: MOVED_TO }
    open(`/editor/${WORKFLOW}`, client)
    expect(await screen.findByText(`editor of ${WORKFLOW} in ${MOVED_TO}`)).toBeInTheDocument()
  })

  it("a workflow the viewer cannot read, or one with no project, is not found", async () => {
    open(`/editor/${WORKFLOW}`)
    expect(await screen.findByText("404")).toBeInTheDocument()
  })

  it("a lookup that fails is not found, not a spinner forever", async () => {
    db.error = new Error("permission denied")
    open(`/editor/${WORKFLOW}`)
    expect(await screen.findByText("404")).toBeInTheDocument()
  })

  it("something that is not a workflow id is not found without asking the database", async () => {
    open("/editor/not-a-workflow")
    expect(await screen.findByText("404")).toBeInTheDocument()
    expect(db.asked).toEqual([])
  })

  it("is a route the app serves — the server hands this link out (create_workflow's editorUrl)", () => {
    // The tests above mount the page on their own route; this pins the real
    // one, so the link the backend builds (workflowEditorUrl) cannot quietly
    // become "not found" again.
    const router = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "router.tsx"), "utf8")
    expect(router).toContain('lazy(() => import("@/routes/editor-link-page"))')
    expect(router).toMatch(/path:\s*"\/editor\/:workflowId",\s*element:\s*<SuspenseWrapper><EditorLinkPage \/><\/SuspenseWrapper>/)
    // Inside the signed-in layout, whose guard sends a signed-out visitor to
    // sign in (and back) — outside it, they would get a bare "not found".
    const layout = router.indexOf("element: <DashboardLayout />")
    const childrenStart = router.indexOf("children: [", layout)
    let depth = 0
    let childrenEnd = -1
    for (let i = childrenStart + "children: ".length; i < router.length; i++) {
      if (router[i] === "[") depth++
      else if (router[i] === "]" && --depth === 0) {
        childrenEnd = i
        break
      }
    }
    const route = router.indexOf('path: "/editor/:workflowId"')
    expect(layout).toBeGreaterThan(-1)
    expect(route).toBeGreaterThan(childrenStart)
    expect(route).toBeLessThan(childrenEnd)
  })
})
