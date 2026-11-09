// Cards on disk (<data>/cards.json, mode 600). Open cards plus the last 300 closed ones as history.
// `priv` holds server-only data (request ids, nonces) and is stripped before a card reaches a client.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Card } from "../shared/cards";
import { DATA, IMAGES } from "./config";

const FILE = path.join(DATA, "cards.json");
const HISTORY_MAX = 300;

export type Priv = Record<string, unknown>;
// answerId: the option id that closed the card. mirror: false keeps an ask card out of its agent's chat.
export type StoredCard = Card & { key?: string; priv?: Priv; answerId?: string; mirror?: boolean };

type Closer = (answer: string) => void;

export function createStore(log: (o: object) => void = () => {}) {
  fs.mkdirSync(IMAGES, { recursive: true, mode: 0o700 });
  let cards: StoredCard[] = [];
  const live = (c: StoredCard) => c.status === "open" || c.status === "dismissed";
  try { cards = JSON.parse(fs.readFileSync(FILE, "utf8")).cards ?? []; } catch {}
  // A waiter is a caller blocked on this card (an ask with wait). Lost on restart, so those reopen as expired.
  const waiters = new Map<string, Closer[]>();
  for (const c of cards) if ((c.status === "open" || c.status === "dismissed") && c.priv?.blocking) Object.assign(c, { status: "expired", answer: "Plugin restarted", answeredAt: Date.now() });
  const listeners = new Set<(c: StoredCard) => void>();
  const emit = (c: StoredCard) => { for (const l of listeners) try { l(c); } catch {} };

  function save() {
    const closed = cards.filter((c) => !live(c)).sort((a, b) => (b.answeredAt ?? 0) - (a.answeredAt ?? 0));
    for (const c of closed.slice(HISTORY_MAX)) {
      if (c.hasImage) fs.rmSync(path.join(IMAGES, `${c.id}.img`), { force: true });
      cards = cards.filter((x) => x !== c);
    }
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ cards }), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
  }

  const newId = () => `${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;

  function add(input: Omit<StoredCard, "id" | "createdAt" | "status"> & { id?: string }): StoredCard {
    if (input.key) {
      const dup = cards.find((c) => c.status === "open" && c.key === input.key);
      if (dup) return dup;
    }
    const c: StoredCard = { ...input, id: input.id ?? newId(), createdAt: Date.now(), status: "open" };
    cards.push(c);
    save();
    log({ kind: "card_open", card: c.kind, id: c.id });
    emit(c);
    return c;
  }

  // answer is what History shows; answerId is the option id handed to waiters (defaults to answer).
  function close(id: string, status: "done" | "expired" | "cleared", answer: string, answerId?: string) {
    const c = cards.find((x) => x.id === id);
    if (!c || !live(c)) return false;
    Object.assign(c, { status, answer: answer.slice(0, 300), answeredAt: Date.now(), answerId: status === "done" ? (answerId ?? answer) : undefined });
    save();
    log({ kind: "card_close", card: c.kind, id, status });
    emit(c);
    const ws = waiters.get(id) ?? [];
    waiters.delete(id);
    for (const w of ws) w(status === "done" ? c.answerId! : status);
    return true;
  }

  // Resolves with the chosen option id, or "expired" / "cleared". Already closed cards resolve at once.
  function wait(id: string) {
    const c = cards.find((x) => x.id === id);
    if (c && !live(c)) return Promise.resolve(c.status === "done" ? (c.answerId ?? c.answer ?? "") : c.status);
    return new Promise<string>((resolve) => waiters.set(id, [...(waiters.get(id) ?? []), resolve]));
  }

  const get = (id: string) => cards.find((c) => c.id === id);
  // After changing an open card in place (a screenshot arrived): persist and tell listeners.
  const touch = (c: StoredCard) => { save(); emit(c); };
  // Live cards, dismissed ones included, so a resolution elsewhere still closes them.
  const find = (pred: (c: StoredCard) => boolean) => cards.filter((c) => live(c) && pred(c));

  // Set aside without answering: no waiter is resolved, the agent keeps waiting.
  function dismiss(id: string) {
    const c = cards.find((x) => x.id === id);
    if (!c || c.status !== "open") return false;
    Object.assign(c, { status: "dismissed", answer: "Dismissed", answeredAt: Date.now() });
    save();
    emit(c);
    return true;
  }
  function restore(id: string) {
    const c = cards.find((x) => x.id === id);
    if (!c || c.status !== "dismissed") return false;
    Object.assign(c, { status: "open", answer: undefined, answeredAt: undefined, restoredAt: Date.now() });
    save();
    emit(c);
    return true;
  }
  const strip = ({ key: _k, priv: _p, answerId: _a, mirror: _m, ...c }: StoredCard): Card => c;

  function list(historyLimit = 100) {
    // Brought-back cards go to the front, newest first; the rest stay oldest first.
    const open = cards.filter((c) => c.status === "open").sort((a, b) => (b.restoredAt ?? 0) - (a.restoredAt ?? 0) || a.createdAt - b.createdAt).map(strip);
    const history = cards.filter((c) => c.status !== "open").sort((a, b) => (b.answeredAt ?? 0) - (a.answeredAt ?? 0)).slice(0, historyLimit).map(strip);
    return { open, history };
  }

  function sweep() {
    const now = Date.now();
    for (const c of cards) if (live(c) && c.expiresAt && c.expiresAt < now) close(c.id, "expired", "No answer in time");
  }

  function clearHistory() {
    // Dismissed cards stay: they are still live and can be brought back.
    for (const c of cards) if (!live(c) && c.hasImage) fs.rmSync(path.join(IMAGES, `${c.id}.img`), { force: true });
    cards = cards.filter(live);
    save();
  }

  function saveImage(id: string, buf: Buffer, mime: string) {
    fs.writeFileSync(path.join(IMAGES, `${id}.img`), Buffer.concat([Buffer.from(`${mime}\n`), buf]), { mode: 0o600 });
  }
  function readImage(id: string): string | null {
    try {
      const raw = fs.readFileSync(path.join(IMAGES, `${id}.img`));
      const nl = raw.indexOf(10);
      return `data:${raw.subarray(0, nl).toString()};base64,${raw.subarray(nl + 1).toString("base64")}`;
    } catch { return null; }
  }

  return { add, close, dismiss, restore, touch, strip, wait, get, find, list, sweep, clearHistory, saveImage, readImage, newId, onChange: (l: (c: StoredCard) => void) => { listeners.add(l); return () => listeners.delete(l); } };
}
export type Store = ReturnType<typeof createStore>;
