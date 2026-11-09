import { type PluginTimelineItemProps, useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { View } from "react-native";
import type { z } from "zod";
import { answerCard, type timelineCard } from "../shared/cards";
import { CardView } from "./card-view";
import { openExternal } from "./web";

// An Approvals card inside its agent's chat. Answering here closes it in Approvals too, and vice versa.
export function TimelineCard({ item, theme, layout }: PluginTimelineItemProps<z.output<typeof timelineCard>>) {
  const answer = useRpc(answerCard);
  const toast = useToast();
  const [picked, setPicked] = useState<string | null>(null);
  const card = item.data.card;
  const live = card.status === "open" || card.status === "dismissed";
  const done = !live || picked !== null;
  const shown = picked && live ? { ...card, status: "done" as const, answer: picked } : card;
  return (
    <View style={{ paddingVertical: layout.compact ? 6 : 8, maxWidth: 620 }}>
      <CardView
        card={shown}
        theme={theme}
        compact={layout.compact}
        readOnly={done}
        actions={{
          choose: (c, optionId, answers) => {
            setPicked(c.options.find((o) => o.id === optionId)?.label ?? "Sent");
            answer({ id: c.id, optionId, answers })
              .then((r) => { if (!r.ok) { toast.error(r.error ?? "That did not go through."); setPicked(null); } })
              .catch((e) => { toast.error(String(e?.message ?? e)); setPicked(null); });
          },
          openUrl: (url) => void openExternal(url).catch(() => toast.error("Could not open the link.")),
        }}
      />
    </View>
  );
}
