# Arrival estimates

The feed has live GPS and a static timetable, and nothing in between. Every
"N min" in the app is ours. We project the bus onto its route line and time the
distance left to the stop. The figure is labelled as an estimate everywhere, with
the scheduled time beside it.

Five rules keep the figure honest. Each one fixes a way the simple version was
wrong:

1. **It counts down, never up.** The API sends `arrivesAt` as a moment in time,
   and the client ticks against a shared one-second clock. A revision that brings
   the bus closer is shown at once. A worse one is eased in at α = 0.25
   (`ratchet`).
2. **Stops on the way cost time.** Each stop between the bus and the reader adds
   a dwell.
3. **Time spent standing still is added.** Otherwise the 10 km/h speed floor
   would claim a stopped bus covers 167 m a minute. After 5 minutes stopped, the
   estimate is withdrawn.
4. **A bus that has already passed is not coming.** Distance is never measured
   round the loop. Routes are there-and-back, so wrapping round would turn "left
   a minute ago" into "arriving in 40 minutes".
5. **Poor geometry publishes nothing.** On a leg where stops sit more than 120 m
   from the line (median; 5 m is typical), there is no estimate.

A measured speed is capped at 45 km/h.

**Uncertainty is shown with one mark, `≈`.** It means we can see the bus but
can't time it: it is barely moving, or we haven't watched it long enough to know
its speed. There is no ± range, because that would need an error distribution we
don't have.

At midday with a warm tracker, 20% of estimates carry the `≈`. A freshly started
process marks every estimate until it has watched the fleet move. On serverless,
every cold instance starts that way.
