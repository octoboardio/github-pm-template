// Pure planning helpers for the project board sync.
//
// These hold the only intricate logic in the board workflow: deciding what a
// single select field's option list should become. Getting it wrong silently
// drops the value off every item that used the option, so it lives here on its
// own, with tests, instead of inside a YAML string.

/**
 * Lower-case the synonym table once, so lookups are case insensitive.
 * @param {Record<string,string>} synonyms from board-standard.json
 */
function normalizeSynonyms(synonyms) {
  const out = {};
  for (const [k, v] of Object.entries(synonyms || {})) out[k.toLowerCase()] = v;
  return out;
}

/**
 * Work out the option list to send for one single select field.
 *
 * GitHub replaces the whole list on every update, so the payload must carry
 * every option that should survive, each with its existing id. An option sent
 * without its id is treated as new, and the old one is deleted along with the
 * value it held on every item.
 *
 * Canonical options come first and in order. An option the board added itself
 * is kept, unchanged, after them.
 *
 * @param {{name:string,color:string}[]} canon canonical options, in order
 * @param {{id:string,name:string,color?:string,description?:string}[]} existing
 * @param {Record<string,string>} synonyms lower-cased alias -> canonical name
 */
function planOptions(canon, existing, synonyms) {
  const syn = synonyms || {};
  const want = canon.map((o) => o.name);
  const lowerCanon = new Map(canon.map((o) => [o.name.toLowerCase(), o.name]));

  const taken = new Set();
  const matched = new Map();
  const extras = [];

  for (const o of existing || []) {
    const low = String(o.name).trim().toLowerCase();
    const target = syn[low] || lowerCanon.get(low);
    // Two aliases can point at the same canonical name. The first wins and the
    // second is kept as a board-specific option rather than silently dropped.
    if (target && want.includes(target) && !taken.has(target)) {
      matched.set(target, o);
      taken.add(target);
    } else {
      extras.push(o);
    }
  }

  return canon
    .map((c) => {
      const o = matched.get(c.name);
      return o
        ? { id: o.id, name: c.name, color: c.color, description: '' }
        : { name: c.name, color: c.color, description: '' };
    })
    .concat(
      extras.map((o) => ({
        id: o.id,
        name: o.name,
        color: o.color || 'GRAY',
        description: o.description || '',
      })),
    );
}

/** A field is worth updating only when names or colours actually move. */
function optionsChanged(existing, payload) {
  const key = (list) => list.map((o) => `${o.name}:${o.color}`).join('|');
  return key(existing || []) !== key(payload);
}

/**
 * GitHub's built-in Priority field is a single select that carries no options.
 * It cannot hold a value and it squats the name, so the sync replaces it.
 */
function isBuiltinPriority(field) {
  return Boolean(
    field &&
      field.name === 'Priority' &&
      field.dataType === 'SINGLE_SELECT' &&
      !(field.options || []).length,
  );
}

module.exports = { normalizeSynonyms, planOptions, optionsChanged, isBuiltinPriority };
