/**
 * The timetable's clock is Batumi's, whatever the reader's device thinks the
 * time zone is — someone planning tomorrow's trip from home before flying in
 * still means the bus at the stop.
 */
const batumiClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Tbilisi',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

/** Minutes after midnight in Batumi, with the seconds as a fraction. */
export function minutesInBatumi(instant: Date | number): number {
  const [hours, minutes, seconds] = batumiClock.format(instant).split(':').map(Number)
  return (hours ?? 0) * 60 + (minutes ?? 0) + (seconds ?? 0) / 60
}

/** Planner minutes back to "HH:MM"; past midnight wraps, and the caller says "tomorrow". */
export function clockLabel(minutes: number): string {
  const whole = ((Math.floor(minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}

export const isTomorrow = (minutes: number) => minutes >= 1440

/** "HH:MM" as typed into a time field, or null. */
export function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null
}

/**
 * A chosen clock time as planner minutes relative to now. A time more than half
 * an hour gone is taken to mean tomorrow's — nobody asks to leave at 07:00 at
 * ten at night meaning this morning — while a few minutes ago is still today,
 * because that is someone who took a moment to type.
 */
export function upcoming(clock: number, now: number): number {
  return clock < now - 30 ? clock + 1440 : clock
}
