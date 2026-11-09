import type { PluginTheme } from "@getpaseo/plugin";
import type { Card, CardKind, CardTone } from "../shared/cards";

type Colors = PluginTheme["colors"];

export const KIND: Record<CardKind, { icon: string; label: string; tint: (c: Colors) => string }> = {
  reply: { icon: "MessageSquareReply", label: "Reply", tint: (c) => c.accent },
  permission: { icon: "ShieldQuestion", label: "Permission", tint: (c) => c.statusWarning },
  question: { icon: "CircleHelp", label: "Question", tint: (c) => c.accent },
  ask: { icon: "Hand", label: "Approval", tint: (c) => c.accent },
  tab: { icon: "AppWindow", label: "Your turn in a tab", tint: (c) => c.accent },
  image: { icon: "Image", label: "Image", tint: (c) => c.foregroundMuted },
  fyi: { icon: "Bell", label: "FYI", tint: (c) => c.foregroundMuted },
};

const TONE: Record<CardTone, (c: Colors) => string> = {
  accent: (c) => c.accent,
  warning: (c) => c.statusWarning,
  danger: (c) => c.statusDanger,
  success: (c) => c.statusSuccess,
  muted: (c) => c.foregroundMuted,
};

// The kind's look, with an ask card's own icon, label and color on top.
export function look(card: Pick<Card, "kind" | "style">) {
  const k = KIND[card.kind];
  const st = card.style;
  return { icon: st?.icon || k.icon, label: st?.label || k.label, tint: st?.tone ? TONE[st.tone] : k.tint };
}

export function ago(ms: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
