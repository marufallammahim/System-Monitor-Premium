<div align="center">

# System Monitor — Premium

**A modern, real-time hardware and system telemetry dashboard for GNOME Shell 51.**

[![GNOME Shell](https://img.shields.io/badge/GNOME_Shell-51-blue?logo=gnome&style=for-the-badge)](https://www.gnome.org/)
[![Version](https://img.shields.io/badge/Extension-1.0.0-brightgreen?style=for-the-badge)](https://github.com/marufallammahim/System-Monitor-Premium)
[![Platform](https://img.shields.io/badge/Platform-Linux-orange?style=for-the-badge)](https://kernel.org/)
[![JavaScript](https://img.shields.io/badge/JavaScript-GJS-yellow?style=for-the-badge)](https://gjs.guide/)

[Features](#features) · [Compatibility](#compatibility) · [Install](#installation) · [Configure](#configuration) · [Troubleshooting](#troubleshooting) · [Uninstall](#uninstallation)

</div>

---

## Overview

**System Monitor — Premium** is a GNOME Shell extension that puts live hardware and system information directly in your desktop panel and dashboard. It is designed to be lightweight, asynchronous, and clear about sensor availability: values are shown only when the operating system or hardware driver actually provides them.

> **Compatibility note:** This project currently targets **GNOME Shell 51** (metadata lists 51, 51.0 and 51.1). A Linux distribution being listed below does not mean every GNOME version shipped by that distro is compatible. Check your GNOME Shell version before installing.

## Features

- **CPU:** overall and per-core/thread utilization, frequency, temperature where exposed, and history graphs.
- **GPU:** telemetry discovery for AMD, Intel, and NVIDIA devices; reports supported metrics rather than inventing missing readings.
- **Memory:** RAM usage, available/cached memory, and Swap.
- **Storage:** mounted filesystem/partition capacity and disk activity metrics where available.
- **Battery:** charge, health, power/current, voltage, temperature, and estimated time where supported by the device.
- **Fans & sensors:** fan RPM and thermal sensor readings exposed through Linux hwmon/sysfs.
- **System information:** OS/distribution, kernel, architecture, device, CPU/GPU, GNOME Shell, session type, uptime, package count, and other details.
- **Top panel:** compact CPU indicator, frequency display, and live sparkline options.
- **Preferences:** refresh intervals, graph history, temperature units, compact layout, and animation controls.

Some metrics are hardware-, kernel-, or driver-dependent. A desktop without a battery or fan sensor will show those metrics as unavailable.

## Compatibility

| Requirement | Supported |
|---|---|
| Desktop | GNOME Shell |
| GNOME Shell | 51 / 51.0 / 51.1 (current metadata) |
| Session | Wayland or X11 (restart procedure differs) |
| Architecture | Linux architectures supported by GNOME/GJS and the hardware drivers |
| Extension UUID | `system-monitor@marufallammahim.github.io` |

Check your GNOME version:

```bash
gnome-shell --version
echo "$XDG_SESSION_TYPE"
```

## Installation

### 1. Install prerequisite tools for your distribution

The extension's core telemetry uses Linux system interfaces such as `/proc` and `/sys`. Git and GLib's schema compiler are needed for the source installation below. **lm-sensors is optional**, but may help expose additional sensor readings on supported hardware.

<details>
<summary><strong>Arch Linux</strong></summary>

```bash
sudo pacman -Syu
sudo pacman -S --needed git glib2 lm_sensors
```
</details>

<details>
<summary><strong>Manjaro</strong></summary>

```bash
sudo pacman -Syu
sudo pacman -S --needed git glib2 lm_sensors
```
</details>

<details>
<summary><strong>EndeavourOS</strong></summary>

```bash
sudo pacman -Syu
sudo pacman -S --needed git glib2 lm_sensors
```
</details>

<details>
<summary><strong>Ubuntu</strong></summary>

```bash
sudo apt update
sudo apt install -y git libglib2.0-bin lm-sensors
```
</details>

<details>
<summary><strong>Debian</strong></summary>

```bash
sudo apt update
sudo apt install -y git libglib2.0-bin lm-sensors
```
</details>

<details>
<summary><strong>Linux Mint</strong></summary>

```bash
sudo apt update
sudo apt install -y git libglib2.0-bin lm-sensors
```
</details>

<details>
<summary><strong>Pop!_OS</strong></summary>

```bash
sudo apt update
sudo apt install -y git libglib2.0-bin lm-sensors
```
</details>

<details>
<summary><strong>Fedora</strong></summary>

```bash
sudo dnf install -y git glib2 lm_sensors
```
</details>

<details>
<summary><strong>RHEL / Rocky Linux / AlmaLinux</strong></summary>

```bash
sudo dnf install -y git glib2 lm_sensors
```

GNOME Shell 51 must be available in your installed desktop environment for this extension to work.
</details>

<details>
<summary><strong>openSUSE Leap / Tumbleweed</strong></summary>

```bash
sudo zypper refresh
sudo zypper install git glib2-tools sensors
```
</details>

<details>
<summary><strong>Gentoo</strong></summary>

```bash
sudo emerge --ask dev-vcs/git dev-libs/glib sys-apps/lm_sensors
```
</details>

<details>
<summary><strong>Void Linux</strong></summary>

```bash
sudo xbps-install -S
sudo xbps-install -S git glib-devel lm_sensors
```
</details>

<details>
<summary><strong>NixOS (temporary tool environment)</strong></summary>

```bash
nix shell nixpkgs#git nixpkgs#glib nixpkgs#lm_sensors
```

For a permanent setup, add the required packages to your NixOS configuration and rebuild your system.
</details>

**Other distributions:** install `git`, GLib tools (including `glib-compile-schemas`), and optionally your distro's lm-sensors package using its package manager.

### 2. Install the extension from Git

Copy and paste the following commands. This installs the current repository's `main` branch into your **user** extension directory (no root permissions required for the extension files).

```bash
EXT_UUID="system-monitor@marufallammahim.github.io"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$EXT_UUID"

mkdir -p "$HOME/.local/share/gnome-shell/extensions"
git clone https://github.com/marufallammahim/System-Monitor-Premium.git "$EXT_DIR"
glib-compile-schemas "$EXT_DIR/schemas"
gnome-extensions enable "$EXT_UUID"
```

### 3. Restart GNOME Shell / your session

- **Wayland:** save your work, log out, then log back in. (Wayland does not support the GNOME Shell `Alt+F2 → r` restart.)
- **X11:** press `Alt+F2`, type `r`, and press Enter. If your GNOME version does not support this, log out and back in.

After restarting, open the extension's panel indicator or the Extensions application to verify it is enabled.

## Updating

If installed with the Git method above:

```bash
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/system-monitor@marufallammahim.github.io"
git -C "$EXT_DIR" pull --ff-only
glib-compile-schemas "$EXT_DIR/schemas"
```

Then log out and log back in (Wayland), or reload GNOME Shell / log in again (X11).

## Configuration

Open the preferences window:

```bash
gnome-extensions prefs system-monitor@marufallammahim.github.io
```

You can also inspect or change settings with `gsettings`. The schema is:

```text
org.gnome.shell.extensions.system-monitor-premium
```

Example — set the fast telemetry refresh interval to 3 seconds:

```bash
gsettings set org.gnome.shell.extensions.system-monitor-premium refresh-interval 3
```

The preferences UI provides refresh interval, slower system/storage refresh, temperature unit, graph history, top-panel options, animation, and compact-layout controls. Use the preferences window for the rest of the settings.

## Optional sensor support

- **lm-sensors:** install the package for your distro if you want to make supported sensor data available. Hardware may still not expose every sensor.
- **NVIDIA:** telemetry may use `nvidia-smi` when available. Install/configure your system's supported NVIDIA driver separately; this extension does not install drivers.
- **AMD / Intel:** GPU readings are gathered from kernel-exposed DRM/sysfs interfaces. Availability varies by driver and device.
- **Fan RPM:** many laptops do not expose fan speed to Linux. Missing RPM readings are a hardware/firmware/driver limitation, not necessarily an extension fault.

## Troubleshooting

### Extension is not listed or cannot be enabled

Check that the directory name matches the UUID and that `metadata.json` exists:

```bash
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/system-monitor@marufallammahim.github.io"
ls "$EXT_DIR/metadata.json"
gnome-extensions list
gnome-extensions info system-monitor@marufallammahim.github.io
```

### GSettings schema error

Recompile the schema:

```bash
glib-compile-schemas "$HOME/.local/share/gnome-shell/extensions/system-monitor@marufallammahim.github.io/schemas"
```

### Extension reports incompatible GNOME version

Run `gnome-shell --version`. This source currently targets GNOME Shell 51; it may not work on earlier or later versions unless compatibility is added and tested.

### Sensor shows “Unavailable” or “Unsupported”

Not all systems expose every sensor. Check the relevant kernel interfaces and driver support. Avoid running the extension as root; it is designed for a normal desktop user.

### View GNOME Shell logs

```bash
journalctl --user -b | grep -iE 'system-monitor|extension|gnome-shell'
```

If reporting a bug, include your GNOME Shell version, distro, session type (Wayland/X11), and relevant log output. Do not include personal information from logs.

## Uninstallation

Disable the extension and remove the user-installed directory:

```bash
EXT_UUID="system-monitor@marufallammahim.github.io"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$EXT_UUID"

gnome-extensions disable "$EXT_UUID"
rm -rf "$EXT_DIR"
```

Log out and log back in to finish removal.

Optional — reset extension preferences too:

```bash
gsettings reset-recursively org.gnome.shell.extensions.system-monitor-premium
```

## Repository layout

```text
.
├── extension.js
├── prefs.js
├── metadata.json
├── stylesheet.css
├── schemas/
└── src/
    ├── telemetry.js
    ├── system-info.js
    ├── cpu.js
    ├── gpu.js
    ├── memory.js
    ├── storage.js
    ├── battery.js
    ├── fans.js
    ├── graphs.js
    └── ui/
        ├── components.js
        ├── cards.js
        └── dashboard.js
```

## Contributing

Issues, ideas, and tested improvements are welcome. Before opening a report, check whether your GNOME Shell version is supported and include steps to reproduce the problem.

1. Fork the repository.
2. Create a feature branch.
3. Test on GNOME Shell 51.
4. Commit your changes and open a pull request.

## Author

**Maruf Allam Mahim**  
GitHub: [@marufallammahim](https://github.com/marufallammahim)

Repository: [System-Monitor-Premium](https://github.com/marufallammahim/System-Monitor-Premium)

---

<div align="center">
<sub>Built for Linux desktop users. ⭐ Star the repository if you find it useful.</sub>
</div>
