import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { router } from "expo-router";
import type { BluetoothDevice } from "react-native-bluetooth-classic";
import { ensureBluetoothReady, pairedBluetoothDevices } from "../../src/net/bluetooth";
import { Badge, Button, Card, Empty, Title, formatBytes } from "../../src/components/ui";
import { useStore } from "../../src/state/store";
import type { SendableFile } from "../../src/state/types";
import { colors, radius, spacing } from "../../src/theme";

export default function SendScreen() {
  const pendingTarget = useStore((state) => state.pendingTarget);
  const setPendingTarget = useStore((state) => state.setPendingTarget);
  const sendFiles = useStore((state) => state.sendFiles);
  const sendFilesBluetooth = useStore((state) => state.sendFilesBluetooth);
  const [btDevices, setBtDevices] = useState<BluetoothDevice[] | null>(null);
  const [files, setFiles] = useState<SendableFile[]>([]);
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The scanner hands its result back through the store.
  useEffect(() => {
    if (pendingTarget) {
      setTarget(pendingTarget);
      setError(null);
      setPendingTarget(null);
    }
  }, [pendingTarget, setPendingTarget]);

  async function pickFiles() {
    try {
      const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true, type: "*/*" });
      if (result.canceled) return;
      const picked: SendableFile[] = result.assets.map((asset) => ({
        uri: asset.uri,
        name: asset.name,
        size: asset.size ?? safeSize(asset.uri),
        mime: asset.mimeType ?? "application/octet-stream",
      }));
      setFiles((current) => [...current, ...picked.filter((item) => !current.some((file) => file.uri === item.uri))]);
    } catch (err) {
      Alert.alert("Could not pick files", err instanceof Error ? err.message : "Try again.");
    }
  }

  async function send() {
    setError(null);
    setBusy(true);
    const outcome = await sendFiles(target, files);
    setBusy(false);
    if (outcome.ok) {
      setFiles([]);
      router.navigate("/");
    } else {
      setError(outcome.error);
    }
  }

  async function loadPaired() {
    setError(null);
    const ready = await ensureBluetoothReady();
    if (!ready.ok) {
      setError(ready.error);
      return;
    }
    setBtDevices(await pairedBluetoothDevices());
  }

  async function sendToBluetooth(address: string) {
    setError(null);
    setBusy(true);
    const outcome = await sendFilesBluetooth(address, files);
    setBusy(false);
    if (outcome.ok) {
      setFiles([]);
      router.navigate("/");
    } else {
      setError(outcome.error);
    }
  }

  const total = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Title sub="Choose files, then pair with the PC.">Send Files</Title>

      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>Files ({files.length})</Text>
          {files.length > 0 && <Button label="Clear" variant="ghost" onPress={() => setFiles([])} />}
        </View>
        {files.length === 0 && <Empty>No files selected.</Empty>}
        {files.map((file) => (
          <View key={file.uri} style={styles.fileRow}>
            <View style={styles.fileIcon}><Text style={{ color: colors.accent }}>▤</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fileName} numberOfLines={1}>{file.name}</Text>
              <Text style={styles.meta}>{formatBytes(file.size)}</Text>
            </View>
            <Button label="✕" variant="ghost" onPress={() => setFiles((current) => current.filter((item) => item.uri !== file.uri))} />
          </View>
        ))}
        <View style={{ marginTop: spacing.sm }}>
          <Button label="Add files" onPress={() => void pickFiles()} full />
        </View>
      </Card>

      <Card>
        <Text style={styles.cardTitle}>Receiver</Text>
        <Text style={styles.label}>Pairing link or address</Text>
        <TextInput
          style={styles.input}
          value={target}
          onChangeText={(value) => setTarget(value)}
          placeholder="vshare://pair?... or 192.168.1.23:47800"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Pairing link or address"
        />
        <View style={{ marginTop: spacing.sm, flexDirection: "row", gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button label="Scan PC's QR code" onPress={() => router.navigate("/scan")} full />
          </View>
        </View>
        <Text style={styles.hint}>A scanned code is one-time use and expires after two minutes. Typing an address also works if manual connections are allowed in Settings.</Text>
        {error && <Text style={styles.error}>{error}</Text>}
      </Card>

      <Card>
        <Text style={styles.cardTitle}>Send over Bluetooth</Text>
        <Text style={styles.hint}>Pair the PC in Android Bluetooth settings first, then choose it below. The PC must accept Bluetooth transfers.</Text>
        <View style={{ marginTop: spacing.sm }}>
          <Button label="Show paired PCs" variant="ghost" full onPress={() => void loadPaired()} />
        </View>
        {btDevices && btDevices.length === 0 && <Empty>No paired devices. Pair the PC in Android Bluetooth settings.</Empty>}
        {btDevices?.map((device) => (
          <View key={device.address} style={styles.fileRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fileName} numberOfLines={1}>{device.name || device.address}</Text>
              <Text style={styles.meta}>{device.address}</Text>
            </View>
            <Button label="Send" variant="primary" disabled={busy || files.length === 0} onPress={() => void sendToBluetooth(device.address)} />
          </View>
        ))}
      </Card>

      <View style={styles.footer}>
        <Text style={styles.meta}>{files.length} file(s) · {formatBytes(total)}</Text>
        <Badge label={busy ? "Connecting" : "Ready"} tone={busy ? "accent" : "default"} />
      </View>
      <Button
        label={busy ? "Connecting..." : `Send ${files.length > 0 ? `${files.length} file(s)` : ""}`.trim()}
        variant="primary"
        full
        disabled={busy || files.length === 0 || target.trim() === ""}
        onPress={() => void send()}
      />
    </ScrollView>
  );
}

function safeSize(uri: string): number {
  try {
    return new File(uri).size ?? 0;
  } catch {
    return 0;
  }
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: "600", marginBottom: spacing.sm },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  fileRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  fileIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center" },
  fileName: { color: colors.text, fontWeight: "600" },
  meta: { color: colors.muted, fontSize: 12 },
  label: { color: colors.muted, fontSize: 12, marginBottom: 6 },
  input: { backgroundColor: colors.surface2, borderColor: colors.border, borderWidth: 1, borderRadius: radius.control, color: colors.text, paddingHorizontal: 12, paddingVertical: 11, fontFamily: "monospace", fontSize: 13 },
  hint: { color: colors.muted, fontSize: 12, marginTop: spacing.sm, lineHeight: 17 },
  error: { color: colors.bad, fontSize: 13, marginTop: spacing.sm },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
});
