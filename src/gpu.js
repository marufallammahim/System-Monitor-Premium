/**
 * System Monitor — Premium
 * Multi-GPU Telemetry Provider
 *
 * Supports AMD (amdgpu), Intel (i915/xe), NVIDIA (sysfs + optional non-privileged
 * nvidia-smi query when available), and generic DRM devices under /sys/class/drm.
 *
 * Explicitly distinguishes:
 * - No GPU detected
 * - GPU detected but does not expose utilization
 * - GPU with partial telemetry
 * - GPU with complete supported telemetry
 *
 * Never fabricates utilization, clock speed, temperature, power, VRAM, or fan RPM.
 */

import {
    BoundedHistory,
    SensorStatus,
    readSysfsLineAsync,
    readSysfsIntAsync,
    listDirectoryAsync,
    execCommandAsync,
    formatFrequencyMHz,
} from './telemetry.js';

export const GpuTelemetryState = Object.freeze({
    NO_GPU_DETECTED: 'No GPU Detected',
    DETECTED_NO_UTILIZATION: 'Detected (Utilization Unsupported by Driver)',
    PARTIAL_TELEMETRY: 'Partial Telemetry Available',
    COMPLETE_TELEMETRY: 'Complete Telemetry Supported',
});

const PCI_VENDORS = Object.freeze({
    '0x10de': 'NVIDIA',
    '0x1002': 'AMD',
    '0x1022': 'AMD',
    '0x8086': 'Intel',
    '0x1af4': 'VirtIO',
    '0x1234': 'QEMU/Bochs',
    '0x15ad': 'VMware',
});

export class GpuProvider {
    constructor(historyLength = 60) {
        this._historyLength = historyLength;
        this._gpuHistories = new Map(); // cardId -> { utilHistory, tempHistory }
        this._discoveredCards = null;
        this._lastDiscoveryUs = 0;
    }

    setHistoryLength(length) {
        this._historyLength = length;
        for (const hist of this._gpuHistories.values()) {
            hist.utilHistory.setMaxLength(length);
            hist.tempHistory.setMaxLength(length);
        }
    }

    async collect(cancellable = null) {
        const cards = await this._discoverDrmCards(cancellable);
        const nvidiaMap = await this._queryNvidiaSmiOptional(cancellable);

        if (cards.length === 0 && nvidiaMap.size === 0) {
            return {
                status: SensorStatus.NOT_AVAILABLE,
                telemetryState: GpuTelemetryState.NO_GPU_DETECTED,
                gpus: [],
                primaryGpu: null,
            };
        }

        const gpus = [];
        for (const card of cards) {
            const metrics = await this._collectCardMetrics(card, nvidiaMap, cancellable);
            gpus.push(metrics);
        }

        // If nvidia-smi found a GPU not listed in /sys/class/drm/cardN
        if (gpus.length === 0 && nvidiaMap.size > 0) {
            for (const [idx, nv] of nvidiaMap.entries()) {
                const id = `nvidia-${idx}`;
                const hist = this._getOrCreateHistory(id);
                hist.utilHistory.push(nv.utilization);
                hist.tempHistory.push(nv.temperatureCelsius);
                gpus.push({
                    id,
                    name: nv.name || 'NVIDIA GPU',
                    vendor: 'NVIDIA',
                    driver: 'nvidia',
                    utilization: nv.utilization,
                    coreClockMHz: nv.coreClockMHz,
                    coreClockFormatted: formatFrequencyMHz(nv.coreClockMHz),
                    temperatureCelsius: nv.temperatureCelsius,
                    vramTotalBytes: nv.vramTotalBytes,
                    vramUsedBytes: nv.vramUsedBytes,
                    vramAvailableBytes: (nv.vramTotalBytes !== null && nv.vramUsedBytes !== null)
                        ? Math.max(0, nv.vramTotalBytes - nv.vramUsedBytes)
                        : null,
                    powerWatts: nv.powerWatts,
                    fanRpm: nv.fanRpm,
                    fanPercent: nv.fanPercent,
                    telemetryState: this._classifyTelemetryState(nv),
                    utilHistory: hist.utilHistory.getValues(),
                    tempHistory: hist.tempHistory.getValues(),
                });
            }
        }

        // Prefer discrete GPU or GPU with active telemetry as primary
        const primaryGpu = gpus.find(g => g.telemetryState === GpuTelemetryState.COMPLETE_TELEMETRY) ||
            gpus.find(g => g.utilization !== null) ||
            gpus[0] ||
            null;

        return {
            status: SensorStatus.AVAILABLE,
            telemetryState: primaryGpu ? primaryGpu.telemetryState : GpuTelemetryState.NO_GPU_DETECTED,
            gpus,
            primaryGpu,
        };
    }

    _getOrCreateHistory(id) {
        if (!this._gpuHistories.has(id)) {
            this._gpuHistories.set(id, {
                utilHistory: new BoundedHistory(this._historyLength),
                tempHistory: new BoundedHistory(this._historyLength),
            });
        }
        return this._gpuHistories.get(id);
    }

    async _discoverDrmCards(cancellable) {
        const drmDir = await listDirectoryAsync('/sys/class/drm', cancellable);
        if (!drmDir.ok)
            return [];

        const cardNames = drmDir.entries
            .map(e => e.name)
            .filter(name => /^card\d+$/.test(name))
            .sort();

        const discovered = [];
        for (const cardName of cardNames) {
            const devPath = `/sys/class/drm/${cardName}/device`;
            const [vendorRes, deviceRes, ueventRes] = await Promise.all([
                readSysfsLineAsync(`${devPath}/vendor`, cancellable),
                readSysfsLineAsync(`${devPath}/device`, cancellable),
                readSysfsLineAsync(`${devPath}/uevent`, cancellable),
            ]);

            if (!vendorRes.ok && !ueventRes.ok)
                continue;

            const vendorHex = (vendorRes.value || '').toLowerCase();
            const vendorName = PCI_VENDORS[vendorHex] || 'Generic GPU';
            let driver = 'drm';
            let pciSlot = '';
            let productLabel = null;

            if (ueventRes.ok && ueventRes.value) {
                for (const line of ueventRes.value.split('\n')) {
                    if (line.startsWith('DRIVER='))
                        driver = line.slice(7).trim();
                    else if (line.startsWith('PCI_SLOT_NAME='))
                        pciSlot = line.slice(14).trim();
                }
            }

            const labelRes = await readSysfsLineAsync(`${devPath}/label`, cancellable);
            if (labelRes.ok && labelRes.value)
                productLabel = labelRes.value;

            const hwmonDir = await listDirectoryAsync(`${devPath}/hwmon`, cancellable);
            const hwmonPath = (hwmonDir.ok && hwmonDir.entries.length > 0)
                ? `${devPath}/hwmon/${hwmonDir.entries[0].name}`
                : null;

            const deviceHex = (deviceRes.value || '').replace(/^0x/i, '');
            const displayName = productLabel ||
                `${vendorName} Graphics${deviceHex ? ` (${deviceHex})` : ''}`;

            discovered.push({
                id: cardName,
                devPath,
                hwmonPath,
                vendorHex,
                vendor: vendorName,
                driver,
                pciSlot,
                name: displayName,
            });
        }

        return discovered;
    }

    async _collectCardMetrics(card, nvidiaMap, cancellable) {
        const dev = card.devPath;
        const hwmon = card.hwmonPath;

        // Check if nvidia-smi has telemetry for this NVIDIA card
        if (card.vendor === 'NVIDIA' && nvidiaMap.size > 0) {
            const nv = nvidiaMap.values().next().value;
            if (nv) {
                const hist = this._getOrCreateHistory(card.id);
                hist.utilHistory.push(nv.utilization);
                hist.tempHistory.push(nv.temperatureCelsius);
                const state = this._classifyTelemetryState(nv);
                return {
                    id: card.id,
                    name: nv.name || card.name,
                    vendor: card.vendor,
                    driver: card.driver || 'nvidia',
                    utilization: nv.utilization,
                    coreClockMHz: nv.coreClockMHz,
                    coreClockFormatted: formatFrequencyMHz(nv.coreClockMHz),
                    temperatureCelsius: nv.temperatureCelsius,
                    vramTotalBytes: nv.vramTotalBytes,
                    vramUsedBytes: nv.vramUsedBytes,
                    vramAvailableBytes: (nv.vramTotalBytes !== null && nv.vramUsedBytes !== null)
                        ? Math.max(0, nv.vramTotalBytes - nv.vramUsedBytes)
                        : null,
                    powerWatts: nv.powerWatts,
                    fanRpm: nv.fanRpm,
                    fanPercent: nv.fanPercent,
                    telemetryState: state,
                    utilHistory: hist.utilHistory.getValues(),
                    tempHistory: hist.tempHistory.getValues(),
                };
            }
        }

        // Read sysfs/hwmon nodes in parallel (supports amdgpu, i915, xe, nouveau)
        const [
            busyRes,
            gtCurFreqRes,
            gtActFreqRes,
            ppDpmSclkRes,
            vramTotalRes,
            vramUsedRes,
            tempRes,
            powerAvgRes,
            powerInputRes,
            fanInputRes,
        ] = await Promise.all([
            readSysfsIntAsync(`${dev}/gpu_busy_percent`, cancellable),
            readSysfsIntAsync(`/sys/class/drm/${card.id}/gt_cur_freq_mhz`, cancellable),
            readSysfsIntAsync(`/sys/class/drm/${card.id}/gt_act_freq_mhz`, cancellable),
            readSysfsLineAsync(`${dev}/pp_dpm_sclk`, cancellable),
            readSysfsIntAsync(`${dev}/mem_info_vram_total`, cancellable),
            readSysfsIntAsync(`${dev}/mem_info_vram_used`, cancellable),
            hwmon ? readSysfsIntAsync(`${hwmon}/temp1_input`, cancellable) : Promise.resolve({ ok: false, value: null }),
            hwmon ? readSysfsIntAsync(`${hwmon}/power1_average`, cancellable) : Promise.resolve({ ok: false, value: null }),
            hwmon ? readSysfsIntAsync(`${hwmon}/power1_input`, cancellable) : Promise.resolve({ ok: false, value: null }),
            hwmon ? readSysfsIntAsync(`${hwmon}/fan1_input`, cancellable) : Promise.resolve({ ok: false, value: null }),
        ]);

        const utilization = (busyRes.ok && busyRes.value !== null)
            ? Math.min(100, Math.max(0, busyRes.value))
            : null;

        // Clock speed in MHz
        let coreClockMHz = null;
        if (gtActFreqRes.ok && gtActFreqRes.value > 0) {
            coreClockMHz = gtActFreqRes.value;
        } else if (gtCurFreqRes.ok && gtCurFreqRes.value > 0) {
            coreClockMHz = gtCurFreqRes.value;
        } else if (ppDpmSclkRes.ok && ppDpmSclkRes.value) {
            // Parse active state marked with '*' e.g. "1: 1450Mhz *"
            for (const line of ppDpmSclkRes.value.split('\n')) {
                if (line.includes('*')) {
                    const m = line.match(/(\d+)\s*Mhz/i);
                    if (m) {
                        coreClockMHz = Number.parseInt(m[1], 10);
                        break;
                    }
                }
            }
        } else if (hwmon) {
            const freqInputRes = await readSysfsIntAsync(`${hwmon}/freq1_input`, cancellable);
            if (freqInputRes.ok && freqInputRes.value > 0)
                coreClockMHz = freqInputRes.value / 1_000_000;
        }

        const temperatureCelsius = (tempRes.ok && tempRes.value > 0)
            ? tempRes.value / 1000.0
            : null;

        const vramTotalBytes = (vramTotalRes.ok && vramTotalRes.value > 0)
            ? vramTotalRes.value
            : null;
        const vramUsedBytes = (vramUsedRes.ok && vramUsedRes.value >= 0)
            ? vramUsedRes.value
            : null;
        const vramAvailableBytes = (vramTotalBytes !== null && vramUsedBytes !== null)
            ? Math.max(0, vramTotalBytes - vramUsedBytes)
            : null;

        // Power in microwatts -> Watts
        const rawPowerUw = powerAvgRes.ok ? powerAvgRes.value : (powerInputRes.ok ? powerInputRes.value : null);
        const powerWatts = (rawPowerUw !== null && rawPowerUw >= 0)
            ? rawPowerUw / 1_000_000.0
            : null;

        const fanRpm = (fanInputRes.ok && fanInputRes.value !== null && fanInputRes.value >= 0)
            ? fanInputRes.value
            : null;

        const hist = this._getOrCreateHistory(card.id);
        hist.utilHistory.push(utilization);
        hist.tempHistory.push(temperatureCelsius);

        const metricObj = {
            id: card.id,
            name: card.name,
            vendor: card.vendor,
            driver: card.driver,
            utilization,
            coreClockMHz,
            coreClockFormatted: formatFrequencyMHz(coreClockMHz),
            temperatureCelsius,
            vramTotalBytes,
            vramUsedBytes,
            vramAvailableBytes,
            powerWatts,
            fanRpm,
            fanPercent: null,
        };

        metricObj.telemetryState = this._classifyTelemetryState(metricObj);
        metricObj.utilHistory = hist.utilHistory.getValues();
        metricObj.tempHistory = hist.tempHistory.getValues();

        return metricObj;
    }

    _classifyTelemetryState(m) {
        const hasUtil = m.utilization !== null;
        const hasClock = m.coreClockMHz !== null;
        const hasTemp = m.temperatureCelsius !== null;
        const hasVram = m.vramTotalBytes !== null && m.vramUsedBytes !== null;
        const hasPower = m.powerWatts !== null;

        if (hasUtil && hasClock && hasTemp && (hasVram || hasPower))
            return GpuTelemetryState.COMPLETE_TELEMETRY;
        if (!hasUtil)
            return GpuTelemetryState.DETECTED_NO_UTILIZATION;
        return GpuTelemetryState.PARTIAL_TELEMETRY;
    }

    async _queryNvidiaSmiOptional(cancellable) {
        const map = new Map();
        const res = await execCommandAsync([
            'nvidia-smi',
            '--query-gpu=index,name,utilization.gpu,clocks.current.graphics,temperature.gpu,memory.total,memory.used,power.draw,fan.speed',
            '--format=csv,noheader,nounits',
        ], cancellable);

        if (!res.ok || !res.stdout)
            return map;

        for (const rawLine of res.stdout.split('\n')) {
            const line = rawLine.trim();
            if (!line)
                continue;
            const cols = line.split(',').map(c => c.trim());
            if (cols.length < 9)
                continue;

            const parseNum = s => {
                if (!s || s.includes('N/A') || s.includes('Not Supported'))
                    return null;
                const n = Number.parseFloat(s);
                return Number.isFinite(n) ? n : null;
            };

            const idx = Number.parseInt(cols[0], 10) || 0;
            const name = cols[1] || 'NVIDIA GPU';
            const utilization = parseNum(cols[2]);
            const coreClockMHz = parseNum(cols[3]);
            const temperatureCelsius = parseNum(cols[4]);
            const memTotalMiB = parseNum(cols[5]);
            const memUsedMiB = parseNum(cols[6]);
            const powerWatts = parseNum(cols[7]);
            const fanPercent = parseNum(cols[8]);

            map.set(idx, {
                name,
                utilization,
                coreClockMHz,
                temperatureCelsius,
                vramTotalBytes: memTotalMiB !== null ? memTotalMiB * 1024 * 1024 : null,
                vramUsedBytes: memUsedMiB !== null ? memUsedMiB * 1024 * 1024 : null,
                powerWatts,
                fanRpm: null,
                fanPercent,
            });
        }

        return map;
    }

    destroy() {
        for (const hist of this._gpuHistories.values()) {
            hist.utilHistory.clear();
            hist.tempHistory.clear();
        }
        this._gpuHistories.clear();
    }
}
