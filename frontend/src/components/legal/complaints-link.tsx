import { Link } from "react-router-dom"
import { useT } from "@/lib/i18n"
import { COMPLAINTS_PAGE_PATH, complaintsLinkShown } from "@/lib/complaints-page"

interface ComplaintsLinkProps {
  readonly className?: string
  readonly role?: "menuitem"
  readonly onClick?: () => void
}

/**
 * The link to the public complaints form, for every place that lists the
 * legal pages (sign-in, the sidebar, the account menu). Renders nothing where
 * no case could be handled (lib/complaints-page.ts).
 */
export function ComplaintsLink({ className, role, onClick }: ComplaintsLinkProps) {
  const t = useT()
  if (!complaintsLinkShown()) return null
  return (
    <Link to={COMPLAINTS_PAGE_PATH} className={className} role={role} onClick={onClick}>
      {t("legal.complaints")}
    </Link>
  )
}
