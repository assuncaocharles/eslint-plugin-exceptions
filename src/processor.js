const path = require("path");
const {
  getApprovalsForFile,
  getRelativePath,
  getAllowedExceptions,
} = require("./utils/approvals-loader");

const processor = {
  // Return text as-is in a simple array (not objects with filename)
  // This keeps the original filename intact for TypeScript parser compatibility
  preprocess(text) {
    return [text];
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

    // When preprocess returns [text], ESLint appends "/0" to the filename
    // We need to strip this suffix to get the original file path
    let cleanFilename = filename;
    if (filename.endsWith("/0")) {
      cleanFilename = filename.slice(0, -2);
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
