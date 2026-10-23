import { useEffect, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { useStore } from "../state/store";
import { colors, radius, spacing } from "../theme";
import { Button, formatBytes } from "./ui";

/** Shown above every screen while a sender is waiting for a decision. */
export function OfferSheet() {
  const offer = useStore((state) => state.offers[0]);
  const respond = useStore((state) => state.respondOffer);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!offer) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [offer]);

  if (!offer) return null;
  const secondsLeft = Math.max(0, Math.ceil((offer.expiresAt - now) / 1000));

  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => respond(offer.id, false)}>
      <View style={styles.scrim}>
        <View style={styles.sheet} accessibilityRole="alert">
          <Text style={styles.heading}>Incoming files from {offer.peer}</Text>
          <Text style={styles.meta}>
            {offer.fileCount} {offer.fileCount === 1 ? "file" : "files"} · {formatBytes(offer.totalBytes)} · auto-declines in {secondsLeft}s
          </Text>
          <Text style={styles.code} accessibilityLabel={`Verification code ${offer.verificationCode}`}>{offer.verificationCode}</Text>
          <Text style={styles.hint}>Check that this code matches the code on the sending PC before you accept.</Text>
          <Text style={styles.files} numberOfLines={4}>{offer.fileNames.join("\n")}</Text>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Button label="Decline" variant="danger" full onPress={() => respond(offer.id, false)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Accept" variant="primary" full onPress={() => respond(offer.id, true)} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: spacing.lg },
  sheet: { backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  heading: { color: colors.text, fontSize: 18, fontWeight: "700" },
  meta: { color: colors.muted, marginTop: 6, fontSize: 13 },
  code: { color: colors.accent, fontSize: 30, fontWeight: "800", letterSpacing: 6, textAlign: "center", backgroundColor: colors.surface2, borderRadius: radius.control, paddingVertical: 12, marginVertical: spacing.md },
  hint: { color: colors.muted, fontSize: 12.5, marginBottom: spacing.sm },
  files: { color: colors.text, fontSize: 12.5, fontFamily: "monospace", marginBottom: spacing.md },
  row: { flexDirection: "row", gap: spacing.sm },
});
