// Weekly flow report. Called by .github/workflows/31-flow-report.yml.
//
// 21-size-calibration measures how good our estimates were. Nothing measured
// how work actually moves: how long it sits, how long the client holds it, how
// long it takes end to end. Those are the numbers that say whether a project is
// healthy, and the only ones worth repeating to a client.

const { canonical, flow } = require('./board-vocab.js');
const { flowMetrics } = require('./flow-metrics.js');

const TITLE = '📈 Flow report';
const MARKER = '<!-- pm:flow-report -->';

const ITEMS = `
  query($projectId: ID!, $after: String) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            content {
              ... on Issue { number title state url assignees(first: 5) { nodes { login } } }
            }
            status: fieldValueByName(name: "Status") {
              ... on ProjectV2ItemFieldSingleSelectValue { name }
            }
            entered: fieldValueByName(name: "Status entered") {
              ... on ProjectV2ItemFieldDateValue { date }
            }
            started: fieldValueByName(name: "Start date") {
              ... on ProjectV2ItemFieldDateValue { date }
            }
          }
        }
      }
    }
  }`;

const link = (i) => `[#${i.number}](${i.url}) ${i.title}`;
const who = (i) => (i.assignees.length ? ` · @${i.assignees.join(', @')}` : '');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function render(m, repo) {
  const out = [
    `## ${TITLE}, week to ${m.today}`,
    '',
    `**${repo}** · last ${m.windowDays} days`,
    '',
    '| Measure | Value |',
    '|---|---|',
    `| Delivered | ${m.throughput} |`,
    `| Cycle time, median | ${m.cycle.median === null ? 'not measurable yet' : plural(m.cycle.median, 'day', 'days')} |`,
    `| Cycle time, mean | ${m.cycle.mean === null ? 'not measurable yet' : plural(m.cycle.mean, 'day', 'days')} |`,
    `| In flight | ${m.wip.reduce((a, w) => a + w.count, 0)} |`,
    '',
  ];

  // The client queue leads, because it is the one nothing else reports and the
  // only one where the cost of silence lands on the client relationship.
  for (const [status, list] of Object.entries(m.waiting)) {
    out.push(`### ${status} (${list.length})`);
    out.push(list.length
      ? list.map((i) => `- ${link(i)} — **${i.days === null ? 'unknown' : plural(i.days, 'day', 'days')}**${who(i)}`).join('\n')
      : '_nothing waiting_');
    out.push('');
  }

  out.push(`### Not moving, open work untouched for ${plural(m.ageingDays, 'day', 'days')} or more (${m.ageing.length})`);
  out.push(m.ageing.length
    ? m.ageing.map((i) => `- ${link(i)} — ${i.status}, ${plural(i.days, 'day', 'days')}${who(i)}`).join('\n')
    : '_everything active has moved recently_');
  out.push('');

  out.push('### Work in flight, by person');
  out.push(m.wip.length
    ? ['| Person | Items |', '|---|---|',
       ...m.wip.map((w) => `| ${w.who === 'unassigned' ? '_unassigned_' : `@${w.who}`} | ${w.count} |`)].join('\n')
    : '_nothing in flight_');
  out.push('');

  if (m.cycle.slowest.length) {
    out.push('### Slowest to deliver this week');
    out.push(m.cycle.slowest.map((i) => `- ${link(i)} — ${plural(i.cycle, 'day', 'days')}`).join('\n'));
    out.push('');
  }
  if (m.cycle.unmeasured) {
    out.push(`_${plural(m.cycle.unmeasured, 'item', 'items')} delivered without a usable Start date, ` +
             `so not in the cycle time above._`);
    out.push('');
  }

  out.push(MARKER);
  return out.join('\n');
}

module.exports = async ({ github, context, core }) => {
  const projectId = process.env.PROJECT_ID;
  if (!projectId) {
    core.info('no board resolved, nothing to report on');
    return;
  }
  const cfg = flow();

  const nodes = [];
  let after = null;
  do {
    const page = await github.graphql(ITEMS, { projectId, after });
    const conn = page.node.items;
    nodes.push(...conn.nodes);
    after = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (after);

  const items = nodes
    .filter((n) => n.content && n.content.number)
    .map((n) => ({
      number: n.content.number,
      title: n.content.title,
      url: n.content.url,
      state: n.content.state,
      assignees: n.content.assignees.nodes.map((a) => a.login),
      status: canonical(n.status && n.status.name),
      statusEntered: n.entered ? n.entered.date : null,
      startDate: n.started ? n.started.date : null,
    }));

  const unknown = items.filter((i) => i.status === null).length;
  if (unknown) {
    core.info(`${unknown} item(s) sit in a Status this board standard does not name`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const metrics = flowMetrics({ items, today, flow: cfg });
  const body = render(metrics, `${context.repo.owner}/${context.repo.repo}`);

  const found = await github.rest.search.issuesAndPullRequests({
    q: `repo:${context.repo.owner}/${context.repo.repo} is:issue is:open in:title "${TITLE}"`,
  });
  if (found.data.total_count > 0) {
    await github.rest.issues.createComment({
      owner: context.repo.owner, repo: context.repo.repo,
      issue_number: found.data.items[0].number, body,
    });
    core.info(`flow report posted to #${found.data.items[0].number}`);
  } else {
    const made = await github.rest.issues.create({
      owner: context.repo.owner, repo: context.repo.repo,
      title: TITLE, body, labels: ['type: chore'],
    });
    core.info(`flow report opened as #${made.data.number}`);
  }

  await core.summary.addHeading('Flow report', 3).addRaw(
    `${metrics.throughput} delivered, ${metrics.ageing.length} not moving, ` +
    `${Object.values(metrics.waiting).flat().length} waiting on someone else`).write();
};

module.exports.render = render;
