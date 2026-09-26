const test = require('node:test');
const assert = require('node:assert');
const { findDocLink, documentationSection } = require('./doc-link.js');

const REPO = { owner: 'example-org', repo: 'proj-acme' };

test('a plain documentation link is found', () => {
  assert.strictEqual(
    findDocLink('See https://docs.example.com/acme/runbook for the steps', REPO),
    'https://docs.example.com/acme/runbook');
});

test('trailing punctuation is not part of the link', () => {
  assert.strictEqual(
    findDocLink('Written up at https://wiki.internal/acme/rds.', REPO),
    'https://wiki.internal/acme/rds');
  assert.strictEqual(
    findDocLink('([https://wiki.internal/x])', REPO), 'https://wiki.internal/x');
});

test('a markdown link is found', () => {
  assert.strictEqual(
    findDocLink('[the runbook](https://wiki.internal/acme/runbook)', REPO),
    'https://wiki.internal/acme/runbook');
});

test('a link to our own pull request is not documentation', () => {
  assert.strictEqual(
    findDocLink('Fixed in https://github.com/example-org/proj-acme/pull/12', REPO), null);
});

test('a link to our own issue or commit is not documentation', () => {
  assert.strictEqual(
    findDocLink('https://github.com/example-org/proj-acme/issues/9', REPO), null);
  assert.strictEqual(
    findDocLink('https://github.com/example-org/proj-acme/commit/abc123', REPO), null);
});

test('a link to another repository is documentation', () => {
  assert.strictEqual(
    findDocLink('https://github.com/example-org/terraform-aws-vpc/blob/main/README.md', REPO),
    'https://github.com/example-org/terraform-aws-vpc/blob/main/README.md');
});

test('a badge is not documentation', () => {
  assert.strictEqual(
    findDocLink('![build](https://img.shields.io/badge/build-passing-green)', REPO), null);
  assert.strictEqual(findDocLink('https://example.com/diagram.png', REPO), null);
});

test('a real link is still found alongside badges and self references', () => {
  const body = [
    '![b](https://img.shields.io/badge/x-y-green)',
    'Closes https://github.com/example-org/proj-acme/issues/4',
    'Docs: https://docs.example.com/acme/failover',
  ].join('\n');
  assert.strictEqual(findDocLink(body, REPO), 'https://docs.example.com/acme/failover');
});

test('no link at all returns null rather than throwing', () => {
  assert.strictEqual(findDocLink('', REPO), null);
  assert.strictEqual(findDocLink(null, REPO), null);
  assert.strictEqual(findDocLink('Documented in Confluence somewhere', REPO), null);
});

test('the Documentation section is read on its own', () => {
  const body = [
    '## Summary', 'https://example.com/not-docs', '',
    '## Documentation', 'https://docs.example.com/acme', '',
    '## Testing', 'done',
  ].join('\n');
  const sec = documentationSection(body);
  assert.match(sec, /docs\.example\.com/);
  assert.doesNotMatch(sec, /not-docs/);
});

test('a body with no Documentation section says so', () => {
  assert.strictEqual(documentationSection('## Summary\nwords'), null);
});
