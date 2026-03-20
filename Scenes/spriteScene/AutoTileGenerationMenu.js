import Vector from '../../js/Vector.js';
import Menu from '../../js/UI/Menu.js';
import UISlider from '../../js/UI/Slider.js';
import UIButton from '../../js/UI/Button.js';
import UITextInput from '../../js/UI/UITextInput.js';

export default class AutoTileGenerationMenu {
    constructor(scene, mouse, keys, UIDraw, layer = 70) {
        this.scene = scene;
        this.mouse = mouse;
        this.keys = keys;
        this.UIDraw = UIDraw;
        this.layer = layer;

        this.visible = false;
        this._sourceFrame = null;
        this._sourceAnimation = null;

        this.menu = new Menu(this.mouse, this.keys, new Vector(170, 54), new Vector(844, 538), this.layer, '#10151EEB');
        this.menu.visible = false;

        this.layout = {
            titleY: 26,
            sliderStartY: 96,
            sliderRowH: 44,
            sliderLabelX: 28,
            sliderValueX: 360,
            sliderX: 374,
            sliderW: 292,
            sliderH: 22,
            controlsPanelWidth: 680,
            adjustY: 430,
            buttonY: 468,
            statusY: 516,
            previewX: 694,
            previewY: 42,
            previewTile: 108,
            previewGapY: 10,
        };

        this.settings = {
            outlineWidth: 2,
            cornerRoundness: 0.45,
            falloff: 0.35,
            strength: 1.6,
            noiseAmount: 0.35,
            colorSteps: 5,
            seed: 1,
            tone: -1,
            replaceExisting: true,
            useCustomOutline: false,
            customOutlineHex: '#00FF00',
            depth: 0,
        };

        this._status = '';
        this._statusColor = '#CFE8FFFF';
        this._statusUntil = 0;

        this._previewDefs = [
            { key: '11111111' },
            { key: '00000000' },
            { key: '10001100' },
            { corners: ['00001000', '00000100', '00000001', '00000010'] },
        ];

        this._sliderDefs = [
            { id: 'outlineWidth', label: 'Outline Width', min: 1, max: 10, step: 1, integer: true },
            { id: 'cornerRoundness', label: 'Corner Roundness', min: 0, max: 1, step: 0.01 },
            { id: 'falloff', label: 'Edge Falloff', min: 0, max: 1, step: 0.01 },
            { id: 'strength', label: 'Outline Strength', min: 0.1, max: 4, step: 0.05 },
            { id: 'noiseAmount', label: 'Noise (N-style)', min: 0, max: 1, step: 0.01 },
            { id: 'colorSteps', label: 'Step Count', min: 2, max: 12, step: 1, integer: true },
            { id: 'seed', label: 'Seed', min: 1, max: 999, step: 1, integer: true },
            { id: 'depth', label: 'Depth (px)', min: 0, max: 16, step: 1, integer: true },
        ];

        this._sliders = [];
        this._previewCache = new Map();
        this._previewSignature = '';

        this._buildUI();
    }

    _hasTwoTileTypesSelected() {
        try {
            // Use FrameSelect's multi-selection: if there is at least one
            // additional selected frame, treat it as a second tile type.
            const fs = this.scene && this.scene.FrameSelect;
            if (!fs) return false;
            const multi = Array.from(fs._multiSelected || []);
            return multi.length > 0;
        } catch (e) {
            return false;
        }
    }

    _updateDepthSliderVisibility() {
        const show = !!this._hasTwoTileTypesSelected();
        for (const entry of this._sliders) {
            if (entry.def && entry.def.id === 'depth') {
                entry.slider.visible = show;
            }
        }
    }

    _reflowMenuSize() {
        const startY = this.layout.sliderStartY;
        const rowH = this.layout.sliderRowH;
        const visibleCount = this._sliders.reduce((acc, e) => acc + (e.slider && e.slider.visible ? 1 : 0), 0);
        const neededControlsY = startY + Math.max(visibleCount, 1) * rowH + 8;
        const minHeight = neededControlsY + 200;
        if (!this.menu.size) this.menu.size = new Vector(this.menu.size.x || 844, minHeight);
        if (this.menu.size.y < minHeight) this.menu.size.y = minHeight;

        // Shift action controls downward to make room for visible sliders
        const controlsY = neededControlsY;
        const sliderX = this.layout.sliderX;
        // move custom controls
        try {
            if (this.customHexInput && typeof this.customHexInput.pos !== 'undefined') {
                this.customHexInput.pos = new Vector(sliderX, controlsY);
            }
            if (this.useCustomButton && typeof this.useCustomButton.pos !== 'undefined') {
                this.useCustomButton.pos = new Vector(sliderX + 176, controlsY);
            }
        } catch (e) {}

        // update layout-driven Y positions for buttons/status so draw uses updated coords
        this.layout.adjustY = controlsY + 48;
        this.layout.buttonY = this.layout.adjustY + 36;
        this.layout.statusY = this.layout.buttonY + 56;

        // move primary buttons to updated positions
        try {
            if (this.generateButton) this.generateButton.pos = new Vector(28, this.layout.buttonY);
            if (this.replaceButton) this.replaceButton.pos = new Vector(184, this.layout.buttonY);
            if (this.toneButton) this.toneButton.pos = new Vector(340, this.layout.buttonY);
            if (this.closeButton) this.closeButton.pos = new Vector(496, this.layout.buttonY);
        } catch (e) {}
    }

    _buildUI() {
        const sliderX = this.layout.sliderX;
        const sliderW = this.layout.sliderW;
        const sliderH = this.layout.sliderH;
        const rowH = this.layout.sliderRowH;
        const startY = this.layout.sliderStartY;

        for (let i = 0; i < this._sliderDefs.length; i++) {
            const def = this._sliderDefs[i];
            const y = startY + i * rowH;
            const slider = new UISlider(
                this.mouse,
                this.keys,
                new Vector(sliderX, y),
                new Vector(sliderW, sliderH),
                this.layer + 2,
                'scalar',
                Number(this.settings[def.id]),
                Number(def.min),
                Number(def.max),
                '#273042FF',
                '#344057FF',
                '#1F2738FF',
                '#A9B8D8FF'
            );
            slider.onChange.connect((value) => {
                let next = Number(value);
                if (!Number.isFinite(next)) return;
                if (def.integer) next = Math.round(next);
                if (!def.integer && Number.isFinite(def.step) && def.step > 0) {
                    const inv = 1 / def.step;
                    next = Math.round(next * inv) / inv;
                }
                next = Math.max(def.min, Math.min(def.max, next));
                slider.value = next;
                this.settings[def.id] = next;
            });
            this.menu.addElement('slider:' + def.id, slider);
            this._sliders.push({ def, slider, y });
        }

        // Evaluate depth slider visibility now that sliders exist
        if (typeof this._updateDepthSliderVisibility === 'function') this._updateDepthSliderVisibility();

        // Custom outline color input + toggle (below visible sliders)
        const visibleSliderCountForLayout = this._sliders.reduce((acc, e) => acc + (e.slider && e.slider.visible ? 1 : 0), 0);
        const controlsY = startY + visibleSliderCountForLayout * rowH + 8;
        this.customHexInput = new UITextInput(this.mouse, this.keys, new Vector(sliderX, controlsY), new Vector(160, 32), this.layer + 3, String(this.settings.customOutlineHex || '#00FF00'), '#HEX');
        this.customHexInput.onChange.connect((txt) => {
            this.settings.customOutlineHex = String(txt || '').trim() || '#00FF00';
        });
        this.customHexInput.onSubmit.connect((txt) => {
            this.settings.customOutlineHex = String(txt || '').trim() || '#00FF00';
        });
        this.menu.addElement('input:customOutlineHex', this.customHexInput);

        this.useCustomButton = new UIButton(this.mouse, this.keys, new Vector(sliderX + 176, controlsY), new Vector(120, 32), this.layer + 3, null, '#3B3B3BFF', '#4A4A4AFF', '#222222FF');
        this.useCustomButton.trigger = true;
        this.useCustomButton.triggered = !!this.settings.useCustomOutline;
        this.useCustomButton.onTrigger.connect((triggered) => {
            this.settings.useCustomOutline = !!triggered;
            if (triggered) {
                this.useCustomButton.baseColor = '#2E3547FF';
                this.useCustomButton.hoverColor = '#404A65FF';
                this.useCustomButton.pressedColor = '#1F2533FF';
            } else {
                this.useCustomButton.baseColor = '#3B3B3BFF';
                this.useCustomButton.hoverColor = '#4A4A4AFF';
                this.useCustomButton.pressedColor = '#222222FF';
            }
        });
        if (this.settings.useCustomOutline) {
            this.useCustomButton.baseColor = '#2E3547FF';
            this.useCustomButton.hoverColor = '#404A65FF';
            this.useCustomButton.pressedColor = '#1F2533FF';
        }
        this.menu.addElement('btn:useCustomOutline', this.useCustomButton);

        this.generateButton = new UIButton(this.mouse, this.keys, new Vector(28, this.layout.buttonY), new Vector(146, 42), this.layer + 3, null, '#2B5A36FF', '#367244FF', '#1E4228FF');
        this.generateButton.onPressed['left'].connect(() => this._runGeneration());

        this.replaceButton = new UIButton(this.mouse, this.keys, new Vector(184, this.layout.buttonY), new Vector(146, 42), this.layer + 3, null, '#3B2D34FF', '#56414AFF', '#2B2026FF');
        this.replaceButton.trigger = true;
        this.replaceButton.triggered = !!this.settings.replaceExisting;
        this.replaceButton.onTrigger.connect((triggered) => {
            this.settings.replaceExisting = !!triggered;
            if (triggered) {
                this.replaceButton.baseColor = '#2E3547FF';
                this.replaceButton.hoverColor = '#404A65FF';
                this.replaceButton.pressedColor = '#1F2533FF';
            } else {
                this.replaceButton.baseColor = '#3B2D34FF';
                this.replaceButton.hoverColor = '#56414AFF';
                this.replaceButton.pressedColor = '#2B2026FF';
            }
        });
        // Apply initial toggle color state.
        if (this.settings.replaceExisting) {
            this.replaceButton.baseColor = '#2E3547FF';
            this.replaceButton.hoverColor = '#404A65FF';
            this.replaceButton.pressedColor = '#1F2533FF';
        }

        this.toneButton = new UIButton(this.mouse, this.keys, new Vector(340, this.layout.buttonY), new Vector(146, 42), this.layer + 3, null, '#3A3248FF', '#4A3F5DFF', '#2B2438FF');
        this.toneButton.trigger = true;
        this.toneButton.triggered = this.settings.tone > 0;
        this.toneButton.onTrigger.connect((triggered) => {
            this.settings.tone = triggered ? 1 : -1;
        });

        this.closeButton = new UIButton(this.mouse, this.keys, new Vector(496, this.layout.buttonY), new Vector(146, 42), this.layer + 3, null, '#4A2F35FF', '#5E3A42FF', '#351F24FF');
        this.closeButton.onPressed['left'].connect(() => this.close());

        this.menu.addElement('btn:generate', this.generateButton);
        this.menu.addElement('btn:replace', this.replaceButton);
        this.menu.addElement('btn:tone', this.toneButton);
        this.menu.addElement('btn:close', this.closeButton);
    }

    isOpen() {
        return !!this.visible;
    }

    open(context = {}) {
        this.visible = true;
        this.menu.visible = true;
        const frame = Number(context.sourceFrame);
        const anim = context.sourceAnimation;
        this._sourceFrame = Number.isFinite(frame) ? frame : null;
        this._sourceAnimation = (typeof anim === 'string' && anim) ? anim : null;
        try {
            if (this.keys && typeof this.keys.pause === 'function') this.keys.pause(0.12);
            if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause(0.12);
        } catch (e) {}
        // Update depth slider visibility on open
        if (typeof this._updateDepthSliderVisibility === 'function') this._updateDepthSliderVisibility();
        if (typeof this._reflowMenuSize === 'function') this._reflowMenuSize();
    }

    close() {
        this.visible = false;
        this.menu.visible = false;
        try {
            if (this.keys && typeof this.keys.pause === 'function') this.keys.pause(0.08);
            if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause(0.08);
        } catch (e) {}
    }

    update(delta) {
        if (!this.visible) return;
        this.menu.update(delta);
        // ensure depth slider visibility follows scene selection changes
        if (typeof this._updateDepthSliderVisibility === 'function') this._updateDepthSliderVisibility();
        if (typeof this._reflowMenuSize === 'function') this._reflowMenuSize();
        if (this.keys && (this.keys.released('Escape') || this.keys.released('Esc'))) {
            this.close();
            return;
        }
        if (this.keys && this.keys.released('Enter')) this._runGeneration();
    }

    draw(UIDraw) {
        if (!this.visible) return;
        this.menu.draw(UIDraw);

        const base = this.menu.pos;
        const dividerX = this.layout.controlsPanelWidth;
        UIDraw.rect(base.add(new Vector(dividerX, 18)), new Vector(2, this.menu.size.y - 36), '#2A3549FF', true);

        UIDraw.text('47-Tile Outline Generator', base.add(new Vector(28, this.layout.titleY)), '#E8F0FFFF', 0, 30, { align: 'left', baseline: 'top', font: 'monospace' });
        UIDraw.text('Base adjust %', base.add(new Vector(28, this.layout.adjustY)), '#89C6DEFF', 0, 18, { align: 'left', baseline: 'top', font: 'monospace' });

        // Draw only visible sliders (Depth may be hidden)
        for (const entry of this._sliders) {
            if (!entry.slider || entry.slider.visible === false) continue;
            const labelPos = base.add(new Vector(this.layout.sliderLabelX, entry.y + 2));
            const valuePos = base.add(new Vector(this.layout.sliderValueX, entry.y + 2));
            const value = this._formatValue(entry.def, this.settings[entry.def.id]);
            UIDraw.text(entry.def.label, labelPos, '#D7DFF2FF', 0, 17, { align: 'left', baseline: 'top', font: 'monospace' });
            UIDraw.text(value, valuePos, '#9FB3DBFF', 0, 17, { align: 'right', baseline: 'top', font: 'monospace' });
        }

        const channel = this._getBrushChannel();
        const adjust = this._getAdjustAmount(channel);
        UIDraw.text(`${Math.round(adjust * 100)}% (${channel.toUpperCase()})`, base.add(new Vector(178, this.layout.adjustY)), '#89C6DEFF', 0, 18, { align: 'left', baseline: 'top', font: 'monospace' });

        // Custom outline hex label (position after visible sliders)
        const visibleSliderCount = this._sliders.reduce((acc, e) => acc + (e.slider && e.slider.visible ? 1 : 0), 0);
        const controlsY = this.layout.sliderStartY + visibleSliderCount * this.layout.sliderRowH + 8;
        UIDraw.text('Outline Hex', base.add(new Vector(this.layout.sliderLabelX, controlsY + 8)), '#D7DFF2FF', 0, 14, { align: 'left', baseline: 'top', font: 'monospace' });

        UIDraw.text('Generate', base.add(new Vector(101, this.layout.buttonY + 22)), '#F2FFF5FF', 0, 17, { align: 'center', baseline: 'middle', font: 'monospace' });
        UIDraw.text('Replace', base.add(new Vector(257, this.layout.buttonY + 22)), '#E6ECFFFF', 0, 17, { align: 'center', baseline: 'middle', font: 'monospace' });
        UIDraw.text(this.settings.tone > 0 ? 'Lighten' : 'Darken', base.add(new Vector(413, this.layout.buttonY + 22)), '#EADFFF', 0, 17, { align: 'center', baseline: 'middle', font: 'monospace' });
        UIDraw.text('Exit', base.add(new Vector(569, this.layout.buttonY + 22)), '#FFECEFFF', 0, 17, { align: 'center', baseline: 'middle', font: 'monospace' });

        this._drawPreviewTiles(UIDraw, base);

        if (this._status && Date.now() <= this._statusUntil) {
            UIDraw.text(this._status, base.add(new Vector(28, this.layout.statusY)), this._statusColor, 0, 16, { align: 'left', baseline: 'top', font: 'monospace' });
        }
    }

    getSettings() {
        const out = {};
        for (const def of this._sliderDefs) {
            const raw = Number(this.settings[def.id]);
            const clamped = Math.max(def.min, Math.min(def.max, Number.isFinite(raw) ? raw : def.min));
            out[def.id] = def.integer ? Math.round(clamped) : clamped;
        }
        out.replaceExisting = !!this.settings.replaceExisting;
        out.tone = this.settings.tone > 0 ? 1 : -1;
        out.channel = this._getBrushChannel();
        out.baseAdjust = this._getAdjustAmount(out.channel);
        out.sourceFrame = this._sourceFrame;
        out.sourceAnimation = this._sourceAnimation;
        out.useCustomOutline = !!this.settings.useCustomOutline;
        out.customOutlineHex = String(this.settings.customOutlineHex || '#00FF00');
        out.depth = Math.max(0, Number(this.settings.depth) || 0);
        return out;
    }

    setStatus(message, isError = false) {
        this._status = String(message || '');
        this._statusColor = isError ? '#FFB3B3FF' : '#BCEEC7FF';
        this._statusUntil = Date.now() + 3600;
    }

    _runGeneration() {
        if (!this.scene || typeof this.scene._runProceduralAutotileGeneration !== 'function') return;
        const result = this.scene._runProceduralAutotileGeneration(this.getSettings());
        if (!result || !result.ok) {
            this.setStatus((result && result.reason) ? result.reason : 'Generation failed.', true);
            return;
        }
        const total = Number(result.total || 47);
        this.setStatus(`47-set done: ${result.created || 0} new, ${result.updated || 0} updated, ${result.skipped || 0} skipped (${total} keys).`, false);
        try { if (this.scene && typeof this.scene._playSfx === 'function') this.scene._playSfx('frame.duplicate'); } catch (e) {}
    }

    _formatValue(def, value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return '-';
        if (def.integer) return String(Math.round(n));
        if (def.max <= 1.001) return n.toFixed(2);
        return n.toFixed(2);
    }

    _getBrushChannel() {
        const ch = this.scene && this.scene.state && this.scene.state.brush && this.scene.state.brush.pixelBrush
            ? this.scene.state.brush.pixelBrush.channel
            : 'h';
        const normalized = String(ch || 'h').toLowerCase();
        if (normalized === 'h' || normalized === 's' || normalized === 'v' || normalized === 'a') return normalized;
        return 'h';
    }

    _getAdjustAmount(channel) {
        try {
            const c = (typeof channel === 'string') ? channel : this._getBrushChannel();
            const src = this.scene && this.scene.state && this.scene.state.brush && this.scene.state.brush.pixelBrush
                ? this.scene.state.brush.pixelBrush.adjustAmount
                : null;
            const n = src ? Number(src[c]) : NaN;
            return Number.isFinite(n) ? n : 0.05;
        } catch (e) {
            return 0.05;
        }
    }

    _getPreviewSourceFrame() {
        try {
            const anim = this._sourceAnimation || this.scene.selectedAnimation || 'idle';
            const frameIdx = Number.isFinite(this._sourceFrame) ? this._sourceFrame : Number(this.scene.selectedFrame || 0);
            if (!this.scene || !this.scene.currentSprite || typeof this.scene.currentSprite.getFrame !== 'function') return null;
            return this.scene.currentSprite.getFrame(anim, frameIdx);
        } catch (e) {
            return null;
        }
    }

    _previewSettingsSignature() {
        return JSON.stringify(this.getSettings());
    }

    _refreshPreviewCache() {
        const signature = this._previewSettingsSignature();
        if (signature === this._previewSignature) return;
        this._previewSignature = signature;
        this._previewCache.clear();

        const sourceFrame = this._getPreviewSourceFrame();
        if (!sourceFrame || !this.scene || typeof this.scene._renderProceduralConnectionFrame !== 'function') return;
        const settings = this.getSettings();
        for (const preview of this._previewDefs) {
            if (preview && typeof preview.key === 'string') {
                try {
                    const canvas = this.scene._renderProceduralConnectionFrame(sourceFrame, preview.key, settings);
                    if (canvas) this._previewCache.set(preview.key, canvas);
                } catch (e) {}
                continue;
            }
            if (preview && Array.isArray(preview.corners)) {
                for (const key of preview.corners) {
                    if (typeof key !== 'string') continue;
                    if (this._previewCache.has(key)) continue;
                    try {
                        const canvas = this.scene._renderProceduralConnectionFrame(sourceFrame, key, settings);
                        if (canvas) this._previewCache.set(key, canvas);
                    } catch (e) {}
                }
            }
        }
    }

    _drawPreviewTiles(UIDraw, base) {
        this._refreshPreviewCache();

        const panelPos = base.add(new Vector(this.layout.previewX, 28));
        const panelSize = new Vector(this.menu.size.x - this.layout.previewX - 14, this.menu.size.y - 56);
        UIDraw.rect(panelPos, panelSize, '#161D2AFF', true);
        UIDraw.rect(panelPos, panelSize, '#34435EFF', false, true, 2, '#34435EFF');

        const tileSize = this.layout.previewTile;
        let y = this.layout.previewY;
        for (const preview of this._previewDefs) {
            const tilePos = base.add(new Vector(this.layout.previewX + 14, y));
            const tileSizeVec = new Vector(tileSize, tileSize);
            UIDraw.rect(tilePos, tileSizeVec, '#0E121AFF', true);
            UIDraw.rect(tilePos, tileSizeVec, '#415474FF', false, true, 2, '#415474FF');

            if (Array.isArray(preview.corners)) {
                const q = Math.floor(tileSize * 0.5);
                const quads = [
                    { key: preview.corners[0], off: new Vector(0, 0) },
                    { key: preview.corners[1], off: new Vector(q, 0) },
                    { key: preview.corners[2], off: new Vector(0, q) },
                    { key: preview.corners[3], off: new Vector(q, q) },
                ];
                for (const quad of quads) {
                    const canvas = this._previewCache.get(quad.key);
                    if (!canvas) continue;
                    UIDraw.image(canvas, tilePos.add(quad.off), new Vector(q, q), null, 0, 1, false);
                }
            } else {
                const canvas = this._previewCache.get(preview.key);
                if (canvas) UIDraw.image(canvas, tilePos, tileSizeVec, null, 0, 1, false);
            }
            y += tileSize + this.layout.previewGapY;
        }
    }
}
