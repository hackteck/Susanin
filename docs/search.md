# Finding places and stops

The trip fields (`Откуда` / `Куда`) search addresses and named places, not stops.
Nobody's destination is a pole: it is a house, a hotel, a pharmacy or a village.

## The address table

`tools/build-places.mjs` harvests Batumi's houses, streets, places, districts and
villages from Overpass into `apps/web/src/places/places.data.json`. That is
16,694 houses on 1,247 streets, 4,046 places and 91 areas: 887 KB, or 192 KB
with brotli. The file is committed, so a deploy never depends on a volunteer
Overpass server. `places/search.ts` searches it on the device; it is plain
TypeScript, tested with `node --test`.

**Why not a geocoding API?** No public one can do this job. Nominatim's usage
policy forbids search-as-you-type. Photon's public instance refuses `lang=ru`
and answers Cyrillic queries with nothing: «Руставели 12» came back as a
"12th street" in a village.

**Houses spell their street differently from the street itself.** 3,650
addresses do: «შარაშიძე მიხეილის ქუჩა» on the houses against «მიხეილ შარაშიძის
ქუჩა» on the road, or «მე-3 შეს» against «III შესახვევი». The build matches a
house's spelling to a road near that house: same street type, same number, the
same words give or take a Georgian ending, within 400 m. 163 streets are still
known only from their houses, mostly in Chakvi.

## Matching a query

- **All three languages are searched at once**, because a reader of the Russian
  UI may type what the sign says in Georgian.
- **A house letter matches from any keyboard**: 12ა, 12а and 12a are the same.
  A number that is part of a street's name («26 Мая») is not taken as a house
  number. «ул.», «пр-т», "st" and «ქ.» count when they match and are ignored
  when they don't.
- **Three fallbacks rank below an exact match:**
  - Latin sound: «Хилтон» finds the Hilton. г, х and h count as one sound, so
    «Горизонт» finds "Horizon".
  - One typo is forgiven in words of five letters or more.
  - A place's OSM type has words in three languages, so «аптека» finds all 156
    pharmacies, which are named PSP and Aversi.
- **Place names without a Russian name (244 of them)** are translated when every
  word is in a small dictionary; «ჰორიზონტი» becomes «Горизонт», not
  «Хоризонти». If any word is unknown the whole name is sounded out, never half
  translated («Новый аптека»).

## Ranking

1. Villages and towns (Gonio is somewhere people go).
2. A street before its own lanes and dead ends.
3. Places with a Wikipedia article.
4. Everything else.
5. Batumi's districts, last: most are named after the avenues.

House numbers that merely start with what was typed come in house order. Ties go
to whatever is nearest the reader. Every row shows its address, or the district
or village it is in, so two Spar shops can be told apart.

## Behaviour

- **An empty field offers "my location" first**, then the ten places chosen most
  recently. Those are the only trip state kept between visits (`localStorage`,
  with names in all three languages). «Очистить историю» clears them.
- **The table loads when a field is first focused**, not with the page, and the
  service worker keeps it after that.
- **Choosing a place flies the map to it** and moves focus to the other field.
  If only the destination is chosen and location is already allowed, the start
  is filled with "my location". That never raises a permission prompt, and never
  happens when the destination is itself "my location".
- **Every stop can be an end of a trip**, through `Отсюда` / `Сюда` on its sheet
  and on its page. The stop page has a chip per route, which opens the map with
  only that route shown. On the map sheet, the route chip in each arrival row is
  the button (`selectable`).
- **Nearby** (`/nearby`) sorts stops by straight-line distance, up to 1.2 km, and
  says "straight-line". The walk time beside it uses the planner's model and
  rounding, so both screens give the same walk the same time.
- **Where a stop was opened from is app state, not history.** `stores/proximity`
  `origin` is `me` only when the stop came from the Nearby list. It drives the
  stop page's back row and is not saved.
