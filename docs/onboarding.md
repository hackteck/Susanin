# The first visit

Readers did not recognise the header's panel glyph as something to press. On a
phone that button is the *only* way to the routes, the trip planner and the
filter, so not pressing it means never seeing three quarters of the app.

Three things answer that: the icon is now the three lines of a menu, a first
visit is offered a quick tour, and on a phone the button is ringed until it has
been used. `stores/onboarding.ts` holds all of it;
`components/onboarding/` draws it.

- **The offer waits for the map.** `WelcomeDialog` opens on `/` and nowhere
  else. A first visit almost always lands there, and the one that does not — a
  scanned code that opens a stop — has a reason for being on that page. The
  offer is not lost: the flag is only written once it has been answered, so it
  appears the first time the reader reaches the map. The ✕, Escape and a click
  outside all mean the same as "I'll look around".
- **The tour is four stops**, in `stores/onboarding.ts`: the menu button, the
  planner, the route filter, the locate control. Targets are found by a
  `data-tour` attribute rather than by refs handed down — they sit in the
  header, in the sidebar's named router view and on the map page, so anything
  else means every page knowing about the tour, and `provide`/`inject` is out.
- **The two sidebar stops are kept next to each other** so the drawer slides
  open once and shut once. Interleaving them with the other two would open and
  close it twice for no reason. The last stop is on the map page, so the tour
  runs there or nowhere: leaving `/` ends it, and so does Escape.
- **A desktop panel the reader had collapsed is put back** when the tour ends.
  Opening it for a tour they asked for is fine; leaving it open afterwards is a
  change nobody asked for.
- **The ring outlives its explanation.** The bubble beside the ringed button can
  be waved away and does not come back that visit; the ring stays until the
  drawer has actually been opened, by the reader or by the tour. Being told what
  is behind a button is not the same as having found it. Only the ring is
  persisted (`menu-used`); the dismissal is not, so someone who closes the
  sentence in their first second is not left with an unexplained ring for ever.
- **The bubble is on the map only, the ring is everywhere.** A callout under the
  header covers the top of whatever is behind it — on the About page it sat
  squarely over the page's own title.

## Traps

- **An anchor can match more than once.** The sidebar is a per-route component
  behind a `<KeepAlive>`, so every page visited this session leaves its own copy
  teleported onto `<body>`. Measured: two planners, both 255px wide, both at
  x = -256 with the drawer shut. `useAnchorRect` takes the first match that
  `checkVisibility` accepts, not the first match.
- **Nothing pulses.** `_motion.scss` allows one looping animation in the whole
  app and it is the live one; a second heartbeat in the corner would compete
  with it. The ring is static, and the spotlight glides between stops while the
  bubble simply appears in its new place — the same "contents swap without
  animating" rule, one panel over.
- **The rAF loop is short-lived on purpose.** It re-measures only until whatever
  is moving has landed (the drawer slides for 200ms), then hands over to resize
  and scroll listeners. The hint can sit on screen for minutes, and measuring it
  sixty times a second for that long would keep a phone's compositor awake for
  nothing. Scroll is captured, since the sidebar's own `ScrollArea` is what
  scrolls and its event does not bubble.
- **The spotlight is one element, not four.** The ring and the dim are two
  shadows of the same box: boxes around a hole show their seams, and a scrim
  that dims the target too is not a spotlight. There is no blur to go with the
  tint — a box-shadow cannot blur what is behind it — and none is needed, since
  the ring is what separates here. The tint is a fixed neutral for the reason
  `@surstromming/backdrop` gives: a scrim that changed colour with the theme
  would stop reading as "the lights went down".
- **Resetting it** for a look: clear `welcome-seen` and `menu-used` from
  `localStorage`. The About page also has a "Quick tour" button, which is the
  only way back for a reader who waved the offer away.
