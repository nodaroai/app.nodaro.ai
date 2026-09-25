/**
 * Country picker for the Meta Ads node — the Ad Library's `country` filter
 * takes an ISO 3166-1 alpha-2 code or `ALL`. The names here are the English
 * display; other interface languages render the browser's own name for the code
 * (`countryDisplayName`), so no dictionary has to list countries. The "All
 * countries" entry is localized by the panel. UI data only — deliberately not
 * in `@nodaro/shared` (published).
 */
export const META_ADS_COUNTRIES: ReadonlyArray<{ readonly code: string; readonly name: string }> = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "IL", name: "Israel" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "NL", name: "Netherlands" },
  { code: "BE", name: "Belgium" },
  { code: "CH", name: "Switzerland" },
  { code: "AT", name: "Austria" },
  { code: "SE", name: "Sweden" },
  { code: "NO", name: "Norway" },
  { code: "DK", name: "Denmark" },
  { code: "FI", name: "Finland" },
  { code: "IE", name: "Ireland" },
  { code: "PT", name: "Portugal" },
  { code: "PL", name: "Poland" },
  { code: "CZ", name: "Czechia" },
  { code: "GR", name: "Greece" },
  { code: "TR", name: "Türkiye" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "IN", name: "India" },
  { code: "SG", name: "Singapore" },
  { code: "JP", name: "Japan" },
  { code: "KR", name: "South Korea" },
  { code: "PH", name: "Philippines" },
  { code: "ID", name: "Indonesia" },
  { code: "TH", name: "Thailand" },
  { code: "VN", name: "Vietnam" },
  { code: "MX", name: "Mexico" },
  { code: "BR", name: "Brazil" },
  { code: "AR", name: "Argentina" },
  { code: "CL", name: "Chile" },
  { code: "CO", name: "Colombia" },
  { code: "ZA", name: "South Africa" },
  { code: "NG", name: "Nigeria" },
  { code: "EG", name: "Egypt" },
  { code: "NZ", name: "New Zealand" },
]

export function metaAdsCountryName(code: string | undefined): string | undefined {
  return META_ADS_COUNTRIES.find((c) => c.code === code)?.name
}

const regionNamesByLocale = new Map<string, Intl.DisplayNames | null>()

/**
 * A country's name in the interface language: the English list above for
 * English, the browser's `Intl.DisplayNames` otherwise (日本 → "アメリカ合衆国").
 * Falls back to the English name where the browser has no name for the code.
 */
export function countryDisplayName(country: { readonly code: string; readonly name: string }, locale: string): string {
  if (locale === "en") return country.name
  if (!regionNamesByLocale.has(locale)) {
    let names: Intl.DisplayNames | null = null
    try {
      names = new Intl.DisplayNames([locale], { type: "region" })
    } catch {
      names = null
    }
    regionNamesByLocale.set(locale, names)
  }
  return regionNamesByLocale.get(locale)?.of(country.code) ?? country.name
}
