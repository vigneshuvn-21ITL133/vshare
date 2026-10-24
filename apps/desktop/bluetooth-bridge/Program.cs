// V_share Bluetooth bridge.
//
// Electron cannot open Bluetooth RFCOMM sockets itself, so this small process does it
// through Windows.Devices.Bluetooth and relays raw bytes to the app over stdin/stdout.
//
// One JSON object per line.
//   stdin, commands from the app:
//     {"id":"1","cmd":"paired"}                          list paired devices
//     {"id":"2","cmd":"listen"}                          accept one phone at a time
//     {"id":"3","cmd":"stopListen"}
//     {"id":"4","cmd":"connect","address":"AA:BB:CC:DD:EE:FF"}
//     {"cmd":"write","text":"<base64 line>\n"}          UTF-8 bytes to the open connection (no reply)
//     {"id":"5","cmd":"close"}
//   stdout, replies and events:
//     {"id":"1","ok":true,"data":{...}}   or   {"id":"1","ok":false,"error":"..."}
//     {"event":"ready"}
//     {"event":"connected","name":"...","address":"..."}     a phone connected to us
//     {"event":"data","data":"<base64 of the raw bytes received>"}
//     {"event":"closed","reason":"end" | "closed by V_share" | "<error text>"}
//     {"event":"error","message":"..."}

using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.Rfcomm;
using Windows.Devices.Enumeration;
using Windows.Networking.Sockets;
using Windows.Storage.Streams;

namespace VShare.BluetoothBridge;

internal static class Program
{
    private static readonly object OutputLock = new();
    private static StreamWriter output = null!;

    private static async Task Main()
    {
        output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
        var bridge = new Bridge(Emit);
        Emit(new { @event = "ready" });

        using var input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
        string? line;
        while ((line = await input.ReadLineAsync()) != null)
        {
            if (line.Trim().Length == 0)
            {
                continue;
            }
            await HandleCommandAsync(bridge, line);
        }

        bridge.Shutdown();
    }

    private static async Task HandleCommandAsync(Bridge bridge, string line)
    {
        string id = "";
        try
        {
            using var document = JsonDocument.Parse(line);
            var root = document.RootElement;
            if (root.TryGetProperty("id", out var idElement))
            {
                id = idElement.ToString();
            }
            var command = root.GetProperty("cmd").GetString() ?? "";

            switch (command)
            {
                case "paired":
                    Ok(id, new { devices = await bridge.PairedDevicesAsync() });
                    break;
                case "listen":
                    await bridge.ListenAsync();
                    Ok(id, null);
                    break;
                case "stopListen":
                    bridge.StopListen();
                    Ok(id, null);
                    break;
                case "connect":
                    await bridge.ConnectAsync(root.GetProperty("address").GetString() ?? "");
                    Ok(id, null);
                    break;
                case "write":
                    await bridge.WriteAsync(root.GetProperty("text").GetString() ?? "");
                    break;
                case "close":
                    bridge.Close("closed by V_share");
                    Ok(id, null);
                    break;
                default:
                    Fail(id, $"unknown command: {command}");
                    break;
            }
        }
        catch (Exception error)
        {
            Fail(id, error.Message);
        }
    }

    private static void Ok(string id, object? data)
    {
        if (id.Length > 0)
        {
            Emit(new { id, ok = true, data });
        }
    }

    private static void Fail(string id, string message)
    {
        if (id.Length > 0)
        {
            Emit(new { id, ok = false, error = message });
        }
        else
        {
            Emit(new { @event = "error", message });
        }
    }

    internal static void Emit(object message)
    {
        var json = JsonSerializer.Serialize(message);
        lock (OutputLock)
        {
            output.WriteLine(json);
        }
    }
}

/// <summary>Owns the RFCOMM listener and the single open connection.</summary>
internal sealed class Bridge
{
    /// <summary>The standard Serial Port Profile. The Android app uses the same UUID.</summary>
    private static readonly Guid SppServiceId = new("00001101-0000-1000-8000-00805F9B34FB");

    private readonly Action<object> emit;
    private readonly object gate = new();
    private readonly SemaphoreSlim writeGate = new(1, 1);

    private RfcommServiceProvider? provider;
    private StreamSocketListener? listener;
    private StreamSocket? socket;
    private DataWriter? writer;
    private bool connecting;

    public Bridge(Action<object> emit)
    {
        this.emit = emit;
    }

    public async Task<List<object>> PairedDevicesAsync()
    {
        var found = new List<object>();
        var infos = await DeviceInformation.FindAllAsync(BluetoothDevice.GetDeviceSelectorFromPairingState(true));
        foreach (var info in infos)
        {
            try
            {
                using var device = await BluetoothDevice.FromIdAsync(info.Id);
                // Only phones are useful as targets. Earbuds, keyboards and car kits are left out.
                if (device != null && device.ClassOfDevice.MajorClass == BluetoothMajorClass.Phone)
                {
                    found.Add(new { name = device.Name, address = FormatAddress(device.BluetoothAddress) });
                }
            }
            catch (Exception)
            {
                // A device that cannot be opened is left out of the list.
            }
        }
        return found;
    }

    public async Task ListenAsync()
    {
        if (provider != null)
        {
            return;
        }

        var newProvider = await RfcommServiceProvider.CreateAsync(RfcommServiceId.FromUuid(SppServiceId));
        var newListener = new StreamSocketListener();
        newListener.ConnectionReceived += OnConnectionReceived;
        await newListener.BindServiceNameAsync(
            newProvider.ServiceId.AsString(),
            SocketProtectionLevel.BluetoothEncryptionAllowNullAuthentication);
        newProvider.StartAdvertising(newListener, true);

        provider = newProvider;
        listener = newListener;
    }

    public void StopListen()
    {
        if (provider != null)
        {
            provider.StopAdvertising();
            provider = null;
        }
        if (listener != null)
        {
            listener.ConnectionReceived -= OnConnectionReceived;
            listener.Dispose();
            listener = null;
        }
    }

    public async Task ConnectAsync(string address)
    {
        lock (gate)
        {
            if (socket != null || connecting)
            {
                throw new InvalidOperationException("Already connected to a phone.");
            }
            connecting = true;
        }

        try
        {
            using var device = await BluetoothDevice.FromBluetoothAddressAsync(ParseAddress(address));
            if (device == null)
            {
                throw new InvalidOperationException("That phone was not found. Pair it in Windows settings first.");
            }

            var services = await device.GetRfcommServicesForIdAsync(
                RfcommServiceId.FromUuid(SppServiceId),
                BluetoothCacheMode.Uncached);
            if (services.Services.Count == 0)
            {
                throw new InvalidOperationException(
                    "The phone is not offering V_share. Open V_share on the phone and turn on Receive over Bluetooth.");
            }

            var service = services.Services[0];
            var outgoing = new StreamSocket();
            try
            {
                await outgoing.ConnectAsync(
                    service.ConnectionHostName,
                    service.ConnectionServiceName,
                    SocketProtectionLevel.BluetoothEncryptionAllowNullAuthentication);
            }
            catch
            {
                outgoing.Dispose();
                throw;
            }

            Install(outgoing);
            _ = ReadLoopAsync(outgoing);
        }
        catch
        {
            lock (gate)
            {
                connecting = false;
            }
            throw;
        }
    }

    public async Task WriteAsync(string text)
    {
        DataWriter? current;
        lock (gate)
        {
            current = writer;
        }
        if (current == null)
        {
            throw new InvalidOperationException("Not connected to a phone.");
        }

        var bytes = Encoding.UTF8.GetBytes(text);
        await writeGate.WaitAsync();
        try
        {
            current.WriteBytes(bytes);
            await current.StoreAsync();
            await current.FlushAsync();
        }
        catch (Exception error)
        {
            emit(new { @event = "error", message = $"Bluetooth write failed: {error.Message}" });
        }
        finally
        {
            writeGate.Release();
        }
    }

    public void Close(string reason)
    {
        StreamSocket? current;
        lock (gate)
        {
            current = socket;
        }
        if (current != null)
        {
            Release(current, reason);
        }
    }

    public void Shutdown()
    {
        StopListen();
        Close("bridge stopped");
    }

    private void OnConnectionReceived(StreamSocketListener sender, StreamSocketListenerConnectionReceivedEventArgs args)
    {
        var incoming = args.Socket;
        lock (gate)
        {
            // One connection at a time. A second phone is turned away.
            if (socket != null || connecting)
            {
                incoming.Dispose();
                return;
            }
            connecting = true;
        }

        _ = AcceptAsync(incoming);
    }

    private async Task AcceptAsync(StreamSocket incoming)
    {
        string name = "";
        string address = "";
        try
        {
            using var device = await BluetoothDevice.FromHostNameAsync(incoming.Information.RemoteHostName);
            if (device != null)
            {
                name = device.Name;
                address = FormatAddress(device.BluetoothAddress);
            }
        }
        catch (Exception)
        {
            // The name is optional. The transfer still works without it.
        }

        // Announce the connection before any bytes are read, so the app always sees it first.
        Install(incoming);
        emit(new { @event = "connected", name, address });
        await ReadLoopAsync(incoming);
    }

    private void Install(StreamSocket value)
    {
        lock (gate)
        {
            socket = value;
            writer = new DataWriter(value.OutputStream);
            connecting = false;
        }
    }

    private async Task ReadLoopAsync(StreamSocket current)
    {
        string reason = "end";
        try
        {
            using var reader = new DataReader(current.InputStream) { InputStreamOptions = InputStreamOptions.Partial };
            while (true)
            {
                uint loaded = await reader.LoadAsync(16 * 1024);
                if (loaded == 0)
                {
                    break;
                }
                var bytes = new byte[loaded];
                reader.ReadBytes(bytes);
                emit(new { @event = "data", data = Convert.ToBase64String(bytes) });
            }
        }
        catch (Exception error)
        {
            reason = error.Message;
        }

        Release(current, reason);
    }

    /// <summary>Clears the open connection if it is still this one, then reports it closed once.</summary>
    private void Release(StreamSocket current, string reason)
    {
        bool owned;
        lock (gate)
        {
            owned = socket == current;
            if (owned)
            {
                socket = null;
                writer?.Dispose();
                writer = null;
            }
        }

        current.Dispose();
        if (owned)
        {
            emit(new { @event = "closed", reason });
        }
    }

    private static string FormatAddress(ulong address)
    {
        var parts = new string[6];
        for (int i = 0; i < 6; i++)
        {
            parts[i] = ((address >> (8 * (5 - i))) & 0xFF).ToString("X2");
        }
        return string.Join(":", parts);
    }

    private static ulong ParseAddress(string text)
    {
        var hex = text.Replace(":", "").Replace("-", "");
        if (hex.Length != 12)
        {
            throw new ArgumentException($"Not a Bluetooth address: {text}");
        }
        return Convert.ToUInt64(hex, 16);
    }
}
