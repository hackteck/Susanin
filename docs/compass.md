# Compass beam

The blue wedge on the "you are here" dot shows which way the phone is facing.
It only appears after a real compass reading arrives. A laptop never gets one, so
it shows no beam rather than a beam pointing north.

## Where the heading comes from

| Platform | Source | Permission |
|---|---|---|
| Android (Chrome, WebView) | `deviceorientationabsolute` | none |
| iOS | `webkitCompassHeading` | asked on the locate button |
| Desktop | none | — |

iOS only lets a page ask for motion access during a tap. The locate button is that
tap. If the reader refuses, only the beam is lost.

## Traps

- **Both platforms report magnetic north, and the map is drawn to true north.**
  We add 6.9°, which is Batumi's declination (WMM-2025; it drifts by about
  0.02° a year). Some articles say iOS is already true north. WebKit's source
  says it is `magneticHeading`.
- **Don't use `360 − alpha`.** It works while the phone lies flat. It goes
  wrong when the phone is held upright to look down a street. We compute the
  heading from the full rotation instead.
- **In landscape**, the top of the screen is a side of the phone, so the screen
  angle is added to the heading.
- **The sensors only report on a secure origin.** A phone that opens the dev
  server at `http://192.168…` gets no readings. Test through Chrome's USB port
  forwarding (the phone opens `localhost`), or on a deploy.

## Drawing

- The beam is drawn above the stops, below the buses, with the dot on top.
  That way a nearby bus keeps its own colour.
- It is wide and soft, not an arrow, because a phone compass on a city
  street is off by tens of degrees.
- Readings are smoothed in JS and written once a frame. There is no CSS
  transition, because a transition would make the beam lag behind the phone.

Code: `apps/web/src/sensors/compass.ts` (tested),
`apps/web/src/composables/useCompass.ts`, `TransitMap.vue`.
