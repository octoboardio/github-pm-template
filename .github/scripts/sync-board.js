// Provisions and aligns one repository's project board from
// .github/board-standard.json. Called by .github/workflows/30-sync-board.yml.
//
// A board is org configuration, not a file, so a repository created from the
// template starts with no board at all, or with GitHub's defaults. Nothing
// brings it up to the house standard on its own.

const fs = require('fs');
const {
  normalizeSynonyms, planOptions, optionsChanged, isBuiltinPriority,
} = require('./board-plan.js');

const FILE = '.github/board-standard.json';

module.exports = async ({ github, context, core }) => {
  if (!fs.existsSync(FILE)) {
    core.setFailed(`${FILE} not found.`);
    return;
  }
  const std = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const { owner, repo } = context.repo;
  const title = repo;
  const syn = normalizeSynonyms(std.synonyms);

  // ---- locate the board, creating it when this is a fresh repository
  let project = null;
  let orgId = null;
  try {
    let after = null;
    do {
      const page = await github.graphql(`
        query($login:String!,$after:String){organization(login:$login){ id
          projectsV2(first:100,after:$after){
            pageInfo{hasNextPage endCursor} nodes{id title}}}}`,
        { login: owner, after });
      orgId = page.organization.id;
      const conn = page.organization.projectsV2;
      project = conn.nodes.find((p) => p.title === title) ?? null;
      after = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
    } while (!project && after);
  } catch (e) {
    core.info(`cannot read organization projects (${e.message}). ` +
              `Set the PROJECT_TOKEN secret to enable board sync. Skipping.`);
    return;
  }

  if (!project) {
    core.info(`no board titled "${title}", creating it`);
    const made = await github.graphql(`
      mutation($owner:ID!,$title:String!){
        createProjectV2(input:{ownerId:$owner,title:$title}){projectV2{id title}}}`,
      { owner: orgId, title });
    project = made.createProjectV2.projectV2;
    core.info(`created board "${title}"`);
  }

  // ---- repository link. Linking needs repository scope on the token, which
  // board-only tokens do not carry. This runs on every sync, not only at
  // creation, so granting that scope later repairs a link the first run had to
  // skip. The board is resolved by title, so a failed link is cosmetic and must
  // not abort the alignment below.
  try {
    const repoId = (await github.graphql(
      `query($o:String!,$r:String!){repository(owner:$o,name:$r){id}}`,
      { o: owner, r: repo })).repository.id;

    // Relinking an already linked repository is wasted work, so ask first. If
    // the question itself fails, attempt the link anyway.
    let linked = false;
    try {
      const nodes = (await github.graphql(`
        query($p:ID!){node(id:$p){... on ProjectV2{
          repositories(first:100){nodes{id}}}}}`,
        { p: project.id })).node.repositories.nodes;
      linked = nodes.some((n) => n.id === repoId);
    } catch (e) {
      core.info(`could not read the board's linked repositories (${e.message}), ` +
                `attempting the link anyway`);
    }

    if (!linked) {
      await github.graphql(`
        mutation($p:ID!,$r:ID!){
          linkProjectV2ToRepository(input:{projectId:$p,repositoryId:$r}){repository{id}}}`,
        { p: project.id, r: repoId });
      core.info('linked this repository to the board');
    }
  } catch (e) {
    core.warning(`could not link the repository to the board (${e.message}). ` +
                 `Grant PROJECT_TOKEN repository scope, or link it by hand. ` +
                 `Continuing with field and view alignment.`);
  }

  const load = async () => (await github.graphql(`
    query($id:ID!){node(id:$id){... on ProjectV2{
      fields(first:60){nodes{ __typename
        ... on ProjectV2FieldCommon{id name dataType}
        ... on ProjectV2SingleSelectField{options{id name color description}}}}
      views(first:20){nodes{id name}}}}}`, { id: project.id })).node;

  let board = await load();
  const byName = () => {
    const m = new Map();
    for (const f of board.fields.nodes) if (f && f.name) m.set(f.name, f);
    return m;
  };
  let fields = byName();
  let changed = 0;

  // ---- replace GitHub's built-in Priority field, which holds no options
  const pri = fields.get('Priority');
  if (isBuiltinPriority(pri)) {
    await github.graphql(
      `mutation($f:ID!){deleteProjectV2Field(input:{fieldId:$f}){clientMutationId}}`,
      { f: pri.id });
    core.info('removed the built-in Priority field (no options, unwritable)');
    board = await load(); fields = byName(); changed++;
  }

  // ---- single selects: canonical first, in order, board's own options kept
  for (const [name, canon] of Object.entries(std.singleSelect)) {
    const f = fields.get(name);
    if (!f) {
      await github.graphql(`
        mutation($p:ID!,$n:String!,$o:[ProjectV2SingleSelectFieldOptionInput!]){
          createProjectV2Field(input:{projectId:$p,dataType:SINGLE_SELECT,name:$n,
            singleSelectOptions:$o}){clientMutationId}}`,
        { p: project.id, n: name,
          o: canon.map((o) => ({ name: o.name, color: o.color, description: '' })) });
      core.info(`created field ${name}`);
      changed++;
      continue;
    }
    if (f.dataType !== 'SINGLE_SELECT') continue;

    const payload = planOptions(canon, f.options, syn);
    if (optionsChanged(f.options, payload)) {
      await github.graphql(`
        mutation($f:ID!,$o:[ProjectV2SingleSelectFieldOptionInput!]){
          updateProjectV2Field(input:{fieldId:$f,singleSelectOptions:$o}){clientMutationId}}`,
        { f: f.id, o: payload });
      const kept = payload.length - canon.length;
      core.info(`aligned ${name}` + (kept > 0 ? ` (kept ${kept} board-specific)` : ''));
      changed++;
    }
  }

  // ---- plain fields. Name uniqueness is case insensitive on GitHub's side.
  board = await load(); fields = byName();
  const lower = new Set([...fields.keys()].map((k) => k.toLowerCase()));
  for (const f of std.fields) {
    if (lower.has(f.name.toLowerCase())) continue;
    await github.graphql(`
      mutation($p:ID!,$n:String!,$d:ProjectV2CustomFieldType!){
        createProjectV2Field(input:{projectId:$p,dataType:$d,name:$n}){clientMutationId}}`,
      { p: project.id, n: f.name, d: f.dataType });
    core.info(`created field ${f.name}`);
    changed++;
  }

  // ---- views. A closed project refuses these, which is not worth failing over.
  board = await load();
  const haveViews = new Set(board.views.nodes.map((v) => v.name));
  for (const v of std.views) {
    if (haveViews.has(v.name)) continue;
    try {
      const made = await github.graphql(`
        mutation($p:ID!,$n:String!,$l:ProjectV2ViewLayout!){
          createProjectV2View(input:{projectId:$p,name:$n,layout:$l}){projectV2View{id}}}`,
        { p: project.id, n: v.name, l: v.layout });
      if (v.filter) {
        await github.graphql(`
          mutation($v:ID!,$f:String!){
            updateProjectV2View(input:{viewId:$v,filter:$f}){clientMutationId}}`,
          { v: made.createProjectV2View.projectV2View.id, f: v.filter });
      }
      core.info(`created view ${v.name}`);
      changed++;
    } catch (e) {
      core.info(`could not create view ${v.name}: ${e.message}`);
    }
  }

  const line = changed
    ? `board "${title}" aligned, ${changed} change(s)`
    : `board "${title}" already matches the standard`;
  core.info(line);
  await core.summary.addHeading('Board sync', 3).addRaw(line).write();
};
