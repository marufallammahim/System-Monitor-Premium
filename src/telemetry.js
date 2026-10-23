/**
 * System Monitor — Premium (system-monitor@marufallammahim.github.io)
 * Asynchronous Hardware Telemetry Primitives & Bounded Ring Buffers
 *
 * Strictly uses non-blocking Gio.File.load_contents_async and Gio.Subprocess
 * to satisfy EGO-X-004 (no GLib.file_get_contents or synchronous file reads).
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

// Promisify Gio asynchronous methods once at module load
Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
Gio._promisify(Gio.File.prototype, 'enumerate_children_async', 'enumerate_children_finish');
Gio._promisify(Gio.File.prototype, 'query_filesystem_info_async', 'query_filesystem_info_finish');
Gio._promisify(Gio.File.prototype, 'query_info_async', 'query_info_finish');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async', 'next_files_finish');
Gio._promisify(Gio.FileEnumerator.prototype, 'close_async', 'close_finish');
Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');

const UTF8_DECODER = new TextDecoder('utf-8');

/**
 * Standard telemetry state constants for clear UX and accessibility labels.
 */
export const SensorStatus = Object.freeze({
    AVAILABLE: 'Available',
    NOT_AVAILABLE: 'Not Available',
    UNSUPPORTED: 'Unsupported by Driver',
    PERMISSION_DENIED: 'Permission Denied',
    READING: 'Reading Sensor',
    ERROR: 'Sensor Error',
});

/**
 * Bounded ring buffer for storing rolling time-series telemetry samples
 * without unbounded array growth or frequent array re-allocations.
 */
export class BoundedHistory {
    constructor(maxLength = 60) {
        this._maxLength = Math.max(10, Math.min(600, maxLength));
        this._samples = [];
    }

    setMaxLength(maxLength) {
        this._maxLength = Math.max(10, Math.min(600, maxLength));
        while (this._samples.length > this._maxLength)
            this._samples.shift();
    }

    push(value, timestamp = GLib.get_monotonic_time()) {
        const numericValue = (typeof value === 'number' && Number.isFinite(value)) ? value : null;
        this._samples.push({
            value: numericValue,
            timestamp,
        });
        while (this._samples.length > this._maxLength)
            this._samples.shift();
    }

    getValues() {
        return this._samples.map(s => s.value);
    }

    getSamples() {
        return this._samples.slice();
    }

    getLatest() {
        if (this._samples.length === 0)
            return null;
        return this._samples[this._samples.length - 1].value;
    }

    get length() {
        return this._samples.length;
    }

    clear() {
        this._samples = [];
    }
}

/**
 * Asynchronously reads a UTF-8 text file via Gio.File.load_contents_async.
 * Returns { ok, text, status, error }.
 */
export async function readFileAsync(path, cancellable = null) {
    try {
        const file = Gio.File.new_for_path(path);
        const [contents] = await file.load_contents_async(cancellable);
        const text = UTF8_DECODER.decode(contents);
        return {
            ok: true,
            text,
            status: SensorStatus.AVAILABLE,
            error: null,
        };
    } catch (err) {
        if (err.matches && err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
            return {
                ok: false,
                text: null,
                status: SensorStatus.NOT_AVAILABLE,
                error: 'Cancelled',
                cancelled: true,
            };
        }
        if (err.matches && err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.PERMISSION_DENIED)) {
            return {
                ok: false,
                text: null,
                status: SensorStatus.PERMISSION_DENIED,
                error: err.message,
            };
        }
        if (err.matches && err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
            return {
                ok: false,
                text: null,
                status: SensorStatus.NOT_AVAILABLE,
                error: err.message,
            };
        }
        return {
            ok: false,
            text: null,
            status: SensorStatus.ERROR,
            error: err.message || String(err),
        };
    }
}

/**
 * Asynchronously reads and trims a single-line numeric or string sysfs node.
 */
export async function readSysfsLineAsync(path, cancellable = null) {
    const res = await readFileAsync(path, cancellable);
    if (!res.ok || res.text === null)
        return { ok: false, value: null, status: res.status };
    return {
        ok: true,
        value: res.text.trim(),
        status: SensorStatus.AVAILABLE,
    };
}

/**
 * Asynchronously reads an integer value from a sysfs file.
 */
export async function readSysfsIntAsync(path, cancellable = null) {
    const res = await readSysfsLineAsync(path, cancellable);
    if (!res.ok || res.value === null || res.value === '')
        return { ok: false, value: null, status: res.status };
    const parsed = Number.parseInt(res.value, 10);
    if (!Number.isFinite(parsed))
        return { ok: false, value: null, status: SensorStatus.ERROR };
    return { ok: true, value: parsed, status: SensorStatus.AVAILABLE };
}

/**
 * Asynchronously lists directory entries under `dirPath`.
 */
export async function listDirectoryAsync(dirPath, cancellable = null) {
    let enumerator = null;
    try {
        const dir = Gio.File.new_for_path(dirPath);
        enumerator = await dir.enumerate_children_async(
            'standard::name,standard::type,standard::is-symlink',
            Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT,
            cancellable
        );
        const entries = [];
        while (true) {
            const files = await enumerator.next_files_async(32, GLib.PRIORITY_DEFAULT, cancellable);
            if (!files || files.length === 0)
                break;
            for (const info of files) {
                entries.push({
                    name: info.get_name(),
                    type: info.get_file_type(),
                });
            }
        }
        await enumerator.close_async(GLib.PRIORITY_DEFAULT, cancellable);
        enumerator = null;
        return { ok: true, entries, status: SensorStatus.AVAILABLE };
    } catch (err) {
        if (enumerator) {
            try {
                await enumerator.close_async(GLib.PRIORITY_DEFAULT, null);
            } catch (_e) {
                // ignore secondary close error
            }
        }
        return {
            ok: false,
            entries: [],
            status: SensorStatus.NOT_AVAILABLE,
            error: err.message || String(err),
        };
    }
}

/**
 * Asynchronously executes a read-only helper command if present on PATH.
 * Never invokes privileged utilities or shells.
 */
export async function execCommandAsync(argv, cancellable = null) {
    try {
        const executable = GLib.find_program_in_path(argv[0]);
        if (!executable)
            return { ok: false, stdout: null, stderr: 'Executable not found', status: SensorStatus.NOT_AVAILABLE };

        const proc = Gio.Subprocess.new(
            argv,
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
        const [stdout, stderr] = await proc.communicate_utf8_async(null, cancellable);
        if (!proc.get_successful()) {
            return {
                ok: false,
                stdout: stdout ? stdout.trim() : null,
                stderr: stderr ? stderr.trim() : null,
                status: SensorStatus.ERROR,
            };
        }
        return {
            ok: true,
            stdout: stdout ? stdout.trim() : '',
            stderr: stderr ? stderr.trim() : '',
            status: SensorStatus.AVAILABLE,
        };
    } catch (err) {
        return {
            ok: false,
            stdout: null,
            stderr: err.message || String(err),
            status: SensorStatus.ERROR,
        };
    }
}

/**
 * Formats byte counts into human-readable binary units (KiB, MiB, GiB, TiB).
 */
export function formatBytes(bytes, decimals = 1) {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0)
        return 'N/A';
    if (bytes === 0)
        return '0 B';
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    const k = 1024;
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
    const value = bytes / Math.pow(k, i);
    return `${value.toFixed(i === 0 ? 0 : decimals)} ${units[i]}`;
}

/**
 * Formats temperature according to user unit preference ('celsius' or 'fahrenheit').
 */
export function formatTemperature(celsius, unit = 'celsius') {
    if (typeof celsius !== 'number' || !Number.isFinite(celsius))
        return 'N/A';
    if (unit === 'fahrenheit') {
        const f = (celsius * 9) / 5 + 32;
        return `${Math.round(f)}°F`;
    }
    return `${Math.round(celsius)}°C`;
}

/**
 * Formats frequency in MHz or kHz to human-readable GHz/MHz string.
 * Never returns 0.00 GHz when frequency is unavailable.
 */
export function formatFrequencyMHz(mhz) {
    if (typeof mhz !== 'number' || !Number.isFinite(mhz) || mhz <= 0)
        return 'N/A';
    if (mhz >= 1000)
        return `${(mhz / 1000).toFixed(2)} GHz`;
    return `${Math.round(mhz)} MHz`;
}

/**
 * Formats durations in seconds into human-readable string (e.g. "1 hour, 24 minutes" or "2h 45m").
 */
export function formatDurationSeconds(totalSeconds, compact = false) {
    if (typeof totalSeconds !== 'number' || !Number.isFinite(totalSeconds) || totalSeconds <= 0)
        return 'Estimating unavailable';

    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    if (compact) {
        const parts = [];
        if (days > 0)
            parts.push(`${days}d`);
        if (hours > 0)
            parts.push(`${hours}h`);
        parts.push(`${minutes}m`);
        return parts.join(' ');
    }

    const parts = [];
    if (days > 0)
        parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
    if (hours > 0)
        parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
    parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
    return parts.join(', ');
}
