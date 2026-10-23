/**
 * System Monitor — Premium
 * RAM and Swap Telemetry Provider
 *
 * Parses /proc/meminfo asynchronously and calculates true application-used
 * memory without misclassifying reclaimable page cache as permanently unavailable.
 */

import {
    BoundedHistory,
    SensorStatus,
    readFileAsync,
    formatBytes,
} from './telemetry.js';

export class MemoryProvider {
    constructor(historyLength = 60) {
        this.ramHistory = new BoundedHistory(historyLength);
        this.swapHistory = new BoundedHistory(historyLength);
    }

    setHistoryLength(length) {
        this.ramHistory.setMaxLength(length);
        this.swapHistory.setMaxLength(length);
    }

    async collect(cancellable = null) {
        const res = await readFileAsync('/proc/meminfo', cancellable);
        if (!res.ok || !res.text) {
            this.ramHistory.push(null);
            this.swapHistory.push(null);
            return {
                status: res.status,
                ramTotalBytes: null,
                ramUsedBytes: null,
                ramAvailableBytes: null,
                ramFreeBytes: null,
                ramCachedBytes: null,
                ramBuffersBytes: null,
                ramReclaimableBytes: null,
                ramPercent: null,
                swapTotalBytes: null,
                swapUsedBytes: null,
                swapFreeBytes: null,
                swapPercent: null,
                ramHistory: this.ramHistory.getValues(),
                swapHistory: this.swapHistory.getValues(),
            };
        }

        const memKiB = {};
        for (const rawLine of res.text.split('\n')) {
            const line = rawLine.trim();
            if (!line)
                continue;
            const match = line.match(/^([A-Za-z0-9_()]+):\s+(\d+)/);
            if (match)
                memKiB[match[1]] = Number.parseInt(match[2], 10);
        }

        const totalKiB = memKiB.MemTotal || 0;
        const freeKiB = memKiB.MemFree || 0;
        const buffersKiB = memKiB.Buffers || 0;
        const cachedBaseKiB = memKiB.Cached || 0;
        const sReclaimableKiB = memKiB.SReclaimable || 0;
        const shmemKiB = memKiB.Shmem || 0;

        // Effective cached memory includes page cache + slab reclaimable
        const effectiveCachedKiB = Math.max(0, cachedBaseKiB + sReclaimableKiB - shmemKiB);

        // Use kernel MemAvailable when exposed; otherwise compute conservatively
        const availableKiB = ('MemAvailable' in memKiB)
            ? memKiB.MemAvailable
            : Math.min(totalKiB, freeKiB + buffersKiB + effectiveCachedKiB);

        // True used memory excludes available/reclaimable memory
        const usedKiB = Math.max(0, totalKiB - availableKiB);
        const ramPercent = totalKiB > 0
            ? Math.min(100, Math.max(0, (usedKiB / totalKiB) * 100))
            : 0;

        const swapTotalKiB = memKiB.SwapTotal || 0;
        const swapFreeKiB = memKiB.SwapFree || 0;
        const swapUsedKiB = Math.max(0, swapTotalKiB - swapFreeKiB);
        const swapPercent = swapTotalKiB > 0
            ? Math.min(100, Math.max(0, (swapUsedKiB / swapTotalKiB) * 100))
            : 0;

        const ramTotalBytes = totalKiB * 1024;
        const ramUsedBytes = usedKiB * 1024;
        const ramAvailableBytes = availableKiB * 1024;
        const ramFreeBytes = freeKiB * 1024;
        const ramCachedBytes = effectiveCachedKiB * 1024;
        const ramBuffersBytes = buffersKiB * 1024;
        const ramReclaimableBytes = sReclaimableKiB * 1024;

        const swapTotalBytes = swapTotalKiB * 1024;
        const swapUsedBytes = swapUsedKiB * 1024;
        const swapFreeBytes = swapFreeKiB * 1024;

        this.ramHistory.push(ramPercent);
        this.swapHistory.push(swapPercent);

        return {
            status: SensorStatus.AVAILABLE,
            ramTotalBytes,
            ramUsedBytes,
            ramAvailableBytes,
            ramFreeBytes,
            ramCachedBytes,
            ramBuffersBytes,
            ramReclaimableBytes,
            ramPercent,
            ramSummaryText: `${formatBytes(ramUsedBytes, 1)} / ${formatBytes(ramTotalBytes, 1)}`,
            swapTotalBytes,
            swapUsedBytes,
            swapFreeBytes,
            swapPercent,
            swapSummaryText: swapTotalBytes > 0
                ? `${formatBytes(swapUsedBytes, 1)} / ${formatBytes(swapTotalBytes, 1)}`
                : 'No Swap configured',
            ramHistory: this.ramHistory.getValues(),
            swapHistory: this.swapHistory.getValues(),
        };
    }

    destroy() {
        this.ramHistory.clear();
        this.swapHistory.clear();
    }
}
