import Scene from './Scene.js';
import Vector,{v} from '../js/Vector.js';
import createHDiv from '../js/htmlElements/createHDiv.js';
import createHInput from '../js/htmlElements/createHInput.js';
import SpriteSheet from '../js/Spritesheet.js';
import Geometry from '../js/Geometry.js';
import FrameSelect from '../js/UI/frameSelect.js';
import Color from '../js/Color.js';
import { copyToClipboard } from '../js/Support.js';
import { initializeSpriteSceneState } from './spriteScene/stateDefaults.js';
import { setupSpriteSceneMultiplayerHooks } from './spriteScene/multiplayerBootstrap.js';
import { createSpriteCollabTransport } from './spriteScene/collabTransport.js';
import { installSpriteSceneStateBindings } from './spriteScene/stateBindings.js';
import { createSpriteSceneStateController } from './spriteScene/stateController.js';
import { createSpriteWebRTCCollabController } from './spriteScene/webrtcCollab.js';
import AutoTileGenerationMenu from './spriteScene/AutoTileGenerationMenu.js';

export class SpriteScene extends Scene {
    constructor(...args) {
        super('spriteScene', ...args);
        this.loaded = 0;
        this.isReady = false;
        this._checkerboardCache = new Map();
        this._checkerboardTileSize = 16;
        this._checkerboardLight = '#3a3a3aff';
        this._checkerboardDark = '#2e2e2eff';
        this._renderOnlyAllVisible = false;
        this._lastVisibleTileBounds = null;
        this._frameMousePosInfo = null;
        this._drawAreaIndexMap = new Map();
        this._renderScratchCanvases = Object.create(null);
    }

    onReady() {
        this.maskShapesWithSelection = false;

        try {
            this._getCheckerboardCanvas(384, 384);
        } catch (e) {}


        this.currentSprite = SpriteSheet.createNew(16, 'idle');
        this.currentSprite.insertFrame('idle',1)
        // Quick test paint: draw a small emoji-like face into the first idle frame
        try {
            const frame = this.currentSprite.getFrame('idle', 0);
            if (frame) {
                const fctx = frame.getContext('2d');
                // clear transparent
                fctx.clearRect(0, 0, frame.width, frame.height);
                // orange face
                fctx.fillStyle = '#FFAA33';
                fctx.fillRect(1, 1, frame.width - 2, frame.height - 2);
                // eyes
                fctx.fillStyle = '#000000';
                fctx.fillRect(4, 4, 2, 2);
                fctx.fillRect(10, 4, 2, 2);
                // mouth
                fctx.fillRect(6, 10, 4, 1);
            }
            // rebuild the packed sheet so Draw.sheet picks up the change
            if (typeof this.currentSprite._rebuildSheetCanvas === 'function') this.currentSprite._rebuildSheetCanvas();
        } catch (e) { console.warn('failed to paint test frame', e); }



        // --- Multiplayer edit buffering / hooks ---
        this.collabTransport = createSpriteCollabTransport(this);
        initializeSpriteSceneState(this, this.currentSprite);
        installSpriteSceneStateBindings(this);
        this.stateController = createSpriteSceneStateController(this);
        this._ensureLayerState();
        this._installPixelLayerHooks();
        this.webrtcCollab = createSpriteWebRTCCollabController(this);
        setupSpriteSceneMultiplayerHooks(this, this.currentSprite);
        this._syncSpriteAnimationProfilesFromSheet();
        if (!this.selectedSpriteAnimation) this.selectedSpriteAnimation = this.selectedAnimation || 'idle';
        this.configureCollabTransport();
        if (this.EM && typeof this.EM.connect === 'function') {
            try {
                this.EM.connect('spriteScene-webrtc-autostart', async () => {
                    try {
                        if (this.webrtcCollab && !this.webrtcCollab.started) {
                            await this.webrtcCollab.start({ offer: null });
                        }
                    } catch (e) { /* ignore autostart errors */ }
                });
            } catch (e) {}
        }

        this.FrameSelect = new FrameSelect(this,this.currentSprite,this.mouse,this.keys,this.UIDraw,1)
        this.autoTileGenerationMenu = new AutoTileGenerationMenu(this, this.mouse, this.keys, this.UIDraw, 80);
        // load available tile connection mapping (tiles.json) for autotile matching
        try {
            fetch('tiles.json').then(r=>r.json()).then(obj=>{ this._availableTileConn = obj || {}; this._availableTileKeys = Object.keys(this._availableTileConn || {}); }).catch(()=>{});
        } catch(e){}
        // create a simple color picker input positioned to the right of the left menu (shifted 200px)
        try {
            // ensure a default pen color exists
            if (this.stateController) this.stateController.setPenColor(this.penColor || '#000000');
            else this.penColor = this.penColor || '#000000';
            // place near the bottom-left, just right of the 200px-wide FrameSelect menu
            const pickerPos = new Vector(208, 1040);
            const pickerSize = new Vector(40, 28);
            const colorInput = createHInput('pen-color', pickerPos, pickerSize, 'color', { borderRadius: '4px', border: '1px solid #444', padding: '2px' }, 'UI');
            // Make picker 2x bigger from its bottom-left corner.
            colorInput.style.transformOrigin = '0% 100%';
            colorInput.style.transform = 'scale(2)';
            colorInput.value = this.penColor || '#000000';
            colorInput.title = 'Pen color';
            colorInput.addEventListener('input', (e) => {
                try {
                    if (this.stateController) this.stateController.setPenColor(e.target.value);
                    else this.penColor = e.target.value;
                } catch (ee) {}
            });
            // Prevent mouse bleed into JS UI while hovering the DOM color picker.
            const pauseMouseForPicker = () => {
                try { if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause(0.2); } catch (e) {}
            };
            colorInput.addEventListener('mouseenter', pauseMouseForPicker);
            colorInput.addEventListener('mousemove', pauseMouseForPicker);
            colorInput.addEventListener('pointerenter', pauseMouseForPicker);
            colorInput.addEventListener('pointermove', pauseMouseForPicker);
            colorInput.addEventListener('focus', pauseMouseForPicker);
            // small label to the right of the picker
            const label = document.createElement('div');
            label.textContent = '';
            label.style.position = 'absolute';
            label.style.left = (pickerPos.x + pickerSize.x + 6) + 'px';
            label.style.top = (pickerPos.y - 2) + 'px';
            label.style.color = '#FFFFFF';
            label.style.fontSize = '12px';
            label.style.zIndex = 1000;
            label.setAttribute('data-ui','1');
            const uiCanvas = document.getElementById('UI');
            if (uiCanvas && uiCanvas.parentNode) uiCanvas.parentNode.appendChild(label);
            this._colorInput = colorInput;
            this._colorLabel = label;
        } catch (e) {
            console.warn('failed to create color picker', e);
        }

        this.connectDebug()

        // Autosave defaults
        this._autosaveEnabled = true;
        this._autosaveIntervalSeconds = 10;
        this._autosaveMinIntervalSeconds = 10;
        this._autosaveIntervalId = null;
        this._autosaveDirty = false;
        this._autosaveInFlight = false;
        this._autosaveLastRunAt = 0;
        this._restoringSavedState = false;

        

        // Start autosave timer if enabled
        if (this._autosaveEnabled) {
            this._autosaveIntervalId = setInterval(() => {
                if (this._restoringSavedState) return;
                if (!this._autosaveDirty || this._autosaveInFlight) return;
                const now = Date.now();
                const minSeconds = Math.max(1, Number(this._autosaveMinIntervalSeconds) || 1);
                const everySeconds = Math.max(minSeconds, Number(this._autosaveIntervalSeconds) || 60);
                if ((now - (Number(this._autosaveLastRunAt) || 0)) < (everySeconds * 1000)) return;
                this._autosaveInFlight = true;
                setTimeout(() => {
                    try { this.doSave(); } catch (e) { /* ignore autosave errors */ }
                    finally { this._autosaveInFlight = false; }
                }, 0);
            }, 1000);
        }

        // Attempt to load previously-saved sprite frames/metdata (async). We call
        // saver.load() to make sure savedata is fresh, then restore per-frame images
        // if present under `sprites/<name>/frames/...`.
        try {
            if (this.saver && typeof this.saver.load === 'function') {
                try { this.saver.load(); } catch (e) {}
            }
            this._restoringSavedState = true;
            (async () => {
                try {
                    const keyName = (this.currentSprite && this.currentSprite.name) ? this.currentSprite.name : 'spritesheet';
                    // Migrate legacy stored packed image saved at `sprites/<name>` (string)
                    try {
                        if (this.saver && this.saver.savedata && this.saver.savedata.sprites && typeof this.saver.savedata.sprites[keyName] === 'string') {
                            try {
                                const legacy = this.saver.savedata.sprites[keyName];
                                this.saver.savedata.sprites[keyName] = { packed: legacy };
                                try { this.saver.save(); } catch (e) {}
                            } catch (e) {}
                        }
                    } catch (e) {}
                    const meta = (this.saver && typeof this.saver.get === 'function') ? this.saver.get('sprites_meta/' + keyName) : null;
                    // If no metadata, try a simple packed image load fallback
                    if (!meta) {
                        try {
                            const packed = (this.saver && typeof this.saver.getImage === 'function') ? this.saver.getImage('sprites/' + keyName + '/packed') : null;
                            if (packed) {
                                const img = new Image();
                                img.src = packed;
                                img.onload = () => {
                                    try { this.currentSprite.sheet = img; } catch (e) {}
                                };
                            }
                        } catch (e) {}
                        return;
                    }

                    // If metadata includes a slice size, apply it so cursor/grid math matches
                    // the saved sprite instead of defaulting to 16x16.
                    try {
                        if (meta && typeof meta.slicePx === 'number' && meta.slicePx > 0) {
                            this.currentSprite.slicePx = Math.floor(meta.slicePx);
                        }
                    } catch (e) { /* non-fatal */ }

                    // Restore per-frame tile connection settings used by frame-side toggles/autotile.
                    try {
                        this._tileConnMap = {};
                        const conn = (meta && meta.tileConnections && typeof meta.tileConnections === 'object') ? meta.tileConnections : null;
                        if (conn) {
                            for (const k of Object.keys(conn)) {
                                const v = conn[k];
                                if (typeof v !== 'string') continue;
                                const norm = (typeof this._normalizeOpenConnectionKey === 'function')
                                    ? this._normalizeOpenConnectionKey(v)
                                    : String(v).replace(/[^01]/g, '').padEnd(8, '0').slice(0, 8);
                                this._tileConnMap[k] = norm;
                            }
                        }
                    } catch (e) { /* ignore tile connection restore errors */ }

                    // Restore tile-mode layout (grid size, bindings, preview transforms) if present
                    try {
                        const layout = meta && meta.tileLayout ? meta.tileLayout : null;
                        if (layout && typeof layout === 'object') {
                            const parseDim = (v, fallback) => {
                                const n = Math.floor(Number(v));
                                return Number.isFinite(n) && n > 0 ? n : fallback;
                            };
                            const cols = parseDim(layout.tileCols, (this.tileCols|0) || 3);
                            const rows = parseDim(layout.tileRows, (this.tileRows|0) || cols);
                            const nextCols = Math.max(1, cols);
                            const nextRows = Math.max(1, rows);
                            if (this.stateController) {
                                this.stateController.setTileGrid(nextCols, nextRows);
                                this.stateController.setTilemode(!!layout.tilemode);
                            } else {
                                this.tileCols = nextCols;
                                this.tileRows = nextRows;
                                this.tilemode = !!layout.tilemode;
                            }
                            if (!Array.isArray(this._areaBindings)) this._areaBindings = [];
                            if (!Array.isArray(this._areaTransforms)) this._areaTransforms = [];
                            this._ensureLayerState();
                            if (!this._tileActive) this._tileActive = new Set();
                            if (Array.isArray(layout.activeTiles)) {
                                for (const t of layout.activeTiles) {
                                    if (!t) continue;
                                    const c = Number(t.col);
                                    const r = Number(t.row);
                                    if (Number.isFinite(c) && Number.isFinite(r)) this._activateTile(c, r);
                                }
                            } else {
                                this._seedTileActives(cols, rows);
                            }

                            const decodeBindingIndex = (entry) => {
                                if (!entry) return null;
                                if (Number.isFinite(entry.col) && Number.isFinite(entry.row)) {
                                    const c = Number(entry.col);
                                    const r = Number(entry.row);
                                    this._activateTile(c, r);
                                    return this._getAreaIndexForCoord(c, r);
                                }
                                const i = Number(entry.areaIndex);
                                if (!Number.isFinite(i) || i < 0) return null;
                                const legacy = this._coordFromLegacyIndex(i, this.tileCols, this.tileRows);
                                this._activateTile(legacy.col, legacy.row);
                                return this._getAreaIndexForCoord(legacy.col, legacy.row);
                            };

                            if (Array.isArray(layout.pixelLayers) && layout.pixelLayers.length > 0) {
                                this._pixelLayers = layout.pixelLayers.map((src, i) => {
                                    const l = (src && typeof src === 'object') ? src : { name: String(src || '') };
                                    return {
                                        name: String(l.name || ('Pixel Layer ' + (i + 1))).trim() || ('Pixel Layer ' + (i + 1)),
                                        visibility: this._normalizePixelLayerVisibility(l.visibility, 0)
                                    };
                                });
                                this._activePixelLayerIndex = Math.max(0, Math.min(Number(layout.activePixelLayerIndex) | 0, this._pixelLayers.length - 1));
                            }

                            const incomingSavedTileLayers = this._normalizeIncomingTileLayers(layout.tileLayers);
                            if (Array.isArray(incomingSavedTileLayers) && incomingSavedTileLayers.length > 0) {
                                this._tileLayers = [];
                                for (let li = 0; li < incomingSavedTileLayers.length; li++) {
                                    const srcRaw = incomingSavedTileLayers[li];
                                    const srcLayer = (srcRaw && typeof srcRaw === 'object') ? srcRaw : { name: String(srcRaw || '') };
                                    const outLayer = {
                                        name: String(srcLayer.name || ('Tile Layer ' + (li + 1))).trim() || ('Tile Layer ' + (li + 1)),
                                        visibility: this._normalizeTileLayerVisibility(srcLayer.visibility, 0),
                                        bindings: [],
                                        transforms: []
                                    };

                                    const layerBindings = Array.isArray(srcLayer.bindings) ? srcLayer.bindings : [];
                                    for (const b of layerBindings) {
                                        const idx = decodeBindingIndex(b);
                                        if (!Number.isFinite(idx)) continue;
                                        const mf = Array.isArray(b.multiFrames) ? b.multiFrames.filter(v => Number.isFinite(v)).map(v => Number(v)) : null;
                                        outLayer.bindings[idx] = { anim: b.anim, index: Number(b.index), multiFrames: (mf && mf.length > 0) ? mf : null };
                                    }

                                    const layerTransforms = Array.isArray(srcLayer.transforms) ? srcLayer.transforms : [];
                                    for (const t of layerTransforms) {
                                        const idx = decodeBindingIndex(t);
                                        if (!Number.isFinite(idx)) continue;
                                        outLayer.transforms[idx] = { rot: (t.rot || 0), flipH: !!t.flipH };
                                    }

                                    this._tileLayers.push(outLayer);
                                }
                                this._activeTileLayerIndex = Math.max(0, Math.min(Number(layout.activeTileLayerIndex) | 0, this._tileLayers.length - 1));
                                this._syncActiveTileLayerReferences();
                            } else {
                                if (Array.isArray(layout.bindings)) {
                                    this._areaBindings = [];
                                    for (const b of layout.bindings) {
                                        if (!b) continue;
                                        const idx = decodeBindingIndex(b);
                                        if (!Number.isFinite(idx)) continue;
                                        const mf = Array.isArray(b.multiFrames) ? b.multiFrames.filter(v => Number.isFinite(v)).map(v => Number(v)) : null;
                                        this._setAreaBindingAtIndex(idx, { anim: b.anim, index: Number(b.index), multiFrames: (mf && mf.length > 0) ? mf : null }, false);
                                    }
                                }
                                if (Array.isArray(layout.transforms)) {
                                    this._areaTransforms = [];
                                    for (const t of layout.transforms) {
                                        if (!t) continue;
                                        const idx = decodeBindingIndex(t);
                                        if (!Number.isFinite(idx)) continue;
                                        this._setAreaTransformAtIndex(idx, { rot: (t.rot || 0), flipH: !!t.flipH }, false);
                                    }
                                }
                                this._adoptCurrentTileArraysIntoActiveLayer();
                            }
                            if (Array.isArray(layout.waypoints)) {
                                const waypointKeys = [];
                                for (const wp of layout.waypoints) {
                                    if (!wp) continue;
                                    const c = Number(wp.col);
                                    const r = Number(wp.row);
                                    if (!Number.isFinite(c) || !Number.isFinite(r)) continue;
                                    waypointKeys.push(this._tileKey(c | 0, r | 0));
                                }
                                this._setWaypointKeys(waypointKeys, false, true);
                            } else {
                                this._setWaypointKeys([], false, true);
                            }
                        }
                    } catch (e) { /* ignore tile layout restore errors */ }

                    // Restore sprite entities/state if present.
                    try {
                        const incomingSpriteLayer = (meta && meta.spriteLayer && typeof meta.spriteLayer === 'object') ? meta.spriteLayer : null;
                        if (incomingSpriteLayer) {
                            const layer = this._normalizeSpriteLayerState();
                            if (layer) {
                                layer.selectedAnimation = incomingSpriteLayer.selectedAnimation || null;
                                layer.selectedEntityId = incomingSpriteLayer.selectedEntityId || null;
                                layer.nextEntityId = Math.max(1, Number(incomingSpriteLayer.nextEntityId) || 1);
                                layer.entities = (incomingSpriteLayer.entities && typeof incomingSpriteLayer.entities === 'object')
                                    ? JSON.parse(JSON.stringify(incomingSpriteLayer.entities))
                                    : {};
                                layer.order = Array.isArray(incomingSpriteLayer.order)
                                    ? incomingSpriteLayer.order.slice()
                                    : Object.keys(layer.entities || {});
                                layer.animationProfiles = (incomingSpriteLayer.animationProfiles && typeof incomingSpriteLayer.animationProfiles === 'object')
                                    ? JSON.parse(JSON.stringify(incomingSpriteLayer.animationProfiles))
                                    : {};
                                layer.clipboard = incomingSpriteLayer.clipboard
                                    ? JSON.parse(JSON.stringify(incomingSpriteLayer.clipboard))
                                    : null;

                                if (layer.selectedEntityId && !layer.entities[layer.selectedEntityId]) layer.selectedEntityId = null;
                                this.selectedSpriteAnimation = layer.selectedAnimation;
                                this.selectedSpriteEntityId = layer.selectedEntityId;
                                this.spriteClipboard = layer.clipboard || null;
                            }
                        }
                    } catch (e) { /* ignore sprite layer restore errors */ }

                    // Reconstruct frames from saved per-frame images
                    if (!this.currentSprite || !this.currentSprite._frames) return;
                    const animNames = Object.keys(meta.animations || {});
                    this._ensureLayerState();
                    this._ensurePixelLayerStore();
                    let pending = 0;
                    for (const anim of animNames) {
                        const count = meta.animations[anim] || 0;
                        if (!this.currentSprite._frames.has(anim)) this.currentSprite._frames.set(anim, []);
                        const arr = this.currentSprite._frames.get(anim) || [];
                        for (let i = 0; i < count; i++) {
                            try {
                                const path = 'sprites/' + keyName + '/frames/' + encodeURIComponent(anim) + '/' + i;
                                const dataUrl = (this.saver && typeof this.saver.getImage === 'function') ? this.saver.getImage(path) : null;
                                if (!dataUrl) continue;
                                pending++;
                                // load image async and draw into canvas
                                (function(arrRef, idx, srcDataUrl, parent) {
                                    const im = new Image();
                                    im.onload = () => {
                                        try {
                                            const c = document.createElement('canvas');
                                            c.width = im.width; c.height = im.height;
                                            const cx = c.getContext('2d');
                                            try { cx.imageSmoothingEnabled = false; } catch (e) {}
                                            cx.clearRect(0,0,c.width,c.height);
                                            cx.drawImage(im, 0, 0);
                                            arrRef[idx] = c;
                                        } catch (e) { /* ignore per-frame load error */ }
                                        pending--;
                                        if (pending === 0) {
                                            try { parent.currentSprite._rebuildSheetCanvas(); } catch (e) {}
                                        }
                                    };
                                    im.onerror = () => { pending--; if (pending === 0) { try { parent.currentSprite._rebuildSheetCanvas(); } catch (e) {} } };
                                    im.src = srcDataUrl;
                                })(arr, i, dataUrl, this);
                            } catch (e) { /* ignore */ }
                        }
                        this.currentSprite._frames.set(anim, arr);

                        // Restore additional pixel layers (>0) if present.
                        for (let li = 1; li < (this._pixelLayers?.length || 0); li++) {
                            for (let i = 0; i < count; i++) {
                                try {
                                    const path = 'sprites/' + keyName + '/pixelLayers/' + li + '/frames/' + encodeURIComponent(anim) + '/' + i;
                                    const dataUrl = (this.saver && typeof this.saver.getImage === 'function') ? this.saver.getImage(path) : null;
                                    if (!dataUrl) continue;
                                    pending++;
                                    (async () => {
                                        try {
                                            const c = this._ensurePixelLayerFrameCanvas(li, anim, i, true);
                                            if (!c || !c.getContext) return;
                                            const ctx = c.getContext('2d');
                                            ctx.clearRect(0, 0, c.width, c.height);
                                            const im = new Image();
                                            await new Promise((res) => {
                                                im.onload = () => { try { ctx.drawImage(im, 0, 0, c.width, c.height); } catch (e) {} res(); };
                                                im.onerror = () => res();
                                                im.src = dataUrl;
                                            });
                                        } catch (e) { /* ignore */ }
                                        pending--;
                                        if (pending === 0) {
                                            try { this.currentSprite._rebuildSheetCanvas(); } catch (e) {}
                                        }
                                    })();
                                } catch (e) { /* ignore */ }
                            }
                        }
                    }
                    // If nothing pending, still rebuild so packed sheet picks up metadata
                    if (pending === 0) {
                        try { this.currentSprite._rebuildSheetCanvas(); } catch (e) {}
                    }
                } catch (e) { /* ignore load errors */ }
                finally {
                    this._restoringSavedState = false;
                }
            })();
        } catch (e) {}



        this.isReady = true;
    }

    connectDebug(){
        // Register debug signal to grayscale the current frame
        window.Debug.createSignal('Grayscale', () => {
            try {
                const sheet = this.currentSprite;
                const anim = this.selectedAnimation;
                const frameIdx = this.selectedFrame;
                if (!sheet) {
                    window.Debug && window.Debug.log && window.Debug.log('No current sprite to grayscale');
                    return;
                }
                const frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, frameIdx) : null;
                if (!frameCanvas) {
                    window.Debug && window.Debug.log && window.Debug.log('No frame canvas found');
                    return;
                }
                const ctx = frameCanvas.getContext('2d');
                const w = frameCanvas.width;
                const h = frameCanvas.height;
                const img = ctx.getImageData(0, 0, w, h);
                const data = img.data;

                const hasPointSelection = (this.selectionPoints && this.selectionPoints.length > 0);
                const hasRegionSelection = !!this.selectionRegion;

                const applyLumAtIdx = (idx) => {
                    const r = data[idx];
                    const g = data[idx + 1];
                    const b = data[idx + 2];
                    const lum = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
                    data[idx] = lum;
                    data[idx + 1] = lum;
                    data[idx + 2] = lum;
                };

                if (hasPointSelection) {
                    for (const p of this.selectionPoints) {
                        if (!p) continue;
                        if (p.x < 0 || p.y < 0 || p.x >= w || p.y >= h) continue;
                        const idx = (p.y * w + p.x) * 4;
                        applyLumAtIdx(idx);
                    }
                } else if (hasRegionSelection) {
                    const sr = this.selectionRegion;
                    const minX = Math.max(0, Math.min(sr.start.x, sr.end.x));
                    const minY = Math.max(0, Math.min(sr.start.y, sr.end.y));
                    const maxX = Math.min(w - 1, Math.max(sr.start.x, sr.end.x));
                    const maxY = Math.min(h - 1, Math.max(sr.start.y, sr.end.y));
                    for (let yy = minY; yy <= maxY; yy++) {
                        for (let xx = minX; xx <= maxX; xx++) {
                            const idx = (yy * w + xx) * 4;
                            applyLumAtIdx(idx);
                        }
                    }
                } else {
                    for (let i = 0; i < data.length; i += 4) {
                        const r = data[i];
                        const g = data[i + 1];
                        const b = data[i + 2];
                        const lum = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
                        data[i] = lum;
                        data[i + 1] = lum;
                        data[i + 2] = lum;
                    }
                }

                ctx.putImageData(img, 0, 0);
                if (typeof sheet._rebuildSheetCanvas === 'function') {
                    try { sheet._rebuildSheetCanvas(); } catch (e) {}
                }
                window.Debug && window.Debug.log && window.Debug.log('Applied grayscale to current frame');
            } catch (err) {
                window.Debug && window.Debug.error && window.Debug.error('Grayscale signal failed: ' + err);
            }
        });
        window.Debug.createSignal('copy', () => {
            try {
                const hex = this.penColor || '#000000';
                // Use support helper to copy to clipboard
                try { copyToClipboard(hex); } catch (err) {
                    // fallback to navigator if helper unavailable
                    try { navigator.clipboard.writeText(hex); } catch (e) {}
                }
                window.Debug && window.Debug.log && window.Debug.log('Copied color to clipboard: ' + hex);
            } catch (err) {
                window.Debug && window.Debug.error && window.Debug.error('CopyColor signal failed: ' + err);
            }
        });
        window.Debug.createSignal('resize', (sliceSize,resizeContent=true) => {
            try {
                this.resize(sliceSize,resizeContent)
                window.Debug && window.Debug.log && window.Debug.log('Resized canvas to:',sliceSize,'x',sliceSize,'px');
            } catch (err) {
                window.Debug && window.Debug.error && window.Debug.error('Failed to resize canvas' + err);
            }
        });
        // Configure tile-mode grid size: tileArray(cols, rows).
        // Example: tileArray(5,5) -> 5x5 grid of mirrored tiles.
        window.Debug.createSignal('tileArray', (cols = 3, rows = cols) => {
            try {
                const toInt = (v, def) => {
                    const n = Math.floor(Number(v));
                    return Number.isFinite(n) && n > 0 ? n : def;
                };
                const c = Math.max(1, toInt(cols, this.tileCols || 3));
                const r = Math.max(1, toInt(rows, this.tileRows || 3));
                if (this.stateController) this.stateController.setTileGrid(c, r);
                else {
                    this.tileCols = c;
                    this.tileRows = r;
                }
                this._seedTileActives(c, r);
                window.Debug && window.Debug.log && window.Debug.log('Tile array size set to', c + 'x' + r);
            } catch (err) {
                window.Debug && window.Debug.error && window.Debug.error('tileArray signal failed: ' + err);
            }
        });

        // Register SelectColor debug signal: select(hex, buffer=1)
        window.Debug.createSignal('select', (hex, buffer = 1) => {
            try {
                if (!hex) {
                    window.Debug && window.Debug.log && window.Debug.log('SelectColor: missing hex argument');
                    return;
                }
                const tol = (typeof buffer === 'number') ? buffer : (parseFloat(buffer) || 1);
                const colObj = Color.convertColor(hex);
                const rgbCol = colObj.toRgb();
                // Color.toRgb returns an object where .a/.b/.c hold r/g/b in this project
                const tr = Math.round(rgbCol.a || 0);
                const tg = Math.round(rgbCol.b || 0);
                const tb = Math.round(rgbCol.c || 0);
                // If an explicit alpha is present (e.g. 8-digit hex), treat the
                // selection as alpha-exclusive instead of RGB distance based.
                const hasAlpha = (rgbCol && typeof rgbCol.d === 'number');
                const ta = hasAlpha ? Math.round((rgbCol.d || 0) * 255) : null;

                const sheet = this.currentSprite;
                const anim = this.selectedAnimation;
                const frameIdx = this.selectedFrame;
                if (!sheet) {
                    window.Debug && window.Debug.log && window.Debug.log('SelectColor: no current sprite');
                    return;
                }
                const frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, frameIdx) : null;
                if (!frameCanvas) {
                    window.Debug && window.Debug.log && window.Debug.log('SelectColor: no frame canvas');
                    return;
                }

                const ctx = frameCanvas.getContext('2d');
                const w = frameCanvas.width;
                const h = frameCanvas.height;
                let img;
                try { img = ctx.getImageData(0, 0, w, h); } catch (e) { return; }
                const data = img.data;

                const matches = [];
                const maxDistSq = tol * tol;
                for (let y = 0; y < h; y++) {
                    for (let x = 0; x < w; x++) {
                        const i = (y * w + x) * 4;
                        const r = data[i];
                        const g = data[i + 1];
                        const b = data[i + 2];
                        const a = data[i + 3];

                        const dr = r - tr;
                        const dg = g - tg;
                        const db = b - tb;
                        const distSq = dr * dr + dg * dg + db * db;
                        if (distSq > maxDistSq) continue;

                        // If no alpha was supplied in the target color, ignore
                        // pixel alpha. If alpha was supplied (8-digit hex), also
                        // require exact alpha match.
                        if (hasAlpha && a !== ta) continue;

                        matches.push({ x, y });
                    }
                }

                // Merge color-matched points into any existing selection
                const merged = (this.selectionPoints && this.selectionPoints.length > 0)
                    ? this.selectionPoints.slice()
                    : [];
                for (const p of matches) {
                    const exists = merged.some(sp => sp.x === p.x && sp.y === p.y && sp.areaIndex === undefined);
                    if (!exists) merged.push({ x: p.x, y: p.y });
                }
                if (this.stateController) {
                    this.stateController.setSelectionPoints(merged);
                    this.stateController.clearSelectionRegion();
                } else {
                    this.selectionPoints = merged;
                    this.selectionRegion = null;
                }
                window.Debug && window.Debug.log && window.Debug.log(`SelectColor: selected ${matches.length} pixels matching ${hex} (tol=${tol})`);
            } catch (err) {
                window.Debug && window.Debug.error && window.Debug.error('SelectColor failed: ' + err);
            }
        });

        // Register ReplaceColor debug signal: replace(hex1, hex2, include='frame'|'animation'|'all', buffer=1)
        window.Debug.createSignal('replace', (hex1, hex2, include = 'frame', buffer = 1) => {
            try {
                if (!hex1 || !hex2) {
                    window.Debug && window.Debug.log && window.Debug.log('ReplaceColor: missing hex1 or hex2 argument');
                    return;
                }
                const sheet = this.currentSprite;
                if (!sheet) {
                    window.Debug && window.Debug.log && window.Debug.log('ReplaceColor: no current sprite');
                    return;
                }

                const tol = (typeof buffer === 'number') ? buffer : (parseFloat(buffer) || 1);

                const srcCol = Color.convertColor(hex1).toRgb();
                const dstCol = Color.convertColor(hex2).toRgb();
                const sr = Math.round(srcCol.a || 0);
                const sg = Math.round(srcCol.b || 0);
                const sb = Math.round(srcCol.c || 0);
                const hasSrcAlpha = (srcCol && typeof srcCol.d === 'number');
                const sa = hasSrcAlpha ? Math.round((srcCol.d || 0) * 255) : null;

                const dr = Math.round(dstCol.a || 0);
                const dg = Math.round(dstCol.b || 0);
                const db = Math.round(dstCol.c || 0);
                const da = Math.round(((dstCol.d === undefined ? 1 : dstCol.d) || 0) * 255);

                const maxDistSq = tol * tol;

                // Build list of (anim, frameIdx) targets based on include mode.
                const targets = [];
                const currentAnim = this.selectedAnimation;
                const currentFrameIdx = this.selectedFrame;

                const safeInclude = (typeof include === 'string') ? include.toLowerCase() : 'frame';
                if (safeInclude === 'animation') {
                    try {
                        const arr = (sheet._frames && sheet._frames.get(currentAnim)) || [];
                        for (let i = 0; i < arr.length; i++) {
                            targets.push({ anim: currentAnim, frameIdx: i });
                        }
                    } catch (e) { /* ignore frame enumeration errors */ }
                } else if (safeInclude === 'all') {
                    try {
                        if (sheet._frames && typeof sheet._frames.entries === 'function') {
                            for (const [animName, arr] of sheet._frames.entries()) {
                                if (!Array.isArray(arr)) continue;
                                for (let i = 0; i < arr.length; i++) {
                                    targets.push({ anim: animName, frameIdx: i });
                                }
                            }
                        }
                    } catch (e) { /* ignore global frame enumeration errors */ }
                } else {
                    // default: only the currently selected frame
                    targets.push({ anim: currentAnim, frameIdx: currentFrameIdx });
                }

                let replacedCount = 0;

                for (const t of targets) {
                    if (!t || t.anim === undefined || t.frameIdx === undefined) continue;
                    let frameCanvas = null;
                    try { frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(t.anim, t.frameIdx) : null; } catch (e) { frameCanvas = null; }
                    if (!frameCanvas) continue;

                    const ctx = frameCanvas.getContext('2d');
                    const w = frameCanvas.width;
                    const h = frameCanvas.height;
                    let img;
                    try { img = ctx.getImageData(0, 0, w, h); } catch (e) { continue; }
                    const data = img.data;

                    for (let y = 0; y < h; y++) {
                        for (let x = 0; x < w; x++) {
                            const i = (y * w + x) * 4;
                            const r = data[i];
                            const g = data[i + 1];
                            const b = data[i + 2];
                            const a = data[i + 3];

                            const rr = r - sr;
                            const gg = g - sg;
                            const bb = b - sb;
                            const distSq = rr * rr + gg * gg + bb * bb;
                            if (distSq > maxDistSq) continue;

                            // If hex1 included alpha, also require exact alpha match.
                            if (hasSrcAlpha && a !== sa) continue;

                            data[i] = dr;
                            data[i + 1] = dg;
                            data[i + 2] = db;
                            data[i + 3] = da;
                            replacedCount++;
                        }
                    }

                    try { ctx.putImageData(img, 0, 0); } catch (e) { /* ignore putImageData errors */ }
                }

                // rebuild packed sheet so editor view updates
                if (typeof sheet._rebuildSheetCanvas === 'function') {
                    try { sheet._rebuildSheetCanvas(); } catch (e) { /* ignore */ }
                }

                window.Debug && window.Debug.log && window.Debug.log(`ReplaceColor: replaced ${replacedCount} pixels from ${hex1} to ${hex2} (include=${safeInclude}, tol=${tol})`);
            } catch (err) {
                window.Debug && window.Debug.error && window.Debug.error('ReplaceColor failed: ' + err);
            }
        });

        window.Debug.createSignal('drawSelected', () => {
            try {
                const sheet = this.currentSprite;
                if (!sheet) {
                    window.Debug && window.Debug.log && window.Debug.log('drawSelected: no current sprite');
                    return;
                }
                const colorHex = this.penColor || '#000000';
                let applied = 0;

                // helper to write a single pixel using sheet API if available, otherwise direct canvas
                const writePixel = (anim, frameIdx, x, y) => {
                    try {
                        if (typeof sheet.setPixel === 'function') {
                            sheet.setPixel(anim, frameIdx, x, y, colorHex, 'replace');
                        } else {
                            const frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, frameIdx) : null;
                            if (frameCanvas) {
                                const ctx = frameCanvas.getContext('2d');
                                try {
                                    const col = Color.convertColor(colorHex).toRgb();
                                    const r = Math.round(col.a || 0);
                                    const g = Math.round(col.b || 0);
                                    const b = Math.round(col.c || 0);
                                    const a = (col.d === undefined) ? 1 : (col.d || 0);
                                    ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
                                    ctx.fillRect(x, y, 1, 1);
                                } catch (e) { /* ignore per-pixel canvas failures */ }
                            }
                        }
                        applied++;
                    } catch (e) { /* ignore write errors */ }
                };

    // Immediate apply of drawSelected (no long animation). Accepts options to
    // perform a brief UI flair (fade + noise) before or during write.
    this._applyDrawSelectedImmediate = function(opts = {}) {
        try {
            const flairMs = (opts && Number.isFinite(opts.flairMs)) ? Number(opts.flairMs) : 0;
            const noise = (opts && typeof opts.noise === 'number') ? opts.noise : 0;
            const sheet = this.currentSprite;
            if (!sheet) return;
            const colorHex = this.penColor || '#000000';
            // If flair requested, perform a quick staged write: small alpha ramp over flairMs
            if (flairMs > 16) {
                // build list of target pixels
                const targets = [];
                if (this.selectionPoints && this.selectionPoints.length > 0) {
                    for (const p of this.selectionPoints) targets.push({ x: p.x, y: p.y, anim: this.selectedAnimation, frameIdx: this.selectedFrame, areaIndex: p.areaIndex });
                } else if (this.selectionRegion) {
                    const sr = this.selectionRegion;
                    const minX = Math.min(sr.start.x, sr.end.x);
                    const minY = Math.min(sr.start.y, sr.end.y);
                    const maxX = Math.max(sr.start.x, sr.end.x);
                    const maxY = Math.max(sr.start.y, sr.end.y);
                    let anim = this.selectedAnimation, frameIdx = this.selectedFrame;
                    if (this.tilemode && sr && typeof sr.areaIndex === 'number') {
                        const binding = this.getAreaBinding(sr.areaIndex);
                        if (binding && binding.anim !== undefined && binding.index !== undefined) { anim = binding.anim; frameIdx = Number(binding.index); }
                    }
                    for (let yy = minY; yy <= maxY; yy++) for (let xx = minX; xx <= maxX; xx++) targets.push({ x: xx, y: yy, anim, frameIdx });
                }
                if (!targets.length) return;
                const steps = Math.max(2, Math.min(6, Math.ceil(flairMs / 40)));
                const stepDelay = Math.round(flairMs / steps);
                for (let s = 1; s <= steps; s++) {
                    setTimeout(() => {
                        try {
                            const alpha = s / steps;
                            for (const t of targets) {
                                const anim = t.anim || this.selectedAnimation;
                                const frameIdx = (t.frameIdx !== undefined) ? t.frameIdx : this.selectedFrame;
                                // apply a noisy mix between original and target color by using random alpha tweak
                                const jitter = (Math.random() - 0.5) * (noise || 0);
                                const mix = Math.max(0, Math.min(1, alpha + jitter));
                                const col = Color.convertColor(colorHex).toRgb();
                                const r = Math.round((col.a || 0) * mix);
                                const g = Math.round((col.b || 0) * mix);
                                const b = Math.round((col.c || 0) * mix);
                                const a = Math.round(((col.d === undefined) ? 1 : (col.d || 0)) * 255 * mix);
                                try { if (typeof sheet.setPixel === 'function') sheet.setPixel(anim, frameIdx, t.x, t.y, this.rgbaToHex(r, g, b, a), 'replace');
                                        else {
                                            const frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, frameIdx) : null;
                                            if (frameCanvas) {
                                                const ctx = frameCanvas.getContext('2d');
                                                ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + (a/255) + ')';
                                                ctx.fillRect(t.x, t.y, 1, 1);
                                            }
                                        }
                                } catch (e) {}
                            }
                            if (typeof sheet._rebuildSheetCanvas === 'function') try { sheet._rebuildSheetCanvas(); } catch (e) {}
                        } catch (e) {}
                    }, s * stepDelay);
                }
                // ensure final exact color at end
                setTimeout(() => {
                    try {
                        for (const t of targets) {
                            const anim = t.anim || this.selectedAnimation;
                            const frameIdx = (t.frameIdx !== undefined) ? t.frameIdx : this.selectedFrame;
                            try { if (typeof sheet.setPixel === 'function') sheet.setPixel(anim, frameIdx, t.x, t.y, colorHex, 'replace');
                                    else {
                                        const frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, frameIdx) : null;
                                        if (frameCanvas) {
                                            const ctx = frameCanvas.getContext('2d');
                                            const col = Color.convertColor(colorHex).toRgb();
                                            const r = Math.round(col.a || 0);
                                            const g = Math.round(col.b || 0);
                                            const b = Math.round(col.c || 0);
                                            const a = ((col.d === undefined) ? 1 : (col.d || 0));
                                            ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
                                            ctx.fillRect(t.x, t.y, 1, 1);
                                        }
                                    }
                            } catch (e) {}
                        }
                        if (typeof sheet._rebuildSheetCanvas === 'function') try { sheet._rebuildSheetCanvas(); } catch (e) {}
                    } catch (e) {}
                }, flairMs + 10);
                return;
            }
            // No flair requested: immediate write
            if (this.selectionPoints && this.selectionPoints.length > 0) {
                for (const p of this.selectionPoints) {
                    let anim = this.selectedAnimation;
                    let frameIdx = this.selectedFrame;
                    if (this.tilemode && p && typeof p.areaIndex === 'number') {
                        const binding = this.getAreaBinding(p.areaIndex);
                        if (binding && binding.anim !== undefined && binding.index !== undefined) { anim = binding.anim; frameIdx = Number(binding.index); }
                    }
                    try { if (typeof sheet.setPixel === 'function') sheet.setPixel(anim, frameIdx, p.x, p.y, colorHex, 'replace');
                            else {
                                const frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, frameIdx) : null;
                                if (frameCanvas) {
                                    const ctx = frameCanvas.getContext('2d');
                                    const col = Color.convertColor(colorHex).toRgb();
                                    const r = Math.round(col.a || 0);
                                    const g = Math.round(col.b || 0);
                                    const b = Math.round(col.c || 0);
                                    const a = ((col.d === undefined) ? 1 : (col.d || 0));
                                    ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
                                    ctx.fillRect(p.x, p.y, 1, 1);
                                }
                            }
                    } catch (e) {}
                }
            } else if (this.selectionRegion) {
                const sr = this.selectionRegion;
                const minX = Math.min(sr.start.x, sr.end.x);
                const minY = Math.min(sr.start.y, sr.end.y);
                const maxX = Math.max(sr.start.x, sr.end.x);
                const maxY = Math.max(sr.start.y, sr.end.y);
                let anim = this.selectedAnimation;
                let frameIdx = this.selectedFrame;
                if (this.tilemode && sr && typeof sr.areaIndex === 'number') {
                    const binding = this.getAreaBinding(sr.areaIndex);
                    if (binding && binding.anim !== undefined && binding.index !== undefined) { anim = binding.anim; frameIdx = Number(binding.index); }
                }
                for (let yy = minY; yy <= maxY; yy++) for (let xx = minX; xx <= maxX; xx++) {
                    try { if (typeof sheet.setPixel === 'function') sheet.setPixel(anim, frameIdx, xx, yy, colorHex, 'replace');
                            else {
                                const frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, frameIdx) : null;
                                if (frameCanvas) {
                                    const ctx = frameCanvas.getContext('2d');
                                    const col = Color.convertColor(colorHex).toRgb();
                                    const r = Math.round(col.a || 0);
                                    const g = Math.round(col.b || 0);
                                    const b = Math.round(col.c || 0);
                                    const a = ((col.d === undefined) ? 1 : (col.d || 0));
                                    ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
                                    ctx.fillRect(xx, yy, 1, 1);
                                }
                            }
                    } catch (e) {}
                }
            }
            if (typeof sheet._rebuildSheetCanvas === 'function') try { sheet._rebuildSheetCanvas(); } catch (e) {}
        } catch (e) { /* ignore */ }
    }

                // If explicit point selection exists, use those points (respect areaIndex per-point)
                if (this.selectionPoints && this.selectionPoints.length > 0) {
                    try {
                        // Gather pixels grouped by anim/frame so we can read originals efficiently
                        const groups = new Map();
                        for (const p of this.selectionPoints) {
                            if (!p) continue;
                            let anim = this.selectedAnimation;
                            let frameIdx = this.selectedFrame;
                            if (this.tilemode && p && typeof p.areaIndex === 'number') {
                                const binding = this.getAreaBinding(p.areaIndex);
                                if (binding && binding.anim !== undefined && binding.index !== undefined) {
                                    anim = binding.anim;
                                    frameIdx = Number(binding.index);
                                }
                            }
                            const key = anim + ':' + frameIdx;
                            if (!groups.has(key)) groups.set(key, { anim, frameIdx, pts: [] });
                            groups.get(key).pts.push(p);
                        }
                        for (const g of groups.values()) {
                            const frameCanvas = (typeof this.currentSprite.getFrame === 'function') ? this.currentSprite.getFrame(g.anim, g.frameIdx) : null;
                            const entries = [];
                            if (frameCanvas) {
                                const ctx = frameCanvas.getContext('2d');
                                let img = null;
                                try { img = ctx.getImageData(0, 0, frameCanvas.width, frameCanvas.height); } catch (e) { img = null; }
                                for (const p of g.pts) {
                                    const x = p.x, y = p.y;
                                    let r=0,gc=0,b=0,a=0;
                                    if (img) {
                                        const idx = (y * img.width + x) * 4;
                                        r = img.data[idx]; gc = img.data[idx+1]; b = img.data[idx+2]; a = img.data[idx+3];
                                    }
                                    entries.push({ x, y, r, g: gc, b, a, anim: g.anim, frameIdx: g.frameIdx });
                                }
                            } else {
                                for (const p of g.pts) entries.push({ x: p.x, y: p.y, r:0, g:0, b:0, a:0, anim: g.anim, frameIdx: g.frameIdx });
                            }
                            // animate gradient fill with noise from cursor position
                            const pos = this.getPos(this.mouse && this.mouse.pos) || {};
                            const origin = (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) ? { ox: pos.x, oy: pos.y } : null;
                            this._animateFillSelected(entries, g.anim, g.frameIdx, 220, origin);
                        }
                    } catch (e) {
                        // fallback to immediate write on failure
                        for (const p of this.selectionPoints) { if (!p) continue; let anim = this.selectedAnimation; let frameIdx = this.selectedFrame; if (this.tilemode && p && typeof p.areaIndex === 'number') { const binding = this.getAreaBinding(p.areaIndex); if (binding && binding.anim !== undefined && binding.index !== undefined) { anim = binding.anim; frameIdx = Number(binding.index); } } writePixel(anim, frameIdx, p.x, p.y); }
                    }
                } else if (this.selectionRegion) {
                    try {
                        const sr = this.selectionRegion;
                        const minX = Math.min(sr.start.x, sr.end.x);
                        const minY = Math.min(sr.start.y, sr.end.y);
                        const maxX = Math.max(sr.start.x, sr.end.x);
                        const maxY = Math.max(sr.start.y, sr.end.y);
                        // prefer region's areaIndex if present
                        let anim = this.selectedAnimation;
                        let frameIdx = this.selectedFrame;
                        if (this.tilemode && sr && typeof sr.areaIndex === 'number') {
                            const binding = this.getAreaBinding(sr.areaIndex);
                            if (binding && binding.anim !== undefined && binding.index !== undefined) {
                                anim = binding.anim;
                                frameIdx = Number(binding.index);
                            }
                        }
                        const frameCanvas = (typeof this.currentSprite.getFrame === 'function') ? this.currentSprite.getFrame(anim, frameIdx) : null;
                        const entries = [];
                        if (frameCanvas) {
                            const ctx = frameCanvas.getContext('2d');
                            let img = null;
                            try { img = ctx.getImageData(minX, minY, maxX - minX + 1, maxY - minY + 1); } catch (e) { img = null; }
                            for (let yy = minY; yy <= maxY; yy++) {
                                for (let xx = minX; xx <= maxX; xx++) {
                                    let r=0,gc=0,b=0,a=0;
                                    if (img) {
                                        const lx = xx - minX, ly = yy - minY;
                                        const idx = (ly * img.width + lx) * 4;
                                        r = img.data[idx]; gc = img.data[idx+1]; b = img.data[idx+2]; a = img.data[idx+3];
                                    }
                                    entries.push({ x: xx, y: yy, r, g: gc, b, a, anim, frameIdx });
                                }
                            }
                        } else {
                            for (let yy = minY; yy <= maxY; yy++) for (let xx = minX; xx <= maxX; xx++) entries.push({ x: xx, y: yy, r:0, g:0, b:0, a:0, anim, frameIdx });
                        }
                        const pos = this.getPos(this.mouse && this.mouse.pos) || {};
                        const origin = (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) ? { ox: pos.x, oy: pos.y } : null;
                        this._animateFillSelected(entries, anim, frameIdx, 220, origin);
                    } catch (e) {
                        // fallback: immediate region paint
                        const sr = this.selectionRegion;
                        const minX = Math.min(sr.start.x, sr.end.x);
                        const minY = Math.min(sr.start.y, sr.end.y);
                        const maxX = Math.max(sr.start.x, sr.end.x);
                        const maxY = Math.max(sr.start.y, sr.end.y);
                        let anim = this.selectedAnimation; let frameIdx = this.selectedFrame;
                        if (this.tilemode && sr && typeof sr.areaIndex === 'number') {
                            const binding = this.getAreaBinding(sr.areaIndex);
                            if (binding && binding.anim !== undefined && binding.index !== undefined) { anim = binding.anim; frameIdx = Number(binding.index); }
                        }
                        for (let yy = minY; yy <= maxY; yy++) for (let xx = minX; xx <= maxX; xx++) writePixel(anim, frameIdx, xx, yy);
                    }
                } else {
                    window.Debug && window.Debug.log && window.Debug.log('drawSelected: no selection to draw into');
                }

                if (typeof sheet._rebuildSheetCanvas === 'function') try { sheet._rebuildSheetCanvas(); } catch (e) {}
                window.Debug && window.Debug.log && window.Debug.log('drawSelected applied to ' + applied + ' pixels');
            } catch (err) {
                window.Debug && window.Debug.error && window.Debug.error('drawSelected failed: ' + err);
            }
        });

        // Debug: procedural textures on the current frame.
        // texture(type, ...args)
        // 1) texture("pointLight", centerX, centerY, gradStart, gradEnd, lerpCenter)
        // 2) texture("points", count, color, seed=1)
        // 3) texture("linear", gradStart, gradEnd, lerpCenter, angleDeg)
        window.Debug.createSignal('texture', (type, ...args) => {
            try {
                const sheet = this.currentSprite;
                const anim = this.selectedAnimation;
                const frameIdx = this.selectedFrame;
                if (!sheet) return false;
                const frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, frameIdx) : null;
                if (!frameCanvas) return false;

                const px = frameCanvas.width;
                const py = frameCanvas.height;
                const ctx = frameCanvas.getContext('2d');
                let img;
                try { img = ctx.getImageData(0, 0, px, py); } catch (e) { return false; }
                const data = img.data;

                const clamp01 = (v) => Math.max(0, Math.min(1, v));

                // Since Debug's input parser naively splits on commas, array literals like
                // [0,0,0,0] arrive as multiple arguments ("[0", 0, 0, "0]"). We first
                // normalize the raw args back into array-like strings where possible.
                const normalizeArgs = (raw) => {
                    const out = [];
                    for (let i = 0; i < raw.length; i++) {
                        const v = raw[i];
                        if (typeof v === 'string' && v.indexOf('[') !== -1 && v.indexOf(']') === -1) {
                            let buf = String(v);
                            while (buf.indexOf(']') === -1 && i + 1 < raw.length) {
                                i++;
                                buf += ',' + String(raw[i]);
                            }
                            out.push(buf);
                        } else {
                            out.push(v);
                        }
                    }
                    return out;
                };

                const normArgs = normalizeArgs(args);

                // Parse a color spec which may be an array [r,g,b,a, 'rgba'|'hsva'] or any
                // Color.convertColor-compatible input.
                const parseColorSpec = (spec) => {
                    try {
                        // Allow bracketed array syntax passed as a single string, e.g. "[0,0,0,0]".
                        if (typeof spec === 'string') {
                            const t = spec.trim();
                            if (t[0] === '[' && t.indexOf(']') !== -1) {
                                try {
                                    const arr = JSON.parse(t.replace(/'/g, '"'));
                                    spec = arr;
                                } catch (e) {
                                    // fall through and let other handlers try
                                }
                            }
                        }
                        if (Array.isArray(spec) && spec.length >= 3) {
                            const v0 = Number(spec[0]) || 0;
                            const v1 = Number(spec[1]) || 0;
                            const v2 = Number(spec[2]) || 0;
                            let va = (spec[3] === undefined || spec[3] === null) ? 1 : Number(spec[3]);
                            let mode = String(spec[4] || 'rgba').toLowerCase();
                            if (mode.indexOf('hsv') !== -1) {
                                // Treat as HSVA. H in [0,1] or [0,360], S/V/A in [0,1] (A also accepts 0-255).
                                let h = v0;
                                let s = v1;
                                let vv = v2;
                                if (h > 1) h = h / 360;
                                s = clamp01(s);
                                vv = clamp01(vv);
                                if (va > 1) va = va / 255;
                                va = clamp01(va);
                                return { color: new Color(h, s, vv, va, 'hsv'), space: 'hsv' };
                            } else {
                                // Treat as RGBA. R/G/B in 0-255, A in [0,1] or 0-255.
                                let a = va;
                                if (a > 1) a = a / 255;
                                a = clamp01(a);
                                return { color: new Color(v0, v1, v2, a, 'rgb'), space: 'rgb' };
                            }
                        }
                        const col = Color.convertColor(spec);
                        return { color: col, space: (col.type === 'hsv' ? 'hsv' : 'rgb') };
                    } catch (e) {
                        return { color: Color.fromHex('#000000FF'), space: 'rgb' };
                    }
                };

                const mixColors = (infoA, infoB, t) => {
                    t = clamp01(t);
                    const useHsv = (infoA.space === 'hsv' || infoB.space === 'hsv');
                    if (useHsv) {
                        const c0 = infoA.color.toHsv();
                        const c1 = infoB.color.toHsv();
                        const h = c0.a + (c1.a - c0.a) * t;
                        const s = c0.b + (c1.b - c0.b) * t;
                        const v = c0.c + (c1.c - c0.c) * t;
                        const a = c0.d + (c1.d - c0.d) * t;
                        const rgb = new Color(h, s, v, a, 'hsv').toRgb();
                        return { r: rgb.a, g: rgb.b, b: rgb.c, a: rgb.d };
                    }
                    const c0 = infoA.color.toRgb();
                    const c1 = infoB.color.toRgb();
                    const r = c0.a + (c1.a - c0.a) * t;
                    const g = c0.b + (c1.b - c0.b) * t;
                    const b = c0.c + (c1.c - c0.c) * t;
                    const a = c0.d + (c1.d - c0.d) * t;
                    return { r, g, b, a };
                };

                const writePixel = (x, y, col) => {
                    if (x < 0 || y < 0 || x >= px || y >= py) return;
                    const idx = (y * px + x) * 4;
                    data[idx]   = Math.max(0, Math.min(255, Math.round(col.r || 0)));
                    data[idx+1] = Math.max(0, Math.min(255, Math.round(col.g || 0)));
                    data[idx+2] = Math.max(0, Math.min(255, Math.round(col.b || 0)));
                    const alpha = (col.a === undefined || col.a === null) ? 1 : col.a;
                    const a255 = Math.max(0, Math.min(255, Math.round(alpha * 255)));
                    data[idx+3] = a255;
                };

                const kind = String(type || '').toLowerCase();

                if (kind === 'pointlight') {
                    const cx = Number(normArgs[0]);
                    const cy = Number(normArgs[1]);
                    const startInfo = parseColorSpec(normArgs[2] !== undefined ? normArgs[2] : ['#000000']);
                    const endInfo = parseColorSpec(normArgs[3] !== undefined ? normArgs[3] : ['#FFFFFFFF']);
                    const bias = clamp01(normArgs[4] !== undefined ? Number(normArgs[4]) : 0);

                    const centerX = Number.isFinite(cx) ? cx : (px - 1) / 2;
                    const centerY = Number.isFinite(cy) ? cy : (py - 1) / 2;
                    // maximum distance to any corner for radial falloff
                    const corners = [
                        { x: 0, y: 0 },
                        { x: px - 1, y: 0 },
                        { x: 0, y: py - 1 },
                        { x: px - 1, y: py - 1 }
                    ];
                    let maxR = 1;
                    for (const c of corners) {
                        const dx = c.x - centerX;
                        const dy = c.y - centerY;
                        const d = Math.sqrt(dx*dx + dy*dy);
                        if (d > maxR) maxR = d;
                    }

                    for (let y = 0; y < py; y++) {
                        for (let x = 0; x < px; x++) {
                            const dx = x - centerX;
                            const dy = y - centerY;
                            const dist = Math.sqrt(dx*dx + dy*dy);
                            let tRaw = dist / maxR;
                            if (!Number.isFinite(tRaw)) tRaw = 0;
                            tRaw = clamp01(tRaw);
                            // Bias towards center: blend linear and quadratic falloff.
                            const t = (1 - bias) * tRaw + bias * tRaw * tRaw;
                            const col = mixColors(startInfo, endInfo, t);
                            writePixel(x, y, col);
                        }
                    }
                } else if (kind === 'points') {
                    const count = Math.max(0, Math.floor(Number(normArgs[0]) || 0));
                    const colorInfo = parseColorSpec(normArgs[1] !== undefined ? normArgs[1] : ['#FFFFFFFF']);
                    let seed = normArgs[2] !== undefined ? Number(normArgs[2]) : 1;
                    if (!Number.isFinite(seed) || seed === 0) seed = 1;
                    const rng = () => {
                        seed = (seed * 1664525 + 1013904223) >>> 0;
                        return seed / 4294967296;
                    };

                    const col = mixColors(colorInfo, colorInfo, 0); // just normalize to RGBA
                    for (let i = 0; i < count; i++) {
                        const x = Math.floor(rng() * px);
                        const y = Math.floor(rng() * py);
                        writePixel(x, y, col);
                    }
                } else if (kind === 'linear') {
                    const startInfo = parseColorSpec(normArgs[0] !== undefined ? normArgs[0] : ['#000000']);
                    const endInfo = parseColorSpec(normArgs[1] !== undefined ? normArgs[1] : ['#FFFFFFFF']);
                    const bias = clamp01(normArgs[2] !== undefined ? Number(normArgs[2]) : 0.5);
                    const angleDeg = normArgs[3] !== undefined ? Number(normArgs[3]) : 0;
                    const angleRad = (Number.isFinite(angleDeg) ? angleDeg : 0) * Math.PI / 180;
                    const dxDir = Math.cos(angleRad) || 1;
                    const dyDir = Math.sin(angleRad) || 0;
                    const cx = (px - 1) / 2;
                    const cy = (py - 1) / 2;

                    // Compute maximum projection length to normalize into [0,1].
                    const corners = [
                        { x: 0, y: 0 },
                        { x: px - 1, y: 0 },
                        { x: 0, y: py - 1 },
                        { x: px - 1, y: py - 1 }
                    ];
                    let maxProj = 1;
                    for (const c of corners) {
                        const vx = c.x - cx;
                        const vy = c.y - cy;
                        const p = Math.abs(vx * dxDir + vy * dyDir);
                        if (p > maxProj) maxProj = p;
                    }

                    for (let y = 0; y < py; y++) {
                        for (let x = 0; x < px; x++) {
                            const vx = x - cx;
                            const vy = y - cy;
                            const proj = vx * dxDir + vy * dyDir;
                            let tRaw = (proj / maxProj + 1) * 0.5; // map [-maxProj,maxProj] -> [0,1]
                            if (!Number.isFinite(tRaw)) tRaw = 0;
                            tRaw = clamp01(tRaw);
                            const t = (1 - bias) * tRaw + bias * tRaw * tRaw;
                            const col = mixColors(startInfo, endInfo, t);
                            writePixel(x, y, col);
                        }
                    }
                } else {
                    // unknown texture type
                    return false;
                }

                // write back and update packed sheet
                try { ctx.putImageData(img, 0, 0); } catch (e) { return false; }
                if (typeof sheet._rebuildSheetCanvas === 'function') {
                    try { sheet._rebuildSheetCanvas(); } catch (e) {}
                }
                return true;
            } catch (err) {
                window.Debug && window.Debug.error && window.Debug.error('texture signal failed: ' + err);
                return false;
            }
        });

        // Register debug signals for onion-skin control: layerAlpha(alpha), toggleOnion()
        window.Debug.createSignal('layerAlpha', (alpha) => {
            try {
                const a = Number(alpha);
                if (Number.isFinite(a)) {
                    if (this.stateController) this.stateController.setOnionAlpha(a);
                    else this.onionAlpha = Math.max(0, Math.min(1, a));
                    console.log('onionAlpha set to', this.onionAlpha);
                    return this.onionAlpha;
                }
            } catch (e) { /* ignore */ }
            return null;
        });
        window.Debug.createSignal('toggleOnion', () => {
            try {
                if (this.stateController) this.stateController.toggleOnionSkin();
                else this.onionSkin = !(typeof this.onionSkin === 'boolean' ? this.onionSkin : true);
                console.log('onionSkin toggled to', this.onionSkin);
                return this.onionSkin;
            } catch (e) { /* ignore */ }
            return null;
        });

        // Temporary debug helper: clear all rooms from firebase.
        window.Debug.createSignal('clearserver', async () => {
            try {
                if (!this.server || typeof this.server.clearAllRooms !== 'function') return false;
                await this.server.clearAllRooms();
                try { console.log('clearserver: removed all rooms'); } catch (e) {}
                return true;
            } catch (e) {
                try { console.warn('clearserver failed', e); } catch (er) {}
                return false;
            }
        });

        // Debug: show multiplayer menu (hidden by default). Call via Debug signal to unhide.
        window.Debug.createSignal('enableColab', () => {
            try {
                if (typeof window.showMultiplayerMenu === 'function') {
                    return !!window.showMultiplayerMenu();
                }
                const el = document.getElementById('multiplayer-menu');
                if (el) {
                    el.style.display = 'flex';
                    try { if (this.server && typeof this.server.unpause === 'function') this.server.unpause(); } catch (e) {}
                    return true;
                }
            } catch (e) {}
            return false;
        });

        // Debug: set player name (persisted) and send/receive simple chat messages
        window.Debug.createSignal('name', (n) => {
            try {
                const name = (typeof n === 'string') ? n.trim().slice(0, 64) : String(n || '').slice(0,64);
                this.playerName = name;
                if (this.saver && typeof this.saver.set === 'function') {
                    try { this.saver.set('player_name', name); } catch (e) {}
                }
                console.log('name set to', name);
                return true;
            } catch (e) { return false; }
        });
        window.Debug.createSignal('msg', (text) => {
            try {
                if (!text) return false;
                const body = String(text);
                const from = this.playerName || this.clientId || 'anon';
                const payload = { from, text: body, time: Date.now(), client: this.clientId };
                const id = (payload.time || Date.now()) + '_' + Math.random().toString(36).slice(2,6);
                // send via current collab transport if available
                try {
                    if (this._canSendCollab()) {
                        const diff = {};
                        diff['messages/' + id] = payload;
                        this._sendCollabDiff(diff);
                    }
                } catch (e) {}
                // also locally log/display
                try { console.log('[msg] ' + from + ': ' + body); } catch (e) {}
                try { if (window.Debug && window.Debug.log) window.Debug.log('[msg] ' + from + ': ' + body); } catch (e) {}
                return true;
            } catch (e) { return false; }
        });

        // collabMode('firebase-diff'|'webrtc') -> switch active transport mode.
        window.Debug.createSignal('collabMode', (mode = 'firebase-diff') => {
            try {
                const normalized = String(mode || 'firebase-diff').trim().toLowerCase();
                const nextMode = (normalized === 'webrtc') ? 'webrtc' : 'firebase-diff';
                const ok = this.configureCollabTransport({ mode: nextMode });
                if (ok) {
                    try { console.log('collab mode ->', nextMode); } catch (e) {}
                    return nextMode;
                }
            } catch (e) { /* ignore */ }
            return null;
        });

        // collabHandshakeOnly(true|false) -> in webrtc mode, disable Firebase data writes.
        window.Debug.createSignal('collabHandshakeOnly', (enabled = true) => {
            try {
                const next = !!enabled;
                this.setCollabHandshakeOnly(next);
                try { console.log('collab handshakeOnly ->', next); } catch (e) {}
                return next;
            } catch (e) { /* ignore */ }
            return null;
        });

        // collabSignal(type, payload) -> send a handshake/signaling payload via signaling channel.
        window.Debug.createSignal('collabSignal', (type, payload = {}) => {
            try {
                const signalType = (typeof type === 'string' && type.trim()) ? type.trim() : 'signal';
                const data = (payload && typeof payload === 'object') ? payload : { value: payload };
                const signal = {
                    signal: {
                        type: signalType,
                        payload: data,
                        client: this.clientId,
                        time: Date.now()
                    }
                };
                if (!this._canSendSignal()) return false;
                return !!this._sendHandshakeSignal(signal);
            } catch (e) {
                return false;
            }
        });

        // Start/stop WebRTC handshake + data-channel bridge.
        window.Debug.createSignal('webrtcStart', async (offer = null) => {
            try {
                if (!this.webrtcCollab || typeof this.webrtcCollab.start !== 'function') return false;
                return !!(await this.webrtcCollab.start({ offer: (typeof offer === 'boolean') ? offer : null }));
            } catch (e) {
                return false;
            }
        });
        window.Debug.createSignal('webrtcStop', () => {
            try {
                if (!this.webrtcCollab || typeof this.webrtcCollab.stop !== 'function') return false;
                this.webrtcCollab.stop();
                return true;
            } catch (e) {
                return false;
            }
        });
        window.Debug.createSignal('webrtcEnable', async () => {
            try {
                this.configureCollabTransport({ mode: 'webrtc', handshakeOnly: true });
                if (!this.webrtcCollab || typeof this.webrtcCollab.start !== 'function') return false;
                return !!(await this.webrtcCollab.start({ offer: null }));
            } catch (e) {
                return false;
            }
        });
        window.Debug.createSignal('webrtcStatus', () => {
            try {
                const channel = this.webrtcCollab && this.webrtcCollab.channel ? this.webrtcCollab.channel : null;
                const readyState = channel ? channel.readyState : 'none';
                const transportMode = this.localState?.collab?.transportMode || this.collabTransport?.mode || 'unknown';
                const handshakeOnly = !!this.localState?.collab?.handshakeOnly;
                const canData = this._canSendCollab();
                const canSignal = this._canSendSignal();
                const status = {
                    started: !!(this.webrtcCollab && this.webrtcCollab.started),
                    channelReadyState: readyState,
                    transportMode,
                    handshakeOnly,
                    canSendData: !!canData,
                    canSendSignal: !!canSignal,
                    allowFirebaseData: !!(this.collabTransport && this.collabTransport.allowFirebaseData)
                };
                try { console.log('webrtcStatus', status); } catch (e) {}
                return status;
            } catch (e) {
                return null;
            }
        });
        window.Debug.createSignal('syncReset', () => {
            try {
                const diff = {
                    'sync/status': 'done',
                    'sync/paused': false,
                    'sync/requestId': null,
                    'sync/requester': null,
                    'sync/snapshot': null,
                    'sync/acks': null,
                    'sync/message': 'manual-reset'
                };
                return !!this._sendHandshakeSignal(diff);
            } catch (e) {
                return false;
            }
        });

        window.Debug.createSignal('save', (name) => { try { this.doSave(name); } catch (e) { console.warn('debug save failed', e); } });
        // clearSave([name]) -> remove saved sheet+meta for given name
        window.Debug.createSignal('clearSave', (name) => {
            try {
                const n = name || (this.currentSprite && this.currentSprite.name) || 'spritesheet';
                if (this.saver && typeof this.saver.remove === 'function') {
                    try { this.saver.remove('sprites/' + n); } catch (e) {}
                    try { this.saver.remove('sprites_meta/' + n); } catch (e) {}
                }
            } catch (e) { console.warn('debug clearSave failed', e); }
        });
        // autosave(enabled:boolean, seconds?:number) -> toggle autosave and optionally set interval
        window.Debug.createSignal('autosave', (enabled, seconds) => {
            try {
                this._autosaveEnabled = !!enabled;
                if (typeof seconds === 'number' && seconds > 0) {
                    const minSeconds = Math.max(1, Number(this._autosaveMinIntervalSeconds) || 1);
                    this._autosaveIntervalSeconds = Math.max(minSeconds, Math.floor(seconds));
                }
                if (this._autosaveIntervalId) { try { clearInterval(this._autosaveIntervalId); } catch (e) {} this._autosaveIntervalId = null; }
                if (this._autosaveEnabled) {
                    this._autosaveIntervalId = setInterval(() => {
                        if (this._restoringSavedState) return;
                        if (!this._autosaveDirty || this._autosaveInFlight) return;
                        const now = Date.now();
                        const minSeconds = Math.max(1, Number(this._autosaveMinIntervalSeconds) || 1);
                        const everySeconds = Math.max(minSeconds, Number(this._autosaveIntervalSeconds) || 60);
                        if ((now - (Number(this._autosaveLastRunAt) || 0)) < (everySeconds * 1000)) return;
                        this._autosaveInFlight = true;
                        setTimeout(() => {
                            try { this.doSave(); } catch (e) {}
                            finally { this._autosaveInFlight = false; }
                        }, 0);
                    }, 1000);
                }
            } catch (e) { console.warn('debug autosave failed', e); }
        });
    }
    
    // Handle wheel-based panning. 
    panScreen(tickDelta){
        if (this.keys.held('Control')) return;


        let wheelY = 0, wheelX = 0;
        wheelY = this.mouse.wheel();
        wheelX = this.mouse.wheelX();
        
        // Convert wheel deltas to pan velocity impulses. We divide by zoom so panning speed feels consistent at different zoom levels.
        const zX = this.zoom.x;
        const zY = this.zoom.y;
        // combine horizontal movement: native horizontal wheel plus vertical wheel when Shift held

        let horiz = wheelX || 0;
        let vert = wheelY || 0;
        if (this.keys.held('Shift') || this.mouse.held('middle')) {
            horiz += wheelY; // map vertical scroll into horizontal pan
            vert = 0; // suppress vertical pan while Shift is held
        }
        // invert direction so wheel down moves content up (typical UX)
        const impulseX = -horiz * (this.localState.camera.panImpulse) * (1 / zX);
        const impulseY = -vert * (this.localState.camera.panImpulse) * (1 / zY);
        this.panVlos.x += impulseX;
        this.panVlos.y += impulseY;
    }
    
    zoomScreen(tickDelta){
        try {
            if (!this.mouse) return;

            // Get ctrl+wheel delta (only when ctrl was pressed during wheel)
            const delta = this.mouse.wheel(null, false, true) || 0;
            if (!delta) return;

            // Mouse position in screen/canvas coordinates
            const mpos = this.mouse.pos || new Vector(0,0);
            const mx = mpos.x;
            const my = mpos.y;

            // Choose a zoom step. pow(zoomStep, delta) gives smooth steps for small integer deltas.
            // If your mouse reports large delta values, you can reduce sensitivity by using a
            // smaller base (e.g. 1.05) or divide `delta` by a factor.
            // use exponential factor for smooth scaling: factor = exp(zoomStep * delta)
            // zoomStep should be a small number (e.g. -0.001). Negative makes wheel direction
            // match typical UX where ctrl+wheel up zooms in.
            const zoomStep = this.zoomStep || -0.001;
            let desiredFactor = Math.exp(zoomStep * delta);
            // compute desired zooms and clamp to scene limits
            let desiredZoomX = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom.x * desiredFactor));
            let desiredZoomY = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom.y * desiredFactor));

            // Instead of applying immediately, add an impulse to zoom velocity so we smooth over time.
            // The impulse magnitude is proportional to the delta between desired and current zoom.
            const impulseX = (desiredZoomX - this.zoom.x) * (this.zoomImpulse || 8);
            const impulseY = (desiredZoomY - this.zoom.y) * (this.zoomImpulse || 8);
            this.zoomVlos.x += impulseX;
            this.zoomVlos.y += impulseY;

            // store last zoom pos for any UI/debug use
            if (this.zoomPos && typeof this.zoomPos.clone === 'function') {
                this.zoomPos.x = mx;
                this.zoomPos.y = my;
            }
        } catch (e) {
            console.warn('zoomScreen failed', e);
        }
    }
    // Map a screen position (Vector) into frame pixel coordinates.
    // If screenPos omitted, uses this.mouse.pos. Returns {inside, x, y, relX, relY}
    getPos(screenPos = null) {
        try {
            if (!this.currentSprite) return null;
            const sp = screenPos || (this.mouse && this.mouse.pos) || new Vector(0,0);
            let mx = sp.x || 0;
            let my = sp.y || 0;

            // Apply inverse transforms first to get world coordinates, then test against areas
            mx = mx / this.zoom.x - this.offset.x;
            my = my / this.zoom.y - this.offset.y;

            // Fast path for ultra-zoom tilemode: avoid scanning `_drawAreas` entirely.
            if (this.tilemode && this._renderOnlyAllVisible) {
                const baseArea = this.computeDrawArea();
                if (!baseArea) return null;
                const coord = this._worldToTileCoord(mx, my, baseArea.topLeft, baseArea.size);
                if (!coord) return null;
                const idx = this._getAreaIndexForCoord(coord.col, coord.row);
                const tileActive = this._isTileActive(coord.col, coord.row);
                this._activeDrawAreaIndex = null;
                return { inside: false, renderOnly: true, areaIndex: idx, tileCol: coord.col, tileRow: coord.row, tileActive };
            }

            // determine which rendered area (if any) contains this world point
            let area = null;
            let areaCoord = null;
            this._activeDrawAreaIndex = null;
            if (Array.isArray(this._drawAreas) && this._drawAreas.length > 0) {
                for (let i = 0; i < this._drawAreas.length; i++) {
                    const a = this._drawAreas[i];
                    if (!a) continue;
                    if (mx >= a.dstPos.x && my >= a.dstPos.y && mx <= a.dstPos.x + a.dstW && my <= a.dstPos.y + a.dstH) {
                        area = a;
                        this._activeDrawAreaIndex = (typeof a.areaIndex === 'number') ? a.areaIndex : i;
                        break;
                    }
                }
            }

            // fallback to infinite tile coordinate if needed
            if (!area) {
                const baseArea = this.computeDrawArea();
                if (!baseArea) return null;
                const basePos = baseArea.topLeft;
                const tileSize = baseArea.size;
                if (this.tilemode) {
                    const coord = this._worldToTileCoord(mx, my, basePos, tileSize);
                    areaCoord = coord;
                    const pos2 = this._tileCoordToPos(coord.col, coord.row, basePos, tileSize);
                    area = this.computeAreaInfo(pos2, tileSize);
                    this._activeDrawAreaIndex = this._getAreaIndexForCoord(coord.col, coord.row);
                    if (area) area.areaIndex = this._activeDrawAreaIndex;
                } else {
                    area = baseArea;
                }
            }
            if (!area) return null;

            // Ensure render-only flag exists when getPos builds areas itself.
            if (area.renderOnly === undefined) {
                try { area.renderOnly = this._isSimTooSmall(area); } catch (e) { area.renderOnly = false; }
            }

            // If this area is render-only (too small), treat it as non-interactive for pixel edits
            // but still surface tile coordinates and area index so render-only tilemode can paint tiles.
            if (area.renderOnly) {
                this._activeDrawAreaIndex = null;
                const col = (areaCoord && areaCoord.col !== undefined) ? areaCoord.col : (area.tileCol !== undefined ? area.tileCol : null);
                const row = (areaCoord && areaCoord.row !== undefined) ? areaCoord.row : (area.tileRow !== undefined ? area.tileRow : null);
                const tileActive = (!this.tilemode) || (col !== null && row !== null && this._isTileActive(col, row));
                const idx = (typeof area.areaIndex === 'number') ? area.areaIndex : (typeof this._getAreaIndexForCoord === 'function' && col !== null && row !== null ? this._getAreaIndexForCoord(col, row) : null);
                return { inside: false, renderOnly: true, areaIndex: idx, tileCol: col, tileRow: row, tileActive };
            }

            if (mx < area.dstPos.x || my < area.dstPos.y || mx > area.dstPos.x + area.dstW || my > area.dstPos.y + area.dstH) return { inside: false };
            let relX = (mx - area.dstPos.x) / area.dstW;
            let relY = (my - area.dstPos.y) / area.dstH;
            // clamp
            relX = Math.max(0, Math.min(0.9999999, relX));
            relY = Math.max(0, Math.min(0.9999999, relY));
            // if area has a preview transform, map displayed fractional coords back to source fractional coords
            const hitAreaIndex = this._activeDrawAreaIndex;
            if (typeof hitAreaIndex === 'number' && Array.isArray(this._areaTransforms)) {
                const transform = this._areaTransforms[hitAreaIndex];
                if (transform) {
                    const src = this._displayToSourcePixel(relX, relY, transform, this.currentSprite.slicePx);
                    if (src) {
                        relX = src.relX;
                        relY = src.relY;
                    }
                }
            }
            // Attach tile coord metadata and honor inactive tiles by marking inside=false
            if (!areaCoord && typeof this._activeDrawAreaIndex === 'number' && Array.isArray(this._tileIndexToCoord)) {
                areaCoord = this._tileIndexToCoord[this._activeDrawAreaIndex] || null;
            }
            const tileActive = (!this.tilemode) || (areaCoord && this._isTileActive(areaCoord.col, areaCoord.row));
            const px = Math.min(this.currentSprite.slicePx - 1, Math.max(0, Math.floor(relX * this.currentSprite.slicePx)));
            const py = Math.min(this.currentSprite.slicePx - 1, Math.max(0, Math.floor(relY * this.currentSprite.slicePx)));
            const inside = tileActive && !(px === undefined || py === undefined) && (mx >= area.dstPos.x && my >= area.dstPos.y && mx <= area.dstPos.x + area.dstW && my <= area.dstPos.y + area.dstH);
            const renderOnly = !!(area && area.renderOnly);
            return { inside, renderOnly, x: px, y: py, relX, relY, areaIndex: this._activeDrawAreaIndex, tileCol: areaCoord ? areaCoord.col : null, tileRow: areaCoord ? areaCoord.row : null, tileActive };
        } catch (e) {
            return null;
        }
    }

    // Map a frame pixel coordinate (object {x,y} or two args) to a screen Vector for the pixel center.
    getScreenPos(ix, iy = null) {
        try {
            if (ix === undefined || ix === null) return null;
            let x,y;
            if (typeof ix === 'object') { x = ix.x; y = ix.y; }
            else { x = ix; y = iy; }
            // Prefer the last-active area (where the mouse was); fall back to centered area
            let area = null;
            if (typeof this._activeDrawAreaIndex === 'number') {
                if (this._drawAreaIndexMap && typeof this._drawAreaIndexMap.get === 'function') {
                    area = this._drawAreaIndexMap.get(this._activeDrawAreaIndex) || null;
                }
                if (!area && Array.isArray(this._drawAreas)) {
                    const direct = this._drawAreas[this._activeDrawAreaIndex];
                    if (direct) area = direct;
                }
            }
            if (!area) area = this.computeDrawArea();
            if (!area && this.tilemode && typeof this._activeDrawAreaIndex === 'number' && Array.isArray(this._tileIndexToCoord)) {
                const coord = this._tileIndexToCoord[this._activeDrawAreaIndex] || null;
                if (coord) {
                    const baseArea = this.computeDrawArea();
                    if (baseArea) {
                        const pos = this._tileCoordToPos(coord.col, coord.row, baseArea.topLeft, baseArea.size);
                        area = this.computeAreaInfo(pos, baseArea.size);
                    }
                }
            }
            if (!area) return null;
            // compute source fractional center (0..1) for the pixel center
            let srcRelX = (x + 0.5) / this.currentSprite.slicePx;
            let srcRelY = (y + 0.5) / this.currentSprite.slicePx;
            // if this area has a preview transform, map source -> displayed fractional coords
            const transform = (typeof this._activeDrawAreaIndex === 'number' && Array.isArray(this._areaTransforms)) ? this._areaTransforms[this._activeDrawAreaIndex] : null;
            let dispRel = { relX: srcRelX, relY: srcRelY };
            if (transform) {
                const m = this._sourceToDisplayPixel(srcRelX, srcRelY, transform, this.currentSprite.slicePx);
                if (m) dispRel = m;
            }
            let pxCenterX = area.dstPos.x + (dispRel.relX) * area.dstW;
            let pxCenterY = area.dstPos.y + (dispRel.relY) * area.dstH;
            
            // Apply transforms matching draw(): scale(zoom) then translate(offset)
            // Since translate happens in scaled space, we:
            // 1. Add offset (in world space)
            // 2. Multiply by zoom to convert to screen space
            pxCenterX = (pxCenterX + this.offset.x) * this.zoom.x;
            pxCenterY = (pxCenterY + this.offset.y) * this.zoom.y;
            
            return new Vector(pxCenterX, pxCenterY);
        } catch (e) {
            return null;
        }
    }

    getState(path, fallback = undefined, rootObj = null) {
        try {
            const target = rootObj || this.state;
            const pathArr = Array.isArray(path) ? path : [path];
            let cur = target;
            for (const key of pathArr) {
                if (cur == null) return fallback;
                cur = cur[key];
            }
            return (cur === undefined) ? fallback : cur;
        } catch (e) {
            return fallback;
        }
    }

    modifyState(newValue, syncUndo = false, syncColab = false, ...pathArgs){
        const path = (pathArgs.length === 1 && Array.isArray(pathArgs[0])) ? pathArgs[0] : pathArgs;
        if (!path || path.length === 0) return false;
        let current = this.state;
        for (let i = 0; i < path.length - 1; i++){
            const key = path[i];
            if (current[key] === undefined || current[key] === null || typeof current[key] !== 'object') current[key] = {};
            current = current[key];
        }
        current[path[path.length-1]] = newValue;
        return true;
    }

    _sendCollabDiff(diff) {
        try {
            if (this.collabTransport && typeof this.collabTransport.sendDiff === 'function') {
                return !!this.collabTransport.sendDiff(diff);
            }
        } catch (e) {
            return false;
        }
        return false;
    }

    configureCollabTransport(options = {}) {
        try {
            if (!this.collabTransport || typeof this.collabTransport.setMode !== 'function') return false;
            const collabState = (this.localState && this.localState.collab) ? this.localState.collab : {};
            let mode = options.mode || collabState.transportMode || 'webrtc';
            const handshakeOnly = (typeof options.handshakeOnly === 'boolean')
                ? options.handshakeOnly
                : !!collabState.handshakeOnly;

            if (handshakeOnly) mode = 'webrtc';

            const modeOptions = {
                allowFirebaseData: !handshakeOnly
            };
            if (Object.prototype.hasOwnProperty.call(options, 'sendDiff')) modeOptions.sendDiff = options.sendDiff;
            if (Object.prototype.hasOwnProperty.call(options, 'sendSignal')) modeOptions.sendSignal = options.sendSignal;

            this.collabTransport.setMode(mode, modeOptions);

            if (this.localState && this.localState.collab) {
                this.localState.collab.transportMode = mode;
                this.localState.collab.handshakeOnly = handshakeOnly;
                this.localState.collab.webrtcReady = !!(this.collabTransport && this.collabTransport.webrtcSender);
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    bindWebRTCCollab(sendDiff, options = {}) {
        try {
            if (typeof sendDiff !== 'function') return false;
            const handshakeOnly = (typeof options.handshakeOnly === 'boolean') ? options.handshakeOnly : true;
            return this.configureCollabTransport({ mode: 'webrtc', sendDiff, handshakeOnly });
        } catch (e) {
            return false;
        }
    }

    setCollabHandshakeOnly(enabled = true) {
        const next = !!enabled;
        try {
            const mode = (this.localState && this.localState.collab && this.localState.collab.transportMode)
                ? this.localState.collab.transportMode
                : 'firebase-diff';
            this.configureCollabTransport({ mode, handshakeOnly: next });
        } catch (e) {}
        return next;
    }

    _canSendCollab() {
        try {
            if (this.collabTransport && typeof this.collabTransport.isAvailable === 'function') {
                return !!this.collabTransport.isAvailable('data');
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    _canSendSignal() {
        try {
            if (this.collabTransport && typeof this.collabTransport.isAvailable === 'function') {
                return !!this.collabTransport.isAvailable('signal');
            }
            return !!(this.server && typeof this.server.sendDiff === 'function');
        } catch (e) {
            return false;
        }
    }

    _sendHandshakeSignal(signalPayload) {
        try {
            if (!signalPayload || typeof signalPayload !== 'object') return false;
            if (this.collabTransport && typeof this.collabTransport.sendSignal === 'function') {
                return !!this.collabTransport.sendSignal(signalPayload);
            }
        } catch (e) {
            return false;
        }
        return false;
    }

    _serializeTilemapState() {
        try {
            this._ensureLayerState();
            const activeTiles = (this._tileActive && typeof this._tileActive.values === 'function')
                ? Array.from(this._tileActive.values())
                : [];

            const bindings = [];
            if (Array.isArray(this._areaBindings) && Array.isArray(this._tileIndexToCoord)) {
                for (let i = 0; i < this._areaBindings.length; i++) {
                    const b = this._areaBindings[i];
                    if (!b || typeof b !== 'object') continue;
                    const coord = this._tileIndexToCoord[i];
                    if (!coord || !Number.isFinite(coord.col) || !Number.isFinite(coord.row)) continue;
                    const mf = Array.isArray(b.multiFrames)
                        ? b.multiFrames.filter(v => Number.isFinite(v)).map(v => Number(v))
                        : null;
                    bindings.push({
                        col: Number(coord.col),
                        row: Number(coord.row),
                        anim: b.anim,
                        index: Number(b.index),
                        multiFrames: (mf && mf.length > 0) ? mf : null
                    });
                }
            }

            const transforms = [];
            if (Array.isArray(this._areaTransforms) && Array.isArray(this._tileIndexToCoord)) {
                for (let i = 0; i < this._areaTransforms.length; i++) {
                    const t = this._areaTransforms[i];
                    if (!t || typeof t !== 'object') continue;
                    const coord = this._tileIndexToCoord[i];
                    if (!coord || !Number.isFinite(coord.col) || !Number.isFinite(coord.row)) continue;
                    transforms.push({
                        col: Number(coord.col),
                        row: Number(coord.row),
                        rot: Number(t.rot || 0),
                        flipH: !!t.flipH
                    });
                }
            }

            const payload = {
                enabled: !!this.tilemode,
                cols: Number(this.tileCols || 3),
                rows: Number(this.tileRows || 3),
                activeTileLayerIndex: Math.max(0, Number(this._activeTileLayerIndex) | 0),
                activeTiles,
                bindings,
                transforms,
                tileLayers: [],
                waypoints: this._getWaypointCoords(false).map((wp) => ({ col: wp.col, row: wp.row }))
            };

            if (Array.isArray(this._tileLayers)) {
                for (let li = 0; li < this._tileLayers.length; li++) {
                    const layer = this._tileLayers[li] || {};
                    const layerBindings = [];
                    const layerTransforms = [];

                    const srcBindings = Array.isArray(layer.bindings) ? layer.bindings : [];
                    for (let i = 0; i < srcBindings.length; i++) {
                        const b = srcBindings[i];
                        if (!b || typeof b !== 'object') continue;
                        const coord = this._tileIndexToCoord && this._tileIndexToCoord[i] ? this._tileIndexToCoord[i] : null;
                        if (!coord || !Number.isFinite(coord.col) || !Number.isFinite(coord.row)) continue;
                        const mf = Array.isArray(b.multiFrames)
                            ? b.multiFrames.filter(v => Number.isFinite(v)).map(v => Number(v))
                            : null;
                        layerBindings.push({
                            col: Number(coord.col),
                            row: Number(coord.row),
                            anim: b.anim,
                            index: Number(b.index),
                            multiFrames: (mf && mf.length > 0) ? mf : null
                        });
                    }

                    const srcTransforms = Array.isArray(layer.transforms) ? layer.transforms : [];
                    for (let i = 0; i < srcTransforms.length; i++) {
                        const t = srcTransforms[i];
                        if (!t || typeof t !== 'object') continue;
                        const coord = this._tileIndexToCoord && this._tileIndexToCoord[i] ? this._tileIndexToCoord[i] : null;
                        if (!coord || !Number.isFinite(coord.col) || !Number.isFinite(coord.row)) continue;
                        layerTransforms.push({
                            col: Number(coord.col),
                            row: Number(coord.row),
                            rot: Number(t.rot || 0),
                            flipH: !!t.flipH
                        });
                    }

                    payload.tileLayers.push({
                        name: String((layer && layer.name) || ('Tile Layer ' + (li + 1))),
                        visibility: this._normalizeTileLayerVisibility(layer && layer.visibility, 0),
                        bindings: layerBindings,
                        transforms: layerTransforms
                    });
                }
            }

            this.modifyState(payload.enabled, false, false, ['tilemap', 'enabled']);
            this.modifyState(payload.cols, false, false, ['tilemap', 'cols']);
            this.modifyState(payload.rows, false, false, ['tilemap', 'rows']);
            this.modifyState(payload.activeTileLayerIndex, false, false, ['tilemap', 'activeTileLayerIndex']);
            this.modifyState(payload.activeTiles, false, false, ['tilemap', 'activeTiles']);
            this.modifyState(payload.bindings, false, false, ['tilemap', 'bindings']);
            this.modifyState(payload.transforms, false, false, ['tilemap', 'transforms']);
            this.modifyState(payload.tileLayers, false, false, ['tilemap', 'tileLayers']);
            this.modifyState(payload.waypoints, false, false, ['tilemap', 'waypoints']);
            return payload;
        } catch (e) {
            return null;
        }
    }

    _applyTilemapState(tilemapState) {
        try {
            if (!tilemapState || typeof tilemapState !== 'object') return false;
            const cols = Math.max(1, Math.floor(Number(tilemapState.cols || this.tileCols || 3)));
            const rows = Math.max(1, Math.floor(Number(tilemapState.rows || this.tileRows || 3)));

            if (this.stateController) {
                this.stateController.setTileGrid(cols, rows);
                this.stateController.setTilemode(!!tilemapState.enabled);
            } else {
                this.tilemode = !!tilemapState.enabled;
                this.tileCols = cols;
                this.tileRows = rows;
            }

            this._tileActive = new Set();
            this._tileCoordToIndex = new Map();
            this._tileIndexToCoord = [];

            const active = Array.isArray(tilemapState.activeTiles) ? tilemapState.activeTiles : [];
            if (active.length > 0) {
                for (const key of active) {
                    const p = this._parseTileKey(key);
                    if (!p) continue;
                    this._activateTile(p.col, p.row, false);
                }
            } else {
                const midC = Math.floor(cols / 2);
                const midR = Math.floor(rows / 2);
                for (let row = 0; row < rows; row++) {
                    for (let col = 0; col < cols; col++) {
                        const tc = col - midC;
                        const tr = row - midR;
                        this._activateTile(tc, tr, false);
                    }
                }
            }

            this._areaBindings = [];
            this._areaTransforms = [];

            this._ensureLayerState();
            this._tileLayers = [];

            const incomingLayers = this._normalizeIncomingTileLayers(tilemapState.tileLayers);
            if (incomingLayers.length > 0) {
                for (let li = 0; li < incomingLayers.length; li++) {
                    const srcRaw = incomingLayers[li];
                    const srcLayer = (srcRaw && typeof srcRaw === 'object') ? srcRaw : { name: String(srcRaw || '') };
                    const outLayer = {
                        name: String(srcLayer.name || ('Tile Layer ' + (li + 1))),
                        visibility: this._normalizeTileLayerVisibility(srcLayer.visibility, 0),
                        bindings: [],
                        transforms: []
                    };

                    const layerBindings = Array.isArray(srcLayer.bindings) ? srcLayer.bindings : [];
                    for (const b of layerBindings) {
                        if (!b || typeof b !== 'object') continue;
                        let idx = null;
                        if (Number.isFinite(b.col) && Number.isFinite(b.row)) {
                            idx = this._getAreaIndexForCoord(Number(b.col), Number(b.row));
                            this._activateTile(Number(b.col), Number(b.row), false);
                        } else if (Number.isFinite(b.areaIndex)) {
                            idx = Number(b.areaIndex);
                        }
                        if (!Number.isFinite(idx)) continue;
                        const mf = Array.isArray(b.multiFrames)
                            ? b.multiFrames.filter(v => Number.isFinite(v)).map(v => Number(v))
                            : null;
                        outLayer.bindings[idx | 0] = {
                            anim: b.anim,
                            index: Number(b.index),
                            multiFrames: (mf && mf.length > 0) ? mf : null
                        };
                    }

                    const layerTransforms = Array.isArray(srcLayer.transforms) ? srcLayer.transforms : [];
                    for (const t of layerTransforms) {
                        if (!t || typeof t !== 'object') continue;
                        let idx = null;
                        if (Number.isFinite(t.col) && Number.isFinite(t.row)) {
                            idx = this._getAreaIndexForCoord(Number(t.col), Number(t.row));
                            this._activateTile(Number(t.col), Number(t.row), false);
                        } else if (Number.isFinite(t.areaIndex)) {
                            idx = Number(t.areaIndex);
                        }
                        if (!Number.isFinite(idx)) continue;
                        outLayer.transforms[idx | 0] = {
                            rot: Number(t.rot || 0),
                            flipH: !!t.flipH
                        };
                    }

                    this._tileLayers.push(outLayer);
                }

                if (this._tileLayers.length <= 0) {
                    this._tileLayers = [{ name: 'Tile Layer 1', visibility: 0, bindings: [], transforms: [] }];
                }
                this._activeTileLayerIndex = this._resolveTileLayerIndex(tilemapState.activeTileLayerIndex, false);
                this._syncActiveTileLayerReferences();
            }

            if (incomingLayers.length <= 0) {
                const incomingBindings = Array.isArray(tilemapState.bindings) ? tilemapState.bindings : [];
                for (let i = 0; i < incomingBindings.length; i++) {
                    const b = incomingBindings[i];
                    if (!b || typeof b !== 'object') continue;

                    let idx = null;
                    if (Number.isFinite(b.col) && Number.isFinite(b.row)) {
                        idx = this._getAreaIndexForCoord(Number(b.col), Number(b.row));
                        this._activateTile(Number(b.col), Number(b.row), false);
                    } else if (Number.isFinite(b.areaIndex)) {
                        // Legacy fallback (index-based payload)
                        idx = Number(b.areaIndex);
                    } else if (Array.isArray(this._tileIndexToCoord) && this._tileIndexToCoord[i]) {
                        idx = i;
                    }
                    if (!Number.isFinite(idx)) continue;

                    const mf = Array.isArray(b.multiFrames)
                        ? b.multiFrames.filter(v => Number.isFinite(v)).map(v => Number(v))
                        : null;
                    this._setAreaBindingAtIndex(idx, {
                        anim: b.anim,
                        index: Number(b.index),
                        multiFrames: (mf && mf.length > 0) ? mf : null
                    }, false);
                }

                const incomingTransforms = Array.isArray(tilemapState.transforms) ? tilemapState.transforms : [];
                for (let i = 0; i < incomingTransforms.length; i++) {
                    const t = incomingTransforms[i];
                    if (!t || typeof t !== 'object') continue;

                    let idx = null;
                    if (Number.isFinite(t.col) && Number.isFinite(t.row)) {
                        idx = this._getAreaIndexForCoord(Number(t.col), Number(t.row));
                        this._activateTile(Number(t.col), Number(t.row), false);
                    } else if (Number.isFinite(t.areaIndex)) {
                        // Legacy fallback (index-based payload)
                        idx = Number(t.areaIndex);
                    } else if (Array.isArray(this._tileIndexToCoord) && this._tileIndexToCoord[i]) {
                        idx = i;
                    }
                    if (!Number.isFinite(idx)) continue;

                    this._setAreaTransformAtIndex(idx, {
                        rot: Number(t.rot || 0),
                        flipH: !!t.flipH
                    }, false);
                }

                this._adoptCurrentTileArraysIntoActiveLayer();
            }

            const waypointKeys = [];
            const incomingWaypoints = Array.isArray(tilemapState.waypoints) ? tilemapState.waypoints : [];
            for (const wp of incomingWaypoints) {
                if (!wp) continue;
                const c = Number(wp.col);
                const r = Number(wp.row);
                if (!Number.isFinite(c) || !Number.isFinite(r)) continue;
                waypointKeys.push(this._tileKey(c | 0, r | 0));
            }
            this._setWaypointKeys(waypointKeys, false, true);
            this._adoptCurrentTileArraysIntoActiveLayer();

            this.modifyState(this.tilemode, false, false, ['tilemap', 'enabled']);
            this.modifyState(this.tileCols, false, false, ['tilemap', 'cols']);
            this.modifyState(this.tileRows, false, false, ['tilemap', 'rows']);
            this.modifyState(Math.max(0, Number(this._activeTileLayerIndex) | 0), false, false, ['tilemap', 'activeTileLayerIndex']);
            this.modifyState(Array.from(this._tileActive.values()), false, false, ['tilemap', 'activeTiles']);
            this.modifyState(this._areaBindings, false, false, ['tilemap', 'bindings']);
            this.modifyState(this._areaTransforms, false, false, ['tilemap', 'transforms']);
            this.modifyState(Array.isArray(this._tileLayers) ? this._tileLayers : [], false, false, ['tilemap', 'tileLayers']);
            this.modifyState(this._getWaypointCoords(false).map((wp) => ({ col: wp.col, row: wp.row })), false, false, ['tilemap', 'waypoints']);
            return true;
        } catch (e) {
            console.warn('_applyTilemapState failed', e);
            return false;
        }
    }

    _scheduleTilemapSync() {
        // Tile sync is operation-based now (see `_queueTileOp`) to prevent
        // full-state overwrite races that could revert transforms/bindings.
        return;
    }

    _playSfx(slot, opts) {
        try {
            if (this.sfx && typeof this.sfx.play === 'function') return this.sfx.play(slot, opts);
        } catch (e) {
            /* ignore */
        }
        return null;
    }

    _playBrushSizeSfx(prev, next) {
        const a = Number(prev) || 1;
        const b = Number(next) || 1;
        const diff = Math.abs(b - a);
        if (!Number.isFinite(diff) || diff <= 0) return;
        // Small base volume with a bump for big jumps.
        const volume = Math.max(0.12, Math.min(1, 0.18 + diff * 0.12));
        this._playSfx('brush.size', { volume });
    }

    _anyWorldPixelWouldChange(worldPixels, targetHex) {
        try {
            if (!this.currentSprite || !Array.isArray(worldPixels) || worldPixels.length === 0) return false;
            const sheet = this.currentSprite;
            const slice = sheet.slicePx || 1;
            const rgba = Color.convertColor(targetHex || '#000000').toRgb();
            const tr = Math.round(rgba.a || 0);
            const tg = Math.round(rgba.b || 0);
            const tb = Math.round(rgba.c || 0);
            const ta = Math.round((rgba.d ?? 1) * 255);

            const cache = new Map(); // key -> { data, w, h }
            const getFrameData = (anim, frameIdx) => {
                const key = String(anim) + '::' + String(frameIdx);
                if (cache.has(key)) return cache.get(key);
                const frame = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, frameIdx) : null;
                if (!frame || !frame.getContext) { cache.set(key, null); return null; }
                const ctx = frame.getContext('2d');
                let img = null;
                try { img = ctx.getImageData(0, 0, frame.width, frame.height); } catch (e) { img = null; }
                const entry = img ? { data: img.data, w: frame.width, h: frame.height } : null;
                cache.set(key, entry);
                return entry;
            };

            for (const wp of worldPixels) {
                if (!wp) continue;
                const wx = Number(wp.x);
                const wy = Number(wp.y);
                if (!Number.isFinite(wx) || !Number.isFinite(wy)) continue;
                const t = this._worldPixelToTile(wx, wy, slice);
                if (!t) continue;
                if (this.tilemode && !this._isTileActive(t.col, t.row)) continue;

                let anim = this.selectedAnimation;
                let frameIdx = this.selectedFrame;
                if (this.tilemode && typeof t.areaIndex === 'number') {
                    const bnd = this.getAreaBinding(t.areaIndex);
                    if (bnd && bnd.anim !== undefined && bnd.index !== undefined) {
                        anim = bnd.anim;
                        frameIdx = Number(bnd.index);
                    }
                }

                const fd = getFrameData(anim, frameIdx);
                if (!fd) continue;
                const lx = t.localX | 0;
                const ly = t.localY | 0;
                if (lx < 0 || ly < 0 || lx >= fd.w || ly >= fd.h) continue;
                const idx = (ly * fd.w + lx) * 4;
                if (fd.data[idx] !== tr || fd.data[idx + 1] !== tg || fd.data[idx + 2] !== tb || fd.data[idx + 3] !== ta) {
                    return true;
                }
            }
            return false;
        } catch (e) {
            return true; // fail open: better to play than to miss in weird states
        }
    }

    _startCameraOffsetTween(targetOffset, durationSec = 0.28, targetZoom = null) {
        try {
            const target = (targetOffset && typeof targetOffset.x === 'number' && typeof targetOffset.y === 'number')
                ? targetOffset
                : new Vector(0, 0);
            const current = this.offset && typeof this.offset.clone === 'function'
                ? this.offset.clone()
                : new Vector((this.offset && this.offset.x) || 0, (this.offset && this.offset.y) || 0);
            const zoomCurrent = this.zoom && typeof this.zoom.clone === 'function'
                ? this.zoom.clone()
                : new Vector((this.zoom && this.zoom.x) || 1, (this.zoom && this.zoom.y) || 1);
            const zoomTarget = (targetZoom && typeof targetZoom.x === 'number' && typeof targetZoom.y === 'number')
                ? targetZoom
                : zoomCurrent;
            const dur = Math.max(0.05, Number(durationSec) || 0.28);
            this._cameraOffsetTween = {
                start: current,
                end: new Vector(target.x, target.y),
                zoomStart: new Vector(zoomCurrent.x, zoomCurrent.y),
                zoomEnd: new Vector(zoomTarget.x, zoomTarget.y),
                elapsed: 0,
                duration: dur
            };
            if (this.panVlos) {
                this.panVlos.x = 0;
                this.panVlos.y = 0;
            }
            if (this.zoomVlos) {
                this.zoomVlos.x = 0;
                this.zoomVlos.y = 0;
            }
        } catch (e) { /* ignore */ }
    }

    _applyCameraOffsetTween(dt) {
        try {
            const tween = this._cameraOffsetTween;
            if (!tween) return;
            const delta = Math.max(0, Number(dt) || 0);
            tween.elapsed += delta;
            const t = Math.max(0, Math.min(1, tween.elapsed / Math.max(0.0001, tween.duration)));
            const eased = 1 - Math.pow(1 - t, 3);
            this.offset.x = tween.start.x + (tween.end.x - tween.start.x) * eased;
            this.offset.y = tween.start.y + (tween.end.y - tween.start.y) * eased;
            if (tween.zoomStart && tween.zoomEnd && this.zoom) {
                this.zoom.x = tween.zoomStart.x + (tween.zoomEnd.x - tween.zoomStart.x) * eased;
                this.zoom.y = tween.zoomStart.y + (tween.zoomEnd.y - tween.zoomStart.y) * eased;
            }
            if (this.panVlos) {
                this.panVlos.x = 0;
                this.panVlos.y = 0;
            }
            if (this.zoomVlos) {
                this.zoomVlos.x = 0;
                this.zoomVlos.y = 0;
            }
            if (t >= 1) this._cameraOffsetTween = null;
        } catch (e) {
            this._cameraOffsetTween = null;
        }
    }

    _isAnimationAvailable(animName) {
        try {
            const name = String(animName || '').trim();
            return !!(name && this.currentSprite && this.currentSprite._frames && this.currentSprite._frames.has(name));
        } catch (e) {
            return false;
        }
    }

    _getAnimationFrameCountSafe(animName) {
        try {
            if (!this._isAnimationAvailable(animName)) return 0;
            return Math.max(1, Number(this._getAnimationLogicalFrameCount(animName) || 0));
        } catch (e) {
            return 0;
        }
    }

    _resolveDirectionalAnimation(baseAnim, dirName, prefixes = []) {
        try {
            const base = String(baseAnim || '').trim();
            const dir = String(dirName || '').trim().toLowerCase();
            if (!base || !dir) return null;
            const opposite = { left: 'right', right: 'left', up: 'down', down: 'up' };
            const oppositeDir = opposite[dir] || null;
            const flipX = (dir === 'left' || dir === 'right');
            const flipY = (dir === 'up' || dir === 'down');

            const candidates = [];
            for (const p of prefixes) {
                const pref = String(p || '').trim();
                if (!pref) continue;
                candidates.push(`${base}-${pref}-${dir}`);
            }
            candidates.push(`${base}-${dir}`);

            for (const c of candidates) {
                if (this._isAnimationAvailable(c)) return { anim: c, flipX: false, flipY: false };
            }

            if (!oppositeDir) return null;
            const oppositeCandidates = [];
            for (const p of prefixes) {
                const pref = String(p || '').trim();
                if (!pref) continue;
                oppositeCandidates.push(`${base}-${pref}-${oppositeDir}`);
            }
            oppositeCandidates.push(`${base}-${oppositeDir}`);

            for (const c of oppositeCandidates) {
                if (!this._isAnimationAvailable(c)) continue;
                return {
                    anim: c,
                    flipX: !!flipX,
                    flipY: !!flipY
                };
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    _resolvePlayerSimAnimation(player, moveX, moveY, inputState = null) {
        try {
            const base = String((player && player.baseAnim) || this.selectedAnimation || 'idle');
            const gravity = !!(player && player.gravityEnabled);
            const onGround = !!(player && player.onGround);
            const absX = Math.abs(moveX || 0);
            const absY = Math.abs(moveY || 0);
            const moveDeadzone = gravity ? 0.35 : 0.15;
            const horizontalMoving = absX > moveDeadzone;
            const verticalMoving = gravity ? (!onGround && (absY > moveDeadzone)) : (absY > moveDeadzone);
            const isMoving = horizontalMoving || verticalMoving;
            const facingX = (player && Number(player.facingX)) || 1;
            const downHeld = !!(inputState && inputState.downHeld);

            // Grounded crouch/crawl variants.
            if (gravity && onGround && downHeld) {
                if (horizontalMov