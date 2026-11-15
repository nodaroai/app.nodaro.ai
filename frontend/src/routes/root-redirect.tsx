import { Navigate, useLocation } from "react-router-dom"
import { DEFAULT_SIGN_IN_PATH, failedSignInPath } from "@/lib/sign-in-redirect"
import { isBlockedCallback, isFailedCallback } from "@/lib/sign-in-error"

/**
 * The site's root address opens the projects. It is also where the auth server
 * returns a sign-in it could not match to a request (an expired one, or one
 * replayed by the browser's Back button), with the error on the address: that
 * goes to the sign-in page, which says the sign-in did not complete. A visitor
 * who is signed in after all goes straight on from there.
 */
export default function RootRedirect() {
  const { search, hash } = useLocation()
  if (isBlockedCallback(search, hash)) return <Navigate to="/login?blocked=1" replace />
  if (isFailedCallback(search, hash)) return <Navigate to={failedSignInPath(null)} replace />
  return <Navigate to={DEFAULT_SIGN_IN_PATH} replace />
}
