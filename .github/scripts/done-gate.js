// Done means delivered, and undocumented work is not delivered.
//
// 08-docs-gate asks at creation whether the Documentation section is filled in,
// which prose satisfies and which nobody can answer properly before the work
// exists. This asks at the only moment the answer can be true: on close.

const { findDocLink, documentationSection } = require('./doc-link.js');
const { canonical, flow } = require('./board-vocab.js');
const { stampStatus } = require('./stamp-status.js');

const ITEM = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        projectItems(first: 20) {
          nodes {
            id
            project { id }
            status: fieldValueByName(name: "Status") {
              ... on ProjectV2ItemFieldSingleSelectValue { name }
            }
          }
        }
      }
    }
  }`;

const SET_STATUS = `
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId, itemId: $itemId,
      fieldId: $fieldId, value: { singleSelectOptionId: $optionId }
    }) { projectV2Item { id } }
  }`;

const EXEMPT_LABELS = ['docs: bypassed', 'type: epic', 'status: wontfix'];

module.exports = async ({ github, context, core }) => {
  const issue = context.payload.issue;
  if (!issue) return;

  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const number = issue.number;
  const labels = (issue.labels || []).map((l) => (l && l.name ? l.name : l)).map(String);

  const exempt = labels.find((l) => EXEMPT_LABELS.includes(l));
  if (exempt) {
    core.info(`#${number} carries ${exempt}, exempt from the documentation gate`);
    return;
  }

  // The whole thread counts. A link posted in a comment is as good as one in
  // the body, and often better, because it is written after the work.
  const comments = await github.paginate(github.rest.issues.listComments,
    { owner, repo, issue_number: number, per_page: 100 });
  const section = documentationSection(issue.body);
  const haystacks = [section, issue.body, ...comments.map((c) => c.body)];

  let link = null;
  for (const text of haystacks) {
    link = findDocLink(text, { owner, repo });
    if (link) break;
  }

  if (link) {
    core.info(`#${number} documented at ${link}`);
    await github.rest.issues.removeLabel({
      owner, repo, issue_number: number, name: 'docs: missing',
    }).catch(() => {});
    return;
  }

  await github.rest.issues.addLabels({
    owner, repo, issue_number: number, labels: ['docs: missing'],
  });

  // Move it back out of the done column. The issue stays closed: arguing with
  // someone about whether their work is finished is not this workflow's job,
  // but it must not be counted as delivered on the board or in the flow report.
  let moved = false;
  const projectId = process.env.PROJECT_ID;
  const fieldId = process.env.STATUS_FIELD_ID;
  const options = JSON.parse(process.env.STATUS_OPTIONS || '{}');
  const back = options[flow().review];

  if (projectId && fieldId && back) {
    try {
      const res = await github.graphql(ITEM, { owner, repo, number });
      const item = res.repository.issue.projectItems.nodes
        .find((i) => i.project.id === projectId);
      if (item && canonical(item.status && item.status.name) === flow().done) {
        await github.graphql(SET_STATUS,
          { projectId, itemId: item.id, fieldId, optionId: back });
        moved = true;
        // Every status change records when it happened, or the flow report
        // cannot age the item and it drops out of the numbers entirely.
        await stampStatus({
          github, core, projectId, itemId: item.id,
          status: flow().review, startStatus: flow().start,
        });
      }
    } catch (e) {
      core.info(`could not move #${number} off the done column (${e.message})`);
    }
  }

  await github.rest.issues.createComment({
    owner, repo, issue_number: number,
    body: [
      '> 📄 **Closed without a documentation link.**',
      '>',
      '> Add a link to the document under `## Documentation`, or post it here,',
      '> and this clears itself. A pull request or issue in this repository is',
      '> evidence of the work, not documentation of it.',
      moved ? `>\n> Moved back to **${flow().review}** on the board; it is not delivered until it is written down.` : '',
      '>',
      '> Genuinely nothing to document? Comment `/bypass-docs: <reason>`.',
    ].filter(Boolean).join('\n'),
  });
  core.info(`#${number} closed with no documentation link${moved ? ', moved off done' : ''}`);
};
