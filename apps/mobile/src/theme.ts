// Design tokens shared in spirit with the Windows app: near-black surfaces, orange accent, rounded cards.
export const colors = {
  bg: "#0e0e10",
  surface: "#17171b",
  surface2: "#1f1f25",
  border: "#2a2a31",
  text: "#f4f4f5",
  muted: "#8b8b96",
  accent: "#f26b21",
  accentSoft: "rgba(242, 107, 33, 0.14)",
  cream: "#f6ecdf",
  creamText: "#1b1b1f",
  ok: "#3fbf7f",
  warn: "#e0a526",
  bad: "#e5534b",
} as const;

export const radius = { card: 16, control: 12, pill: 999 } as const;

export const spacing = { xs: 6, sm: 10, md: 16, lg: 22, xl: 28 } as const;
