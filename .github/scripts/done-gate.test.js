const test = require('node:test');
const assert = require('node:assert');
const gate = require('./done-gate.js');
const { flow } = require('./board-vocab.js');

const DONE = flow().done;
const REVIEW = flow().review;

function harness({ body = '', labels = [], comments = [], status = DONE, env = {} } = {}) {
  const calls = { labels: [], comments: [], removed: [], moves: [], stamps: [] };
  Object.assign(process.env, {
    PROJECT_ID: 'p1', STATUS_FIELD_ID: 'f1',
    STATUS_OPTIONS: JSON.stringify({ [REVIEW]: 'opt-review', [DONE]: 'opt-done' }),
    ...env,
  });
  const github = {
    paginate: async () => comments.map((b) => ({ body: b })),
    rest: {
      issues: {
        listComments: 'listComments',
        addLabels: async (a) => { calls.labels.push(...a.labels); },
        removeLabel: async (a) => { calls.removed.push(a.name); },
        createComment: async (a) => { calls.comments.push(a.body); },
      },
    },
    graphql: async (q, vars) => {
      if (q.includes('fields(first: 60)')) {
        return { node: { fields: { nodes: [
          { id: 'f-entered', name: 'Status entered', dataType: 'DATE' },
          { id: 'f-start', name: 'Start date', dataType: 'DATE' },
        ] } } };
      }
      if (q.includes('ProjectV2Item') && q.includes('Start date')) {
        return { node: { started: null } };
      }
      if (q.includes('projectItems')) {
        return { repository: { issue: { projectItems: { nodes: [
          { id: 'i1', project: { id: 'p1' }, status: { name: status } },
        ] } } } };
      }
      if (vars.date) calls.stamps.push({ fieldId: vars.fieldId, date: vars.date });
      else calls.moves.push(vars.optionId);
      return { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'i1' } } };
    },
  };
  const context = {
    repo: { owner: 'example-org', repo: 'proj-acme' },
    payload: { issue: { number: 5, body, labels: labels.map((name) => ({ name })) } },
  };
  return { calls, run: () => gate({ github, context, core: { info: () => {} } }) };
}

test('a documentation link in the body passes', async () => {
  const h = harness({ body: '## Documentation\nhttps://docs.example.com/acme' });
  await h.run();
  assert.deepStrictEqual(h.calls.labels, []);
  assert.deepStrictEqual(h.calls.comments, []);
  assert.deepStrictEqual(h.calls.moves, []);
});

test('a link posted in a comment passes too', async () => {
  const h = harness({ body: 'no link here', comments: ['written up: https://wiki.internal/x'] });
  await h.run();
  assert.deepStrictEqual(h.calls.labels, []);
});

test('passing clears a docs: missing label left from an earlier close', async () => {
  const h = harness({ body: 'https://wiki.internal/x' });
  await h.run();
  assert.deepStrictEqual(h.calls.removed, ['docs: missing']);
});

test('no link labels, explains, and moves it back off done', async () => {
  const h = harness({ body: 'all finished' });
  await h.run();
  assert.deepStrictEqual(h.calls.labels, ['docs: missing']);
  assert.deepStrictEqual(h.calls.moves, ['opt-review']);
  assert.match(h.calls.comments[0], /Closed without a documentation link/);
  assert.match(h.calls.comments[0], new RegExp(`Moved back to \\*\\*${REVIEW}\\*\\*`));
});

test('a link to our own pull request does not count', async () => {
  const h = harness({ body: 'done in https://github.com/example-org/proj-acme/pull/3' });
  await h.run();
  assert.deepStrictEqual(h.calls.labels, ['docs: missing']);
});

for (const label of ['docs: bypassed', 'type: epic', 'status: wontfix']) {
  test(`${label} is exempt`, async () => {
    const h = harness({ body: 'nothing', labels: [label] });
    await h.run();
    assert.deepStrictEqual(h.calls.labels, []);
    assert.deepStrictEqual(h.calls.comments, []);
  });
}

test('an item that is not in the done column is not moved', async () => {
  const h = harness({ body: 'nothing', status: 'Backlog' });
  await h.run();
  assert.deepStrictEqual(h.calls.moves, [], 'nothing to move it off');
  assert.deepStrictEqual(h.calls.labels, ['docs: missing'], 'still labelled');
  assert.doesNotMatch(h.calls.comments[0], /Moved back/);
});

test('without a resolved board it still labels and explains', async () => {
  const h = harness({ body: 'nothing', env: { PROJECT_ID: '', STATUS_FIELD_ID: '' } });
  await h.run();
  assert.deepStrictEqual(h.calls.labels, ['docs: missing']);
  assert.doesNotMatch(h.calls.comments[0], /Moved back/);
});

test('moving an item off done records when it moved', async () => {
  // Found on the pilot repository: the gate moved the item and stamped
  // nothing, so the flow report could not age it and it vanished from the
  // numbers. Every status change writes Status entered.
  const h = harness({ body: 'no link' });
  await h.run();
  assert.deepStrictEqual(h.calls.moves, ['opt-review']);
  assert.deepStrictEqual(h.calls.stamps.map((s) => s.fieldId), ['f-entered']);
  assert.match(h.calls.stamps[0].date, /^\d{4}-\d{2}-\d{2}$/);
});

test('an item left where it is is not stamped either', async () => {
  const h = harness({ body: 'no link', status: 'Backlog' });
  await h.run();
  assert.deepStrictEqual(h.calls.stamps, []);
});
