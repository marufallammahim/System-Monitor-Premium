/**
 * System Monitor — Premium (system-monitor@marufallammahim.github.io)
 * Main GNOME Shell 51 Extension Entry Point & Lifecycle Manager
 *
 * Implements:
 * - Top-bar PanelMenu.Button indicator with live CPU %, average GHz, and Cairo sparkline
 * - Lazy initialization of the DashboardView popup on first open
 * - Monitor boundary clamping and resolution change handling
 * - Fast & slow asynchronous telemetry refresh loops (pauses heavy dashboard updates when closed)
 * - Strict enable() / disable() resource, signal, cancellable, and actor cleanup
 *   (compliant with EGO-X-004, EGO-L-002, EGO-L-003, EGO-L-005).
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { SystemInfoProvider } from './src/system-info.js';
import { CpuProvider } from './src/cpu.js';
import { GpuProvider } from './src/gpu.js';
import { MemoryProvider } from './src/memory.js';
import { StorageProvider } from './src/storage.js';
import { BatteryProvider } from './src/battery.js';
import { FanProvider } from './src/fans.js';
import { TopBarSparkline } from './src/graphs.js';
import { createAssetIcon } from './src/ui/components.js';
import { DashboardView } from './src/ui/dashboard.js';

const SystemMonitorIndicator = GObject.registerClass(
class SystemMonitorIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.5, 'System Monitor — Premium', false);

        this._extension = extension;
        this._extensionPath = extension.path;
        this._settings = extension.getSettings();
        this._cancellable = new Gio.Cancellable();

        this._signalRecords = [];
        this._fastTimerId = 0;
        this._slowTimerId = 0;
        this._initialIdleId = 0;
        this._isRefreshingFast = false;
        this._isRefreshingSlow = false;

        this._dashboardView = null;
        this._customMenuSection = null;

        const historyLen = this._settings.get_int('graph-history-length') || 60;
        this._sysInfoProvider = new SystemInfoProvider();
        this._cpuProvider = new CpuProvider(historyLen);
        this._gpuProvider = new GpuProvider(historyLen);
        this._memoryProvider = new MemoryProvider(historyLen);
        this._storageProvider = new StorageProvider();
        this._batteryProvider = new BatteryProvider(historyLen);
        this._fanProvider = new FanProvider(historyLen);

        this._latestSnapshot = {
            refreshSucceeded: false,
            sysInfo: null,
            cpu: null,
            gpu: null,
            memory: null,
            storage: null,
            battery: null,
            fan: null,
        };

        this._buildTopBarWidget();
        this._setupPopupBehavior();
        this._connectSettingsAndDisplaySignals();
        this._startTimers();
    }

    _connectSignal(obj, signalName, handler) {
        const id = obj.connect(signalName, handler);
        this._signalRecords.push({ obj, id });
        return id;
    }

    _buildTopBarWidget() {
        this.add_style_class_name('sm-panel-button');
        this.accessible_name = 'System Monitor Premium Top Bar Indicator';

        this._topBarBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'sm-topbar-pill',
        });

        this._topBarIcon = createAssetIcon(
            this._extensionPath,
            'monitor-symbolic.svg',
            16,
            'sm-topbar-icon'
        );
        this._topBarBox.add_child(this._topBarIcon);

        this._topBarCpuLabel = new St.Label({
            text: 'CPU --%',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'sm-topbar-cpu-label',
        });
        this._topBarBox.add_child(this._topBarCpuLabel);

        this._topBarFreqLabel = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'sm-topbar-freq-label',
            visible: this._settings.get_boolean('show-topbar-frequency'),
        });
        this._topBarBox.add_child(this._topBarFreqLabel);

        this._topBarSparkline = new TopBarSparkline(42, 16);
        this._topBarSparkline.visible = this._settings.get_boolean('show-topbar-sparkline');
        this._topBarBox.add_child(this._topBarSparkline);

        this._chevronIcon = new St.Icon({
            icon_name: 'pan-down-symbolic',
            style_class: 'system-status-icon sm-topbar-chevron',
        });
        this._topBarBox.add_child(this._chevronIcon);

        this.add_child(this._topBarBox);
    }

    _setupPopupBehavior() {
        this.menu.box.add_style_class_name('sm-popup-menu-box');

        // Lazy initialization of the full dashboard when the popup opens for the first time
        this._connectSignal(this.menu, 'open-state-changed', (_menu, isOpen) => {
            if (isOpen) {
                this._ensureDashboardInitialized();
                this._updatePopupConstraints();
                if (this._dashboardView) {
                    this._dashboardView.setPopupOpenState(true);
                    this._refreshAllNow();
                }
            } else if (this._dashboardView) {
                this._dashboardView.setPopupOpenState(false);
            }
        });

        // Handle Escape key explicitly inside the popup
        this._connectSignal(this.menu.actor || this.menu.box, 'key-press-event', (_actor, event) => {
            const symbol = event.get_key_symbol();
            if (symbol === Clutter.KEY_Escape) {
                this.menu.close(true);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _ensureDashboardInitialized() {
        if (this._dashboardView)
            return;

        this._dashboardView = new DashboardView({
            extensionPath: this._extensionPath,
            settings: this._settings,
            onCloseRequested: () => {
                this.menu.close(true);
            },
            onOpenPreferences: () => {
                this.menu.close(true);
                try {
                    this._extension.openPreferences();
                } catch (_e) {
                    // Ignore if preferences window is already open or unavailable
                }
            },
        });

        this._customMenuSection = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'sm-popup-base-item',
        });
        this._customMenuSection.add_child(this._dashboardView.actor);
        this.menu.addMenuItem(this._customMenuSection);
    }

    _updatePopupConstraints() {
        if (!this._dashboardView || !this._dashboardView.actor)
            return;

        try {
            const monitorIdx = Main.layoutManager.findIndexForActor(this) >= 0
                ? Main.layoutManager.findIndexForActor(this)
                : Main.layoutManager.primaryIndex;
            const workArea = Main.layoutManager.getWorkAreaForMonitor(monitorIdx);
            if (!workArea)
                return;

            const maxWidth = Math.min(920, Math.max(520, workArea.width - 48));
            const maxHeight = Math.min(780, Math.max(420, workArea.height - 64));
            this._dashboardView.actor.set_style(
                `max-width: ${maxWidth}px; max-height: ${maxHeight}px;`
            );
        } catch (_e) {
            // Fallback to CSS defaults if workArea cannot be queried
        }
    }

    _connectSettingsAndDisplaySignals() {
        this._connectSignal(Main.layoutManager, 'monitors-changed', () => {
            this._updatePopupConstraints();
        });

        this._connectSignal(this._settings, 'changed::refresh-interval', () => {
            this._restartTimers();
        });

        this._connectSignal(this._settings, 'changed::slow-refresh-interval', () => {
            this._restartTimers();
        });

        this._connectSignal(this._settings, 'changed::graph-history-length', () => {
            const len = this._settings.get_int('graph-history-length') || 60;
            this._cpuProvider.setHistoryLength(len);
            this._gpuProvider.setHistoryLength(len);
            this._memoryProvider.setHistoryLength(len);
            this._batteryProvider.setHistoryLength(len);
            this._fanProvider.setHistoryLength(len);
        });

        this._connectSignal(this._settings, 'changed::show-topbar-frequency', () => {
            this._updateTopBarDisplay();
        });

        this._connectSignal(this._settings, 'changed::show-topbar-sparkline', () => {
            if (this._topBarSparkline)
                this._topBarSparkline.visible = this._settings.get_boolean('show-topbar-sparkline');
        });

        this._connectSignal(this._settings, 'changed::temperature-unit', () => {
            if (this._dashboardView && this.menu.isOpen)
                this._dashboardView.updateTelemetry(this._latestSnapshot, true);
        });
    }

    _startTimers() {
        this._stopTimers();

        // Trigger initial non-blocking read on idle
        this._initialIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._initialIdleId = 0;
            this._refreshAllNow();
            return GLib.SOURCE_REMOVE;
        });

        const fastSec = Math.max(1, Math.min(30, this._settings.get_int('refresh-interval') || 2));
        const slowSec = Math.max(5, Math.min(120, this._settings.get_int('slow-refresh-interval') || 10));

        this._fastTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, fastSec, () => {
            this._runFastTelemetryCycle();
            return GLib.SOURCE_CONTINUE;
        });

        this._slowTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, slowSec, () => {
            this._runSlowTelemetryCycle();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _restartTimers() {
        this._startTimers();
    }

    _stopTimers() {
        if (this._initialIdleId) {
            GLib.Source.remove(this._initialIdleId);
            this._initialIdleId = 0;
        }
        if (this._fastTimerId) {
            GLib.Source.remove(this._fastTimerId);
            this._fastTimerId = 0;
        }
        if (this._slowTimerId) {
            GLib.Source.remove(this._slowTimerId);
            this._slowTimerId = 0;
        }
    }

    async _refreshAllNow() {
        await Promise.all([
            this._runFastTelemetryCycle(),
            this._runSlowTelemetryCycle(),
        ]);
    }

    async _runFastTelemetryCycle() {
        if (this._isRefreshingFast || !this._cancellable || this._cancellable.is_cancelled())
            return;

        this._isRefreshingFast = true;
        try {
            const isOpen = Boolean(this.menu && this.menu.isOpen);

            // Always update CPU so the top-bar indicator & sparkline stay current
            const cpuPromise = this._cpuProvider.collect(this._cancellable);

            // Only poll GPU, Memory, and Fans when the popup is open (or on initial snapshot)
            const shouldPollPopupSensors = isOpen || !this._latestSnapshot.memory;
            const [cpu, gpu, memory, fan] = await Promise.all([
                cpuPromise,
                shouldPollPopupSensors ? this._gpuProvider.collect(this._cancellable) : Promise.resolve(this._latestSnapshot.gpu),
                shouldPollPopupSensors ? this._memoryProvider.collect(this._cancellable) : Promise.resolve(this._latestSnapshot.memory),
                shouldPollPopupSensors ? this._fanProvider.collect(this._cancellable) : Promise.resolve(this._latestSnapshot.fan),
            ]);

            if (!this._cancellable || this._cancellable.is_cancelled())
                return;

            this._latestSnapshot.cpu = cpu;
            this._latestSnapshot.gpu = gpu;
            this._latestSnapshot.memory = memory;
            this._latestSnapshot.fan = fan;
            this._latestSnapshot.refreshSucceeded = Boolean(cpu && cpu.totalUsage !== null);

            this._updateTopBarDisplay();

            if (this._dashboardView && isOpen)
                this._dashboardView.updateTelemetry(this._latestSnapshot, true);
        } catch (_e) {
            this._latestSnapshot.refreshSucceeded = false;
        } finally {
            this._isRefreshingFast = false;
        }
    }

    async _runSlowTelemetryCycle() {
        if (this._isRefreshingSlow || !this._cancellable || this._cancellable.is_cancelled())
            return;

        const isOpen = Boolean(this.menu && this.menu.isOpen);
        if (!isOpen && this._latestSnapshot.sysInfo)
            return;

        this._isRefreshingSlow = true;
        try {
            const [sysInfo, storage, battery] = await Promise.all([
                this._sysInfoProvider.collect(this._cancellable),
                this._storageProvider.collect(this._cancellable),
                this._batteryProvider.collect(this._cancellable),
            ]);

            if (!this._cancellable || this._cancellable.is_cancelled())
                return;

            this._latestSnapshot.sysInfo = sysInfo;
            this._latestSnapshot.storage = storage;
            this._latestSnapshot.battery = battery;

            if (this._dashboardView && isOpen)
                this._dashboardView.updateTelemetry(this._latestSnapshot, true);
        } catch (_e) {
            // Preserve previous snapshot on transient read failure
        } finally {
            this._isRefreshingSlow = false;
        }
    }

    _updateTopBarDisplay() {
        if (!this._topBarCpuLabel)
            return;

        const cpu = this._latestSnapshot.cpu;
        if (!cpu || cpu.totalUsage === null) {
            this._topBarCpuLabel.text = 'CPU N/A';
            this._topBarFreqLabel.visible = false;
            return;
        }

        const pct = Math.round(cpu.totalUsage);
        this._topBarCpuLabel.text = `CPU ${pct}%`;

        const showFreq = this._settings.get_boolean('show-topbar-frequency');
        if (showFreq && cpu.avgFrequencyFormatted && cpu.avgFrequencyFormatted !== 'N/A') {
            this._topBarFreqLabel.text = cpu.avgFrequencyFormatted;
            this._topBarFreqLabel.visible = true;
        } else {
            this._topBarFreqLabel.visible = false;
        }

        if (this._topBarSparkline && this._settings.get_boolean('show-topbar-sparkline')) {
            this._topBarSparkline.visible = true;
            this._topBarSparkline.setSamples(cpu.totalHistory, '#38bdf8');
        }
    }

    destroy() {
        this._stopTimers();

        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }

        for (const rec of this._signalRecords) {
            try {
                rec.obj.disconnect(rec.id);
            } catch (_e) {
                // Ignore if already disposed
            }
        }
        this._signalRecords = [];

        if (this._dashboardView) {
            this._dashboardView.destroy();
            this._dashboardView = null;
        }
        this._customMenuSection = null;

        if (this._topBarSparkline) {
            this._topBarSparkline.destroy();
            this._topBarSparkline = null;
        }

        if (this._sysInfoProvider) {
            this._sysInfoProvider.destroy();
            this._sysInfoProvider = null;
        }
        if (this._cpuProvider) {
            this._cpuProvider.destroy();
            this._cpuProvider = null;
        }
        if (this._gpuProvider) {
            this._gpuProvider.destroy();
            this._gpuProvider = null;
        }
        if (this._memoryProvider) {
            this._memoryProvider.destroy();
            this._memoryProvider = null;
        }
        if (this._storageProvider) {
            this._storageProvider.destroy();
            this._storageProvider = null;
        }
        if (this._batteryProvider) {
            this._batteryProvider.destroy();
            this._batteryProvider = null;
        }
        if (this._fanProvider) {
            this._fanProvider.destroy();
            this._fanProvider = null;
        }

        this._latestSnapshot = null;
        this._settings = null;
        this._extension = null;

        super.destroy();
    }
});

export default class SystemMonitorPremiumExtension extends Extension {
    enable() {
        if (this._indicator)
            return;

        this._indicator = new SystemMonitorIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
