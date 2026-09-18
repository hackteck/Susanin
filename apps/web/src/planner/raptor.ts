import { firstTripFrom, tripTime, type PlannerNetwork } from './network.ts'

/**
 * RAPTOR (Delling, Pajor, Werneck 2012): round k finds the earliest arrival at
 * every stop using at most k buses, by scanning each line once per round rather
 * than a graph edge at a time. It suits this network exactly — trips on one
 * line never overtake one another, and the whole of Batumi is 56 patterns — and
 * the rounds are the transfer counts, which is the second thing a rider weighs
 * after the time.
 */

/**
 * Be at the stop a minute before the bus is due. The published times are whole
 * minutes and the walk to the stop is an estimate, so planning to arrive at the
 * exact minute is planning to watch it leave.
 */
export const BOARDING_SLACK = 1

/**
 * A change of bus gets three. The bus being left is the one that is late —
 * nothing on this feed says by how much — and a connection that only works if
 * it isn't is not one to send anybody to.
 */
export const TRANSFER_SLACK = 3

/** A stop reachable on foot from where the journey starts. */
export interface Access {
  stop: number
  minutes: number
  metres: number
}

const NONE = 0
const ACCESS = 1
const RIDE = 2
const TRANSFER = 3

export interface Labels {
  rounds: number
  /** [round][stop] — the earliest arrival with at most `round` buses, carried forward. */
  arrival: Float64Array[]
  /** [round][stop] — how that arrival was made, set only in the round that made it. */
  kind: Uint8Array[]
  /** RIDE: pattern; TRANSFER: the stop walked from. */
  a: Int32Array[]
  /** RIDE: trip. */
  b: Int32Array[]
  /** RIDE: position boarded at. */
  c: Int32Array[]
  /** RIDE: position alighted at. */
  d: Int32Array[]
  access: Map<number, Access>
}

export function search(network: PlannerNetwork, access: Access[], departAt: number, maxRides: number): Labels {
  const count = network.stops.length
  const rows = maxRides + 1
  const make = <T>(build: () => T) => Array.from({ length: rows }, build)

  const labels: Labels = {
    rounds: maxRides,
    arrival: make(() => new Float64Array(count).fill(Infinity)),
    kind: make(() => new Uint8Array(count)),
    a: make(() => new Int32Array(count)),
    b: make(() => new Int32Array(count)),
    c: make(() => new Int32Array(count)),
    d: make(() => new Int32Array(count)),
    access: new Map(),
  }

  /** τ* — the best arrival at each stop over every round so far. */
  const best = new Float64Array(count).fill(Infinity)
  let marked = new Set<number>()

  for (const entry of access) {
    const arrival = departAt + entry.minutes
    if (arrival >= labels.arrival[0]![entry.stop]!) continue
    labels.arrival[0]![entry.stop] = arrival
    labels.kind[0]![entry.stop] = ACCESS
    labels.access.set(entry.stop, entry)
    best[entry.stop] = arrival
    marked.add(entry.stop)
  }

  for (let round = 1; round <= maxRides && marked.size; round++) {
    const previous = labels.arrival[round - 1]!
    const current = labels.arrival[round]!
    current.set(previous)

    // Each line is scanned once, from the earliest of its stops that changed.
    const queue = new Map<number, number>()
    for (const stop of marked) {
      for (const { pattern, position } of network.servedBy[stop]!) {
        if (!network.patterns[pattern]!.timed) continue
        const earliest = queue.get(pattern)
        if (earliest === undefined || position < earliest) queue.set(pattern, position)
      }
    }

    const improved = new Set<number>()

    for (const [patternIndex, start] of queue) {
      const pattern = network.patterns[patternIndex]!
      let trip = -1
      let boardedAt = -1
      /** Minutes between reaching the boarding stop and the bus being due there. */
      let boardedSlack = 0

      for (let position = start; position < pattern.stops.length; position++) {
        const stop = pattern.stops[position]!

        if (trip >= 0) {
          const arrival = tripTime(pattern, trip, position)
          if (arrival < best[stop]!) {
            current[stop] = arrival
            best[stop] = arrival
            labels.kind[round]![stop] = RIDE
            labels.a[round]![stop] = patternIndex
            labels.b[round]![stop] = trip
            labels.c[round]![stop] = boardedAt
            labels.d[round]![stop] = position
            improved.add(stop)
          }
        }

        // Reached here with one bus fewer: an earlier trip may be catchable.
        const here = previous[stop]!
        if (here === Infinity) continue
        const ready = here + (round === 1 ? BOARDING_SLACK : TRANSFER_SLACK)
        if (trip >= 0 && ready > tripTime(pattern, trip, position)) continue
        const catchable = firstTripFrom(pattern, position, ready)
        if (catchable < 0) continue
        const slack = tripTime(pattern, catchable, position) - here

        if (trip < 0 || catchable < trip) {
          trip = catchable
          boardedAt = position
          boardedSlack = slack
          continue
        }

        // The same bus, catchable here as well as where the scan first met it.
        // Plain RAPTOR keeps the first stop, which is arbitrary — and measured,
        // it sent a reader on a 14-minute walk to board line 10 one stop before
        // a pole 7 minutes away that the same bus reached a minute later. For the
        // first bus the better stop is the one that lets the reader leave home
        // latest, which is the one with the most time to spare, since that time
        // is spent at home; for a change of bus it is the one with the least
        // waiting at the kerb.
        if (catchable === trip && (round === 1 ? slack > boardedSlack : slack < boardedSlack)) {
          boardedAt = position
          boardedSlack = slack
        }
      }
    }

    // Changes of bus on foot. Only from stops a bus reached this round: walking
    // on from a stop reached on foot is one walk, not two.
    const walked = new Set<number>()
    for (const stop of improved) {
      // A stop first reached by bus and then beaten by someone walking in from
      // a neighbour is a walked-to stop now, and does not walk on again.
      if (labels.kind[round]![stop] !== RIDE) continue
      for (const path of network.footpaths[stop]!) {
        const arrival = current[stop]! + path.minutes
        if (arrival >= best[path.stop]!) continue
        current[path.stop] = arrival
        best[path.stop] = arrival
        labels.kind[round]![path.stop] = TRANSFER
        labels.a[round]![path.stop] = stop
        walked.add(path.stop)
      }
    }

    marked = new Set([...improved, ...walked])
  }

  return labels
}

export type RawLeg =
  | { kind: 'access'; stop: number; minutes: number; metres: number }
  | { kind: 'ride'; pattern: number; trip: number; board: number; alight: number }
  | { kind: 'transfer'; from: number; to: number; minutes: number; metres: number }

/** True when `stop` was reached by a bus in exactly this round. */
export const rodeTo = (labels: Labels, round: number, stop: number) => labels.kind[round]![stop] === RIDE

/**
 * The legs that produced a label, oldest first. A label carried forward from an
 * earlier round has no parent of its own, so the walk back steps down until it
 * finds the round that set it.
 */
export function trace(network: PlannerNetwork, labels: Labels, round: number, stop: number): RawLeg[] | null {
  const legs: RawLeg[] = []
  let at = stop
  let level = round

  // Bounded: every step either lowers the round or follows a transfer, and a
  // transfer is always followed by the ride that reached its start.
  for (let guard = 0; guard < 4 * (labels.rounds + 1) + 4; guard++) {
    while (level > 0 && labels.kind[level]![at] === NONE) level--
    const kind = labels.kind[level]![at]

    if (kind === ACCESS) {
      const entry = labels.access.get(at)
      if (!entry) return null
      legs.unshift({ kind: 'access', stop: at, minutes: entry.minutes, metres: entry.metres })
      return legs
    }

    if (kind === TRANSFER) {
      const from = labels.a[level]![at]!
      const path = network.footpaths[from]!.find((candidate) => candidate.stop === at)
      if (!path) return null
      legs.unshift({ kind: 'transfer', from, to: at, minutes: path.minutes, metres: path.metres })
      at = from
      continue
    }

    if (kind === RIDE) {
      const pattern = labels.a[level]![at]!
      const board = labels.c[level]![at]!
      legs.unshift({ kind: 'ride', pattern, trip: labels.b[level]![at]!, board, alight: labels.d[level]![at]! })
      at = network.patterns[pattern]!.stops[board]!
      level--
      continue
    }

    return null
  }

  return null
}
