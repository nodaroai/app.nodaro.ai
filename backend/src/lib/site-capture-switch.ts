/**
 * SITE_CAPTURE_ENABLED: unset, empty, or anything but "false" means on. A leaf
 * module with no imports, so the availability funnel (surface-deny.ts) can read
 * the switch without pulling in the config chain that many tests mock.
 */
export function parseSiteCaptureEnabled(value: string | undefined): boolean {
  return (value ?? "").trim().toLowerCase() !== "false"
}
