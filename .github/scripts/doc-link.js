// Finding a documentation link in an issue.
//
// 08-docs-gate checks that the Documentation section is not empty, which prose
// satisfies. What a client receives is a document, so at delivery the question
// is whether one exists. The link is checked for shape and never fetched: most
// of our documentation sits behind authentication, so a liveness check would
// fail on exactly the links that matter and pass on the ones that do not.

const URL_RE = /https?:\/\/[^\s<>()[\]"'`]+/gi;

// A pull request, an issue or a commit in the repository doing the work is
// evidence of the work, not documentation of it.
const selfReference = (url, owner, repo) => {
  const host = `github.com/${owner}/${repo}/`.toLowerCase();
  const at = url.toLowerCase().indexOf(host);
  if (at === -1) return false;
  const rest = url.slice(at + host.length);
  return /^(issues|pull|commit|compare|releases\/tag)\b/i.test(rest);
};

// Badges and avatars are decoration that every issue template drags along.
const decorative = (url) =>
  /(shields\.io|badge|githubusercontent\.com\/.*avatar|\.(png|jpe?g|gif|svg)(\?|$))/i
    .test(url);

/**
 * The first link in `text` that could plausibly be documentation.
 * @returns {string|null}
 */
function findDocLink(text, { owner, repo } = {}) {
  for (const raw of String(text || '').match(URL_RE) || []) {
    // Markdown and prose leave punctuation stuck to the end of a bare URL.
    const url = raw.replace(/[.,;:!?)\]}>]+$/, '');
    if (!url) continue;
    if (owner && repo && selfReference(url, owner, repo)) continue;
    if (decorative(url)) continue;
    return url;
  }
  return null;
}

/** The Documentation section of an issue body, if it has one. */
function documentationSection(body) {
  const m = String(body || '').match(/##\s*Documentation\s*\n([\s\S]*?)(?=\n##\s|\s*$)/i);
  return m ? m[1] : null;
}

module.exports = { findDocLink, documentationSection };
