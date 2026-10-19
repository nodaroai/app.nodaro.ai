// Speaker Map's job budget (a pure leaf; job-budget.ts composes it): each
// source's proxy steps and one whole-source decode, read off the queue payload.
import { speakerMapJobBudgetMs } from "../../providers/audio/speaker-map-budget.js"
import type { UnitBudget } from "../kit.js"

export const budget: UnitBudget = speakerMapJobBudgetMs
