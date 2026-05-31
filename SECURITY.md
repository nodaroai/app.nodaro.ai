# Security Policy

We take the security of Nodaro and its users seriously. Thank you for helping
keep the project and its community safe.

## Supported versions

Security fixes are applied to the latest release on the `main` branch. We do not
backport fixes to older tags. Self-hosters should track `main` (or the most
recent release) to receive security updates.

| Version            | Supported |
| ------------------ | --------- |
| `main` (latest)    | ✅        |
| Older tags / `dev` | ❌        |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, report privately through either channel:

1. **GitHub Private Vulnerability Reporting** (preferred) — go to the
   **Security** tab of this repository and click **"Report a vulnerability"**.
   This opens a private advisory visible only to you and the maintainers.
2. **Email** — `security@nodaro.ai`. Please include enough detail to reproduce
   (affected endpoint/file, steps, impact, and any proof-of-concept).

If you do not receive an acknowledgement within **3 business days**, please
follow up — a missed report is always our fault, not yours.

## What to expect

- **Acknowledgement** within 3 business days.
- An initial assessment and severity triage within 7 days.
- We will keep you informed of remediation progress and coordinate a disclosure
  timeline with you. We aim to ship a fix for high-severity issues within 30
  days.
- With your permission, we are happy to credit you in the advisory once a fix
  is released.

## Scope

This policy covers the source code in this repository (backend, frontend, SDK
packages, infrastructure config). For vulnerabilities in the hosted product at
`nodaro.ai`, the same `security@nodaro.ai` contact applies.

Out of scope: findings that require a compromised host or physical access,
denial-of-service via resource exhaustion, vulnerabilities in third-party AI
providers, and reports generated solely by automated scanners without a
demonstrable, exploitable impact.

## Safe harbor

We will not pursue legal action against researchers who act in good faith,
avoid privacy violations and data destruction, and give us a reasonable
opportunity to remediate before public disclosure.
