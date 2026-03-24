export default class AutoTileGenerator {
    constructor(scene) {
        this.scene = scene;
        this.loaded = false;
        this.map = null;
        this.keys = null;
        this._load();
    }

    async _load() {
        try {
            const res = await fetch('tiles.json');
            if (!res || !res.ok) throw new Error('fetch failed');
            const obj = await res.json();
            if (!obj || typeof obj !== 'object') throw new Error('invalid tiles.json');
            this.map = obj;
            this.keys = Object.keys(this.map || {});
            this.loaded = true;
            try {
                // mirror into scene for backwards compatibility
                if (this.scene) {
                    this.scene._availableTileConn = this.map;
                    this.scene._availableTileKeys = this.keys.slice();
                }
            } catch (e) {}
        } catch (e) {
            this.loaded = false;
            this.map = null;
            this.keys = null;
        }
    }

    _normalizeKey(k) {
        try {
            const s = String(k || '0000000000').replace(/[^01]/g, '').padEnd(10, '0').slice(0, 10);
            return s;
        } catch (e) { return '0000000000'; }
    }

    // Return the canonical first-47 key set (ordered) if available, otherwise null
    getFirst47() {
        if (!this.loaded || !Array.isArray(this.keys)) return null;
        // use ordering from tiles.json as supplied
        const out = this.keys.slice(0, 47).map(k => this._normalizeKey(k));
        return out;
    }

    // keys for single-source generation: first 47 but skip the base none key
    getKeysForSingleSource() {
        const first47 = this.getFirst47();
        if (!first47) return null;
        return first47.filter(k => k !== this._normalizeKey('0000000000'));
    }

    // keys for two-source generation: same as single but flip the 9th char (index 8) to '1'
    getKeysForTwoSource() {
        const base = this.getKeysForSingleSource();
        if (!base) return null;
        return base.map(k => {
            if (typeof k !== 'string' || k.length < 10) return this._normalizeKey(k);
            const arr = k.split('');
            // set the 9th bit (index 8) to '1'
            arr[8] = '1';
            return arr.join('');
        });
    }

    // Generic selector: mode = 'single'|'two'|'first47'
    getKeysForMode(mode = 'single') {
        if (!this.loaded) return null;
        if (mode === 'first47') return this.getFirst47();
        if (mode === 'two') return this.getKeysForTwoSource();
        return this.getKeysForSingleSource();
    }

    renderProceduralConnectionFrame(sourceFrame, openKey, options = {}) {
        // Delegate heavy rendering to a method adapted from spriteScene.
        // Where scene helpers are needed, call back into this.scene.
        options = options || {};
        options.depth = Math.max(0, Number(options.depth) || 0);
        try {
            if (!sourceFrame || typeof sourceFrame.getContext !== 'function') return null;
            const srcCtx = sourceFrame.getContext('2d');
            if (!srcCtx) return null;

            const px = Math.max(1, Number(sourceFrame.width) || Number(this.scene.currentSprite && this.scene.currentSprite.slicePx) || 16);
            const anim = String(options.sourceAnimation || this.scene.selectedAnimation || 'idle');
            const bits = (typeof this.scene._normalizeOpenConnectionKey === 'function' ? this.scene._normalizeOpenConnectionKey(openKey) : String(openKey || '0000000000')).split('').map((b) => b === '1');
            const channel = (typeof options.channel === 'string' ? options.channel : 'h').toLowerCase();
            const colorChannel = (channel === 'h' || channel === 's' || channel === 'v' || channel === 'a') ? channel : 'h';
            const outlineWidth = Math.max(1, Math.min(px, Math.floor(Number(options.outlineWidth) || 2)));
            const cornerRoundness = Math.max(0, Math.min(1, Number(options.cornerRoundness) || 0));
            const falloff = Math.max(0, Math.min(1, Number(options.falloff) || 0));
            const strength = Math.max(0.01, Number(options.strength) || 1);
            const noiseAmount = Math.max(0, Math.min(1, Number(options.noiseAmount) || 0));
            const colorSteps = Math.max(2, Math.min(32, Math.floor(Number(options.colorSteps) || 4)));
            const seed = Math.floor(Number(options.seed) || 1);
            const tone = (Number(options.tone) >= 0) ? 1 : -1;
            const channelMultiplier = (colorChannel === 'h') ? 0.2 : 1.0;
            const baseAdjust = Math.max(0, Number(options.baseAdjust) || 0.05);
            const maxDelta = Math.max(0.0001, baseAdjust * channelMultiplier * strength);

            const useCustomOutline = !!options.useCustomOutline;
            let _customBaseColor = null;
            if (useCustomOutline) {
                try {
                    _customBaseColor = Color.convertColor(String(options.customOutlineHex || '#FFFFFF'));
                } catch (e) {
                    try { _customBaseColor = Color.fromHex('#FFFFFF'); } catch (e2) { _customBaseColor = null; }
                }
            }

            const srcImage = srcCtx.getImageData(0, 0, px, px);
            let _skipMainOutline = false;
            let _usedDepthComposite = false;

            // applyOutlineToImage uses this.scene._noise01 and Color; keep as inner function
            const applyOutlineToImage = (idata, bitsObj, opts = {}) => {
                const origBits = (opts && opts.originalBits) ? opts.originalBits : bitsObj;
                const edgeTopOutside = !!bitsObj[0];
                const edgeRightOutside = !!bitsObj[1];
                const edgeBottomOutside = !!bitsObj[2];
                const edgeLeftOutside = !!bitsObj[3];
                const cornerTLOutside = !!bitsObj[4];
                const cornerTROutside = !!bitsObj[5];
                const cornerBROutside = !!bitsObj[6];
                const cornerBLOutside = !!bitsObj[7];

                const hasOutsideBoundary = (edgeTopOutside || edgeRightOutside || edgeBottomOutside || edgeLeftOutside || cornerTLOutside || cornerTROutside || cornerBROutside || cornerBLOutside);
                if (!hasOutsideBoundary) return;

                const clamp01 = (v) => Math.max(0, Math.min(1, v));
                const stepDiv = Math.max(1, colorSteps - 1);
                const stepUnit = maxDelta / stepDiv;
                const mix = (a, b, t) => (a * (1 - t)) + (b * t);
                const cornerRadius = Math.max(1, Math.round(px * 0.32));
                const radius = Math.max(0.0001, cornerRadius);
                const cornerZone = Math.max(1, Math.floor(cornerRadius));
                const cornerInwardDistance = (dx, dy) => {
                    const squareIn = Math.min(dx, dy);
                    const roundIn = radius - Math.hypot(dx - radius, dy - radius);
                    return mix(squareIn, roundIn, cornerRoundness);
                };
                const applyRoundedCornerAlphaMaskLocal = (x, y, alphaByte) => {
                    if (cornerRoundness <= 0 || alphaByte <= 0) return false;
                    const cornerCutoff = radius * (1 - cornerRoundness);
                    if (edgeTopOutside && edgeLeftOutside && x <= cornerZone && y <= cornerZone) {
                        const dist = Math.hypot(x - radius, y - radius);
                        if (dist - radius > cornerCutoff) return true;
                    }
                    if (edgeTopOutside && edgeRightOutside && (px - 1 - x) <= cornerZone && y <= cornerZone) {
                        const dx = (px - 1 - x);
                        const dist = Math.hypot(dx - radius, y - radius);
                        if (dist - radius > cornerCutoff) return true;
                    }
                    if (edgeBottomOutside && edgeRightOutside && (px - 1 - x) <= cornerZone && (px - 1 - y) <= cornerZone) {
                        const dx = (px - 1 - x);
                        const dy = (px - 1 - y);
                        const dist = Math.hypot(dx - radius, dy - radius);
                        if (dist - radius > cornerCutoff) return true;
                    }
                    if (edgeBottomOutside && edgeLeftOutside && x <= cornerZone && (px - 1 - y) <= cornerZone) {
                        const dy = (px - 1 - y);
                        const dist = Math.hypot(x - radius, dy - radius);
                        if (dist - radius > cornerCutoff) return true;
                    }
                    return false;
                };
                const innerCornerDistance = (dx, dy) => {
                    const sq = Math.max(dx, dy);
                    const rd = Math.hypot(dx, dy);
                    return mix(sq, rd, cornerRoundness);
                };

                for (let y = 0; y < px; y++) {
                    for (let x = 0; x < px; x++) {
                        const i = (y * px + x) * 4;
                        const alpha = idata[i + 3] / 255;
                        if (alpha <= 0) continue;

                        if (applyRoundedCornerAlphaMaskLocal(x, y, idata[i + 3])) {
                            idata[i + 3] = 0;
                            continue;
                        }

                        let nearest = Infinity;
                        if (edgeTopOutside) nearest = Math.min(nearest, y);
                        if (edgeRightOutside) nearest = Math.min(nearest, (px - 1 - x));
                        if (edgeBottomOutside) nearest = Math.min(nearest, (px - 1 - y));
                        if (edgeLeftOutside) nearest = Math.min(nearest, x);

                        if (edgeTopOutside && edgeLeftOutside && x <= cornerZone && y <= cornerZone) {
                            nearest = Math.min(nearest, cornerInwardDistance(x, y));
                        }
                        if (edgeTopOutside && edgeRightOutside && (px - 1 - x) <= cornerZone && y <= cornerZone) {
                            nearest = Math.min(nearest, cornerInwardDistance((px - 1 - x), y));
                        }
                        if (edgeBottomOutside && edgeRightOutside && (px - 1 - x) <= cornerZone && (px - 1 - y) <= cornerZone) {
                            nearest = Math.min(nearest, cornerInwardDistance((px - 1 - x), (px - 1 - y)));
                        }
                        if (edgeBottomOutside && edgeLeftOutside && x <= cornerZone && (px - 1 - y) <= cornerZone) {
                            nearest = Math.min(nearest, cornerInwardDistance(x, (px - 1 - y)));
                        }

                        if (cornerTLOutside && !edgeTopOutside && !edgeLeftOutside) nearest = Math.min(nearest, innerCornerDistance(x, y));
                        if (cornerTROutside && !edgeTopOutside && !edgeRightOutside) nearest = Math.min(nearest, innerCornerDistance((px - 1 - x), y));
                        let cornerRaise = Math.max(0, Math.min(px, Math.round(Number(options.depth) || 0)));
                        try {
                            if (opts && opts.depthComposite) {
                                if (origBits && (origBits[8] || origBits[9])) {
                                } else if (origBits && typeof origBits[8] !== 'undefined' && !origBits[8] && !origBits[9] && Math.round(Number(options.depth) || 0) === 0) {
                                    cornerRaise = Math.max(1, Math.round(px * 0.32));
                                }
                            }
                        } catch (e) {}
                        if (cornerBROutside && !edgeBottomOutside && !edgeRightOutside) {
                            const adjDY = Math.max(0, (px - 1 - y) - cornerRaise);
                            if (origBits && (origBits[8] || origBits[9])) {
                                const adjDY_noRaise = Math.max(0, (px - 1 - y));
                                nearest = Math.min(nearest, innerCornerDistance((px - 1 - x), adjDY_noRaise));
                            } else {
                                nearest = Math.min(nearest, innerCornerDistance((px - 1 - x), adjDY));
                            }
                        }
                        if (cornerBLOutside && !edgeBottomOutside && !edgeLeftOutside) {
                            const adjDY = Math.max(0, (px - 1 - y) - cornerRaise);
                            if (origBits && (origBits[8] || origBits[9])) {
                                const adjDY_noRaise = Math.max(0, (px - 1 - y));
                                nearest = Math.min(nearest, innerCornerDistance(x, adjDY_noRaise));
                            } else {
                                nearest = Math.min(nearest, innerCornerDistance(x, adjDY));
                            }
                        }

                        if (!Number.isFinite(nearest) || nearest > outlineWidth) continue;

                        const t = clamp01(nearest / Math.max(0.0001, outlineWidth));
                        const edgeBlend = Math.pow(1 - t, 1 + (falloff * 4));
                        const noise = ((this.scene._noise01((x * 1.37) + 9, (y * 0.83) + 17, seed + 97) * 2) - 1) * maxDelta * noiseAmount;
                        let delta = (tone * edgeBlend * maxDelta) + noise;
                        delta = Math.round(delta / stepUnit) * stepUnit;

                        if (useCustomOutline && _customBaseColor) {
                            try {
                                const srcRgb = new Color(idata[i], idata[i + 1], idata[i + 2], alpha, 'rgb');
                                const customRgb = (_customBaseColor.type === 'rgb') ? _customBaseColor : _customBaseColor.toRgb();
                                const noiseNorm = (maxDelta > 0) ? (noise / maxDelta) : 0;
                                let mixAmt = edgeBlend + noiseNorm;
                                mixAmt = Math.max(0, Math.min(1, mixAmt));
                                const quantMix = Math.round(mixAmt * stepDiv) / stepDiv;
                                const r = Math.round(mix(srcRgb.a, customRgb.a, quantMix));
                                const g = Math.round(mix(srcRgb.b, customRgb.b, quantMix));
                                const b = Math.round(mix(srcRgb.c, customRgb.c, quantMix));
                                const aMix = mix(srcRgb.d ?? alpha, customRgb.d ?? 1, quantMix);
                                idata[i] = Math.max(0, Math.min(255, r));
                                idata[i + 1] = Math.max(0, Math.min(255, g));
                                idata[i + 2] = Math.max(0, Math.min(255, b));
                                idata[i + 3] = Math.max(0, Math.min(255, Math.round((aMix ?? alpha) * 255)));
                            } catch (e) { }
                            continue;
                        }

                        let c = new Color(idata[i], idata[i + 1], idata[i + 2], alpha, 'rgb').toHsv();
                        if (!c) continue;
                        if (colorChannel === 'h') c.a = ((c.a + delta) % 1 + 1) % 1;
                        if (colorChannel === 's') c.b = clamp01(c.b + delta);
                        if (colorChannel === 'v') c.c = clamp01(c.c + delta);
                        if (colorChannel === 'a') c.d = clamp01(c.d + delta);
                        const rgb = c.toRgb();
                        if (!rgb) continue;
                        idata[i] = Math.max(0, Math.min(255, Math.round(rgb.a)));
                        idata[i + 1] = Math.max(0, Math.min(255, Math.round(rgb.b)));
                        idata[i + 2] = Math.max(0, Math.min(255, Math.round(rgb.c)));
                        idata[i + 3] = Math.max(0, Math.min(255, Math.round((rgb.d ?? alpha) * 255)));
                    }
                }
            };

            const out = document.createElement('canvas');
            out.width = px;
            out.height = px;
            const octx = out.getContext('2d');
            if (!octx) return null;
            const outImage = octx.createImageData(px, px);
            outImage.data.set(srcImage.data);

            const depthPx = Math.max(0, Math.min(px, Math.round(Number(options.depth) || 0)));
            const bottomBoundary = px - depthPx - 1;
            if (depthPx > 0) {
                try {
                    const fs = this.scene.FrameSelect;
                    if (fs && fs._multiSelected && fs._multiSelected.size >= 2) {
                        const multi = Array.from(fs._multiSelected).map(i => Number(i)).filter(Number.isFinite);
                        const topIdx = multi[0];
                        const wallIdx = multi[1];
                        if (typeof this.scene.currentSprite.getFrame === 'function') {
                            const topFrame = this.scene.currentSprite.getFrame(anim, topIdx);
                            const wallFrame = this.scene.currentSprite.getFrame(anim, wallIdx);
                            if (topFrame && wallFrame && topFrame.getContext && wallFrame.getContext) {
                                try {
                                    const seamY = Math.max(0, bottomBoundary);
                                    const tctx = topFrame.getContext('2d');
                                    const wctx = wallFrame.getContext('2d');
                                    const topImg = tctx.getImageData(0, 0, px, px).data;
                                    const wallImg = wctx.getImageData(0, 0, px, px).data;
                                    const odata = outImage.data;
                                    const edgeBottomOutside = !!bits[2];
                                    const cornerBROutside = !!bits[6];
                                    const cornerBLOutside = !!bits[7];
                                    const extraBit8 = !!bits[8];
                                    const extraBit9 = !!bits[9];
                                    const needWall = edgeBottomOutside || extraBit8 || extraBit9;
                                    if (!needWall) {
                                        outImage.data.set(topImg);
                                    } else {
                                        const wallBuf = new Uint8ClampedArray(wallImg);
                                        const topBuf = new Uint8ClampedArray(topImg);
                                        for (let yy = seamY + 1; yy < px; yy++) {
                                            for (let xx = 0; xx < px; xx++) {
                                                const idx = (yy * px + xx) * 4;
                                                topBuf[idx + 3] = 0;
                                            }
                                        }
                                        try {
                                            if (extraBit9) {
                                                for (let yy = 0; yy < px; yy++) {
                                                    for (let xx = 0; xx < px; xx++) {
                                                        const idx = (yy * px + xx) * 4;
                                                        topBuf[idx + 3] = 0;
                                                    }
                                                }
                                            } else if (extraBit8) {
                                                if (depthPx === 0) {
                                                    const maxBand = Math.max(0, Math.round(px * 0.25));
                                                    const band = Math.max(0, Math.round(Math.min(px, maxBand)));
                                                    if (band > 0) {
                                                        const startClear = Math.max(0, seamY - band + 1);
                                                        for (let yy = startClear; yy <= seamY; yy++) {
                                                            for (let xx = 0; xx < px; xx++) {
                                                                const idx = (yy * px + xx) * 4;
                                                                topBuf[idx + 3] = 0;
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        } catch (e) {}

                                        if (cornerRoundness > 0) {
                                            const cornerRadiusLocal = Math.max(1, Math.round(px * 0.32));
                                            const radiusLocal = Math.max(0.0001, cornerRadiusLocal);
                                            const cornerZoneLocal = Math.max(1, Math.floor(cornerRadiusLocal));
                                            const centerY = seamY - Math.max(0, Math.round(radiusLocal)) + 1;
                                            const leftCenterX = Math.max(0, Math.round(radiusLocal));
                                            const rightCenterX = Math.max(0, px - 1 - Math.round(radiusLocal));
                                            for (let yy = Math.max(0, seamY - cornerZoneLocal); yy <= seamY; yy++) {
                                                for (let xx = 0; xx < px; xx++) {
                                                    if (bits[3] && xx <= cornerZoneLocal) {
                                                        const dx = xx - leftCenterX;
                                                        const dy = yy - centerY;
                                                        const dist = Math.hypot(dx, dy);
                                                        if (dist - radiusLocal > cornerCutoff) {
                                                            const idx = (yy * px + xx) * 4;
                                                            topBuf[idx + 3] = 0;
                                                        }
                                                    }
                                                    if (bits[1] && ((px - 1 - xx) <= cornerZoneLocal)) {
                                                        const dx = xx - rightCenterX;
                                                        const dy = yy - centerY;
                                                        const dist = Math.hypot(dx, dy);
                                                        if (dist - radiusLocal > cornerCutoff) {
                                                            const idx = (yy * px + xx) * 4;
                                                            topBuf[idx + 3] = 0;
                                                        }
                                                    }
                                                }
                                            }
                                        }

                                        try { applyOutlineToImage(wallBuf, bits, { originalBits: bits, depthComposite: true }); } catch (e) {}

                                        const topBits = [bits[0], bits[1], true, bits[3], bits[4], bits[5], bits[6], bits[7]];
                                        try { applyOutlineToImage(topBuf, topBits, { originalBits: bits, depthComposite: true }); } catch (e) {}

                                        for (let yy = 0; yy < px; yy++) {
                                            for (let xx = 0; xx < px; xx++) {
                                                const idx = (yy * px + xx) * 4;
                                                const ta = topBuf[idx + 3] / 255;
                                                if (ta <= 0) continue;
                                                wallBuf[idx] = topBuf[idx];
                                                wallBuf[idx + 1] = topBuf[idx + 1];
                                                wallBuf[idx + 2] = topBuf[idx + 2];
                                                wallBuf[idx + 3] = topBuf[idx + 3];
                                            }
                                        }

                                        try {
                                            const seamYLocal = seamY;
                                            const cornerRadiusLocal = Math.max(1, Math.round(px * 0.32));
                                            const radiusLocal = Math.max(0.0001, cornerRadiusLocal);
                                            const cornerZoneLocal = Math.max(1, Math.floor(cornerRadiusLocal));
                                            const centerYLocal = seamYLocal - Math.max(0, Math.round(radiusLocal)) + 1;
                                            const leftCenterX = Math.max(0, Math.round(radiusLocal));
                                            const rightCenterX = Math.max(0, px - 1 - Math.round(radiusLocal));

                                            const clamp01 = (v) => Math.max(0, Math.min(1, v));
                                            const mix = (a, b, t) => (a * (1 - t)) + (b * t);
                                            const stepDivLocal = Math.max(1, colorSteps - 1);
                                            const stepUnitLocal = maxDelta / stepDivLocal;

                                            const seamPerColumn = new Int32Array(px);
                                            for (let xx = 0; xx < px; xx++) {
                                                let lastOpaque = -1;
                                                for (let yy = 0; yy < px; yy++) {
                                                    const idx = (yy * px + xx) * 4;
                                                    if (topBuf[idx + 3] > 0) lastOpaque = yy;
                                                }
                                                seamPerColumn[xx] = lastOpaque;
                                            }

                                            const band = Math.max(1, outlineWidth);
                                            for (let xx = 0; xx < px; xx++) {
                                                const seamX = seamPerColumn[xx];
                                                if (seamX < 0) continue;
                                                for (let yy = Math.max(0, seamX - band); yy <= Math.min(px - 1, seamX + band); yy++) {
                                                    const yDist = Math.abs(yy - seamX);
                                                    const t = clamp01(yDist / Math.max(0.0001, band));
                                                    const edgeBlend = Math.pow(1 - t, 1 + (falloff * 4));

                                                    let cornerFall = 1.0;
                                                    if (cornerRoundness > 0) {
                                                        if (xx <= cornerZoneLocal && bits[3]) {
                                                            const dx = xx - leftCenterX;
                                                            const dy = yy - centerYLocal;
                                                            const dist = Math.hypot(dx, dy);
                                                            const cutoff = radiusLocal - band;
                                                            if (dist > cutoff) cornerFall = Math.max(0, 1 - ((dist - cutoff) / Math.max(1, band)));
                                                        } else if ((px - 1 - xx) <= cornerZoneLocal && bits[1]) {
                                                            const dx = xx - rightCenterX;
                                                            const dy = yy - centerYLocal;
                                                            const dist = Math.hypot(dx, dy);
                                                            const cutoff = radiusLocal - band;
                                                            if (dist > cutoff) cornerFall = Math.max(0, 1 - ((dist - cutoff) / Math.max(1, band)));
                                                        }
                                                    }

                                                    const idx = (yy * px + xx) * 4;
                                                    const a = wallBuf[idx + 3] / 255;
                                                    if (a <= 0) continue;

                                                    const noise = ((this.scene._noise01((xx * 1.37) + 9, (yy * 0.83) + 17, seed + 97) * 2) - 1) * maxDelta * noiseAmount;
                                                    let delta = (tone * edgeBlend * maxDelta) + noise;
                                                    delta = Math.round(delta / stepUnitLocal) * stepUnitLocal;

                                                    if (useCustomOutline && _customBaseColor) {
                                                        try {
                                                            const srcRgb = new Color(wallBuf[idx], wallBuf[idx + 1], wallBuf[idx + 2], a, 'rgb');
                                                            const customRgb = (_customBaseColor.type === 'rgb') ? _customBaseColor : _customBaseColor.toRgb();
                                                            const noiseNorm = (maxDelta > 0) ? (noise / maxDelta) : 0;
                                                            let mixAmt = edgeBlend + noiseNorm;
                                                            mixAmt = Math.max(0, Math.min(1, mixAmt)) * cornerFall;
                                                            const quantMix = Math.round(mixAmt * stepDivLocal) / stepDivLocal;
                                                            const r = Math.round(mix(srcRgb.a, customRgb.a, quantMix));
                                                            const g = Math.round(mix(srcRgb.b, customRgb.b, quantMix));
                                                            const b = Math.round(mix(srcRgb.c, customRgb.c, quantMix));
                                                            const aMix = mix(srcRgb.d ?? a, customRgb.d ?? 1, quantMix);
                                                            wallBuf[idx] = Math.max(0, Math.min(255, r));
                                                            wallBuf[idx + 1] = Math.max(0, Math.min(255, g));
                                                            wallBuf[idx + 2] = Math.max(0, Math.min(255, b));
                                                            wallBuf[idx + 3] = Math.max(0, Math.min(255, Math.round((aMix ?? a) * 255)));
                                                        } catch (e) { }
                                                        continue;
                                                    }

                                                    let c = new Color(wallBuf[idx], wallBuf[idx + 1], wallBuf[idx + 2], a, 'rgb').toHsv();
                                                    if (!c) continue;
                                                    if (colorChannel === 'h') c.a = ((c.a + delta) % 1 + 1) % 1;
                                                    if (colorChannel === 's') c.b = clamp01(c.b + delta);
                                                    if (colorChannel === 'v') c.c = clamp01(c.c + delta);
                                                    if (colorChannel === 'a') c.d = clamp01(c.d + delta);
                                                    const rgb = c.toRgb();
                                                    if (!rgb) continue;
                                                    wallBuf[idx] = Math.max(0, Math.min(255, Math.round(rgb.a)));
                                                    wallBuf[idx + 1] = Math.max(0, Math.min(255, Math.round(rgb.b)));
                                                    wallBuf[idx + 2] = Math.max(0, Math.min(255, Math.round(rgb.c)));
                                                    wallBuf[idx + 3] = Math.max(0, Math.min(255, Math.round((rgb.d ?? a) * 255)));
                                                }
                                            }
                                        } catch (e) {}

                                        outImage.data.set(wallBuf);
                                        _skipMainOutline = true;
                                        _usedDepthComposite = true;
                                    }
                                } catch (e) {}
                            }
                        }
                    } else {
                        const fs2 = this.scene.FrameSelect;
                        if (fs2 && fs2._multiSelected && fs2._multiSelected.size > 0) {
                            const multi2 = Array.from(fs2._multiSelected).map(i => Number(i)).filter(Number.isFinite);
                            const srcIdxOpt = (typeof options.sourceFrame !== 'undefined' && options.sourceFrame !== null) ? Number(options.sourceFrame) : null;
                            let ledgeIdx = null;
                            for (const m of multi2) {
                                if (srcIdxOpt !== null && Number.isFinite(srcIdxOpt) && m === srcIdxOpt) continue;
                                ledgeIdx = m; break;
                            }
                            if (ledgeIdx === null && multi2.length > 0) ledgeIdx = multi2[0];
                            if (ledgeIdx !== null && typeof this.scene.currentSprite.getFrame === 'function') {
                                const ledgeFrame = this.scene.currentSprite.getFrame(anim, ledgeIdx);
                                if (ledgeFrame && ledgeFrame.getContext) {
                                    try {
                                        const lctx = ledgeFrame.getContext('2d');
                                        const ledgeImg = lctx.getImageData(0, 0, px, px);
                                        const ldata = ledgeImg.data;
                                        const odata = outImage.data;
                                        const startY = Math.max(0, bottomBoundary + 1);
                                        for (let yy = startY; yy < px; yy++) {
                                            for (let xx = 0; xx < px; xx++) {
                                                const idx = (yy * px + xx) * 4;
                                                odata[idx] = ldata[idx];
                                                odata[idx + 1] = ldata[idx + 1];
                                                odata[idx + 2] = ldata[idx + 2];
                                                odata[idx + 3] = ldata[idx + 3];
                                            }
                                        }
                                    } catch (e) {}
                                }
                            }
                        }
                    }
                } catch (e) {}
            }

            const edgeTopOutside = bits[0];
            const edgeRightOutside = bits[1];
            const edgeBottomOutside = bits[2];
            const edgeLeftOutside = bits[3];
            const cornerTLOutside = bits[4];
            const cornerTROutside = bits[5];
            const cornerBROutside = bits[6];
            const cornerBLOutside = bits[7];

            const hasOutsideBoundary = (edgeTopOutside || edgeRightOutside || edgeBottomOutside || edgeLeftOutside || cornerTLOutside || cornerTROutside || cornerBROutside || cornerBLOutside);
            if (!hasOutsideBoundary) {
                octx.putImageData(outImage, 0, 0);
                return out;
            }

            try { if (_skipMainOutline) { octx.putImageData(outImage, 0, 0); return out; } } catch (e) {}

            const clamp01 = (v) => Math.max(0, Math.min(1, v));
            const stepDiv = Math.max(1, colorSteps - 1);
            const stepUnit = maxDelta / stepDiv;
            const mix = (a, b, t) => (a * (1 - t)) + (b * t);
            const cornerRadius = Math.max(1, Math.round(px * 0.32));
            const radius = Math.max(0.0001, cornerRadius);
            const cornerZone = Math.max(1, Math.floor(cornerRadius));
            const cornerInwardDistance = (dx, dy) => {
                const squareIn = Math.min(dx, dy);
                const roundIn = radius - Math.hypot(dx - radius, dy - radius);
                return mix(squareIn, roundIn, cornerRoundness);
            };
            const applyRoundedCornerAlphaMask = (x, y, alphaByte) => {
                if (cornerRoundness <= 0 || alphaByte <= 0) return false;
                const cornerCutoff = radius * (1 - cornerRoundness);
                if (edgeTopOutside && edgeLeftOutside && x <= cornerZone && y <= cornerZone) {
                    const dist = Math.hypot(x - radius, y - radius);
                    if (dist - radius > cornerCutoff) return true;
                }
                if (edgeTopOutside && edgeRightOutside && (px - 1 - x) <= cornerZone && y <= cornerZone) {
                    const dx = (px - 1 - x);
                    const dist = Math.hypot(dx - radius, y - radius);
                    if (dist - radius > cornerCutoff) return true;
                }
                if (edgeBottomOutside && edgeRightOutside && (px - 1 - x) <= cornerZone && (px - 1 - y) <= cornerZone) {
                    const dx = (px - 1 - x);
                    const dy = (px - 1 - y);
                    const dist = Math.hypot(dx - radius, dy - radius);
                    if (dist - radius > cornerCutoff) return true;
                }
                if (edgeBottomOutside && edgeLeftOutside && x <= cornerZone && (px - 1 - y) <= cornerZone) {
                    const dy = (px - 1 - y);
                    const dist = Math.hypot(x - radius, dy - radius);
                    if (dist - radius > cornerCutoff) return true;
                }
                return false;
            };
            const innerCornerDistance = (dx, dy) => {
                const sq = Math.max(dx, dy);
                const rd = Math.hypot(dx, dy);
                return mix(sq, rd, cornerRoundness);
            };

            for (let y = 0; y < px; y++) {
                for (let x = 0; x < px; x++) {
                    const i = (y * px + x) * 4;
                    const alpha = outImage.data[i + 3] / 255;
                    if (alpha <= 0) continue;

                    if (applyRoundedCornerAlphaMask(x, y, outImage.data[i + 3])) {
                        outImage.data[i + 3] = 0;
                        continue;
                    }

                    let nearest = Infinity;
                    if (edgeTopOutside) nearest = Math.min(nearest, y);
                    if (edgeRightOutside) nearest = Math.min(nearest, (px - 1 - x));
                    if (edgeBottomOutside) nearest = Math.min(nearest, (px - 1 - y));
                    if (edgeLeftOutside) nearest = Math.min(nearest, x);

                    if (edgeTopOutside && edgeLeftOutside && x <= cornerZone && y <= cornerZone) {
                        nearest = Math.min(nearest, cornerInwardDistance(x, y));
                    }
                    if (edgeTopOutside && edgeRightOutside && (px - 1 - x) <= cornerZone && y <= cornerZone) {
                        nearest = Math.min(nearest, cornerInwardDistance((px - 1 - x), y));
                    }
                    if (edgeBottomOutside && edgeRightOutside && (px - 1 - x) <= cornerZone && (px - 1 - y) <= cornerZone) {
                        nearest = Math.min(nearest, cornerInwardDistance((px - 1 - x), (px - 1 - y)));
                    }
                    if (edgeBottomOutside && edgeLeftOutside && x <= cornerZone && (px - 1 - y) <= cornerZone) {
                        nearest = Math.min(nearest, cornerInwardDistance(x, (px - 1 - y)));
                    }

                    if (cornerTLOutside && !edgeTopOutside && !edgeLeftOutside) nearest = Math.min(nearest, innerCornerDistance(x, y));
                    if (cornerTROutside && !edgeTopOutside && !edgeRightOutside) nearest = Math.min(nearest, innerCornerDistance((px - 1 - x), y));
                        let cornerRaiseLocal = Math.max(0, Math.min(px, Math.round(Number(options.depth) || 0)));
                        try {
                            if (_usedDepthComposite) {
                                if (bits[8] || bits[9]) {
                                } else if (Math.round(Number(options.depth) || 0) === 0) {
                                    cornerRaiseLocal = Math.max(1, Math.round(px * 0.32));
                                }
                            }
                        } catch (e) {}
                        if (cornerBROutside && !edgeBottomOutside && !edgeRightOutside) {
                            const adjDY = Math.max(0, (px - 1 - y) - cornerRaiseLocal);
                            if (bits[8] || bits[9]) {
                                const adjDY_noRaise = Math.max(0, (px - 1 - y));
                                nearest = Math.min(nearest, innerCornerDistance((px - 1 - x), adjDY_noRaise));
                            } else {
                                nearest = Math.min(nearest, innerCornerDistance((px - 1 - x), adjDY));
                            }
                        }
                        if (cornerBLOutside && !edgeBottomOutside && !edgeLeftOutside) {
                            const adjDY = Math.max(0, (px - 1 - y) - cornerRaiseLocal);
                            if (bits[8] || bits[9]) {
                                const adjDY_noRaise = Math.max(0, (px - 1 - y));
                                nearest = Math.min(nearest, innerCornerDistance(x, adjDY_noRaise));
                            } else {
                                nearest = Math.min(nearest, innerCornerDistance(x, adjDY));
                            }
                        }

                    if (!Number.isFinite(nearest) || nearest > outlineWidth) continue;

                    const t = clamp01(nearest / Math.max(0.0001, outlineWidth));
                    const edgeBlend = Math.pow(1 - t, 1 + (falloff * 4));
                    const noise = ((this.scene._noise01((x * 1.37) + 9, (y * 0.83) + 17, seed + 97) * 2) - 1) * maxDelta * noiseAmount;
                    let delta = (tone * edgeBlend * maxDelta) + noise;
                    delta = Math.round(delta / stepUnit) * stepUnit;

                    if (useCustomOutline && _customBaseColor) {
                        try {
                            const srcRgb = new Color(outImage.data[i], outImage.data[i + 1], outImage.data[i + 2], alpha, 'rgb');
                            const customRgb = (_customBaseColor.type === 'rgb') ? _customBaseColor : _customBaseColor.toRgb();
                            const noiseNorm = (maxDelta > 0) ? (noise / maxDelta) : 0;
                            let mixAmt = edgeBlend + noiseNorm;
                            mixAmt = Math.max(0, Math.min(1, mixAmt));
                            const quantMix = Math.round(mixAmt * stepDiv) / stepDiv;
                            const r = Math.round(mix(srcRgb.a, customRgb.a, quantMix));
                            const g = Math.round(mix(srcRgb.b, customRgb.b, quantMix));
                            const b = Math.round(mix(srcRgb.c, customRgb.c, quantMix));
                            const aMix = mix(srcRgb.d ?? alpha, customRgb.d ?? 1, quantMix);
                            outImage.data[i] = Math.max(0, Math.min(255, r));
                            outImage.data[i + 1] = Math.max(0, Math.min(255, g));
                            outImage.data[i + 2] = Math.max(0, Math.min(255, b));
                            outImage.data[i + 3] = Math.max(0, Math.min(255, Math.round((aMix ?? alpha) * 255)));
                        } catch (e) {
                            continue;
                        }
                        continue;
                    }

                    let c = new Color(outImage.data[i], outImage.data[i + 1], outImage.data[i + 2], alpha, 'rgb').toHsv();
                    if (!c) continue;

                    if (colorChannel === 'h') c.a = ((c.a + delta) % 1 + 1) % 1;
                    if (colorChannel === 's') c.b = clamp01(c.b + delta);
                    if (colorChannel === 'v') c.c = clamp01(c.c + delta);
                    if (colorChannel === 'a') c.d = clamp01(c.d + delta);

                    const rgb = c.toRgb();
                    if (!rgb) continue;

                    outImage.data[i] = Math.max(0, Math.min(255, Math.round(rgb.a)));
                    outImage.data[i + 1] = Math.max(0, Math.min(255, Math.round(rgb.b)));
                    outImage.data[i + 2] = Math.max(0, Math.min(255, Math.round(rgb.c)));
                    outImage.data[i + 3] = Math.max(0, Math.min(255, Math.round((rgb.d ?? alpha) * 255)));
                }
            }

            octx.putImageData(outImage, 0, 0);
            return out;
        } catch (e) {
            return null;
        }
    }

    async runProceduralAutotileGeneration(settings = {}) {
        // Ported from spriteScene; uses this.scene for helpers/state
        try {
            try { this.scene._lastGenerationDepth = Math.max(0, Number(settings.depth) || 0); } catch (e) { this.scene._lastGenerationDepth = 0; }
            const anim = String(settings.sourceAnimation || this.scene.selectedAnimation || 'idle');
            const sourceFrameIndex = Number.isFinite(Number(settings.sourceFrame)) ? (Number(settings.sourceFrame) | 0) : (Number(this.scene.selectedFrame) | 0);
            const sheet = this.scene.currentSprite;
            if (!sheet || typeof sheet.getFrame !== 'function' || typeof sheet.insertFrame !== 'function') {
                return { ok: false, reason: 'Sprite sheet is not ready.' };
            }

            const sourceFrame = sheet.getFrame(anim, sourceFrameIndex);
            if (!sourceFrame) return { ok: false, reason: 'Select a source tile frame first.' };

            if (!this.scene._tileConnMap || typeof this.scene._tileConnMap !== 'object') this.scene._tileConnMap = {};

            if (!this.loaded) return { ok: false, reason: 'tiles.json not available' };
            const fsCheck = this.scene.FrameSelect;
            const multiCount = (fsCheck && fsCheck._multiSelected) ? Array.from(fsCheck._multiSelected).length : 0;
            let keys = null;
            if (settings && settings.legacy47) {
                keys = this.getKeysForMode('single');
            } else {
                keys = (multiCount > 1) ? this.getKeysForMode('two') : this.getKeysForMode('single');
            }
            if (!Array.isArray(keys) || keys.length === 0) return { ok: false, reason: 'No connection keys available (tiles.json missing or empty).' };
            keys = Array.from(new Set((keys || []).map(k => (typeof this.scene._normalizeOpenConnectionKey === 'function' ? this.scene._normalizeOpenConnectionKey(k || '0000000000') : String(k || '0000000000')))));
            if (!Array.isArray(keys) || keys.length === 0) return { ok: false, reason: 'No connection keys available.' };

            const existingByConnKey = new Map();
            const initialLogicalCount = Math.max(0, Number(this.scene._getAnimationLogicalFrameCount(anim)) || 0);
            for (let i = 0; i < initialLogicalCount; i++) {
                const raw = this.scene._tileConnMap[anim + '::' + i];
                if (typeof raw !== 'string') continue;
                const norm = (typeof this.scene._normalizeOpenConnectionKey === 'function') ? this.scene._normalizeOpenConnectionKey(raw) : String(raw);
                if (!existingByConnKey.has(norm)) existingByConnKey.set(norm, i);
            }

            let created = 0, updated = 0, skipped = 0;
            const replaceExisting = (typeof settings.replaceExisting === 'boolean') ? !!settings.replaceExisting : true;
            let nextInsertIndex = initialLogicalCount;

            for (const rawKey of keys) {
                const key = (typeof this.scene._normalizeOpenConnectionKey === 'function') ? this.scene._normalizeOpenConnectionKey(rawKey) : String(rawKey);
                let existingIndex = null;
                if (existingByConnKey.has(key)) existingIndex = existingByConnKey.get(key);
                try {
                    const fsC = this.scene.FrameSelect;
                    if (fsC && fsC._multiSelected && fsC._multiSelected.size > 0 && existingIndex !== null) {
                        const sel = Array.from(fsC._multiSelected).map(i => Number(i)).filter(Number.isFinite);
                        if (sel.includes(existingIndex)) existingIndex = null;
                    }
                } catch (e) {}
                if (existingIndex !== null && !replaceExisting) { skipped++; continue; }

                const rendered = this.renderProceduralConnectionFrame(sourceFrame, key, settings);
                if (!rendered) { skipped++; continue; }

                let dstIndex = existingIndex;
                if (dstIndex === null) {
                    dstIndex = nextInsertIndex;
                    nextInsertIndex++;
                    sheet.insertFrame(anim);
                    created++;
                } else updated++;

                const dstFrame = sheet.getFrame(anim, dstIndex);
                const dctx = dstFrame && dstFrame.getContext ? dstFrame.getContext('2d') : null;
                if (!dctx) { skipped++; continue; }
                try {
                    const rw = rendered.width || dstFrame.width;
                    const rh = rendered.height || dstFrame.height;
                    const rctx = (rendered && rendered.getContext) ? rendered.getContext('2d') : null;
                    let imgData = null;
                    try { if (rctx) imgData = rctx.getImageData(0, 0, rw, rh); } catch (e) { imgData = null; }
                    if (imgData && imgData.data && imgData.data.length >= 4) {
                        const pixels = [];
                        const data = imgData.data;
                        const w = Math.max(1, Math.min(dstFrame.width, rw));
                        const h = Math.max(1, Math.min(dstFrame.height, rh));
                        for (let py = 0; py < h; py++) {
                            for (let px = 0; px < w; px++) {
                                const idx = (py * rw + px) * 4;
                                const r = data[idx] | 0;
                                const g = data[idx + 1] | 0;
                                const b = data[idx + 2] | 0;
                                const a = data[idx + 3] | 0;
                                const toHex = (v) => (v < 16 ? '0' : '') + v.toString(16).toUpperCase();
                                const hex = '#' + toHex(r) + toHex(g) + toHex(b) + toHex(a);
                                pixels.push({ x: px, y: py, color: hex, blendType: 'replace' });
                            }
                        }
                        try { this.scene.currentSprite.drawPixels(anim, dstIndex, pixels); } catch (e) {
                            dctx.clearRect(0, 0, dstFrame.width, dstFrame.height);
                            dctx.drawImage(rendered, 0, 0, dstFrame.width, dstFrame.height);
                        }
                    } else {
                        dctx.clearRect(0, 0, dstFrame.width, dstFrame.height);
                        dctx.drawImage(rendered, 0, 0, dstFrame.width, dstFrame.height);
                    }
                    try { this.scene._setTileConnection(anim, dstIndex, key, false); } catch (e) { this.scene._tileConnMap[anim + '::' + dstIndex] = key; }
                    try { existingByConnKey.set(key, dstIndex); } catch (e) {}
                    try { this.scene._sendFrameDataForFrame(anim, dstIndex, dstFrame); } catch (e) {}
                } catch (e) {
                    try { dctx.clearRect(0, 0, dstFrame.width, dstFrame.height); dctx.drawImage(rendered, 0, 0, dstFrame.width, dstFrame.height); } catch (er) {}
                    try { this.scene._setTileConnection(anim, dstIndex, key, false); } catch (er) { this.scene._tileConnMap[anim + '::' + dstIndex] = key; }
                    try { existingByConnKey.set(key, dstIndex); } catch (er) {}
                    try { this.scene._sendFrameDataForFrame(anim, dstIndex, dstFrame); } catch (e) {}
                }
            }

            try { if (typeof sheet._rebuildSheetCanvas === 'function') sheet._rebuildSheetCanvas(); } catch (e) {}
            try { if (sheet && typeof sheet.ensurePackedSheet === 'function') sheet.ensurePackedSheet(); } catch (e) {}
            try { if (this.scene.FrameSelect && typeof this.scene.FrameSelect.rebuild === 'function') this.scene.FrameSelect.rebuild(); } catch (e) {}
            try { if (sheet && typeof sheet._materializeAnimation === 'function') sheet._materializeAnimation(String(settings.sourceAnimation || this.scene.selectedAnimation || 'idle')); } catch (e) {}

            try {
                const targetSet = new Set((keys || []).map(k => (typeof this.scene._normalizeOpenConnectionKey === 'function' ? this.scene._normalizeOpenConnectionKey(k || '0000000000') : String(k || '0000000000'))));
                const dupLogicalIndices = [];
                const seenKey = new Map();
                let currentLogicalCount = Math.max(1, Number(this.scene._getAnimationLogicalFrameCount(anim)) || 1);
                for (let i = 0; i < currentLogicalCount; i++) {
                    const raw = this.scene._tileConnMap[anim + '::' + i];
                    if (typeof raw !== 'string') continue;
                    const norm = (typeof this.scene._normalizeOpenConnectionKey === 'function') ? this.scene._normalizeOpenConnectionKey(raw) : String(raw);
                    if (!targetSet.has(norm)) continue;
                    if (!seenKey.has(norm)) seenKey.set(norm, i);
                    else dupLogicalIndices.push(i);
                }

                const shiftConnMapAfterPop = (removedIdx, countBefore) => {
                    for (let j = removedIdx; j < countBefore - 1; j++) {
                        const nextKey = this.scene._tileConnMap[anim + '::' + (j + 1)];
                        if (typeof nextKey === 'string') this.scene._tileConnMap[anim + '::' + j] = nextKey;
                        else delete this.scene._tileConnMap[anim + '::' + j];
                    }
                    delete this.scene._tileConnMap[anim + '::' + (countBefore - 1)];
                };

                dupLogicalIndices.sort((a, b) => b - a);
                for (const idx of dupLogicalIndices) {
                    const before = Math.max(1, Number(this.scene._getAnimationLogicalFrameCount(anim)) || 1);
                    if (idx < 0 || idx >= before) continue;
                    try { sheet.popFrame(anim, idx); shiftConnMapAfterPop(idx, before); } catch (e) {}
                }
            } catch (e) {}

            return { ok: true, created, updated, skipped, total: keys.length };
        } catch (e) {
            return { ok: false, reason: String((e && e.message) || e || 'Unknown error') };
        }
    }

    runProceduralAutotileGenerationForSelectedFrames(settings = {}) {
        try {
            const frameSelect = this.scene.FrameSelect;
            const selected = Array.from((frameSelect && frameSelect._multiSelected) || []).filter(i => Number.isFinite(i)).map(i => Number(i) | 0).sort((a, b) => a - b);
            if (selected.length < 2) return { ok: false, reason: 'Select 2 frames first: source and target.' };

            const anim = String(this.scene.selectedAnimation || 'idle');
            const sheet = this.scene.currentSprite;
            if (!sheet || typeof sheet.getFrame !== 'function' || typeof sheet.insertFrame !== 'function') return { ok: false, reason: 'Sprite sheet is not ready.' };

            const srcIdx = Number.isFinite(Number(settings.sourceFrame)) ? (Number(settings.sourceFrame) | 0) : (Number(this.scene.selectedFrame) | 0);
            const otherIdx = selected.find(i => i !== srcIdx) || selected[0];
            const fromFrame = sheet.getFrame(anim, srcIdx);
            const toFrame = sheet.getFrame(anim, otherIdx);
            if (!fromFrame || !toFrame) return { ok: false, reason: 'Could not read one or more selected frames.' };

            const defs = [
                { mode: 'top', key: '1000110000', useConnFrames: false, mirrorVariant: false, perpendicularSplit: false },
                { mode: 'right', key: '0100011000', useConnFrames: false, mirrorVariant: false, perpendicularSplit: false },
                { mode: 'bottom', key: '0010001100', useConnFrames: false, mirrorVariant: false, perpendicularSplit: false },
                { mode: 'left', key: '0001100100', useConnFrames: false, mirrorVariant: false, perpendicularSplit: false },
                { mode: 'top', key: '1000110100', sourceKey: '1000110000', useConnFrames: false, mirrorVariant: false, perpendicularSplit: true },
                { mode: 'top', key: '1000111000', sourceKey: '1000110000', useConnFrames: false, mirrorVariant: true, perpendicularSplit: true },
                { mode: 'right', key: '0100011100', sourceKey: '0100011000', useConnFrames: false, mirrorVariant: false, perpendicularSplit: true },
                { mode: 'right', key: '0100111000', sourceKey: '0100011000', useConnFrames: false, mirrorVariant: true, perpendicularSplit: true },
                { mode: 'bottom', key: '0010011100', sourceKey: '0010001100', useConnFrames: false, mirrorVariant: false, perpendicularSplit: true },
                { mode: 'bottom', key: '0010101100', sourceKey: '0010001100', useConnFrames: false, mirrorVariant: true, perpendicularSplit: true },
                { mode: 'left', key: '0001110100', sourceKey: '0001100100', useConnFrames: false, mirrorVariant: false, perpendicularSplit: true },
                { mode: 'left', key: '0001101100', sourceKey: '0001100100', useConnFrames: false, mirrorVariant: true, perpendicularSplit: true },
                { mode: 'corner-tl', key: '0000100000', sourceKey: '0000100000', useConnFrames: false, mirrorVariant: false, perpendicularSplit: false, cornerDominant: 'from' },
                { mode: 'corner-tr', key: '0000010000', sourceKey: '0000010000', useConnFrames: false, mirrorVariant: false, perpendicularSplit: false, cornerDominant: 'from' },
                { mode: 'corner-br', key: '0000000100', sourceKey: '0000000100', useConnFrames: false, mirrorVariant: false, perpendicularSplit: false, cornerDominant: 'from' },
                { mode: 'corner-bl', key: '0000001000', sourceKey: '0000001000', useConnFrames: false, mirrorVariant: false, perpendicularSplit: false, cornerDominant: 'from' },
                { mode: 'corner-tl', key: '0000100000', sourceKey: '0000100000', useConnFrames: false, mirrorVariant: false, perpendicularSplit: false, cornerDominant: 'to' },
                { mode: 'corner-tr', key: '0000010000', sourceKey: '0000010000', useConnFrames: false, mirrorVariant: false, perpendicularSplit: false, cornerDominant: 'to' },
                { mode: 'corner-br', key: '0000000100', sourceKey: '0000000100', useConnFrames: false, mirrorVariant: false, perpendicularSplit: false, cornerDominant: 'to' },
                { mode: 'corner-bl', key: '0000001000', sourceKey: '0000001000', useConnFrames: false, mirrorVariant: false, perpendicularSplit: false, cornerDominant: 'to' }
            ];

            let created = 0;
            let dstIndex = 0;
            const outAnim = `${anim}-sel-${srcIdx}-to-${otherIdx}`;

            for (const def of defs) {
                const rendered = (typeof this.scene._renderTransitionBlendFrame === 'function') ? this.scene._renderTransitionBlendFrame(fromFrame, toFrame, def.mode, { ...settings, mirrorVariant: !!def.mirrorVariant, perpendicularSplit: !!def.perpendicularSplit, cornerDominant: def.cornerDominant || 'from' }) : null;
                if (!rendered) continue;
                if (this.scene._getAnimationLogicalFrameCountExact(outAnim) === 0) {
                    sheet.insertFrame(outAnim);
                } else {
                    sheet.insertFrame(outAnim);
                }
                const dstFrame = sheet.getFrame(outAnim, dstIndex);
                const dctx = dstFrame && dstFrame.getContext ? dstFrame.getContext('2d') : null;
                if (!dctx) { dstIndex++; continue; }
                dctx.clearRect(0, 0, dstFrame.width, dstFrame.height);
                dctx.drawImage(rendered, 0, 0, dstFrame.width, dstFrame.height);
                try { this.scene._setTileConnection(outAnim, dstIndex, def.key || '0000000000', false); } catch (e) { this.scene._tileConnMap[outAnim + '::' + dstIndex] = (typeof this.scene._normalizeOpenConnectionKey === 'function') ? this.scene._normalizeOpenConnectionKey(def.key) : def.key; }
                created++; dstIndex++;
            }

            try { if (typeof sheet._rebuildSheetCanvas === 'function') sheet._rebuildSheetCanvas(); } catch (e) {}
            try { if (sheet && typeof sheet.ensurePackedSheet === 'function') sheet.ensurePackedSheet(); } catch (e) {}
            try { if (this.scene.FrameSelect && typeof this.scene.FrameSelect.rebuild === 'function') this.scene.FrameSelect.rebuild(); } catch (e) {}
            try { if (sheet && typeof sheet._materializeAnimation === 'function') sheet._materializeAnimation(outAnim); } catch (e) {}
            if (created > 0) {
                try { if (this.scene.stateController && typeof this.scene.stateController.setActiveFrame === 'function') this.scene.stateController.setActiveFrame(0); else this.scene.selectedFrame = 0; } catch (e) {}
                return { ok: true, created, total: defs.length, outAnim };
            }
            return { ok: false, reason: 'No transition tiles were generated.' };
        } catch (e) {
            return { ok: false, reason: String((e && e.message) || e || 'Unknown error') };
        }
    }

    generateMissingConnectionFramesFromTemplates(widthPx = 2) {
        try {
            const frameSelect = this.scene.FrameSelect;
            const selected = Array.from((frameSelect && frameSelect._multiSelected) || []).filter(i => Number.isFinite(i)).map(i => Number(i) | 0).sort((a, b) => a - b);
            if (selected.length < 3) return { ok: false, reason: 'Select 3 template frames first: all connectors, none, and 4 corners.' };

            const anim = String(this.scene.selectedAnimation || 'idle');
            const keyForFrame = (idx) => {
                const raw = (this.scene._tileConnMap && this.scene._tileConnMap[anim + '::' + idx]) || '0000000000';
                return (typeof this.scene._normalizeOpenConnectionKey === 'function') ? this.scene._normalizeOpenConnectionKey(raw) : raw;
            };

            const allKey = (typeof this.scene._normalizeOpenConnectionKey === 'function') ? this.scene._normalizeOpenConnectionKey('1111111100') : '1111111100';
            const noneKey = (typeof this.scene._normalizeOpenConnectionKey === 'function') ? this.scene._normalizeOpenConnectionKey('0000000000') : '0000000000';
            const cornersKey = (typeof this.scene._normalizeOpenConnectionKey === 'function') ? this.scene._normalizeOpenConnectionKey('0000111100') : '0000111100';

            const allFrameIdx = selected.find(i => keyForFrame(i) === allKey);
            const noneFrameIdx = selected.find(i => keyForFrame(i) === noneKey);
            const cornersFrameIdx = selected.find(i => keyForFrame(i) === cornersKey);
            if (allFrameIdx === undefined || noneFrameIdx === undefined || cornersFrameIdx === undefined) return { ok: false, reason: 'Multi-select must include frames tagged as 1111111100, 0000000000, and 0000111100.' };

            const sheet = this.scene.currentSprite;
            if (!sheet || typeof sheet.getFrame !== 'function' || typeof sheet.insertFrame !== 'function') return { ok: false, reason: 'Sprite sheet is not ready.' };

            const frameAll = sheet.getFrame(anim, allFrameIdx);
            const frameNone = sheet.getFrame(anim, noneFrameIdx);
            const frameCorners = sheet.getFrame(anim, cornersFrameIdx);
            if (!frameAll || !frameNone || !frameCorners) return { ok: false, reason: 'Could not read one or more selected template frames.' };

            const px = Math.max(1, Number(sheet.slicePx) || Number(frameNone.width) || 16);
            const edgeW = Math.max(1, Math.min(px, Math.floor(Number(widthPx) || 1)));

            if (!this.scene._tileConnMap || typeof this.scene._tileConnMap !== 'object') this.scene._tileConnMap = {};

            const existing = new Set();
            const logicalCount = Math.max(1, Number(this.scene._getAnimationLogicalFrameCount(anim)) || 1);
            for (let i = 0; i < logicalCount; i++) {
                const raw = this.scene._tileConnMap[anim + '::' + i];
                if (typeof raw !== 'string') continue;
                existing.add((typeof this.scene._normalizeOpenConnectionKey === 'function') ? this.scene._normalizeOpenConnectionKey(raw) : raw);
            }

            let targetKeys = (Array.isArray(this.keys) && this.keys.length > 0) ? this.keys.slice() : (typeof this.scene._getAllValidOpenConnectionKeys === 'function' ? this.scene._getAllValidOpenConnectionKeys() : []);
            targetKeys = Array.from(new Set((targetKeys || []).map(k => (typeof this.scene._normalizeOpenConnectionKey === 'function') ? this.scene._normalizeOpenConnectionKey(k || '0000000000') : String(k || '0000000000'))));
            const srcAreas = {
                top: [0, 0, px, edgeW],
                right: [px - edgeW, 0, edgeW, px],
                bottom: [0, px - edgeW, px, edgeW],
                left: [0, 0, edgeW, px],
                tl: [0, 0, edgeW, edgeW],
                tr: [px - edgeW, 0, edgeW, edgeW],
                br: [px - edgeW, px - edgeW, edgeW, edgeW],
                bl: [0, px - edgeW, edgeW, edgeW]
            };

            const copyRect = (dstCtx, srcCanvas, rect) => {
                const [sx, sy, sw, sh] = rect;
                dstCtx.drawImage(srcCanvas, sx, sy, sw, sh, sx, sy, sw, sh);
            };

            // Minimal placeholder behavior for now
            return { ok: true, created: 0, skipped: 0, total: targetKeys.length };
        } catch (e) {
            return { ok: false, reason: String((e && e.message) || e || 'Unknown error') };
        }
    }
}
