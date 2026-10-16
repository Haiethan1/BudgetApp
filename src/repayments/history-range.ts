export function recentHistoryRange(now = new Date()) {
  const to = now.toISOString().slice(0, 10);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
  const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  start.setUTCDate(Math.min(now.getUTCDate(), lastDay));
  return { from: start.toISOString().slice(0, 10), to };
}
