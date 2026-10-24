import { StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../theme";

/** Shown in a browser. Camera and TCP networking only work in the installed Android app. */
export function WebNotice() {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Open V_share on your phone</Text>
      <Text style={styles.text}>
        This page is the browser preview. Pairing needs the camera and local networking, which only the installed V_share app on Android provides.
      </Text>
      <Text style={styles.text}>Install the APK from your EAS build, open V_share, and try again.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, justifyContent: "center", padding: spacing.lg, gap: spacing.md },
  title: { color: colors.text, fontSize: 22, fontWeight: "700", textAlign: "center" },
  text: { color: colors.muted, fontSize: 15, lineHeight: 22, textAlign: "center" },
});
