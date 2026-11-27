const path = require("path");
const { filterMessagesForFile } = require("./core/filter");

// Set by the CLI when it runs ESLint, so that `generate` and `check` see the
// raw violations instead of results that were already filtered.
const DISABLE_ENV = "ESLINT_EXCEPTIONS_DISABLE";

const processor = {
  meta: {
    name: "eslint-plugin-exceptions/passthrough",
  },

  // Return text as-is in a simple array (not objects with filename)
  // This keeps the original filename intact for TypeScript parser compatibility
  preprocess(text) {
    return [text];
  },

  postprocess(messages, filename) {
    const allMessages = messages.flat();

    if (process.env[DISABLE_ENV] === "1") {
      return allMessages;
    }

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
    const cleanFilename = filename.endsWith("/0")
      ? filename.slice(0, -2)
      : filename;

    const result = filterMessagesForFile(
      allMessages,
      path.resolve(cleanFilename)
    );

    if (DEBUG) {
      console.log(`[exceptions] ${cleanFilename}: ${result.length} reported`);
    }

    return result;
  },

  supportsAutofix: true,
};

module.exports = processor;
