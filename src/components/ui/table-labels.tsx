"use client";
import * as React from "react";

/**
 * On a phone every table marked `rt` is shown as cards (see globals.css). Each value then needs its column name beside it:
 * this copies the header text onto the cells (data-label), on every page, and again whenever rows change. Mounted once in the layout.
 * A "#" column is marked too: on a phone it is hidden and the next cell becomes the card's title.
 */
function label(table: HTMLTableElement) {
  const heads = [...table.querySelectorAll("thead th")].map((th) => (th.textContent ?? "").trim());
  for (const tr of table.querySelectorAll("tbody tr, tfoot tr")) {
    let col = 0;
    for (const td of tr.children) {
      const text = heads[col] ?? "";
      if (td.getAttribute("data-label") !== text) td.setAttribute("data-label", text);
      if (text === "#") td.setAttribute("data-index", "");
      col += (td as HTMLTableCellElement).colSpan || 1;
    }
  }
}

export function TableLabels() {
  React.useEffect(() => {
    let queued = false;
    const run = () => { queued = false; document.querySelectorAll<HTMLTableElement>("table.rt").forEach(label); };
    run();
    const mo = new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);
  return null;
}
