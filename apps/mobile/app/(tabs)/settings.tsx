import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Badge, Button, Card, Switch, Title } from "../../src/components/ui";
import { useStore } from "../../src/state/store";
import { colors, spacing } from "../../src/theme";

export default function SettingsScreen() {
  const settings = useStore((state) => state.settings);
  const updateSettings = useStore((state) => state.updateSettings);
  const chooseSaveFolder = useStore((state) => state.chooseSaveFolder);
  const [name, setName] = useState(settings.deviceName);
  const [port, setPort] = useState(String(settings.port));
  const [saved, setSaved] = useState<string | null>(null);
  const [storageNote, setStorageNote] = useState<string | null>(null);

  async function chooseFolder() {
    const picked = await chooseSaveFolder();
    setStorageNote(picked ? "Received files will be saved to this folder" : "No folder was chosen");
  }

  async function resetFolder() {
    await updateSettings({ saveFolderUri: null });
    setStorageNote("Received files will be saved to the private folder");
  }

  useEffect(() => {
    setName(settings.deviceName);
    setPort(String(settings.port));
  }, [settings.deviceName, settings.port]);

  const portNumber = Number(port);
  const portValid = Number.isInteger(portNumber) && portNumber >= 1024 && portNumber <= 65535;

  async function saveName() {
    const trimmed = name.trim().slice(0, 64);
    if (!trimmed) return;
    await updateSettings({ deviceName: trimmed });
    setSaved("Device name saved");
  }

  async function savePort() {
    if (!portValid) return;
    await updateSettings({ port: portNumber });
    setSaved(`Listening on port ${portNumber}`);
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Title sub="How this phone appears to your PC, and how it connects.">Settings</Title>

      <Card>
        <Text style={styles.heading}>Device</Text>
        <Text style={styles.label}>Device name</Text>
        <View style={styles.row}>
          <TextInput style={[styles.input, { flex: 1 }]} value={name} onChangeText={setName} maxLength={64} accessibilityLabel="Device name" />
          <Button label="Save" onPress={() => void saveName()} />
        </View>
      </Card>

      <Card>
        <Text style={styles.heading}>Network</Text>
        <Text style={styles.label}>Listening port (1024–65535)</Text>
        <View style={styles.row}>
          <TextInput style={[styles.input, { width: 120 }]} value={port} onChangeText={setPort} keyboardType="number-pad" accessibilityLabel="Listening port" />
          <Button label="Apply" disabled={!portValid} onPress={() => void savePort()} />
        </View>
        <View style={[styles.row, { marginTop: spacing.md }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.value}>Allow connections without scanning</Text>
            <Text style={styles.hint}>Lets a PC connect by typing this phone's address. You still approve every transfer.</Text>
          </View>
          <Switch label="Allow connections without scanning" value={settings.allowManualConnections} onChange={(on) => void updateSettings({ allowManualConnections: on })} />
        </View>
        <View style={[styles.row, { marginTop: spacing.md }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.value}>Keep screen awake during transfers</Text>
            <Text style={styles.hint}>Stops Android from sleeping mid-transfer. Uses more battery.</Text>
          </View>
          <Switch label="Keep screen awake during transfers" value={settings.keepScreenAwake} onChange={(on) => void updateSettings({ keepScreenAwake: on })} />
        </View>
        {saved && <Text style={styles.saved}>{saved}</Text>}
      </Card>

      <Card>
        <Text style={styles.heading}>Security</Text>
        <View style={styles.row}>
          <Text style={[styles.value, { flex: 1 }]}>End-to-end encryption (AES-256-GCM)</Text>
          <Badge label="On" tone="ok" />
        </View>
        <Text style={styles.hint}>Always on. Each transfer checks a six-digit code shown on both devices.</Text>
      </Card>

      <Card>
        <Text style={styles.heading}>Save received files</Text>
        <Text style={styles.value}>{settings.saveFolderUri ? "Your chosen folder" : "V_share's private folder"}</Text>
        <Text style={styles.hint}>
          {settings.saveFolderUri
            ? describeFolder(settings.saveFolderUri)
            : "Files stay inside the app. Open them from History to share or view them."}
        </Text>
        <Text style={styles.hint}>
          If Android no longer allows writing to the chosen folder, files go to the private folder instead.
        </Text>
        <View style={[styles.row, { marginTop: spacing.md }]}>
          <Button label="Choose folder" onPress={() => void chooseFolder()} />
          {settings.saveFolderUri && (
            <Button label="Use private folder" variant="ghost" onPress={() => void resetFolder()} />
          )}
        </View>
        {storageNote && <Text style={styles.saved}>{storageNote}</Text>}
      </Card>
    </ScrollView>
  );
}

/** Shows a readable path for a content:// folder URI, which Android encodes. */
function describeFolder(uri: string): string {
  try {
    return decodeURIComponent(uri);
  } catch {
    return uri;
  }
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  heading: { color: colors.text, fontSize: 15, fontWeight: "600", marginBottom: spacing.sm },
  label: { color: colors.muted, fontSize: 12, marginBottom: 6 },
  value: { color: colors.text, fontSize: 14, fontWeight: "500" },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  input: { backgroundColor: colors.surface2, borderColor: colors.border, borderWidth: 1, borderRadius: 12, color: colors.text, paddingHorizontal: 12, paddingVertical: 10 },
  saved: { color: colors.ok, marginTop: spacing.sm, fontSize: 13 },
});
