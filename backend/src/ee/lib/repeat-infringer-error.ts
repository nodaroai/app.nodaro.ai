import type { BlockRefusal } from "./account-blocking.js"

/**
 * A refusal of a move on an account's record (repeat-infringers.ts). Its own
 * module, so the routes' shared error answer (complaint-route-errors.ts)
 * reads it without loading the moves and everything they reach.
 */
export type RepeatInfringerErrorCode =
  | "not_found"
  | "unavailable"
  | "unverified"
  | "no_account"
  | "case_moved"
  | "already_recorded"
  | "withdrawn"
  | "in_force"
  | "lifted"
  | "ended"
  | "warning_stands"
  | "departure_required"
  | "days_required"
  | "not_supported"
  | BlockRefusal

export class RepeatInfringerError extends Error {
  constructor(
    readonly code: RepeatInfringerErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "RepeatInfringerError"
  }
}
