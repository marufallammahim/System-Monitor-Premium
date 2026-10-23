/**
 * System Monitor — Premium (system-monitor@marufallammahim.github.io)
 * GNOME Shell 51 Extension Preferences Window (Libadwaita / GTK4)
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class SystemMonitorPremiumPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(620, 680);

        const page = new Adw.PreferencesPage({
            title: 'General & Telemetry',
            icon_name: 'utilities-system-monitor-symbolic',
        });
        window.add(page);

        // 1. Refresh & History Group
        const refreshGroup = new Adw.PreferencesGroup({
            title: 'Telemetry Sampling & History',
            description: 'Configure polling intervals, temperature units, and rolling graph sample depth.',
        });
        page.add(refreshGroup);

        const fastSpinRow = new Adw.SpinRow({
            title: 'Fast Telemetry Refresh Interval (seconds)',
            subtitle: 'Polling interval for CPU, GPU, Memory, and Fan sensors',
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 30,
                step_increment: 1,
                page_increment: 5,
                value: settings.get_int('refresh-interval'),
            }),
        });
        settings.bind('refresh-interval', fastSpinRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        refreshGroup.add(fastSpinRow);

        const slowSpinRow = new Adw.SpinRow({
            title: 'Slow Telemetry Refresh Interval (seconds)',
            subtitle: 'Polling interval for Disk Partitions, Battery, and Uptime',
            adjustment: new Gtk.Adjustment({
                lower: 5,
                upper: 120,
                step_increment: 5,
                page_increment: 15,
                value: settings.get_int('slow-refresh-interval'),
            }),
        });
        settings.bind('slow-refresh-interval', slowSpinRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        refreshGroup.add(slowSpinRow);

        const historySpinRow = new Adw.SpinRow({
            title: 'Graph Rolling History Samples',
            subtitle: 'Bounded number of historical samples retained per metric',
            adjustment: new Gtk.Adjustment({
                lower: 20,
                upper: 300,
                step_increment: 10,
                page_increment: 30,
                value: settings.get_int('graph-history-length'),
            }),
        });
        settings.bind('graph-history-length', historySpinRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        refreshGroup.add(historySpinRow);

        const unitModel = new Gtk.StringList();
        unitModel.append('Celsius (°C)');
        unitModel.append('Fahrenheit (°F)');
        const unitRow = new Adw.ComboRow({
            title: 'Temperature Unit',
            subtitle: 'Display CPU, GPU, and Battery temperatures in °C or °F',
            model: unitModel,
            selected: settings.get_string('temperature-unit') === 'fahrenheit' ? 1 : 0,
        });
        unitRow.connect('notify::selected', () => {
            settings.set_string('temperature-unit', unitRow.selected === 1 ? 'fahrenheit' : 'celsius');
        });
        refreshGroup.add(unitRow);

        // 2. Top Bar & Layout Group
        const uiGroup = new Adw.PreferencesGroup({
            title: 'Top Bar Indicator & Dashboard Appearance',
            description: 'Customize top-bar telemetry display, animations, and layout density.',
        });
        page.add(uiGroup);

        this._addSwitchRow(uiGroup, settings, 'show-topbar-frequency',
            'Show CPU Frequency in Top Bar',
            'Display average GHz next to CPU utilization percentage');
        this._addSwitchRow(uiGroup, settings, 'show-topbar-sparkline',
            'Show Live Sparkline in Top Bar',
            'Render compact rolling CPU usage sparkline in the top panel');
        this._addSwitchRow(uiGroup, settings, 'enable-animations',
            'Enable Gauge & Rotational Fan Animations',
            'Smoothly animate circular rings and rotate fan blades proportional to measured RPM');
        this._addSwitchRow(uiGroup, settings, 'compact-layout',
            'Compact Dashboard Layout',
            'Use reduced padding and single-column stacking for smaller displays');

        // 3. Visible Monitoring Cards Group
        const cardsGroup = new Adw.PreferencesGroup({
            title: 'Visible Monitoring Cards (Overview)',
            description: 'Choose which hardware cards appear in the main Overview grid.',
        });
        page.add(cardsGroup);

        this._addSwitchRow(cardsGroup, settings, 'show-card-sysinfo', 'System Information Card', 'OS, Host, Kernel, Uptime, Packages, and Desktop Environment');
        this._addSwitchRow(cardsGroup, settings, 'show-card-cpu', 'CPU Monitoring Card', 'Total/User/System utilization, GHz, temperature, and per-core bars');
        this._addSwitchRow(cardsGroup, settings, 'show-card-gpu', 'GPU Monitoring Card', 'Utilization, clock speed, VRAM, temperature, power, and fan speed');
        this._addSwitchRow(cardsGroup, settings, 'show-card-memory', 'Memory & Swap Card', 'RAM and Swap circular gauges, Cached/Buffers/Available breakdown');
        this._addSwitchRow(cardsGroup, settings, 'show-card-storage', 'Disk & Partitions Card', 'Mounted filesystems, root gauge, and partition usage bars');
        this._addSwitchRow(cardsGroup, settings, 'show-card-battery', 'Battery Monitoring Card', 'Charge percentage, power draw, health, and remaining time');
        this._addSwitchRow(cardsGroup, settings, 'show-card-fan', 'Fan & Thermal Card', 'Hardware fan RPM, proportional blade animation, and thermal history');
    }

    _addSwitchRow(group, settings, key, title, subtitle) {
        const row = new Adw.SwitchRow({
            title,
            subtitle,
        });
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(row);
    }
}
