/**
 * A full page load to `path` on this site, replacing this page in the history
 * so Back skips the hop (the sign-in it came from). In its own module so a
 * test can stand in for it: jsdom cannot load another page.
 */
export function leaveTo(path: string): void {
  window.location.replace(path)
}
