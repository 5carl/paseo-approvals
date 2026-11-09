import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo, useState } from "react";
import { Image, Platform, Pressable, Text, View } from "react-native";
import { type Card, type CardOption, cardImage } from "../shared/cards";
import { ago, look } from "./kinds";
import { Markdown } from "./markdown";

// Cut long markdown at a paragraph break so a table or list is not split mid-row.
function preview(text: string) {
  const cut = text.lastIndexOf("\n\n", 700);
  return `${text.slice(0, cut > 200 ? cut : 700).trimEnd()}\n\n…`;
}

const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "ui-monospace, Menlo, monospace" });

export type CardActions = {
  choose(card: Card, optionId: string, answers?: Record<string, string>): void;
  openAgent?(agentId: string): void;
  openUrl(url: string): void;
  /** Set aside without answering. Absent where it makes no sense (inside the agent's own chat). */
  skip?(card: Card): void;
  /** Put a dismissed card back on top of the stack. */
  restore?(card: Card): void;
};

function useStyles(theme: PluginTheme, compact: boolean) {
  const c = theme.colors;
  return useMemo(
    () => ({
      card: { backgroundColor: c.surface1, borderColor: c.border, borderWidth: 1, borderRadius: 16, padding: compact ? 16 : 20, gap: 12 },
      top: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      kind: { fontSize: 12, fontWeight: "600" as const, letterSpacing: 0.4, textTransform: "uppercase" as const },
      meta: { color: c.foregroundMuted, fontSize: 12, flexShrink: 1 },
      spacer: { flex: 1 },
      title: { color: c.foreground, fontSize: compact ? 17 : 19, fontWeight: "600" as const, lineHeight: compact ? 23 : 26 },
      body: { color: c.foreground, fontSize: 14, lineHeight: 21 },
      muted: { color: c.foregroundMuted, fontSize: 13, lineHeight: 19 },
      detail: { backgroundColor: c.surface0, borderColor: c.border, borderWidth: 1, borderRadius: 10, padding: 10 },
      detailText: { color: c.foreground, fontFamily: MONO, fontSize: 12, lineHeight: 18 },
      image: { width: "100%" as const, height: compact ? 200 : 260, borderRadius: 10, backgroundColor: c.surface0 },
      buttons: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8 },
      btn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface2, flexGrow: compact ? 1 : 0, alignItems: "center" as const },
      primary: { backgroundColor: c.accent, borderColor: c.accent },
      danger: { borderColor: c.statusDanger },
      btnText: { color: c.foreground, fontSize: 14, fontWeight: "500" as const },
      primaryText: { color: c.accentForeground },
      dangerText: { color: c.statusDanger },
      link: { color: c.accent, fontSize: 13, fontWeight: "500" as const },
      chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface2 },
      chipOn: { backgroundColor: c.accent, borderColor: c.accent },
      q: { gap: 8 },
    }),
    [c, compact],
  );
}

function CardImage({ card, style }: { card: Card; style: object }) {
  const image = useRpc(cardImage);
  const [data, setData] = useState<{ dataUri: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    image({ id: card.id }).then((r) => live && setData(r)).catch(() => {});
    return () => { live = false; };
  }, [card.id, card.hasImage, image]);
  if (!data?.dataUri) return <View style={style} />;
  return <Image source={{ uri: data.dataUri }} style={style} resizeMode="contain" accessibilityLabel={card.title} />;
}

function Buttons({ card, options, actions, s, disabled }: { card: Card; options: CardOption[]; actions: CardActions; s: ReturnType<typeof useStyles>; disabled?: boolean }) {
  return (
    <View style={s.buttons}>
      {options.map((o) => (
        <Pressable
          key={o.id}
          accessibilityRole="button"
          accessibilityLabel={o.label}
          disabled={disabled}
          onPress={() => (o.id === "open" && card.url ? (actions.openUrl(card.url), actions.choose(card, o.id)) : actions.choose(card, o.id))}
          style={[s.btn, o.tone === "primary" ? s.primary : o.tone === "danger" ? s.danger : null, disabled ? { opacity: 0.5 } : null]}
        >
          <Text style={[s.btnText, o.tone === "primary" ? s.primaryText : o.tone === "danger" ? s.dangerText : null]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Questions({ card, actions, s }: { card: Card; actions: CardActions; s: ReturnType<typeof useStyles> }) {
  const qs = card.questions ?? [];
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const instant = qs.length === 1 && !qs[0].multiSelect;
  const ready = qs.every((q) => (picked[q.key] ?? []).length > 0);
  function pick(key: string, label: string, multi?: boolean) {
    if (instant) return actions.choose(card, "answer", { [key]: label });
    setPicked((p) => {
      const cur = p[key] ?? [];
      return { ...p, [key]: multi ? (cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]) : [label] };
    });
  }
  return (
    <View style={{ gap: 14 }}>
      {qs.map((q) => (
        <View key={q.key} style={s.q}>
          {qs.length > 1 ? <Text style={s.body}>{q.question}</Text> : null}
          <View style={s.buttons}>
            {q.options.map((o) => {
              const on = (picked[q.key] ?? []).includes(o.label);
              return (
                <Pressable key={o.label} accessibilityRole="button" accessibilityLabel={o.label} onPress={() => pick(q.key, o.label, q.multiSelect)} style={[s.chip, on ? s.chipOn : null]}>
                  <Text style={[s.btnText, on ? s.primaryText : null]}>{o.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {q.options.some((o) => o.description) ? (
            <Text style={s.muted}>{q.options.filter((o) => o.description).map((o) => `${o.label}: ${o.description}`).join("\n")}</Text>
          ) : null}
        </View>
      ))}
      <Buttons
        card={card}
        actions={{ ...actions, choose: (c, id) => (id === "send" ? actions.choose(c, "answer", Object.fromEntries(Object.entries(picked).map(([k, v]) => [k, v.join(", ")]))) : actions.choose(c, id)) }}
        options={[...(instant ? [] : [{ id: "send", label: "Send answers", tone: "primary" as const }]), ...card.options]}
        s={s}
        disabled={false}
      />
      {!instant && !ready ? <Text style={s.muted}>Pick an answer for each question.</Text> : null}
    </View>
  );
}

export function CardView({ card, theme, compact, actions, readOnly }: { card: Card; theme: PluginTheme; compact: boolean; actions: CardActions; readOnly?: boolean }) {
  const s = useStyles(theme, compact);
  const k = look(card);
  const tint = k.tint(theme.colors);
  const [expanded, setExpanded] = useState(false);
  const long = (card.body?.length ?? 0) > 700;
  const body = card.body && long && !expanded ? preview(card.body) : card.body;
  return (
    <View style={s.card}>
      <View style={s.top}>
        <Icon name={k.icon} size={16} color={tint} />
        <Text style={[s.kind, { color: tint }]}>{k.label}</Text>
        {card.agentTitle ? <Text style={s.meta} numberOfLines={1}>· {card.agentTitle}</Text> : null}
        <View style={s.spacer} />
        <Text style={s.meta}>{ago(card.createdAt)}</Text>
        {!readOnly && actions.skip ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Dismiss for now" hitSlop={10} onPress={() => actions.skip?.(card)} style={{ marginLeft: 4 }}>
            <Icon name="X" size={18} color={theme.colors.foregroundMuted} />
          </Pressable>
        ) : null}
      </View>
      {card.kind !== "reply" ? <Text style={s.title}>{card.title}</Text> : null}
      {body ? (
        <View>
          <Markdown text={body} theme={theme} onLink={actions.openUrl} />
          {long ? (
            <Pressable accessibilityRole="button" accessibilityLabel={expanded ? "Show less" : "Show more"} onPress={() => setExpanded((e) => !e)}>
              <Text style={[s.link, { marginTop: 6 }]}>{expanded ? "Show less" : "Show more"}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {card.url && card.kind === "ask" ? (
        <Pressable accessibilityRole="link" accessibilityLabel="Open link" onPress={() => actions.openUrl(card.url!)}>
          <Text style={s.link} numberOfLines={1}>{card.url}</Text>
        </Pressable>
      ) : null}
      {card.detail ? (
        <View style={s.detail}>
          <Text style={s.detailText} selectable numberOfLines={expanded ? undefined : 12} onPress={() => setExpanded((e) => !e)}>{card.detail}</Text>
        </View>
      ) : null}
      {card.hasImage ? <CardImage card={card} style={s.image} /> : null}
      {readOnly ? (
        card.status === "dismissed" && actions.restore ? (
          <View style={[s.top, { justifyContent: "space-between" }]}>
            <Text style={s.muted}>Dismissed, still waiting on you</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Bring back" onPress={() => actions.restore?.(card)} style={[s.btn, s.primary, { flexGrow: 0 }]}>
              <Text style={[s.btnText, s.primaryText]}>Bring back</Text>
            </Pressable>
          </View>
        ) : (
          <Text style={s.muted}>{card.status === "done" ? `You chose: ${card.answer ?? ""}` : card.answer ?? card.status}</Text>
        )
      ) : card.kind === "question" ? (
        <Questions card={card} actions={actions} s={s} />
      ) : (
        <Buttons card={card} options={card.options} actions={actions} s={s} />
      )}
      {card.agentId && actions.openAgent ? (
        <Pressable accessibilityRole="link" accessibilityLabel="Open chat" onPress={() => actions.openAgent?.(card.agentId!)}>
          <Text style={s.link}>Open chat</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
