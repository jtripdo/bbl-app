// Labor from Square's time clock (Labor API timecards): hours and pay by day.
const { square, getLocations } = require("./square");
const { startOfDay, dayOf } = require("./backoffice");

const VERSION = "2025-10-16"; // timecard endpoints need 2025-05-21 or later

async function timecards(from, to) {
  const locs = await getLocations();
  const start = startOfDay(from).toISOString();
  const end = new Date(startOfDay(to).getTime() + 86400000).toISOString();
  const out = [];
  let cursor;
  let pages = 0;
  do {
    let data;
    try {
      data = await square("POST", "/labor/timecards/search", {
        query: { filter: { location_ids: locs.map((l) => l.id), start: { start_at: start, end_at: end } } },
        limit: 200, cursor,
      }, VERSION);
      out.push(...(data.timecards || []));
    } catch (e) {
      // Older accounts: same data under the old "shifts" name.
      if (!/404|NOT_FOUND|VERSION/i.test(e.message)) throw e;
      data = await square("POST", "/labor/shifts/search", {
        query: { filter: { location_ids: locs.map((l) => l.id), start: { start_at: start, end_at: end } } },
        limit: 200, cursor,
      });
      out.push(...(data.shifts || []));
    }
    cursor = data.cursor;
    pages++;
  } while (cursor && pages < 20);
  return out;
}

// Worked hours (minus unpaid breaks) × hourly rate. Open timecards count up to now.
function costOf(tc, now = Date.now()) {
  const s = Date.parse(tc.start_at);
  const e = tc.end_at ? Date.parse(tc.end_at) : now;
  let ms = Math.max(0, e - s);
  for (const b of tc.breaks || []) {
    if (b.is_paid) continue;
    const bs = Date.parse(b.start_at);
    const be = b.end_at ? Date.parse(b.end_at) : now;
    ms -= Math.max(0, be - bs);
  }
  const hours = Math.max(0, ms) / 3600000;
  const rate = ((tc.wage && tc.wage.hourly_rate) || {}).amount || 0;
  return { hours, cents: Math.round(hours * rate), missingRate: !rate };
}

async function labor(from, to) {
  const list = await timecards(from, to);
  const days = {};
  let missing = 0;
  for (const tc of list) {
    const k = dayOf(tc.start_at);
    const c = costOf(tc);
    const d = (days[k] = days[k] || { date: k, hours: 0, cents: 0, people: new Set() });
    d.hours += c.hours;
    d.cents += c.cents;
    d.people.add(tc.team_member_id || tc.employee_id);
    if (c.missingRate) missing++;
  }
  const arr = Object.values(days).map((d) => ({ date: d.date, hours: Math.round(d.hours * 100) / 100, cents: d.cents, people: d.people.size }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    days: arr,
    hours: Math.round(arr.reduce((a, d) => a + d.hours, 0) * 100) / 100,
    cents: arr.reduce((a, d) => a + d.cents, 0),
    open: list.filter((t) => !t.end_at).length,
    missingRates: missing,
  };
}

module.exports = { labor, costOf };
