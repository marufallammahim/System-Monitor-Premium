/**
 * System Monitor — Premium
 * Battery Telemetry Provider
 *
 * Reads /sys/class/power_supply/BAT* asynchronously.
 * Handles both energy_* (µWh) and charge_* (µAh + voltage_now µV) sysfs layouts.
 * Calculates remaining discharge time or time until full charge only when valid
 * current/power draw measurements exist; otherwise reports "Estimating unavailable".
 * Clearly separates state-of-charge (%) from battery health (full / design %).
 */

import {
    BoundedHistory,
    SensorStatus,
    listDirectoryAsync,
    readSysfsLineAsync,
    readSysfsIntAsync,
    formatDurationSeconds,
} from './telemetry.js';

export class BatteryProvider {
    constructor(historyLength = 60) {
        this.chargeHistory = new BoundedHistory(historyLength);
    }

    setHistoryLength(length) {
        this.chargeHistory.setMaxLength(length);
    }

    async collect(cancellable = null) {
        const psDir = await listDirectoryAsync('/sys/class/power_supply', cancellable);
        if (!psDir.ok || psDir.entries.length === 0) {
            this.chargeHistory.push(null);
            return this._createUnavailableState('No Battery Detected');
        }

        const batEntries = [];
        for (const entry of psDir.entries) {
            const basePath = `/sys/class/power_supply/${entry.name}`;
            const typeRes = await readSysfsLineAsync(`${basePath}/type`, cancellable);
            if (typeRes.ok && typeRes.value && typeRes.value.toLowerCase() === 'battery') {
                batEntries.push({ name: entry.name, basePath });
            } else if (entry.name.startsWith('BAT')) {
                batEntries.push({ name: entry.name, basePath });
            }
        }

        if (batEntries.length === 0) {
            this.chargeHistory.push(null);
            return this._createUnavailableState('No Battery Present (Desktop / AC System)');
        }

        const primaryBat = batEntries[0];
        const base = primaryBat.basePath;

        const [
            presentRes,
            statusRes,
            capacityRes,
            manufacturerRes,
            modelNameRes,
            energyNowRes,
            energyFullRes,
            energyDesignRes,
            powerNowRes,
            chargeNowRes,
            chargeFullRes,
            chargeDesignRes,
            currentNowRes,
            voltageNowRes,
            tempRes,
        ] = await Promise.all([
            readSysfsIntAsync(`${base}/present`, cancellable),
            readSysfsLineAsync(`${base}/status`, cancellable),
            readSysfsIntAsync(`${base}/capacity`, cancellable),
            readSysfsLineAsync(`${base}/manufacturer`, cancellable),
            readSysfsLineAsync(`${base}/model_name`, cancellable),
            readSysfsIntAsync(`${base}/energy_now`, cancellable),
            readSysfsIntAsync(`${base}/energy_full`, cancellable),
            readSysfsIntAsync(`${base}/energy_full_design`, cancellable),
            readSysfsIntAsync(`${base}/power_now`, cancellable),
            readSysfsIntAsync(`${base}/charge_now`, cancellable),
            readSysfsIntAsync(`${base}/charge_full`, cancellable),
            readSysfsIntAsync(`${base}/charge_full_design`, cancellable),
            readSysfsIntAsync(`${base}/current_now`, cancellable),
            readSysfsIntAsync(`${base}/voltage_now`, cancellable),
            readSysfsIntAsync(`${base}/temp`, cancellable),
        ]);

        if (presentRes.ok && presentRes.value === 0) {
            this.chargeHistory.push(null);
            return this._createUnavailableState('Battery Slot Empty');
        }

        const rawStatus = (statusRes.ok && statusRes.value) ? statusRes.value : 'Unknown';
        const voltageVolts = (voltageNowRes.ok && voltageNowRes.value > 0)
            ? voltageNowRes.value / 1_000_000.0
            : 11.4; // Nominal lithium-ion pack voltage fallback only when converting Ah->Wh

        // Convert energy (µWh) or charge (µAh) to Watt-hours (Wh)
        let currentWh = null;
        let fullWh = null;
        let designWh = null;
        let powerWatts = null;

        if (energyNowRes.ok && energyNowRes.value !== null) {
            currentWh = energyNowRes.value / 1_000_000.0;
            if (energyFullRes.ok && energyFullRes.value > 0)
                fullWh = energyFullRes.value / 1_000_000.0;
            if (energyDesignRes.ok && energyDesignRes.value > 0)
                designWh = energyDesignRes.value / 1_000_000.0;
        } else if (chargeNowRes.ok && chargeNowRes.value !== null) {
            currentWh = (chargeNowRes.value / 1_000_000.0) * voltageVolts;
            if (chargeFullRes.ok && chargeFullRes.value > 0)
                fullWh = (chargeFullRes.value / 1_000_000.0) * voltageVolts;
            if (chargeDesignRes.ok && chargeDesignRes.value > 0)
                designWh = (chargeDesignRes.value / 1_000_000.0) * voltageVolts;
        }

        if (powerNowRes.ok && powerNowRes.value > 0) {
            powerWatts = powerNowRes.value / 1_000_000.0;
        } else if (currentNowRes.ok && currentNowRes.value > 0 && voltageNowRes.ok && voltageNowRes.value > 0) {
            powerWatts = (currentNowRes.value / 1_000_000.0) * (voltageNowRes.value / 1_000_000.0);
        }

        let chargePercent = (capacityRes.ok && capacityRes.value !== null)
            ? Math.min(100, Math.max(0, capacityRes.value))
            : null;
        if (chargePercent === null && currentWh !== null && fullWh !== null && fullWh > 0)
            chargePercent = Math.min(100, Math.max(0, (currentWh / fullWh) * 100));

        // Battery Health (%) = Full Charge Capacity / Design Capacity
        const healthPercent = (fullWh !== null && designWh !== null && designWh > 0)
            ? Math.min(120, Math.max(0, (fullWh / designWh) * 100))
            : null;

        // Remaining time / time to full estimation
        let timeRemainingSeconds = null;
        let timeRemainingLabel = 'Estimating unavailable';
        const statusLower = rawStatus.toLowerCase();

        if (statusLower === 'full') {
            timeRemainingLabel = 'Fully charged';
        } else if (statusLower === 'discharging' && currentWh !== null && powerWatts !== null && powerWatts > 0.25) {
            timeRemainingSeconds = (currentWh / powerWatts) * 3600;
            timeRemainingLabel = `${formatDurationSeconds(timeRemainingSeconds, true)} remaining`;
        } else if (statusLower === 'charging' && currentWh !== null && fullWh !== null && powerWatts !== null && powerWatts > 0.25) {
            const neededWh = Math.max(0, fullWh - currentWh);
            timeRemainingSeconds = (neededWh / powerWatts) * 3600;
            timeRemainingLabel = `${formatDurationSeconds(timeRemainingSeconds, true)} until full`;
        }

        // Battery temperature in /sys/class/power_supply/BAT*/temp is typically in tenths of °C
        let temperatureCelsius = null;
        if (tempRes.ok && tempRes.value !== null && tempRes.value > 0) {
            temperatureCelsius = tempRes.value > 1000
                ? tempRes.value / 1000.0
                : tempRes.value / 10.0;
        }

        const vendor = (manufacturerRes.ok && manufacturerRes.value) ? manufacturerRes.value : '';
        const model = (modelNameRes.ok && modelNameRes.value) ? modelNameRes.value : '';
        const modelDisplay = [vendor, model].filter(Boolean).join(' ') || primaryBat.name;

        this.chargeHistory.push(chargePercent);

        return {
            status: SensorStatus.AVAILABLE,
            present: true,
            id: primaryBat.name,
            model: modelDisplay,
            chargingState: rawStatus,
            chargePercent,
            currentWh,
            fullWh,
            designWh,
            powerWatts,
            healthPercent,
            temperatureCelsius,
            timeRemainingSeconds,
            timeRemainingLabel,
            chargeHistory: this.chargeHistory.getValues(),
        };
    }

    _createUnavailableState(reason) {
        return {
            status: SensorStatus.NOT_AVAILABLE,
            present: false,
            id: null,
            model: reason,
            chargingState: 'Not Available',
            chargePercent: null,
            currentWh: null,
            fullWh: null,
            designWh: null,
            powerWatts: null,
            healthPercent: null,
            temperatureCelsius: null,
            timeRemainingSeconds: null,
            timeRemainingLabel: 'Estimating unavailable',
            chargeHistory: this.chargeHistory.getValues(),
        };
    }

    destroy() {
        this.chargeHistory.clear();
    }
}
