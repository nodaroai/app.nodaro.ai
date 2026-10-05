---
"@nodaro/shared": patch
"@nodaro/cli": patch
---

A LinkedIn account can be a person's profile (`linkedin.com/in/…`) as well as a company page: the `SocialSearchMode` and `SocialSearchRequest.query` docs say so, and `nodaro competitors add --linkedin` describes the field as a company page or person's profile. No types change.
