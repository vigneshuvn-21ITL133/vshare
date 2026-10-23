
import type { ExpoConfig, ConfigContext } from "expo/config";

// Version is read by EAS and by the Android build. Keep it in step with package.json.
const VERSION = "0.1.0";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,

  extra: {
    ...(config.extra ?? {}),
    eas: {
      ...(config.extra?.eas ?? {}),
      projectId: "60e7e6a7-f73d-44d5-a715-5fe60ad13922",
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
      "android.permission.BLUETOOTH_ADVERTISE"
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
    [
      "expo-media-library",
      {
        photosPermission:
          "V_share lets you choose photos and videos to send.",
        savePhotosPermission: false,
        isAccessMediaLocationEnabled: false,
      },
    ],
  ],
});
