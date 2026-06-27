type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const DATE_TIME_PATTERNS = [
  /(20\d{2})[-_. ]?([01]\d)[-_. ]?([0-3]\d)\D+([0-2]\d)\D+([0-5]\d)\D+([0-5]\d)/,
  /(20\d{2})[-_. ]?([01]\d)[-_. ]?([0-3]\d)\D*([0-2]\d)([0-5]\d)([0-5]\d)/
];
const formattersByTimeZone = new Map<string, Intl.DateTimeFormat>();

export function parsePhotoDateTimeFromFilename(
  filename: string | null | undefined,
  timeZone = 'Europe/Warsaw'
): Date | null {
  if (!filename) {
    return null;
  }

  const decoded = safeDecodeURIComponent(filename);
  for (const pattern of DATE_TIME_PATTERNS) {
    const match = decoded.match(pattern);
    if (!match) {
      continue;
    }

    const parts = readDateTimeParts(match);
    if (parts) {
      return zonedTimeToUtc(parts, timeZone);
    }
  }

  return null;
}

function readDateTimeParts(match: RegExpMatchArray): DateTimeParts | null {
  const parts = {
    year: Number.parseInt(match[1], 10),
    month: Number.parseInt(match[2], 10),
    day: Number.parseInt(match[3], 10),
    hour: Number.parseInt(match[4], 10),
    minute: Number.parseInt(match[5], 10),
    second: Number.parseInt(match[6], 10)
  };

  if (
    !Number.isFinite(parts.year)
    || parts.month < 1
    || parts.month > 12
    || parts.day < 1
    || parts.day > daysInMonth(parts.year, parts.month)
    || parts.hour < 0
    || parts.hour > 23
    || parts.minute < 0
    || parts.minute > 59
    || parts.second < 0
    || parts.second > 59
  ) {
    return null;
  }

  return parts;
}

function zonedTimeToUtc(parts: DateTimeParts, timeZone: string): Date {
  const localTimestamp = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  let date = new Date(localTimestamp);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offsetMs = getTimeZoneOffsetMs(date, timeZone);
    const adjusted = new Date(localTimestamp - offsetMs);
    if (adjusted.getTime() === date.getTime()) {
      return adjusted;
    }

    date = adjusted;
  }

  return date;
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const values = new Map(
    getFormatter(timeZone)
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );
  const asUtc = Date.UTC(
    Number(values.get('year')),
    Number(values.get('month')) - 1,
    Number(values.get('day')),
    Number(values.get('hour')),
    Number(values.get('minute')),
    Number(values.get('second'))
  );

  return asUtc - date.getTime();
}

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  const existing = formattersByTimeZone.get(timeZone);
  if (existing) {
    return existing;
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone,
    year: 'numeric'
  });
  formattersByTimeZone.set(timeZone, formatter);

  return formatter;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
