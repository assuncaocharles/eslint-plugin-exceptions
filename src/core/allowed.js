/**
 * Number of approved violations for `ruleName` in `relativePath`.
 * Browser-safe: no Node.js APIs.
 */
function getAllowedExceptions(approvals, ruleName, relativePath) {
  if (!approvals || !approvals[ruleName]) {
    return 0;
  }

  const ruleApprovals = approvals[ruleName];

  if (typeof ruleApprovals[relativePath] === "number") {
    return ruleApprovals[relativePath];
  }

  const normalizedPath = relativePath.replace(/\\/g, "/");
  if (typeof ruleApprovals[normalizedPath] === "number") {
    return ruleApprovals[normalizedPath];
  }

  return 0;
}

module.exports = { getAllowedExceptions };
