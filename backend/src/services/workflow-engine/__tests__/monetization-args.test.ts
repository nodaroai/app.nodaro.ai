// P14/W4g — the monetization wire args follow the execution's payer.
import { describe, it, expect } from "vitest"
import { monetizationRpcArgs } from "../monetization-args.js"
import type { BillingContext } from "../../../lib/billing-context.js"

const BASE = {
  runnerId: "runner-1",
  creatorId: "creator-1",
  markupAmount: 7,
  appVersionId: "app-1",
  runId: "run-1",
  baseCost: 40,
  flatFee: 1,
  percentFee: 2,
}

const WS_CTX: BillingContext = {
  payer: "workspace",
  userId: "runner-1",
  workspaceId: "ws-1",
  orgId: "org-1",
  memberCap: null,
  entitlements: {
    watermark: false,
    dailyCapCredits: null,
    parallelism: 12,
    tierForGates: "business",
    freeTierBlocklist: false,
    webFreeMode: false,
    appCreditsAllowance: false,
  },
}

describe("monetizationRpcArgs", () => {
  it("a workspace payer routes the BASE through the workspace (p_payer_workspace_id)", () => {
    const args = monetizationRpcArgs({ ...BASE, billingContext: WS_CTX })
    expect(args).toMatchObject({
      p_runner_id: "runner-1",
      p_creator_id: "creator-1",
      p_markup_amount: 7,
      p_app_id: "app-1",
      p_run_id: "run-1",
      p_base_cost: 40,
      p_flat_fee: 1,
      p_percent_fee: 2,
      p_payer_workspace_id: "ws-1",
    })
  })

  it("a personal payer's wire shape is byte-identical to pre-P14 — no workspace key", () => {
    const args = monetizationRpcArgs({ ...BASE, billingContext: { payer: "user", userId: "runner-1" } })
    expect(args).not.toHaveProperty("p_payer_workspace_id")
    expect(Object.keys(args).sort()).toEqual([
      "p_app_id",
      "p_base_cost",
      "p_creator_id",
      "p_flat_fee",
      "p_markup_amount",
      "p_percent_fee",
      "p_run_id",
      "p_runner_id",
    ])
  })
})
