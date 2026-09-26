// The board's vocabulary, read from .github/board-standard.json.
//
// This used to live in eight places: the standard, pm-resolve, four workflows
// and two fleet scripts. Only the standard knew `Client Awaiting` existed, so
// every other consumer dropped it as unmapped and an item waiting on a client
// was invisible to the digest, the WIP guard and size drift. One copy now.

const fs = require('fs');
const path = require('path');

const FILE = '.github/board-standard.json';

let cached = null;

/** The standard, read once per process. */
function standard() {
  if (cached) return cached;
  // Workflows run from the workspace root; a sibling module may not.
  const local = path.join(__dirname, '..', 'board-standard.json');
  const file = fs.existsSync(FILE) ? FILE : local;
  cached = JSON.parse(fs.readFileSync(file, 'utf8'));
  return cached;
}

/** Canonical option names of one single select, in board order. */
function options(field) {
  return (standard().singleSelect[field] || []).map((o) => o.name);
}

/**
 * Resolve a board option name to its canonical form, or null.
 *
 * Matches the canonical names themselves as well as the synonym table, both
 * case insensitively and ignoring surrounding whitespace, because a board
 * edited by hand accumulates "todo", "To Do" and "🆕 To Do" for one column.
 */
function canonical(name, field = 'Status') {
  if (typeof name !== 'string') return null;
  const key = name.trim().toLowerCase();
  const canon = options(field);
  const direct = canon.find((n) => n.toLowerCase() === key);
  if (direct) return direct;
  const alias = standard().synonyms || {};
  for (const [from, to] of Object.entries(alias)) {
    if (from.toLowerCase() === key && canon.includes(to)) return to;
  }
  return null;
}

/**
 * Which statuses mean what, for the workflows that reason about flow rather
 * than about a particular column. Named in the standard so a board that
 * renames a column does not silently stop being measured.
 */
function flow() {
  const f = standard().flow || {};
  return {
    committed: f.committed,
    start: f.start,
    review: f.review,
    done: f.done,
    active: f.active || [],
    waiting: f.waiting || [],
    ageingDays: f.ageingDays || 3,
  };
}

module.exports = { standard, options, canonical, flow };
