"use client";
import * as React from "react";

/**
 * On a phone every table row is shown as a small card (see `.rt` in globals.css). Each value then needs its column name next
 * to it: this copies the header text onto the cells (data-label), and again whenever the rows change.
 */
export function TableLabels() {
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    const table = ref.current?.parentElement?.querySelector("table");
    if (!table) return;
    const label = () => {
      const heads = [...table.querySelectorAll("thead th")].map((th) => (th.textContent ?? "").trim());
      for (const tr of table.querySelectorAll("tbody tr")) {
        let col = 0;
        for (const td of tr.children) {
          const text = heads[col] ?? "";
          if (td.getAttribute("data-label") !== text) td.setAttribute("data-label", text);
          col += (td as HTMLTableCellElement).colSpan || 1;
        }
      }
    };
    label();
    const mo = new MutationObserver(label);
    mo.observe(table, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);
  return <span ref={ref} hidden />;
}
