import type { UnitBudget } from "../kit.js"

export const budget: UnitBudget = (data) => (data && typeof data === "object" && "videoUrl" in data ? 60_000 : undefined)
