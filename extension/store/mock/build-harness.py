#!/usr/bin/env python3
"""Generate popup harness pages from _template.html (store screenshots only)."""
import pathlib

HERE = pathlib.Path(__file__).parent
template = (HERE / "_template.html").read_text(encoding="utf-8")

PAGES = {
    "shot-site.html": (
        "Mynx — Site tab",
        "// Site tab renders automatically on init.",
    ),
    "shot-all.html": (
        "Mynx — All tab",
        """setTimeout(function () {
  document.querySelector('.tab[data-tab="all"]').click();
}, 250);
setTimeout(function () {
  var si = document.getElementById('search-input');
  si.value = 'git';
  si.dispatchEvent(new Event('input', { bubbles: true }));
}, 550);""",
    ),
    "shot-generator.html": (
        "Mynx — Generator tab",
        """setTimeout(function () {
  document.querySelector('.tab[data-tab="generator"]').click();
}, 250);""",
    ),
    "shot-saved.html": (
        "Mynx — Saved tab",
        """setTimeout(function () {
  document.querySelector('.tab[data-tab="saved"]').click();
}, 250);""",
    ),
}

for name, (title, init) in PAGES.items():
    out = template.replace("{{TITLE}}", title).replace("{{INIT_SCRIPT}}", init)
    (HERE / name).write_text(out, encoding="utf-8")
    print("wrote", name)
