const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { PassThrough } = require("stream");
const { pathToFileURL } = require("url");
const { readMessages, writeMessage } = require("../src/lsp/framing");
const { createProxy } = require("../src/lsp/proxy");
const { findLocalBin } = require("../src/linters/run");
const { clearCache } = require("../src/utils/approvals-loader");

const exampleDir = path.join(__dirname, "../example");
const utilsPath = path.join(exampleDir, "src/utils.js");
const utilsUri = pathToFileURL(utilsPath).href;
const utilsText = fs.readFileSync(utilsPath, "utf8");
const utilsTextWithExtra = utilsText.replace(
  "// const _privateVar4",
  "const _privateVar4"
);

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

/** Collect messages from a stream; `next(predicate)` resolves the first match. */
function messageQueue(stream) {
  const received = [];
  const waiters = [];
  readMessages(stream, (message) => {
    received.push(message);
    for (const waiter of [...waiters]) {
      if (waiter.predicate(message)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(message);
      }
    }
  });
  return {
    received,
    next(predicate, timeout = 10000) {
      const found = received.find(predicate);
      if (found) {
        received.splice(received.indexOf(found), 1);
        return Promise.resolve(found);
      }
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve: (m) => {
            clearTimeout(timer);
            received.splice(received.indexOf(m), 1);
            resolve(m);
          },
        };
        const timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new Error("Timed out waiting for LSP message"));
        }, timeout);
        waiters.push(waiter);
      });
    },
  };
}

function diagnostic(code, message, line) {
  return {
    range: {
      start: { line, character: 6 },
      end: { line, character: 18 },
    },
    severity: 1,
    code,
    source: "oxc",
    message,
  };
}

const approvedDiagnostics = [
  diagnostic("eslint(no-underscore-dangle)", "_privateVar1", 2),
  diagnostic("eslint(no-underscore-dangle)", "_privateVar2", 3),
  diagnostic("eslint(no-underscore-dangle)", "_privateVar3", 4),
];

/** A proxy wired to in-memory streams, with a fake server on the other side. */
function setupFakeServer() {
  const clientToProxy = new PassThrough();
  const proxyToClient = new PassThrough();
  const proxyToServer = new PassThrough();
  const serverToProxy = new PassThrough();

  const proxy = createProxy({
    clientIn: clientToProxy,
    clientOut: proxyToClient,
    serverIn: proxyToServer,
    serverOut: serverToProxy,
    watchInterval: 0,
  });

  return {
    client: messageQueue(proxyToClient),
    server: messageQueue(proxyToServer),
    toServer: (m) => writeMessage(clientToProxy, { jsonrpc: "2.0", ...m }),
    toClient: (m) => writeMessage(serverToProxy, { jsonrpc: "2.0", ...m }),
    close: () => proxy.close(),
  };
}

test("proxy filters pushed diagnostics with approvals.json", async () => {
  const t = setupFakeServer();
  t.toClient({
    method: "textDocument/publishDiagnostics",
    params: {
      uri: utilsUri,
      diagnostics: [
        ...approvedDiagnostics,
        diagnostic("eslint(no-underscore-dangle)", "_privateVar4", 8),
        diagnostic("eslint(no-console)", "console", 9),
      ],
    },
  });

  const { params } = await t.client.next(
    (m) => m.method === "textDocument/publishDiagnostics"
  );
  assert.deepStrictEqual(
    params.diagnostics.map((d) => d.code),
    ["eslint(no-underscore-dangle)", "eslint(no-console)"]
  );
  assert.match(
    params.diagnostics[0].message,
    /_privateVar4 \(4 violations found, but only 3 approved/
  );
  assert.deepStrictEqual(params.diagnostics[0].range, {
    start: { line: 8, character: 6 },
    end: { line: 8, character: 18 },
  });
  t.close();
});

test("proxy filters pulled diagnostics and asks for full reports", async () => {
  const t = setupFakeServer();
  t.toServer({
    id: 7,
    method: "textDocument/diagnostic",
    params: { textDocument: { uri: utilsUri }, previousResultId: "abc" },
  });

  const request = await t.server.next((m) => m.id === 7);
  assert.strictEqual(request.params.previousResultId, undefined);

  t.toClient({
    id: 7,
    result: { kind: "full", resultId: "def", items: approvedDiagnostics },
  });

  const response = await t.client.next((m) => m.id === 7);
  assert.deepStrictEqual(response.result, {
    kind: "full",
    resultId: "def",
    items: [],
  });
  t.close();
});

test("proxy filters workspace diagnostic reports", async () => {
  const t = setupFakeServer();
  t.toServer({
    id: "w1",
    method: "workspace/diagnostic",
    params: { previousResultIds: [{ uri: utilsUri, value: "x" }] },
  });

  const request = await t.server.next((m) => m.id === "w1");
  assert.deepStrictEqual(request.params.previousResultIds, []);

  t.toClient({
    id: "w1",
    result: {
      items: [
        { uri: utilsUri, kind: "full", version: 1, items: approvedDiagnostics },
      ],
    },
  });

  const response = await t.client.next((m) => m.id === "w1");
  assert.deepStrictEqual(response.result.items[0].items, []);
  t.close();
});

test("proxy forwards everything else unchanged", async () => {
  const t = setupFakeServer();
  const otherUri = pathToFileURL("/no/approvals/here.js").href;

  t.toServer({ id: 1, method: "textDocument/hover", params: { x: 1 } });
  assert.deepStrictEqual((await t.server.next((m) => m.id === 1)).params, {
    x: 1,
  });

  t.toClient({ id: 1, result: { contents: "hi" } });
  assert.deepStrictEqual((await t.client.next((m) => m.id === 1)).result, {
    contents: "hi",
  });

  t.toClient({
    method: "textDocument/publishDiagnostics",
    params: { uri: otherUri, diagnostics: approvedDiagnostics },
  });
  const pushed = await t.client.next(
    (m) => m.method === "textDocument/publishDiagnostics"
  );
  assert.strictEqual(pushed.params.diagnostics.length, 3);
  t.close();
});

test("proxy handles messages split across chunks and multi-byte text", async () => {
  const clientIn = new PassThrough();
  const serverIn = new PassThrough();
  const proxy = createProxy({
    clientIn,
    clientOut: new PassThrough(),
    serverIn,
    serverOut: new PassThrough(),
    watchInterval: 0,
  });
  const server = messageQueue(serverIn);

  const body = Buffer.from(
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "x", params: "héllo ✓" })
  );
  const framed = Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`),
    body,
  ]);
  for (let i = 0; i < framed.length; i += 5) {
    clientIn.write(framed.subarray(i, i + 5));
  }

  assert.strictEqual((await server.next((m) => m.id === 2)).params, "héllo ✓");
  proxy.close();
});

test("proxy refreshes diagnostics when approvals.json changes", async () => {
  const os = require("os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exceptions-lsp-"));
  const approvalsPath = path.join(dir, "approvals.json");
  const uri = pathToFileURL(path.join(dir, "a.js")).href;
  fs.writeFileSync(approvalsPath, JSON.stringify({ "no-console": { "a.js": 1 } }));

  const clientIn = new PassThrough();
  const clientOut = new PassThrough();
  const serverOut = new PassThrough();
  const proxy = createProxy({
    clientIn,
    clientOut,
    serverIn: new PassThrough(),
    serverOut,
    watchInterval: 20,
  });
  const client = messageQueue(clientOut);

  try {
    writeMessage(clientIn, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { capabilities: { workspace: { diagnostics: { refreshSupport: true } } } },
    });
    writeMessage(serverOut, {
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: { uri, diagnostics: [diagnostic("eslint(no-console)", "console", 0)] },
    });
    const first = await client.next((m) => m.method === "textDocument/publishDiagnostics");
    assert.strictEqual(first.params.diagnostics.length, 0);

    // Remove the approval; mtime must change for the watcher to notice
    await new Promise((r) => setTimeout(r, 50));
    fs.writeFileSync(approvalsPath, JSON.stringify({}));
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(approvalsPath, future, future);

    const refresh = await client.next((m) => m.method === "workspace/diagnostic/refresh");
    assert.match(String(refresh.id), /^eslint-exceptions:/);

    const republished = await client.next((m) => m.method === "textDocument/publishDiagnostics");
    assert.strictEqual(republished.params.diagnostics.length, 1);

  } finally {
    proxy.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- End-to-end against the real `oxlint --lsp` ---

/** Start src/oxlint-lsp.js like the VS Code extension does. */
async function startServer({ pull }) {
  const child = spawn(
    process.execPath,
    [path.join(__dirname, "../src/oxlint-lsp.js"), "--lsp"],
    { cwd: exampleDir, stdio: ["pipe", "pipe", "inherit"] }
  );
  const client = messageQueue(child.stdout);
  const send = (m) => writeMessage(child.stdin, { jsonrpc: "2.0", ...m });

  const capabilities = pull
    ? {
        textDocument: { diagnostic: { dynamicRegistration: false } },
        workspace: { diagnostics: { refreshSupport: true } },
      }
    : { textDocument: { publishDiagnostics: {} } };

  send({
    id: 1,
    method: "initialize",
    params: {
      processId: process.pid,
      rootUri: pathToFileURL(exampleDir).href,
      workspaceFolders: [{ uri: pathToFileURL(exampleDir).href, name: "example" }],
      capabilities,
    },
  });
  await client.next((m) => m.id === 1);
  send({ method: "initialized", params: {} });

  // Answer server -> client requests (e.g. registerCapability, configuration)
  readMessages(child.stdout, (m) => {
    if (m && m.method && m.id !== undefined) {
      const result = m.method === "workspace/configuration" ? [] : null;
      send({ id: m.id, result });
    }
  });

  return {
    child,
    client,
    send,
    async stop() {
      send({ id: 999, method: "shutdown", params: null });
      await client.next((m) => m.id === 999).catch(() => {});
      send({ method: "exit", params: null });
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill();
          resolve();
        }, 3000);
        child.on("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}

async function diagnosticsFor(server, text, { pull }) {
  server.send({
    method: "textDocument/didOpen",
    params: {
      textDocument: { uri: utilsUri, languageId: "javascript", version: 1, text },
    },
  });

  if (!pull) {
    const m = await server.client.next(
      (m) =>
        m.method === "textDocument/publishDiagnostics" &&
        m.params.uri === utilsUri
    );
    return m.params.diagnostics;
  }

  server.send({
    id: 50,
    method: "textDocument/diagnostic",
    params: { textDocument: { uri: utilsUri } },
  });
  const m = await server.client.next((m) => m.id === 50);
  return m.result.items;
}

if (findLocalBin("oxlint", exampleDir)) {
  for (const pull of [false, true]) {
    const mode = pull ? "pull" : "push";

    test(`oxlint --lsp (${mode}): approved violations are hidden`, async () => {
      const server = await startServer({ pull });
      try {
        const diagnostics = await diagnosticsFor(server, utilsText, { pull });
        assert.deepStrictEqual(diagnostics, []);
      } finally {
        await server.stop();
      }
    });

    test(`oxlint --lsp (${mode}): violations above the approved count are shown`, async () => {
      const server = await startServer({ pull });
      try {
        const diagnostics = await diagnosticsFor(server, utilsTextWithExtra, {
          pull,
        });
        assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
        assert.strictEqual(diagnostics[0].code, "eslint(no-underscore-dangle)");
        assert.match(diagnostics[0].message, /4 violations found/);
      } finally {
        await server.stop();
      }
    });
  }
} else {
  console.log("- skipped oxlint --lsp tests (oxlint not installed)");
}

(async () => {
  console.log("\n=== Testing LSP proxy ===\n");
  for (const { name, fn } of tests) {
    clearCache();
    try {
      await fn();
      console.log(`✓ ${name}`);
    } catch (error) {
      console.error(`✗ ${name}`);
      console.error(`  ${error.stack}`);
      process.exitCode = 1;
    }
  }
  console.log("\n=== LSP tests completed ===\n");
})();
