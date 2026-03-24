import Color from '../js/Color.js';

export function installDebugTextures(scene) {
    if (!scene || !window.Debug) return;

    // Wave: shift columns up/down by a sine wave, wrapping vertically
    window.Debug.createSignal('wave', (wavelength = 8, height = 2, axis = 'y', phase = 0) => {
        try {
            const sheet = scene.currentSprite;
            const anim = scene.selectedAnimation;
            const frameIdx = scene.selectedFrame;
            if (!sheet) return false;
            const frame = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, frameIdx) : null;
            if (!frame) return false;
            const w = frame.width, h = frame.height;
            if (!w || !h) return false;

            const ctx = frame.getContext('2d');
            let img;
            try { img = ctx.getImageData(0, 0, w, h); } catch (e) { return false; }
            const src = img.data;
            const dest = new Uint8ClampedArray(src.length);

            const wl = Math.max(1, Number(wavelength) || 1);
            const ht = Number(height) || 0;
            const ph = Number(phase) || 0;
            const twoPI = Math.PI * 2;

            if (String(axis || 'y').toLowerCase() === 'y') {
                for (let x = 0; x < w; x++) {
                    const shift = Math.round(Math.sin((twoPI * x) / wl + ph) * ht);
                    for (let y = 0; y < h; y++) {
                        const srcY = ((y - shift) % h + h) % h;
                        const sIdx = (srcY * w + x) * 4;
                        const dIdx = (y * w + x) * 4;
                        dest[dIdx] = src[sIdx]; dest[dIdx + 1] = src[sIdx + 1]; dest[dIdx + 2] = src[sIdx + 2]; dest[dIdx + 3] = src[sIdx + 3];
                    }
                }
            } else {
                // horizontal wave: shift rows left/right wrapping on x
                for (let y = 0; y < h; y++) {
                    const shift = Math.round(Math.sin((twoPI * y) / wl + ph) * ht);
                    for (let x = 0; x < w; x++) {
                        const srcX = ((x - shift) % w + w) % w;
                        const sIdx = (y * w + srcX) * 4;
                        const dIdx = (y * w + x) * 4;
                        dest[dIdx] = src[sIdx]; dest[dIdx + 1] = src[sIdx + 1]; dest[dIdx + 2] = src[sIdx + 2]; dest[dIdx + 3] = src[sIdx + 3];
                    }
                }
            }

            // Build change list only where pixels differ
            const changes = [];
            for (let i = 0, p = 0; i < dest.length; i += 4, p++) {
                if (src[i] === dest[i] && src[i+1] === dest[i+1] && src[i+2] === dest[i+2] && src[i+3] === dest[i+3]) continue;
                const x = p % w;
                const y = Math.floor(p / w);
                const hex = scene.rgbaToHex(dest[i], dest[i+1], dest[i+2], dest[i+3]);
                changes.push({ x, y, color: hex, blendType: 'replace' });
            }

            if (!changes.length) return true;
            // Use sheet API so multiplayer/undo hooks (wrapped) run
            try { sheet.modifyFrame(anim, frameIdx, changes); } catch (e) {
                // fallback per-pixel
                for (const c of changes) try { sheet.setPixel(anim, frameIdx, c.x, c.y, c.color, 'replace'); } catch (er) {}
            }
            try { if (sheet._rebuildSheetCanvas) sheet._rebuildSheetCanvas(); } catch (e) {}
            return true;
        } catch (err) {
            try { window.Debug && window.Debug.error && window.Debug.error('wave signal failed: ' + err); } catch (e) {}
            return false;
        }
    });

    // Posterize: quantize colors into discrete steps (pixel-art aware)
    window.Debug.createSignal('posterize', (steps = 3) => {
        try {
            steps = Math.max(2, Math.floor(Number(steps) || 3));
            const sheet = scene.currentSprite;
            const anim = scene.selectedAnimation;
            const frameIdx = scene.selectedFrame;
            if (!sheet) return false;
            const frame = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, frameIdx) : null;
            if (!frame) return false;
            const w = frame.width, h = frame.height;
            const ctx = frame.getContext('2d');
            let img; try { img = ctx.getImageData(0, 0, w, h); } catch (e) { return false; }
            const data = img.data;
            const changes = [];
            const stepDiv = (steps - 1) || 1;
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const idx = (y * w + x) * 4;
                    const a = data[idx+3];
                    if (a === 0) continue; // preserve full transparency
                    const r = data[idx], g = data[idx+1], b = data[idx+2];
                    const rq = Math.round((r / 255) * stepDiv) / stepDiv * 255;
                    const gq = Math.round((g / 255) * stepDiv) / stepDiv * 255;
                    const bq = Math.round((b / 255) * stepDiv) / stepDiv * 255;
                    if (Math.round(rq) === r && Math.round(gq) === g && Math.round(bq) === b) continue;
                    const hex = scene.rgbaToHex(Math.round(rq), Math.round(gq), Math.round(bq), a);
                    changes.push({ x, y, color: hex, blendType: 'replace' });
                }
            }
            if (!changes.length) return true;
            try { sheet.modifyFrame(anim, frameIdx, changes); } catch (e) { for (const c of changes) try { sheet.setPixel(anim, frameIdx, c.x, c.y, c.color, 'replace'); } catch (er) {} }
            try { if (sheet._rebuildSheetCanvas) sheet._rebuildSheetCanvas(); } catch (e) {}
            return true;
        } catch (err) { try { window.Debug && window.Debug.error && window.Debug.error('posterize failed: ' + err); } catch (e) {} return false; }
    });

    // Striped: create stepped stripes interpolating between two colors
    window.Debug.createSignal('striped', (steps = 3, start = '#000000', end = '#FFFFFFFF', orientation = 'vertical') => {
        try {
            steps = Math.max(2, Math.floor(Number(steps) || 3));
            const sheet = scene.currentSprite;
            const anim = scene.selectedAnimation;
            const frameIdx = scene.selectedFrame;
            if (!sheet) return false;
            const frame = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, frameIdx) : null;
            if (!frame) return false;
            const w = frame.width, h = frame.height;
            const ctx = frame.getContext('2d');
            let img; try { img = ctx.getImageData(0, 0, w, h); } catch (e) { return false; }
            const data = img.data;

            const startInfo = (function() { try { return Color.convertColor(start).toRgb(); } catch (e) { return { a:0,b:0,c:0,d:1 }; } })();
            const endInfo = (function() { try { return Color.convertColor(end).toRgb(); } catch (e) { return { a:255,b:255,c:255,d:1 }; } })();

            const changes = [];
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const t = (String(orientation || 'vertical').toLowerCase() === 'vertical') ? (x / Math.max(1, w - 1)) : (y / Math.max(1, h - 1));
                    let stepIdx = Math.floor(t * steps);
                    if (stepIdx >= steps) stepIdx = steps - 1;
                    const tStep = stepIdx / Math.max(1, steps - 1);
                    const r = Math.round(startInfo.a + (endInfo.a - startInfo.a) * tStep);
                    const g = Math.round(startInfo.b + (endInfo.b - startInfo.b) * tStep);
                    const b = Math.round(startInfo.c + (endInfo.c - startInfo.c) * tStep);
                    const a = Math.round(((startInfo.d === undefined ? 1 : startInfo.d) + ((endInfo.d === undefined ? 1 : endInfo.d) - (startInfo.d === undefined ? 1 : startInfo.d)) * tStep) * 255);
                    const idx = (y * w + x) * 4;
                    if (data[idx] === r && data[idx+1] === g && data[idx+2] === b && data[idx+3] === a) continue;
                    const hex = scene.rgbaToHex(r, g, b, a);
                    changes.push({ x, y, color: hex, blendType: 'replace' });
                }
            }
            if (!changes.length) return true;
            try { sheet.modifyFrame(anim, frameIdx, changes); } catch (e) { for (const c of changes) try { sheet.setPixel(anim, frameIdx, c.x, c.y, c.color, 'replace'); } catch (er) {} }
            try { if (sheet._rebuildSheetCanvas) sheet._rebuildSheetCanvas(); } catch (e) {}
            return true;
        } catch (err) { try { window.Debug && window.Debug.error && window.Debug.error('striped failed: ' + err); } catch (e) {} return false; }
    });
}

export default installDebugTextures;
