// The polyfills must load before anything that touches TextEncoder, Buffer, or crypto.
import "../src/polyfills";
import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { OfferSheet } from "../src/components/OfferSheet";
import { useStore } from "../src/state/store";
import { colors } from "../src/theme";

export default function RootLayout() {
  const init = useStore((state) => state.init);
  const ready = useStore((state) => state.ready);

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.text,
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="scan" options={{ title: "Scan pairing code", presentation: "modal" }} />
        </Stack>
        {ready && <OfferSheet />}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
