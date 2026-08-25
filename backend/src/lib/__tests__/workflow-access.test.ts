import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The access seam, and above all its FALLBACK.
 *
 * The fallback is what every community and business install runs, and what
 * cloud runs against a plugin build older than these members. It has one job:
 * be byte-equivalent to what the routes did before this seam existed —
 * `.eq("id", id).eq("user_id", userId).single()`, 404 on a miss.
 *
 * The first four cases below are the ones that protect every existing user of
 * every edition, which is why the handoff says to write them first.
 */

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/private-plugins/load.js", () => ({ getPluginServices: vi.fn(() => ({})) }))

import {
  accessAtLeast,
  canDeleteWorkflow,
  canRunWorkflow,
  workflowAccess,
  workflowAccessFromRow,
} from "../workflow-access.js"
import { supabase } from "../supabase.js"
import { getPluginServices } from "../private-plugins/load.js"

const ME = "00000000-0000-4000-8000-000000000001"
const SOMEONE_ELSE = "00000000-0000-4000-8000-0000000000ff"
const WF = "00000000-0000-4000-8000-000000000020"

/** `.from("workflows").select("user_id").eq("id", …).maybeSingle()` */
function ownerRow(row: { user_id: string } | null, error: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error })
  const eq = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq })
  vi.mocked(supabase.from).mockReturnValue({ select } as never)
  return { select, eq }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getPluginServices).mockReturnValue({} as never)
})

describe("with no organizations plugin — every install running today", () => {
  it("the creator owns it", async () => {
    ownerRow({ user_id: ME })
    await expect(workflowAccess(ME, WF)).resolves.toBe("own")
  })

  it("everyone else has nothing", async () => {
    // Not "view", not "none because we could not tell" — nothing. Without a
    // plugin there are no workspaces, no grants and no visibility levers, so
    // there is no route by which a second person could reach this row.
    ownerRow({ user_id: SOMEONE_ELSE })
    await expect(workflowAccess(ME, WF)).resolves.toBe("none")
  })

  it("a workflow that does not exist is nothing, not a crash", async () => {
    ownerRow(null)
    await expect(workflowAccess(ME, WF)).resolves.toBe("none")
  })

  it("a database error is nothing — the seam fails CLOSED", async () => {
    // The opposite choice would hand out access during an outage.
    ownerRow(null, { message: "connection reset" })
    await expect(workflowAccess(ME, WF)).resolves.toBe("none")
  })

  it("ASKS THE DATABASE — the fallback is a query, never a constant", async () => {
    // The mutation this exists for: a fallback that returns "own" without
    // looking turns every community install into an open door the moment a
    // route starts trusting this seam, which is the entire point of the seam.
    const { select, eq } = ownerRow({ user_id: ME })
    await workflowAccess(ME, WF)
    expect(supabase.from).toHaveBeenCalledWith("workflows")
    expect(select).toHaveBeenCalledWith("user_id")
    expect(eq).toHaveBeenCalledWith("id", WF)
  })

  it("the row form answers without a query at all", async () => {
    // The whole reason it exists: no second round trip on the hottest path.
    await expect(
      workflowAccessFromRow(ME, { id: WF, user_id: ME, workspace_id: null, visibility: "private" }),
    ).resolves.toBe("own")
    await expect(
      workflowAccessFromRow(ME, { id: WF, user_id: SOMEONE_ELSE, workspace_id: null, visibility: "private" }),
    ).resolves.toBe("none")
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("only the creator deletes, and only the creator runs", async () => {
    ownerRow({ user_id: ME })
    await expect(canDeleteWorkflow(ME, WF)).resolves.toBe(true)
    ownerRow({ user_id: SOMEONE_ELSE })
    await expect(canDeleteWorkflow(ME, WF)).resolves.toBe(false)
    ownerRow({ user_id: ME })
    await expect(canRunWorkflow(ME, WF)).resolves.toBe(true)
    ownerRow({ user_id: SOMEONE_ELSE })
    await expect(canRunWorkflow(ME, WF)).resolves.toBe(false)
  })
})

describe("with the plugin present", () => {
  it("delegates, and does not second-guess the answer", async () => {
    const workflowAccessImpl = vi.fn().mockResolvedValue("edit")
    vi.mocked(getPluginServices).mockReturnValue({
      orgs: {
        workflowAccess: workflowAccessImpl,
        workflowAccessFromRow: vi.fn(),
        canDeleteWorkflow: vi.fn(),
        canRunWorkflow: vi.fn(),
      },
    } as never)

    await expect(workflowAccess(ME, WF)).resolves.toBe("edit")
    expect(workflowAccessImpl).toHaveBeenCalledWith(ME, WF)
    // No fallback query fired: re-checking the plugin's answer against the row
    // would be a second implementation of the rule, which is the one thing
    // this seam exists to prevent.
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("delegates delete and run separately from access", async () => {
    // Three questions, three members. `canDelete` is NOT `access >= edit`: a
    // collaborator with an editor grant may change the work and must never be
    // able to end it.
    const orgs = {
      workflowAccess: vi.fn().mockResolvedValue("edit"),
      workflowAccessFromRow: vi.fn(),
      canDeleteWorkflow: vi.fn().mockResolvedValue(false),
      canRunWorkflow: vi.fn().mockResolvedValue(false),
    }
    vi.mocked(getPluginServices).mockReturnValue({ orgs } as never)

    await expect(workflowAccess(ME, WF)).resolves.toBe("edit")
    await expect(canDeleteWorkflow(ME, WF)).resolves.toBe(false)
    await expect(canRunWorkflow(ME, WF)).resolves.toBe(false)
  })

  it("a HALF-built plugin is treated as no plugin, not as three answers and a guess", async () => {
    // Creator-only is not uniformly weaker than the organization rule, which
    // is what makes mixing them dangerous rather than merely inconsistent: a
    // creator whose membership is SUSPENDED is refused by the plugin and
    // allowed by the fallback. So a build carrying `workflowAccess` but not
    // `canDeleteWorkflow` would answer org-aware for reads and creator-only
    // for deletes, and a student suspended from a class would still delete
    // and re-run their work in it — billing the class.
    //
    // The four ship together today. `CLOUD_PLUGINS_VERSION` is a build
    // argument tracked nowhere in git and app-ahead-of-plugin is the normal
    // deployment order, so this file does not get to assume that.
    const orgs = {
      workflowAccess: vi.fn().mockResolvedValue("edit"),
      workflowAccessFromRow: vi.fn(),
      canRunWorkflow: vi.fn().mockResolvedValue(false),
      // canDeleteWorkflow missing — an older build
    }
    vi.mocked(getPluginServices).mockReturnValue({ orgs } as never)
    ownerRow({ user_id: SOMEONE_ELSE })

    await expect(workflowAccess(ME, WF)).resolves.toBe("none")
    expect(orgs.workflowAccess).not.toHaveBeenCalled()
    await expect(canRunWorkflow(ME, WF)).resolves.toBe(false)
    expect(orgs.canRunWorkflow).not.toHaveBeenCalled()
  })

  it("an OLDER plugin build falls back rather than throwing", async () => {
    // Optional-by-absence, like every member of this contract. A plugin that
    // predates these members must degrade to the creator-only answer, not
    // crash every by-id route in production.
    vi.mocked(getPluginServices).mockReturnValue({ orgs: { loadMemberships: vi.fn() } } as never)
    ownerRow({ user_id: ME })
    await expect(workflowAccess(ME, WF)).resolves.toBe("own")
  })
})

describe("accessAtLeast", () => {
  it("orders none < view < edit < own", () => {
    expect(accessAtLeast("own", "edit")).toBe(true)
    expect(accessAtLeast("edit", "edit")).toBe(true)
    expect(accessAtLeast("view", "edit")).toBe(false)
    expect(accessAtLeast("none", "view")).toBe(false)
    expect(accessAtLeast("view", "view")).toBe(true)
  })
})
