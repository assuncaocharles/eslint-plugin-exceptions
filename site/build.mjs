// Builds the GitHub Pages site into site/dist.
//   node site/build.mjs          build once
//   node site/build.mjs --serve  build, then serve on http://localhost:4173

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import hljs from "highlight.js/lib/common";
import { Marked } from "marked";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const out = path.join(here, "dist");
const read = (file) => fs.readFileSync(path.join(here, file), "utf8");

const REPO = "https://github.com/assuncaocharles/eslint-plugin-exceptions";
const NPM = "https://www.npmjs.com/package/eslint-plugin-exceptions";
const SITE_URL = "https://assuncaocharles.github.io/eslint-plugin-exceptions/";
const OG_IMAGE_ALT =
  "eslint-plugin-exceptions: strict lint rules today, old code later. An approvals.json file next to a check that hides 15 approved violations and reports 1 new one.";

// ---------- Helpers ----------

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function highlight(code, lang) {
  const language = { sh: "bash", shell: "bash", jsonc: "json" }[lang] || lang;
  if (language && hljs.getLanguage(language)) {
    return hljs.highlight(code, { language }).value;
  }
  return escapeHtml(code);
}

function version() {
  if (process.env.SITE_VERSION) return process.env.SITE_VERSION;
  try {
    // Highest release tag, whether or not it is in HEAD's history
    const tags = execFileSync("git", ["tag", "--list", "v*", "--sort=-v:refname"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return tags.split("\n").find((t) => /^v\d+\.\d+\.\d+$/.test(t)) || "";
  } catch {
    return "";
  }
}

const ICONS = {
  copy: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="6.5" y="6.5" width="10" height="10" rx="2"/><path d="M13.5 6.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v7A1.5 1.5 0 0 0 5 13.5h1.5"/></svg>',
  github: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>',
  theme: '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M10 2a8 8 0 1 0 0 16V2Z"/><circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  plug: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M7 2.5v4M13 2.5v4M5 6.5h10v3a5 5 0 0 1-10 0v-3ZM10 14.5v3"/></svg>',
  bolt: '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M11.98 1.8a.75.75 0 0 1 .4.84L11.2 8h4.05a.75.75 0 0 1 .57 1.24l-7 8.25a.75.75 0 0 1-1.3-.66L8.79 11H4.75a.75.75 0 0 1-.57-1.24l7-8.25a.75.75 0 0 1 .8-.21Z"/></svg>',
  editor: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="m7 8.5-2 2 2 2M13 8.5l2 2-2 2"/></svg>',
  folders: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6A1.5 1.5 0 0 1 4 4.5h3.5l1.5 2h7A1.5 1.5 0 0 1 17.5 8v6.5A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5V6Z"/></svg>',
  shield: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2.5 3.5 5v4.5c0 4 2.8 7 6.5 8 3.7-1 6.5-4 6.5-8V5L10 2.5Z"/><path d="m7.5 10 1.75 1.75L12.75 8"/></svg>',
  swap: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h11.5l-3-3M16 13H4.5l3 3"/></svg>',
  link: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M8.5 11.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-1 1M11.5 8.5a3.5 3.5 0 0 0-5 0L4 11a3.5 3.5 0 0 0 5 5l1-1"/></svg>',
  file: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M5 2.5h6.5l3.5 3.5v10A1.5 1.5 0 0 1 13.5 17.5h-8.5A1.5 1.5 0 0 1 3.5 16V4A1.5 1.5 0 0 1 5 2.5Z"/><path d="M11.5 2.5V6H15"/></svg>',
  json: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M7 3.5c-1.5 0-2 .7-2 2v2c0 1-.5 2-1.5 2.5 1 .5 1.5 1.5 1.5 2.5v2c0 1.3.5 2 2 2M13 3.5c1.5 0 2 .7 2 2v2c0 1 .5 2 1.5 2.5-1 .5-1.5 1.5-1.5 2.5v2c0 1.3-.5 2-2 2"/></svg>',
  sliders: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3.5 6h8M15 6h1.5M3.5 14H5M8.5 14h8"/><circle cx="13" cy="6" r="1.75"/><circle cx="7" cy="14" r="1.75"/></svg>',
};

/** Expand {{icon:x}}, {{shell:...}} and {{json:...}} placeholders. */
function expand(html) {
  return html
    .replace(/\{\{icon:(\w+)\}\}/g, (_, name) => ICONS[name])
    .replace(/\{\{shell:([\s\S]*?)\}\}(?!\})/g, (_, code) => highlight(code, "bash"))
    .replace(/\{\{json:([\s\S]*?)\}\}(?!\})/g, (_, code) => highlight(code, "json"));
}

// ---------- Docs from README ----------

/** GitHub-compatible heading slugs, so README anchors keep working. */
function createSlugger() {
  const seen = new Map();
  return (text) => {
    const base = text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s/g, "-");
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count ? `${base}-${count}` : base;
  };
}

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function renderDocs() {
  const slug = createSlugger();
  const toc = [];
  const marked = new Marked({ gfm: true });

  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        const text = stripTags(html);
        const id = slug(text);
        if (depth === 2 || depth === 3) toc.push({ depth, id, html });
        const anchor =
          depth > 1
            ? `<a class="heading-anchor" href="#${id}" aria-label="Link to this section">#</a>`
            : "";
        return `<h${depth} id="${id}">${html}${anchor}</h${depth}>\n`;
      },
      code({ text, lang }) {
        const title = lang ? `<div class="code-title"><span>${escapeHtml(lang)}</span></div>` : "";
        return `<div class="code-block">${title}<pre><code>${highlight(text, lang)}</code></pre><button class="copy" aria-label="Copy">${ICONS.copy}</button></div>\n`;
      },
    },
  });

  // The README banner is for GitHub and npm; the site has its own header
  const readme = fs
    .readFileSync(path.join(root, "README.md"), "utf8")
    .replace(/<!-- site:skip -->[\s\S]*?<!-- \/site:skip -->\n*/g, "");
  const body = marked
    .parse(readme)
    .replace(/<table>/g, '<div class="table-scroll"><table>')
    .replace(/<\/table>/g, "</table></div>");

  let tocHtml = "<ol>";
  let open = false;
  for (const item of toc) {
    if (item.depth === 2) {
      if (open) tocHtml += "</ol></li>";
      tocHtml += `<li class="toc-h2"><a href="#${item.id}">${item.html}</a><ol>`;
      open = true;
    } else {
      tocHtml += `<li><a href="#${item.id}">${item.html}</a></li>`;
    }
  }
  if (open) tocHtml += "</ol></li>";
  tocHtml += "</ol>";
  tocHtml = tocHtml.replace(/<ol><\/ol>/g, "");

  return `<div class="docs">
  <details class="docs-toc" open>
    <summary>On this page</summary>
    <nav aria-label="On this page">${tocHtml}</nav>
  </details>
  <article class="prose">${body}</article>
</div>`;
}

// ---------- Layout ----------

const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#4f46e5"/><path d="M9 16.5l4.5 4.5L23 11.5" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  );

function layout({ file, page, title, description, body, scripts = [] }) {
  const url = new URL(file === "index.html" ? "" : file, SITE_URL).href;
  const image = new URL("og.png", SITE_URL).href;
  const v = version();
  const nav = [
    ["home", "index.html", "Home"],
    ["docs", "docs.html", "Docs"],
    ["playground", "playground.html", "Playground"],
  ]
    .map(
      ([id, href, label]) =>
        `<a href="${href}"${id === page ? ' aria-current="page"' : ""}>${label}</a>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}" />
<link rel="canonical" href="${url}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="eslint-plugin-exceptions" />
<meta property="og:url" content="${url}" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:image" content="${image}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="${escapeHtml(OG_IMAGE_ALT)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(title)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
<meta name="twitter:image" content="${image}" />
<meta name="twitter:image:alt" content="${escapeHtml(OG_IMAGE_ALT)}" />
<meta name="theme-color" content="#4f46e5" />
<link rel="icon" href="${FAVICON}" />
<script>
  try {
    const t = localStorage.getItem("eslint-exceptions-theme");
    if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  } catch {}
</script>
<link rel="stylesheet" href="assets/styles.css" />
</head>
<body>
<a class="visually-hidden" href="#main">Skip to content</a>
<header class="site-header">
  <div class="container">
    <a class="brand" href="index.html">
      <svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="var(--accent)"/><path d="M9 16.5l4.5 4.5L23 11.5" fill="none" stroke="var(--accent-text)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span class="brand-name">eslint-plugin-exceptions</span>
      ${v ? `<span class="brand-version">${escapeHtml(v)}</span>` : ""}
    </a>
    <nav class="site-nav" aria-label="Main">
      ${nav}
      <a class="nav-github" href="${REPO}" aria-label="GitHub repository">${ICONS.github.replace("<svg", '<svg width="16" height="16" style="vertical-align:-3px"')} <span>GitHub</span></a>
    </nav>
    <button class="icon-button" id="theme-toggle" type="button" aria-label="Toggle dark mode">${ICONS.theme}</button>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="site-footer">
  <div class="container">
    <span>MIT licensed${v ? ` · ${escapeHtml(v)}` : ""}</span>
    <nav aria-label="Footer">
      <a href="docs.html">Docs</a>
      <a href="playground.html">Playground</a>
      <a href="${REPO}">GitHub</a>
      <a href="${NPM}">npm</a>
      <a href="${REPO}/releases">Releases</a>
    </nav>
  </div>
</footer>
<script type="module" src="assets/site.js"></script>
${scripts.map((s) => `<script type="module" src="${s}"></script>`).join("\n")}
</body>
</html>
`;
}

// ---------- Build ----------

async function build() {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, "assets"), { recursive: true });

  await esbuild.build({
    entryPoints: {
      site: path.join(here, "src/site.js"),
      playground: path.join(here, "src/playground.js"),
    },
    outdir: path.join(out, "assets"),
    bundle: true,
    format: "esm",
    splitting: true,
    minify: true,
    sourcemap: process.argv.includes("--sourcemap"),
    target: "es2020",
    legalComments: "linked",
    logLevel: "warning",
  });
  fs.copyFileSync(path.join(here, "styles.css"), path.join(out, "assets/styles.css"));

  const pages = [
    {
      file: "index.html",
      page: "home",
      title: "eslint-plugin-exceptions: approve existing lint violations",
      description:
        "Turn on strict ESLint or oxlint rules today. Approve existing violations per file in approvals.json and fail only on new ones.",
      body: expand(read("pages/index.html")),
    },
    {
      file: "docs.html",
      page: "docs",
      title: "Docs · eslint-plugin-exceptions",
      description: "Install and configure eslint-plugin-exceptions with ESLint or oxlint, in CI and in the editor.",
      body: renderDocs(),
    },
    {
      file: "playground.html",
      page: "playground",
      title: "Playground · eslint-plugin-exceptions",
      description: "Try approvals.json in your browser: edit code, rules and approvals and see what gets reported.",
      body: expand(read("pages/playground.html")),
      scripts: ["assets/playground.js"],
    },
  ];

  for (const page of pages) {
    fs.writeFileSync(path.join(out, page.file), layout(page));
  }
  fs.writeFileSync(path.join(out, ".nojekyll"), "");
  fs.cpSync(path.join(here, "public"), out, { recursive: true });

  const files = fs.readdirSync(path.join(out, "assets")).filter((f) => f.endsWith(".js"));
  const sizes = files.map((f) => `${f} ${(fs.statSync(path.join(out, "assets", f)).size / 1024).toFixed(0)} KB`);
  console.log(`Built site/dist: ${sizes.join(", ")}`);
}

function serve(port = 4173) {
  const types = { ".png": "image/png", ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".map": "application/json", ".txt": "text/plain" };
  http
    .createServer((req, res) => {
      const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
      let file = path.join(out, url === "/" ? "index.html" : url);
      if (!file.startsWith(out) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404).end("Not found");
        return;
      }
      res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    })
    .listen(port, () => console.log(`Serving http://localhost:${port}`));
}

await build();
if (process.argv.includes("--serve")) serve();
