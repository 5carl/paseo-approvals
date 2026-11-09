import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { ApprovalsScreen } from "./client/screen";
import { TimelineCard } from "./client/timeline-card";
import { TIMELINE_KIND, listCards, timelineCard } from "./shared/cards";

function ApprovalsItem({ currentScreen, openScreen, theme }: PluginSidebarItemProps) {
  const list = useRpc(listCards);
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    const tick = () => list({ historyLimit: 0 }).then((r) => live && setCount(r.open.length)).catch(() => {});
    tick();
    const t = setInterval(tick, 3000);
    return () => { live = false; clearInterval(t); };
  }, [list]);
  const badge = count > 0 ? (
    <View style={{ minWidth: 20, paddingHorizontal: 6, height: 20, borderRadius: 10, backgroundColor: theme.colors.accent, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: theme.colors.accentForeground, fontSize: 11, fontWeight: "700" }}>{count > 99 ? "99+" : count}</Text>
    </View>
  ) : undefined;
  return <SidebarRow icon="Inbox" active={currentScreen?.screenId === "main"} onPress={() => openScreen({ screenId: "main" })} trailing={badge} />;
}

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addScreen({ id: "main", title: "Approvals", Component: ApprovalsScreen }),
    client.addSidebarHeaderItem({ id: "main", title: "Approvals", Component: ApprovalsItem }),
    client.addTimelineRenderer({ kind: TIMELINE_KIND, version: 1, schema: timelineCard, Component: TimelineCard }),
    client.addCommandCenterItem({
      id: "open",
      title: "Open Approvals",
      icon: "Inbox",
      context: "global",
      onSelect({ openScreen }) { openScreen({ screenId: "main" }); },
    }),
  ];
  return () => removers.forEach((r) => r());
}
