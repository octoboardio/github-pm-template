// Records when an item entered its current status, and when work on it began.
//
// The ProjectV2 API keeps no status history: an item tells you where it is,
// never how long it has been there. So the workflows that move items write it
// down. `Status entered` is overwritten on every move. `Start date` is written
// once, the first time an item reaches the start status, and never again, so
// that a trip back through Blocked does not reset how long the work has taken.

const FIELDS = `
  query($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        fields(first: 60) {
          nodes { ... on ProjectV2FieldCommon { id name dataType } }
        }
      }
    }
  }`;

const ITEM_DATES = `
  query($itemId: ID!) {
    node(id: $itemId) {
      ... on ProjectV2Item {
        started: fieldValueByName(name: "Start date") {
          ... on ProjectV2ItemFieldDateValue { date }
        }
      }
    }
  }`;

const SET_DATE = `
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $date: Date!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
      value: { date: $date }
    }) { projectV2Item { id } }
  }`;

/**
 * @param {object} a
 * @param {string} a.status canonical status the item has just entered
 * @param {string} a.startStatus canonical status that means work has begun
 * @param {string} [a.today] ISO date, for tests
 * @returns {Promise<string[]>} the fields it wrote, for logging
 */
async function stampStatus({ github, core, projectId, itemId, status, startStatus, today }) {
  const date = today || new Date().toISOString().slice(0, 10);
  const written = [];

  let fields;
  try {
    fields = (await github.graphql(FIELDS, { projectId })).node.fields.nodes;
  } catch (e) {
    // Dates are a measurement, not the job. A board that will not answer must
    // never stop an item from moving.
    core.info(`could not read the board's fields (${e.message}), not stamping`);
    return written;
  }
  const byName = new Map(fields.filter((f) => f && f.name).map((f) => [f.name, f]));

  const entered = byName.get('Status entered');
  if (entered) {
    await github.graphql(SET_DATE,
      { projectId, itemId, fieldId: entered.id, date });
    written.push('Status entered');
  } else {
    core.info('this board has no "Status entered" field yet, 30-sync-board adds it');
  }

  // Only on the way in, and only once. An item that goes In Progress, Blocked,
  // In Progress again keeps the date it first started.
  const start = byName.get('Start date');
  if (start && status === startStatus) {
    const current = (await github.graphql(ITEM_DATES, { itemId })).node.started;
    if (current && current.date) {
      core.info(`Start date already set to ${current.date}, left alone`);
    } else {
      await github.graphql(SET_DATE,
        { projectId, itemId, fieldId: start.id, date });
      written.push('Start date');
    }
  }

  return written;
}

module.exports = { stampStatus };
