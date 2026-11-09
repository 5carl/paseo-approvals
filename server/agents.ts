// Cards from agents: permission prompts and questions (Claude, Codex, any provider), and finished turns
// whose reply ends with an [abcs] line (tech-bought-my-soul). Answers go back through the Paseo SDK.
import type { PaseoApi } from "@getpaseo/client";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { ALLOW, DENY, type CardOption, type CardQuestion } from "../shared/cards";
import { BLOCK_LINE, parseAbcs } from "tech-bought-my-soul/abcs";
import type { Store, StoredCard } from "./store";

type Json = Record<string, unknown>;
type Agent = { id: string; workspaceId: string | null; parentAgentId: string | null; title: string | null; cwd: string };
type Request = { id: string; name: string; kind: string; title?: string; description?: string; input?: Json; actions?: { id: string; label: string; behavior: "allow" | "deny"; variant?: string }[] };

const str = (v: unknown, max = 4000) => (typeof v === "string" ? v.slice(0, max) : undefined);
const agentTitle = (a: Agent) => a.title?.trim() || a.cwd.split("/").filter(Boolean).pop() || `Agent ${a.id.slice(0, 8)}`;
const base = (a: Agent) => ({ agentId: a.id, workspaceId: a.workspaceId ?? undefined, agentTitle: agentTitle(a) });

// What the tool wants to do, in one readable block.
function detailOf(r: Request): string | undefined {
  const i = r.input ?? {};
  if (typeof i.command === "string") return i.command.slice(0, 4000);
  const file = str(i.file_path) ?? str(i.path) ?? str(i.notebook_path);
  if (file) return [file, str(i.old_string, 600) && `- ${str(i.old_string, 600)}`, str(i.new_string, 600) && `+ ${str(i.new_string, 600)}`, str(i.content, 800)].filter(Boolean).join("\n");
  if (typeof i.plan === "string") return i.plan.slice(0, 4000);
  if (typeof i.url === "string") return i.url;
  const json = JSON.stringify(i, null, 1);
  return json && json !== "{}" ? json.slice(0, 2000) : undefined;
}

function questionsOf(r: Request): CardQuestion[] | null {
  const qs = r.input?.questions;
  if (!Array.isArray(qs) || qs.length === 0) return null;
  return qs.slice(0, 6).map((q: Json, n) => ({
    key: str(q.header, 200) || str(q.question, 1000) || `q${n}`,
    question: str(q.question, 1000) ?? "",
    header: str(q.header, 200),
    multiSelect: q.multiSelect === true,
    options: Array.isArray(q.options) ? q.options.slice(0, 8).map((o: Json) => ({ label: str(o.label, 200) ?? "", description: str(o.description, 400) })) : [],
  }));
}

export function attachAgents(server: PluginServerContext, store: Store, log: (o: object) => void) {
  let api: PaseoApi | null = null;
  const keep = (ctx: { paseo: PaseoApi }) => { api = ctx.paseo; };
  const bg = (where: string, p: Promise<unknown>) => p.catch((e) => log({ kind: "error", where, e: String(e?.message ?? e).slice(0, 160) }));

  function onPermission(agent: Agent, r: Request) {
    const questions = r.kind === "question" ? questionsOf(r) : null;
    if (questions) {
      store.add({
        ...base(agent), key: `perm:${agent.id}:${r.id}`, kind: "question",
        title: questions.length === 1 ? questions[0].question : `${questions.length} questions`,
        questions, options: [{ id: DENY, label: "Skip", tone: "secondary" }],
        priv: { requestId: r.id },
      });
      return;
    }
    const options: CardOption[] = r.actions?.length
      ? r.actions.map((a) => ({ id: `act:${a.id}`, label: a.label, tone: a.variant === "danger" || a.behavior === "deny" ? "danger" : a.variant === "secondary" ? "secondary" : "primary" }))
      : [{ id: ALLOW, label: "Allow", tone: "primary" }, { id: DENY, label: "Deny", tone: "danger" }];
    const actions = Object.fromEntries((r.actions ?? []).map((a) => [`act:${a.id}`, { actionId: a.id, behavior: a.behavior }]));
    store.add({
      ...base(agent), key: `perm:${agent.id}:${r.id}`, kind: "permission",
      title: r.title || (r.kind === "plan" ? "Plan ready" : r.name),
      body: r.description?.slice(0, 1000), detail: detailOf(r), options,
      priv: { requestId: r.id, actions },
    });
  }

  async function onTurnEnded(agent: Agent, turnId: string | null, timeline: readonly { type: string; text?: string }[]) {
    if (agent.parentAgentId || !api) return;
    let items = timeline;
    if (items.length === 0) {
      const page = await (api.agents.ref(agent.id).timeline as any).refetch({ direction: "tail", limit: 20 });
      items = (page?.entries ?? []).map((e: { item: { type: string; text?: string } }) => e.item);
    }
    const last = [...items].reverse().find((i) => i.type === "assistant_message");
    if (!last?.text) return;
    const options = parseAbcs(last.text);
    if (options.length === 0) return;
    for (const old of store.find((c) => c.kind === "reply" && c.agentId === agent.id)) store.close(old.id, "cleared", "Newer reply");
    const body = last.text.replace(BLOCK_LINE, "").trim();
    store.add({
      ...base(agent), key: `reply:${agent.id}:${turnId ?? Date.now()}`, kind: "reply",
      title: agentTitle(agent), body: body.length > 8000 ? `${body.slice(0, 8000)}…` : body,
      options: options.map((label, i) => ({ id: `r:${i}`, label, tone: i === 0 ? "primary" : "secondary" })),
      priv: { replies: options },
    });
  }

  const offs = [
    server.on("agent.permission_requested", (ev, ctx) => { keep(ctx); onPermission(ev.agent, ev.request as Request); }),
    server.on("agent.permission_resolved", (ev, ctx) => {
      keep(ctx);
      for (const c of store.find((c) => c.agentId === ev.agent.id && c.priv?.requestId === ev.requestId)) store.close(c.id, "cleared", "Answered in Paseo");
    }),
    server.on("agent.turn_started", (ev, ctx) => {
      keep(ctx);
      for (const c of store.find((c) => c.kind === "reply" && c.agentId === ev.agent.id)) store.close(c.id, "cleared", "Replied in chat");
    }),
    server.on("agent.turn_ended", (ev, ctx) => {
      keep(ctx);
      if (ev.outcome.kind === "completed") void bg("turn_ended", onTurnEnded(ev.agent, ev.turnId, ev.timeline as any));
    }),
    server.on("agent.archived", (ev) => { for (const c of store.find((c) => c.agentId === ev.agent.id && !c.priv?.blocking)) store.close(c.id, "cleared", "Agent archived"); }),
    server.on("agent.closed", (ev) => { for (const c of store.find((c) => c.agentId === ev.agent.id && (c.kind === "permission" || c.kind === "question"))) store.close(c.id, "cleared", "Agent closed"); }),
  ];

  // Returns an error string, or null when the answer went through.
  async function answer(c: StoredCard, optionId: string | undefined, answers: Record<string, string> | undefined, paseo: PaseoApi): Promise<string | null> {
    const ref = paseo.agents.ref(c.agentId!);
    if (c.kind === "reply") {
      const text = (c.priv?.replies as string[] | undefined)?.[Number(optionId?.slice(2))];
      if (!text) return "Unknown reply";
      await ref.send(text);
      store.close(c.id, "done", text);
      return null;
    }
    const requestId = String(c.priv?.requestId ?? "");
    if (c.kind === "question" && answers && Object.keys(answers).length > 0) {
      store.close(c.id, "done", Object.values(answers).join(", "));
      await ref.respondToPermission({ requestId, response: { behavior: "allow", updatedInput: { answers } } });
      return null;
    }
    const act = (c.priv?.actions as Record<string, { actionId: string; behavior: "allow" | "deny" }> | undefined)?.[optionId ?? ""];
    const allow = act ? act.behavior === "allow" : optionId === ALLOW;
    const label = c.options.find((o) => o.id === optionId)?.label ?? (allow ? "Allow" : "Deny");
    store.close(c.id, "done", label);
    await ref.respondToPermission({
      requestId,
      response: allow
        ? { behavior: "allow", ...(act ? { selectedActionId: act.actionId } : {}) }
        : { behavior: "deny", message: c.kind === "question" ? "The owner skipped this question." : "The owner denied this in Approvals.", ...(act ? { selectedActionId: act.actionId } : {}) },
    });
    return null;
  }

  return { answer, getApi: () => api, cleanup: () => offs.forEach((off) => off()) };
}
