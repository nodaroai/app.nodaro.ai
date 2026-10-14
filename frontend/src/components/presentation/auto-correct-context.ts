import { createContext } from "react"

/**
 * Whether an app field card may correct a value on its own: snap a value the node's current model cannot take,
 * or move an unset field onto the publisher's first allowed value. On in a run (the app runner, the full-screen
 * presentation), where a correction is a run value. OFF in the editor's Present tab, where a write lands in the
 * saved node: a card shown there must not edit the workflow because a value looks stale.
 */
export const AutoCorrectContext = createContext(true)
