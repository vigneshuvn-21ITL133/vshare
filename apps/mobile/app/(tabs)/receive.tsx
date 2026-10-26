import { useEffect, useState } from "react";
import { ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Button, Card, Switch, Title } from "../../src/components/ui";
import { QrCode } from "../../src/components/QrCode";
import { useStore } from "../../src/state/store";
import { colors, spacing } from "../../src/theme";

export default function ReceiveScreen() {
  const listen = useStore((state) => state.listen);
  const localIp = useStore((state) => state.localIp);
  const online = useStore((state) => state.online);
  const startListening = useStore((state) => state.startListening);
  const stopListening = useStore((state) => state.stopListening);
  const refreshPairCode = useStore((state) => state.refreshPairCode);
  const btReceiving = useStore((state) => state.btReceiving);
  const btError = useStore((state) => state.btError);
  const startBluetoothReceive = useStore((state) => state.startBluetoothReceive);
  const stopBluetoothReceive = useStore((state) => state.stopBluetoothReceive);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const secondsLeft = listen.pairExpiresAt ? Math.max(0, Math.ceil((listen.pairExpiresAt - now) / 1000)) : 0;
  const address = localIp ? `${localIp}:${listen.port}` : "No WiFi address";

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Title sub="On the PC, open Send and scan this code, or type the address below.">Receive Files</Title>

      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 14, fontWeight: "500" }}>Accept over Bluetooth</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>Lets a paired PC send files without Wi-Fi. You still approve each transfer.</Text>
          </View>
          <Switch label="Accept over Bluetooth" value={btReceiving} onChange={(on) => void (on ? startBluetoothReceive() : stopBluetoothReceive())} />
        </View>
        {btError && <Text style={{ color: colors.bad, fontSize: 13, marginTop: spacing.sm }}>{btError}</Text>}
      </Card>

      <Card>
        {listen.listening && listen.pairUri ? (
          <>
            <QrCode value={listen.pairUri} size={240} />
            <Text style={styles.caption}>Code refreshes in {secondsLeft}s</Text>
            <Text style={styles.label}>Pairing link (type it on the PC, or share it)</Text>
            <Text selectable style={styles.link}>{listen.pairUri}</Text>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Button label="New code" onPress={() => refreshPairCode()} full />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="Share link" onPress={() => void Share.share({ message: listen.pairUri ?? "" })} full />
              </View>
            </View>
          </>
        ) : (
          <Text style={styles.empty}>
            {!listen.listening ? "Receiving is off. Turn it on below to show a code." : !online ? "Connect to WiFi to show a code." : "Preparing a code..."}
          </Text>
        )}
      </Card>

      <Card>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Accepting files</Text>
            <Text style={styles.value}>{listen.listening ? "On" : "Off"}</Text>
          </View>
          <Switch
            label="Accept incoming files"
            value={listen.listening}
            onChange={(on) => void (on ? startListening() : stopListening())}
          />
        </View>
        {listen.error && <Text style={styles.error}>{listen.error}</Text>}
      </Card>

      <Card>
        <Text style={styles.label}>This phone's address</Text>
        <Text selectable style={styles.address}>{address}</Text>
        <Text style={styles.label}>Port</Text>
        <Text style={styles.value}>{listen.port}</Text>
        <Button label="Share address" onPress={() => void Share.share({ message: address })} full />
        <View style={{ height: spacing.sm }} />
        <Text style={styles.hint}>
          Keep V_share open while a transfer runs. Android may pause the app if you switch away for a long time.
        </Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  caption: { color: colors.muted, fontSize: 12, textAlign: "center", marginTop: spacing.sm },
  empty: { color: colors.muted, textAlign: "center", paddingVertical: spacing.xl },
  label: { color: colors.muted, fontSize: 12, marginBottom: 4 },
  link: { color: colors.text, fontSize: 12, fontFamily: "monospace", marginTop: spacing.sm, marginBottom: spacing.sm },
  value: { color: colors.text, fontSize: 16, fontWeight: "600", marginBottom: spacing.sm },
  address: { color: colors.text, fontSize: 22, fontWeight: "700", fontFamily: "monospace", marginBottom: spacing.sm },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  error: { color: colors.bad, marginTop: spacing.sm, fontSize: 13 },
});
