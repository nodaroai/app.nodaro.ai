# Accessibility menu

Nodaro Cloud has an accessibility menu on every page: a round button in the
bottom corner, also opened with **Alt+A** from anywhere (never while you are
typing in a field). It changes how pages look for you:

- **Text size** — 100%, 115% or 130%.
- **Higher contrast** — secondary text and borders take the full text colour.
- **Inverted colours** — light and dark swap; photos, video and colour
  swatches keep their own colours.
- **Strong contrast** — yellow text on black, cyan links, and buttons black on
  yellow.
- Only one of the three contrast choices is on at a time: turning one on turns
  the others off.
- **Highlight links** and **highlight headings**.
- **Readable font** and **text spacing**. Code keeps its own font.
- **Large cursor**. A button you cannot use keeps its "not allowed" cursor.
- **Reduce motion** — animations finish at once. Your operating system's
  "reduce motion" setting is honoured too, with or without the menu.

On the workflow editor the canvas owns the corners, so the button is not shown
there and the canvas keeps its own text size; Alt+A still opens the menu. You
can also hide the button for one, three or six months; Alt+A keeps working, and
the menu offers to bring the button back early.

The menu links to Nodaro's accessibility statement, which explains how to
report a problem.

## One set of choices for every Nodaro product

Where the shared Nodaro header is on (a Nodaro Cloud build with
`VITE_SHARED_HEADER=true`, i.e. Nodaro Cloud once the header is rolled out),
your accessibility choices are one setting for every Nodaro product: the app,
Studio and the creative tools share one menu, and a choice made in one holds in
the next product you open. They are kept in your browser (a cookie on the
products' common domain), not in your account, so another browser or device
starts from the defaults. Without the shared header, the app's menu keeps your
choices in this browser for the app only.

The shared menu also lets you **move the button**: choose "Move the button",
then drag it, or move it with the arrow keys and press Enter. It stays where
you put it, on every screen size and in every product, until you press Reset
in that menu. The pages that show the app's own menu instead (sign-in, shared
links, published apps) keep its button in the corner; the place you chose
still holds wherever the shared menu is shown.

If you used the app's accessibility menu before it became shared, your earlier
choices are carried over the first time you open the app, if you haven't set
them on another Nodaro product yet — you don't need to choose them again.

## Self-hosted and white-label installs

A self-hosted install, or a white-label Cloud deployment, has its own operator
and no Nodaro statement, so the menu and the statement are not shown there.

## See also

- [Language Picker](./language-picker.md) — the interface language, which is
  also one choice for every Nodaro product on Nodaro Cloud.
