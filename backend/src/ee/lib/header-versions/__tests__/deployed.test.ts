import { describe, expect, it } from "vitest"
import { DEPLOYMENTS_WALKED, environmentOf, liveDeployment, type DeploymentRecord, type DeploymentState, type DeploymentStatus } from "../deployed.js"

const record = (id: number, environment: string, minute: number): DeploymentRecord => ({
  id,
  environment,
  sha: `sha${id}`,
  createdAt: new Date(Date.UTC(2026, 10, 1, 12, minute)).toISOString(),
})

/** Each deployment's statuses, newest first, as `state@minute`. */
function histories(byId: Record<number, readonly string[]>) {
  const asked: number[] = []
  const historyOf = async (r: DeploymentRecord): Promise<DeploymentStatus[]> => {
    asked.push(r.id)
    return (byId[r.id] ?? []).map((entry) => {
      const [state, minute] = entry.split("@")
      return { state: state as DeploymentState, at: minute ? `at-${r.id}-${minute}` : null }
    })
  }
  return { asked, historyOf }
}

describe("environmentOf", () => {
  it("reads the environment from the name's last part, whatever the project before it", () => {
    expect(environmentOf("acme-site / production")).toBe("production")
    expect(environmentOf("acme-app / staging")).toBe("staging")
    expect(environmentOf("Production")).toBe("production")
    expect(environmentOf("acme-site / preview-12")).toBeNull()
  })
})

describe("liveDeployment", () => {
  it("is the newest deployment that succeeded and is not retired, when it last went live", async () => {
    const { historyOf } = histories({ 1: ["inactive@9", "success@2"], 2: ["success@5", "in_progress@3"], 3: ["success@7"] })
    const records = [record(1, "p / production", 1), record(2, "p / production", 2), record(3, "p / staging", 3)]
    expect(await liveDeployment(records, "production", historyOf)).toEqual({ sha: "sha2", deployedAt: "at-2-5", deploying: false, lastFailed: false })
    expect(await liveDeployment(records, "staging", historyOf)).toEqual({ sha: "sha3", deployedAt: "at-3-7", deploying: false, lastFailed: false })
  })

  it("while a newer one builds, the last success is live — and one is said to be on its way", async () => {
    const { asked, historyOf } = histories({ 3: ["in_progress@30"], 2: ["success@21", "in_progress@20"], 1: ["inactive@21", "success@11"] })
    const records = [record(3, "p / staging", 3), record(1, "p / staging", 1), record(2, "p / staging", 2)]
    expect(await liveDeployment(records, "staging", historyOf)).toEqual({ sha: "sha2", deployedAt: "at-2-21", deploying: true, lastFailed: false })
    // Newest first, and never past the live one.
    expect(asked).toEqual([3, 2])
  })

  it("a newest deployment that never succeeded is reported beside the one still live", async () => {
    const { historyOf } = histories({ 2: ["failure@6", "in_progress@5"], 1: ["success@2"] })
    expect(await liveDeployment([record(1, "p / production", 1), record(2, "p / production", 2)], "production", historyOf)).toEqual({
      sha: "sha1",
      deployedAt: "at-1-2",
      deploying: false,
      lastFailed: true,
    })
  })

  it("a live deployment whose redeploy failed stays live, with the failure said (a real staging history)", async () => {
    // success 17:48, then a redeploy of the same deployment at 19:30 that failed twice.
    const { historyOf } = histories({ 2: ["failure@42", "failure@31", "in_progress@30", "success@18", "in_progress@15"], 1: ["inactive@18", "success@5"] })
    expect(await liveDeployment([record(1, "p / staging", 1), record(2, "p / staging", 2)], "staging", historyOf)).toEqual({
      sha: "sha2",
      deployedAt: "at-2-18",
      deploying: false,
      lastFailed: true,
    })
  })

  it("a failed deployment that a retry brought up is live, the old failure forgotten", async () => {
    const { historyOf } = histories({ 2: ["success@40", "in_progress@38", "failure@31", "in_progress@30"], 1: ["inactive@40", "success@5"] })
    expect(await liveDeployment([record(1, "p / staging", 1), record(2, "p / staging", 2)], "staging", historyOf)).toEqual({
      sha: "sha2",
      deployedAt: "at-2-40",
      deploying: false,
      lastFailed: false,
    })
  })

  it("a second service still rolling out a deployment that already succeeded: live, and still deploying", async () => {
    const { historyOf } = histories({ 2: ["in_progress@56", "success@55", "in_progress@53"], 1: ["success@5"] })
    expect(await liveDeployment([record(1, "p / staging", 1), record(2, "p / staging", 2)], "staging", historyOf)).toMatchObject({
      sha: "sha2",
      deploying: true,
    })
  })

  it("in the hand-over gap — the old one retired before the new one succeeded — the old one is still the answer", async () => {
    const { historyOf } = histories({ 2: ["in_progress@23"], 1: ["inactive@22", "success@5"] })
    expect(await liveDeployment([record(1, "p / production", 1), record(2, "p / production", 2)], "production", historyOf)).toEqual({
      sha: "sha1",
      deployedAt: "at-1-5",
      deploying: true,
      lastFailed: false,
    })
  })

  it("is null when nothing in that environment ever succeeded within the walk", async () => {
    const many = Array.from({ length: DEPLOYMENTS_WALKED + 2 }, (_, i) => record(i + 1, "p / production", i))
    const { asked, historyOf } = histories(Object.fromEntries(many.map((r) => [r.id, r.id === 1 ? ["success@1"] : ["failure@1"]])))
    // The one success is older than the walk reaches.
    expect(await liveDeployment(many, "production", historyOf)).toBeNull()
    expect(asked).toHaveLength(DEPLOYMENTS_WALKED)
    expect(await liveDeployment([record(9, "p / staging", 1)], "production", historyOf)).toBeNull()
  })

  it("falls back to the deployment's creation time when its success carries none", async () => {
    const r = record(1, "p / production", 5)
    expect(await liveDeployment([r], "production", async () => [{ state: "success", at: null }])).toMatchObject({ deployedAt: r.createdAt })
  })
})
