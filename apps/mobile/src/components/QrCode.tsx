import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import QRCode from "qrcode";

/**
 * Draws a QR code with plain Views, so it needs no native SVG module.
 * The quiet zone is part of the white card, and modules are sized to fit `size`.
 */
export function QrCode({ value, size = 240 }: { value: string; size?: number }) {
  const matrix = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
    const count = qr.modules.size;
    const cells: boolean[][] = [];
    for (let row = 0; row < count; row++) {
      const line: boolean[] = [];
      for (let col = 0; col < count; col++) {
        line.push(qr.modules.data[row * count + col] === 1);
      }
      cells.push(line);
    }
    return cells;
  }, [value]);

  const count = matrix.length;
  const cell = Math.floor(size / count);
  const edge = cell * count;

  return (
    <View style={[styles.frame, { width: edge + 24, height: edge + 24 }]} accessibilityLabel="Pairing QR code">
      {matrix.map((line, row) => (
        <View key={row} style={{ flexDirection: "row", height: cell }}>
          {line.map((dark, col) => (
            <View key={col} style={{ width: cell, height: cell, backgroundColor: dark ? "#111111" : "#ffffff" }} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { backgroundColor: "#ffffff", borderRadius: 14, padding: 12, alignSelf: "center", justifyContent: "center" },
});
