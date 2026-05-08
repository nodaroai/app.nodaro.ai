import select from "@inquirer/select"
import input from "@inquirer/input"
import { stdin, stdout } from "node:process"

/**
 * Returns true when stdin AND stdout are both attached to a TTY — i.e. the
 * user can actually interact. False in CI, in pipes, in non-interactive shells.
 * Pickers must guard on this so scripts don't hang on a hidden prompt.
 */
export function isInteractive(): boolean {
  return Boolean(stdin.isTTY) && Boolean(stdout.isTTY)
}

interface PickItem<T> {
  name: string
  value: T
  description?: string
}

interface PickOpts<T> {
  message: string
  choices: PickItem<T>[]
  /** Cap visible rows per page; @inquirer auto-scrolls past this. */
  pageSize?: number
}

/**
 * Single-select list picker. Returns the chosen `value` (not the label).
 * Throws on user Ctrl-C — let the caller propagate or convert to exit 130.
 */
export async function pickFromList<T>(opts: PickOpts<T>): Promise<T> {
  return select({
    message: opts.message,
    choices: opts.choices,
    pageSize: opts.pageSize ?? 12,
    loop: false,
  })
}

interface AskOpts {
  message: string
  default?: string
  required?: boolean
}

/** Free-text prompt. Returns the user-typed string (trimmed). */
export async function ask(opts: AskOpts): Promise<string> {
  const value = await input({
    message: opts.message,
    default: opts.default,
    validate: (v) => {
      if (opts.required && !v.trim()) return "this field is required"
      return true
    },
  })
  return value.trim()
}
