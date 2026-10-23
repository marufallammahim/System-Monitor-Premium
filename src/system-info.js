/**
 * System Monitor — Premium
 * System Information Telemetry Provider
 *
 * Collects OS distribution, version, CPU architecture vs userspace bitness,
 * hostname, DMI vendor/model, CPU/GPU models, kernel version, uptime,
 * installed package count, GNOME Shell version, desktop environment,
 * session type (Wayland/X11), default terminal emulator, and login shell.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';

import {
    readFileAsync,
    readSysfsLineAsync,
    listDirectoryAsync,
    execCommandAsync,
    formatDurationSeconds,
    SensorStatus,
} from './telemetry.js';

export class SystemInfoProvider {
    constructor() {
        this._cachedStaticInfo = null;
        this._lastPackageCheckTime = 0;
        this._cachedPackagesText = 'Unknown';
    }

    /**
     * Collects complete System Information snapshot. Static fields are cached
     * after first discovery; dynamic fields (uptime, package count) update as needed.
     */
    async collect(cancellable = null) {
        if (!this._cachedStaticInfo)
            this._cachedStaticInfo = await this._collectStaticInfo(cancellable);

        const uptimeSeconds = await this._readUptimeSeconds(cancellable);
        const nowUs = GLib.get_monotonic_time();
        // Refresh package count at most once every 5 minutes
        if (!this._lastPackageCheckTime || (nowUs - this._lastPackageCheckTime) > 300_000_000) {
            this._cachedPackagesText = await this._detectPackageCount(cancellable);
            this._lastPackageCheckTime = nowUs;
        }

        return {
            ...this._cachedStaticInfo,
            uptimeSeconds,
            uptimeFormatted: uptimeSeconds !== null
                ? formatDurationSeconds(uptimeSeconds, false)
                : 'Not available',
            packages: this._cachedPackagesText,
            status: SensorStatus.AVAILABLE,
        };
    }

    async _collectStaticInfo(cancellable) {
        const [
            osInfo,
            archInfo,
            hostname,
            deviceModel,
            cpuModel,
            kernelVersion,
            terminalInfo,
        ] = await Promise.all([
            this._readOsRelease(cancellable),
            this._detectArchitecture(cancellable),
            this._readHostname(cancellable),
            this._readDeviceModel(cancellable),
            this._readCpuModel(cancellable),
            this._readKernelVersion(cancellable),
            this._detectTerminalEmulator(cancellable),
        ]);

        const shellVersion = Config.PACKAGE_VERSION || '51.1';
        const desktopEnv = this._detectDesktopEnvironment(shellVersion);
        const sessionType = this._detectSessionType();
        const loginShell = this._detectLoginShell();

        return {
            distroId: osInfo.id,
            distroName: osInfo.name,
            osPrettyName: osInfo.prettyName,
            osVersion: osInfo.version,
            cpuArch: archInfo.cpuArch,
            userspaceBitness: archInfo.userspaceBitness,
            cpuCapabilityBitness: archInfo.cpuCapabilityBitness,
            archSummary: archInfo.summary,
            hostname,
            deviceModel,
            cpuModel,
            gpuSummary: 'Detecting...',
            kernelVersion,
            shellVersion: `GNOME Shell ${shellVersion}`,
            desktopEnvironment: desktopEnv,
            sessionType,
            terminal: terminalInfo,
            loginShell,
        };
    }

    async _readOsRelease(cancellable) {
        let res = await readFileAsync('/etc/os-release', cancellable);
        if (!res.ok)
            res = await readFileAsync('/usr/lib/os-release', cancellable);

        if (!res.ok || !res.text) {
            return {
                id: 'linux',
                name: 'Linux',
                prettyName: 'Linux',
                version: 'Unknown',
            };
        }

        const fields = {};
        for (const rawLine of res.text.split('\n')) {
            const line = rawLine.trim();
            if (!line || line.startsWith('#'))
                continue;
            const eqIdx = line.indexOf('=');
            if (eqIdx <= 0)
                continue;
            const key = line.slice(0, eqIdx).trim();
            let val = line.slice(eqIdx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
                val = val.slice(1, -1);
            fields[key] = val;
        }

        return {
            id: (fields.ID || 'linux').toLowerCase(),
            name: fields.NAME || 'Linux',
            prettyName: fields.PRETTY_NAME || fields.NAME || 'Linux',
            version: fields.VERSION || fields.VERSION_ID || 'Rolling',
        };
    }

    async _detectArchitecture(cancellable) {
        // Distinguish hardware/kernel architecture from userspace bitness and CPU capability
        let kernelArch = 'Unknown';
        const archRes = await readSysfsLineAsync('/proc/sys/kernel/arch', cancellable);
        if (archRes.ok && archRes.value) {
            kernelArch = archRes.value;
        } else {
            const unameRes = await execCommandAsync(['uname', '-m'], cancellable);
            if (unameRes.ok && unameRes.stdout)
                kernelArch = unameRes.stdout.trim();
        }

        // Check CPU hardware capability flags from /proc/cpuinfo
        let cpuCapabilityBitness = '64-bit';
        const cpuinfoRes = await readFileAsync('/proc/cpuinfo', cancellable);
        if (cpuinfoRes.ok && cpuinfoRes.text) {
            if (cpuinfoRes.text.includes(' lm ') || kernelArch.includes('64') || kernelArch === 'aarch64')
                cpuCapabilityBitness = '64-bit';
            else if (kernelArch.includes('86') || kernelArch.includes('arm'))
                cpuCapabilityBitness = '32-bit';
        }

        // Userspace bitness detection from ELF class of /proc/self/exe (byte 4: 1=32-bit, 2=64-bit)
        let userspaceBitness = kernelArch.includes('64') ? '64-bit' : '32-bit';
        try {
            const exeFile = Gio.File.new_for_path('/proc/self/exe');
            const [bytes] = await exeFile.load_contents_async(cancellable);
            if (bytes && bytes.length >= 5 && bytes[0] === 0x7f && bytes[1] === 0x45) {
                if (bytes[4] === 2)
                    userspaceBitness = '64-bit';
                else if (bytes[4] === 1)
                    userspaceBitness = '32-bit';
            }
        } catch (_e) {
            // Fallback to kernelArch heuristic if /proc/self/exe cannot be read
        }

        const summary = cpuCapabilityBitness === userspaceBitness
            ? `${userspaceBitness} (${kernelArch})`
            : `${userspaceBitness} userspace / ${cpuCapabilityBitness} CPU (${kernelArch})`;

        return {
            cpuArch: kernelArch,
            userspaceBitness,
            cpuCapabilityBitness,
            summary,
        };
    }

    async _readHostname(cancellable) {
        const res = await readSysfsLineAsync('/proc/sys/kernel/hostname', cancellable);
        if (res.ok && res.value)
            return res.value;
        const hostName = GLib.get_host_name();
        return hostName || 'Unknown';
    }

    async _readDeviceModel(cancellable) {
        const [vendorRes, nameRes, versionRes] = await Promise.all([
            readSysfsLineAsync('/sys/devices/virtual/dmi/id/sys_vendor', cancellable),
            readSysfsLineAsync('/sys/devices/virtual/dmi/id/product_name', cancellable),
            readSysfsLineAsync('/sys/devices/virtual/dmi/id/product_version', cancellable),
        ]);

        const ignoredPlaceholders = new Set([
            'to be filled by o.e.m.',
            'system product name',
            'system manufacturer',
            'default string',
            'unknown',
            'not specified',
            'none',
        ]);

        const clean = val => {
            if (!val)
                return '';
            const trimmed = val.trim();
            if (ignoredPlaceholders.has(trimmed.toLowerCase()))
                return '';
            return trimmed;
        };

        const vendor = clean(vendorRes.value);
        const name = clean(nameRes.value);
        const version = clean(versionRes.value);

        if (vendor && name) {
            if (name.toLowerCase().startsWith(vendor.toLowerCase()))
                return name;
            return `${vendor} ${name}`;
        }
        if (name)
            return name;
        if (version)
            return `${vendor ? `${vendor} ` : ''}${version}`;

        // Device-tree fallback for ARM systems
        const dtModel = await readSysfsLineAsync('/sys/firmware/devicetree/base/model', cancellable);
        if (dtModel.ok && dtModel.value)
            return dtModel.value.replace(/\0/g, '').trim();

        return 'Not available';
    }

    async _readCpuModel(cancellable) {
        const res = await readFileAsync('/proc/cpuinfo', cancellable);
        if (!res.ok || !res.text)
            return 'Unknown';

        for (const line of res.text.split('\n')) {
            if (line.startsWith('model name') || line.startsWith('Model') || line.startsWith('Processor')) {
                const idx = line.indexOf(':');
                if (idx !== -1) {
                    const model = line.slice(idx + 1).trim();
                    if (model)
                        return model;
                }
            }
        }
        return 'Unknown';
    }

    async _readKernelVersion(cancellable) {
        const res = await readSysfsLineAsync('/proc/sys/kernel/osrelease', cancellable);
        if (res.ok && res.value)
            return res.value;
        return 'Unknown';
    }

    async _readUptimeSeconds(cancellable) {
        const res = await readSysfsLineAsync('/proc/uptime', cancellable);
        if (!res.ok || !res.value)
            return null;
        const firstToken = res.value.split(/\s+/)[0];
        const seconds = Number.parseFloat(firstToken);
        return Number.isFinite(seconds) ? seconds : null;
    }

    async _detectPackageCount(cancellable) {
        // 1. Arch Linux pacman database (/var/lib/pacman/local) - zero-subprocess fast directory count
        const pacmanDir = await listDirectoryAsync('/var/lib/pacman/local', cancellable);
        if (pacmanDir.ok && pacmanDir.entries.length > 0) {
            const count = pacmanDir.entries.filter(
                e => e.type === Gio.FileType.DIRECTORY && e.name !== 'ALPM_DB_VERSION'
            ).length;
            if (count > 0)
                return `${count} (pacman)`;
        }

        // 2. Debian/Ubuntu dpkg status file count
        const dpkgRes = await readFileAsync('/var/lib/dpkg/status', cancellable);
        if (dpkgRes.ok && dpkgRes.text) {
            let count = 0;
            const matches = dpkgRes.text.match(/^Status:\s+install ok installed$/gm);
            if (matches)
                count = matches.length;
            if (count > 0)
                return `${count} (dpkg)`;
        }

        // 3. RPM database fallback via rpm -qa if installed
        const rpmRes = await execCommandAsync(['rpm', '-qa'], cancellable);
        if (rpmRes.ok && rpmRes.stdout) {
            const lines = rpmRes.stdout.split('\n').filter(Boolean);
            if (lines.length > 0)
                return `${lines.length} (rpm)`;
        }

        return 'Not available';
    }

    _detectDesktopEnvironment(shellVersion) {
        const xdgDesktop = GLib.getenv('XDG_CURRENT_DESKTOP') || GLib.getenv('DESKTOP_SESSION') || 'GNOME';
        if (xdgDesktop.toUpperCase().includes('GNOME'))
            return `GNOME ${shellVersion}`;
        return `${xdgDesktop} (GNOME ${shellVersion})`;
    }

    _detectSessionType() {
        const sessionType = GLib.getenv('XDG_SESSION_TYPE');
        if (sessionType) {
            const lower = sessionType.toLowerCase();
            if (lower === 'wayland')
                return 'Wayland';
            if (lower === 'x11')
                return 'X11';
            return sessionType;
        }
        if (GLib.getenv('WAYLAND_DISPLAY'))
            return 'Wayland';
        if (GLib.getenv('DISPLAY'))
            return 'X11';
        return 'Unknown';
    }

    _detectLoginShell() {
        const envShell = GLib.getenv('SHELL');
        if (envShell)
            return GLib.path_get_basename(envShell);
        return 'Unknown';
    }

    /**
     * Reliably detects the user's configured default terminal emulator without
     * confusing it with the user's login shell ($SHELL) or inventing version numbers.
     */
    async _detectTerminalEmulator(cancellable) {
        let candidateExec = null;

        // 1. Check xdg-terminal-exec or GNOME default-applications.terminal GSettings if schema exists
        try {
            const schemaSource = Gio.SettingsSchemaSource.get_default();
            if (schemaSource) {
                const termSchema = schemaSource.lookup('org.gnome.desktop.default-applications.terminal', true);
                if (termSchema) {
                    const settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.default-applications.terminal' });
                    const execVal = settings.get_string('exec');
                    if (execVal && execVal.trim())
                        candidateExec = execVal.trim();
                }
            }
        } catch (_e) {
            // Ignore missing schema
        }

        // 2. Check environment variables if set explicitly (never $SHELL)
        if (!candidateExec) {
            const termEnv = GLib.getenv('TERMINAL');
            if (termEnv && termEnv.trim())
                candidateExec = termEnv.trim().split(/\s+/)[0];
        }

        // 3. Probe well-known installed GNOME/Arch terminal binaries on PATH
        const knownTerminals = [
            'kgx',
            'ptyxis',
            'gnome-terminal',
            'alacritty',
            'kitty',
            'foot',
            'wezterm',
            'tilix',
            'konsole',
            'xfce4-terminal',
        ];
        if (!candidateExec) {
            for (const bin of knownTerminals) {
                if (GLib.find_program_in_path(bin)) {
                    candidateExec = bin;
                    break;
                }
            }
        }

        if (!candidateExec)
            return 'Not available';

        const binaryName = GLib.path_get_basename(candidateExec);
        if (!GLib.find_program_in_path(binaryName))
            return binaryName;

        // Query actual "--version" output only when supported cleanly
        const verRes = await execCommandAsync([binaryName, '--version'], cancellable);
        if (verRes.ok && verRes.stdout) {
            const firstLine = verRes.stdout.split('\n')[0].trim();
            if (firstLine && firstLine.length <= 48)
                return firstLine.replace(/^#\s*/, '');
        }
        return binaryName;
    }

    destroy() {
        this._cachedStaticInfo = null;
    }
}
