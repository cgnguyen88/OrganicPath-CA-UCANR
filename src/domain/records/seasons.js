const pad = (n, width = 2) => String(n).padStart(width, '0');
const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const iso = (year, month, day) => `${pad(year, 4)}-${pad(month)}-${pad(Math.min(day, daysInMonth(year, month)))}`;
const inRange = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

/**
 * The growing season a date falls in, from the farm's season start (default Jan 1).
 * `end` is exclusive. A start day that does not exist in a month (Feb 30) is clamped to
 * that month's last day rather than rolling into the next month.
 *
 * @param {{ season_start_month?: number, season_start_day?: number } | null | undefined} farm
 * @param {string | Date} today ISO date (YYYY-MM-DD) or Date
 * @param {number} [offset] 0 = the season containing `today`, -1 = the one before it
 * @returns {{ start: string, end: string, label: string }}
 */
export function seasonRange(farm, today, offset = 0) {
  const month = inRange(farm?.season_start_month, 1, 12) ? farm.season_start_month : 1;
  const day = inRange(farm?.season_start_day, 1, 31) ? farm.season_start_day : 1;

  const todayIso = typeof today === 'string' ? today : today.toISOString().slice(0, 10);
  const todayYear = Number(todayIso.slice(0, 4));

  const startedYear = todayIso >= iso(todayYear, month, day) ? todayYear : todayYear - 1;
  const year = startedYear + offset;

  return { start: iso(year, month, day), end: iso(year + 1, month, day), label: String(year) };
}

/**
 * The local calendar date as YYYY-MM-DD. Unlike toISOString() this does not jump to
 * "tomorrow" in the evening for anyone west of UTC.
 * @param {Date} [now]
 * @returns {string}
 */
export function todayLocalIso(now = new Date()) {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
