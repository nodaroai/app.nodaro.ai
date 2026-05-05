import { describe, it, expect } from "vitest"
import { queryKeys } from "../query-keys"

describe("queryKeys", () => {
  describe("credits", () => {
    it("has static all key", () => {
      expect(queryKeys.credits.all).toEqual(["credits"])
    })

    it("builds balance key with userId", () => {
      expect(queryKeys.credits.balance("u1")).toEqual(["credits", "balance", "u1"])
    })

    it("builds modelCost key with model", () => {
      expect(queryKeys.credits.modelCost("flux-pro")).toEqual(["credits", "model-cost", "flux-pro"])
    })
  })

  describe("billing", () => {
    it("has static all key", () => {
      expect(queryKeys.billing.all).toEqual(["billing"])
    })

    it("builds subscription key", () => {
      expect(queryKeys.billing.subscription("u1")).toEqual(["billing", "subscription", "u1"])
    })

    it("builds transactions key", () => {
      expect(queryKeys.billing.transactions("u1")).toEqual(["billing", "transactions", "u1"])
    })

    it("builds storage key", () => {
      expect(queryKeys.billing.storage("u1")).toEqual(["billing", "storage", "u1"])
    })
  })

  describe("stats", () => {
    it("has static all key", () => {
      expect(queryKeys.stats.all).toEqual(["stats"])
    })

    it("builds scoped key with user scope", () => {
      expect(queryKeys.stats.scoped("user", "u1")).toEqual(["stats", "user", "u1"])
    })

    it("builds scoped key with platform scope", () => {
      expect(queryKeys.stats.scoped("platform", "u1")).toEqual(["stats", "platform", "u1"])
    })
  })

  describe("userSettings", () => {
    it("has static all key", () => {
      expect(queryKeys.userSettings.all).toEqual(["user-settings"])
    })

    it("builds detail key", () => {
      expect(queryKeys.userSettings.detail("u1")).toEqual(["user-settings", "u1"])
    })
  })

  describe("appSettings", () => {
    it("has static all key", () => {
      expect(queryKeys.appSettings.all).toEqual(["app-settings"])
    })
  })

  describe("gallery", () => {
    it("has static all key", () => {
      expect(queryKeys.gallery.all).toEqual(["gallery"])
    })

    it("builds list key with filter", () => {
      expect(queryKeys.gallery.list("image")).toEqual(["gallery", "list", "image"])
    })

    it("builds reportCount key", () => {
      expect(queryKeys.gallery.reportCount()).toEqual(["gallery", "report-count"])
    })
  })

  describe("assets", () => {
    it("has static all key", () => {
      expect(queryKeys.assets.all).toEqual(["assets"])
    })

    it("builds characters key with both params", () => {
      expect(queryKeys.assets.characters("p1", "u1")).toEqual(["assets", "characters", "p1", "u1"])
    })

    it("builds characters key with undefined params (defaults to empty strings)", () => {
      expect(queryKeys.assets.characters()).toEqual(["assets", "characters", "", ""])
    })

    it("builds objects key", () => {
      expect(queryKeys.assets.objects("p1", "u1")).toEqual(["assets", "objects", "p1", "u1"])
    })

    it("builds locations key", () => {
      expect(queryKeys.assets.locations("p1")).toEqual(["assets", "locations", "p1", ""])
    })

    it("builds faces key", () => {
      expect(queryKeys.assets.faces("p1", "u1")).toEqual(["assets", "faces", "p1", "u1"])
    })
  })

  describe("library", () => {
    it("has static all key", () => {
      expect(queryKeys.library.all).toEqual(["library"])
    })

    it("builds list key with all params", () => {
      expect(
        queryKeys.library.list({ userId: "u1", type: "image", search: "cat", owned: true })
      ).toEqual(["library", "list", "u1", "image", "cat", "true"])
    })

    it("builds list key with defaults for optional params", () => {
      expect(queryKeys.library.list({ userId: "u1" })).toEqual([
        "library", "list", "u1", "", "", "false",
      ])
    })
  })

  describe("editor", () => {
    it("has static all key", () => {
      expect(queryKeys.editor.all).toEqual(["editor"])
    })

    it("builds costSummary key with sorted jobIds", () => {
      const result = queryKeys.editor.costSummary(["b", "a", "c"])
      expect(result).toEqual(["editor", "cost-summary", ["a", "b", "c"]])
    })

    it("builds costSummary key with empty array", () => {
      expect(queryKeys.editor.costSummary([])).toEqual(["editor", "cost-summary", []])
    })

    it("builds importableWorkflows key", () => {
      expect(queryKeys.editor.importableWorkflows("p1", "w1")).toEqual([
        "editor", "importable-workflows", "p1", "w1",
      ])
    })
  })

  describe("jobs", () => {
    it("has static all key", () => {
      expect(queryKeys.jobs.all).toEqual(["jobs"])
    })

    it("builds list key with cursor", () => {
      expect(queryKeys.jobs.list("u1", "cur_123")).toEqual(["jobs", "list", "u1", "cur_123"])
    })

    it("builds list key without cursor (undefined)", () => {
      expect(queryKeys.jobs.list("u1")).toEqual(["jobs", "list", "u1", undefined])
    })

    it("builds detail key", () => {
      expect(queryKeys.jobs.detail("j1")).toEqual(["jobs", "detail", "j1"])
    })
  })

  describe("projects", () => {
    it("has static all key", () => {
      expect(queryKeys.projects.all).toEqual(["projects"])
    })

    it("builds list key", () => {
      expect(queryKeys.projects.list()).toEqual(["projects", "list"])
    })

    it("builds detail key", () => {
      expect(queryKeys.projects.detail("p1")).toEqual(["projects", "detail", "p1"])
    })
  })

  describe("search", () => {
    it("has static all key", () => {
      expect(queryKeys.search.all).toEqual(["search"])
    })

    it("builds results key with query", () => {
      expect(queryKeys.search.results("hello")).toEqual(["search", "hello"])
    })
  })

  describe("admin", () => {
    it("has static all key", () => {
      expect(queryKeys.admin.all).toEqual(["admin"])
    })

    it("builds stats key", () => {
      expect(queryKeys.admin.stats()).toEqual(["admin", "stats"])
    })

    it("builds users key with pagination", () => {
      expect(queryKeys.admin.users(1, 20)).toEqual(["admin", "users", 1, 20])
    })

    it("builds jobs key with pagination and status", () => {
      expect(queryKeys.admin.jobs(0, 50, "error")).toEqual(["admin", "jobs", 0, 50, "error", "", ""])
    })

    it("builds jobs key without status (defaults to empty string)", () => {
      expect(queryKeys.admin.jobs(0, 50)).toEqual(["admin", "jobs", 0, 50, "", "", ""])
    })

    it("builds jobs key with userId", () => {
      expect(queryKeys.admin.jobs(0, 50, "completed", "u1")).toEqual(["admin", "jobs", 0, 50, "completed", "u1", ""])
    })

    it("builds jobs key with excludeUserIds (sorted)", () => {
      expect(queryKeys.admin.jobs(0, 50, undefined, undefined, ["u3", "u1", "u2"]))
        .toEqual(["admin", "jobs", 0, 50, "", "", "u1,u2,u3"])
    })

    it("normalizes empty excludeUserIds to empty string", () => {
      expect(queryKeys.admin.jobs(0, 50, undefined, undefined, []))
        .toEqual(["admin", "jobs", 0, 50, "", "", ""])
    })

    it("returns same key for excludeUserIds in different orders", () => {
      expect(queryKeys.admin.jobs(0, 50, undefined, undefined, ["a", "b"]))
        .toEqual(queryKeys.admin.jobs(0, 50, undefined, undefined, ["b", "a"]))
    })

    it("builds usersLite key", () => {
      expect(queryKeys.admin.usersLite()).toEqual(["admin", "users-lite"])
    })

    it("builds usageLogs key", () => {
      expect(queryKeys.admin.usageLogs(0, 25)).toEqual(["admin", "usage-logs", 0, 25])
    })

    it("builds models key", () => {
      expect(queryKeys.admin.models()).toEqual(["admin", "models"])
    })

    it("builds reports key with status", () => {
      expect(queryKeys.admin.reports(0, "pending")).toEqual(["admin", "reports", 0, "pending"])
    })

    it("builds reports key without status", () => {
      expect(queryKeys.admin.reports(0)).toEqual(["admin", "reports", 0, ""])
    })

    it("builds alerts key", () => {
      expect(queryKeys.admin.alerts()).toEqual(["admin", "alerts"])
    })

    it("builds settings key", () => {
      expect(queryKeys.admin.settings()).toEqual(["admin", "settings"])
    })

    it("builds userTransactions key", () => {
      expect(queryKeys.admin.userTransactions("u1")).toEqual(["admin", "user-transactions", "u1"])
    })
  })
})
