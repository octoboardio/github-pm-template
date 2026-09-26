const test = require('node:test');
const assert = require('node:assert');
const {
  normalizeSynonyms, planOptions, optionsChanged, isBuiltinPriority,
} = require('./board-plan.js');

const STATUS = [
  { name: 'Backlog', color: 'GRAY' },
  { name: 'Ready', color: 'BLUE' },
  { name: 'In Progress', color: 'YELLOW' },
  { name: 'Done', color: 'GREEN' },
];
const SYN = normalizeSynonyms({
  'Todo': 'Ready', 'to do': 'Ready', 'WIP': 'In Progress',
});

test('an empty board gets the canonical list, in order, with no ids', () => {
  const p = planOptions(STATUS, [], SYN);
  assert.deepStrictEqual(p.map((o) => o.name),
    ['Backlog', 'Ready', 'In Progress', 'Done']);
  assert.ok(p.every((o) => o.id === undefined));
});

test('an existing option keeps its id, so items keep their value', () => {
  const p = planOptions(STATUS, [{ id: 'x1', name: 'Done', color: 'GRAY' }], SYN);
  const done = p.find((o) => o.name === 'Done');
  assert.strictEqual(done.id, 'x1');
  assert.strictEqual(done.color, 'GREEN', 'colour is corrected to the standard');
});

test('a synonym is renamed in place rather than replaced', () => {
  const p = planOptions(STATUS, [{ id: 'x2', name: 'Todo', color: 'BLUE' }], SYN);
  const ready = p.find((o) => o.name === 'Ready');
  assert.strictEqual(ready.id, 'x2');
  assert.ok(!p.some((o) => o.name === 'Todo'), 'the alias is gone');
});

test('matching ignores case and surrounding whitespace', () => {
  const p = planOptions(STATUS, [{ id: 'x3', name: '  in progress ' }], SYN);
  assert.strictEqual(p.find((o) => o.name === 'In Progress').id, 'x3');
});

test("a board's own option survives, after the canonical ones", () => {
  const p = planOptions(STATUS, [{ id: 'x4', name: 'Client QA', color: 'PINK' }], SYN);
  assert.deepStrictEqual(p.map((o) => o.name),
    ['Backlog', 'Ready', 'In Progress', 'Done', 'Client QA']);
  const own = p.at(-1);
  assert.strictEqual(own.id, 'x4');
  assert.strictEqual(own.color, 'PINK', 'its colour is left alone');
});

test('an option with no colour is kept rather than sent colourless', () => {
  const p = planOptions(STATUS, [{ id: 'x5', name: 'Parked' }], SYN);
  assert.strictEqual(p.at(-1).color, 'GRAY');
});

test('two aliases for one status keep the first and preserve the second', () => {
  const p = planOptions(STATUS, [
    { id: 'a', name: 'Todo' },
    { id: 'b', name: 'to do' },
  ], SYN);
  assert.strictEqual(p.find((o) => o.name === 'Ready').id, 'a');
  assert.ok(p.some((o) => o.id === 'b'), 'the loser is kept, not dropped');
});

test('every existing option appears in the payload exactly once', () => {
  const existing = [
    { id: 'a', name: 'Done' }, { id: 'b', name: 'WIP' },
    { id: 'c', name: 'Client QA' }, { id: 'd', name: 'Parked' },
  ];
  const ids = planOptions(STATUS, existing, SYN).map((o) => o.id).filter(Boolean);
  assert.deepStrictEqual([...ids].sort(), ['a', 'b', 'c', 'd']);
});

test('a board already matching the standard reports no change', () => {
  const existing = STATUS.map((o, i) => ({ id: `i${i}`, name: o.name, color: o.color }));
  assert.strictEqual(optionsChanged(existing, planOptions(STATUS, existing, SYN)), false);
});

test('a reordered board does report a change', () => {
  const existing = [
    { id: 'i0', name: 'Done', color: 'GREEN' },
    { id: 'i1', name: 'Backlog', color: 'GRAY' },
  ];
  assert.strictEqual(optionsChanged(existing, planOptions(STATUS, existing, SYN)), true);
});

test('the optionless built-in Priority field is recognised', () => {
  assert.strictEqual(
    isBuiltinPriority({ name: 'Priority', dataType: 'SINGLE_SELECT', options: [] }), true);
});

test('a Priority field holding options is left alone', () => {
  assert.strictEqual(
    isBuiltinPriority({
      name: 'Priority', dataType: 'SINGLE_SELECT',
      options: [{ id: 'p', name: 'P0: Critical' }],
    }), false);
  assert.strictEqual(isBuiltinPriority({ name: 'Estimate', dataType: 'NUMBER' }), false);
  assert.strictEqual(isBuiltinPriority(null), false);
});

test('the standard shipped in this repository plans cleanly from empty', () => {
  const std = require('../board-standard.json');
  const syn = normalizeSynonyms(std.synonyms);
  for (const [name, canon] of Object.entries(std.singleSelect)) {
    const p = planOptions(canon, [], syn);
    assert.deepStrictEqual(p.map((o) => o.name), canon.map((o) => o.name), name);
  }
});
