// Shared behavior for all pages: theme toggle, copy buttons, tab groups,
// docs table of contents highlighting.

const root = document.documentElement;
const THEME_KEY = "eslint-exceptions-theme";

function currentTheme() {
  return (
    root.dataset.theme ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
  );
}

document.querySelector("#theme-toggle")?.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {}
});

// Copy buttons: <button class="copy" data-copy="#id"> or inside .code-block
const CHECK =
  '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z" clip-rule="evenodd"/></svg>';

for (const button of document.querySelectorAll(".copy")) {
  const original = button.innerHTML;
  button.addEventListener("click", async () => {
    const target = button.closest(".code-block")?.querySelector("pre");
    const text = (target?.innerText || "").replace(/\n$/, "");
    try {
      await navigator.clipboard.writeText(text);
      button.innerHTML = CHECK;
      button.classList.add("copied");
      button.setAttribute("aria-label", "Copied");
      setTimeout(() => {
        button.innerHTML = original;
        button.classList.remove("copied");
        button.setAttribute("aria-label", "Copy");
      }, 1500);
    } catch {}
  });
}

// Tab groups: <div class="tabs" data-tabs> with buttons aria-controls="panel"
for (const group of document.querySelectorAll("[data-tabs]")) {
  const buttons = [...group.querySelectorAll("button")];
  const select = (button) => {
    for (const b of buttons) {
      const selected = b === button;
      b.setAttribute("aria-selected", String(selected));
      document.getElementById(b.getAttribute("aria-controls")).hidden = !selected;
    }
  };
  buttons.forEach((b) => b.addEventListener("click", () => select(b)));
}

// Docs: highlight the section in view
const tocLinks = [...document.querySelectorAll(".docs-toc a")];
if (tocLinks.length && "IntersectionObserver" in window) {
  const byId = new Map(tocLinks.map((a) => [decodeURIComponent(a.hash.slice(1)), a]));
  const headings = [...byId.keys()]
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  const visible = new Set();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      }
      const first = headings.find((h) => visible.has(h));
      if (!first) return;
      for (const a of tocLinks) a.classList.toggle("active", a === byId.get(first.id));
    },
    { rootMargin: "-64px 0px -70% 0px" }
  );
  headings.forEach((h) => observer.observe(h));

  // Close the mobile TOC after picking a section
  const details = document.querySelector(".docs-toc");
  tocLinks.forEach((a) =>
    a.addEventListener("click", () => {
      if (matchMedia("(max-width: 900px)").matches) details.open = false;
    })
  );
}
