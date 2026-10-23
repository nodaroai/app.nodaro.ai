import { Link } from "react-router-dom"
import { useT } from "@/lib/i18n"
import { ACCESSIBILITY_STATEMENT_PATH, accessibilityStatementShown } from "@/lib/accessibility-statement"

interface AccessibilityStatementLinkProps {
  readonly className?: string
  readonly role?: "menuitem"
  readonly onClick?: () => void
}

/**
 * The link to the accessibility statement, for every place that lists the
 * legal pages (sign-in, the sidebar, the account menu).
 * Renders nothing where the statement does not exist. The page itself is
 * Hebrew only; the link reads in the interface language.
 */
export function AccessibilityStatementLink({ className, role, onClick }: AccessibilityStatementLinkProps) {
  const t = useT()
  if (!accessibilityStatementShown()) return null
  return (
    <Link to={ACCESSIBILITY_STATEMENT_PATH} className={className} role={role} onClick={onClick}>
      {t("legal.accessibility")}
    </Link>
  )
}
