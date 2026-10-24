# V_share Bluetooth bridge

A small Windows helper that gives V_share Bluetooth (RFCOMM) sockets. Electron cannot open
these itself, so the app starts this process and talks to it over stdin/stdout, one JSON
object per line. The protocol is described at the top of `Program.cs`.

Requirements: Windows 10 (19041) or later, .NET 8 SDK. The phone must be paired with the PC
in Windows settings (Bluetooth & devices) before V_share can use it.

## Build and test on its own

```powershell
cd apps\desktop\bluetooth-bridge
dotnet build -c Release
dotnet run
```

With `dotnet run` open, type a command and press Enter:

```
{"id":"1","cmd":"paired"}
```

You should get a reply line with your paired devices. A reply such as `"ok":false` shows the
error text.

## Packaged build

```powershell
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o publish
```

The app looks for `VShare.BluetoothBridge.exe` in the `bluetooth-bridge` resources folder
when it is packaged, and runs `dotnet run` in development. Set `VSHARE_BT_BRIDGE` to the full
path of an `.exe` to use a specific build.

This publish output is not yet copied into the installer. See the desktop notes in the
pull request before shipping.

## Not verified

The C# code has not been compiled or run on Windows yet. The Windows Bluetooth APIs must be
checked on a real PC with a real phone.
