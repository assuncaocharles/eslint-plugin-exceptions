const {
  getApprovalsForFile,
  getRelativePath,
} = require("../utils/approvals-loader");
const { applyApprovals } = require("./apply");

/**
 * Look up the nearest approvals.json for `absolutePath` and apply it.
 *
 * @param {Array} messages
 * @param {string} absolutePath
 * @returns {Array}
 */
function filterMessagesForFile(messages, absolutePath) {
  const { approvals, approvalsDir } = getApprovalsForFile(absolutePath);

  if (!approvals || !approvalsDir) {
    return messages;
  }

  const relativePath = getRelativePath(absolutePath, approvalsDir);
  return applyApprovals(messages, approvals, relativePath);
}

module.exports = {
  applyApprovals,
  filterMessagesForFile,
};
