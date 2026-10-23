import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import { Button } from "../src/components/ui";
import { useStore } from "../src/state/store";
import { colors, spacing } from "../src/theme";

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const setPendingTarget = useStore((state) => state.setPendingTarget);
  const [scanned, setScanned] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!permission) return <View style={styles.screen} />;

  if (!permission.granted) {
    return (
      <View style={styles.screen}>
        <Text style={styles.text}>V_share needs the camera to read the pairing code on your PC.</Text>
        <Button label="Allow camera" variant="primary" onPress={() => void requestPermission()} />
      </View>
    );
  }

  function onScanned({ data }: { data: string }) {
    if (scanned) return;
    if (!data.startsWith("vshare://pair?")) {
      setMessage("That code is not a V_share code. Scan the code on the PC.");
      return;
    }
    setScanned(true);
    setPendingTarget(data);
    router.back();
  }

  return (
    <View style={styles.screen}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={onScanned}
      />
      <View style={styles.frame} pointerEvents="none" />
      <View style={styles.footer}>
        <Text style={styles.text}>{message ?? "Point the camera at the QR code on your PC."}</Text>
        <Button label="Cancel" onPress={() => router.back()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, justifyContent: "center", padding: spacing.lg, gap: spacing.md },
  frame: { position: "absolute", alignSelf: "center", top: "28%", width: 240, height: 240, borderWidth: 3, borderColor: colors.accent, borderRadius: 18 },
  footer: { position: "absolute", bottom: 40, left: spacing.lg, right: spacing.lg, gap: spacing.md, backgroundColor: "rgba(14,14,16,0.7)", padding: spacing.md, borderRadius: 14 },
  text: { color: colors.text, textAlign: "center", fontSize: 15 },
});
