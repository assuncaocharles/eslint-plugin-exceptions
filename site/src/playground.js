import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { setDiagnostics, lintGutter } from "@codemirror/lint";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { RULES, evaluate, approveCurrent, ruleLabel } from "./evaluate.js";
import { EXAMPLES } from "./examples.js";

let linter = null;
const $ = (selector) => document.querySelector(selector);

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword], color: "var(--syn-keyword)" },
  { tag: [t.string, t.special(t.string)], color: "var(--syn-string)" },
  { tag: [t.number, t.bool, t.null], color: "var(--syn-number)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--syn-function)" },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: "var(--syn-property)" },
  { tag: [t.punctuation, t.bracket, t.separator], color: "var(--syn-punct)" },
]);

const editorTheme = EditorView.theme({
  "&": { backgroundColor: "var(--bg-code)" },
});

// ---------- State ----------

const DEFAULT_EXAMPLE = EXAMPLES[1];

function exampleState(example) {
  return {
    example: example.id,
    filePath: example.filePath,
    code: example.code,
    approvals: example.approvals,
    rules: Object.fromEntries(RULES.map((r) => [r.id, example.rules[r.id] || "off"])),
    view: state?.view || "eslint",
    strict: false,
    showApproved: true,
  };
}

function encodeState(s) {
  const data = { e: s.example, p: s.filePath, c: s.code, a: s.approvals, r: s.rules, v: s.view, s: s.strict };
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeState(hash) {
  try {
    const base64 = hash.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const d = JSON.parse(new TextDecoder().decode(bytes));
    return {
      example: d.e || "custom",
      filePath: String(d.p ?? ""),
      code: String(d.c ?? ""),
      approvals: String(d.a ?? ""),
      rules: Object.fromEntries(RULES.map((r) => [r.id, ["off", "warn", "error"].includes(d.r?.[r.id]) ? d.r[r.id] : "off"])),
      view: d.v === "oxlint" ? "oxlint" : "eslint",
      strict: Boolean(d.s),
      showApproved: true,
    };
  } catch {
    return null;
  }
}

let state = null;
state = (location.hash.length > 1 && decodeState(location.hash.slice(1))) || exampleState(DEFAULT_EXAMPLE);

// ---------- Editors ----------

function createEditor(parent, doc, language, onChange) {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        basicSetup,
        language,
        lintGutter(),
        syntaxHighlighting(highlight),
        editorTheme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange(update.state.doc.toString());
        }),
      ],
    }),
  });
}

function setDoc(view, text) {
  if (view.state.doc.toString() === text) return;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}

$("#code-editor").textContent = "";
$("#approvals-editor").textContent = "";

const codeView = createEditor($("#code-editor"), state.code, javascript(), (text) => {
  state.code = text;
  markCustom();
  schedule();
});
const approvalsView = createEditor($("#approvals-editor"), state.approvals, json(), (text) => {
  state.approvals = text;
  markCustom();
  schedule();
});

// ---------- Controls ----------

const exampleSelect = $("#example");
for (const example of EXAMPLES) {
  exampleSelect.append(new Option(example.title, example.id));
}
exampleSelect.append(new Option("Custom", "custom"));

function markCustom() {
  if (state.example !== "custom") {
    state.example = "custom";
    exampleSelect.value = "custom";
    renderSummary();
  }
}

exampleSelect.addEventListener("change", () => {
  const example = EXAMPLES.find((e) => e.id === exampleSelect.value);
  if (!example) return;
  const view = state.view;
  state = exampleState(example);
  state.view = view;
  syncControls();
  run();
});

const filePathInput = $("#file-path");
filePathInput.addEventListener("input", () => {
  state.filePath = filePathInput.value;
  markCustom();
  schedule();
});

for (const button of document.querySelectorAll("[data-view]")) {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    syncControls();
    run();
  });
}

$("#strict").addEventListener("change", (e) => {
  state.strict = e.target.checked;
  run();
});
$("#show-approved").addEventListener("change", (e) => {
  state.showApproved = e.target.checked;
  run();
});

$("#approve").addEventListener("click", () => {
  state.approvals = approveCurrent(lastResult, state.approvals);
  setDoc(approvalsView, state.approvals);
  markCustom();
  run();
});

$("#share").addEventListener("click", async () => {
  const url = `${location.origin}${location.pathname}#${encodeState(state)}`;
  history.replaceState(null, "", url);
  const label = $("#share span");
  try {
    await navigator.clipboard.writeText(url);
    label.textContent = "Link copied";
  } catch {
    label.textContent = "Link in address bar";
  }
  setTimeout(() => (label.textContent = "Share"), 1800);
});

$("#reset").addEventListener("click", () => {
  const example = EXAMPLES.find((e) => e.id === state.example) || DEFAULT_EXAMPLE;
  const view = state.view;
  state = exampleState(example);
  state.view = view;
  syncControls();
  run();
});

// Rules list
const rulesList = $("#rules");
for (const rule of RULES) {
  const li = document.createElement("li");
  li.innerHTML = `
    <div class="rule-text">
      <div class="rule-name"></div>
      <div class="rule-desc"></div>
    </div>
    <div class="sev" role="group">
      <button type="button" data-level="off">off</button>
      <button type="button" data-level="warn">warn</button>
      <button type="button" data-level="error">error</button>
    </div>`;
  li.querySelector(".rule-name").textContent = rule.id;
  li.querySelector(".rule-desc").textContent = rule.description;
  li.querySelector(".sev").setAttribute("aria-label", `Severity for ${rule.id}`);
  for (const button of li.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      state.rules[rule.id] = button.dataset.level;
      markCustom();
      syncControls();
      run();
    });
  }
  li.dataset.rule = rule.id;
  rulesList.append(li);
}

// Result tabs
const tabs = [...document.querySelectorAll("#result-tabs button")];
for (const tab of tabs) {
  tab.addEventListener("click", () => selectTab(tab.dataset.tab));
}
function selectTab(name) {
  for (const tab of tabs) {
    const selected = tab.dataset.tab === name;
    tab.setAttribute("aria-selected", String(selected));
    document.getElementById(tab.getAttribute("aria-controls")).hidden = !selected;
  }
}

function syncControls() {
  exampleSelect.value = EXAMPLES.some((e) => e.id === state.example) ? state.example : "custom";
  filePathInput.value = state.filePath;
  setDoc(codeView, state.code);
  setDoc(approvalsView, state.approvals);
  for (const button of document.querySelectorAll("[data-view]")) {
    button.setAttribute("aria-pressed", String(button.dataset.view === state.view));
  }
  for (const li of rulesList.children) {
    for (const button of li.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(state.rules[li.dataset.rule] === button.dataset.level));
    }
  }
  $("#strict").checked = state.strict;
  $("#show-approved").checked = state.showApproved;
  renderSummary();
}

function renderSummary() {
  const example = EXAMPLES.find((e) => e.id === state.example);
  const el = $("#summary");
  if (!example) {
    el.innerHTML = "<strong>Custom setup.</strong> Edit the code, approvals.json or rules and the results update as you type.";
    return;
  }
  el.innerHTML = "";
  const strong = document.createElement("strong");
  strong.textContent = `${example.title}. `;
  el.append(strong, ...inlineCode(example.summary));
}

/** Render `backtick` spans as <code>. */
function inlineCode(text) {
  return text.split(/(`[^`]+`)/).map((part) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      const code = document.createElement("code");
      code.textContent = part.slice(1, -1);
      return code;
    }
    return document.createTextNode(part);
  });
}

// ---------- Run ----------

let timer = null;
let lastResult = null;

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(run, 150);
}

function toOffset(doc, line, column) {
  const lineCount = doc.lines;
  const l = doc.line(Math.min(Math.max(line || 1, 1), lineCount));
  return Math.min(l.from + Math.max((column || 1) - 1, 0), l.to);
}

function diagnosticsFor(result) {
  const doc = codeView.state.doc;
  const make = (m, severity, message) => {
    const from = toOffset(doc, m.line, m.column);
    let to = m.endLine ? toOffset(doc, m.endLine, m.endColumn) : from;
    if (to <= from) to = Math.min(from + 1, doc.length);
    return { from, to, severity, message, source: ruleLabel(m.ruleId, state.view) || undefined };
  };
  const list = result.reported.map((m) =>
    make(m, m.severity === 2 ? "error" : "warning", m.message)
  );
  if (state.showApproved) {
    for (const m of result.approved) {
      list.push(make(m, "info", `Approved in approvals.json: ${m.message}`));
    }
  }
  return list;
}

const ICONS = {
  error: '<svg class="problem-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM8.3 7.2a.75.75 0 0 0-1.1 1.1L8.9 10l-1.7 1.7a.75.75 0 1 0 1.1 1.1L10 11.1l1.7 1.7a.75.75 0 1 0 1.1-1.1L11.1 10l1.7-1.7a.75.75 0 0 0-1.1-1.1L10 8.9 8.3 7.2Z" clip-rule="evenodd"/></svg>',
  warning: '<svg class="problem-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M8.5 2.9a1.75 1.75 0 0 1 3 0l6.3 11.2A1.75 1.75 0 0 1 16.3 17H3.7a1.75 1.75 0 0 1-1.5-2.6L8.5 2.9ZM10 7a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 7Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd"/></svg>',
  approved: '<svg class="problem-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.86-9.81a.75.75 0 0 0-1.22-.88l-3.24 4.5-1.6-1.6a.75.75 0 1 0-1.06 1.06l2.22 2.22a.75.75 0 0 0 1.14-.09l3.76-5.21Z" clip-rule="evenodd"/></svg>',
};

function problemItem(m, kind) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `problem ${kind}`;
  button.innerHTML = `${ICONS[kind]}<span class="problem-msg"></span><span class="problem-loc"></span><span class="problem-meta"></span>`;
  button.querySelector(".problem-msg").textContent = m.message;
  button.querySelector(".problem-loc").textContent = `${m.line}:${m.column}`;
  button.querySelector(".problem-meta").textContent = m.ruleId
    ? `${ruleLabel(m.ruleId, state.view)}${kind === "approved" ? " · approved" : ""}`
    : "parsing error";
  button.addEventListener("click", () => {
    const pos = toOffset(codeView.state.doc, m.line, m.column);
    codeView.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    codeView.focus();
  });
  const li = document.createElement("li");
  li.append(button);
  return li;
}

function renderProblems(result) {
  const list = $("#problems");
  list.textContent = "";
  if (result.reported.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.innerHTML = "<strong>No unapproved violations</strong><span></span>";
    empty.querySelector("span").textContent = result.approved.length
      ? `${result.approved.length} approved violation(s) are hidden, just as in your editor.`
      : "Turn on a rule or add some code to see violations.";
    list.append(empty);
  }
  for (const m of result.reported) {
    list.append(problemItem(m, m.severity === 2 ? "error" : "warning"));
  }
  if (state.showApproved && result.approved.length) {
    const head = document.createElement("li");
    head.className = "problems-group";
    head.textContent = `Approved, hidden from the editor and CI (${result.approved.length})`;
    list.append(head);
    for (const m of result.approved) list.append(problemItem(m, "approved"));
  }
}

const STATUS = {
  ok: ["pill-ok", "Within approval"],
  over: ["pill-err", "Over the approved count"],
  unapproved: ["pill-err", "Not approved"],
  stale: ["pill-info", "Can be lowered"],
};

function renderRules(result) {
  const body = $("#rule-rows");
  body.textContent = "";
  if (result.perRule.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="4" class="empty">No violations or approvals for this file.</td>';
    body.append(tr);
  }
  for (const r of result.perRule) {
    const tr = document.createElement("tr");
    const [cls, text] = STATUS[r.status];
    tr.innerHTML = `<td><span class="rule-name"></span></td><td class="num"></td><td class="num"></td><td><span class="pill"></span></td>`;
    tr.querySelector(".rule-name").textContent = ruleLabel(r.ruleId, state.view);
    tr.children[1].textContent = r.found;
    tr.children[2].textContent = r.approved;
    const pill = tr.querySelector(".pill");
    pill.classList.add(cls);
    pill.textContent =
      r.status === "over"
        ? `${text} by ${r.found - r.approved}`
        : r.status === "stale"
          ? `${text} to ${r.found}`
          : text;
    body.append(tr);
  }

  const note = $("#rules-note");
  if (result.otherFiles.length) {
    note.hidden = false;
    note.textContent = `approvals.json also has entries for ${result.otherFiles.join(", ")}. They don't apply to ${result.relativePath}.`;
  } else {
    note.hidden = true;
  }
}

function renderCli(result) {
  const pre = $("#cli-output pre");
  pre.textContent = "";
  for (const line of result.cli) {
    const span = document.createElement("span");
    span.className = `t-${line.kind}`;
    span.textContent = line.text + "\n";
    pre.append(span);
  }
}

function renderStatus(result) {
  const status = $("#status");
  const failed = result.exitCode !== 0;
  status.classList.toggle("fail", failed);
  $("#status-text").textContent = failed ? "Check fails" : "Check passes";
  const parts = [];
  parts.push(`${result.reported.length} reported`);
  parts.push(`${result.approved.length} approved`);
  if (result.stale.length) parts.push(`${result.stale.length} can be lowered`);
  $("#status-sub").textContent = parts.join(" · ");

  $("#count-problems").textContent = result.reported.length;
  $("#count-rules").textContent = result.perRule.length;
  $("#approve").disabled = Boolean(result.approvalsError);
}

function run() {
  if (!linter) return;
  const result = evaluate({
    linter,
    code: state.code,
    filePath: state.filePath,
    approvalsText: state.approvals,
    rules: state.rules,
    view: state.view,
    strict: state.strict,
  });
  lastResult = result;

  codeView.dispatch(setDiagnostics(codeView.state, diagnosticsFor(result)));

  const error = $("#approvals-error");
  error.hidden = !result.approvalsError;
  error.textContent = result.approvalsError ? `${result.approvalsError}. Using no approvals until it's fixed.` : "";

  renderStatus(result);
  renderProblems(result);
  renderRules(result);
  renderCli(result);

  if (location.hash) {
    history.replaceState(null, "", `${location.pathname}#${encodeState(state)}`);
  }
}

syncControls();
selectTab("problems");
$("#status-text").textContent = "Loading ESLint…";

// ESLint is most of the bundle; load it after the editors are on screen
import("eslint-linter-browserify")
  .then(({ Linter }) => {
    linter = new Linter();
    run();
    document.body.dataset.ready = "true";
  })
  .catch((error) => {
    $("#status-text").textContent = "Could not load ESLint";
    $("#status-sub").textContent = error.message;
  });
