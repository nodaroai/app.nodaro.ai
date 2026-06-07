# Community Library

The Community Library is an **admin-curated** catalog of shared characters,
locations, and objects. Admins publish assets from their own library into the
community; **any logged-in user** can browse the catalog and **clone** a listing
into their own library as an independent copy.

> **Editions:** Business and Cloud only. The community library is a multi-user
> feature — it is **not** available in the Community (single-user) edition. The
> backend gates every route behind a multi-user check, so the endpoints below
> return `404` on a Community-edition instance.

## What it is

- A **single shared catalog** spanning three asset kinds — `character`,
  `location`, and `object`.
- **Admins publish.** Only an admin can promote one of their own assets into the
  community catalog. There is no self-serve "publish my character" for regular
  users — publishing is an editor/admin action, deliberately kept out of the
  public API and SDK.
- **Everyone browses and clones.** Any authenticated user can search the
  catalog, favorite listings, and clone a listing into their own library.

## How cloning works

Cloning makes an **independent snapshot copy** in your library:

- The listing's assets (images, and any motion clips) are **copied into your own
  storage**, not referenced. The clone is a point-in-time snapshot.
- Because it is a copy, your clone **survives the original being changed or taken
  down**. Later edits to the source asset, or an admin un-publishing the
  listing, do not affect copies that users already made.
- The clone lands as a normal character / location / object in your library and
  is yours to rename, edit, regenerate, or delete.
- Clone names are de-duplicated against your existing library, so cloning a
  listing whose name collides with one of yours yields a `(copy)`-style unique
  name rather than failing.

## Safety, likeness, and consent

Be aware of what publishing exposes — this matters most for characters:

- **Published previews are public.** Every preview image on a listing is visible
  to **all logged-in users** of the instance.
- **For characters, the renders ARE the person's likeness.** A character's
  portrait, expressions, and pose renders depict that character's face. If a
  character is based on a real person, publishing it makes that person's
  likeness publicly browseable and cloneable.
- **Publishing requires an admin attestation.** Every publish action requires
  the admin to attest they have the rights to share the asset. For
  **characters**, an additional **likeness attestation** is mandatory: the admin
  confirms that any real person depicted has **consented** to the use and is
  **18 or older**. The backend rejects a character publish that does not carry
  this likeness attestation.
- **Anyone can report a listing.** Any logged-in user can report a listing for
  moderation. Reasons include **"depicts a real person without consent"**
  (`real_person_no_consent`), inappropriate content, IP violation, and other.
- **Admins take listings down.** Admins review the report queue and can take a
  listing down. A takedown deactivates the listing and resolves its open
  reports; the listing's preview blobs are purged. (Copies users already cloned
  are independent and are not affected.)

## Where it lives in the editor

- **Browse:** the Explore / Community page lists the catalog with search,
  category, style, and sort (newest or most-cloned).
- **Clone:** open a listing to preview its images, then clone it into your
  library.
- **Publish (admin):** the publish dialog is reached from a character, location,
  or object studio. Characters require checking the likeness attestation before
  the publish button enables.
- **Moderate (admin):** the admin reports queue shows open reports with a
  take-down action.

## Using it from code

The catalog is also reachable over REST and the TypeScript SDK:

- **REST** — see [API Integration → Community](./api-integration.md#community)
  for the user and admin endpoints (browse, detail, favorites, clone, favorite,
  report; and admin publish / delete / reports / takedown).
- **SDK** — see [SDK Reference → `client.community`](./sdk-reference.md#clientcommunity)
  for `browse` / `get` / `favorites` / `clone` / `favorite` / `report`.
  Publishing is **not** in the SDK by design (admin/editor-only).

## See also

- [Character Platform](./character-platform.md) — the character data model
- [Location Platform](./location-platform.md) — the location data model
- [Object Platform](./object-platform.md) — the object data model
- [API Integration](./api-integration.md) — REST endpoints
- [SDK Reference](./sdk-reference.md) — TypeScript client
