import type { PluginTheme } from "@getpaseo/plugin";
import { Fragment, type ReactNode, useMemo } from "react";
import { Platform, ScrollView, Text, View, type TextStyle } from "react-native";
import { type Block, type Inline, parseMarkdown } from "../shared/markdown";

const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "ui-monospace, Menlo, monospace" });

// Card-sized markdown: paragraphs, headings, lists, quotes, code, tables. Links open through onLink.
export function Markdown({ text, theme, onLink, size = 14 }: { text: string; theme: PluginTheme; onLink(url: string): void; size?: number }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  const c = theme.colors;
  const base: TextStyle = { color: c.foreground, fontSize: size, lineHeight: Math.round(size * 1.5) };

  function inline(nodes: Inline[], key = ""): ReactNode {
    return nodes.map((n, i) => {
      const k = `${key}${i}`;
      switch (n.kind) {
        case "text": return <Fragment key={k}>{n.text}</Fragment>;
        case "break": return <Fragment key={k}>{"\n"}</Fragment>;
        case "bold": return <Text key={k} style={{ fontWeight: "700" }}>{inline(n.children, `${k}.`)}</Text>;
        case "italic": return <Text key={k} style={{ fontStyle: "italic" }}>{inline(n.children, `${k}.`)}</Text>;
        case "strike": return <Text key={k} style={{ textDecorationLine: "line-through" }}>{inline(n.children, `${k}.`)}</Text>;
        case "code": return <Text key={k} style={{ fontFamily: MONO, fontSize: size - 1, backgroundColor: c.surface2 }}>{n.text}</Text>;
        case "link": return <Text key={k} style={{ color: c.accent, textDecorationLine: "underline" }} onPress={() => onLink(n.url)}>{inline(n.children, `${k}.`)}</Text>;
        case "image": return <Text key={k} style={{ color: c.accent }} onPress={() => onLink(n.url)}>[{n.alt || "image"}]</Text>;
      }
    });
  }

  function block(b: Block, key: string): ReactNode {
    switch (b.kind) {
      case "paragraph": return <Text key={key} style={base} selectable>{inline(b.inlines)}</Text>;
      case "heading": return <Text key={key} style={[base, { fontWeight: "700", fontSize: size + Math.max(0, 5 - b.level) }]}>{inline(b.inlines)}</Text>;
      case "rule": return <View key={key} style={{ height: 1, backgroundColor: c.border }} />;
      case "code":
        return (
          <ScrollView key={key} horizontal style={{ backgroundColor: c.surface0, borderRadius: 8, borderWidth: 1, borderColor: c.border }} contentContainerStyle={{ padding: 10 }}>
            <Text style={{ color: c.foreground, fontFamily: MONO, fontSize: size - 2, lineHeight: Math.round((size - 2) * 1.5) }} selectable>{b.text.replace(/\n$/, "")}</Text>
          </ScrollView>
        );
      case "quote":
        return <View key={key} style={{ borderLeftWidth: 3, borderLeftColor: c.border, paddingLeft: 10, gap: 6 }}>{b.blocks.map((x, i) => block(x, `${key}.${i}`))}</View>;
      case "list":
        return (
          <View key={key} style={{ gap: b.tight ? 2 : 6 }}>
            {b.items.map((item, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 6 }}>
                <Text style={[base, { minWidth: b.ordered ? 20 : 12, color: c.foregroundMuted }]}>{b.ordered ? `${b.start + i}.` : "•"}</Text>
                <View style={{ flex: 1, gap: 4 }}>{item.blocks.map((x, j) => block(x, `${key}.${i}.${j}`))}</View>
              </View>
            ))}
          </View>
        );
      case "table": {
        const cell = (content: Inline[], j: number, head: boolean) => (
          <View key={j} style={{ minWidth: 90, maxWidth: 240, paddingHorizontal: 8, paddingVertical: 6, borderRightWidth: 1, borderColor: c.border }}>
            <Text style={[base, { fontSize: size - 1, textAlign: b.align[j] ?? "left", fontWeight: head ? "700" : "400" }]}>{inline(content)}</Text>
          </View>
        );
        return (
          <ScrollView key={key} horizontal style={{ borderWidth: 1, borderColor: c.border, borderRadius: 8 }}>
            <View>
              <View style={{ flexDirection: "row", backgroundColor: c.surface2 }}>{b.header.map((h, j) => cell(h, j, true))}</View>
              {b.rows.map((r, i) => <View key={i} style={{ flexDirection: "row", borderTopWidth: 1, borderColor: c.border }}>{r.map((x, j) => cell(x, j, false))}</View>)}
            </View>
          </ScrollView>
        );
      }
    }
  }

  return <View style={{ gap: 8 }}>{blocks.map((b, i) => block(b, String(i)))}</View>;
}
