/**
 * System Monitor — Premium
 * Scrollable Dashboard View, Sidebar Navigation, Header, and Footer
 *
 * Implements the responsive Premium Dark dashboard inside the GNOME Shell popup,
 * including sidebar navigation (Overview, CPU, GPU, Memory & Swap, Disk & Partitions,
 * Battery, Fan, Settings), pin/keep-open toggle, close button, scrollable 2-column
 * overview grid, and live status footer.
 */

import St from 'gi://St';
import Clutter from 'gi://Clutter';

import { createAssetIcon } from './components.js';
import {
    SystemInfoCard,
    CpuCard,
    GpuCard,
    MemorySwapCard,
    StorageCard,
    BatteryCard,
    FanCard,
} from './cards.js';

const SECTIONS = Object.freeze([
    { id: 'overview', label: 'Overview', icon: 'overview-symbolic.svg' },
    { id: 'cpu', label: 'CPU', icon: 'cpu-symbolic.svg' },
    { id: 'gpu', label: 'GPU', icon: 'gpu-symbolic.svg' },
    { id: 'memory', label: 'Memory & Swap', icon: 'memory-symbolic.svg' },
    { id: 'storage', label: 'Disk & Partitions', icon: 'storage-symbolic.svg' },
    { id: 'battery', label: 'Battery', icon: 'battery-symbolic.svg' },
    { id: 'fan', label: 'Fan', icon: 'fan-symbolic.svg' },
]);

export class DashboardView {
    constructor({ extensionPath, settings, onCloseRequested, onOpenPreferences }) {
        this._extensionPath = extensionPath;
        this._settings = settings;
        this._onCloseRequested = onCloseRequested;
        this._onOpenPreferences = onOpenPreferences;
        this._activeSection = 'overview';
        this._isPinned = false;
        this._signalRecords = []; // [{ obj, id }]

        this.actor = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'sm-dashboard-root',
            reactive: true,
            can_focus: true,
            accessible_name: 'System Monitor Premium Dashboard',
        });

        this._buildHeader();
        this._buildBody();
        this._buildFooter();
    }

    get isPinned() {
        return this._isPinned;
    }

    _connectSignal(obj, signalName, callback) {
        const id = obj.connect(signalName, callback);
        this._signalRecords.push({ obj, id });
        return id;
    }

    _buildHeader() {
        const header = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'sm-header-bar',
        });

        const brandIconBin = new St.Bin({
            style_class: 'sm-brand-icon-bin',
            child: createAssetIcon(this._extensionPath, 'monitor-symbolic.svg', 26, 'sm-brand-icon'),
        });
        header.add_child(brandIconBin);

        const titleCol = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        titleCol.add_child(new St.Label({
            text: 'System Monitor',
            style_class: 'sm-header-title',
        }));
        titleCol.add_child(new St.Label({
            text: 'Live System Resources & Hardware Info',
            style_class: 'sm-header-subtitle',
        }));
        header.add_child(titleCol);

        // Pin button (optional keep-open behavior)
        this._pinButton = new St.Button({
            style_class: 'sm-icon-button',
            can_focus: true,
            accessible_name: 'Pin Dashboard Popup',
            child: createAssetIcon(this._extensionPath, 'pin-symbolic.svg', 16),
        });
        this._connectSignal(this._pinButton, 'clicked', () => {
            this._isPinned = !this._isPinned;
            if (this._isPinned)
                this._pinButton.add_style_class_name('sm-icon-button-active');
            else
                this._pinButton.remove_style_class_name('sm-icon-button-active');
        });
        header.add_child(this._pinButton);

        // Clearly visible Close button
        this._closeButton = new St.Button({
            style_class: 'sm-icon-button sm-close-button',
            can_focus: true,
            accessible_name: 'Close System Monitor Popup',
            child: createAssetIcon(this._extensionPath, 'close-symbolic.svg', 16),
        });
        this._connectSignal(this._closeButton, 'clicked', () => {
            if (this._onCloseRequested)
                this._onCloseRequested();
        });
        header.add_child(this._closeButton);

        this.actor.add_child(header);
    }

    _buildBody() {
        this._bodyBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            y_expand: true,
            style_class: 'sm-body-container',
        });

        // Left navigation sidebar
        this._sidebar = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            y_expand: true,
            style_class: 'sm-sidebar',
        });

        this._navButtons = new Map();
        const navTopList = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            y_expand: true,
            style_class: 'sm-nav-list',
        });

        for (const sec of SECTIONS) {
            const btn = this._createNavButton(sec.id, sec.label, sec.icon);
            navTopList.add_child(btn);
            this._navButtons.set(sec.id, btn);
        }
        this._sidebar.add_child(navTopList);

        // Bottom Settings button in sidebar
        const settingsBtn = this._createNavButton('settings', 'Settings', 'settings-symbolic.svg');
        settingsBtn.add_style_class_name('sm-nav-settings-btn');
        this._sidebar.add_child(settingsBtn);
        this._navButtons.set('settings', settingsBtn);

        this._bodyBox.add_child(this._sidebar);

        // Main scrollable content area
        this._scrollView = new St.ScrollView({
            x_expand: true,
            y_expand: true,
            style_class: 'sm-scroll-view',
            overlay_scrollbars: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
        });

        this._contentBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'sm-content-box',
        });

        // Instantiate monitoring cards once (updated in place without rebuilding DOM)
        this._sysInfoCard = new SystemInfoCard(this._extensionPath);
        this._cpuCard = new CpuCard(this._extensionPath);
        this._gpuCard = new GpuCard(this._extensionPath);
        this._memoryCard = new MemorySwapCard(this._extensionPath);
        this._storageCard = new StorageCard(this._extensionPath);
        this._batteryCard = new BatteryCard(this._extensionPath);
        this._fanCard = new FanCard(this._extensionPath);
        this._settingsPanel = this._buildInlineSettingsCard();

        // Two-column row wrappers for Overview mode
        this._rowCpuGpu = new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL, x_expand: true, style_class: 'sm-grid-row' });
        this._rowMemDisk = new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL, x_expand: true, style_class: 'sm-grid-row' });
        this._rowBatFan = new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL, x_expand: true, style_class: 'sm-grid-row' });

        this._rowCpuGpu.add_child(this._cpuCard.actor);
        this._rowCpuGpu.add_child(this._gpuCard.actor);

        this._rowMemDisk.add_child(this._memoryCard.actor);
        this._rowMemDisk.add_child(this._storageCard.actor);

        this._rowBatFan.add_child(this._batteryCard.actor);
        this._rowBatFan.add_child(this._fanCard.actor);

        this._contentBox.add_child(this._sysInfoCard.actor);
        this._contentBox.add_child(this._rowCpuGpu);
        this._contentBox.add_child(this._rowMemDisk);
        this._contentBox.add_child(this._rowBatFan);
        this._contentBox.add_child(this._settingsPanel);

        this._scrollView.child = this._contentBox;
        this._bodyBox.add_child(this._scrollView);
        this.actor.add_child(this._bodyBox);

        this._applySectionFilter();
    }

    _createNavButton(sectionId, labelText, iconFile) {
        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'sm-nav-btn-content',
        });
        box.add_child(createAssetIcon(this._extensionPath, iconFile, 18, 'sm-nav-icon'));
        box.add_child(new St.Label({
            text: labelText,
            style_class: 'sm-nav-label',
            y_align: Clutter.ActorAlign.CENTER,
        }));

        const btn = new St.Button({
            style_class: sectionId === this._activeSection
                ? 'sm-nav-btn sm-nav-btn-active'
                : 'sm-nav-btn',
            can_focus: true,
            x_expand: true,
            accessible_name: `${labelText} Section`,
            child: box,
        });

        this._connectSignal(btn, 'clicked', () => {
            this.setActiveSection(sectionId);
        });

        return btn;
    }

    _buildInlineSettingsCard() {
        const panel = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'sm-card sm-card-full',
            visible: false,
            accessible_name: 'Quick Settings Panel',
        });

        panel.add_child(new St.Label({
            text: 'Dashboard & Telemetry Preferences',
            style_class: 'sm-card-title',
        }));

        const createToggleRow = (label, settingKey) => {
            const row = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'sm-settings-row',
            });
            row.add_child(new St.Label({
                text: label,
                x_expand: true,
                style_class: 'sm-kv-label',
            }));

            const toggleBtn = new St.Button({
                style_class: 'sm-pill-button',
                can_focus: true,
                label: this._settings && this._settings.get_boolean(settingKey) ? 'Enabled' : 'Disabled',
            });

            this._connectSignal(toggleBtn, 'clicked', () => {
                if (!this._settings)
                    return;
                const next = !this._settings.get_boolean(settingKey);
                this._settings.set_boolean(settingKey, next);
                toggleBtn.label = next ? 'Enabled' : 'Disabled';
                this._applySectionFilter();
            });

            row.add_child(toggleBtn);
            return row;
        };

        panel.add_child(createToggleRow('Show CPU Frequency in Top Bar', 'show-topbar-frequency'));
        panel.add_child(createToggleRow('Show Live Sparkline in Top Bar', 'show-topbar-sparkline'));
        panel.add_child(createToggleRow('Enable Smooth Animations & Fan Spin', 'enable-animations'));
        panel.add_child(createToggleRow('Compact Layout Mode', 'compact-layout'));

        const openFullPrefsBtn = new St.Button({
            style_class: 'sm-prefs-launch-btn',
            can_focus: true,
            label: 'Open Full GNOME Extension Preferences…',
            accessible_name: 'Open Full Extension Preferences Dialog',
        });
        this._connectSignal(openFullPrefsBtn, 'clicked', () => {
            if (this._onOpenPreferences)
                this._onOpenPreferences();
        });
        panel.add_child(openFullPrefsBtn);

        return panel;
    }

    _buildFooter() {
        const footer = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'sm-footer-bar',
        });

        this._liveDot = new St.Widget({
            style_class: 'sm-live-dot sm-live-dot-active',
            y_align: Clutter.ActorAlign.CENTER,
        });
        footer.add_child(this._liveDot);

        this._statusLabel = new St.Label({
            text: 'Reading sensors...',
            style_class: 'sm-footer-status',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        });
        footer.add_child(this._statusLabel);

        this._guidanceLabel = new St.Label({
            text: 'Click outside or press Esc to close',
            style_class: 'sm-footer-guidance',
            x_align: Clutter.ActorAlign.END,
        });
        footer.add_child(this._guidanceLabel);

        this.actor.add_child(footer);
    }

    setActiveSection(sectionId) {
        this._activeSection = sectionId;
        for (const [id, btn] of this._navButtons.entries()) {
            if (id === sectionId)
                btn.add_style_class_name('sm-nav-btn-active');
            else
                btn.remove_style_class_name('sm-nav-btn-active');
        }
        this._applySectionFilter();
    }

    _applySectionFilter() {
        const s = this._settings;
        const showSys = !s || s.get_boolean('show-card-sysinfo');
        const showCpu = !s || s.get_boolean('show-card-cpu');
        const showGpu = !s || s.get_boolean('show-card-gpu');
        const showMem = !s || s.get_boolean('show-card-memory');
        const showDisk = !s || s.get_boolean('show-card-storage');
        const showBat = !s || s.get_boolean('show-card-battery');
        const showFan = !s || s.get_boolean('show-card-fan');
        const compact = s && s.get_boolean('compact-layout');

        if (compact)
            this.actor.add_style_class_name('sm-dashboard-compact');
        else
            this.actor.remove_style_class_name('sm-dashboard-compact');

        // Stack rows vertically when viewing a single hardware section or compact mode
        const isOverview = this._activeSection === 'overview';
        const rowOrientation = (!isOverview || compact)
            ? Clutter.Orientation.VERTICAL
            : Clutter.Orientation.HORIZONTAL;
        this._rowCpuGpu.orientation = rowOrientation;
        this._rowMemDisk.orientation = rowOrientation;
        this._rowBatFan.orientation = rowOrientation;

        this._sysInfoCard.actor.visible = isOverview && showSys;

        this._cpuCard.actor.visible = (isOverview && showCpu) || this._activeSection === 'cpu';
        this._gpuCard.actor.visible = (isOverview && showGpu) || this._activeSection === 'gpu';
        this._rowCpuGpu.visible = this._cpuCard.actor.visible || this._gpuCard.actor.visible;

        this._memoryCard.actor.visible = (isOverview && showMem) || this._activeSection === 'memory';
        this._storageCard.actor.visible = (isOverview && showDisk) || this._activeSection === 'storage';
        this._rowMemDisk.visible = this._memoryCard.actor.visible || this._storageCard.actor.visible;

        this._batteryCard.actor.visible = (isOverview && showBat) || this._activeSection === 'battery';
        this._fanCard.actor.visible = (isOverview && showFan) || this._activeSection === 'fan';
        this._rowBatFan.visible = this._batteryCard.actor.visible || this._fanCard.actor.visible;

        this._settingsPanel.visible = this._activeSection === 'settings';
    }

    /**
     * Updates all visible monitoring cards and the footer status indicator.
     * Never claims telemetry is live if the refresh failed.
     */
    updateTelemetry(snapshot, popupOpen = true) {
        const s = this._settings;
        const tempUnit = s ? s.get_string('temperature-unit') : 'celsius';
        const animEnabled = !s || s.get_boolean('enable-animations');
        const refreshInterval = s ? s.get_int('refresh-interval') : 2;

        this._applySectionFilter();

        if (!snapshot || !snapshot.refreshSucceeded) {
            this._liveDot.remove_style_class_name('sm-live-dot-active');
            this._liveDot.add_style_class_name('sm-live-dot-error');
            this._statusLabel.text = 'Telemetry refresh failed — sensor read error';
            return;
        }

        this._liveDot.remove_style_class_name('sm-live-dot-error');
        this._liveDot.add_style_class_name('sm-live-dot-active');
        this._statusLabel.text = `Updating every ${refreshInterval} ${refreshInterval === 1 ? 'second' : 'seconds'}`;

        if (snapshot.sysInfo)
            this._sysInfoCard.update(snapshot.sysInfo, snapshot.gpu);
        if (snapshot.cpu)
            this._cpuCard.update(snapshot.cpu, tempUnit);
        if (snapshot.gpu)
            this._gpuCard.update(snapshot.gpu, tempUnit);
        if (snapshot.memory)
            this._memoryCard.update(snapshot.memory, animEnabled);
        if (snapshot.storage)
            this._storageCard.update(snapshot.storage, animEnabled);
        if (snapshot.battery)
            this._batteryCard.update(snapshot.battery, tempUnit, animEnabled);
        if (snapshot.fan)
            this._fanCard.update(snapshot.fan, snapshot.cpu, snapshot.gpu, animEnabled, popupOpen);
    }

    setPopupOpenState(isOpen) {
        const animEnabled = !this._settings || this._settings.get_boolean('enable-animations');
        if (this._fanCard)
            this._fanCard.setPopupOpen(isOpen, animEnabled);
    }

    destroy() {
        for (const rec of this._signalRecords) {
            try {
                rec.obj.disconnect(rec.id);
            } catch (_e) {
                // Object may already be disposed
            }
        }
        this._signalRecords = [];

        if (this._sysInfoCard) {
            this._sysInfoCard.destroy();
            this._sysInfoCard = null;
        }
        if (this._cpuCard) {
            this._cpuCard.destroy();
            this._cpuCard = null;
        }
        if (this._gpuCard) {
            this._gpuCard.destroy();
            this._gpuCard = null;
        }
        if (this._memoryCard) {
            this._memoryCard.destroy();
            this._memoryCard = null;
        }
        if (this._storageCard) {
            this._storageCard.destroy();
            this._storageCard = null;
        }
        if (this._batteryCard) {
            this._batteryCard.destroy();
            this._batteryCard = null;
        }
        if (this._fanCard) {
            this._fanCard.destroy();
            this._fanCard = null;
        }

        this._navButtons.clear();
        if (this.actor) {
            this.actor.destroy();
            this.actor = null;
        }
    }
}
