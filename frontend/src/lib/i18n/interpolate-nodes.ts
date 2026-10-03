import { Fragment, createElement, type ReactNode } from "react"

const PLACEHOLDER = /(\{\w+\})/
const PLACEHOLDER_NAME = /^\{(\w+)\}$/

/**
 * Fill a translated template with React nodes.
 *
 * `translate()` fills placeholders with strings only, so a sentence with a bold
 * figure or a link inside it used to be built from fragments around the
 * element, with the spaces between them fixed in code for every language. With
 * this the sentence stays ONE key and each language places the element and the
 * spacing around it (Korean attaches a counter to its number: 4회):
 *
 *   interpolateNodes(t("credits.balanceEnoughFor.other"), { n: <strong>{n}</strong>, … })
 *
 * The placeholder syntax and the fallback match `translate()`: a `{name}` with
 * no value is left as written. The pieces are separate children of one
 * Fragment, so they need no keys.
 */
export function interpolateNodes(template: string, values: Readonly<Record<string, ReactNode>>): ReactNode {
  const pieces = template
    .split(PLACEHOLDER)
    .filter((piece) => piece !== "")
    .map((piece) => {
      const name = PLACEHOLDER_NAME.exec(piece)?.[1]
      return name !== undefined && Object.hasOwn(values, name) ? values[name] : piece
    })
  return createElement(Fragment, null, ...pieces)
}
