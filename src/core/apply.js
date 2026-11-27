const { getAllowedExceptions } = require("./allowed");

/**
 * Apply approvals to the messages of a single file.
 *
 * Messages are grouped by `ruleId`. For each rule, the first `allowed`
 * messages are dropped and the rest are returned. The first excess message
 * gets a note with the actual vs. approved count. Messages without a
 * `ruleId` (e.g. parsing errors) are always kept.
 *
 * Pure function: input messages are not mutated.
 *
 * @param {Array<{ruleId?: string|null, message: string}>} messages
 * @param {object|null} approvals Parsed approvals.json content
 * @param {string} relativePath File path relative to the approvals.json dir
 * @returns {Array} Messages that are not covered by approvals
 */
function applyApprovals(messages, approvals, relativePath) {
  if (!approvals || messages.length === 0) {
    return messages;
  }

  const messagesByRule = new Map();
  for (const message of messages) {
    const ruleId = message.ruleId || null;
    if (!messagesByRule.has(ruleId)) {
      messagesByRule.set(ruleId, []);
    }
    messagesByRule.get(ruleId).push(message);
  }

  const result = [];

  for (const [ruleId, ruleMessages] of messagesByRule) {
    if (ruleId === null) {
      result.push(...ruleMessages);
      continue;
    }

    const allowed = getAllowedExceptions(approvals, ruleId, relativePath);
    const actual = ruleMessages.length;

    if (actual <= allowed) {
      continue;
    }

    if (allowed === 0) {
      result.push(...ruleMessages);
      continue;
    }

    const [firstExcess, ...rest] = ruleMessages.slice(allowed);
    result.push(
      {
        ...firstExcess,
        message: `${firstExcess.message} (${actual} violations found, but only ${allowed} approved in approvals.json)`,
      },
      ...rest
    );
  }

  return result;
}

module.exports = { applyApprovals };
