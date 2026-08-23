---
"@nodaro/cli": minor
---

`nodaro org` and `nodaro workspace`: organizations, members, invitations, join codes and the audit log from a terminal — and, the part that matters, a way to say which workspace a command acts in.

Three ways to say it, each beating the one below: `--workspace <id>` for one command, `NODARO_WORKSPACE` for a shell or a CI job, and `nodaro workspace use <id>` saved on the profile. `nodaro workspace current` reports which of the three decided, because an inherited environment variable otherwise looks exactly like a saved selection.

`nodaro org invite` prints one line per address and shows the invitation LINK for every address that could not be emailed — an install with no mail provider delivers nothing, and an invitation nobody can reach is worse than none.
