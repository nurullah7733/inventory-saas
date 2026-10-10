import type { SVGProps } from "react";

const paths = {
  dashboard: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  sales: "M6 3h12v18l-3-2-3 2-3-2-3 2z M9 7h6 M9 11h6 M9 15h3",
  inventory: "m3 7 9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10 M7 5l9 4",
  categories: "M3 4h7l3 3h8v13H3z M3 9h18",
  stock: "M3 3h18v18H3z M3 9h18 M3 15h18 M9 3v18 M15 3v18",
  purchases: "M3 3h2l3 12h11l2-8H6 M9 20h.01 M18 20h.01",
  search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 m5 12 6 6",
  bell: "M6 8a6 6 0 0 1 12 0v6l2 3H4l2-3z M10 21h4",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 11v5 M12 7h.01",
  calendar: "M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16",
  people: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87",
  finance: "M3 5h18v14H3z M3 9h18 M7 15h3 M16 13h2",
  wallet: "M20 8V5H6a3 3 0 0 0 0 6h15v9H6a3 3 0 0 1-3-3V8 M21 12h-5v5h5 M17 14.5h.01",
  reports: "M4 3v18h17 M8 16v-5 M13 16V7 M18 16V4",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  close: "m6 6 12 12 M6 18 18 6",
  arrow: "M5 12h14 m-5-5 5 5-5 5",
  chevron: "m9 5 7 7-7 7",
  refresh: "M20 7v5h-5 M4 17v-5h5 M6 6a8 8 0 0 1 14 6 M18 18a8 8 0 0 1-14-6",
  logout: "M9 3H4v18h5 M10 12h11 m-4-4 4 4-4 4",
  lock: "M6 10h12v11H6z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5 19 19 M5 19l1.5-1.5 M17.5 6.5 19 5",
  moon: "M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13z",
  monitor: "M3 4h18v13H3z M12 17v4 M8 21h8",
} as const;
export type AppIconName = keyof typeof paths;

export function AppIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: keyof typeof paths }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name]} /></svg>;
}
