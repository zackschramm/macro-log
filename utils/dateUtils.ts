/**
 * Return a YYYY-MM-DD string in the device's LOCAL timezone.
 *
 * DO NOT use `new Date().toISOString().split('T')[0]` – that extracts the UTC
 * date, which is one day ahead of local time for users in UTC-negative zones
 * (US timezones) after ~5–8 PM.
 *
 * getFullYear / getMonth / getDate are all local-time methods, so this is safe.
 */
export function toLocalDateString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
