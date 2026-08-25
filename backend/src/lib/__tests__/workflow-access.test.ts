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
vi.mock("@/lib/config.js", () => ({ hasOrganizations: vi.fn(() => true) }))

import {
  accessAtLeast,
  canChangeWorkflowVisibility,
  canDeleteWorkflow,
  canRunWorkflow,
  workflowAccess,
  workflowAccessFromRow,
} from "../workflow-access.js"
import { supabase } from "../supabase.js"
import { hasOrganizations } from "../config.js"
import { getPluginServices } from "../private-plugins/load.js"

const ME = "00000000-0000-4000-8000-000000000001"
const SOMEONE_ELSE = "00000000-0000-4000-8000-0000000000ff"
const WF = "00000000-0000-4000-8000-000000000020"
const WS = "00000000-0000-4000-8000-000000000030"

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
  vi.mocked(hasOrganizations).mockReturnValue(true)
})

/** A capable plugin, answering whatever the caller wants it to. */
function pluginAnswering(answers: {
  access?: unknown
  fromRow?: unknown
  canDelete?: boolean
  canRun?: boolean
  canChangeVisibility?: boolean
  canShare?: boolean
}) {
  const orgs = {
    workflowAccess: vi.fn().mockResolvedValue(answers.access ?? "own"),
    workflowAccessFromRow: vi.fn().mockResolvedValue(answers.fromRow ?? answers.access ?? "own"),
    canDeleteWorkflow: vi.fn().mockResolvedValue(answers.canDelete ?? true),
    canRunWorkflow: vi.fn().mockResolvedValue(answers.canRun ?? true),
    canChangeWorkflowVisibility: vi.fn().mockResolvedValue(answers.canChangeVisibility ?? true),
    canShareWorkflow: vi.fn().mockResolvedValue(answers.canShare ?? true),
  }
  vi.mocked(getPluginServices).mockReturnValue({ orgs } as never)
  return orgs
}

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
        canChangeWorkflowVisibility: vi.fn(),
        canShareWorkflow: vi.fn(),
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
      canChangeWorkflowVisibility: vi.fn().mockResolvedValue(false),
      canShareWorkflow: vi.fn().mockResolvedValue(false),
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

describe("with the flag OFF — production today, and every install before launch", () => {
  // The plugin builds its SERVICE object unconditionally while gating only its
  // ROUTES on the feature flag, so "a capable plugin is loaded" and
  // "organizations are switched on" are two different facts. This seam turns on
  // the second one. Without that, the by-id routes would start answering the
  // organization rule the day they were converted — months before launch —
  // and the most visible way that shows is a platform admin, who the rule
  // answers `own` to for every workflow in the database.
  beforeEach(() => {
    vi.mocked(hasOrganizations).mockReturnValue(false)
  })

  it("does not ask the plugin, even when a fully capable one is loaded", async () => {
    const orgs = pluginAnswering({ access: "own", canDelete: true, canRun: true })
    ownerRow({ user_id: SOMEONE_ELSE })

    await expect(workflowAccess(ME, WF)).resolves.toBe("none")
    expect(orgs.workflowAccess).not.toHaveBeenCalled()

    ownerRow({ user_id: SOMEONE_ELSE })
    await expect(canDeleteWorkflow(ME, WF)).resolves.toBe(false)
    expect(orgs.canDeleteWorkflow).not.toHaveBeenCalled()

    ownerRow({ user_id: SOMEONE_ELSE })
    await expect(canRunWorkflow(ME, WF)).resolves.toBe(false)
    expect(orgs.canRunWorkflow).not.toHaveBeenCalled()
  })

  it("a platform admin gets NOTHING on a stranger's workflow", async () => {
    // The concrete regression the gate exists for. `computeWorkflowAccess`
    // answers `own` to a platform admin before it looks at anything else, so
    // an ungated seam would hand every admin every workflow by id — where
    // these routes answer 404 today, and must keep answering 404 until the
    // switch is thrown deliberately.
    pluginAnswering({ access: "own", fromRow: "own" })
    ownerRow({ user_id: SOMEONE_ELSE })
    await expect(workflowAccess(ME, WF)).resolves.toBe("none")
    await expect(
      workflowAccessFromRow(ME, {
        id: WF, user_id: SOMEONE_ELSE, workspace_id: null, visibility: "private",
      }),
    ).resolves.toBe("none")
  })

  it("visibility stays the creator's to change", async () => {
    pluginAnswering({ canChangeVisibility: true })
    ownerRow({ user_id: SOMEONE_ELSE })
    await expect(canChangeWorkflowVisibility(ME, WF)).resolves.toBe(false)
    ownerRow({ user_id: ME })
    await expect(canChangeWorkflowVisibility(ME, WF)).resolves.toBe(true)
  })
})

describe("the personal-workflow fast path", () => {
  it("answers the creator of an unscoped workflow WITHOUT asking the plugin", async () => {
    // Every install today, and the overwhelming majority of reads afterwards.
    // The plugin would answer `own` here too — its creator branch is reached
    // with nothing before it that can fire on a workflow with no workspace —
    // after a platform-admin check, a membership load and a grant lookup
    // against tables with no relevant rows.
    const orgs = pluginAnswering({ fromRow: "view" })

    await expect(
      workflowAccessFromRow(ME, { id: WF, user_id: ME, workspace_id: null, visibility: "private" }),
    ).resolves.toBe("own")
    expect(orgs.workflowAccessFromRow).not.toHaveBeenCalled()
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("does NOT short-circuit a workspace workflow, even for its creator", async () => {
    // The condition that makes the early-out provable. Inside a workspace the
    // creator can be capped at `view` by archiving, or refused outright by a
    // suspended membership — answers only the plugin holds.
    const orgs = pluginAnswering({ fromRow: "view" })

    await expect(
      workflowAccessFromRow(ME, { id: WF, user_id: ME, workspace_id: WS, visibility: "workspace" }),
    ).resolves.toBe("view")
    expect(orgs.workflowAccessFromRow).toHaveBeenCalled()
  })

  it("does NOT short-circuit for anyone but the creator", async () => {
    const orgs = pluginAnswering({ fromRow: "edit" })

    await expect(
      workflowAccessFromRow(ME, {
        id: WF, user_id: SOMEONE_ELSE, workspace_id: null, visibility: "private",
      }),
    ).resolves.toBe("edit")
    expect(orgs.workflowAccessFromRow).toHaveBeenCalled()
  })
})

describe("canChangeWorkflowVisibility", () => {
  it("delegates when the plugin supplies the member", async () => {
    const orgs = pluginAnswering({ canChangeVisibility: true })
    await expect(canChangeWorkflowVisibility(ME, WF)).resolves.toBe(true)
    expect(orgs.canChangeWorkflowVisibility).toHaveBeenCalledWith(ME, WF)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("falls back to the CREATOR alone when the plugin is not fully capable", async () => {
    // A plugin missing ANY member of the set is treated as no plugin at all,
    // and this question goes through the same gate as its siblings. Answering
    // it org-aware while reads and deletes stayed creator-only is precisely
    // the mixed state the gate exists to make impossible — and
    // app-ahead-of-plugin is the normal deployment order, so it is a state the
    // product really passes through.
    const partial = vi.fn().mockResolvedValue(true)
    vi.mocked(getPluginServices).mockReturnValue({
      orgs: {
        workflowAccess: vi.fn(),
        workflowAccessFromRow: vi.fn(),
        canDeleteWorkflow: vi.fn(),
        canRunWorkflow: vi.fn(),
        canChangeWorkflowVisibility: partial,
        // canShareWorkflow missing — an older build
      },
    } as never)

    ownerRow({ user_id: SOMEONE_ELSE })
    await expect(canChangeWorkflowVisibility(ME, WF)).resolves.toBe(false)
    // Not merely the right answer: the half-built plugin was never consulted.
    expect(partial).not.toHaveBeenCalled()

    ownerRow({ user_id: ME })
    await expect(canChangeWorkflowVisibility(ME, WF)).resolves.toBe(true)
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
