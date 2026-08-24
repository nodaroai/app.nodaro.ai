# Language picker

Nodaro's editor interface (menus, buttons, labels, and the parameter picker
catalogs) can be shown in a language other than English. The **language
switcher** lives at the bottom of the app sidebar, next to the theme toggle.

## What it changes

One choice controls two things at once:

- **App chrome** — the interface itself: navigation, buttons, dialogs, and
  other UI text.
- **Picker catalogs** — the option labels inside parameter pickers like Mood,
  Framing, and Lens.

There's no separate setting for each; picking a language updates both.

## Supported languages

- English
- Arabic
- German
- Spanish
- French
- Hebrew
- Hindi
- Japanese
- Korean
- Portuguese (Brazil)
- Russian
- Chinese (Simplified)

## Translation coverage

Translation is rolled out incrementally, and coverage varies by language and
by area of the app. Any text that isn't translated yet in your chosen
language falls back to English automatically — you'll never see a blank
label. It's expected that some languages are fully translated in one area
(for example, the picker catalogs) while still showing English text in
another (for example, the app chrome), and that this improves over time as
more translations ship.

Right-to-left languages (like Arabic and Hebrew) render their own text
correctly, but the overall page layout doesn't mirror yet.

## Where your choice is saved

When you're signed in, changing your language saves it to your account, so it
follows you across devices. Before signing in, your choice is remembered
locally on that device. When you sign in, your account's saved language takes
over if you have one; if you don't, your local choice stays active on that
device — but it isn't written to your account until you change the language
while signed in.

## See also

- [Picker Catalogs](./picker-catalogs.md)
