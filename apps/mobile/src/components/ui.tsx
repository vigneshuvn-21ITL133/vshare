import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, radius, spacing } from "../theme";

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Title({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={styles.title}>{children}</Text>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = "default",
  disabled,
  full,
}: {
  label: string;
  onPress: () => void;
  variant?: "default" | "primary" | "danger" | "ghost";
  disabled?: boolean;
  full?: boolean;
}) {
  const variantStyle =
    variant === "primary" ? styles.btnPrimary : variant === "danger" ? styles.btnDanger : variant === "ghost" ? styles.btnGhost : styles.btnDefault;
  const textStyle = variant === "primary" ? styles.btnPrimaryText : variant === "danger" ? styles.btnDangerText : styles.btnText;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.btn, variantStyle, full && { alignSelf: "stretch" }, disabled && { opacity: 0.45 }, pressed && { opacity: 0.8 }]}
    >
      <Text style={textStyle}>{label}</Text>
    </Pressable>
  );
}

export function Badge({ label, tone = "default" }: { label: string; tone?: "default" | "ok" | "warn" | "bad" | "accent" }) {
  const color = tone === "ok" ? colors.ok : tone === "warn" ? colors.warn : tone === "bad" ? colors.bad : tone === "accent" ? colors.accent : colors.muted;
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function Progress({ value, tone = "default" }: { value: number; tone?: "default" | "done" | "bad" }) {
  const fill = tone === "done" ? colors.ok : tone === "bad" ? colors.bad : colors.accent;
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: fill }]} />
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(option.value)}
            style={[styles.segment, on && styles.segmentOn]}
          >
            <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Switch({ value, onChange, label }: { value: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: value }} accessibilityLabel={label} onPress={() => onChange(!value)} style={[styles.switch, value && styles.switchOn]}>
      <View style={[styles.knob, value && styles.knobOn]} />
    </Pressable>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <Text style={styles.empty}>{children}</Text>;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  return `${value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function formatWhen(timestamp: number): string {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return date.toDateString() === new Date().toDateString() ? `Today, ${time}` : `${date.toLocaleDateString()}, ${time}`;
}

export function percent(done: number, total: number): number {
  return total <= 0 ? 0 : Math.min(100, Math.round((done / total) * 100));
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.card, padding: spacing.md, marginBottom: spacing.md },
  title: { color: colors.text, fontSize: 24, fontWeight: "700" },
  sub: { color: colors.muted, fontSize: 14, marginTop: 4 },
  btn: { paddingVertical: 11, paddingHorizontal: 16, borderRadius: radius.control, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  btnDefault: { backgroundColor: colors.surface2, borderColor: colors.border },
  btnPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  btnDanger: { backgroundColor: colors.surface2, borderColor: colors.border },
  btnGhost: { backgroundColor: "transparent", borderColor: "transparent" },
  btnText: { color: colors.text, fontWeight: "500", fontSize: 15 },
  btnPrimaryText: { color: "#ffffff", fontWeight: "700", fontSize: 15 },
  btnDangerText: { color: colors.bad, fontWeight: "500", fontSize: 15 },
  badge: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3, alignSelf: "flex-start" },
  badgeText: { fontSize: 11.5, fontWeight: "600" },
  progressTrack: { height: 6, borderRadius: 999, backgroundColor: colors.surface2, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 999 },
  segmented: { flexDirection: "row", backgroundColor: colors.surface2, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, padding: 3 },
  segment: { flex: 1, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 9, alignItems: "center" },
  segmentOn: { backgroundColor: colors.accent },
  segmentText: { color: colors.muted, fontSize: 13 },
  segmentTextOn: { color: "#ffffff", fontWeight: "700" },
  switch: { width: 46, height: 26, borderRadius: 999, backgroundColor: colors.surface2, justifyContent: "center", padding: 3 },
  switchOn: { backgroundColor: colors.accent },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#ffffff", transform: [{ translateX: 0 }] },
  knobOn: { transform: [{ translateX: 20 }] },
  empty: { color: colors.muted, textAlign: "center", paddingVertical: spacing.xl },
});
