import { describe, expect, it } from "vitest"
import { shareOfUsers } from "../share-of-users"

describe("shareOfUsers", () => {
  it("is the count's share of all users, to one decimal", () => {
    expect(shareOfUsers(123, 1000)).toBe("12.3% of users")
    expect(shareOfUsers(1, 3)).toBe("33.3% of users")
    expect(shareOfUsers(2, 3)).toBe("66.7% of users")
    expect(shareOfUsers(0, 50)).toBe("0% of users")
    expect(shareOfUsers(50, 50)).toBe("100% of users")
  })

  it("says nothing when the count is unknown or there are no users", () => {
    expect(shareOfUsers(null, 1000)).toBeNull()
    expect(shareOfUsers(5, 0)).toBeNull()
  })
})
