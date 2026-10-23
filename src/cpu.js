/**
 * System Monitor — Premium
 * CPU Telemetry Provider
 *
 * Calculates differential CPU utilization from /proc/stat (total, user, system,
 * idle, iowait, irq/softirq, steal, and per-core/thread utilization), reads
 * per-core frequencies from /sys/devices/system/cpu/cpuN/cpufreq or /proc/cpuinfo,
 * and discovers CPU package temperature sensors from /sys/class/hwmon.
 */

import {
    BoundedHistory,
    SensorStatus,
    readFileAsync,
    readSysfsIntAsync,
    readSysfsLineAsync,
    listDirectoryAsync,
    formatFrequencyMHz,
} from './telemetry.js';

export class CpuProvider {
    constructor(historyLength = 60) {
        this._prevTotalCounters = null;
        this._prevCoreCounters = new Map();
        this._hwmonTempPath = undefined; // undefined = not probed yet, null = none found

        this.totalHistory = new BoundedHistory(historyLength);
        this.userHistory = new BoundedHistory(historyLength);
        this.systemHistory = new BoundedHistory(historyLength);
        this.tempHistory = new BoundedHistory(historyLength);
    }

    setHistoryLength(length) {
        this.totalHistory.setMaxLength(length);
        this.userHistory.setMaxLength(length);
        this.systemHistory.setMaxLength(length);
        this.tempHistory.setMaxLength(length);
    }

    async collect(cancellable = null) {
        const [statRes, freqMap, tempCelsius] = await Promise.all([
            readFileAsync('/proc/stat', cancellable),
            this._readCoreFrequenciesMHz(cancellable),
            this._readCpuTemperatureCelsius(cancellable),
        ]);

        if (!statRes.ok || !statRes.text) {
            this.totalHistory.push(null);
            this.userHistory.push(null);
            this.systemHistory.push(null);
            this.tempHistory.push(null);
            return {
                status: statRes.status,
                totalUsage: null,
                userUsage: null,
                systemUsage: null,
                iowaitUsage: null,
                idlePercent: null,
                unusedCapacity: null,
                avgFrequencyMHz: null,
                avgFrequencyFormatted: 'N/A',
                temperatureCelsius: null,
                coreCount: 0,
                cores: [],
                totalHistory: this.totalHistory.getValues(),
                userHistory: this.userHistory.getValues(),
                systemHistory: this.systemHistory.getValues(),
                tempHistory: this.tempHistory.getValues(),
            };
        }

        const lines = statRes.text.split('\n');
        let totalMetrics = {
            totalUsage: 0,
            userUsage: 0,
            systemUsage: 0,
            iowaitUsage: 0,
            idlePercent: 100,
        };

        const cores = [];

        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith('cpu'))
                continue;

            const parts = line.split(/\s+/);
            const label = parts[0];
            if (label !== 'cpu' && !/^cpu\d+$/.test(label))
                continue;

            // Fields: user nice system idle iowait irq softirq steal guest guest_nice
            const user = Number.parseInt(parts[1] || '0', 10);
            const nice = Number.parseInt(parts[2] || '0', 10);
            const system = Number.parseInt(parts[3] || '0', 10);
            const idle = Number.parseInt(parts[4] || '0', 10);
            const iowait = Number.parseInt(parts[5] || '0', 10);
            const irq = Number.parseInt(parts[6] || '0', 10);
            const softirq = Number.parseInt(parts[7] || '0', 10);
            const steal = Number.parseInt(parts[8] || '0', 10);

            const userTotal = user + nice;
            const sysTotal = system + irq + softirq;
            const idleTotal = idle + iowait;
            const activeTotal = userTotal + sysTotal + steal;
            const grandTotal = activeTotal + idleTotal;

            const currentSample = {
                userTotal,
                sysTotal,
                idle,
                iowait,
                idleTotal,
                activeTotal,
                grandTotal,
            };

            if (label === 'cpu') {
                if (this._prevTotalCounters) {
                    totalMetrics = this._computeDeltaPercentages(this._prevTotalCounters, currentSample);
                }
                this._prevTotalCounters = currentSample;
            } else {
                const coreIdx = Number.parseInt(label.slice(3), 10);
                const prevCore = this._prevCoreCounters.get(coreIdx);
                const coreDelta = prevCore
                    ? this._computeDeltaPercentages(prevCore, currentSample)
                    : { totalUsage: 0, userUsage: 0, systemUsage: 0, idlePercent: 100 };
                this._prevCoreCounters.set(coreIdx, currentSample);

                const freqMHz = freqMap.has(coreIdx) ? freqMap.get(coreIdx) : null;
                cores.push({
                    index: coreIdx,
                    label: `Core ${coreIdx + 1}`,
                    usage: coreDelta.totalUsage,
                    userUsage: coreDelta.userUsage,
                    systemUsage: coreDelta.systemUsage,
                    idlePercent: coreDelta.idlePercent,
                    frequencyMHz: freqMHz,
                    frequencyFormatted: formatFrequencyMHz(freqMHz),
                });
            }
        }

        cores.sort((a, b) => a.index - b.index);

        // Compute average CPU frequency across cores that expose valid frequency
        const validFreqs = cores
            .map(c => c.frequencyMHz)
            .filter(f => typeof f === 'number' && Number.isFinite(f) && f > 0);
        const avgFrequencyMHz = validFreqs.length > 0
            ? validFreqs.reduce((acc, v) => acc + v, 0) / validFreqs.length
            : null;

        this.totalHistory.push(totalMetrics.totalUsage);
        this.userHistory.push(totalMetrics.userUsage);
        this.systemHistory.push(totalMetrics.systemUsage);
        this.tempHistory.push(tempCelsius);

        return {
            status: SensorStatus.AVAILABLE,
            totalUsage: totalMetrics.totalUsage,
            userUsage: totalMetrics.userUsage,
            systemUsage: totalMetrics.systemUsage,
            iowaitUsage: totalMetrics.iowaitUsage,
            idlePercent: totalMetrics.idlePercent,
            unusedCapacity: Math.max(0, 100 - totalMetrics.totalUsage),
            avgFrequencyMHz,
            avgFrequencyFormatted: formatFrequencyMHz(avgFrequencyMHz),
            temperatureCelsius: tempCelsius,
            coreCount: cores.length,
            cores,
            totalHistory: this.totalHistory.getValues(),
            userHistory: this.userHistory.getValues(),
            systemHistory: this.systemHistory.getValues(),
            tempHistory: this.tempHistory.getValues(),
        };
    }

    _computeDeltaPercentages(prev, curr) {
        const totalDiff = curr.grandTotal - prev.grandTotal;
        if (totalDiff <= 0) {
            return {
                totalUsage: 0,
                userUsage: 0,
                systemUsage: 0,
                iowaitUsage: 0,
                idlePercent: 100,
            };
        }

        const activeDiff = Math.max(0, curr.activeTotal - prev.activeTotal);
        const userDiff = Math.max(0, curr.userTotal - prev.userTotal);
        const sysDiff = Math.max(0, curr.sysTotal - prev.sysTotal);
        const iowaitDiff = Math.max(0, curr.iowait - prev.iowait);

        const totalUsage = Math.min(100, Math.max(0, (activeDiff / totalDiff) * 100));
        const userUsage = Math.min(100, Math.max(0, (userDiff / totalDiff) * 100));
        const systemUsage = Math.min(100, Math.max(0, (sysDiff / totalDiff) * 100));
        const iowaitUsage = Math.min(100, Math.max(0, (iowaitDiff / totalDiff) * 100));
        const idlePercent = Math.max(0, 100 - totalUsage);

        return {
            totalUsage,
            userUsage,
            systemUsage,
            iowaitUsage,
            idlePercent,
        };
    }

    async _readCoreFrequenciesMHz(cancellable) {
        const freqMap = new Map();

        // 1. Try /proc/cpuinfo first (single non-blocking read covers all cores on x86_64)
        const cpuinfoRes = await readFileAsync('/proc/cpuinfo', cancellable);
        if (cpuinfoRes.ok && cpuinfoRes.text) {
            let currentProcessor = null;
            for (const line of cpuinfoRes.text.split('\n')) {
                if (line.startsWith('processor')) {
                    const idx = line.indexOf(':');
                    if (idx !== -1)
                        currentProcessor = Number.parseInt(line.slice(idx + 1).trim(), 10);
                } else if (line.startsWith('cpu MHz') && currentProcessor !== null) {
                    const idx = line.indexOf(':');
                    if (idx !== -1) {
                        const mhz = Number.parseFloat(line.slice(idx + 1).trim());
                        if (Number.isFinite(mhz) && mhz > 0)
                            freqMap.set(currentProcessor, mhz);
                    }
                }
            }
        }

        if (freqMap.size > 0)
            return freqMap;

        // 2. Fallback to cpufreq scaling_cur_freq (in kHz) under /sys/devices/system/cpu/
        const cpuDir = await listDirectoryAsync('/sys/devices/system/cpu', cancellable);
        if (!cpuDir.ok)
            return freqMap;

        const cpuEntries = cpuDir.entries
            .filter(e => /^cpu\d+$/.test(e.name))
            .slice(0, 64);

        await Promise.all(cpuEntries.map(async entry => {
            const coreIdx = Number.parseInt(entry.name.slice(3), 10);
            const khzRes = await readSysfsIntAsync(
                `/sys/devices/system/cpu/${entry.name}/cpufreq/scaling_cur_freq`,
                cancellable
            );
            if (khzRes.ok && khzRes.value && khzRes.value > 0)
                freqMap.set(coreIdx, khzRes.value / 1000.0);
        }));

        return freqMap;
    }

    async _readCpuTemperatureCelsius(cancellable) {
        if (this._hwmonTempPath === undefined)
            this._hwmonTempPath = await this._discoverCpuTempSensorPath(cancellable);

        if (!this._hwmonTempPath)
            return null;

        const res = await readSysfsIntAsync(this._hwmonTempPath, cancellable);
        if (!res.ok || res.value === null) {
            // Re-discover next cycle if sensor disappeared
            this._hwmonTempPath = undefined;
            return null;
        }

        const celsius = res.value > 1000 ? res.value / 1000.0 : res.value;
        if (celsius <= -40 || celsius >= 150)
            return null;
        return celsius;
    }

    async _discoverCpuTempSensorPath(cancellable) {
        const hwmonList = await listDirectoryAsync('/sys/class/hwmon', cancellable);
        if (hwmonList.ok && hwmonList.entries.length > 0) {
            const preferredDrivers = new Set([
                'coretemp',
                'k10temp',
                'zenpower',
                'cpu_thermal',
                'acpitz',
                'thinkpad',
                'dell_smm',
                'asus',
            ]);

            let fallbackCandidate = null;

            for (const entry of hwmonList.entries) {
                const base = `/sys/class/hwmon/${entry.name}`;
                const nameRes = await readSysfsLineAsync(`${base}/name`, cancellable);
                const driverName = (nameRes.ok && nameRes.value) ? nameRes.value.toLowerCase() : '';

                for (let i = 1; i <= 6; i++) {
                    const inputPath = `${base}/temp${i}_input`;
                    const valRes = await readSysfsIntAsync(inputPath, cancellable);
                    if (!valRes.ok || valRes.value === null || valRes.value <= 0)
                        continue;

                    const labelRes = await readSysfsLineAsync(`${base}/temp${i}_label`, cancellable);
                    const label = (labelRes.ok && labelRes.value) ? labelRes.value.toLowerCase() : '';

                    if (
                        preferredDrivers.has(driverName) &&
                        (label.includes('package') || label.includes('tdie') || label.includes('tctl') || label.includes('core 0') || i === 1)
                    ) {
                        return inputPath;
                    }

                    if (!fallbackCandidate && preferredDrivers.has(driverName))
                        fallbackCandidate = inputPath;
                }
            }

            if (fallbackCandidate)
                return fallbackCandidate;
        }

        // Fallback to /sys/class/thermal/thermal_zone* matching x86_pkg_temp or cpu
        const thermalList = await listDirectoryAsync('/sys/class/thermal', cancellable);
        if (thermalList.ok) {
            for (const entry of thermalList.entries) {
                if (!entry.name.startsWith('thermal_zone'))
                    continue;
                const base = `/sys/class/thermal/${entry.name}`;
                const typeRes = await readSysfsLineAsync(`${base}/type`, cancellable);
                const typeName = (typeRes.ok && typeRes.value) ? typeRes.value.toLowerCase() : '';
                if (typeName.includes('pkg') || typeName.includes('cpu') || typeName.includes('core') || typeName.includes('acpitz')) {
                    const tempRes = await readSysfsIntAsync(`${base}/temp`, cancellable);
                    if (tempRes.ok && tempRes.value && tempRes.value > 0)
                        return `${base}/temp`;
                }
            }
        }

        return null;
    }

    destroy() {
        this.totalHistory.clear();
        this.userHistory.clear();
        this.systemHistory.clear();
        this.tempHistory.clear();
        this._prevTotalCounters = null;
        this._prevCoreCounters.clear();
    }
}
