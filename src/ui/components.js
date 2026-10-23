/**
 * System Monitor — Premium
 * Reusable UI Primitives & Accessible Controls
 */

import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

/**
 * Loads a local SVG asset from the extension's `assets/` directory as a Gio.FileIcon.
 */
export function createAssetIcon(extensionPath, filename, size = 18, styleClass = 'sm-icon') {
    const file = Gio.File.new_for_path(`${extensionPath}/assets/${filename}`);
    const gicon = new Gio.FileIcon({ file });
    return new St.Icon({
        gicon,
        icon_size: size,
        style_class: styleClass,
    });
}

/**
 * Creates a styled monitoring card container with an icon, title, optional subtitle,
 * and optional status badge.
 */
export function createCardContainer(extensionPath, {
    iconFile,
    title,
    subtitle = null,
    accessibleName = null,
    fullWidth = false,
}) {
    const card = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        style_class: fullWidth ? 'sm-card sm-card-full' : 'sm-card',
        accessible_name: accessibleName || `${title} Card`,
    });

    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: 'sm-card-header',
    });

    if (iconFile) {
        const iconWrap = new St.Bin({
            style_class: 'sm-card-icon-bin',
            child: createAssetIcon(extensionPath, iconFile, 18, 'sm-card-icon'),
        });
        headerBox.add_child(iconWrap);
    }

    const titleColumn = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const titleLabel = new St.Label({
        text: title,
        style_class: 'sm-card-title',
        x_align: Clutter.ActorAlign.START,
    });
    titleColumn.add_child(titleLabel);

    const subtitleLabel = new St.Label({
        text: subtitle || '',
        style_class: 'sm-card-subtitle',
        x_align: Clutter.ActorAlign.START,
        visible: Boolean(subtitle),
    });
    titleColumn.add_child(subtitleLabel);

    headerBox.add_child(titleColumn);

    const badgeLabel = new St.Label({
        text: '',
        style_class: 'sm-status-badge',
        y_align: Clutter.ActorAlign.CENTER,
        visible: false,
    });
    headerBox.add_child(badgeLabel);

    card.add_child(headerBox);

    return {
        card,
        titleLabel,
        subtitleLabel,
        badgeLabel,
    };
}

/**
 * Creates a two-column key-value metric row with aligned label and value.
 */
export function createKeyValueRow(labelText, initialValue = 'Reading Sensor', valueClass = 'sm-kv-value') {
    const row = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: 'sm-kv-row',
    });

    const keyLabel = new St.Label({
        text: labelText,
        style_class: 'sm-kv-label',
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
    });

    const valLabel = new St.Label({
        text: initialValue,
        style_class: valueClass,
        x_align: Clutter.ActorAlign.END,
    });

    row.add_child(keyLabel);
    row.add_child(valLabel);

    return { row, keyLabel, valLabel };
}

/**
 * Creates a horizontal progress bar widget using CSS percentage width on the fill actor.
 */
export function createProgressBar(accentClass = 'sm-progress-fill-cyan') {
    const track = new St.Widget({
        style_class: 'sm-progress-track',
        x_expand: true,
        layout_manager: new Clutter.BinLayout(),
    });

    const fill = new St.Widget({
        style_class: `sm-progress-fill ${accentClass}`,
        x_align: Clutter.ActorAlign.START,
        x_expand: false,
    });
    fill.set_style('width: 0px;');

    track.add_child(fill);

    const setPercent = (percent, maxTrackWidthPx = 110) => {
        const clamped = (typeof percent === 'number' && Number.isFinite(percent))
            ? Math.min(100, Math.max(0, percent))
            : 0;
        const px = Math.round((clamped / 100.0) * maxTrackWidthPx);
        fill.set_style(`width: ${px}px;`);
    };

    return { track, fill, setPercent };
}
