const path = require("path");
const {
  getApprovalsForFile,
  getRelativePath,
  getAllowedExceptions,
} = require("./utils/approvals-loader");

const processor = {
  preprocess(text, filename) {
    const ext = path.extname(filename) || ".js";
    return [{ text, filename: `0${ext}` }];
  },

  postprocess(messages, filename) {
    const allMessages = messages.flat();

    const DEBUG = process.env.DEBUG_EXCEPTIONS === "1";
    if (DEBUG) {
      console.log(`[exceptions] postprocess called for: ${filename}`);
      console.log(`[exceptions] messages count: ${allMessages.length}`);
      allMessages.forEach((m, i) =>
        console.log(`[exceptions]   ${i}: ${m.ruleId} - ${m.message}`)
      );
    }

    if (allMessages.length === 0) {
      return [];
    }

    let cleanFilename = filename;
    const processorSuffixMatch = filename.match(/\/\d+_[^/]*$/);
    if (processorSuffixMatch) {
      cleanFilename = filename.slice(0, processorSuffixMatch.index);
    }

    if (DEBUG) {
      console.log(`[exceptions] clean filename: ${cleanFilename}`);
    }

    const absolutePath = path.resolve(cleanFilename);

    const { approvals, approvalsDir } = getApprovalsForFile(absolutePath);

    if (!approvals || !approvalsDir) {
      return allMessages;
    }

    const relativePath = getRelativePath(absolutePath, approvalsDir);

    if (DEBUG) {
      console.log(`[exceptions] approvalsDir: ${approvalsDir}`);
      console.log(`[exceptions] relativePath: ${relativePath}`);
      console.log(
        `[exceptions] approvals:`,
        JSON.stringify(approvals, null, 2)
      );
    }

    const messagesByRule = new Map();
    for (const message of allMessages) {
      const ruleId = message.ruleId;
      if (!ruleId) {
        if (!messagesByRule.has(null)) {
          messagesByRule.set(null, []);
        }
        messagesByRule.get(null).push(message);
        continue;
      }

      if (!messagesByRule.has(ruleId)) {
        messagesByRule.set(ruleId, []);
      }
      messagesByRule.get(ruleId).push(message);
    }

    const filteredMessages = [];

    for (const [ruleId, ruleMessages] of messagesByRule) {
      if (ruleId === null) {
        filteredMessages.push(...ruleMessages);
        continue;
      }

      const allowedCount = getAllowedExceptions(
        approvals,
        ruleId,
        relativePath
      );
      const actualCount = ruleMessages.length;

      if (actualCount <= allowedCount) {
        continue;
      }

      if (allowedCount === 0) {
        filteredMessages.push(...ruleMessages);
      } else {
        const excessMessages = ruleMessages.slice(allowedCount);

        if (excessMessages.length > 0) {
          const firstExcess = excessMessages[0];
          firstExcess.message = `${firstExcess.message} (${actualCount} violations found, but only ${allowedCount} approved in approvals.json)`;
        }

        filteredMessages.push(...excessMessages);
      }
    }

    return filteredMessages;
  },

  supportsAutofix: true,
};

module.exports = processor;
