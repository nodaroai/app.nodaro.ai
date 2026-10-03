/**
 * A Webhook Trigger's URL lives on the trigger row the server keeps for the
 * node (`config.nodeId`), never on the node data — so the editor used to show
 * "Configure webhook…" and no URL at all. The hook reads the node's own row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClientProvider } from "@tanstack/react-query"
import React from "react"

const TOKEN = "fake-webhook-token-for-tests"
const { rows, listCalls } = vi.hoisted(() => ({ rows: [] as unknown[], listCalls: [] as string[] }))

vi.mock("@/lib/api", () => ({
  listWorkflowTriggers: vi.fn(async (workflowId: string) => {
    listCalls.push(workflowId)
    return rows
  }),
}))
vi.mock("@/lib/runtime-config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/runtime-config")>()),
  runtimeApiUrl: () => "",
}))

import { queryClient } from "@/lib/query-client"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useWebhookTriggerUrl } from "../use-webhook-trigger-url"

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
)

beforeEach(() => {
  queryClient.clear()
  listCalls.length = 0
  rows.length = 0
  rows.push(
    { id: "t-other", type: "webhook", config: { nodeId: "other-node" }, webhookToken: "zz", webhookUrl: "/v1/webhooks/zz" },
    { id: "t-sched", type: "schedule", config: { nodeId: "hook-1" } },
    { id: "t-hook", type: "webhook", config: { nodeId: "hook-1" }, webhookToken: TOKEN, webhookUrl: `/v1/webhooks/${TOKEN}` },
  )
  useWorkflowStore.setState({ workflowId: "wf-1" })
})

describe("useWebhookTriggerUrl", () => {
  it("answers the node's own webhook row as an absolute URL", async () => {
    const { result } = renderHook(() => useWebhookTriggerUrl("hook-1"), { wrapper })
    await waitFor(() => expect(result.current.url).toBe(`${window.location.origin}/v1/webhooks/${TOKEN}`))
    expect(result.current.token).toBe(TOKEN)
    expect(listCalls).toEqual(["wf-1"])
  })

  it("answers null for a node that has no row yet (not saved)", async () => {
    const { result } = renderHook(() => useWebhookTriggerUrl("new-node"), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.url).toBeNull()
    expect(result.current.token).toBeNull()
  })

  it("asks nothing before the workflow has an id", () => {
    useWorkflowStore.setState({ workflowId: null })
    const { result } = renderHook(() => useWebhookTriggerUrl("hook-1"), { wrapper })
    expect(result.current.url).toBeNull()
    expect(listCalls).toEqual([])
  })
})
