
import type { ExpoConfig, ConfigContext } from "expo/config";

// Version is read by EAS and by the Android build. Keep it in step with package.json.
const VERSION = "0.1.0";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,

  extra: {
    ...(config.extra ?? {}),
    eas: {
      ...(config.extra?.eas ?? {}),
      projectId: "ab40838f-8157-449c-8700-ea83ff0be161",
    },
  },

  name: "V_share",
  slug: "vshare",
  version: VERSION,
  orientation: "portrait",
  scheme: "vshare",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  backgroundColor: "#0e0e10",

  android: {
    package: "com.vshare.app",
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#0e0e10",
    },
    permissions: [
      "android.permission.INTERNET",
      "android.permission.ACCESS_NETWORK_STATE",
      "android.permission.ACCESS_WIFI_STATE",
      "android.permission.CHANGE_WIFI_MULTICAST_STATE",
      "android.permission.CAMERA",
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.READ_MEDIA_VIDEO",
      "android.permission.READ_MEDIA_AUDIO",
      "android.permission.BLUETOOTH_CONNECT",
      "android.permission.BLUETOOTH_SCAN",
      "android.permission.BLUETOOTH_ADVERTISE",
      "android.permission.BLUETOOTH",
      "android.permission.BLUETOOTH_ADMIN",
      "android.permission.ACCESS_FINE_LOCATION",
    ],
  },

  plugins: [
    "expo-router",
    [
      "expo-camera",
      {
        cameraPermission:
          "V_share uses the camera to scan the pairing QR code on the PC.",
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    // Release-only size settings: arm64 phones only, code shrinking, unused resources removed.
    // Debug/development builds are not affected.
    [
      "expo-build-properties",
      {
        android: {
          reactNativeArchitectures: ["arm64-v8a"],
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
        },
      },
    ],
  ],
});
