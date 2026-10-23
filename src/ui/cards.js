/**
 * System Monitor — Premium
 * Dashboard Monitoring Cards
 *
 * Implements the 7 hardware monitoring cards + inline Settings card matching the
 * Premium Dark reference layout:
 * 1. System Information Card (2-column layout + Arch/Linux distro emblem)
 * 2. CPU Card (headline %, GHz, dual-line rolling graph, Total/User/System/Idle/Temp breakdown, per-core bars)
 * 3. GPU Card (GPU model subtitle, headline %, GHz, utilization graph, Utilization/Temp/VRAM/Power/Fan rows)
 * 4. Memory & Swap Card (RAM & Swap animated circular gauges, Cached/Buffers/Available breakdown, combined bar, live graph)
 * 5. Disk & Partitions Card (Root circular gauge, Used/Free legend, Partition table with device/mount/size/used/free/use% bars)
 * 6. Battery Card (Charge circular gauge, status & remaining time, Model/Design/Full/Health/Temp breakdown, 100%-0% charge history graph)
 * 7. Fan Card (CPU & GPU rotational FanRotorCanvas widgets, RPM & progress bars, dual CPU/GPU thermal history graph)
 */

import St from 'gi://St';
import Clutter from 'gi://Clutter';

import {
    createAssetIcon,
    createCardContainer,
    createKeyValueRow,
    createProgressBar,
} from './components.js';
import {
    MultiLineGraph,
    CircularGauge,
    FanRotorCanvas,
} from '../graphs.js';
import {
    formatBytes,
    formatTemperature,
    SensorStatus,
} from '../telemetry.js';

/**
 * 1. System Information Card
 */
export class SystemInfoCard {
    constructor(extensionPath) {
        this._extensionPath = extensionPath;
        const { card, badgeLabel } = createCardContainer(extensionPath, {
            iconFile: 'sysinfo-symbolic.svg',
            title: 'System Information',
            accessibleName: 'System Information Panel',
            fullWidth: true,
        });
        this.actor = card;
        this._badgeLabel = badgeLabel;

        const bodyRow = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            style_class: 'sm-sysinfo-body',
        });

        const leftCol = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'sm-sysinfo-col',
        });

        const rightCol = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'sm-sysinfo-col sm-sysinfo-col-right',
        });

        this._osRow = createKeyValueRow('Operating System', 'Reading Sensor');
        this._hostRow = createKeyValueRow('Host', 'Reading Sensor');
        this._modelRow = createKeyValueRow('Device Model', 'Reading Sensor');
        this._cpuModelRow = createKeyValueRow('CPU', 'Reading Sensor');
        this._kernelRow = createKeyValueRow('Kernel', 'Reading Sensor');
        this._uptimeRow = createKeyValueRow('Uptime', 'Reading Sensor');
        this._pkgRow = createKeyValueRow('Packages', 'Reading Sensor');

        leftCol.add_child(this._osRow.row);
        leftCol.add_child(this._hostRow.row);
        leftCol.add_child(this._modelRow.row);
        leftCol.add_child(this._cpuModelRow.row);
        leftCol.add_child(this._kernelRow.row);
        leftCol.add_child(this._uptimeRow.row);
        leftCol.add_child(this._pkgRow.row);

        this._deRow = createKeyValueRow('Desktop Environment', 'Reading Sensor');
        this._shellRow = createKeyValueRow('Shell', 'Reading Sensor');
        this._sessionRow = createKeyValueRow('Session Type', 'Reading Sensor');
        this._termRow = createKeyValueRow('Terminal', 'Reading Sensor');
        this._loginShellRow = createKeyValueRow('Login Shell', 'Reading Sensor');
        this._gpuModelRow = createKeyValueRow('Graphics', 'Reading Sensor');

        rightCol.add_child(this._deRow.row);
        rightCol.add_child(this._shellRow.row);
        rightCol.add_child(this._sessionRow.row);
        rightCol.add_child(this._termRow.row);
        rightCol.add_child(this._loginShellRow.row);
        rightCol.add_child(this._gpuModelRow.row);

        this._distroLogoBin = new St.Bin({
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.END,
            style_class: 'sm-distro-logo-bin',
            child: createAssetIcon(extensionPath, 'arch-logo.svg', 42, 'sm-distro-logo'),
        });
        rightCol.add_child(this._distroLogoBin);

        bodyRow.add_child(leftCol);
        bodyRow.add_child(rightCol);
        this.actor.add_child(bodyRow);
    }

    update(sysData, gpuData) {
        if (!sysData)
            return;

        this._osRow.valLabel.text = `${sysData.distroName} (${sysData.archSummary})`;
        this._hostRow.valLabel.text = sysData.hostname || 'Unknown';
        this._modelRow.valLabel.text = sysData.deviceModel || 'Not available';
        this._cpuModelRow.valLabel.text = sysData.cpuModel || 'Unknown';
        this._kernelRow.valLabel.text = sysData.kernelVersion || 'Unknown';
        this._uptimeRow.valLabel.text = sysData.uptimeFormatted || 'Not available';
        this._pkgRow.valLabel.text = sysData.packages || 'Not available';

        this._deRow.valLabel.text = sysData.desktopEnvironment || 'GNOME';
        this._shellRow.valLabel.text = sysData.shellVersion || 'GNOME Shell 51';
        this._sessionRow.valLabel.text = sysData.sessionType || 'Unknown';
        this._termRow.valLabel.text = sysData.terminal || 'Not available';
        this._loginShellRow.valLabel.text = sysData.loginShell || 'Unknown';

        if (gpuData && gpuData.gpus && gpuData.gpus.length > 0) {
            this._gpuModelRow.valLabel.text = gpuData.gpus.map(g => g.name).join(' / ');
        } else {
            this._gpuModelRow.valLabel.text = 'Not available';
        }
    }

    destroy() {
        if (this.actor) {
            this.actor.destroy();
            this.actor = null;
        }
    }
}

/**
 * 2. CPU Monitoring Card
 */
export class CpuCard {
    constructor(extensionPath) {
        this._extensionPath = extensionPath;
        const { card, subtitleLabel, badgeLabel } = createCardContainer(extensionPath, {
            iconFile: 'cpu-symbolic.svg',
            title: 'CPU',
            accessibleName: 'CPU Monitoring Card',
        });
        this.actor = card;
        this._subtitleLabel = subtitleLabel;
        this._badgeLabel = badgeLabel;

        const topSection = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            style_class: 'sm-card-split',
        });

        // Left: Headline % + GHz + rolling dual-series graph
        const leftBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'sm-card-left-pane',
        });

        const headlineBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            y_align: Clutter.ActorAlign.END,
            style_class: 'sm-headline-row',
        });

        this._usageBigLabel = new St.Label({
            text: '--%',
            style_class: 'sm-metric-big',
        });
        this._freqSubLabel = new St.Label({
            text: 'N/A',
            style_class: 'sm-metric-sub',
            y_align: Clutter.ActorAlign.END,
        });

        headlineBox.add_child(this._usageBigLabel);
        headlineBox.add_child(this._freqSubLabel);
        leftBox.add_child(headlineBox);

        this._graph = new MultiLineGraph({
            width: 210,
            height: 76,
            minValue: 0,
            maxValue: 100,
        });
        leftBox.add_child(this._graph);

        // Right: Total Usage, User, System, Idle, Temperature
        const rightBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'sm-card-right-pane',
        });

        this._totalRow = createKeyValueRow('Total Usage', '--%', 'sm-kv-value sm-text-cyan');
        this._userRow = createKeyValueRow('User', '--%', 'sm-kv-value sm-text-violet');
        this._sysRow = createKeyValueRow('System', '--%', 'sm-kv-value sm-text-blue');
        this._idleRow = createKeyValueRow('Idle', '--%', 'sm-kv-value sm-text-muted');
        this._tempRow = createKeyValueRow('Temperature', 'N/A', 'sm-kv-value');

        rightBox.add_child(this._totalRow.row);
        rightBox.add_child(this._userRow.row);
        rightBox.add_child(this._sysRow.row);
        rightBox.add_child(this._idleRow.row);
        rightBox.add_child(this._tempRow.row);

        topSection.add_child(leftBox);
        topSection.add_child(rightBox);
        this.actor.add_child(topSection);

        // Per-core mini grid (displays up to 8 cores cleanly)
        this._coreGrid = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            style_class: 'sm-core-strip',
        });
        this._coreWidgets = [];
        this.actor.add_child(this._coreGrid);
    }

    update(cpuData, tempUnit = 'celsius') {
        if (!cpuData || cpuData.status !== SensorStatus.AVAILABLE || cpuData.totalUsage === null) {
            this._usageBigLabel.text = 'N/A';
            this._freqSubLabel.text = 'N/A';
            this._graph.setSeries([], cpuData ? cpuData.status : SensorStatus.NOT_AVAILABLE);
            return;
        }

        const totalPct = Math.round(cpuData.totalUsage);
        this._usageBigLabel.text = `${totalPct}%`;
        this._freqSubLabel.text = cpuData.avgFrequencyFormatted || 'N/A';

        this._totalRow.valLabel.text = `${totalPct}%`;
        this._userRow.valLabel.text = `${Math.round(cpuData.userUsage ?? 0)}%`;
        this._sysRow.valLabel.text = `${Math.round(cpuData.systemUsage ?? 0)}%`;
        this._idleRow.valLabel.text = `${Math.round(cpuData.idlePercent ?? 100)}%`;
        this._tempRow.valLabel.text = cpuData.temperatureCelsius !== null
            ? formatTemperature(cpuData.temperatureCelsius, tempUnit)
            : 'N/A';

        this._graph.setSeries([
            { values: cpuData.totalHistory, color: '#38bdf8', fill: true, lineWidth: 2.0 },
            { values: cpuData.userHistory, color: '#a855f7', fill: false, lineWidth: 1.5 },
        ]);

        // Update per-core widgets (display up to 4-8 cores in compact columns)
        const displayCores = (cpuData.cores || []).slice(0, 4);
        if (this._coreWidgets.length !== displayCores.length) {
            this._coreGrid.destroy_all_children();
            this._coreWidgets = [];
            for (const c of displayCores) {
                const col = new St.BoxLayout({
                    orientation: Clutter.Orientation.VERTICAL,
                    x_expand: true,
                    style_class: 'sm-core-item',
                });
                const title = new St.Label({
                    text: c.label,
                    style_class: 'sm-core-label',
                });
                const bar = createProgressBar('sm-progress-fill-cyan');
                const meta = new St.Label({
                    text: '0%  N/A',
                    style_class: 'sm-core-meta',
                });
                col.add_child(title);
                col.add_child(bar.track);
                col.add_child(meta);
                this._coreGrid.add_child(col);
                this._coreWidgets.push({ title, bar, meta });
            }
        }

        for (let i = 0; i < displayCores.length; i++) {
            const c = displayCores[i];
            const w = this._coreWidgets[i];
            const pct = Math.round(c.usage ?? 0);
            w.title.text = c.label;
            w.bar.setPercent(pct, 68);
            w.meta.text = `${pct}%  ${c.frequencyFormatted}`;
        }
    }

    destroy() {
        if (this._graph) {
            this._graph.destroy();
            this._graph = null;
        }
        this._coreWidgets = [];
        if (this.actor) {
            this.actor.destroy();
            this.actor = null;
        }
    }
}

/**
 * 3. GPU Monitoring Card
 */
export class GpuCard {
    constructor(extensionPath) {
        this._extensionPath = extensionPath;
        const { card, subtitleLabel, badgeLabel } = createCardContainer(extensionPath, {
            iconFile: 'gpu-symbolic.svg',
            title: 'GPU',
            subtitle: 'Detecting Graphics Adapter...',
            accessibleName: 'GPU Monitoring Card',
        });
        this.actor = card;
        this._subtitleLabel = subtitleLabel;
        this._badgeLabel = badgeLabel;

        const topSection = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            style_class: 'sm-card-split',
        });

        const leftBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'sm-card-left-pane',
        });

        const headlineBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            y_align: Clutter.ActorAlign.END,
            style_class: 'sm-headline-row',
        });

        this._utilBigLabel = new St.Label({
            text: 'N/A',
            style_class: 'sm-metric-big',
        });
        this._clockSubLabel = new St.Label({
            text: 'N/A',
            style_class: 'sm-metric-sub',
            y_align: Clutter.ActorAlign.END,
        });

        headlineBox.add_child(this._utilBigLabel);
        headlineBox.add_child(this._clockSubLabel);
        leftBox.add_child(headlineBox);

        this._graph = new MultiLineGraph({
            width: 210,
            height: 92,
            minValue: 0,
            maxValue: 100,
        });
        leftBox.add_child(this._graph);

        const rightBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'sm-card-right-pane',
        });

        this._utilRow = createKeyValueRow('Utilization', 'N/A');
        this._tempRow = createKeyValueRow('Temperature', 'N/A');
        this._vramRow = createKeyValueRow('Memory', 'N/A');
        this._powerRow = createKeyValueRow('Power', 'N/A');
        this._fanRow = createKeyValueRow('Fan Speed', 'N/A');

        rightBox.add_child(this._utilRow.row);
        rightBox.add_child(this._tempRow.row);
        rightBox.add_child(this._vramRow.row);
        rightBox.add_child(this._powerRow.row);
        rightBox.add_child(this._fanRow.row);

        topSection.add_child(leftBox);
        topSection.add_child(rightBox);
        this.actor.add_child(topSection);
    }

    update(gpuData, tempUnit = 'celsius') {
        if (!gpuData || !gpuData.primaryGpu) {
            this._subtitleLabel.text = 'No GPU Detected';
            this._subtitleLabel.visible = true;
            this._utilBigLabel.text = 'N/A';
            this._clockSubLabel.text = 'Not Available';
            this._utilRow.valLabel.text = 'Not Available';
            this._tempRow.valLabel.text = 'Not Available';
            this._vramRow.valLabel.text = 'Not Available';
            this._powerRow.valLabel.text = 'Not Available';
            this._fanRow.valLabel.text = 'Not Available';
            this._graph.setSeries([], 'No GPU Telemetry Exposed');
            return;
        }

        const gpu = gpuData.primaryGpu;
        this._subtitleLabel.text = `${gpu.name} (${gpu.driver})`;
        this._subtitleLabel.visible = true;

        if (gpu.utilization !== null) {
            const pct = Math.round(gpu.utilization);
            this._utilBigLabel.text = `${pct}%`;
            this._utilRow.valLabel.text = `${pct}%`;
            this._graph.setSeries([
                { values: gpu.utilHistory, color: '#10b981', fill: true, lineWidth: 2.0 },
            ]);
        } else {
            this._utilBigLabel.text = 'N/A';
            this._utilRow.valLabel.text = 'Unsupported by Driver';
            this._graph.setSeries([], gpu.telemetryState);
        }

        this._clockSubLabel.text = gpu.coreClockFormatted || 'N/A';
        this._tempRow.valLabel.text = gpu.temperatureCelsius !== null
            ? formatTemperature(gpu.temperatureCelsius, tempUnit)
            : 'N/A';

        if (gpu.vramTotalBytes !== null && gpu.vramUsedBytes !== null) {
            this._vramRow.valLabel.text = `${formatBytes(gpu.vramUsedBytes, 1)} / ${formatBytes(gpu.vramTotalBytes, 1)}`;
        } else {
            this._vramRow.valLabel.text = 'N/A';
        }

        this._powerRow.valLabel.text = gpu.powerWatts !== null
            ? `${Math.round(gpu.powerWatts)} W`
            : 'N/A';

        if (gpu.fanRpm !== null) {
            this._fanRow.valLabel.text = `${gpu.fanRpm} RPM`;
        } else if (gpu.fanPercent !== null) {
            this._fanRow.valLabel.text = `${Math.round(gpu.fanPercent)}%`;
        } else {
            this._fanRow.valLabel.text = 'N/A';
        }
    }

    destroy() {
        if (this._graph) {
            this._graph.destroy();
            this._graph = null;
        }
        if (this.actor) {
            this.actor.destroy();
            this.actor = null;
        }
    }
}

/**
 * 4. Memory & Swap Card
 */
export class MemorySwapCard {
    constructor(extensionPath) {
        this._extensionPath = extensionPath;
        const { card } = createCardContainer(extensionPath, {
            iconFile: 'memory-symbolic.svg',
            title: 'Memory & Swap',
            accessibleName: 'Memory and Swap Card',
        });
        this.actor = card;

        const topRow = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'sm-card-split',
        });

        const gaugesBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'sm-gauges-pair',
        });

        this._ramGauge = new CircularGauge({
            size: 92,
            strokeWidth: 8,
            color: '#0ea5e9',
            topLabel: 'RAM',
            subLabel: '-- / --',
        });

        this._swapGauge = new CircularGauge({
            size: 92,
            strokeWidth: 8,
            color: '#8b5cf6',
            topLabel: 'Swap',
            subLabel: '-- / --',
        });

        gaugesBox.add_child(this._ramGauge);
        gaugesBox.add_child(this._swapGauge);

        const detailsBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'sm-card-right-pane',
        });

        this._cachedRow = createKeyValueRow('Cached', 'N/A', 'sm-kv-value sm-text-cyan');
        this._buffersRow = createKeyValueRow('Buffers', 'N/A', 'sm-kv-value sm-text-blue');
        this._availRow = createKeyValueRow('Available', 'N/A', 'sm-kv-value sm-text-violet');
        this._freeRow = createKeyValueRow('Free Swap', 'N/A', 'sm-kv-value sm-text-muted');

        detailsBox.add_child(this._cachedRow.row);
        detailsBox.add_child(this._buffersRow.row);
        detailsBox.add_child(this._availRow.row);
        detailsBox.add_child(this._freeRow.row);

        topRow.add_child(gaugesBox);
        topRow.add_child(detailsBox);
        this.actor.add_child(topRow);

        // Full-width memory usage progress bar + live mini history graph
        this._memBar = createProgressBar('sm-progress-fill-cyan');
        this._memBar.track.add_style_class_name('sm-mem-bar-wide');
        this.actor.add_child(this._memBar.track);

        this._graph = new MultiLineGraph({
            width: 340,
            height: 46,
            minValue: 0,
            maxValue: 100,
        });
        this.actor.add_child(this._graph);

        const legendRow = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'sm-legend-row',
        });
        legendRow.add_child(new St.Label({ text: '● RAM', style_class: 'sm-legend-item sm-text-cyan' }));
        legendRow.add_child(new St.Label({ text: '● Swap', style_class: 'sm-legend-item sm-text-violet' }));
        legendRow.add_child(new St.Label({ text: '● Cached (Reclaimable)', style_class: 'sm-legend-item sm-text-muted' }));
        this.actor.add_child(legendRow);
    }

    update(memData, animate = true) {
        if (!memData || memData.status !== SensorStatus.AVAILABLE)
            return;

        const ramPct = Math.round(memData.ramPercent ?? 0);
        const swapPct = Math.round(memData.swapPercent ?? 0);

        const ramSub = `${(memData.ramUsedBytes / (1024 ** 3)).toFixed(1)} / ${(memData.ramTotalBytes / (1024 ** 3)).toFixed(1)} GiB`;
        const swapSub = memData.swapTotalBytes > 0
            ? `${(memData.swapUsedBytes / (1024 ** 3)).toFixed(1)} / ${(memData.swapTotalBytes / (1024 ** 3)).toFixed(1)} GiB`
            : '0 / 0 GiB';

        this._ramGauge.setValue(ramPct, `${ramPct}%`, ramSub, animate);
        this._swapGauge.setValue(swapPct, `${swapPct}%`, swapSub, animate);

        this._cachedRow.valLabel.text = formatBytes(memData.ramCachedBytes, 1);
        this._buffersRow.valLabel.text = formatBytes(memData.ramBuffersBytes, 1);
        this._availRow.valLabel.text = formatBytes(memData.ramAvailableBytes, 1);
        this._freeRow.valLabel.text = formatBytes(memData.swapFreeBytes, 1);

        this._memBar.setPercent(ramPct, 340);

        this._graph.setSeries([
            { values: memData.ramHistory, color: '#0ea5e9', fill: true, lineWidth: 1.8 },
            { values: memData.swapHistory, color: '#8b5cf6', fill: false, lineWidth: 1.4 },
        ]);
    }

    destroy() {
        if (this._ramGauge) {
            this._ramGauge.destroy();
            this._ramGauge = null;
        }
        if (this._swapGauge) {
            this._swapGauge.destroy();
            this._swapGauge = null;
        }
        if (this._graph) {
            this._graph.destroy();
            this._graph = null;
        }
        if (this.actor) {
            this.actor.destroy();
            this.actor = null;
        }
    }
}

/**
 * 5. Disk & Partitions Card
 */
export class StorageCard {
    constructor(extensionPath) {
        this._extensionPath = extensionPath;
        const { card } = createCardContainer(extensionPath, {
            iconFile: 'storage-symbolic.svg',
            title: 'Disk & Partitions',
            accessibleName: 'Disk and Partitions Card',
        });
        this.actor = card;

        const topRow = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'sm-card-split',
        });

        this._rootGauge = new CircularGauge({
            size: 86,
            strokeWidth: 8,
            color: '#0ea5e9',
        });
        topRow.add_child(this._rootGauge);

        const rootSummaryBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'sm-disk-summary-col',
        });

        this._rootCapLabel = new St.Label({
            text: '-- / --',
            style_class: 'sm-disk-cap-title',
        });
        this._rootMountLabel = new St.Label({
            text: '(Root /)',
            style_class: 'sm-disk-cap-sub',
        });
        rootSummaryBox.add_child(this._rootCapLabel);
        rootSummaryBox.add_child(this._rootMountLabel);
        topRow.add_child(rootSummaryBox);

        const rootLegendBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._usedRow = createKeyValueRow('● Used', '--', 'sm-kv-value sm-text-cyan');
        this._freeRow = createKeyValueRow('● Free', '--', 'sm-kv-value sm-text-muted');
        rootLegendBox.add_child(this._usedRow.row);
        rootLegendBox.add_child(this._freeRow.row);
        topRow.add_child(rootLegendBox);

        this.actor.add_child(topRow);

        // Partition table header
        const headerRow = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            style_class: 'sm-table-header',
        });
        headerRow.add_child(new St.Label({ text: 'Partition / Mount', style_class: 'sm-th-device', x_expand: true }));
        headerRow.add_child(new St.Label({ text: 'Size', style_class: 'sm-th-num' }));
        headerRow.add_child(new St.Label({ text: 'Used', style_class: 'sm-th-num' }));
        headerRow.add_child(new St.Label({ text: 'Free', style_class: 'sm-th-num' }));
        headerRow.add_child(new St.Label({ text: 'Use%', style_class: 'sm-th-bar' }));
        this.actor.add_child(headerRow);

        this._rowsContainer = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'sm-table-body',
        });
        this.actor.add_child(this._rowsContainer);
    }

    update(storageData, animate = true) {
        if (!storageData || !storageData.primaryMount) {
            this._rootGauge.setValue(0, 'N/A', null, false);
            this._rootCapLabel.text = 'No Mounts Available';
            return;
        }

        const primary = storageData.primaryMount;
        const pct = Math.round(primary.usedPercent ?? 0);
        this._rootGauge.setValue(pct, `${pct}%`, null, animate);
        this._rootCapLabel.text = `${primary.usedFormatted} / ${primary.totalFormatted}`;
        this._rootMountLabel.text = `(${primary.mountPoint} • ${primary.fsType})`;
        this._usedRow.valLabel.text = primary.usedFormatted;
        this._freeRow.valLabel.text = primary.freeFormatted;

        this._rowsContainer.destroy_all_children();
        const mounts = (storageData.partitions || []).slice(0, 5);
        for (const m of mounts) {
            const row = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'sm-table-row',
            });

            const devText = m.device.length > 16
                ? `${m.device.slice(0, 14)}… (${m.mountPoint})`
                : `${m.device} (${m.mountPoint})`;

            row.add_child(new St.Label({ text: devText, style_class: 'sm-td-device', x_expand: true }));
            row.add_child(new St.Label({ text: m.totalFormatted, style_class: 'sm-td-num' }));
            row.add_child(new St.Label({ text: m.usedFormatted, style_class: 'sm-td-num' }));
            row.add_child(new St.Label({ text: m.freeFormatted, style_class: 'sm-td-num' }));

            const useBox = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'sm-td-bar',
            });
            const bar = createProgressBar('sm-progress-fill-cyan');
            const mPct = Math.round(m.usedPercent ?? 0);
            bar.setPercent(mPct, 48);
            useBox.add_child(bar.track);
            useBox.add_child(new St.Label({ text: `${mPct}%`, style_class: 'sm-td-pct' }));

            row.add_child(useBox);
            this._rowsContainer.add_child(row);
        }
    }

    destroy() {
        if (this._rootGauge) {
            this._rootGauge.destroy();
            this._rootGauge = null;
        }
        if (this.actor) {
            this.actor.destroy();
            this.actor = null;
        }
    }
}

/**
 * 6. Battery Monitoring Card
 */
export class BatteryCard {
    constructor(extensionPath) {
        this._extensionPath = extensionPath;
        const { card } = createCardContainer(extensionPath, {
            iconFile: 'battery-symbolic.svg',
            title: 'Battery',
            accessibleName: 'Battery Monitoring Card',
        });
        this.actor = card;

        const topRow = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'sm-card-split',
        });

        this._batGauge = new CircularGauge({
            size: 86,
            strokeWidth: 8,
            color: '#10b981',
        });
        topRow.add_child(this._batGauge);

        const stateBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'sm-bat-state-col',
        });
        this._statusLabel = new St.Label({
            text: 'Checking Battery...',
            style_class: 'sm-bat-status-title',
        });
        this._remainingLabel = new St.Label({
            text: 'Estimating unavailable',
            style_class: 'sm-bat-status-sub',
        });
        stateBox.add_child(this._statusLabel);
        stateBox.add_child(this._remainingLabel);
        topRow.add_child(stateBox);

        const metaBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'sm-card-right-pane',
        });
        this._modelRow = createKeyValueRow('Model', 'N/A');
        this._designRow = createKeyValueRow('Design Capacity', 'N/A');
        this._fullRow = createKeyValueRow('Full Charge Capacity', 'N/A');
        this._healthRow = createKeyValueRow('Battery Health', 'N/A');
        this._tempRow = createKeyValueRow('Temperature', 'N/A');

        metaBox.add_child(this._modelRow.row);
        metaBox.add_child(this._designRow.row);
        metaBox.add_child(this._fullRow.row);
        metaBox.add_child(this._healthRow.row);
        metaBox.add_child(this._tempRow.row);
        topRow.add_child(metaBox);

        this.actor.add_child(topRow);

        this._graph = new MultiLineGraph({
            width: 340,
            height: 70,
            minValue: 0,
            maxValue: 100,
            yLabels: ['100%', '50%', '0%'],
            xLabels: ['History', 'Recent', 'Now'],
        });
        this.actor.add_child(this._graph);
    }

    update(batData, tempUnit = 'celsius', animate = true) {
        if (!batData || !batData.present) {
            this._batGauge.setValue(0, 'N/A', null, false);
            this._statusLabel.text = batData ? batData.chargingState : 'Not Available';
            this._remainingLabel.text = batData ? batData.model : 'No Battery Detected';
            this._modelRow.valLabel.text = 'Not Available';
            this._designRow.valLabel.text = 'N/A';
            this._fullRow.valLabel.text = 'N/A';
            this._healthRow.valLabel.text = 'N/A';
            this._tempRow.valLabel.text = 'N/A';
            this._graph.setSeries([], 'No Battery Present');
            return;
        }

        const pct = Math.round(batData.chargePercent ?? 0);
        this._batGauge.setValue(pct, `${pct}%`, null, animate);

        const iconPrefix = batData.chargingState.toLowerCase() === 'charging' ? '⚡ ' : '';
        this._statusLabel.text = `${iconPrefix}${batData.chargingState}`;
        this._remainingLabel.text = batData.timeRemainingLabel || 'Estimating unavailable';

        this._modelRow.valLabel.text = batData.model || 'Unknown';
        this._designRow.valLabel.text = batData.designWh !== null
            ? `${batData.designWh.toFixed(1)} Wh`
            : 'N/A';
        this._fullRow.valLabel.text = batData.fullWh !== null
            ? `${batData.fullWh.toFixed(1)} Wh`
            : 'N/A';
        this._healthRow.valLabel.text = batData.healthPercent !== null
            ? `${Math.round(batData.healthPercent)}%`
            : 'N/A';
        this._tempRow.valLabel.text = batData.temperatureCelsius !== null
            ? formatTemperature(batData.temperatureCelsius, tempUnit)
            : 'N/A';

        this._graph.setSeries([
            { values: batData.chargeHistory, color: '#10b981', fill: true, lineWidth: 2.0 },
        ]);
    }

    destroy() {
        if (this._batGauge) {
            this._batGauge.destroy();
            this._batGauge = null;
        }
        if (this._graph) {
            this._graph.destroy();
            this._graph = null;
        }
        if (this.actor) {
            this.actor.destroy();
            this.actor = null;
        }
    }
}

/**
 * 7. Fan & Thermal Monitoring Card
 */
export class FanCard {
    constructor(extensionPath) {
        this._extensionPath = extensionPath;
        const { card } = createCardContainer(extensionPath, {
            iconFile: 'fan-symbolic.svg',
            title: 'Fan',
            accessibleName: 'Fan and Thermal Monitoring Card',
        });
        this.actor = card;

        const bodyRow = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            style_class: 'sm-card-split',
        });

        // Left: CPU Fan & GPU Fan rotors + RPM + speed bar
        const fansCol = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'sm-fans-col',
        });

        this._cpuFanWidget = this._createFanRow('CPU Fan', '#38bdf8');
        this._gpuFanWidget = this._createFanRow('GPU Fan', '#94a3b8');

        fansCol.add_child(this._cpuFanWidget.row);
        fansCol.add_child(this._gpuFanWidget.row);

        // Right: Dual thermal history graph (CPU Temp & GPU Temp)
        const graphCol = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'sm-fan-graph-col',
        });

        const legendRow = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'sm-legend-row',
        });
        legendRow.add_child(new St.Label({ text: '● CPU Temp', style_class: 'sm-legend-item sm-text-cyan' }));
        legendRow.add_child(new St.Label({ text: '● GPU Temp', style_class: 'sm-legend-item sm-text-violet' }));
        graphCol.add_child(legendRow);

        this._tempGraph = new MultiLineGraph({
            width: 190,
            height: 98,
            minValue: 20,
            maxValue: 95,
            yLabels: ['80°C', '50°C', '20°C'],
            xLabels: ['History', 'Now'],
        });
        graphCol.add_child(this._tempGraph);

        bodyRow.add_child(fansCol);
        bodyRow.add_child(graphCol);
        this.actor.add_child(bodyRow);
    }

    _createFanRow(defaultTitle, color) {
        const row = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'sm-fan-item-row',
        });

        const rotor = new FanRotorCanvas(52, color);
        row.add_child(rotor);

        const infoCol = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'sm-fan-info-col',
        });

        const titleLabel = new St.Label({
            text: defaultTitle,
            style_class: 'sm-fan-label',
        });
        const rpmLabel = new St.Label({
            text: 'Not Available',
            style_class: 'sm-fan-rpm',
        });
        const bar = createProgressBar('sm-progress-fill-cyan');

        infoCol.add_child(titleLabel);
        infoCol.add_child(rpmLabel);
        infoCol.add_child(bar.track);
        row.add_child(infoCol);

        return { row, rotor, titleLabel, rpmLabel, bar };
    }

    update(fanData, cpuData, gpuData, animEnabled = true, popupOpen = true) {
        const cpuFan = fanData ? fanData.cpuFan : null;
        const gpuFan = fanData ? fanData.gpuFan : null;

        this._updateSingleFanWidget(this._cpuFanWidget, 'CPU Fan', cpuFan, animEnabled, popupOpen);
        this._updateSingleFanWidget(this._gpuFanWidget, 'GPU Fan', gpuFan, animEnabled, popupOpen);

        const cpuTempHistory = cpuData ? cpuData.tempHistory : [];
        const gpuTempHistory = (gpuData && gpuData.primaryGpu) ? gpuData.primaryGpu.tempHistory : [];

        this._tempGraph.setSeries([
            { values: cpuTempHistory, color: '#38bdf8', fill: true, lineWidth: 1.8 },
            { values: gpuTempHistory, color: '#a855f7', fill: false, lineWidth: 1.8 },
        ]);
    }

    _updateSingleFanWidget(widget, fallbackName, fanEntry, animEnabled, popupOpen) {
        if (!fanEntry) {
            widget.titleLabel.text = fallbackName;
            widget.rpmLabel.text = 'Not Available';
            widget.bar.setPercent(0, 95);
            widget.rotor.setState(null, animEnabled, popupOpen);
            return;
        }

        widget.titleLabel.text = fanEntry.label || fallbackName;
        widget.rpmLabel.text = `${fanEntry.rpm} RPM`;
        widget.bar.setPercent(fanEntry.percentOfMax, 95);
        widget.rotor.setState(fanEntry.rpm, animEnabled, popupOpen);
    }

    setPopupOpen(isOpen, animEnabled = true) {
        if (this._cpuFanWidget && this._cpuFanWidget.rotor)
            this._cpuFanWidget.rotor.setState(this._cpuFanWidget.rotor._rpm, animEnabled, isOpen);
        if (this._gpuFanWidget && this._gpuFanWidget.rotor)
            this._gpuFanWidget.rotor.setState(this._gpuFanWidget.rotor._rpm, animEnabled, isOpen);
    }

    destroy() {
        if (this._cpuFanWidget && this._cpuFanWidget.rotor) {
            this._cpuFanWidget.rotor.destroy();
            this._cpuFanWidget.rotor = null;
        }
        if (this._gpuFanWidget && this._gpuFanWidget.rotor) {
            this._gpuFanWidget.rotor.destroy();
            this._gpuFanWidget.rotor = null;
        }
        if (this._tempGraph) {
            this._tempGraph.destroy();
            this._tempGraph = null;
        }
        if (this.actor) {
            this.actor.destroy();
            this.actor = null;
        }
    }
}
