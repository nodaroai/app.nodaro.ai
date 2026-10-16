import { Navigate, useLocation } from "react-router-dom"

/**
 * `/library` is the address client apps link to (`/library?job=…`,
 * `/library?asset=…`); the page itself lives at `/my-files`. A plain
 * `<Navigate>` drops the query, and the query is the whole link.
 */
export function LibraryRedirect() {
  const { search, hash } = useLocation()
  return <Navigate to={{ pathname: "/my-files", search, hash }} replace />
}
