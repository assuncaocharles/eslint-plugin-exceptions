const path = require("path");

function sortApprovals(approvals) {
  const sorted = {};
  for (const ruleId of Object.keys(approvals).sort()) {
    const sortedFiles = {};
    for (const filePath of Object.keys(approvals[ruleId]).sort()) {
      sortedFiles[filePath] = approvals[ruleId][filePath];
    }
    sorted[ruleId] = sortedFiles;
  }
  return sorted;
}

/**
 * Build an approvals object from normalized lint results.
 *
 * @param {Array<{filePath: string, messages: Array<{ruleId?: string|null}>}>} results
 *   `filePath` must be absolute.
 * @param {string} basePath Directory that paths in approvals.json are relative to
 */
function generateApprovals(results, basePath) {
  const approvals = {};

  for (const result of results) {
    if (result.messages.length === 0) {
      continue;
    }

    const relativePath = path
      .relative(basePath, result.filePath)
      .replace(/\\/g, "/");

    for (const message of result.messages) {
      if (!message.ruleId) {
        continue;
      }
      approvals[message.ruleId] = approvals[message.ruleId] || {};
      approvals[message.ruleId][relativePath] =
        (approvals[message.ruleId][relativePath] || 0) + 1;
    }
  }

  return sortApprovals(approvals);
}

function mergeApprovals(existing, generated) {
  const merged = {};
  for (const [ruleId, files] of Object.entries(existing)) {
    merged[ruleId] = { ...files };
  }

  for (const [ruleId, files] of Object.entries(generated)) {
    merged[ruleId] = merged[ruleId] || {};
    for (const [filePath, count] of Object.entries(files)) {
      merged[ruleId][filePath] = Math.max(merged[ruleId][filePath] || 0, count);
    }
  }

  return sortApprovals(merged);
}

module.exports = {
  generateApprovals,
  mergeApprovals,
  sortApprovals,
};
