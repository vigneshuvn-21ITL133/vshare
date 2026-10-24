import { PermissionsAndroid, Platform } from "react-native";
import RNBluetoothClassic, { type BluetoothDevice, type BluetoothDeviceReadEvent, type BluetoothDeviceEvent } from "react-native-bluetooth-classic";
import { decodeBase64, encodeBase64, LINE_DELIMITER, type ByteSocket } from "@vshare/protocol";

/**
 * Bluetooth Classic transport for the protocol. Each protocol write goes out as one
 * base64 line; the library splits incoming text on the delimiter, so every read is one frame.
 * The protocol code above this layer is the same as for Wi-Fi.
 */
const LINE_OPTIONS = { delimiter: LINE_DELIMITER };

/** Connects to a paired device by its Bluetooth address (for example "AA:BB:CC:DD:EE:FF"). */
export async function connectBluetooth(address: string): Promise<ByteSocket> {
  const device = await RNBluetoothClassic.connectToDevice(address, LINE_OPTIONS);
  return wrapBluetooth(device);
}

/** Waits for one incoming Bluetooth connection from a paired PC. */
export async function acceptBluetooth(): Promise<ByteSocket> {
  const device = await RNBluetoothClassic.accept(LINE_OPTIONS);
  return wrapBluetooth(device);
}

/** Stops a pending accept, for example when the user turns receiving off. */
export function cancelAcceptBluetooth(): Promise<boolean> {
  return RNBluetoothClassic.cancelAccept();
}

/** Lists devices already paired in Android's Bluetooth settings. */
export function pairedBluetoothDevices(): Promise<BluetoothDevice[]> {
  return RNBluetoothClassic.getBondedDevices();
}

function wrapBluetooth(device: BluetoothDevice): ByteSocket {
  let closeHandler: ((error?: Error) => void) | null = null;
  let closed = false;

  const finish = (error?: Error) => {
    if (closed) return;
    closed = true;
    closeHandler?.(error);
  };

  // Fires when the link drops, filtered to this device.
  RNBluetoothClassic.onDeviceDisconnected((event: BluetoothDeviceEvent) => {
    if (event.device.address === device.address) finish();
  });

  return {
    write(data: Uint8Array): void {
      // The library wants text. Each frame is base64 text plus a delimiter.
      device.write(encodeBase64(data) + LINE_DELIMITER, "utf8").catch(() => finish(new Error("Bluetooth write failed")));
    },
    close(): void {
      void device.disconnect().finally(() => finish());
    },
    onData(handler: (data: Uint8Array) => void): void {
      device.onDataReceived((event: BluetoothDeviceReadEvent) => {
        try {
          handler(decodeBase64(event.data));
        } catch (error) {
          finish(error instanceof Error ? error : new Error("Bad Bluetooth frame"));
          void device.disconnect();
        }
      });
    },
    onClose(handler: (error?: Error) => void): void {
      closeHandler = handler;
    },
  };
}

/**
 * Asks for the Bluetooth permissions Android needs, then checks the adapter is on.
 * Returns a message for the user when something is missing.
 */
export async function ensureBluetoothReady(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (Platform.OS === "android" && Platform.Version >= 31) {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    ]);
    const granted = Object.values(result).every((value) => value === PermissionsAndroid.RESULTS.GRANTED);
    if (!granted) return { ok: false, error: "Allow Nearby devices for V_share in Android settings." };
  }
  const enabled = await RNBluetoothClassic.isBluetoothEnabled();
  if (!enabled) {
    const turnedOn = await RNBluetoothClassic.requestBluetoothEnabled();
    if (!turnedOn) return { ok: false, error: "Turn on Bluetooth to use this feature." };
  }
  return { ok: true };
}
