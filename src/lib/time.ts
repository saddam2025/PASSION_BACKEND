export const ACADEMY_TIME_ZONE = 'Africa/Cairo';

export function now(): Date {
  return new Date();
}

export function academyDateParts(date: Date): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: ACADEMY_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date).map(({ type, value }) => [type, value]),
  );
}

export function cairoDayRange(from?: string, to?: string): { from?: Date; to?: Date } {
  return {
    ...(from ? { from: cairoDayBoundary(from) } : {}),
    ...(to ? { to: new Date(cairoDayBoundary(addCalendarDay(to)).getTime() - 1) } : {}),
  };
}

function addCalendarDay(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + 1)).toISOString().slice(0, 10);
}

function cairoDayBoundary(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  const wallTime = Date.UTC(year!, month! - 1, day!);
  let utcTime = wallTime;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: ACADEMY_TIME_ZONE,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(utcTime)).map(({ type, value: part }) => [type, part]));
    const displayedWallTime = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    const adjustment = displayedWallTime - utcTime;
    if (adjustment === 0) break;
    utcTime = wallTime - adjustment;
  }
  return new Date(utcTime);
}
