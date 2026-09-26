// Flow measurement, kept pure so it can be tested without a board.
//
// The board holds two dates. `Status entered` is overwritten on every
// automated status change, so it answers "how long has this sat where it is".
// `Start date` is written once, on first entry to the start status, and never
// overwritten, so it answers "when did work actually begin". Together they
// give cycle time without asking the API for status history it does not keep.

/** Whole days between two ISO dates, ignoring time of day. */
function daysBetween(fromISO, toISO) {
  if (!fromISO || !toISO) return null;
  const day = (s) => Date.UTC(...s.slice(0, 10).split('-').map(Number).map((n, i) => i === 1 ? n - 1 : n));
  const from = day(fromISO);
  const to = day(toISO);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / 86400000);
}

function median(numbers) {
  if (!numbers.length) return null;
  const s = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2 * 10) / 10;
}

function mean(numbers) {
  if (!numbers.length) return null;
  return Math.round(numbers.reduce((a, b) => a + b, 0) / numbers.length * 10) / 10;
}

/**
 * @param {object} args
 * @param {Array} args.items board items, already canonicalized
 * @param {string} args.today ISO date the report is for
 * @param {object} args.flow the flow block from board-standard.json
 * @param {number} args.windowDays how far back throughput and cycle time look
 */
function flowMetrics({ items, today, flow, windowDays = 7 }) {
  const withAge = items.map((i) => ({ ...i, days: daysBetween(i.statusEntered, today) }));
  const open = withAge.filter((i) => i.state !== 'CLOSED');

  // Work in progress, per person, across every status that counts as active.
  const wip = new Map();
  for (const i of open) {
    if (!flow.active.includes(i.status)) continue;
    for (const who of i.assignees.length ? i.assignees : ['unassigned']) {
      wip.set(who, (wip.get(who) || 0) + 1);
    }
  }

  // Active work that has not moved. An item sitting in In Review for a week is
  // the thing a standup should be about.
  const ageing = open
    .filter((i) => flow.active.includes(i.status))
    .filter((i) => i.days !== null && i.days >= flow.ageingDays)
    .sort((a, b) => b.days - a.days);

  // Everything the team is not working on because someone else owes them
  // something. Client Awaiting is the reason this report exists.
  const waiting = {};
  for (const status of flow.waiting) {
    waiting[status] = open
      .filter((i) => i.status === status)
      .sort((a, b) => (b.days ?? -1) - (a.days ?? -1));
  }

  // Delivered inside the window, by when it reached the done status.
  const finished = withAge.filter(
    (i) => i.status === flow.done && i.days !== null && i.days < windowDays);

  const cycles = finished
    .map((i) => ({ ...i, cycle: daysBetween(i.startDate, i.statusEntered) }))
    .filter((i) => i.cycle !== null && i.cycle >= 0)
    .sort((a, b) => b.cycle - a.cycle);

  const lengths = cycles.map((i) => i.cycle);

  return {
    today,
    windowDays,
    ageingDays: flow.ageingDays,
    wip: [...wip.entries()]
      .map(([who, count]) => ({ who, count }))
      .sort((a, b) => b.count - a.count || a.who.localeCompare(b.who)),
    ageing,
    waiting,
    throughput: finished.length,
    cycle: {
      measured: cycles.length,
      unmeasured: finished.length - cycles.length,
      mean: mean(lengths),
      median: median(lengths),
      slowest: cycles.slice(0, 3),
    },
  };
}

module.exports = { daysBetween, median, mean, flowMetrics };
