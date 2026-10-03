# Language picker

Nodaro's editor interface (menus, buttons, labels, and the parameter picker
catalogs) can be shown in a language other than English. The **language
switcher** lives at the bottom of the app sidebar, next to the theme toggle.

## What it changes

One choice controls three things at once:

- **App chrome** — the interface itself: navigation, buttons, dialogs, and
  other UI text.
- **Picker catalogs** — the option labels inside parameter pickers like Mood,
  Framing, and Lens.
- **Dates, times and numbers** — written the way the chosen language writes
  them (in Hebrew, a date reads "24 בספט׳" rather than "Sep 24"; in Japanese,
  "9月24日"), not in your browser's locale. With English chosen, they keep your browser's regional
  format (an en-GB browser still shows "24/09/2026").
- **The Copilot's replies** — the Copilot answers in the language you have
  chosen. Node names, model names and other identifiers stay as they are, so
  the workflow it builds reads the same in every language.

There's no separate setting for each; picking a language updates all of them.

## Languages offered

The language menu lists only the languages whose interface translation is
complete, so that picking one gives you the whole app in that language —
never English menus around translated picker tiles:

- English
- Hebrew
- Japanese

More languages are on the way. The picker catalogs (Mood, Framing, Lens and
the rest) are already translated into Arabic, German, Spanish, French, Hindi,
Korean, Portuguese (Brazil), Russian and Chinese (Simplified); each of those
languages joins the menu as soon as its interface translation is complete (at
least 98% of the interface text), with no further action on your side.

## Translation coverage

Within an offered language, the rare string that is not translated yet falls
back to English automatically — you'll never see a blank label. Model,
provider and brand names (for example Kling, Suno, ElevenLabs) keep their
original spelling in every language.

Right-to-left languages (Hebrew today; Arabic once it is offered) mirror the
app's layout: the sidebar moves to the right and navigation, pages and panels
flip with it. Two areas intentionally keep their left-to-right layout in every
language: the workflow canvas (a workflow you share looks the same to
everyone, whatever language they read) and the visual picker grids (their
tiles keep the same order as the catalogs and tutorials).

If your account was set to a language before it was offered, that language
stays selected and remains listed in your menu, so you can keep it or switch;
new visitors are only ever detected into an offered language.

## Where your choice is saved

When you're signed in, changing your language saves it to your account, so it
follows you across devices. Before signing in, your choice is remembered
locally on that device. When you sign in, your account's saved language takes
over if you have one; if you don't, your local choice stays active on that
device — but it isn't written to your account until you change the language
while signed in.

## See also

- [Picker Catalogs](./picker-catalogs.md)
