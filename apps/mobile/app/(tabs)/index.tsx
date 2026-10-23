import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Badge, Button, Card, Empty, Progress, formatBytes, formatWhen, percent } from "../../src/components/ui";
import { useStore } from "../../src/state/store";
import { colors, radius, spacing } from "../../src/theme";

const STATE_LABEL: Record<string, string> = {
  preparing: "Preparing",
  connecting: "Connecting",
  verifying: "Verify code",
  waiting: "Waiting for approval",
  sending: "Sending",
  receiving: "Receiving",
  paused: "Paused",
};

export default function HomeScreen() {
  const { listen, localIp, online, transfers, history, settings } = useStore();
  const recent = history.slice(0, 5);
  const address = localIp ? `${localIp}:${listen.port}` : null;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Share files.{"\n"}<Text style={{ color: colors.accent }}>No limits.</Text></Text>
        <Text style={styles.heroSub}>Encrypted, local transfer between this phone and your PC. Nothing leaves your WiFi.</Text>
        <View style={styles.statusRow}>
          <View style={[styles.dot, online && listen.listening && styles.dotOn]} />
          <Text style={styles.statusText}>
            {!online ? "Not connected to WiFi" : listen.listening && address ? `Listening on ${address}` : listen.error ?? "Receiving is off"}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <ActionCard label="Send Files" hint="Pick files and send them to a PC." icon="↑" onPress={() => router.navigate("/send")} />
        <ActionCard label="Receive Files" hint="Show the QR code for the PC to scan." icon="↓" onPress={() => router.navigate("/receive")} />
      </View>

      <Card>
        <Text style={styles.sectionTitle}>Active transfers</Text>
        {transfers.length === 0 && <Empty>Nothing is transferring right now.</Empty>}
        {transfers.map((transfer) => {
          const pct = percent(transfer.bytesDone, transfer.totalBytes);
          const canControl = transfer.state === "sending" || transfer.state === "receiving" || transfer.state === "paused";
          return (
            <View key={transfer.id} style={styles.transfer}>
              <View style={styles.rowBetween}>
                <Text style={styles.fileName} numberOfLines={1}>
                  {transfer.fileNames.length === 1 ? transfer.fileNames[0] : `${transfer.fileCount} files`}
                </Text>
                <Badge label={STATE_LABEL[transfer.state] ?? transfer.state} tone={transfer.state === "paused" ? "warn" : transfer.state === "verifying" || transfer.state === "waiting" ? "accent" : "default"} />
              </View>
              <Text style={styles.meta}>
                {transfer.direction === "send" ? "To" : "From"} {transfer.peer} · {pct}% of {formatBytes(transfer.totalBytes)}
                {transfer.verificationCode ? ` · Code ${transfer.verificationCode}` : ""}
              </Text>
              <Progress value={pct} tone={transfer.state === "done" ? "done" : "default"} />
              {canControl && (
                <View style={styles.controls}>
                  <View style={{ flex: 1 }}>
                    <Button label={transfer.paused ? "Resume" : "Pause"} onPress={() => useStore.getState().transferAction(transfer.id, transfer.paused ? "resume" : "pause")} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button label="Cancel" variant="danger" onPress={() => useStore.getState().transferAction(transfer.id, "cancel")} />
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </Card>

      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>Recent activity</Text>
          <Button label="View all" variant="ghost" onPress={() => router.navigate("/history")} />
        </View>
        {recent.length === 0 && <Empty>No transfers yet.</Empty>}
        {recent.map((entry) => (
          <View key={entry.id} style={styles.recentRow}>
            <View style={styles.fileIcon}><Text style={{ color: colors.accent }}>{entry.direction === "send" ? "↑" : "↓"}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fileName} numberOfLines={1}>{entry.name}</Text>
              <Text style={styles.meta}>{formatBytes(entry.size)} · {entry.direction === "send" ? "Sent" : "Received"} · {formatWhen(entry.when)}</Text>
            </View>
            <Badge label={entry.status === "done" ? "Done" : entry.status} tone={entry.status === "done" ? "ok" : entry.status === "error" ? "bad" : "default"} />
          </View>
        ))}
      </Card>

      <Text style={styles.footnote}>
        Device name: {settings.deviceName}. Nearby-device discovery is planned for a later release.
      </Text>
    </ScrollView>
  );
}

function ActionCard({ label, hint, icon, onPress }: { label: string; hint: string; icon: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.actionCard, pressed && { opacity: 0.85 }]}>
      <Text style={styles.actionIcon}>{icon}</Text>
      <Text style={styles.actionLabel}>{label}</Text>
      <Text style={styles.actionHint}>{hint}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  hero: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.card, padding: spacing.lg, marginBottom: spacing.md },
  heroTitle: { color: colors.text, fontSize: 28, fontWeight: "800", lineHeight: 34 },
  heroSub: { color: colors.muted, marginTop: spacing.sm, fontSize: 14, lineHeight: 20 },
  statusRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.md },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.muted, marginRight: 8 },
  dotOn: { backgroundColor: colors.ok },
  statusText: { color: colors.muted, fontSize: 13, flexShrink: 1 },
  actions: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  actionCard: { flex: 1, backgroundColor: colors.cream, borderRadius: radius.card, padding: spacing.md, minHeight: 128, gap: 4 },
  actionIcon: { fontSize: 22, color: colors.accent, fontWeight: "700" },
  actionLabel: { fontSize: 16, fontWeight: "700", color: colors.creamText },
  actionHint: { fontSize: 12, color: "#555" },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: "600", marginBottom: spacing.sm },
  transfer: { paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  fileName: { color: colors.text, fontWeight: "600", flexShrink: 1, fontSize: 14 },
  meta: { color: colors.muted, fontSize: 12, marginVertical: 6 },
  controls: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  recentRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  fileIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center" },
  footnote: { color: colors.muted, fontSize: 12, textAlign: "center", marginTop: spacing.sm },
});
