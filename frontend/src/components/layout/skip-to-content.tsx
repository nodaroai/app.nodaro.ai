import { useT } from "@/lib/i18n"

/**
 * "Skip to content" (WCAG 2.4.1): the first Tab stop of a page with repeated
 * blocks before its content, hidden until focused. It moves focus by script to
 * the page's `<main id="main" tabIndex={-1}>`, so the address gains no #main
 * and Back is unchanged.
 */
export function SkipToContent() {
  const t = useT()
  return (
    <a
      href="#main"
      onClick={(event) => {
        event.preventDefault()
        document.getElementById("main")?.focus()
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-lg focus:outline focus:outline-2 focus:outline-[#ff0073]"
    >
      {t("a11y.skipToContent")}
    </a>
  )
}
