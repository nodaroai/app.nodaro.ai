import { tx, type MessageKey } from "@/lib/i18n"

/**
 * `Node "<label>": <message>` in the interface language — the one shape every
 * pre-run check of the node executors reports in.
 */
export function nodeRunText(label: string | undefined, message: string): string {
  return tx("nodeRun.nodeMessage", { label: label ?? "", message })
}

/** {@link nodeRunText} with the message from the dictionary. */
export function nodeRunError(
  label: string | undefined,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  return nodeRunText(label, tx(key, vars))
}
