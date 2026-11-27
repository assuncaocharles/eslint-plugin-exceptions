const fs = require("fs");
const { fileURLToPath } = require("url");
const path = require("path");
const { readMessages, writeMessage, writeRaw } = require("./framing");
const { applyApprovals } = require("../core/filter");
const { normalizeRuleId } = require("../linters/oxlint");
const {
  findApprovalsFile,
  loadApprovalsFile,
  getRelativePath,
} = require("../utils/approvals-loader");

const OWN_REQUEST_PREFIX = "eslint-exceptions:";

function uriToPath(uri) {
  try {
    return uri && uri.startsWith("file:") ? fileURLToPath(uri) : null;
  } catch {
    return null;
  }
}

function diagnosticCode(diagnostic) {
  const { code } = diagnostic;
  if (code && typeof code === "object") return String(code.value);
  return code === undefined || code === null ? null : String(code);
}

/**
 * Sits between an editor and `oxlint --lsp` and removes diagnostics that are
 * covered by approvals.json. Everything else is forwarded unchanged.
 *
 * Handles both ways an editor can get diagnostics:
 *  - push: `textDocument/publishDiagnostics` notifications from the server
 *  - pull: responses to `textDocument/diagnostic` and `workspace/diagnostic`
 *
 * When an approvals.json file changes, diagnostics are refreshed: pull
 * clients get `workspace/diagnostic/refresh`, push clients get the last
 * diagnostics for affected files republished with the new approvals.
 */
function createProxy({
  clientIn,
  clientOut,
  serverIn,
  serverOut,
  watchInterval = 1000,
}) {
  // request id (from the client) -> { method, uri }, for pull requests whose
  // response is filtered (a textDocument/diagnostic response has no uri)
  const pendingPulls = new Map();
  // uri -> last raw diagnostics pushed by the server
  const lastPushed = new Map();
  // approvals.json files being watched for changes
  const watched = new Set();
  let clientSupportsRefresh = false;
  let ownRequestId = 0;

  function approvalsFor(filePath) {
    const approvalsPath = findApprovalsFile(path.dirname(filePath));
    if (!approvalsPath) return null;
    watch(approvalsPath);
    const approvals = loadApprovalsFile(approvalsPath);
    if (!approvals) return null;
    return {
      approvals,
      relativePath: getRelativePath(filePath, path.dirname(approvalsPath)),
    };
  }

  function filterDiagnostics(uri, diagnostics) {
    const filePath = uriToPath(uri);
    if (!filePath || !Array.isArray(diagnostics) || diagnostics.length === 0) {
      return diagnostics;
    }

    const found = approvalsFor(filePath);
    if (!found) return diagnostics;

    const messages = diagnostics.map((diagnostic) => ({
      ruleId: normalizeRuleId(diagnosticCode(diagnostic)),
      message: diagnostic.message,
      diagnostic,
    }));

    return applyApprovals(messages, found.approvals, found.relativePath).map(
      (m) => ({ ...m.diagnostic, message: m.message })
    );
  }

  function filterReport(uri, report) {
    if (!report || report.kind !== "full") return report;
    const filtered = { ...report, items: filterDiagnostics(uri, report.items) };
    if (report.relatedDocuments) {
      filtered.relatedDocuments = {};
      for (const [relatedUri, related] of Object.entries(
        report.relatedDocuments
      )) {
        filtered.relatedDocuments[relatedUri] = filterReport(
          relatedUri,
          related
        );
      }
    }
    return filtered;
  }

  function onApprovalsChanged() {
    if (clientSupportsRefresh) {
      writeMessage(clientOut, {
        jsonrpc: "2.0",
        id: `${OWN_REQUEST_PREFIX}${++ownRequestId}`,
        method: "workspace/diagnostic/refresh",
        params: null,
      });
    }
    for (const [uri, diagnostics] of lastPushed) {
      writeMessage(clientOut, {
        jsonrpc: "2.0",
        method: "textDocument/publishDiagnostics",
        params: { uri, diagnostics: filterDiagnostics(uri, diagnostics) },
      });
    }
  }

  function watch(approvalsPath) {
    if (watched.has(approvalsPath) || !watchInterval) return;
    watched.add(approvalsPath);
    fs.watchFile(approvalsPath, { interval: watchInterval }, (curr, prev) => {
      if (curr.mtimeMs !== prev.mtimeMs) onApprovalsChanged();
    });
  }

  // client -> server
  readMessages(clientIn, (message, raw) => {
    if (!message) return writeRaw(serverIn, raw);

    // Responses to requests the proxy sent itself are not for the server
    if (
      message.method === undefined &&
      typeof message.id === "string" &&
      message.id.startsWith(OWN_REQUEST_PREFIX)
    ) {
      return;
    }

    if (message.method === "initialize") {
      const caps = message.params && message.params.capabilities;
      clientSupportsRefresh = Boolean(
        caps &&
          caps.workspace &&
          caps.workspace.diagnostics &&
          caps.workspace.diagnostics.refreshSupport
      );
    }

    if (
      message.id !== undefined &&
      (message.method === "textDocument/diagnostic" ||
        message.method === "workspace/diagnostic")
    ) {
      pendingPulls.set(message.id, {
        method: message.method,
        uri:
          message.params &&
          message.params.textDocument &&
          message.params.textDocument.uri,
      });

      // Always ask for a full report: an "unchanged" answer would keep
      // results that were filtered with an older approvals.json
      if (message.params) {
        const params = { ...message.params };
        if (message.method === "textDocument/diagnostic") {
          delete params.previousResultId;
        } else {
          params.previousResultIds = [];
        }
        return writeMessage(serverIn, { ...message, params });
      }
    }

    writeRaw(serverIn, raw);
  });

  // server -> client
  readMessages(serverOut, (message, raw) => {
    if (!message) return writeRaw(clientOut, raw);

    if (message.method === "textDocument/publishDiagnostics" && message.params) {
      const { uri, diagnostics } = message.params;
      lastPushed.set(uri, diagnostics);
      return writeMessage(clientOut, {
        ...message,
        params: { ...message.params, diagnostics: filterDiagnostics(uri, diagnostics) },
      });
    }

    if (message.method === undefined && pendingPulls.has(message.id)) {
      const { method, uri } = pendingPulls.get(message.id);
      pendingPulls.delete(message.id);

      if (message.result) {
        let result = message.result;
        if (method === "textDocument/diagnostic") {
          result = filterReport(uri, result);
        } else if (Array.isArray(result.items)) {
          result = {
            ...result,
            items: result.items.map((report) => filterReport(report.uri, report)),
          };
        }
        return writeMessage(clientOut, { ...message, result });
      }
    }

    writeRaw(clientOut, raw);
  });

  return {
    close() {
      for (const approvalsPath of watched) fs.unwatchFile(approvalsPath);
      watched.clear();
    },
  };
}

module.exports = { createProxy, uriToPath };
