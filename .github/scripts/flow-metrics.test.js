const test = require('node:test');
const assert = require('node:assert');
const { daysBetween, median, mean, flowMetrics } = require('./flow-metrics.js');

const FLOW = {
  start: 'In Progress',
  done: 'Done',
  active: ['In Progress', 'In Review'],
  waiting: ['Blocked', 'Client Awaiting'],
  ageingDays: 3,
};
const TODAY = '2026-09-09';

const item = (o) => ({
  number: 1, title: 't', status: 'In Progress', statusEntered: TODAY,
  startDate: null, assignees: [], state: 'OPEN', ...o,
});

test('days between two dates ignores the time of day', () => {
  assert.strictEqual(daysBetween('2026-09-01', '2026-09-09'), 8);
  assert.strictEqual(daysBetween('2026-09-09T23:59:00Z', '2026-09-10T00:01:00Z'), 1);
  assert.strictEqual(daysBetween('2026-09-09', '2026-09-09'), 0);
});

test('days between counts across a month and a year boundary', () => {
  assert.strictEqual(daysBetween('2026-01-30', '2026-02-02'), 3);
  assert.strictEqual(daysBetween('2025-12-30', '2026-01-02'), 3);
});

test('a missing date measures nothing rather than guessing', () => {
  assert.strictEqual(daysBetween(null, TODAY), null);
  assert.strictEqual(daysBetween(TODAY, undefined), null);
});

test('median and mean of an empty set are null, not zero', () => {
  assert.strictEqual(median([]), null);
  assert.strictEqual(mean([]), null);
});

test('median takes the midpoint of an even set', () => {
  assert.strictEqual(median([1, 2, 3, 4]), 2.5);
  assert.strictEqual(median([5, 1, 3]), 3);
});

test('work in progress counts every active status, not just one', () => {
  const m = flowMetrics({ today: TODAY, flow: FLOW, items: [
    item({ number: 1, status: 'In Progress', assignees: ['ana'] }),
    item({ number: 2, status: 'In Review', assignees: ['ana'] }),
    item({ number: 3, status: 'Backlog', assignees: ['ana'] }),
  ]});
  assert.deepStrictEqual(m.wip, [{ who: 'ana', count: 2 }]);
});

test('an unassigned active item is still counted, under unassigned', () => {
  const m = flowMetrics({ today: TODAY, flow: FLOW, items: [item({ assignees: [] })] });
  assert.deepStrictEqual(m.wip, [{ who: 'unassigned', count: 1 }]);
});

test('a closed item is not work in progress', () => {
  const m = flowMetrics({ today: TODAY, flow: FLOW, items: [
    item({ assignees: ['ana'], state: 'CLOSED' }),
  ]});
  assert.deepStrictEqual(m.wip, []);
});

test('ageing lists only active work past the threshold, oldest first', () => {
  const m = flowMetrics({ today: TODAY, flow: FLOW, items: [
    item({ number: 1, statusEntered: '2026-09-08' }),           // 1 day
    item({ number: 2, statusEntered: '2026-09-06' }),           // 3 days
    item({ number: 3, statusEntered: '2026-09-01' }),           // 8 days
    item({ number: 4, status: 'Backlog', statusEntered: '2026-01-01' }),
  ]});
  assert.deepStrictEqual(m.ageing.map((i) => i.number), [3, 2]);
  assert.strictEqual(m.ageing[0].days, 8);
});

test('the client queue is reported separately, longest wait first', () => {
  const m = flowMetrics({ today: TODAY, flow: FLOW, items: [
    item({ number: 1, status: 'Client Awaiting', statusEntered: '2026-09-07' }),
    item({ number: 2, status: 'Client Awaiting', statusEntered: '2026-08-10' }),
    item({ number: 3, status: 'Blocked', statusEntered: '2026-09-05' }),
  ]});
  assert.deepStrictEqual(m.waiting['Client Awaiting'].map((i) => i.number), [2, 1]);
  assert.strictEqual(m.waiting['Client Awaiting'][0].days, 30);
  assert.deepStrictEqual(m.waiting['Blocked'].map((i) => i.number), [3]);
});

test('a waiting item is reported however long it has been there', () => {
  const m = flowMetrics({ today: TODAY, flow: FLOW, items: [
    item({ number: 1, status: 'Client Awaiting', statusEntered: TODAY }),
  ]});
  assert.strictEqual(m.waiting['Client Awaiting'].length, 1,
    'the ageing threshold must not hide a fresh client wait');
});

test('throughput counts what reached done inside the window', () => {
  const m = flowMetrics({ today: TODAY, flow: FLOW, items: [
    item({ number: 1, status: 'Done', statusEntered: '2026-09-08', state: 'CLOSED' }),
    item({ number: 2, status: 'Done', statusEntered: '2026-08-01', state: 'CLOSED' }),
  ]});
  assert.strictEqual(m.throughput, 1);
});

test('cycle time measures start date to done, and reports what it could not', () => {
  const m = flowMetrics({ today: TODAY, flow: FLOW, items: [
    item({ number: 1, status: 'Done', statusEntered: '2026-09-08',
           startDate: '2026-09-02', state: 'CLOSED' }),                // 6
    item({ number: 2, status: 'Done', statusEntered: '2026-09-05',
           startDate: '2026-09-03', state: 'CLOSED' }),                // 2
    item({ number: 3, status: 'Done', statusEntered: '2026-09-04',
           startDate: null, state: 'CLOSED' }),                        // no start
  ]});
  assert.strictEqual(m.cycle.measured, 2);
  assert.strictEqual(m.cycle.unmeasured, 1);
  assert.strictEqual(m.cycle.mean, 4);
  assert.strictEqual(m.cycle.median, 4);
  assert.deepStrictEqual(m.cycle.slowest.map((i) => i.number), [1, 2]);
});

test('a done item whose start date is after it finished is not counted', () => {
  const m = flowMetrics({ today: TODAY, flow: FLOW, items: [
    item({ number: 1, status: 'Done', statusEntered: '2026-09-05',
           startDate: '2026-09-08', state: 'CLOSED' }),
  ]});
  assert.strictEqual(m.cycle.measured, 0);
  assert.strictEqual(m.cycle.unmeasured, 1);
});

test('an empty board reports nothing rather than throwing', () => {
  const m = flowMetrics({ today: TODAY, flow: FLOW, items: [] });
  assert.deepStrictEqual(m.wip, []);
  assert.deepStrictEqual(m.ageing, []);
  assert.strictEqual(m.throughput, 0);
  assert.strictEqual(m.cycle.mean, null);
  assert.deepStrictEqual(Object.keys(m.waiting), ['Blocked', 'Client Awaiting']);
});

test('the flow block shipped in this repository names real statuses', () => {
  const { standard, options, flow } = require('./board-vocab.js');
  const names = options('Status');
  const f = flow();
  for (const s of [f.start, f.done, ...f.active, ...f.waiting]) {
    assert.ok(names.includes(s), `${s} is not a Status option`);
  }
  assert.ok(standard().fields.some((x) => x.name === 'Status entered'));
});

// ---- the rendered report, which is what anyone actually reads
const { render } = require('./flow-report.js');
const { flowMetrics: fm } = require('./flow-metrics.js');

const rendered = (items) => render(
  fm({ items, today: TODAY, flow: FLOW }), 'example-org/proj-acme');

test('the report names the client queue even when it is empty', () => {
  const out = rendered([]);
  assert.match(out, /### Client Awaiting \(0\)/);
  assert.match(out, /_nothing waiting_/);
});

test('a client wait is reported with how long it has been waiting', () => {
  const out = rendered([item({
    number: 7, title: 'awaiting sign off', status: 'Client Awaiting',
    statusEntered: '2026-08-30', url: 'https://example.invalid/7',
  })]);
  assert.match(out, /#7.*awaiting sign off.*\*\*10 days\*\*/);
});

test('one day is not written as 1 days', () => {
  const out = rendered([item({
    number: 8, status: 'Blocked', statusEntered: '2026-09-08',
    url: 'https://example.invalid/8',
  })]);
  assert.match(out, /\*\*1 day\*\*/);
  assert.doesNotMatch(out, /1 days/);
});

test('cycle time says it is not measurable rather than showing zero', () => {
  const out = rendered([]);
  assert.match(out, /Cycle time, median \| not measurable yet/);
  assert.doesNotMatch(out, /\| 0 days \|/);
});

test('the report carries its marker so it can be found again', () => {
  assert.match(rendered([]), /<!-- pm:flow-report -->/);
});

test('delivery without a start date is disclosed, not silently dropped', () => {
  const out = rendered([item({
    number: 9, status: 'Done', statusEntered: '2026-09-08',
    startDate: null, state: 'CLOSED', url: 'https://example.invalid/9',
  })]);
  assert.match(out, /1 item delivered without a usable Start date/);
});

// ---- stamping, with a fake board
const { stampStatus } = require('./stamp-status.js');

const fakeBoard = ({ fields, started = null, fail = false }) => {
  const writes = [];
  return {
    writes,
    core: { info: () => {} },
    github: {
      graphql: async (q, vars) => {
        if (fail) throw new Error('Resource not accessible by integration');
        if (q.includes('fields(first: 60)')) {
          return { node: { fields: { nodes: fields } } };
        }
        if (q.includes('Start date') && q.includes('query')) {
          return { node: { started: started ? { date: started } : null } };
        }
        writes.push({ fieldId: vars.fieldId, date: vars.date });
        return { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'i' } } };
      },
    },
  };
};

const ALL_FIELDS = [
  { id: 'f-entered', name: 'Status entered', dataType: 'DATE' },
  { id: 'f-start', name: 'Start date', dataType: 'DATE' },
];

test('entering the start status stamps both dates', async () => {
  const b = fakeBoard({ fields: ALL_FIELDS });
  const w = await stampStatus({
    github: b.github, core: b.core, projectId: 'p', itemId: 'i',
    status: 'In Progress', startStatus: 'In Progress', today: TODAY });
  assert.deepStrictEqual(w, ['Status entered', 'Start date']);
  assert.deepStrictEqual(b.writes.map((x) => x.fieldId), ['f-entered', 'f-start']);
  assert.ok(b.writes.every((x) => x.date === TODAY));
});

test('a later move stamps only the status date', async () => {
  const b = fakeBoard({ fields: ALL_FIELDS });
  const w = await stampStatus({
    github: b.github, core: b.core, projectId: 'p', itemId: 'i',
    status: 'Done', startStatus: 'In Progress', today: TODAY });
  assert.deepStrictEqual(w, ['Status entered']);
});

test('returning to the start status never overwrites the original start', async () => {
  const b = fakeBoard({ fields: ALL_FIELDS, started: '2026-08-01' });
  const w = await stampStatus({
    github: b.github, core: b.core, projectId: 'p', itemId: 'i',
    status: 'In Progress', startStatus: 'In Progress', today: TODAY });
  assert.deepStrictEqual(w, ['Status entered'], 'the cycle clock must not reset');
});

test('a board without the new field still stamps nothing and does not throw', async () => {
  const b = fakeBoard({ fields: [{ id: 'f-start', name: 'Start date', dataType: 'DATE' }] });
  const w = await stampStatus({
    github: b.github, core: b.core, projectId: 'p', itemId: 'i',
    status: 'Done', startStatus: 'In Progress', today: TODAY });
  assert.deepStrictEqual(w, []);
});

test('a board that will not answer never blocks the move', async () => {
  const b = fakeBoard({ fields: ALL_FIELDS, fail: true });
  const w = await stampStatus({
    github: b.github, core: b.core, projectId: 'p', itemId: 'i',
    status: 'In Progress', startStatus: 'In Progress', today: TODAY });
  assert.deepStrictEqual(w, []);
});
