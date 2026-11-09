import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { type Card, SKIP, answerCard, clearHistory, listCards, restoreCard } from "../shared/cards";
import { type CardActions, CardView } from "./card-view";
import { ago, look } from "./kinds";
import { openExternal } from "./web";

export function ApprovalsScreen({ theme, layout, navigation, params }: PluginScreenProps) {
  const c = theme.colors;
  const compact = layout.compact;
  const list = useRpc(listCards);
  const answer = useRpc(answerCard);
  const clear = useRpc(clearHistory);
  const restore = useRpc(restoreCard);
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"pending" | "history">(params.tab === "history" ? "history" : "pending");
  const [gone, setGone] = useState<Set<string>>(new Set());
  const slide = useRef(new Animated.Value(0)).current;
  const { data, error } = useQuery({ queryKey: ["approvals-cards"], queryFn: () => list({ historyLimit: 150 }), refetchInterval: 2000 });

  const open = (data?.open ?? []).filter((x) => !gone.has(x.id));
  // The card on screen. When it leaves (answered, dismissed, cleared) the card now at the same spot takes over.
  const [focusId, setFocusId] = useState<string | null>(null);
  const lastIdx = useRef(0);
  const found = open.findIndex((x) => x.id === focusId);
  const idx = found >= 0 ? found : Math.min(lastIdx.current, Math.max(open.length - 1, 0));
  lastIdx.current = idx;
  const top = open[idx];
  const step = (d: number) => { if (open.length > 1) setFocusId(open[(idx + d + open.length) % open.length].id); };
  const others = open.length > 1 ? [...open.slice(idx + 1), ...open.slice(0, idx)] : [];

  const s = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: c.surface0 },
      content: { padding: compact ? 14 : 24, gap: 14, alignItems: "center" as const },
      column: { width: "100%" as const, maxWidth: 620, gap: 14 },
      tabs: { flexDirection: "row" as const, backgroundColor: c.surface1, borderRadius: 10, padding: 3, borderWidth: 1, borderColor: c.border },
      tab: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" as const },
      tabOn: { backgroundColor: c.surface2 },
      tabText: { color: c.foregroundMuted, fontSize: 14, fontWeight: "500" as const },
      tabTextOn: { color: c.foreground },
      peek: { height: 8, marginHorizontal: 14, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, backgroundColor: c.surface1, borderColor: c.border, borderWidth: 1, borderTopWidth: 0 },
      upNext: { gap: 6 },
      upTitle: { color: c.foregroundMuted, fontSize: 12, fontWeight: "600" as const, letterSpacing: 0.4, textTransform: "uppercase" as const },
      row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: c.surface1, borderWidth: 1, borderColor: c.border },
      nav: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const },
      navBtn: { padding: 8, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface1 },
      navText: { color: c.foregroundMuted, fontSize: 13, fontWeight: "500" as const },
      rowText: { color: c.foreground, fontSize: 14, flex: 1 },
      muted: { color: c.foregroundMuted, fontSize: 13 },
      empty: { alignItems: "center" as const, gap: 10, paddingVertical: 60 },
      emptyTitle: { color: c.foreground, fontSize: 18, fontWeight: "600" as const },
      clear: { alignSelf: "flex-end" as const, paddingVertical: 4 },
      link: { color: c.accent, fontSize: 13, fontWeight: "500" as const },
    }),
    [c, compact],
  );

  async function choose(card: Card, optionId: string, answers?: Record<string, string>) {
    // Slide the card away first so the next one is up at once; bring it back if the answer fails.
    Animated.timing(slide, { toValue: 1, duration: 180, useNativeDriver: true }).start(() => {
      setGone((g) => new Set(g).add(card.id));
      slide.setValue(0);
    });
    try {
      const r = await answer({ id: card.id, optionId, answers });
      if (!r.ok) toast.error(r.error ?? "That did not go through.");
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e));
      setGone((g) => { const n = new Set(g); n.delete(card.id); return n; });
    }
    void qc.invalidateQueries({ queryKey: ["approvals-cards"] });
  }

  const actions: CardActions = {
    choose: (card, id, answers) => void choose(card, id, answers),
    openAgent: navigation ? (agentId) => navigation.openAgent({ agentId }) : undefined,
    openUrl: (url) => void openExternal(url).catch(() => toast.error("Could not open the link.")),
    skip: (card) => void choose(card, SKIP),
    restore: (card) => {
      void restore({ id: card.id })
        .then((r) => {
          if (!r.ok) return toast.error(r.error ?? "Could not bring it back.");
          setGone((g) => { const n = new Set(g); n.delete(card.id); return n; });
          setFocusId(card.id);
          setTab("pending");
        })
        .catch((e) => toast.error(String(e?.message ?? e)))
        .finally(() => void qc.invalidateQueries({ queryKey: ["approvals-cards"] }));
    },
  };

  const tabs = (
    <View style={s.tabs}>
      {(["pending", "history"] as const).map((t) => (
        <Pressable key={t} accessibilityRole="tab" accessibilityState={{ selected: tab === t }} onPress={() => setTab(t)} style={[s.tab, tab === t ? s.tabOn : null]}>
          <Text style={[s.tabText, tab === t ? s.tabTextOn : null]}>{t === "pending" ? `Pending${open.length ? ` (${open.length})` : ""}` : "History"}</Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <View style={s.column}>
        {tabs}
        {error ? <Text style={[s.muted, { color: c.statusDanger }]}>{String((error as Error).message)}</Text> : null}
        {tab === "pending" ? (
          top ? (
            <>
              {open.length > 1 ? (
                <View style={s.nav}>
                  <Pressable accessibilityRole="button" accessibilityLabel="Previous card" hitSlop={8} onPress={() => step(-1)} style={s.navBtn}>
                    <Icon name="ChevronLeft" size={18} color={c.foreground} />
                  </Pressable>
                  <Text style={s.navText}>{idx + 1} of {open.length}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="Next card" hitSlop={8} onPress={() => step(1)} style={s.navBtn}>
                    <Icon name="ChevronRight" size={18} color={c.foreground} />
                  </Pressable>
                </View>
              ) : null}
              <View>
                <Animated.View
                  key={top.id}
                  style={{ opacity: slide.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }), transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [0, -60] }) }] }}
                >
                  <CardView card={top} theme={theme} compact={compact} actions={actions} />
                </Animated.View>
                {open.length > 1 ? <View style={s.peek} /> : null}
                {open.length > 2 ? <View style={[s.peek, { marginHorizontal: 28, height: 6 }]} /> : null}
              </View>
              {open.length > 1 ? (
                <View style={s.upNext}>
                  <Text style={s.upTitle}>Also waiting · tap to open</Text>
                  {others.map((x) => (
                    <Pressable key={x.id} accessibilityRole="button" accessibilityLabel={`Open ${x.title}`} onPress={() => setFocusId(x.id)} style={s.row}>
                      <Icon name={look(x).icon} size={14} color={look(x).tint(c)} />
                      <Text style={s.rowText} numberOfLines={1}>{x.kind === "reply" ? `${x.agentTitle ?? "Agent"} replied` : x.title}</Text>
                      <Text style={s.muted}>{ago(x.createdAt)}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </>
          ) : (
            <View style={s.empty}>
              <Icon name="CircleCheck" size={36} color={c.statusSuccess} />
              <Text style={s.emptyTitle}>All clear</Text>
              <Text style={s.muted}>{data ? "Nothing needs you right now." : "Loading…"}</Text>
            </View>
          )
        ) : (
          <>
            {(data?.history.length ?? 0) > 0 ? (
              <Pressable style={s.clear} accessibilityRole="button" onPress={() => void clear({}).then(() => qc.invalidateQueries({ queryKey: ["approvals-cards"] }))}>
                <Text style={s.link}>Clear history</Text>
              </Pressable>
            ) : (
              <View style={s.empty}><Text style={s.muted}>No history yet.</Text></View>
            )}
            {(data?.history ?? []).map((h) => (
              <View key={h.id} style={{ opacity: h.status === "dismissed" ? 1 : 0.85 }}>
                <CardView card={h} theme={theme} compact={compact} actions={actions} readOnly />
              </View>
            ))}
          </>
        )}
      </View>
    </ScrollView>
  );
}
