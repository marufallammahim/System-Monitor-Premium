/**
 * System Monitor — Premium
 * Live Graphs, Sparklines, Circular Gauges, and Rotational Fan Canvas Engine
 *
 * Uses GNOME Shell's supported St.DrawingArea + Cairo context for hardware-accelerated
 * rendering. Strictly manages signal connections and animation timers for clean
 * teardown (EGO-L-002, EGO-L-003, EGO-L-005 compliant).
 */

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Cairo from 'cairo';

/**
 * Helper to parse hex color strings (#RRGGBB or #RRGGBBAA) into [r, g, b, a] in 0..1.
 */
export function parseHexColor(hex, alphaOverride = null) {
    const clean = (hex || '#38bdf8').replace('#', '');
    const r = Number.parseInt(clean.slice(0, 2) || '38', 16) / 255.0;
    const g = Number.parseInt(clean.slice(2, 4) || 'bd', 16) / 255.0;
    const b = Number.parseInt(clean.slice(4, 6) || 'f8', 16) / 255.0;
    let a = 1.0;
    if (clean.length >= 8)
        a = Number.parseInt(clean.slice(6, 8), 16) / 255.0;
    if (alphaOverride !== null)
        a = alphaOverride;
    return [r, g, b, a];
}

/**
 * Draws horizontally centered text in GJS Cairo without relying on cr.textExtents
 * (which is not bound in GJS's native Cairo C++ wrapper).
 */
function showCenteredText(cr, text, cx, y, fontSize) {
    if (!text)
        return;
    const str = String(text);
    const approxWidth = str.length * (fontSize * 0.56);
    cr.moveTo(Math.max(2, cx - approxWidth / 2.0), y);
    cr.showText(str);
}

/**
 * Compact Top-Bar Sparkline (St.DrawingArea)
 * Renders a smooth rolling CPU utilization line + gradient fill in the top panel.
 */
export const TopBarSparkline = GObject.registerClass(
class TopBarSparkline extends St.DrawingArea {
    _init(width = 44, height = 18) {
        super._init({
            style_class: 'sm-topbar-sparkline',
            width,
            height,
            reactive: false,
        });
        this._values = [];
        this._lineColor = '#38bdf8';
        this._repaintId = this.connect('repaint', this._onRepaint.bind(this));
    }

    setSamples(values, lineColor = '#38bdf8') {
        this._values = Array.isArray(values) ? values.slice(-30) : [];
        this._lineColor = lineColor;
        this.queue_repaint();
    }

    _onRepaint(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        if (w <= 0 || h <= 0) {
            cr.$dispose();
            return;
        }

        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(Cairo.Operator.OVER);

        // Subtle dark pill background
        const [bgR, bgG, bgB, bgA] = parseHexColor('#0f172a', 0.65);
        cr.setSourceRGBA(bgR, bgG, bgB, bgA);
        cr.rectangle(0, 0, w, h);
        cr.fill();

        const validPoints = [];
        const n = this._values.length;
        if (n >= 2) {
            const stepX = w / Math.max(1, n - 1);
            for (let i = 0; i < n; i++) {
                const v = this._values[i];
                if (typeof v === 'number' && Number.isFinite(v)) {
                    const clamped = Math.min(100, Math.max(0, v));
                    const x = i * stepX;
                    const y = h - 2 - ((clamped / 100.0) * (h - 4));
                    validPoints.push([x, y]);
                }
            }
        }

        if (validPoints.length >= 2) {
            const [r, g, b] = parseHexColor(this._lineColor);
            const grad = new Cairo.LinearGradient(0, 0, 0, h);
            grad.addColorStopRGBA(0, r, g, b, 0.45);
            grad.addColorStopRGBA(1, r, g, b, 0.02);

            cr.moveTo(validPoints[0][0], h);
            for (const [px, py] of validPoints)
                cr.lineTo(px, py);
            cr.lineTo(validPoints[validPoints.length - 1][0], h);
            cr.closePath();
            cr.setSource(grad);
            cr.fill();

            cr.setLineWidth(1.5);
            cr.setSourceRGBA(r, g, b, 0.95);
            cr.moveTo(validPoints[0][0], validPoints[0][1]);
            for (let i = 1; i < validPoints.length; i++)
                cr.lineTo(validPoints[i][0], validPoints[i][1]);
            cr.stroke();
        } else {
            // Baseline when waiting for initial samples
            const [r, g, b] = parseHexColor(this._lineColor, 0.4);
            cr.setSourceRGBA(r, g, b, 0.4);
            cr.setLineWidth(1.0);
            cr.moveTo(0, h - 3);
            cr.lineTo(w, h - 3);
            cr.stroke();
        }

        cr.$dispose();
    }

    destroy() {
        if (this._repaintId) {
            this.disconnect(this._repaintId);
            this._repaintId = 0;
        }
        this._values = null;
        super.destroy();
    }
});

/**
 * Multi-Series Rolling Line Chart (St.DrawingArea)
 * Supports 1 or more real-time series, horizontal grid lines, optional Y-axis labels,
 * gap rendering when samples are null/unavailable, and gradient area fill.
 */
export const MultiLineGraph = GObject.registerClass(
class MultiLineGraph extends St.DrawingArea {
    _init(params = {}) {
        const width = params.width || 240;
        const height = params.height || 86;
        super._init({
            style_class: 'sm-line-graph',
            width,
            height,
            x_expand: true,
            reactive: false,
        });

        this._minVal = params.minValue ?? 0;
        this._maxVal = params.maxValue ?? 100;
        this._yLabels = params.yLabels || null;
        this._xLabels = params.xLabels || null;
        this._series = [];
        this._unavailableText = null;

        this._repaintId = this.connect('repaint', this._onRepaint.bind(this)); // repaint signal is emitted when the widget needs to be redrawn
    }

    setSeries(seriesList, unavailableText = null) {
        this._series = Array.isArray(seriesList) ? seriesList : [];
        this._unavailableText = unavailableText;
        this.queue_repaint();
    }

    _onRepaint(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        if (w <= 0 || h <= 0) {
            cr.$dispose();
            return;
        }

        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(Cairo.Operator.OVER);

        const padLeft = this._yLabels ? 30 : 4;
        const padRight = 4;
        const padTop = 6;
        const padBottom = this._xLabels ? 16 : 6;
        const plotW = Math.max(10, w - padLeft - padRight);
        const plotH = Math.max(10, h - padTop - padBottom);

        // Subtle grid lines (3 horizontal levels)
        cr.setLineWidth(1.0);
        for (let i = 0; i <= 2; i++) {
            const gy = Math.round(padTop + (plotH * i) / 2) + 0.5;
            cr.setSourceRGBA(0.20, 0.26, 0.38, 0.45);
            cr.moveTo(padLeft, gy);
            cr.lineTo(padLeft + plotW, gy);
            cr.stroke();

            if (this._yLabels && this._yLabels[i]) {
                cr.setSourceRGBA(0.58, 0.64, 0.72, 0.85);
                cr.selectFontFace('Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
                cr.setFontSize(9.5);
                cr.moveTo(2, gy + 3);
                cr.showText(this._yLabels[i]);
            }
        }

        if (this._xLabels && this._xLabels.length >= 2) {
            cr.setSourceRGBA(0.58, 0.64, 0.72, 0.85);
            cr.selectFontFace('Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
            cr.setFontSize(9.5);
            const count = this._xLabels.length;
            for (let i = 0; i < count; i++) {
                const ratio = i / (count - 1);
                const lx = padLeft + ratio * (plotW - 24);
                cr.moveTo(lx, h - 3);
                cr.showText(this._xLabels[i]);
            }
        }

        if (this._unavailableText) {
            cr.setSourceRGBA(0.58, 0.64, 0.72, 0.9);
            cr.selectFontFace('Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
            cr.setFontSize(11);
            cr.moveTo(padLeft + 12, padTop + plotH / 2 + 4);
            cr.showText(this._unavailableText);
            cr.$dispose();
            return;
        }

        const range = Math.max(1e-6, this._maxVal - this._minVal);

        for (const s of this._series) {
            const values = s.values || [];
            const n = values.length;
            if (n < 2)
                continue;

            const stepX = plotW / Math.max(1, n - 1);
            const segments = [];
            let currentSegment = [];

            for (let i = 0; i < n; i++) {
                const val = values[i];
                if (typeof val === 'number' && Number.isFinite(val)) {
                    const norm = Math.min(1, Math.max(0, (val - this._minVal) / range));
                    const px = padLeft + i * stepX;
                    const py = padTop + plotH - norm * plotH;
                    currentSegment.push([px, py]);
                } else if (currentSegment.length > 0) {
                    segments.push(currentSegment);
                    currentSegment = [];
                }
            }
            if (currentSegment.length > 0)
                segments.push(currentSegment);

            const [r, g, b] = parseHexColor(s.color || '#38bdf8');

            for (const seg of segments) {
                if (seg.length < 2)
                    continue;

                if (s.fill !== false) {
                    const grad = new Cairo.LinearGradient(0, padTop, 0, padTop + plotH);
                    grad.addColorStopRGBA(0, r, g, b, 0.35);
                    grad.addColorStopRGBA(1, r, g, b, 0.02);

                    cr.moveTo(seg[0][0], padTop + plotH);
                    for (const [px, py] of seg)
                        cr.lineTo(px, py);
                    cr.lineTo(seg[seg.length - 1][0], padTop + plotH);
                    cr.closePath();
                    cr.setSource(grad);
                    cr.fill();
                }

                cr.setLineWidth(s.lineWidth || 1.8);
                cr.setSourceRGBA(r, g, b, 0.95);
                cr.moveTo(seg[0][0], seg[0][1]);
                for (let i = 1; i < seg.length; i++)
                    cr.lineTo(seg[i][0], seg[i][1]);
                cr.stroke();
            }
        }

        cr.$dispose();
    }

    destroy() {
        if (this._repaintId) {
            this.disconnect(this._repaintId);
            this._repaintId = 0;
        }
        this._series = null;
        super.destroy();
    }
});

/**
 * Animated Circular Gauge / Ring Widget (St.DrawingArea)
 * Used for RAM, Swap, Root Disk, and Battery percentage rings.
 */
export const CircularGauge = GObject.registerClass(
class CircularGauge extends St.DrawingArea {
    _init(params = {}) {
        const size = params.size || 88;
        super._init({
            style_class: 'sm-circular-gauge',
            width: size,
            height: size,
            reactive: false,
        });

        this._size = size;
        this._strokeWidth = params.strokeWidth || 8;
        this._accentColor = params.color || '#38bdf8';
        this._trackColor = params.trackColor || '#1e293b';
        this._targetPercent = 0;
        this._currentPercent = 0;
        this._topLabel = params.topLabel || '';
        this._subLabel = params.subLabel || '';
        this._centerValueText = '0%';
        this._animTimerId = 0;

        this._repaintId = this.connect('repaint', this._onRepaint.bind(this));
    }

    setValue(percent, centerValueText = null, subLabel = null, animate = true) {
        const validPct = (typeof percent === 'number' && Number.isFinite(percent))
            ? Math.min(100, Math.max(0, percent))
            : 0;

        this._targetPercent = validPct;
        this._centerValueText = centerValueText !== null
            ? centerValueText
            : `${Math.round(validPct)}%`;
        if (subLabel !== null)
            this._subLabel = subLabel;

        if (!animate || Math.abs(this._targetPercent - this._currentPercent) < 0.8) {
            this._stopAnimTimer();
            this._currentPercent = this._targetPercent;
            this.queue_repaint();
            return;
        }

        if (!this._animTimerId) {
            this._animTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 32, () => {
                const diff = this._targetPercent - this._currentPercent;
                if (Math.abs(diff) < 0.5) {
                    this._currentPercent = this._targetPercent;
                    this.queue_repaint();
                    this._animTimerId = 0;
                    return GLib.SOURCE_REMOVE;
                }
                this._currentPercent += diff * 0.28;
                this.queue_repaint();
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    _onRepaint(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        if (w <= 0 || h <= 0) {
            cr.$dispose();
            return;
        }

        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(Cairo.Operator.OVER);

        const cx = w / 2.0;
        const cy = h / 2.0;
        const radius = Math.min(w, h) / 2.0 - this._strokeWidth - 2;
        const startAngle = -Math.PI / 2.0;
        const endAngle = startAngle + (Math.PI * 2.0) * (this._currentPercent / 100.0);

        // Background track ring
        const [tr, tg, tb] = parseHexColor(this._trackColor);
        cr.setLineWidth(this._strokeWidth);
        cr.setSourceRGBA(tr, tg, tb, 0.85);
        cr.arc(cx, cy, radius, 0, Math.PI * 2.0);
        cr.stroke();

        // Active value arc
        if (this._currentPercent > 0.2) {
            const [ar, ag, ab] = parseHexColor(this._accentColor);
            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.setLineWidth(this._strokeWidth);
            cr.setSourceRGBA(ar, ag, ab, 0.96);
            cr.arc(cx, cy, radius, startAngle, endAngle);
            cr.stroke();
        }

        // Center labels (using safe centered coordinates without cr.textExtents)
        cr.selectFontFace('Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
        if (this._topLabel) {
            cr.setFontSize(9.5);
            cr.setSourceRGBA(0.75, 0.82, 0.90, 0.9);
            showCenteredText(cr, this._topLabel, cx, cy - 11, 9.5);
        }

        if (this._subLabel) {
            cr.setFontSize(7.5);
            cr.setSourceRGBA(0.58, 0.64, 0.72, 0.85);
            showCenteredText(cr, this._subLabel, cx, cy - 1, 7.5);
        }

        cr.selectFontFace('Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
        const valFontSize = this._topLabel ? 12.5 : 14.5;
        cr.setFontSize(valFontSize);
        cr.setSourceRGBA(0.95, 0.97, 1.0, 0.98);
        const valY = this._topLabel ? cy + 14 : cy + 5;
        showCenteredText(cr, this._centerValueText, cx, valY, valFontSize);

        cr.$dispose();
    }

    _stopAnimTimer() {
        if (this._animTimerId) {
            GLib.Source.remove(this._animTimerId);
            this._animTimerId = 0;
        }
    }

    destroy() {
        this._stopAnimTimer();
        if (this._repaintId) {
            this.disconnect(this._repaintId);
            this._repaintId = 0;
        }
        super.destroy();
    }
});

/**
 * Rotational Fan Rotor Canvas (St.DrawingArea)
 * Smoothly rotates fan blades proportional to actual measured RPM when RPM > 0
 * and popup is open. Strictly stops rotating when RPM === 0 or telemetry is unavailable.
 */
export const FanRotorCanvas = GObject.registerClass(
class FanRotorCanvas extends St.DrawingArea {
    _init(size = 56, accentColor = '#38bdf8') {
        super._init({
            style_class: 'sm-fan-rotor',
            width: size,
            height: size,
            reactive: false,
        });

        this._size = size;
        this._accentColor = accentColor;
        this._rpm = null;
        this._angleRad = 0;
        this._animEnabled = true;
        this._popupOpen = false;
        this._timerId = 0;

        this._repaintId = this.connect('repaint', this._onRepaint.bind(this));
    }

    setState(rpm, animEnabled = true, popupOpen = true) {
        this._rpm = (typeof rpm === 'number' && Number.isFinite(rpm) && rpm >= 0) ? rpm : null;
        this._animEnabled = Boolean(animEnabled);
        this._popupOpen = Boolean(popupOpen);
        this._syncAnimationLoop();
        this.queue_repaint();
    }

    _syncAnimationLoop() {
        const shouldSpin = this._popupOpen &&
            this._animEnabled &&
            this._rpm !== null &&
            this._rpm > 0;

        if (!shouldSpin) {
            this._stopTimer();
            return;
        }

        if (!this._timerId) {
            this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => {
                if (!this._popupOpen || !this._animEnabled || !this._rpm || this._rpm <= 0) {
                    this._timerId = 0;
                    return GLib.SOURCE_REMOVE;
                }
                const normalizedSpeed = Math.min(1.5, Math.max(0.08, this._rpm / 2400.0));
                this._angleRad = (this._angleRad + normalizedSpeed * 0.26) % (Math.PI * 2.0);
                this.queue_repaint();
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    _onRepaint(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        if (w <= 0 || h <= 0) {
            cr.$dispose();
            return;
        }

        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(Cairo.Operator.OVER);

        const cx = w / 2.0;
        const cy = h / 2.0;
        const r = Math.min(w, h) / 2.0 - 3;

        const isActive = this._rpm !== null && this._rpm > 0;
        const [ar, ag, ab] = isActive
            ? parseHexColor(this._accentColor)
            : parseHexColor('#64748b');

        // Outer shroud ring
        cr.setLineWidth(2.2);
        cr.setSourceRGBA(ar, ag, ab, isActive ? 0.85 : 0.40);
        cr.arc(cx, cy, r, 0, Math.PI * 2.0);
        cr.stroke();

        // Draw 4 symmetrical fan blades rotated by this._angleRad
        cr.save();
        cr.translate(cx, cy);
        cr.rotate(this._angleRad);

        const bladeCount = 4;
        for (let i = 0; i < bladeCount; i++) {
            cr.rotate((Math.PI * 2.0) / bladeCount);
            cr.beginPath();
            cr.moveTo(0, -3);
            cr.curveTo(r * 0.45, -r * 0.78, r * 0.82, -r * 0.32, r * 0.62, r * 0.12);
            cr.curveTo(r * 0.35, r * 0.18, r * 0.15, 0, 0, 0);
            cr.closePath();
            cr.setSourceRGBA(ar, ag, ab, isActive ? 0.78 : 0.32);
            cr.fill();
        }

        // Hub cap
        cr.arc(0, 0, r * 0.22, 0, Math.PI * 2.0);
        cr.setSourceRGBA(0.08, 0.11, 0.18, 0.95);
        cr.fill();
        cr.setLineWidth(1.5);
        cr.setSourceRGBA(ar, ag, ab, isActive ? 0.95 : 0.5);
        cr.arc(0, 0, r * 0.22, 0, Math.PI * 2.0);
        cr.stroke();

        cr.restore();
        cr.$dispose();
    }

    _stopTimer() {
        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = 0;
        }
    }

    destroy() {
        this._stopTimer();
        if (this._repaintId) {
            this.disconnect(this._repaintId);
            this._repaintId = 0;
        }
        super.destroy();
    }
});
