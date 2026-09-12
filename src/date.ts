/** MVP deliberately uses the owner's configured Japan calendar, not the host timezone. */
export function tomorrow(now: number): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now));
  const date = new Date(`${today}T00:00:00+09:00`);
  date.setTime(date.getTime() + 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
export function postponedDate(due: string | undefined, now: number): string {
  const day = tomorrow(now);
  if (!due || !due.includes('T')) return day;
  if (/Z$|[+-]\d\d:\d\d$/.test(due)) {
    const clock = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Tokyo',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(due));
    return new Date(`${day}T${clock}+09:00`).toISOString().replace('.000Z', 'Z');
  }
  // Floating dates preserve their wall clock time; Todoist's account timezone must be Japan.
  const clock = due.split('T')[1].slice(0, 8);
  if (!/^\d\d:\d\d(?::\d\d)?$/.test(clock)) throw new Error('invalid_due');
  return `${day}T${clock.length === 5 ? clock + ':00' : clock}`;
}
