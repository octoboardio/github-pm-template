// Applies .github/labels.json to one repository.
// Called by .github/workflows/29-sync-labels.yml.
//
// Labels are repository settings, not files, so a template sync does not carry
// them. Without this a new adopter starts with none of them and every workflow
// that adds one fails: `gh pr edit --add-label` looks the label up client side
// and exits 1 with "'P1: high' not found".

const fs = require('fs');

const FILE = '.github/labels.json';

module.exports = async ({ github, context, core }) => {
  if (!fs.existsSync(FILE)) {
    core.setFailed(`${FILE} not found, nothing to sync.`);
    return;
  }

  let want;
  try {
    want = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    core.setFailed(`${FILE} is not valid JSON: ${e.message}`);
    return;
  }
  if (!Array.isArray(want) || !want.length) {
    core.setFailed(`${FILE} must be a non-empty array of labels.`);
    return;
  }

  const { owner, repo } = context.repo;
  const have = await github.paginate(
    github.rest.issues.listLabelsForRepo, { owner, repo, per_page: 100 });

  // GitHub treats label names case insensitively, so match that way to avoid
  // trying to create a duplicate that only differs in case.
  const byLower = new Map(have.map((l) => [l.name.toLowerCase(), l]));
  const norm = (c) => String(c || '').replace(/^#/, '').toLowerCase();

  let created = 0, updated = 0, unchanged = 0;

  for (const l of want) {
    if (!l || !l.name) {
      core.warning(`skipping an entry in ${FILE} with no name`);
      continue;
    }
    const color = norm(l.color) || 'ededed';
    const description = l.description || '';
    const cur = byLower.get(l.name.toLowerCase());

    try {
      if (!cur) {
        await github.rest.issues.createLabel({ owner, repo, name: l.name, color, description });
        created++;
        core.info(`created  ${l.name}`);
      } else if (cur.name !== l.name || norm(cur.color) !== color ||
                 (cur.description || '') !== description) {
        await github.rest.issues.updateLabel({
          owner, repo, name: cur.name, new_name: l.name, color, description });
        updated++;
        core.info(`updated  ${l.name}`);
      } else {
        unchanged++;
      }
    } catch (e) {
      // A label created by a concurrent run is not a failure.
      if (e.status === 422) {
        core.info(`exists   ${l.name}`);
        unchanged++;
      } else {
        throw e;
      }
    }
  }

  // Deliberately never deletes. Labels this repository added on its own are its
  // business, and dependabot and the issue forms rely on some.
  const extra = have.length + created - want.length;
  const line =
    `${created} created, ${updated} updated, ${unchanged} already correct` +
    (extra > 0 ? `, ${extra} repo-specific left alone` : '');
  core.info(line);
  await core.summary.addHeading('Label sync', 3).addRaw(line).write();
};
