---
"@nodaro/sdk": patch
---

`client.library.list({ q })` also finds a generated song by its title: a word may match the file's name or the name the file is shown by (`metadata.name`), which a song's Library file now carries. The doc comments of `ListLibraryParams.q` and `LibraryResource` say so; no type changes.
