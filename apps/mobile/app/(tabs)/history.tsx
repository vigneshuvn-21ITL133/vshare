import { useMemo, useState } from "react";
import { Alert, FlatList, StyleSheet, Text, TextInput, View } from "react-native";
import * as Sharing from "expo-sharing";
import { Badge, Button, Card, Empty, Segmented, Title, formatBytes, formatWhen } from "../../src/components/ui";
import { useStore } from "../../src/state/store";
import type { HistoryEntry } from "../../src/state/types";
import { colors, spacing } from "../../src/theme";

type Filter = "all" | "send" | "receive";

export default function HistoryScreen() {
  const history = useStore((state) => state.history);
  const clearHistory = useStore((state) => state.clearHistory);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return history.filter((entry) => {
      if (filter !== "all" && entry.direction !== filter) return false;
      if (!needle) return true;
      return entry.name.toLowerCase().includes(needle) || entry.peer.toLowerCase().includes(needle);
    });
  }, [history, filter, query]);

  async function open(entry: HistoryEntry) {
    if (!entry.location) return;
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert("Not available", "Sharing is not available on this device.");
        return;
      }
      await Sharing.shareAsync(entry.location, { dialogTitle: entry.name });
    } catch {
      Alert.alert("File missing", "That file is no longer on this phone.");
    }
  }

  return (
    <View style={styles.screen}>
      <Title sub="Files sent and received on this phone.">History</Title>
      <TextInput style={styles.search} value={query} onChangeText={setQuery} placeholder="Search files or devices" placeholderTextColor={colors.muted} accessibilityLabel="Search history" />
      <View style={{ marginBottom: spacing.md }}>
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "send", label: "Sent" },
            { value: "receive", label: "Received" },
          ]}
        />
      </View>

      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Empty>{history.length === 0 ? "No transfers yet." : "No matches."}</Empty>}
        renderItem={({ item }) => (
          <Card>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.meta}>
                  {formatBytes(item.size)} · {item.direction === "send" ? "to" : "from"} {item.peer} · {formatWhen(item.when)}
                </Text>
              </View>
              <Badge
                label={item.status === "done" ? (item.direction === "send" ? "Sent" : "Received") : item.status}
                tone={item.status === "done" ? "ok" : item.status === "error" ? "bad" : "warn"}
              />
            </View>
            {item.location && (
              <View style={{ marginTop: spacing.sm }}>
                <Button label="Open or share" onPress={() => void open(item)} />
              </View>
            )}
          </Card>
        )}
        contentContainerStyle={{ paddingBottom: spacing.xl }}
      />

      <Button label="Clear history" variant="ghost" disabled={history.length === 0} onPress={() => clearHistory()} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.md },
  search: { backgroundColor: colors.surface2, borderColor: colors.border, borderWidth: 1, borderRadius: 12, color: colors.text, paddingHorizontal: 12, paddingVertical: 10, marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { color: colors.text, fontWeight: "600" },
  meta: { color: colors.muted, fontSize: 12, marginTop: 3 },
});
