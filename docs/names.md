# Names and languages

## The UI

- **Russian is the default.** A browser set to `ka` or `en` gets its own language.
- **Plurals go through `Intl.PluralRules`**, because Russian has three forms.
  Counted nouns also agree with what is selected: «на линии» for one route,
  «на линиях» for several or for all 28 (in Georgian, `ხაზზე`/`ხაზებზე`).
- **Numbers go through `Intl.NumberFormat`**, so Russian and Georgian show
  «2,6 км». A decimal point reads as a typo in both.
- **Georgian needs a font.** Geist has no Georgian letters, so the app loads
  `@fontsource-variable/noto-sans-georgian` and lists it after Geist in
  `--font-sans`.
- **A direction is shown as `→ terminal`**, never as "outbound" or "inbound".
  Riders go by destination, and Russian has no natural short pair for the two
  directions anyway.

## Stop names from the feed

`BusStopNameKA` is clean Georgian. `BusStopNameEN` is genuinely Latin for only
171 of 578 stops. The rest repeat the Georgian, often with the stop number in
front. So normalisation:

- strips a leading stop number;
- collapses whitespace;
- drops a `№` with no number after it;
- falls back to the Georgian when the "English" isn't Latin.

## Russian and English names come from OpenStreetMap

Transliteration gets the syllables right and the words wrong. It turned
`ანდრიაპირველწოდებული ქუჩა` into «Улица Андриапирвелцодебули», while the street
sign, Yandex and Google all say «Шоссе Андрея Первозванного».

OSM has real translations (`name:ru`, `name:en`) across Batumi, so
`tools/build-names.mjs` bakes them into `apps/api/src/domain/names.data.json`.
That is 176 street names covering all 578 poles.

The table is keyed by street, not by pole, because poles differ only by a
trailing house number. That number is put back afterwards, since it tells
someone which pole they are standing at, and for Russian it is transliterated
(Batumi numbers with Georgian letters, as in `№3ა`). The number is only matched
at the end of a name: a leading `№23` is part of a school's name.

### Traps

- **The feed writes the number two ways**, `№3` and `#3`; the `#` form is on 308
  of 578 poles. The lookup must normalise the same way the build does. Otherwise
  `#1(ავტოსადგური)` comes out as «…№1(автосадгури)». That is in Cyrillic
  letters, so the test that looks for Georgian script misses it. The test
  therefore checks the whole name.
- **The most common OSM spelling is not always the right one.** Some streets are
  tagged both with a translation and with a transliteration, and the
  transliteration can win on count. `წმინდა` means "saint", so the right name is
  «Святого Севериана», not «Цминда Севериане». Cases like this are hand entries
  in the build script. So are a few feed misspellings that would otherwise give
  one street two names. A test checks that both spellings give the same words.
- **Don't edit the JSON by hand.** Add a hand entry with its reason to the build
  script and re-run it.

## Transliteration is the fallback

`apps/api/src/domain/translit.ts` covers any name OSM has never mapped, so no
stop falls back to Georgian script. It maps 33 letters in one pass, and the
result is cached with the dataset. It merges the aspirated pairs (თ/ტ → т),
which is fine for this use.

It does translate a few nouns that recur everywhere. `ქუჩა` (street) is in 408
of 578 names, so «улица» is what makes the rest read as an address. It also
moves the street type to the front, as Russian expects, and drops the Georgian
genitive `ს` that the move leaves dangling: `ფრიდონ ხალვაშის ქუჩა` becomes
«Улица Фридон Халваши». Other words are sounded out, which is
readable but sometimes clumsy. That is an accepted cost.
