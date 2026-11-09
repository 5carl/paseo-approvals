import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// One card per thing that needs the owner. Server-only data (nonces, request ids) never leaves the daemon.
// reply, permission and question come from Paseo itself; ask is anything a script, agent or adapter asks for.
export const cardKind = z.enum(["reply", "permission", "question", "ask", "tab", "image", "fyi"]);
export type CardKind = z.infer<typeof cardKind>;

export const cardOption = z.object({
  id: z.string(),
  label: z.string(),
  tone: z.enum(["primary", "secondary", "danger"]).optional(),
});
export type CardOption = z.infer<typeof cardOption>;

export const cardQuestion = z.object({
  key: z.string(),
  question: z.string(),
  header: z.string().optional(),
  multiSelect: z.boolean().optional(),
  options: z.array(z.object({ label: z.string(), description: z.string().optional() })),
});
export type CardQuestion = z.infer<typeof cardQuestion>;

// How an ask card looks: a lucide icon name, the small label over the title, and a color.
export const cardTone = z.enum(["accent", "warning", "danger", "success", "muted"]);
export type CardTone = z.infer<typeof cardTone>;
export const cardStyle = z.object({ icon: z.string().optional(), label: z.string().optional(), tone: cardTone.optional() });
export type CardStyle = z.infer<typeof cardStyle>;

export const card = z.object({
  id: z.string(),
  kind: cardKind,
  title: z.string(),
  body: z.string().optional(),
  detail: z.string().optional(),
  agentId: z.string().optional(),
  workspaceId: z.string().optional(),
  agentTitle: z.string().optional(),
  style: cardStyle.optional(),
  options: z.array(cardOption),
  questions: z.array(cardQuestion).optional(),
  url: z.string().optional(),
  hasImage: z.boolean().optional(),
  createdAt: z.number(),
  expiresAt: z.number().optional(),
  // "dismissed": set aside without answering. Still live, so it sits in History with Bring back.
  status: z.enum(["open", "dismissed", "done", "expired", "cleared"]),
  restoredAt: z.number().optional(),
  answer: z.string().optional(),
  answeredAt: z.number().optional(),
});
export type Card = z.infer<typeof card>;

export const listCards = defineRpc({
  name: "cards.list",
  input: z.object({ historyLimit: z.number().int().min(0).max(300).optional() }),
  output: z.object({ open: z.array(card), history: z.array(card) }),
});

export const answerCard = defineRpc({
  name: "cards.answer",
  input: z.object({
    id: z.string(),
    optionId: z.string().optional(),
    answers: z.record(z.string(), z.string()).optional(),
  }),
  output: z.object({ ok: z.boolean(), error: z.string().optional() }),
});

export const cardImage = defineRpc({
  name: "cards.image",
  input: z.object({ id: z.string() }),
  output: z.object({ dataUri: z.string().nullable() }),
});

export const restoreCard = defineRpc({
  name: "cards.restore",
  input: z.object({ id: z.string() }),
  output: z.object({ ok: z.boolean(), error: z.string().optional() }),
});

export const clearHistory = defineRpc({
  name: "cards.clear-history",
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
});

// The same card, mirrored into its agent's chat. Re-appended with the same id when it is answered.
export const TIMELINE_KIND = "approvals-card";
export const timelineCard = z.object({ card });
// Paseo already shows replies, permissions and questions in the chat; the rest are mirrored there.
export const mirrored = (c: { kind: CardKind; agentId?: string; mirror?: boolean }) =>
  !!c.agentId && (c.kind === "tab" || c.kind === "image" || (c.kind === "ask" && c.mirror !== false));

// Option ids every client and server agree on.
export const DISMISS = "dismiss";
// Set the card aside without answering it (moves to History, can be brought back).
export const SKIP = "skip";
export const ALLOW = "allow";
export const DENY = "deny";
// Default buttons for an ask with none given.
export const APPROVE = "approve";
