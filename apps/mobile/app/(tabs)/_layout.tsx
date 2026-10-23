import { Tabs } from "expo-router";
import { Text, type ColorValue } from "react-native";
import { colors } from "../../src/theme";

function glyph(symbol: string) {
  return ({ color }: { color: ColorValue }) => <Text style={{ color: String(color), fontSize: 18 }}>{symbol}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "V_share", tabBarLabel: "Home", tabBarIcon: glyph("⌂") }} />
      <Tabs.Screen name="send" options={{ title: "Send", tabBarIcon: glyph("↑") }} />
      <Tabs.Screen name="receive" options={{ title: "Receive", tabBarIcon: glyph("↓") }} />
      <Tabs.Screen name="history" options={{ title: "History", tabBarIcon: glyph("◷") }} />
      <Tabs.Screen name="settings" options={{ title: "Settings", tabBarIcon: glyph("⚙") }} />
    </Tabs>
  );
}
