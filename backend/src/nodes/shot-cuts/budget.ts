// Shot Cuts' job budget (a pure leaf; job-budget.ts composes it): the download,
// the probe and the scoring decode of the longest clip it takes (30 minutes),
// and the frames decode when frames are on — read off the queue payload.
import { shotCutsJobBudgetMs } from "../../providers/video/shot-cuts-plan.js"
import type { UnitBudget } from "../kit.js"

export const budget: UnitBudget = shotCutsJobBudgetMs
