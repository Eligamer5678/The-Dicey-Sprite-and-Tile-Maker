// Slot-based SFX helper for Dicey Sprite + Tile Maker.
// Maps editor actions to one-or-more audio file variants under a `sounds/` folder.
//
// Usage:
//   import SoundManager from './js/SoundManager.js';
//   import { createSFX } from './js/SFX.js';
//   const soundGuy = new SoundManager();
//   const sfx = createSFX(soundGuy, { baseUrl: './sounds' });
//   await sfx.preload();
//   sfx.play('pixel.place');

function pad2(n) {
    return String(n).padStart(2, '0');
}

function unique(arr) {
    return Array.from(new Set(arr));
}

function clamp01(v) {
    if (typeof v !== 'number' || Number.isNaN(v)) return 1;
    return Math.max(0, Math.min(1, v));
}

function pickRandom(arr) {
    return arr[(Math.random() * arr.length) | 0];
}

function numberedVariants(prefix, count, { exts = ['wav', 'mp3'], pad = true, unpadded = true } = {}) {
    const out = [];
    const max = Math.max(0, Number(count) || 0);
    for (let i = 1; i <= max; i++) {
        for (const ext of exts) {
            if (unpadded) out.push(`${prefix}_${i}.${ext}`);
            if (pad) out.push(`${prefix}_${pad2(i)}.${ext}`);
        }
    }
    return unique(out);
}

// Slot -> array of relative file paths (under baseUrl)
const SLOT_FILES = Object.freeze({
    // Pixel paint (keep only the actual available file)
    'pixel.place': ['pixel_place_1.mp3'],
    'pixel.remove': ['pixel_place_1.mp3'],

    // Tile paint
    'tile.place': ['pixel_place_1.mp3'],
    'tile.remove': ['pixel_place_1.mp3'],

    // Mode toggles
    'tilemode.on': [''],
    'tilemode.off': [''],
    'toggle.pixelPerfect': [''],
    'toggle.autotile': [''],
    'toggle.onionSkin': [''],

    // Clipboard
    'clipboard.copy': [''],
    // Use camera shutter for cut (this one exists); leave paste empty
    'clipboard.cut': ['universfield-camera-shutter-199580.mp3'],
    'clipboard.paste': [''],
    'clipboard.rotate': [''],
    'clipboard.flip': [''],
    'clipboard.erase': [''],

    // Transforms
    'tile.rotate': [''],
    'tile.flip': [''],

    // Tools
    'fill.pixel': [''],
    'fill.tile': [''],

    // Selection
    'select.pixel': [''],
    'select.tile': [''],
    'select.clear': [''],

    // Color / channels
    'color.adjust': [''],
    'color.channel': [''],
    'color.combine': [''],

    // Brush + history
    'brush.size': [''],
    'history.undo': [''],
    'history.redo': [''],

    // Frames
    'frame.select': [''],
    'frame.merge': [''],
    'frame.move': [''],
    'frame.duplicate': [''],
    'frame.delete': [''],
});

// Optional per-slot cooldown to prevent spam when a key repeats or a tool triggers every tick.
const SLOT_COOLDOWN_MS = Object.freeze({
    'fill.pixel': 180,
    'fill.tile': 180,
    'select.pixel': 120,
    'select.tile': 120,
    'brush.size': 60,
});

export class SFX {
    constructor(soundGuy, { baseUrl = './sounds', enabled = true, masterVolume = 1, warnOnMissing = true } = {}) {
        this.soundGuy = soundGuy;
        this.baseUrl = String(baseUrl || './sounds').replace(/\/+$/, '');
        this.enabled = enabled;
        this.masterVolume = masterVolume;
        this.warnOnMissing = warnOnMissing !== false;

        this._slotToNames = new Map(); // slot -> [loadedSoundName]
        this._lastPlay = new Map(); // slot -> timestamp
        this._warnedMissing = new Set(); // slot
    }

    setEnabled(enabled) {
        this.enabled = !!enabled;
    }

    setMasterVolume(v) {
        this.masterVolume = Math.max(0, Number(v) || 0);
    }

    getSlots() {
        return Object.keys(SLOT_FILES);
    }

    // Debug helper: see what actually loaded after preload().
    getLoadedNames(slot) {
        const names = this._slotToNames.get(slot);
        return Array.isArray(names) ? names.slice() : [];
    }

    async preload() {
        if (!this.soundGuy || typeof this.soundGuy.loadSound !== 'function') {
            console.warn('SFX preload skipped: no SoundManager');
            return;
        }

        const slots = Object.keys(SLOT_FILES);
        for (const slot of slots) {
            const relFiles = SLOT_FILES[slot] || [];
            const loadedNames = [];
            for (let i = 0; i < relFiles.length; i++) {
                const rel = relFiles[i];
                if (!rel || typeof rel !== 'string' || rel.trim() === '') continue;
                const url = `${this.baseUrl}/${rel}`;
                const soundName = `${slot}__${i}`;
                try {
                    // eslint-disable-next-line no-await-in-loop
                    await this.soundGuy.loadSound(soundName, url);
                    loadedNames.push(soundName);
                } catch (e) {
                    // Missing audio files shouldn't break the editor.
                    console.warn(`SFX load failed for ${slot}: ${url}`, e);
                }
            }
            if (loadedNames.length > 0) this._slotToNames.set(slot, loadedNames);
        }
    }

    play(slot, { volume = 1, loop = false } = {}) {
        if (!this.enabled) return null;
        if (!this.soundGuy || typeof this.soundGuy.play !== 'function') return null;

        const names = this._slotToNames.get(slot);
        if (!names || names.length === 0) {
            // If the configured slot files are empty or only contain empty entries,
            // silently ignore (developer explicitly left slot empty).
            const configured = (SLOT_FILES[slot] || []).filter(f => typeof f === 'string' && f.trim() !== '');
            if (configured.length === 0) return null;
            if (this.warnOnMissing && !this._warnedMissing.has(slot)) {
                this._warnedMissing.add(slot);
                const files = configured;
                console.warn(`SFX slot not loaded: ${slot}. Expected one of:`, files);
            }
            return null;
        }

        const now = performance.now ? performance.now() : Date.now();
        const cooldown = SLOT_COOLDOWN_MS[slot] || 0;
        if (cooldown > 0) {
            const last = this._lastPlay.get(slot) || 0;
            if (now - last < cooldown) return null;
            this._lastPlay.set(slot, now);
        }

        const name = names.length === 1 ? names[0] : pickRandom(names);
        const v = clamp01(volume) * Math.max(0, Number(this.masterVolume) || 0);

        // Best effort resume for browsers that require a user gesture.
        // If the context is suspended, schedule playback after resume.
        try {
            const ctx = this.soundGuy.audioCtx;
            const needsResume = ctx && typeof ctx.state === 'string' && ctx.state !== 'running';
            if (needsResume && typeof this.soundGuy.resume === 'function') {
                const p = this.soundGuy.resume();
                if (p && typeof p.then === 'function') {
                    p.then(() => {
                        try { this.soundGuy.play(name, v, loop); } catch (e) { /* ignore */ }
                    }).catch(() => { /* ignore */ });
                    return null;
                }
            } else if (typeof this.soundGuy.resume === 'function') {
                // Fire-and-forget even when already running.
                this.soundGuy.resume();
            }
        } catch (e) {
            /* ignore */
        }
        return this.soundGuy.play(name, v, loop);
    }
}

export function createSFX(soundGuy, opts) {
    return new SFX(soundGuy, opts);
}

export const SFX_SLOTS = Object.freeze(Object.keys(SLOT_FILES));
