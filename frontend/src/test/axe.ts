import axe from "axe-core"

/**
 * The accessibility checks the Israeli standard asks for (SI 5568, WCAG 2.0 A
 * and AA), run by axe on a rendered container. Colour contrast is off: jsdom
 * cannot compute rendered colours, so it is checked in a real browser instead.
 * Returns one line per violation (rule id and the elements it hit), so a
 * failing test names what to fix.
 */
export async function axeViolations(container: Element): Promise<string[]> {
  const result = await axe.run(container, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    rules: { "color-contrast": { enabled: false } },
  })
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)
}
