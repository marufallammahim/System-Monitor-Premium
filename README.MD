<div align="center">

# 📊 System Monitor — Premium

**A lightweight, real-time hardware telemetry and resource monitoring dashboard crafted for GNOME Shell 51.**

[![GNOME Version](https://img.shields.io/badge/GNOME%20Shell-51%20%7C%2051.0%20%7C%2051.1-4a86cf?logo=gnome&style=for-the-badge)](https://extensions.gnome.org/)
[![Extension Version](https://img.shields.io/badge/Version-1.0.1-brightgreen?style=for-the-badge)](https://github.com/marufallammahim/system-monitor-premium/releases)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg?style=for-the-badge)](LICENSE)
[![Maintenance](https://img.shields.io/badge/Maintained%3F-yes-green.svg?style=for-the-badge)](#)

[Features](#-key-features) • [Installation](#-installation) • [Prerequisites](#-prerequisites) • [Configuration](#-configuration) • [Building from Source](#-building--packaging) • [Roadmap](#-roadmap) • [Author](#-author)

</div>

---

## 💡 About The Project

**System Monitor — Premium** is designed for power users, developers, and Linux enthusiasts who demand precise, granular hardware telemetry directly from the GNOME Shell top panel. 

Instead of heavy background daemons or clunky popups, this extension delivers high-frequency metrics through non-blocking asynchronous system polling. It combines high-performance visualization with a clean, modern aesthetic that blends seamlessly into the native libadwaita styling of GNOME Shell 51.

---

## ⚡ Key Features

* **📈 Live Sparkline Graphs:** Fluid 60fps canvas-rendered historical usage graphs for CPU, RAM, and Network traffic.
* **🧠 Per-Core CPU Telemetry:** Breakdown of individual thread loads, overall package utilization, frequencies, and thermal thresholds (`/sys/class/thermal`).
* **🎮 Multi-GPU Support:** Real-time metrics for dedicated and integrated GPUs (NVIDIA via `nvidia-smi` integration, AMD via `amdgpu` sysfs, and Intel Xe/i915).
* **🎛️ Memory & Swap Gauges:** Instantaneous visual feedback on cached, active, and available RAM alongside dynamic Swap tracking.
* **💾 Partition Storage Watcher:** Real-time disk I/O read/write throughput rates along with mounted partition health and remaining storage.
* **🔋 Advanced Battery Health:** Complete battery telemetry including real-time drain/charge wattage, cycle counts, voltage, and wear health degradation.
* **🌀 Dynamic Fan Speed Animations:** Rotational fan icons that visually accelerate or decelerate according to hardware RPM readouts.
* **🎨 Highly Customizable:** Hide or expose any telemetry metric, re-order status bar indicators, and tailor poll frequencies per sensor.

---

## 🖥️ GNOME Shell Compatibility

| GNOME Shell Version | Compatibility | Status |
| :--- | :---: | :--- |
| **GNOME 51** | `51` | ✅ Supported |
| **GNOME 51.0** | `51.0` | ✅ Supported |
| **GNOME 51.1** | `51.1` | ✅ Supported |

> **UUID:** `system-monitor@marufallammahim.github.io`  
> **Schema:** `org.gnome.shell.extensions.system-monitor-premium`

---

## 📦 Prerequisites

Ensure the required sensor and system utilities are installed on your distribution:

### Arch / Manjaro / Fedora / Ubuntu / Debian

```bash
# Arch Linux
sudo pacman -S lm_sensors libgtop

# Fedora
sudo dnf install lm_sensors libgtop2

# Ubuntu / Debian
sudo apt install lm-sensors libgtop2-dev
```

*(Optional for NVIDIA GPU users: make sure proprietary drivers and `nvidia-smi` are available in your `$PATH`)*

---

## 🚀 Installation

### Option 1: Manual Installation (Git Clone)

You can clone this repository directly into your local GNOME extensions directory:

```bash
# 1. Create target directory
mkdir -p ~/.local/share/gnome-shell/extensions/system-monitor@marufallammahim.github.io

# 2. Clone the repository
git clone https://github.com/marufallammahim/system-monitor-premium.git /tmp/system-monitor-premium

# 3. Copy files to your extension directory
cp -r /tmp/system-monitor-premium/* ~/.local/share/gnome-shell/extensions/system-monitor@marufallammahim.github.io/

# 4. Compile GSettings schema
glib-compile-schemas ~/.local/share/gnome-shell/extensions/system-monitor@marufallammahim.github.io/schemas/
```

### Option 2: Build & Pack Release

If you prefer building a standard zip package:

```bash
git clone https://github.com/marufallammahim/system-monitor-premium.git
cd system-monitor-premium
gnome-extensions pack --force --extra-source=schemas
gnome-extensions install --force system-monitor@marufallammahim.github.io.shell-extension.zip
```

### 🔄 Enabling the Extension

After installation, reload GNOME Shell:
* **Wayland:** Log out and log back in.
* **X11:** Press `Alt + F2`, type `r`, and hit `Enter`.

Then activate the extension:

```bash
gnome-extensions enable system-monitor@marufallammahim.github.io
```

---

## ⚙️ Configuration

Configure your metrics, poll rates, and visual toggles:

* Open the **GNOME Extensions app** or run:
  ```bash
  gnome-extensions prefs system-monitor@marufallammahim.github.io
  ```
* Or configure via **dconf / CLI**:
  ```bash
  gsettings set org.gnome.shell.extensions.system-monitor-premium update-interval 2
  ```

---

## 🛠️ Project Structure

```text
system-monitor@marufallammahim.github.io/
├── extension.js            # Main GNOME extension entry point
├── prefs.js                # Libadwaita preferences UI
├── metadata.json           # Extension identification & version metadata
├── schemas/                # GSettings schemas for persistent preferences
│   ├── org.gnome.shell.extensions.system-monitor-premium.gschema.xml
│   └── gschemas.compiled
├── ui/                     # Modular telemetry widgets & canvas sparklines
│   ├── cpuWidget.js
│   ├── gpuWidget.js
│   ├── memoryWidget.js
│   └── sensorIndicator.js
└── locale/                 # Gettext internationalization (.po / .mo files)
```

---

## 🗺️ Roadmap

- [x] Per-core CPU & thread monitoring
- [x] Dynamic fan RPM animation engine
- [x] NVIDIA & AMD sysfs integration
- [ ] Network adapter bandwidth graphs (Up/Down)
- [ ] Customizable theme presets (OLED black, Nord, Catppuccin)
- [ ] High-temp acoustic or desktop notifications

---

## 🤝 Contributing

Contributions, bug reports, and pull requests are warmly welcomed!

1. Fork the Project (`https://github.com/marufallammahim/system-monitor-premium/fork`)
2. Create your Feature Branch (`git checkout -b feature/CoolTelemetry`)
3. Commit your Changes (`git commit -m 'feat: Add CoolTelemetry sensor'`)
4. Push to the Branch (`git push origin feature/CoolTelemetry`)
5. Open a Pull Request

---

## 📄 License

Distributed under the **GNU General Public License v3.0 (GPLv3)**. See [LICENSE](LICENSE) for more details.

---

## 👤 Author

**Maruf Allam Mahim**

* GitHub: [@marufallammahim](https://github.com/marufallammahim)
* Repository: [system-monitor-premium](https://github.com/marufallammahim/System-Monitor-Premium)

---

<div align="center">
<sub>Engineered with precision for the Linux & GNOME community. If you find this project useful, feel free to give it a ⭐️!</sub>
</div>
