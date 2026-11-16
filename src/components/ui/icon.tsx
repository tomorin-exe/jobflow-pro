import type { ReactNode, SVGProps } from "react";

const paths = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  briefcase: <><rect x="3" y="7" width="18" height="14" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12a23 23 0 0 0 18 0M12 11v3" /></>,
  send: <><path d="m21 3-7 18-4-7-7-4L21 3ZM10 14 21 3" /></>,
  conversation: <><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2v-10A8.5 8.5 0 1 1 21 11.5Z" /><path d="M7 9h9M7 13h6" /></>,
  award: <><circle cx="12" cy="8" r="5" /><path d="m8.5 12-2 9 5.5-3 5.5 3-2-9" /></>,
  search: <><circle cx="10.8" cy="10.8" r="7.3" /><path d="m16 16 5 5" /></>,
  pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>,
  arrowUpRight: <><path d="M7 17 17 7M7 7h10v10" /></>,
  arrowRight: <><path d="M4 12h16m-6-6 6 6-6 6" /></>,
  leaf: <><path d="M20 3C8 2 2 8 5 15c6 6 15 1 15-12ZM4 21 15 10" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  edit: <><path d="m16 4 4 4M4 20l4-1L21 6a2.8 2.8 0 0 0-4-4L4 15l-1 6Z" /></>,
  trash: <><path d="M3 6h18M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M5 6l1 14h12l1-14M10 10v6M14 10v6" /></>,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof paths;

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {paths[name]}
    </svg>
  );
}
