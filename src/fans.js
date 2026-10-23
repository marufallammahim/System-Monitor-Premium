/**
 * System Monitor — Premium
 * Hardware Fan and Thermal Sensor Telemetry Provider
 *
 * Enumerates /sys/class/hwmon/hwmonN/fanM_input asynchronously.
 * Distinguishes:
 * - Reported 0 RPM (fan stopped / passive zero-RPM mode)
 * - Active rotating fan (> 0 RPM)
 * - No readable fan sensors exposed by kernel/driver
 */

import {
    BoundedHistory,
    SensorStatus,
    listDirectoryAsync,
    readSysfsLineAsync,
    readSysfsIntAsync,
} from './telemetry.js';

export class FanProvider {
    constructor(historyLength = 60) {
        this._historyLength = historyLength;
        this._fanHistories = new Map();
    }

    setHistoryLength(length) {
        this._historyLength = length;
        for (const h of this._fanHistories.values())
            h.setMaxLength(length);
    }

    async collect(cancellable = null) {
        const hwmonDir = await listDirectoryAsync('/sys/class/hwmon', cancellable);
        if (!hwmonDir.ok || hwmonDir.entries.length === 0) {
            return {
                status: SensorStatus.NOT_AVAILABLE,
                fans: [],
                cpuFan: null,
                gpuFan: null,
            };
        }

        const fans = [];
        for (const entry of hwmonDir.entries) {
            const base = `/sys/class/hwmon/${entry.name}`;
            const [nameRes, temp1Res] = await Promise.all([
                readSysfsLineAsync(`${base}/name`, cancellable),
                readSysfsIntAsync(`${base}/temp1_input`, cancellable),
            ]);

            const driverName = (nameRes.ok && nameRes.value) ? nameRes.value : entry.name;
            const associatedTempCelsius = (temp1Res.ok && temp1Res.value > 0)
                ? temp1Res.value / 1000.0
                : null;

            for (let i = 1; i <= 6; i++) {
                const inputPath = `${base}/fan${i}_input`;
                const rpmRes = await readSysfsIntAsync(inputPath, cancellable);
                if (!rpmRes.ok || rpmRes.value === null || rpmRes.value < 0)
                    continue;

                const [labelRes, maxRes] = await Promise.all([
                    readSysfsLineAsync(`${base}/fan${i}_label`, cancellable),
                    readSysfsIntAsync(`${base}/fan${i}_max`, cancellable),
                ]);

                const rawLabel = (labelRes.ok && labelRes.value) ? labelRes.value : '';
                const role = this._classifyFanRole(driverName, rawLabel, i);
                const fanId = `${entry.name}-fan${i}`;
                const rpm = rpmRes.value;
                const maxRpm = (maxRes.ok && maxRes.value > 500) ? maxRes.value : 4500;

                if (!this._fanHistories.has(fanId))
                    this._fanHistories.set(fanId, new BoundedHistory(this._historyLength));
                const hist = this._fanHistories.get(fanId);
                hist.push(rpm);

                fans.push({
                    id: fanId,
                    driver: driverName,
                    label: rawLabel || `${role} (${driverName})`,
                    role,
                    rpm,
                    maxRpm,
                    percentOfMax: Math.min(100, Math.max(0, (rpm / maxRpm) * 100)),
                    isRotating: rpm > 0,
                    associatedTempCelsius,
                    status: SensorStatus.AVAILABLE,
                    rpmHistory: hist.getValues(),
                });
            }
        }

        const cpuFan = fans.find(f => f.role === 'CPU Fan') || fans[0] || null;
        const gpuFan = fans.find(f => f.role === 'GPU Fan') || (fans.length > 1 ? fans[1] : null);

        return {
            status: fans.length > 0 ? SensorStatus.AVAILABLE : SensorStatus.NOT_AVAILABLE,
            fans,
            cpuFan,
            gpuFan,
        };
    }

    _classifyFanRole(driverName, label, index) {
        const d = (driverName || '').toLowerCase();
        const l = (label || '').toLowerCase();
        if (l.includes('gpu') || d.includes('amdgpu') || d.includes('nvidia') || d.includes('nouveau') || d.includes('i915') || d.includes('xe'))
            return 'GPU Fan';
        if (l.includes('cpu') || l.includes('processor'))
            return 'CPU Fan';
        if (index === 1)
            return 'CPU Fan';
        if (index === 2)
            return 'GPU Fan';
        return `System Fan ${index}`;
    }

    destroy() {
        for (const h of this._fanHistories.values())
            h.clear();
        this._fanHistories.clear();
    }
}
