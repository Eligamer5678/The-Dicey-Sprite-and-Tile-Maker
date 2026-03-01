function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export class SpriteSceneStateController {
    constructor(scene) {
        this.scene = scene;
    }

    _set(path, value) {
        return this.scene.modifyState(value, false, false, path);
    }

    _get(path, fallback = undefined, rootObj = null) {
        return this.scene.getState(path, fallback, rootObj);
    }

    setPenColor(hex) {
        const next = (typeof hex === 'string' && hex.trim()) ? hex.trim() : '#000000';
        this._set(['brush', 'pixelBrush', 'colorHex'], next);
        return next;
    }

    setBrushSize(size) {
        const n = clamp(Math.floor(Number(size) || 1), 1, 15);
        this._set(['editor', 'brushSize'], n);
        this._set(['brush', 'size'], n);
        return n;
    }

    setAdjustChannel(channel) {
        const valid = ['h', 's', 'v', 'a'];
        const ch = valid.includes(channel) ? channel : 'v';
        this._set(['brush', 'pixelBrush', 'channel'], ch);
        return ch;
    }

    adjustCurrentChannel(stepDelta) {
        const ch = this._get(['brush', 'pixelBrush', 'channel'], 'v');
        const current = Number(this._get(['brush', 'pixelBrush', 'adjustAmount', ch], 0.05));
        const next = clamp(current + Number(stepDelta || 0), 0, 1);
        this._set(['brush', 'pixelBrush', 'adjustAmount', ch], next);
        this._set(['editor', 'adjustAmount'], next);
        return next;
    }

    setActiveFrame(frameIndex) {
        const n = Math.max(0, Math.floor(Number(frameIndex) || 0));
        this._set(['editor', 'activeFrame'], n);
        return n;
    }

    setActiveAnimation(animationName) {
        const next = (typeof animationName === 'string' && animationName.trim())
            ? animationName.trim()
            : 'idle';
        this._set(['editor', 'activeAnimation'], next);
        return next;
    }

    setActiveSelection(animationName, frameIndex) {
        const anim = this.setActiveAnimation(animationName);
        const frame = this.setActiveFrame(frameIndex);
        return { animation: anim, frame };
    }

    setCurrentTool(toolName) {
        const next = (typeof toolName === 'string' && toolName.trim()) ? toolName.trim() : null;
        this._set(['editor', 'activeTool'], next);
        return next;
    }

    clearCurrentTool() {
        this._set(['editor', 'activeTool'], null);
        return null;
    }

    setSelectionPoints(points) {
        const next = Array.isArray(points) ? points : [];
        this._set(['selection', 'points'], next);
        return next;
    }

    clearSelectionPoints() {
        this._set(['selection', 'points'], []);
        return [];
    }

    setSelectionRegion(region) {
        const next = (region && typeof region === 'object') ? region : null;
        this._set(['selection', 'region'], next);
        return next;
    }

    clearSelectionRegion() {
        this._set(['selection', 'region'], null);
        return null;
    }

    clearPixelSelection() {
        this.clearSelectionPoints();
        this.clearSelectionRegion();
        this.clearCurrentTool();
        return true;
    }

    toggleOnionSkin() {
        const next = !this._get(['editor', 'onionSkin'], false);
        this._set(['editor', 'onionSkin'], next);
        return next;
    }

    setOnionRange(before, after) {
        const b = Math.max(0, Math.abs(Math.floor(Number(before) || 0)));
        const a = Math.max(0, Math.abs(Math.floor(Number(after) || 0)));
        const next = { before: b, after: a };
        this._set(['editor', 'onionRange'], next);
        return next;
    }

    setOnionAlpha(alpha) {
        const next = clamp(Number(alpha || 0), 0, 1);
        this._set(['editor', 'onionAlpha'], next);
        return next;
    }

    setLayerAlpha(alpha) {
        const next = clamp(Number(alpha || 0), 0, 1);
        this._set(['editor', 'layerAlpha'], next);
        return next;
    }

    togglePixelPerfect() {
        const next = !this._get(['editor', 'pixelPerfect'], false);
        this._set(['editor', 'pixelPerfect'], next);
        return next;
    }

    toggleAutotile() {
        const next = !this._get(['editor', 'autotile'], false);
        this._set(['editor', 'autotile'], next);
        return next;
    }

    setPaletteStepMax(stepMax) {
        const next = clamp(Math.floor(Number(stepMax) || 0), 0, 6);
        this._set(['editor', 'paletteStepMax'], next);
        return next;
    }

    setMirror(axis, enabled) {
        const val = !!enabled;
        if (axis === 'h') this._set(['editor', 'mirror', 'h'], val);
        if (axis === 'v') this._set(['editor', 'mirror', 'v'], val);
        return val;
    }

    setTilemode(enabled) {
        const next = !!enabled;
        this._set(['tilemap', 'enabled'], next);
        return next;
    }

    toggleTileMode() {
        const next = !this._get(['tilemap', 'enabled'], false);
        this._set(['tilemap', 'enabled'], next);
        return next;
    }

    toggleTilemode() {
        return this.toggleTileMode();
    }

    setTileGrid(cols, rows, enable = false) {
        const r = Math.max(1, Math.floor(Number(rows) || 1));
        const c = Math.max(1, Math.floor(Number(cols) || 1));
        this._set(['tilemap', 'rows'], r);
        this._set(['tilemap', 'cols'], c);
        if (enable) this._set(['tilemap', 'enabled'], true);
        return { rows: r, cols: c, enabled: !!enable };
    }

    configureTileGrid(rows, cols, enable = true) {
        const r = Math.max(1, Math.floor(Number(rows) || 1));
        const c = Math.max(1, Math.floor(Number(cols) || 1));
        this._set(['tilemap', 'rows'], r);
        this._set(['tilemap', 'cols'], c);
        if (enable) this._set(['tilemap', 'enabled'], true);
        return { rows: r, cols: c, enabled: !!enable };
    }
}

export function createSpriteSceneStateController(scene) {
    return new SpriteSceneStateController(scene);
}
