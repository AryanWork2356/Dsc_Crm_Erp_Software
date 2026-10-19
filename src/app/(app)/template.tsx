/** Re-mounted on every page change, so each screen eases in instead of snapping. */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="anim-page">{children}</div>;
}
