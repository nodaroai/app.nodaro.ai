/**
 * Address rules for the signed-in app (`DashboardLayout`), kept pure so they
 * can be tested without mounting the layout.
 */

/** The editor's pages: its full address, and the short `/editor/<id>` link
 *  that opens it (the sidebar starts collapsed on both). */
export function isEditorPath(pathname: string): boolean {
  return pathname.includes("/workflows/") || pathname.startsWith("/editor/")
}

/**
 * Where a signed-out visitor is sent. A link opened while signed out (the
 * editor link an assistant shares, an admin's link to a user) keeps its
 * destination through sign-in. A session that ends mid-use (signing out,
 * perhaps to let someone else in) starts the next sign-in fresh, because the
 * page it was on may belong to the previous account.
 */
export function loginPathFor(destination: string, wasSignedIn: boolean): string {
  return wasSignedIn ? "/login" : `/login?redirect=${encodeURIComponent(destination)}`
}
