/**
 * Public mail providers: domains that millions of unrelated people share.
 *
 * The free-grant gate's "one grant per organisation" rule keys an account by
 * its organisation — Google's `hd` claim, else the email's domain — and must
 * never treat one of these as an organisation, or the second person on earth
 * with a @yahoo.com Google account would be refused the grant.
 *
 * This is the compiled default; an admin ADDS to it at runtime through the
 * `signup_grant_public_email_domains` setting (signup-grant-config.ts) — a
 * provider missed here otherwise refuses every second signup from a whole
 * market until a deploy. Lower-case, exact match on the whole domain.
 */
export const PUBLIC_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  // Google
  "gmail.com",
  "googlemail.com",
  // Microsoft
  "hotmail.com", "hotmail.co.uk", "hotmail.fr", "hotmail.de", "hotmail.it", "hotmail.es", "hotmail.com.br",
  "outlook.com", "outlook.co.uk", "outlook.fr", "outlook.de", "outlook.es", "outlook.jp", "outlook.com.br",
  "live.com", "live.co.uk", "live.fr", "live.de", "live.nl", "live.com.au", "msn.com",
  // Yahoo
  "yahoo.com", "yahoo.co.uk", "yahoo.co.jp", "yahoo.fr", "yahoo.de", "yahoo.es", "yahoo.it", "yahoo.com.br",
  "yahoo.co.in", "yahoo.ca", "yahoo.com.au", "ymail.com", "rocketmail.com",
  // Apple
  "icloud.com", "me.com", "mac.com",
  // Privacy mail
  "protonmail.com", "proton.me", "pm.me", "tutanota.com", "tuta.io", "tuta.com", "duck.com", "duckduckgo.com",
  "fastmail.com", "fastmail.fm", "hey.com", "zoho.com", "zohomail.com", "mail.com", "aol.com",
  // Germany / Austria / Switzerland
  "gmx.com", "gmx.de", "gmx.net", "gmx.at", "gmx.ch", "web.de", "t-online.de", "freenet.de", "posteo.de",
  "bluewin.ch", "sunrise.ch", "a1.net", "chello.at",
  // Russia / Ukraine / Bulgaria
  "mail.ru", "bk.ru", "inbox.ru", "list.ru", "yandex.ru", "yandex.com", "ya.ru", "rambler.ru",
  "ukr.net", "i.ua", "abv.bg", "mail.bg",
  // Korea
  "naver.com", "daum.net", "hanmail.net", "nate.com", "kakao.com",
  // China
  "qq.com", "163.com", "126.com", "sina.com", "sina.cn", "sohu.com", "foxmail.com", "139.com", "aliyun.com",
  "yeah.net", "2925.com", "icloud.com.cn",
  // Japan
  "docomo.ne.jp", "ezweb.ne.jp", "softbank.ne.jp", "nifty.com", "biglobe.ne.jp",
  // Brazil
  "uol.com.br", "bol.com.br", "terra.com.br", "ig.com.br", "globo.com",
  // Israel
  "walla.co.il", "walla.com", "012.net.il", "013.net", "bezeqint.net", "netvision.net.il",
  // France / Italy / Spain
  "orange.fr", "wanadoo.fr", "free.fr", "laposte.net", "sfr.fr", "libero.it", "virgilio.it", "tiscali.it", "alice.it",
  "telefonica.net",
  // Czech / Poland / India
  "seznam.cz", "centrum.cz", "wp.pl", "o2.pl", "onet.pl", "interia.pl", "rediffmail.com",
  // North America ISPs
  "comcast.net", "att.net", "verizon.net", "sbcglobal.net", "cox.net", "bellsouth.net", "charter.net",
  "shaw.ca", "rogers.com", "sympatico.ca", "videotron.ca",
  // UK / Australia / NZ / Benelux / Nordics
  "btinternet.com", "sky.com", "virginmedia.com", "bigpond.com", "optusnet.com.au", "telstra.com", "xtra.co.nz",
  "ziggo.nl", "kpnmail.nl", "planet.nl", "home.nl", "telenet.be", "skynet.be", "telia.com",
])

/** Is this (lower-cased) domain a public mail provider, by the compiled list or the admin's additions? */
export function isPublicEmailDomain(domain: string, extra: ReadonlySet<string> = new Set()): boolean {
  const d = domain.trim().toLowerCase()
  return PUBLIC_EMAIL_DOMAINS.has(d) || extra.has(d)
}
