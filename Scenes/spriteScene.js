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
        this._renderOnlyFrameCache = new Map();
        this._renderOnlyEntryCache = new Map();
        this._renderOnlyAreas = [];
        this._renderOnlyHoverArea = {
            topLeft: new Vector(0, 0),
            size: null,
            padding: 0,
            dstW: 0,
            dstH: 0,
            dstPos: new Vector(0, 0),
            renderOnly: true,
            areaIndex: 0,
            tileCol: 0,
            tileRow: 0,
            active: false
        };
        this._mainDrawSize = new Vector(384, 384);
        this._mainDrawCenter = new Vector(0, 0);
        this._mainDrawBasePos = new Vector(0, 0);
        this._tileBrushTilesBuffer = [];
        this._tileBrushStackBuffer = [];
        this._worldPixelBrushBuffer = [];
        this._worldPixelDedupSet = new Set();
        this._paintBindingCache = new Map();
        this._autotileNeighborCoordSet = new Set();
        this._autotileNeighborDeltas = [
            [0, 0],
            [0, -1], [1, 0], [0, 1], [-1, 0],
            [-1, -1], [1, -1], [1, 1], [-1, 1]
        ];
    }

    onReady() {
        this.maskShapesWithSelection = false;

        this._getCheckerboardCanvas(384, 384);

        this.currentSprite = SpriteSheet.createNew(16, 'idle');


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
                                    : String(v).replace(/[^01]/g, '').padEnd(10, '0').slice(0, 10);
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

    _sendFrameDataForFrame(anim, index, canvas) {
        try {
            if (!anim || !canvas || typeof canvas.toDataURL !== 'function') return false;
            const dataUrl = (() => { try { return canvas.toDataURL('image/png'); } catch (e) { return null; } })();
            if (!dataUrl) return false;
            const diff = {};
            const id = (Date.now()) + '_' + Math.random().toString(36).slice(2,6);
            diff['edits/' + id] = { type: 'frameData', anim: String(anim), index: Number.isFinite(Number(index)) ? Number(index) : null, dataUrl, client: this.clientId, time: Date.now() };
            try {
                // If we have a raw open WebRTC data channel, send the frame as
                // chunked base64 parts directly to avoid creating a single very
                // large JSON diff message that could break the channel.
                try {
                    const ch = this._webrtcChannel;
                    if (ch && ch.readyState === 'open' && typeof ch.send === 'function') {
                        try {
                            // strip prefix and chunk the base64 payload
                            const prefix = 'data:image/png;base64,';
                            const base = (String(dataUrl || '')).startsWith(prefix) ? String(dataUrl).slice(prefix.length) : String(dataUrl);
                            const chunkSize = 8192; // characters per chunk (~6KB binary)
                            const parts = [];
                            for (let i = 0; i < base.length; i += chunkSize) parts.push(base.slice(i, i + chunkSize));
                            const chunkCount = parts.length;
                            // notify start
                            try { ch.send(JSON.stringify({ kind: 'frameStart', id, anim: String(anim), index: Number.isFinite(Number(index)) ? Number(index) : null, chunkCount, client: this.clientId, time: Date.now() })); } catch (e) {}
                            // send chunks sequentially
                            for (let si = 0; si < parts.length; si++) {
                                try { ch.send(JSON.stringify({ kind: 'frameChunk', id, seq: si, data: parts[si] })); } catch (e) { throw e; }
                            }
                            try { console.debug && console.debug('[collab] _sendFrameDataForFrame sentChunkedViaWebRTC?', true, anim, index, 'chunks', chunkCount); } catch (e) {}
                            // reset send failure counter on success
                            try { this._webrtcSendFailures = 0; } catch (e) {}
                            return true;
                        } catch (e) {
                            try { console.warn && console.warn('[collab] frame chunk send failed, falling back to transport enqueue', e && e.message ? e.message : e); } catch (er) {}
                            // fall through to enqueue below
                        }
                    }
                } catch (e) {}

                // If chunked send failed, enqueue via transport. Track failures and recover if repeated.
                try { this._webrtcSendFailures = Number(this._webrtcSendFailures || 0); } catch (e) { this._webrtcSendFailures = 0; }
                const sent = !!this._sendCollabDiff(diff);
                if (!sent) {
                    try { this._webrtcSendFailures = (this._webrtcSendFailures || 0) + 1; } catch (e) {}
                    if ((this._webrtcSendFailures || 0) > 3) {
                        try { console.warn && console.warn('[collab] repeated webrtc send failures, triggering recovery'); } catch (e) {}
                        try { this._recoverCollabState('sendFailures'); } catch (e) {}
                        this._webrtcSendFailures = 0;
                    }
                } else {
                    try { this._webrtcSendFailures = 0; } catch (e) {}
                }
                try { console.debug && console.debug('[collab] _sendFrameDataForFrame queuedViaTransport?', !sent, anim, index); } catch (e) {}
                return sent;
            } catch (e) { return false; }
        } catch (e) { return false; }
    }

    _setTileConnection(anim, index, key, send = true) {
        try {
            const a = String(anim || '').trim();
            if (!a) return false;
            const idx = (Number.isFinite(Number(index)) ? Number(index) : null);
            if (idx === null) return false;
            const normalized = (typeof this._normalizeOpenConnectionKey === 'function')
                ? this._normalizeOpenConnectionKey(key || '0000000000')
                : String(key || '0000000000').replace(/[^01]/g, '').padEnd(10, '0').slice(0, 10);
            if (!this._tileConnMap || typeof this._tileConnMap !== 'object') this._tileConnMap = {};
            this._tileConnMap[a + '::' + (idx | 0)] = normalized;
            try { if (this.FrameSelect && typeof this.FrameSelect.rebuild === 'function') this.FrameSelect.rebuild(); } catch (e) {}
            if (send && this._canSendCollab && this._canSendCollab()) {
                try {
                    const diff = {};
                    const id = (Date.now()) + '_' + Math.random().toString(36).slice(2,6);
                    diff['edits/' + id] = { type: 'tileConn', anim: a, index: idx | 0, key: normalized, client: this.clientId, time: Date.now() };
                    try { this._sendCollabDiff(diff); } catch (e) {}
                } catch (e) {}
            }
            return true;
        } catch (e) { return false; }
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
            try { console.debug && console.debug('[scene] configureCollabTransport', { mode, handshakeOnly, allowFirebaseData: modeOptions.allowFirebaseData, webrtcSender: !!(this.collabTransport && this.collabTransport.webrtcSender) }); } catch (e) {}

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

    _setWebRTCChannel(ch) {
        try {
            this._webrtcChannel = ch;
            try { console.debug && console.debug('[scene] _setWebRTCChannel bound'); } catch (e) {}
        } catch (e) { this._webrtcChannel = null; }
    }

    _clearWebRTCChannel() {
        try { this._webrtcChannel = null; } catch (e) { this._webrtcChannel = null; }
    }

    _recoverCollabState(reason = null) {
        try {
            try { console.warn && console.warn('[collab] _recoverCollabState triggered', reason || 'unknown'); } catch (e) {}
            // Ensure outgoing suppression is cleared so future ops aren't silently blocked
            try { this._suppressOutgoing = false; } catch (e) {}
            // Clear any raw channel reference
            try { this._clearWebRTCChannel(); } catch (e) {}
            // Mark local state as not ready
            try { if (this.localState && this.localState.collab) { this.localState.collab.webrtcReady = false; this.localState.collab.handshakeOnly = true; } } catch (e) {}
            // Reconfigure transport to handshake-only so signaling can re-establish
            try { if (typeof this.configureCollabTransport === 'function') this.configureCollabTransport({ mode: 'webrtc', handshakeOnly: true }); } catch (e) {}
            // Attempt to restart WebRTC handshake after a short delay
            try {
                if (this.webrtcCollab && typeof this.webrtcCollab.stop === 'function') {
                    try { this.webrtcCollab.stop(); } catch (e) {}
                }
                setTimeout(() => {
                    try {
                        if (this.webrtcCollab && typeof this.webrtcCollab.start === 'function') {
                            this.webrtcCollab.start({ offer: null }).catch(()=>{});
                        }
                    } catch (e) {}
                }, 500);
            } catch (e) {}
        } catch (e) {}
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
                if (horizontalMoving) {
                    const crawlDir = (moveX < 0) ? 'left' : 'right';
                    const crawl = this._resolveDirectionalAnimation(base, crawlDir, ['craw']);
                    if (crawl) return crawl;
                } else {
                    const crouchAnim = `${base}-crouch`;
                    if (this._isAnimationAvailable(crouchAnim)) {
                        return { anim: crouchAnim, flipX: false, flipY: false };
                    }
                    const idleCrawlDir = (facingX < 0) ? 'left' : 'right';
                    const idleCrawl = this._resolveDirectionalAnimation(base, idleCrawlDir, ['craw']);
                    if (idleCrawl) return idleCrawl;
                }
            }

            // At rest, always return to the base animation.
            if (!isMoving) return { anim: base, flipX: false, flipY: false };

            if (gravity && !onGround) {
                const jumpAnim = `${base}-jump`;
                if (this._isAnimationAvailable(jumpAnim)) {
                    return { anim: jumpAnim, flipX: (facingX < 0), flipY: false };
                }
            }

            let dir = 'right';
            if (gravity) {
                // In gravity mode, vertical movement should keep the last horizontal facing.
                dir = horizontalMoving
                    ? ((moveX < 0) ? 'left' : 'right')
                    : ((facingX < 0) ? 'left' : 'right');
            } else if (absX >= absY) {
                dir = (moveX < 0) ? 'left' : 'right';
            } else {
                dir = (moveY < 0) ? 'up' : 'down';
            }

            const walkOrMove = this._resolveDirectionalAnimation(base, dir, ['walk'])
                || this._resolveDirectionalAnimation(base, dir, ['move'])
                || this._resolveDirectionalAnimation(base, dir, []);
            if (walkOrMove) return walkOrMove;
            return { anim: base, flipX: false, flipY: false };
        } catch (e) {
            return { anim: this.selectedAnimation || 'idle', flipX: false, flipY: false };
        }
    }

    _cursorToWorldPixel(posInfo = null) {
        try {
            const pos = posInfo || this.getPos(this.mouse && this.mouse.pos);
            if (!pos) return null;
            const slice = Math.max(1, Number((this.currentSprite && this.currentSprite.slicePx) || 1));
            const col = Number.isFinite(Number(pos.tileCol)) ? (Number(pos.tileCol) | 0) : 0;
            const row = Number.isFinite(Number(pos.tileRow)) ? (Number(pos.tileRow) | 0) : 0;
            const lx = Number.isFinite(Number(pos.x)) ? Number(pos.x) : (slice * 0.5);
            const ly = Number.isFinite(Number(pos.y)) ? Number(pos.y) : (slice * 0.5);
            return new Vector(col * slice + lx, row * slice + ly);
        } catch (e) {
            return null;
        }
    }

    _worldPixelToDrawWorld(worldPos, basePos, tileDrawSize, slicePx) {
        try {
            if (!worldPos || !basePos || !tileDrawSize || !slicePx) return null;
            const sx = tileDrawSize.x / slicePx;
            const sy = tileDrawSize.y / slicePx;
            return new Vector(basePos.x + worldPos.x * sx, basePos.y + worldPos.y * sy);
        } catch (e) {
            return null;
        }
    }

    _isTileLayerIgnoredForCollision(layerName) {
        try {
            const name = String(layerName || '').toLowerCase();
            return name.includes('--ignore');
        } catch (e) {
            return false;
        }
    }

    _isSolidTileForSim(col, row) {
        try {
            if (!this.tilemode) return false;
            if (!this._isTileActive(col, row)) return false;

            this._ensureLayerState();
            const idx = this._getAreaIndexForCoord(col, row);
            if (!Number.isFinite(idx) || idx < 0) return false;

            const hasValidBinding = (b) => !!(b && b.anim !== undefined && b.index !== undefined);
            let anyLayerHasBinding = false;
            let anyNonIgnoredLayerHasBinding = false;

            for (let i = 0; i < this._tileLayers.length; i++) {
                const layer = this._tileLayers[i] || {};
                const b = Array.isArray(layer.bindings) ? layer.bindings[idx | 0] : null;
                if (!hasValidBinding(b)) continue;
                anyLayerHasBinding = true;
                const layerName = String(layer.name || ('Tile Layer ' + (i + 1)));
                if (!this._isTileLayerIgnoredForCollision(layerName)) {
                    anyNonIgnoredLayerHasBinding = true;
                    break;
                }
            }

            // If explicit bindings exist, only non-ignored layers contribute collision.
            if (anyLayerHasBinding) return anyNonIgnoredLayerHasBinding;

            // Backward compatibility for older maps without bindings.
            return true;
        } catch (e) {
            return false;
        }
    }

    _isPlayerGroundedByProbe(player, insetPx = 2, probeHeight = 3, probeOffsetY = 1) {
        try {
            if (!player || !player.pos || !player.size || !this.tilemode) return false;
            const slice = Math.max(1, Number((this.currentSprite && this.currentSprite.slicePx) || 16));
            const px = Number(player.pos.x) || 0;
            const py = Number(player.pos.y) || 0;
            const pw = Math.max(1, Number(player.size.x) || slice);
            const ph = Math.max(1, Number(player.size.y) || slice);

            const probePos = new Vector(px + insetPx, py + ph + probeOffsetY);
            const probeSize = new Vector(Math.max(1, pw - insetPx * 2), Math.max(1, probeHeight));

            const minCol = Math.floor(probePos.x / slice) - 1;
            const maxCol = Math.floor((probePos.x + probeSize.x) / slice) + 1;
            const minRow = Math.floor(probePos.y / slice) - 1;
            const maxRow = Math.floor((probePos.y + probeSize.y) / slice) + 1;
            const tileSize = new Vector(slice, slice);

            for (let row = minRow; row <= maxRow; row++) {
                for (let col = minCol; col <= maxCol; col++) {
                    if (!this._isSolidTileForSim(col, row)) continue;
                    const tilePos = new Vector(col * slice, row * slice);
                    if (Geometry.rectCollide(probePos, probeSize, tilePos, tileSize)) return true;
                }
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    _buildPlayerSimPayload(player, active = true) {
        try {
            if (!player || !player.pos || !player.size) {
                return {
                    a: 0,
                    t: Date.now(),
                    c: this.clientId
                };
            }
            const payload = {
                a: active ? 1 : 0,
                t: Date.now(),
                c: this.clientId,
                px: Number(player.pos.x) || 0,
                py: Number(player.pos.y) || 0,
                sx: Math.max(1, Number(player.size.x) || 1),
                sy: Math.max(1, Number(player.size.y) || 1),
                vx: Number(player.vlos && player.vlos.x) || 0,
                vy: Number(player.vlos && player.vlos.y) || 0,
                ba: String(player.baseAnim || this.selectedAnimation || 'idle'),
                an: String(player.anim || player.baseAnim || this.selectedAnimation || 'idle'),
                fr: Math.max(0, Number(player.frame) || 0),
                fx: player.flipX ? 1 : 0,
                fy: player.flipY ? 1 : 0,
                ge: player.gravityEnabled ? 1 : 0,
                og: player.onGround ? 1 : 0
            };
            if (this.playerName) payload.n = String(this.playerName);
            return payload;
        } catch (e) {
            return {
                a: 0,
                t: Date.now(),
                c: this.clientId
            };
        }
    }

    _schedulePlayerSimSend(force = false) {
        try {
            const mode = this._playerSimMode;
            const player = mode && mode.player;
            if (!this._canSendCollab() || !mode || !mode.active || !player) return;
            const payload = this._buildPlayerSimPayload(player, true);
            const last = this._lastPlayerSimPayload;
            const now = Date.now();
            const changed = !last
                || (Math.abs((last.px || 0) - payload.px) > 0.15)
                || (Math.abs((last.py || 0) - payload.py) > 0.15)
                || (last.an !== payload.an)
                || (last.fr !== payload.fr)
                || (last.fx !== payload.fx)
                || (last.fy !== payload.fy)
                || (last.ge !== payload.ge)
                || (last.og !== payload.og);
            const aged = !last || ((now - (Number(last.t) || 0)) > (this._playerSimSendIntervalMs || 70));
            if (!force && !changed && !aged) return;
            this._lastPlayerSimPayload = payload;
            if (this._playerSimThrottleId && !force) return;
            if (force) {
                this._sendPlayerSim(payload);
                return;
            }
            this._playerSimThrottleId = setTimeout(() => {
                try { this._sendPlayerSim(); } catch (e) {}
                try { clearTimeout(this._playerSimThrottleId); } catch (e) {}
                this._playerSimThrottleId = null;
            }, this._playerSimSendIntervalMs || 70);
        } catch (e) {}
    }

    _sendPlayerSim(payload = null) {
        try {
            if (!this._canSendCollab()) return;
            const mode = this._playerSimMode;
            const player = mode && mode.player;
            const body = payload || this._lastPlayerSimPayload || this._buildPlayerSimPayload(player, !!(mode && mode.active));
            const diff = {};
            diff['playerSims/' + this.clientId] = body;
            try { this._sendCollabDiff(diff); } catch (e) {}
        } catch (e) {}
    }

    _clearPlayerSimBroadcast() {
        try {
            this._lastPlayerSimPayload = null;
            try {
                if (this._playerSimThrottleId) clearTimeout(this._playerSimThrottleId);
            } catch (e) {}
            this._playerSimThrottleId = null;
            if (!this._canSendCollab()) return;
            const diff = {};
            diff['playerSims/' + this.clientId] = null;
            try { this._sendCollabDiff(diff); } catch (e) {}
        } catch (e) {}
    }

    _normalizeIncomingPlayerSim(raw) {
        try {
            if (!raw || typeof raw !== 'object') return null;
            const active = Number(raw.a) === 1 || raw.active === true;
            if (!active) return null;
            const targetPos = new Vector(Number(raw.px || 0), Number(raw.py || 0));
            const now = Date.now();
            return {
                active: true,
                time: Number(raw.t || raw.time || Date.now()),
                client: String(raw.c || raw.client || ''),
                name: raw.n ? String(raw.n) : (raw.name ? String(raw.name) : null),
                pos: targetPos.clone(),
                targetPos,
                renderPos: targetPos.clone(),
                size: new Vector(Math.max(1, Number(raw.sx || 1)), Math.max(1, Number(raw.sy || 1))),
                vlos: new Vector(Number(raw.vx || 0), Number(raw.vy || 0)),
                baseAnim: String(raw.ba || raw.baseAnim || this.selectedAnimation || 'idle'),
                anim: String(raw.an || raw.anim || raw.ba || raw.baseAnim || this.selectedAnimation || 'idle'),
                frame: Math.max(0, Number(raw.fr || raw.frame) || 0),
                flipX: Number(raw.fx) === 1 || raw.flipX === true,
                flipY: Number(raw.fy) === 1 || raw.flipY === true,
                gravityEnabled: Number(raw.ge) === 1 || raw.gravityEnabled === true,
                onGround: Number(raw.og) === 1 || raw.onGround === true,
                lastReceiveTime: now
            };
        } catch (e) {
            return null;
        }
    }

    _upsertRemotePlayerSim(clientId, normalized) {
        try {
            if (!clientId || !normalized) return false;
            if (!this._remotePlayerSims) this._remotePlayerSims = new Map();

            const prev = this._remotePlayerSims.get(clientId);
            if (!prev) {
                normalized.client = clientId;
                normalized.lastReceiveTime = Date.now();
                this._remotePlayerSims.set(clientId, normalized);
                return true;
            }

            prev.active = true;
            prev.time = Number(normalized.time || Date.now());
            prev.client = clientId;
            prev.name = normalized.name || prev.name || null;
            prev.targetPos = normalized.targetPos ? normalized.targetPos.clone() : new Vector(normalized.pos?.x || 0, normalized.pos?.y || 0);
            if (!prev.renderPos || typeof prev.renderPos.x !== 'number' || typeof prev.renderPos.y !== 'number') {
                prev.renderPos = prev.targetPos.clone();
            }
            prev.pos = prev.targetPos.clone();
            prev.size = normalized.size ? normalized.size.clone() : prev.size;
            prev.vlos = normalized.vlos ? normalized.vlos.clone() : new Vector(0, 0);
            prev.baseAnim = normalized.baseAnim || prev.baseAnim || this.selectedAnimation || 'idle';
            prev.anim = normalized.anim || prev.anim || prev.baseAnim || this.selectedAnimation || 'idle';
            prev.frame = Math.max(0, Number(normalized.frame) || 0);
            prev.flipX = !!normalized.flipX;
            prev.flipY = !!normalized.flipY;
            prev.gravityEnabled = !!normalized.gravityEnabled;
            prev.onGround = !!normalized.onGround;
            prev.lastReceiveTime = Date.now();
            return true;
        } catch (e) {
            return false;
        }
    }

    _updateRemotePlayerSims(tickDelta) {
        try {
            if (!this._remotePlayerSims || this._remotePlayerSims.size === 0) return;
            const dt = Math.max(0.001, Number(tickDelta) || 0.016);
            const now = Date.now();
            const ttl = this._playerSimTTLms || 6000;
            const catchup = 1 - Math.exp(-12 * dt);

            for (const [cid, player] of Array.from(this._remotePlayerSims.entries())) {
                if (!player || cid === this.clientId) continue;

                const age = now - (Number(player.time) || 0);
                if (age > ttl) {
                    this._remotePlayerSims.delete(cid);
                    continue;
                }

                if (!player.targetPos) player.targetPos = player.pos ? player.pos.clone() : new Vector(0, 0);
                if (!player.renderPos) player.renderPos = player.targetPos.clone();

                const receiveAgeSec = Math.max(0, (now - (Number(player.lastReceiveTime) || now)) / 1000);
                const leadSec = Math.min(0.12, receiveAgeSec);
                const vel = player.vlos || new Vector(0, 0);
                const predicted = new Vector(
                    Number(player.targetPos.x || 0) + (Number(vel.x || 0) * leadSec),
                    Number(player.targetPos.y || 0) + (Number(vel.y || 0) * leadSec)
                );

                const dx = predicted.x - player.renderPos.x;
                const dy = predicted.y - player.renderPos.y;
                const distSq = dx * dx + dy * dy;
                if (distSq > 64 * 64) {
                    player.renderPos = predicted.clone();
                } else {
                    player.renderPos.x += dx * catchup;
                    player.renderPos.y += dy * catchup;
                }
            }
        } catch (e) {
            /* ignore remote sim smoothing errors */
        }
    }

    _togglePlayerSimMode() {
        try {
            const mode = this._playerSimMode;
            if (!mode) return false;

            if (mode.active) {
                const pass = mode.passcode || '';
                if (!(this.keys.released(' ', pass) || this.keys.released('Space', pass) || this.keys.released('Spacebar', pass))) return false;
                
                mode.active = false;
                mode.player = null;
                try { this._clearPlayerSimBroadcast(); } catch (e) {}
                try {
                    if (mode.prevPasscode) this.keys.setPasscode(mode.prevPasscode);
                    else this.keys.resetPasscode();
                } catch (e) {}
                try {
                    // If Shift is held while exiting preview, keep current camera position/zoom.
                    const shiftHeld = this.keys && (this.keys.held('Shift') || this.keys.held('ShiftLeft') || this.keys.held('ShiftRight'));
                    if (!shiftHeld) {
                        if (mode.prevOffset && mode.prevZoom) this._startCameraOffsetTween(mode.prevOffset.clone(), 0.35, mode.prevZoom.clone());
                    }
                } catch (e) {}
                this.keys.pause(0.5)
                this.keys.clearState()
                return true;
            }

            if (!(this.keys.released(' ') || this.keys.released('Space') || this.keys.released('Spacebar'))) return false;
            const baseAnim = String(this.selectedAnimation || '').trim();
            if (!baseAnim || !this._isAnimationAvailable(baseAnim)) return false;

            const pos = this.getPos(this.mouse && this.mouse.pos);
            if (!pos || (!pos.inside && !pos.renderOnly)) return false;
            
            const worldAtCursor = this._cursorToWorldPixel(pos);
            if (!worldAtCursor) return false;

            const slice = Math.max(1, Number((this.currentSprite && this.currentSprite.slicePx) || 16));
            const playerSize = new Vector(slice * 0.8, slice * 0.8);
            const spawn = new Vector(worldAtCursor.x - playerSize.x * 0.5, worldAtCursor.y - playerSize.y * 0.5);

            mode.prevPasscode = this.keys.passcode || '';
            mode.prevOffset = this.offset && this.offset.clone ? this.offset.clone() : new Vector(0, 0);
            mode.prevZoom = this.zoom && this.zoom.clone ? this.zoom.clone() : new Vector(1, 1);
            mode.lastWaypointKey = null;
            mode.active = true;
            mode.player = {
                pos: spawn,
                vlos: new Vector(0, 0),
                size: playerSize,
                baseAnim,
                anim: baseAnim,
                frame: 0,
                frameClock: 0,
                flipX: false,
                flipY: false,
                gravityEnabled: false,
                onGround: false,
                facingX: 1,
                facingY: 1,
                maxFallSpeed: 220,
                camLook: new Vector(0, 0),
                coyoteTimeMax: 0.22,
                coyoteTime: 0,
                fallLookTimer: 0,
                fallLookY: 0
            };
            this.keys.setPasscode(mode.passcode);
            try {
                this._lastPlayerSimPayload = this._buildPlayerSimPayload(mode.player, true);
                this._schedulePlayerSimSend(true);
            } catch (e) {}
            return true;
        } catch (e) {
            return false;
        }
    }

    _updatePlayerSimMode(tickDelta) {
        try {
            const mode = this._playerSimMode;
            const player = mode && mode.player;
            if (!mode || !mode.active || !player) return false;

            const dt = Math.max(0.001, Number(tickDelta) || 0.016);
            const pass = mode.passcode || '';
            const slice = Math.max(1, Number((this.currentSprite && this.currentSprite.slicePx) || 16));
            if (this.keys.released('g', pass) || this.keys.released('G', pass)) {
                player.gravityEnabled = !player.gravityEnabled;
                if (!player.gravityEnabled) player.vlos.y = 0;
            }

            if (this.keys.released('i', pass) || this.keys.released('I', pass)) {
                const waypoints = this._getWaypointCoords(false);
                if (waypoints.length > 0) {
                    const lastKey = String(mode.lastWaypointKey || '');
                    let nextIndex = 0;
                    if (lastKey) {
                        const prevIndex = waypoints.findIndex((wp) => this._tileKey(wp.col, wp.row) === lastKey);
                        if (prevIndex >= 0) nextIndex = (prevIndex + 1) % waypoints.length;
                    }
                    const target = waypoints[nextIndex];
                    mode.lastWaypointKey = this._tileKey(target.col, target.row);
                    player.pos = new Vector(
                        (target.col * slice) + (slice - player.size.x) * 0.5,
                        (target.row * slice) + (slice - player.size.y) * 0.5
                    );
                    player.vlos = new Vector(0, 0);
                    player.onGround = false;
                    player.coyoteTime = 0;
                    player.fallLookTimer = 0;
                    player.fallLookY = 0;
                }
            }

            const left = !!(this.keys.held('a', false, pass) || this.keys.held('A', false, pass) || this.keys.held('ArrowLeft', false, pass));
            const right = !!(this.keys.held('d', false, pass) || this.keys.held('D', false, pass) || this.keys.held('ArrowRight', false, pass));
            const up = !!(this.keys.held('w', false, pass) || this.keys.held('W', false, pass) || this.keys.held('ArrowUp', false, pass));
            const down = !!(this.keys.held('s', false, pass) || this.keys.held('S', false, pass) || this.keys.held('ArrowDown', false, pass));

            let moveX = (right ? 1 : 0) - (left ? 1 : 0);
            let moveY = (down ? 1 : 0) - (up ? 1 : 0);
            const speed = player.gravityEnabled ? 70 : 70;
            const gravityAcc = 170;
            const jumpVel = 90;
            const maxFallSpeed = Math.max(1, Number(player.maxFallSpeed) || 220);
            const coyoteMax = Math.max(0, Number(player.coyoteTimeMax) || 0.12);

            // Ground probe is independent from collision response so tiny bounces do not kill jump readiness.
            if (player.gravityEnabled) {
                player.onGround = this._isPlayerGroundedByProbe(player, 2, Math.max(2, Math.round(player.size.y * 0.08)), 1);
                player.coyoteTime = player.onGround ? coyoteMax : Math.max(0, (Number(player.coyoteTime) || 0) - dt);
            }

            if (!player.gravityEnabled && moveX !== 0 && moveY !== 0) {
                const inv = Math.SQRT1_2;
                moveX *= inv;
                moveY *= inv;
            }

            if (moveX !== 0) player.facingX = (moveX < 0 ? -1 : 1);
            if (!player.gravityEnabled && moveY !== 0) player.facingY = (moveY < 0 ? -1 : 1);

            if (player.gravityEnabled) {
                const jumpPressed = !!(this.keys.pressed('w', pass) || this.keys.pressed('W', pass) || this.keys.pressed('ArrowUp', pass));
                if (jumpPressed && (player.onGround || (player.coyoteTime > 0))) {
                    player.vlos.y = -jumpVel;
                    player.onGround = false;
                    player.coyoteTime = 0;
                }
                player.vlos.x = moveX * speed;
                player.vlos.y += gravityAcc * dt;
                if (player.vlos.y > maxFallSpeed) player.vlos.y = maxFallSpeed;
                moveY = player.vlos.y;
            } else {
                player.vlos.x = moveX * speed;
                player.vlos.y = moveY * speed;
                player.coyoteTime = 0;
                player.fallLookTimer = 0;
                player.fallLookY = 0;
            }

            const deltaStep = player.vlos.clone().multS(dt);
            let curPos = player.pos.clone();
            let curStep = deltaStep.clone();
            let collidedBottom = false;

            const tileSize = new Vector(slice, slice);
            const centerX = curPos.x + player.size.x * 0.5;
            const centerY = curPos.y + player.size.y * 0.5;
            const centerCol = Math.floor(centerX / slice);
            const centerRow = Math.floor(centerY / slice);
            const speedMag = Math.sqrt(curStep.x * curStep.x + curStep.y * curStep.y);
            const radius = speedMag > 0.7 ? 2 : 1; // 5x5 when moving quickly, otherwise 3x3

            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    const col = centerCol + dx;
                    const row = centerRow + dy;
                    if (!this._isSolidTileForSim(col, row)) continue;
                    const tilePos = new Vector(col * slice, row * slice);
                    const res = Geometry.spriteToTile(curPos, curStep, player.size, tilePos, tileSize, 1);
                    if (!res) continue;
                    curPos = res.pos;
                    curStep = res.vlos;
                    if (res.collided && res.collided.bottom) collidedBottom = true;
                }
            }

            curPos.addS(curStep);
            player.pos = curPos;
            if (player.gravityEnabled) {
                player.vlos.x = curStep.x / dt;
                player.vlos.y = curStep.y / dt;
                if (collidedBottom && player.vlos.y > 0) player.vlos.y = 0;
            }
            player.onGround = player.gravityEnabled
                ? this._isPlayerGroundedByProbe(player, 2, Math.max(2, Math.round(player.size.y * 0.08)), 1)
                : collidedBottom;
            if (player.gravityEnabled) {
                player.coyoteTime = player.onGround ? coyoteMax : Math.max(0, (Number(player.coyoteTime) || 0) - dt);
                if (player.onGround) {
                    // Landing snaps away any fall-induced camera bias immediately.
                    player.fallLookTimer = 0;
                    player.fallLookY = 0;
                }
            }

            const animInfo = this._resolvePlayerSimAnimation(player, moveX, moveY, {
                downHeld: down
            });
            const nextAnim = (animInfo && animInfo.anim) ? animInfo.anim : player.baseAnim;
            if (nextAnim !== player.anim) {
                player.anim = nextAnim;
                player.frame = 0;
                player.frameClock = 0;
            }
            player.flipX = !!(animInfo && animInfo.flipX);
            player.flipY = !!(animInfo && animInfo.flipY);

            const frameCount = this._getAnimationFrameCountSafe(player.anim);
            if (frameCount > 0) {
                const fps = Math.max(0, Number(this._getSpriteAnimationFps(player.anim, 8)) || 0);
                if (fps > 0) {
                    player.frameClock += dt * fps;
                    while (player.frameClock >= 1) {
                        player.frameClock -= 1;
                        player.frame = (player.frame + 1) % frameCount;
                    }
                } else {
                    player.frame = Math.max(0, Math.min(frameCount - 1, player.frame | 0));
                }
            } else {
                player.frame = 0;
            }

            const baseArea = this.computeDrawArea();
            if (baseArea) {
                const crawlAvailable = !!(
                    this._resolveDirectionalAnimation(player.baseAnim, 'left', ['craw'])
                    || this._resolveDirectionalAnimation(player.baseAnim, 'right', ['craw'])
                );
                const crawlingInput = !!(down && (left || right));
                const suppressDownLook = !!(player.gravityEnabled && player.onGround && crawlingInput && crawlAvailable);
                const centerWorld = new Vector(player.pos.x + player.size.x * 0.5, player.pos.y + player.size.y * 0.5);
                const rightHeld = Math.max(
                    Number(this.keys.held('d', true, pass)) || 0,
                    Number(this.keys.held('D', true, pass)) || 0,
                    Number(this.keys.held('ArrowRight', true, pass)) || 0
                );
                const leftHeld = Math.max(
                    Number(this.keys.held('a', true, pass)) || 0,
                    Number(this.keys.held('A', true, pass)) || 0,
                    Number(this.keys.held('ArrowLeft', true, pass)) || 0
                );
                const downHeld = Math.max(
                    Number(this.keys.held('s', true, pass)) || 0,
                    Number(this.keys.held('S', true, pass)) || 0,
                    Number(this.keys.held('ArrowDown', true, pass)) || 0
                );
                const upHeld = Math.max(
                    Number(this.keys.held('w', true, pass)) || 0,
                    Number(this.keys.held('W', true, pass)) || 0,
                    Number(this.keys.held('ArrowUp', true, pass)) || 0
                );

                const lookRampSec = 1.35;
                const lookXIntent = Math.max(-1, Math.min(1, (rightHeld - leftHeld) / lookRampSec));
                let lookYIntent = Math.max(-1, Math.min(1, (downHeld - upHeld) / lookRampSec));
                if (suppressDownLook && lookYIntent > 0) lookYIntent = 0;
                const maxLookX = slice * 2.8;
                const maxLookY = slice * 1.8;

                let desiredLookX = 0;
                let desiredLookY = 0;
                if (player.gravityEnabled) {
                    desiredLookX = lookXIntent * maxLookX;
                    const keyLookY = lookYIntent * maxLookY;
                    desiredLookY = keyLookY;

                    // Falling look-ahead: ramps with fall duration (smooth) and starts before terminal velocity.
                    const fallStartSpeed = maxFallSpeed * 0.32;
                    const fallingNow = (!player.onGround) && (player.vlos.y > fallStartSpeed);
                    if (fallingNow) player.fallLookTimer = (Number(player.fallLookTimer) || 0) + dt;
                    else player.fallLookTimer = Math.max(0, (Number(player.fallLookTimer) || 0) - dt * 2.5);

                    const fallRampSec = 0.95;
                    const fallDurationIntent = Math.max(0, Math.min(1, (Number(player.fallLookTimer) || 0) / fallRampSec));
                    const fallSpeedIntent = Math.max(0, Math.min(1, (player.vlos.y - fallStartSpeed) / Math.max(1, (maxFallSpeed - fallStartSpeed))));
                    let fallIntent = Math.max(fallDurationIntent, fallSpeedIntent * 0.6);

                    const upSuppression = Math.max(0, Math.min(1, upHeld / lookRampSec));
                    fallIntent *= (1 - upSuppression * 0.9);

                    const maxFallLookY = slice * 3.4;
                    if (player.onGround) {
                        player.fallLookY = 0;
                    } else {
                        player.fallLookY = maxFallLookY * fallIntent;
                    }
                    desiredLookY = keyLookY + (Number(player.fallLookY) || 0);
                }

                if (!player.camLook || typeof player.camLook.x !== 'number') player.camLook = new Vector(0, 0);
                const lookEase = 1 - Math.exp(-4.5 * dt);
                player.camLook.x += (desiredLookX - player.camLook.x) * lookEase;
                player.camLook.y += (desiredLookY - player.camLook.y) * lookEase;

                const focusWorld = centerWorld.add(player.camLook);
                const centerDraw = this._worldPixelToDrawWorld(focusWorld, baseArea.topLeft, baseArea.size, slice);
                if (centerDraw) {
                    const targetOffsetX = (1920 / (2 * this.zoom.x)) - centerDraw.x;
                    const targetOffsetY = (1080 / (2 * this.zoom.y)) - centerDraw.y;
                    const ease = 1 - Math.exp(-9 * dt);
                    this.offset.x += (targetOffsetX - this.offset.x) * ease;
                    this.offset.y += (targetOffsetY - this.offset.y) * ease;
                    if (this.panVlos) { this.panVlos.x = 0; this.panVlos.y = 0; }
                    if (this.zoomVlos) { this.zoomVlos.x = 0; this.zoomVlos.y = 0; }
                }
            }
            try { this._schedulePlayerSimSend(false); } catch (e) {}
            return true;
        } catch (e) {
            return false;
        }
    }

    _drawPlayerSim(basePos, areaSize) {
        try {
            const mode = this._playerSimMode;
            const player = mode && mode.player;
            if (!mode || !mode.active || !player || !this.currentSprite) return;

            const slice = Math.max(1, Number((this.currentSprite && this.currentSprite.slicePx) || 16));
            const drawPos = this._worldPixelToDrawWorld(player.pos, basePos, areaSize, slice);
            if (!drawPos) return;
            const drawSize = new Vector((player.size.x / slice) * areaSize.x, (player.size.y / slice) * areaSize.y);
            const invert = { x: player.flipX ? -1 : 1, y: player.flipY ? -1 : 1 };
            this.Draw.sheet(this.currentSprite, drawPos, drawSize, player.anim, player.frame, invert, 1, false);
        } catch (e) {
            /* ignore player sim draw errors */
        }
    }

    _drawRemotePlayerSims(basePos, areaSize) {
        try {
            if (!this._remotePlayerSims || this._remotePlayerSims.size === 0 || !this.currentSprite) return;
            const slice = Math.max(1, Number((this.currentSprite && this.currentSprite.slicePx) || 16));
            const now = Date.now();
            const ttl = this._playerSimTTLms || 6000;

            for (const [cid, player] of Array.from(this._remotePlayerSims.entries())) {
                if (!player || cid === this.clientId) continue;
                const age = now - (Number(player.time) || 0);
                if (age > ttl) {
                    this._remotePlayerSims.delete(cid);
                    continue;
                }
                if (!player.pos || !player.size) continue;

                const simPos = player.renderPos || player.targetPos || player.pos;
                if (!simPos) continue;
                const drawPos = this._worldPixelToDrawWorld(simPos, basePos, areaSize, slice);
                if (!drawPos) continue;
                const drawSize = new Vector((player.size.x / slice) * areaSize.x, (player.size.y / slice) * areaSize.y);
                let anim = player.anim || player.baseAnim || this.selectedAnimation || 'idle';
                if (!this._isAnimationAvailable(anim)) anim = player.baseAnim || this.selectedAnimation || 'idle';
                const frameCount = this._getAnimationFrameCountSafe(anim);
                const frame = frameCount > 0 ? Math.max(0, Math.min(frameCount - 1, Number(player.frame) || 0)) : 0;
                const invert = { x: player.flipX ? -1 : 1, y: player.flipY ? -1 : 1 };
                this.Draw.sheet(this.currentSprite, drawPos, drawSize, anim, frame, invert, 1, false);
            }
        } catch (e) {
            /* ignore remote player sim draw errors */
        }
    }

    _handleSpriteEntityInteractions() {
        try {
            if (!this.tilemode || !this.mouse || !this.keys) {
                this._spriteHoverEntityId = null;
                return false;
            }
            const pos = this.getPos(this.mouse && this.mouse.pos);
            if (!pos || (!pos.renderOnly && !pos.inside)) {
                this._spriteHoverEntityId = null;
                return false;
            }
            if (!Number.isFinite(Number(pos.tileCol)) || !Number.isFinite(Number(pos.tileRow))) {
                this._spriteHoverEntityId = null;
                return false;
            }

            const col = Number(pos.tileCol) | 0;
            const row = Number(pos.tileRow) | 0;
            const hitId = this._hitTestSpriteEntityAt(col, row);
            this._spriteHoverEntityId = hitId;

            // Absorb click/drag intent while cursor is over a sprite so tile tools don't also fire.
            if (hitId && (this.mouse.pressed('left') || this.mouse.held('left'))) {
                this._spriteInteractionMaskUntil = Date.now() + 160;
                try { this.mouse.addMask(1); } catch (e) {}
                return true;
            }

            if (!this.mouse.released('left')) return false;
            if (this.keys.held('Shift') || this.keys.held('Control') || this.keys.held('Alt')) return false;

            if (hitId) {
                this.selectedSpriteEntityId = hitId;
                this.modifyState(hitId, false, false, ['spriteLayer', 'selectedEntityId']);
                this._spriteInteractionMaskUntil = Date.now() + 120;
                try { this.mouse.addMask(1); } catch (e) {}
                return true;
            }

            const anim = this.selectedSpriteAnimation || null;
            if (!anim) return false;
            this._clearTileOnActiveLayer(col, row, true);
            const created = this._addSpriteEntityAt(col, row, anim, true);
            if (!created) return false;
            this.modifyState(created.id, false, false, ['spriteLayer', 'selectedEntityId']);
            this._spriteInteractionMaskUntil = Date.now() + 120;
            try { this.mouse.addMask(1); } catch (e) {}
            return true;
        } catch (e) {
            return false;
        }
    }

    // tick handler: called by Scene.tick() via sceneTick
    sceneTick(tickDelta){
        this._sceneTime = (this._sceneTime || 0) + (tickDelta || 0);
        this.mouse.update(tickDelta)
        this.keys.update(tickDelta)
        try {
            if (this.currentSprite && this._pixelHookSheetRef !== this.currentSprite) {
                this._installPixelLayerHooks();
                this._pixelHookSheetRef = this.currentSprite;
            }
        } catch (e) {}
        try { this._updateRemotePlayerSims(tickDelta); } catch (e) {}
        if (!this._playerSimMode) {
            this._playerSimMode = {
                active: false,
                player: null,
                passcode: '__spriteScenePlayerSim__',
                prevPasscode: '',
                prevOffset: null,
                prevZoom: null,
                lastWaypointKey: null
            };
        }
        try { this._togglePlayerSimMode(); } catch (e) {}
        if (this._playerSimMode && this._playerSimMode.active) {
            this.mouse.setMask(1);
            this.mouse.setPower(0);
            try { this._updatePlayerSimMode(tickDelta); } catch (e) {}
            return;
        }
        try {
            const currentAnim = String(this.selectedAnimation || '');
            const prevAnim = String(this._lastEditorAnimationForSpriteSelection || '');
            if (currentAnim !== prevAnim) {
                this._lastEditorAnimationForSpriteSelection = currentAnim;
                this.selectedSpriteAnimation = null;
                this.modifyState(null, false, false, ['spriteLayer', 'selectedAnimation']);
            }
        } catch (e) { /* ignore animation-switch sprite clear errors */ }
        try { this._syncSpriteAnimationProfilesFromSheet(); } catch (e) {}
        try { this._advanceSpriteEntityAnimation(tickDelta); } catch (e) {}
        this._clipboardBrushBlinkPhase = (this._clipboardBrushBlinkPhase || 0) + tickDelta;
        this.mouse.setMask(0)
        this.FrameSelect.update()
        if (this.autoTileGenerationMenu && typeof this.autoTileGenerationMenu.update === 'function') {
            this.autoTileGenerationMenu.update(tickDelta);
        }
        // Keep tile brush binding in sync with current selection by default
        this._tileBrushBinding = { anim: this.selectedAnimation, index: this.selectedFrame }
        this.mouse.setPower(0)
        this._ensureMirrorWrapper()
        // When the frame/animation changes, apply any interpolated selection for the new frame.
        try {
            const frameChanged = this.selectedFrame !== this._selectionKeyframeLastFrame || this.selectedAnimation !== this._selectionKeyframeLastAnim;
            if (frameChanged && this._selectionKeyframeTrack) {
                if (this._selectionKeyframeTrack.anim === this.selectedAnimation) {
                    const fr = Number(this.selectedFrame || 0);
                    const snap = this._selectionKeyframeTrack.frames ? this._selectionKeyframeTrack.frames[fr] : null;
                    if (snap) {
                        this._applySelectionSnapshot(snap);
                        this._selectionKeyframeLastAppliedFrame = fr;
                    }
                } else {
                    this._selectionKeyframeTrack = null;
                    this._selectionKeyframePrompt = null;
                }
            }
            if (frameChanged) {
                this._selectionKeyframeLastFrame = this.selectedFrame;
                this._selectionKeyframeLastAnim = this.selectedAnimation;
            }
        } catch (e) { /* ignore selection keyframe apply errors */ }
        const posForShortcutKeys = this.getPos(this.mouse && this.mouse.pos);
        const renderOnlyTile = !!(this.tilemode && posForShortcutKeys && posForShortcutKeys.renderOnly);
        try { this._handleSpriteEntityInteractions(); } catch (e) {}
        // handle numeric keys to change brush size (1..5). If multiple number keys are pressed simultaneously,
        // sum them for larger brushes (e.g., 2+3 => size 5, 1+2+3+4+5 => size 15). Max capped at 15.
        // Holding Shift while pressing number keys captures the current selection into the clipboard and
        // enables "clipboard brush" mode (pen pastes the selection each frame). Pressing numbers without
        // Shift disables clipboard brush and sets a numeric brush size.
        if (this.keys && this.keys.released) {
            // Treat shifted number symbols as their numeric counterparts so Shift+1 ("!") still counts.
            const numKeyMap = { '1':1, '!':1, '2':2, '@':2, '3':3, '#':3, '4':4, '$':4, '5':5, '%':5 };
            const numKeys = Object.keys(numKeyMap);
            const numPressedThisFrame = numKeys.some(k => this.keys.pressed(k));
            if (this.keys.held('Shift') && numPressedThisFrame && !this._clipboardBrushFired) {
                // Activate clipboard brush from current selection (only if a selection exists)
                if (this.selectionRegion || (this.selectionPoints && this.selectionPoints.length > 0)) {
                    try { this.doCopy(true); } catch (e) { /* ignore copy failures */ }
                    this._clipboardBrushActive = !!this.clipboard;
                    this._clipboardBrushFired = true;
                } else {
                    this._clipboardBrushActive = false;
                }
            } else if (numPressedThisFrame && !this.keys.held('Shift')) {
                const prevBrushSize = Number(this.brushSize) || 1;
                let total = 0;
                for (const k of numKeys) {
                    if (this.keys.pressed(k) || this.keys.held(k)) total += numKeyMap[k] || 0;
                }
                if (this.stateController) this.stateController.setBrushSize(total || 1);
                else this.brushSize = Math.max(1, Math.min(15, total || 1));
                try { this._playBrushSizeSfx(prevBrushSize, Number(this.brushSize) || 1); } catch (e) {}
                this._clipboardBrushActive = false;
            }

            // Reset latch when Shift is not held to allow future activations
            if (!this.keys.held('Shift')) this._clipboardBrushFired = false;

            if (this.keys.released('6')) { this.stateController ? this.stateController.setAdjustChannel('h') : this.modifyState('h',true,true,["brush","pixelBrush","channel"]); try { this._playSfx('color.channel'); } catch (e) {} }
            if (this.keys.released('7')) { this.stateController ? this.stateController.setAdjustChannel('s') : this.modifyState('s',true,true,["brush","pixelBrush","channel"]); try { this._playSfx('color.channel'); } catch (e) {} }
            if (this.keys.released('8')) { this.stateController ? this.stateController.setAdjustChannel('v') : this.modifyState('v',true,true,["brush","pixelBrush","channel"]); try { this._playSfx('color.channel'); } catch (e) {} }
            if (this.keys.released('9')) { this.stateController ? this.stateController.setAdjustChannel('a') : this.modifyState('a',true,true,["brush","pixelBrush","channel"]); try { this._playSfx('color.channel'); } catch (e) {} }

            // Arrow left/right step selected frame within the current animation.
            const framesArr = (this.currentSprite && this.currentSprite._frames && this.selectedAnimation)
                ? (this.currentSprite._frames.get(this.selectedAnimation) || [])
                : [];
            const frameCount = Array.isArray(framesArr) ? framesArr.length : 0;
            if (frameCount > 0) {
                const wrap = (v) => (v % frameCount + frameCount) % frameCount;
                if (this.keys.released('ArrowLeft')) {
                    const nextFrame = wrap((this.selectedFrame || 0) - 1);
                    if (this.stateController) this.stateController.setActiveFrame(nextFrame);
                    else this.selectedFrame = nextFrame;
                    if (this.FrameSelect && this.FrameSelect._multiSelected) this.FrameSelect._multiSelected.clear();
                    try { this._playSfx('frame.select'); } catch (e) {}
                }
                if (this.keys.released('ArrowRight')) {
                    const nextFrame = wrap((this.selectedFrame || 0) + 1);
                    if (this.stateController) this.stateController.setActiveFrame(nextFrame);
                    else this.selectedFrame = nextFrame;
                    if (this.FrameSelect && this.FrameSelect._multiSelected) this.FrameSelect._multiSelected.clear();
                    try { this._playSfx('frame.select'); } catch (e) {}
                }
            }

            // +/- adjust the per-channel adjustment percent (Shift = 0.1% steps, else 1%)
            const incPressed = this.keys.released('+') || this.keys.released('=');
            const decPressed = this.keys.released('-') || this.keys.released('_');
            if (incPressed || decPressed) {
                const step = this.keys.held('Shift') ? 0.001 : 0.01;
                const current = this.state.brush.pixelBrush.adjustAmount[this.state.brush.pixelBrush.channel];
                const next = incPressed ? current + step : current - step;
                if (this.stateController) this.stateController.adjustCurrentChannel(incPressed ? step : -step);
                else this.modifyState(next, true, true, "brush", "pixelBrush", "adjustAmount", this.state.brush.pixelBrush.channel);
                this.adjustAmount = this.state.brush.pixelBrush.adjustAmount[this.state.brush.pixelBrush.channel];
                try { this._playSfx('color.adjust'); } catch (e) {}
            }

            // Toggle onion skinning with 'u'. Shift+U prompts for alpha; Shift+Alt+U prompts for range; if multi-selecting, alpha prompt adjusts layer alpha instead.
            if (this.keys.released('u') || this.keys.released('U')) {
                const shiftHeld = this.keys.held('Shift');
                const altHeld = this.keys.held('Alt');
                if (altHeld && shiftHeld) {
                    try {
                        const current = this.onionRange;
                        const before = (current && typeof current.before === 'number') ? current.before : (typeof current === 'number' ? current : 1);
                        const after = (current && typeof current.after === 'number') ? current.after : (typeof current === 'number' ? current : 1);
                        try { if (this.keys && typeof this.keys.pause === 'function') this.keys.pause(); if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause(); } catch(e){}
                        const input = window.prompt('Onion range (format "before,after", e.g. "5,2" or "-5,2")', `${before},${after}`);
                        if (input !== null) {
                            const parts = String(input).split(',').map(s => s.trim()).filter(s => s.length > 0);
                            let newBefore = before;
                            let newAfter = after;
                            if (parts.length === 1) {
                                const v = Number(parts[0]);
                                if (Number.isFinite(v)) { newBefore = Math.max(0, Math.abs(Math.floor(v))); newAfter = newBefore; }
                            } else if (parts.length >= 2) {
                                const p0 = Number(parts[0]);
                                const p1 = Number(parts[1]);
                                if (Number.isFinite(p0)) newBefore = Math.max(0, Math.abs(Math.floor(p0)));
                                if (Number.isFinite(p1)) newAfter = Math.max(0, Math.abs(Math.floor(p1)));
                            }
                            if (this.stateController) this.stateController.setOnionRange(newBefore, newAfter);
                            else this.onionRange = { before: newBefore, after: newAfter };
                            try { console.log('Onion range set to', this.onionRange); } catch (e) {}
                        }
                    } catch (e) { /* ignore prompt failures */ }
                    return;
                }
                if (!shiftHeld) {
                    if (this.stateController) this.stateController.toggleOnionSkin();
                    else this.onionSkin = !(typeof this.onionSkin === 'boolean' ? this.onionSkin : false);
                    try { console.log('Onion skin:', this.onionSkin); } catch (e) {}
                    try { this._playSfx('toggle.onionSkin'); } catch (e) {}
                } else {
                    try {
                        const multiActive = this.FrameSelect && this.FrameSelect._multiSelected && this.FrameSelect._multiSelected.size > 0;
                        const current = multiActive ? (this.layerAlpha ?? 1) : (this.onionAlpha ?? 1);
                        try { if (this.keys && typeof this.keys.pause === 'function') this.keys.pause(); if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause(); } catch(e){}
                        const input = window.prompt(multiActive ? 'Layer alpha (0-1)' : 'Onion alpha (0-1)', String(current));
                        if (input !== null) {
                            const parsed = Number(input);
                            if (Number.isFinite(parsed)) {
                                const clamped = Math.max(0, Math.min(1, parsed));
                                if (multiActive) {
                                    if (this.stateController) this.stateController.setLayerAlpha(clamped);
                                    else this.layerAlpha = clamped;
                                } else {
                                    if (this.stateController) this.stateController.setOnionAlpha(clamped);
                                    else this.onionAlpha = clamped;
                                }
                            }
                        }
                    } catch (e) { /* ignore prompt failures */ }
                }
            }

            // Ctrl+A: open procedural auto-tile generation panel.
            // Plain A keeps its previous toggle behavior.
            if (this.keys.released('a') || this.keys.released('A')) {
                const ctrlDown = !!(this.keys.held('Control') || this.keys.held('ControlLeft') || this.keys.held('ControlRight') || this.keys.held('Meta'));
                if (ctrlDown) {
                    try {
                        const selected = Array.from((this.FrameSelect && this.FrameSelect._multiSelected) || [])
                            .filter(i => Number.isFinite(i))
                            .map(i => Number(i) | 0)
                            .sort((a, b) => a - b);
                        const anim = String(this.selectedAnimation || 'idle');

                        // Named transition shortcut:
                        // If selected animation is empty and named like "snow-to-dirt",
                        // auto-build a 5-tile transition set (4 edges + center)
                        // using the first frame from each endpoint animation.
                        const selectedAnimCount = this._getAnimationLogicalFrameCountExact(anim);
                        if (selectedAnimCount === 0) {
                            const maybeTransition = this._runNamedTransitionTilesetGeneration({
                                sourceAnimation: anim,
                                noiseAmount: 0.32,
                                seed: 1
                            });
                            if (maybeTransition && maybeTransition.ok) {
                                try {
                                    if (this.keys && typeof this.keys.clearState === 'function') this.keys.clearState();
                                    if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause(0.12);
                                    if (typeof this._playSfx === 'function') this._playSfx('frame.duplicate');
                                } catch (e) {}
                                return;
                            }
                            const parsedTransition = this._parseTransitionAnimationName(anim);
                            if (parsedTransition) {
                                try {
                                    console.warn('Transition generation failed:', maybeTransition && maybeTransition.reason ? maybeTransition.reason : 'Unknown error');
                                } catch (e) {}
                                return;
                            }
                        }

                        // Back-compat: when the original 3 template frames are selected,
                        // run the legacy template expansion flow instead of opening the new menu.
                        if (this._isLegacyAutotileTemplateSelection(selected, anim)) {
                            try {
                                let widthPx = 2;
                                try {
                                    if (this.keys && typeof this.keys.pause === 'function') this.keys.pause();
                                    if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause();
                                } catch (e) {}
                                const input = window.prompt('Template edge width (px)', '2');
                                if (input !== null) {
                                    const parsed = Number(input);
                                    if (Number.isFinite(parsed)) widthPx = Math.max(1, Math.floor(parsed));
                                }
                                const result = this._generateMissingConnectionFramesFromTemplates(widthPx);
                                if (!result || !result.ok) {
                                    try { console.warn('Legacy auto-tile generation failed:', result && result.reason ? result.reason : result); } catch (e) {}
                                }
                                try {
                                    if (this.keys && typeof this.keys.clearState === 'function') this.keys.clearState();
                                    if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause(0.12);
                                } catch (e) {}
                            } catch (e) {}
                            return;
                        }

                        const sourceFrame = selected.length > 0 ? selected[0] : Number(this.selectedFrame || 0);
                        if (this.autoTileGenerationMenu && typeof this.autoTileGenerationMenu.open === 'function') {
                            this.autoTileGenerationMenu.open({
                                sourceFrame,
                                sourceAnimation: anim
                            });
                            try {
                                if (this.keys && typeof this.keys.clearState === 'function') this.keys.clearState();
                                if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause(0.12);
                            } catch (e) {}
                        }
                    } catch (e) {}
                } else {
                    if (this.tilemode) {
                        if (this.stateController) this.stateController.toggleAutotile();
                        else this.autotile = !this.autotile;
                        try { console.log('Autotile mode:', this.autotile); } catch (e) {}
                        try { this._playSfx('toggle.autotile'); } catch (e) {}
                    } else {
                        if (this.stateController) this.stateController.togglePixelPerfect();
                        else this.pixelPerfect = !this.pixelPerfect;
                        try { console.log('Pixel-perfect mode:', this.pixelPerfect); } catch (e) {}
                        try { this._playSfx('toggle.pixelPerfect'); } catch (e) {}
                    }
                }
            }

            // Palette swap: press 'p' to map current pen color to a target color (plus stepped variants) across all frames.
            // Shift+P prompts for step depth (number of +/- steps per channel).
            if (this.keys.released('p') || this.keys.released('P')) {
                if (this.keys.held('Shift')) {
                    try {
                        const current = Number(this.paletteStepMax || 3);
                        try { if (this.keys && typeof this.keys.pause === 'function') this.keys.pause(); if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause(); } catch(e){}
                        const input = window.prompt('Palette swap step range (1-6 recommended)', String(current));
                        if (input !== null && input !== undefined) {
                            const parsed = Math.max(0, Math.floor(Number(String(input).trim())));
                            const clamped = Math.max(0, Math.min(6, parsed));
                            if (this.stateController) this.stateController.setPaletteStepMax(clamped || 0);
                            else this.paletteStepMax = clamped || 0;
                        }
                    } catch (e) { /* ignore prompt errors */ }
                } else {
                    try { this._promptPaletteSwap(); } catch (e) { console.warn('palette swap failed', e); }
                }
            }
            if (this.keys.comboPressed(['s','Alt'])) {
                console.log('emmiting')
                window.Debug.emit('drawSelected');
            } else if ((this.keys.pressed('s')||this.keys.pressed('S')) && !this.keys.held('Alt') && !renderOnlyTile) {
                const col = Color.convertColor(this.penColor || '#000000');
                const hex = col.toHex();
                let buffer = 1;
                // If Shift is held, prompt the user for a buffer amount (default '1')
                if (this.keys.held('Shift')) {
                    this.keys.update(tickDelta)
                    console.log('prompting')
                    try {
                        try { if (this.keys && typeof this.keys.pause === 'function') this.keys.pause(); if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause(); } catch(e){}
                        const input = window.prompt('Buffer amount (default 1)', '1');
                        if (input !== null) {
                            const parsed = parseFloat(String(input).trim());
                            if (!Number.isNaN(parsed) && isFinite(parsed)) buffer = parsed;
                        }
                    } catch (e) {
                        // ignore prompt errors and fall back to default
                    }
                }
                try {
                    // Perform a select-all of pixels matching the current pen color,
                    // animating the selection as a short chain-reaction.
                    const sheet = this.currentSprite;
                    if (sheet && typeof sheet.getFrame === 'function') {
                        const frameCanvas = sheet.getFrame(this.selectedAnimation, this.selectedFrame);
                        if (frameCanvas) {
                            const ctx = frameCanvas.getContext('2d');
                            const w = frameCanvas.width, h = frameCanvas.height;
                            try {
                                const img = ctx.getImageData(0, 0, w, h).data;
                                const colObj = Color.convertColor(this.penColor || '#000000');
                                const cRgb = colObj.toRgb();
                                const tr = Math.round(cRgb.a || 0);
                                const tg = Math.round(cRgb.b || 0);
                                const tb = Math.round(cRgb.c || 0);
                                const ta = Math.round((cRgb.d ?? 1) * 255);
                                const pts = [];
                                for (let y = 0; y < h; y++) {
                                    for (let x = 0; x < w; x++) {
                                        const idx = (y * w + x) * 4;
                                        if (img[idx] === tr && img[idx+1] === tg && img[idx+2] === tb && img[idx+3] === ta) {
                                            pts.push({ x, y, areaIndex: null });
                                        }
                                    }
                                }
                                if (pts.length) {
                                    try { this._playSfx('select.pixel'); } catch (e) {}
                                    this._animateSelectPoints(pts, 200);
                                }
                                return;
                            } catch (e) { /* fall through to Debug.emit fallback */ }
                        }
                    }
                } catch (e) { /* ignore */ }
                try {
                    const sheet = this.currentSprite;
                    if (sheet && typeof sheet.getFrame === 'function') {
                        const frameCanvas = sheet.getFrame(this.selectedAnimation, this.selectedFrame);
                        if (frameCanvas) {
                            const ctx = frameCanvas.getContext('2d');
                            const w = frameCanvas.width, h = frameCanvas.height;
                            try {
                                const img = ctx.getImageData(0, 0, w, h).data;
                                const colObj = Color.convertColor(this.penColor || '#000000');
                                const cRgb = colObj.toRgb();
                                const tr = Math.round(cRgb.a || 0);
                                const tg = Math.round(cRgb.b || 0);
                                const tb = Math.round(cRgb.c || 0);
                                const ta = Math.round((cRgb.d ?? 1) * 255);
                                const pts = [];
                                for (let y = 0; y < h; y++) {
                                    for (let x = 0; x < w; x++) {
                                        const idx = (y * w + x) * 4;
                                        if (img[idx] === tr && img[idx+1] === tg && img[idx+2] === tb && img[idx+3] === ta) {
                                            pts.push({ x, y, areaIndex: null });
                                        }
                                    }
                                }
                                if (pts.length) {
                                    try { this._playSfx('select.pixel'); } catch (e) {}
                                    this._animateSelectPoints(pts, 200);
                                }
                                // Prevent further handling
                                return;
                            } catch (e) { /* fall through to Debug fallback */ }
                        }
                    }
                } catch (e) { /* ignore */ }
                if (window.Debug && typeof window.Debug.emit === 'function') {
                    window.Debug.emit('select', hex, buffer);
                } else if (window.Debug && typeof window.Debug.createSignal === 'function') {
                    const sig = window.Debug.signals && window.Debug.signals.get && window.Debug.signals.get('select');
                    if (typeof sig === 'function') sig(hex, buffer);
                }
            }

            // Backtick (`) prompts for a square resize (single value applies to both dimensions)
            if (this.keys.released('`')) {
                    try {
                        const current = Math.max(1, this.currentSprite && this.currentSprite.slicePx ? this.currentSprite.slicePx : 16);
                        try { if (this.keys && typeof this.keys.pause === 'function') this.keys.pause(); if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause(); } catch(e){}
                        const input = window.prompt('Resize canvas (square only, px)', String(current));
                    if (input !== null) {
                        const parsed = Math.floor(Number(String(input).trim()));
                        if (Number.isFinite(parsed) && parsed > 0) {
                            let resizeContent = true;
                            try {
                                try { if (this.keys && typeof this.keys.pause === 'function') this.keys.pause(); if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause(); } catch(e){}
                                const resp = window.prompt('Resize content? (y/n, default y)', 'y');
                                if (resp !== null) {
                                    const normalized = String(resp).trim().toLowerCase();
                                    if (normalized.startsWith('n')) resizeContent = false;
                                    else if (normalized.startsWith('y')) resizeContent = true;
                                }
                            } catch (e) { /* ignore secondary prompt errors */ }
                            this.resize(parsed, resizeContent);
                        }
                    }
                } catch (e) { /* ignore prompt errors */ }
            }
        }

        // Undo / Redo shortcuts
        try {
            const ctrlDown = this.keys.held('Control') || this.keys.held('ControlLeft') || this.keys.held('ControlRight') || this.keys.held('Meta');
            if (ctrlDown && this.keys.released('z')) {
                if (this.keys.held('Shift')) {
                    try { this.redo(); } catch (e) { console.warn('redo failed', e); }
                } else {
                    try { this.undo(); } catch (e) { console.warn('undo failed', e); }
                }
            } else if (ctrlDown && (this.keys.released('y') || this.keys.released('Y'))) {
                try { this.redo(); } catch (e) { console.warn('redo failed', e); }
            }
        } catch (e) { /* ignore undo key errors */ }
        // Toggle / configure tilemode.
        // Plain 't' or 'T' toggles tilemode.
        // Shift+T prompts for a tile grid size before enabling (or reconfiguring) tilemode.
        if (this.keys.released('t') || this.keys.released('T')) {
            const shiftHeld = !!(this.keys && this.keys.held && this.keys.held('Shift'));
            if (!shiftHeld) {
                const wasTilemode = !!this.tilemode;
                const nextTilemode = !wasTilemode;
                if (this.stateController) this.stateController.setTilemode(nextTilemode);
                else this.tilemode = nextTilemode;

                try { this._playSfx(nextTilemode ? 'tilemode.on' : 'tilemode.off'); } catch (e) {}

                if (nextTilemode) {
                    const restore = (this._tilemodeSavedOffset && typeof this._tilemodeSavedOffset.x === 'number' && typeof this._tilemodeSavedOffset.y === 'number')
                        ? this._tilemodeSavedOffset
                        : new Vector((this.offset && this.offset.x) || 0, (this.offset && this.offset.y) || 0);
                    const restoreZoom = (this._tilemodeSavedZoom && typeof this._tilemodeSavedZoom.x === 'number' && typeof this._tilemodeSavedZoom.y === 'number')
                        ? this._tilemodeSavedZoom
                        : new Vector((this.zoom && this.zoom.x) || 1, (this.zoom && this.zoom.y) || 1);
                    this._startCameraOffsetTween(new Vector(restore.x, restore.y), 1, new Vector(restoreZoom.x, restoreZoom.y));
                } else {
                    this._tilemodeSavedOffset = this.offset.clone();
                    this._tilemodeSavedZoom = this.zoom.clone();
                    this._startCameraOffsetTween(new Vector(0, 0), 1, new Vector(1, 1));
                }
            } else {
                try {
                    const defCols = Math.max(1, (this.tileCols|0) || 3);
                    const defRows = Math.max(1, (this.tileRows|0) || defCols);
                    const defStr = defCols === defRows ? String(defRows) : (defRows + 'x' + defCols);
                    try { if (this.keys && typeof this.keys.pause === 'function') this.keys.pause(); if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause(); } catch(e){}
                    const input = window.prompt('Grid size (default "3x3")', defStr);
                    if (input != null) {
                        const raw = String(input).trim().toLowerCase();
                        if (raw.length > 0) {
                            const normalized = raw.replace(/x/gi, ',').replace(/\s+/g, '');
                            const parts = normalized.split(',').filter(p => p.length > 0);
                            const parseDim = (v, fallback) => {
                                const n = Math.floor(Number(v));
                                return Number.isFinite(n) && n > 0 ? n : fallback;
                            };
                            const rows = parseDim(parts[0], defRows);
                            const cols = parseDim(parts[1] !== undefined ? parts[1] : rows, defCols);
                            const nextRows = Math.max(1, rows);
                            const nextCols = Math.max(1, cols);
                            if (this.stateController) {
                                this.stateController.setTileGrid(nextCols, nextRows);
                                this.stateController.setTilemode(true);
                            } else {
                                this.tileRows = nextRows;
                                this.tileCols = nextCols;
                                this.tilemode = true;
                            }
                            this._seedTileActives(this.tileCols, this.tileRows);
                        }
                    }
                } catch (e) { /* ignore prompt / parse errors */ }
            }
        }
        try {
            // handle ctrl+wheel zoom (adds velocity impulses)
            this.zoomScreen(tickDelta);
            // handle wheel-based panning (horizontal/vertical wheel)
            this.panScreen(tickDelta);

            // Integrate zoom velocity for smooth zooming
            try {
                const dt = tickDelta || 0;
                const mpos = (this.mouse && this.mouse.pos) ? this.mouse.pos : new Vector(0,0);

                // X axis
                if (Math.abs(this.zoomVlos.x) > 1e-6) {
                    const oldZoomX = this.zoom.x || 1;
                    let newZoomX = oldZoomX + this.zoomVlos.x * dt;
                    // clamp
                    newZoomX = Math.max(this.minZoom, Math.min(this.maxZoom, newZoomX));
                    if (newZoomX !== oldZoomX) {
                        // adjust offset so the screen point under the mouse stays fixed
                        this.offset.x = this.offset.x + mpos.x * (1 / newZoomX - 1 / oldZoomX);
                        this.zoom.x = newZoomX;
                    }
                    // if clamped hard, kill velocity in that axis
                    if (newZoomX === this.minZoom || newZoomX === this.maxZoom) this.zoomVlos.x = 0;
                }

                // Y axis
                if (Math.abs(this.zoomVlos.y) > 1e-6) {
                    const oldZoomY = this.zoom.y || 1;
                    let newZoomY = oldZoomY + this.zoomVlos.y * dt;
                    newZoomY = Math.max(this.minZoom, Math.min(this.maxZoom, newZoomY));
                    if (newZoomY !== oldZoomY) {
                        this.offset.y = this.offset.y + mpos.y * (1 / newZoomY - 1 / oldZoomY);
                        this.zoom.y = newZoomY;
                    }
                    if (newZoomY === this.minZoom || newZoomY === this.maxZoom) this.zoomVlos.y = 0;
                }

                // Damping
                const damp = Math.exp(-(this.zoomSmooth || 6) * dt);
                this.zoomVlos.x *= damp;
                this.zoomVlos.y *= damp;
                // tiny cutoff
                if (Math.abs(this.zoomVlos.x) < 1e-4) this.zoomVlos.x = 0;
                if (Math.abs(this.zoomVlos.y) < 1e-4) this.zoomVlos.y = 0;

                // Integrate pan velocity into offset and apply damping
                try {
                    if (Math.abs(this.panVlos.x) > 1e-6) {
                        this.offset.x += this.panVlos.x * dt;
                    }
                    if (Math.abs(this.panVlos.y) > 1e-6) {
                        this.offset.y += this.panVlos.y * dt;
                    }
                    const pdamp = Math.exp(-(this.panSmooth || 6) * dt);
                    this.panVlos.x *= pdamp;
                    this.panVlos.y *= pdamp;
                    if (Math.abs(this.panVlos.x) < 1e-4) this.panVlos.x = 0;
                    if (Math.abs(this.panVlos.y) < 1e-4) this.panVlos.y = 0;
                } catch (e) {
                    console.warn('pan integration failed', e);
                }

                // Smoothly transition camera offset for tilemode enter/exit toggles.
                this._applyCameraOffsetTween(dt);
            } catch (e) {
                console.warn('zoom integration failed', e);
            }

                // bind key: press 'y' to bind a single selected frame to the area under mouse
                try {
                    if (this.keys && typeof this.keys.released === 'function' && this.keys.released('y')) {
                        // area binding / mirror-to-map is a tilemode-only action
                        if (!this.tilemode) {
                            // ignore in non-tilemode
                        } else {
                            const pos = this.getPos(this.mouse && this.mouse.pos);
                            if (pos && (pos.inside || pos.renderOnly) && typeof pos.areaIndex === 'number') {
                                // determine which frame to bind: prefer primary selection, but capture any layered stack for preview reuse
                                let frameIdx = this.selectedFrame;
                                let anim = this.selectedAnimation;
                                let stack = [];
                                const pushFrame = (v) => {
                                    if (!Number.isFinite(v)) return;
                                    const n = Number(v);
                                    if (!stack.includes(n)) stack.push(n);
                                };
                                try {
                                    pushFrame(frameIdx);
                                    const fs = this.FrameSelect;
                                    if (fs && fs._multiSelected && fs._multiSelected.size > 0) {
                                        const arr = Array.from(fs._multiSelected).filter(i => Number.isFinite(i)).map(Number).sort((a,b)=>a-b);
                                        for (const i of arr) pushFrame(i);
                                    }
                                    // Normalize: sort, dedupe, and discard single-frame stacks so toggle works with legacy bindings
                                    stack = Array.from(new Set(stack)).sort((a,b)=>a-b);
                                    if (stack.length <= 1) stack = [];
                                } catch (e) { /* ignore stack build errors */ }
                                // Toggle behavior: if area already bound to same anim/frame, clear it
                                const existing = (Array.isArray(this._areaBindings) && this._areaBindings[pos.areaIndex]) ? this._areaBindings[pos.areaIndex] : null;
                                const sameStack = (() => {
                                    if (!existing) return false;
                                    const existingStack = Array.isArray(existing.multiFrames) ? existing.multiFrames : [];
                                    if (existingStack.length !== stack.length) return false;
                                    if (existingStack.length === 0 && stack.length === 0) return true;
                                    for (let i = 0; i < stack.length; i++) if (Number(existingStack[i]) !== Number(stack[i])) return false;
                                    return true;
                                })();
                                if (existing && existing.anim === anim && Number(existing.index) === Number(frameIdx) && sameStack) {
                                    this.clearAreaBinding(pos.areaIndex);
                                } else {
                                    const savedStack = stack.length >= 2 ? stack : null;
                                    this.bindArea(pos.areaIndex, anim, frameIdx, savedStack);
                                }
                            }
                        }
                    }
                } catch (e) { console.warn('area bind key failed', e); }

                    // Rotate / Flip preview and commit handlers for area under mouse
                    try {
                        const posForTransform = this.getPos(this.mouse && this.mouse.pos);
                        if (this.tilemode) {
                            const ai = posForTransform.areaIndex;
                            const hasSelection = this._tileSelection && this._tileSelection.size > 0;
                            // Rotate: plain 'r' = preview rotate 90deg CW, Shift+'r' = commit rotate to frame data
                            if ((this.keys.pressed('R')||this.keys.pressed('r'))) {
                                if (hasSelection) {
                                    // apply to all selected tiles
                                    for (const key of Array.from(this._tileSelection)) {
                                        try {
                                            const c = this._parseTileKey(key);
                                            if (!c) continue;
                                            const idx = this._getAreaIndexForCoord(c.col, c.row);
                                            if (this.keys.held('Shift')) {
                                                try { this.applyAreaRotateData(idx); } catch (e) {}
                                            } else {
                                                try { this.toggleAreaPreviewRotate(idx); } catch (e) {}
                                            }
                                        } catch (e) { continue; }
                                    }
                                } else {
                                    if (this.keys.held('Shift')) {
                                        try { this.applyAreaRotateData(ai); } catch (e) { /* ignore */ }
                                    } else {
                                        try { this.toggleAreaPreviewRotate(ai); } catch (e) { /* ignore */ }
                                    }
                                }
                            }
                            // Flip: Alt+f toggles preview flip, Alt+Shift+f applies flip to frame data
                            if ((this.keys.pressed('F')||this.keys.pressed('f')) && this.keys.held('Alt')) {
                                if (hasSelection) {
                                    for (const key of Array.from(this._tileSelection)) {
                                        try {
                                            const c = this._parseTileKey(key);
                                            if (!c) continue;
                                            const idx = this._getAreaIndexForCoord(c.col, c.row);
                                            if (this.keys.held('Shift')) {
                                                try { this.applyAreaFlipData(idx); } catch (e) {}
                                            } else {
                                                try { this.toggleAreaPreviewFlip(idx); } catch (e) {}
                                            }
                                        } catch (e) { continue; }
                                    }
                                } else {
                                    if (this.keys.held('Shift')) {
                                        try { this.applyAreaFlipData(ai); } catch (e) { /* ignore */ }
                                    } else {
                                        try { this.toggleAreaPreviewFlip(ai); } catch (e) { /* ignore */ }
                                    }
                                }
                            }
                        }
                    } catch (e) { /* ignore transform key errors */ }

                // Toggle pen mirroring: '[' horizontal, ']' vertical
                try {
                    if (this.keys && typeof this.keys.pressed === 'function') {
                        if (this.keys.pressed('[')) {
                            if (this.stateController) this.stateController.setMirror('h', !this.penMirrorH);
                            else this.penMirrorH = !this.penMirrorH;
                            this._pixelPerfectStrokeActive = false;
                            this._applyInitialMirror('h');
                        }
                        if (this.keys.pressed(']')) {
                            if (this.stateController) this.stateController.setMirror('v', !this.penMirrorV);
                            else this.penMirrorV = !this.penMirrorV;
                            this._pixelPerfectStrokeActive = false;
                            this._applyInitialMirror('v');
                        }
                    }
                } catch (e) { /* ignore mirror toggle errors */ }

                // tools (pen) operate during ticks
                this.selectionTool && this.selectionTool();
                this.penTool && this.penTool();
            // Throttle cursor sends when mouse moves
            try {
                const mp = (this.mouse && this.mouse.pos) ? this.mouse.pos : null;
                if (mp) {
                    const last = this._lastCursorPos || null;
                    const now = Date.now();
                    const moved = !last || Math.abs(mp.x - last.x) > 2 || Math.abs(mp.y - last.y) > 2;
                    const aged = !last || ((now - (last.time || 0)) > (this._cursorSendIntervalMs || 100));
                    if (moved || aged) {
                        this._lastCursorPos = { x: mp.x, y: mp.y, time: now };
                        try { this._scheduleCursorSend(); } catch (e) {}
                    }
                }
            } catch (e) {}

            // Keep tile layout state synced even when no pixel ops are generated.
            try { this._scheduleTilemapSync(); } catch (e) {}
        } catch (e) {
            console.warn('sceneTick failed', e);
        }

        
    }

    // Simple pen tool: paint a single pixel into the current frame while left mouse is held.
    // Returns early if left button isn't held.
    penTool() {
        try {
            if (!this.mouse || !this.currentSprite) return;
            if (this._spriteInteractionMaskUntil && Date.now() < this._spriteInteractionMaskUntil) return;
            if (this.keys.held('Shift')) return;
            if(this.keys.held('v')) return;
            
            // Use the shared helper to map mouse -> pixel coords
            const pos = this.getPos(this.mouse.pos);
            // When in render-only tilemode, treat the pen as a tile brush (place/erase bindings per tile).
            if (this.tilemode && pos && pos.renderOnly) {
                this._handleRenderOnlyTilePaint(pos);
                return;
            }
            if (!pos || !pos.inside) return;
            const sheet = this.currentSprite;
            // If clipboard brush mode is active, paste (left) or erase (right) with clipboard shape instead of square brush
            if (this._clipboardBrushActive && this.clipboard) {
                if (this.mouse.held('left')) {
                    try { if (this.mouse.pressed('left')) this._playSfx('clipboard.paste'); } catch (e) {}
                    this.doPaste(this.mouse.pos, { playSfx: false });
                    return;
                }
                if (this.mouse.held('right')) {
                    try { if (this.mouse.pressed('right')) this._playSfx('clipboard.erase'); } catch (e) {}
                    this.doClipboardErase(this.mouse.pos, { playSfx: false });
                    return;
                }
            }

            const color = this.penColor || '#000000';
            const side = Math.max(1, Math.min(15, this.brushSize || 1));
            const half = Math.floor((side - 1) / 2);
            const areaIndexForPos = (typeof pos.areaIndex === 'number') ? pos.areaIndex : null;
            const mirrorH = !!this.penMirrorH;
            const mirrorV = !!this.penMirrorV;
            const slice = sheet.slicePx || 1;
            let baseCol = 0, baseRow = 0;
            if (this.tilemode && typeof areaIndexForPos === 'number' && Array.isArray(this._tileIndexToCoord)) {
                const cr = this._tileIndexToCoord[areaIndexForPos];
                if (cr) { baseCol = cr.col|0; baseRow = cr.row|0; }
            }
            const frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(this.selectedAnimation, this.selectedFrame) : null;
            const frameW = frameCanvas ? frameCanvas.width : slice;
            const frameH = frameCanvas ? frameCanvas.height : slice;
            const mirrorActive = (mirrorH || mirrorV) && frameW !== null && frameH !== null;

            const prevBypass = this._bypassMirrorWrap;
            this._bypassMirrorWrap = true; // pen handles mirroring itself

            try {

            const worldPixelsFromBrush = (sx, sy, outPixels = null) => {
                const pixels = Array.isArray(outPixels) ? outPixels : [];
                pixels.length = 0;
                let write = 0;
                const pushWorld = (lx, ly) => {
                    // In tilemode, allow brush footprints to spill across tiles; in single-frame mode, drop out-of-bounds.
                    if (!this.tilemode && frameW !== null && frameH !== null) {
                        if (lx < 0 || ly < 0 || lx >= frameW || ly >= frameH) return;
                    }
                    if (this.isPixelMasked(lx, ly, areaIndexForPos)) return;
                    const wx = baseCol * slice + lx;
                    const wy = baseRow * slice + ly;
                    let entry = pixels[write];
                    if (!entry) {
                        entry = { x: 0, y: 0 };
                        pixels[write] = entry;
                    }
                    entry.x = wx;
                    entry.y = wy;
                    write++;
                };
                const addMirrored = (lx, ly) => {
                    const x1 = lx;
                    const y1 = ly;
                    pushWorld(x1, y1);

                    let x2 = null, y2 = null;
                    let x3 = null, y3 = null;

                    if (mirrorH && frameW !== null) {
                        x2 = frameW - 1 - lx;
                        y2 = y1;
                        if (!(x2 === x1 && y2 === y1)) pushWorld(x2, y2);
                    }

                    if (mirrorV && frameH !== null) {
                        x3 = x1;
                        y3 = frameH - 1 - ly;
                        if (!(x3 === x1 && y3 === y1)) pushWorld(x3, y3);
                    }

                    if (mirrorH && mirrorV && frameW !== null && frameH !== null) {
                        const x4 = frameW - 1 - lx;
                        const y4 = frameH - 1 - ly;
                        const dup1 = (x4 === x1 && y4 === y1);
                        const dup2 = (x2 !== null && y2 !== null && x4 === x2 && y4 === y2);
                        const dup3 = (x3 !== null && y3 !== null && x4 === x3 && y4 === y3);
                        if (!dup1 && !dup2 && !dup3) pushWorld(x4, y4);
                    }
                };
                for (let yy = 0; yy < side; yy++) {
                    for (let xx = 0; xx < side; xx++) {
                        addMirrored(sx + xx, sy + yy);
                    }
                }
                pixels.length = write;
                return pixels;
            };

            // Reset pixel-perfect stroke bookkeeping when no buttons are held.
            if (!this.mouse.held('left') && !this.mouse.held('right')) {
                this._pixelPerfectStrokeActive = false;
                this._pixelPerfectHistory = [];
                this._pixelPerfectOriginals = new Map();
            }

            if (this.mouse.held('left')) { // draw an NxN square centered on cursor (top-left bias for even sizes)
                const sx = pos.x - half;
                const sy = pos.y - half;
                const worldPixels = worldPixelsFromBrush(sx, sy, this._worldPixelBrushBuffer);
                try {
                    if (this.mouse.pressed('left') && this._anyWorldPixelWouldChange(worldPixels, color)) {
                        this._playSfx('pixel.place');
                    }
                } catch (e) {}
                this._paintWorldPixels(worldPixels, color, { dedupe: false });
            }
            if (this.mouse.held('right')) { // erase NxN square
                const eraseColor = '#00000000';
                const sx = pos.x - half;
                const sy = pos.y - half;
                const worldPixels = worldPixelsFromBrush(sx, sy, this._worldPixelBrushBuffer);
                try {
                    if (this.mouse.pressed('right') && this._anyWorldPixelWouldChange(worldPixels, eraseColor)) {
                        this._playSfx('pixel.remove');
                    }
                } catch (e) {}
                this._paintWorldPixels(worldPixels, eraseColor, { dedupe: false });
            }

            } finally {
                this._bypassMirrorWrap = prevBypass;
            }
            
        } catch (e) {
            console.warn('penTool failed', e);
        }
    }

    _resetPixelPerfectStroke() {
        this._pixelPerfectStrokeActive = false;
        this._pixelPerfectHistory = [];
        this._pixelPerfectOriginals = new Map();
    }

    // Tile brush handler for render-only tilemode (zoomed-out tilemap editing).
    _handleRenderOnlyTilePaint(pos) {
        try {
            if (!this.tilemode) return;
            this._adoptCurrentTileArraysIntoActiveLayer();
            const center = (() => {
                if (pos && pos.tileCol !== null && pos.tileCol !== undefined && pos.tileRow !== null && pos.tileRow !== undefined) {
                    return { col: pos.tileCol, row: pos.tileRow };
                }
                if (typeof pos?.areaIndex === 'number' && Array.isArray(this._tileIndexToCoord)) {
                    const cr = this._tileIndexToCoord[pos.areaIndex];
                    if (cr) return { col: cr.col, row: cr.row };
                }
                return null;
            })();
            if (!center) return;

            const side = Math.max(1, Math.min(15, this.brushSize || 1));
            const tiles = this._tileBrushTiles(center.col, center.row, side, this._tileBrushTilesBuffer);
            if (!tiles.length) return;

            // SFX: play once on press.
            try {
                if (this.mouse && typeof this.mouse.pressed === 'function') {
                    if (this.mouse.pressed('left')) this._playSfx('tile.place');
                    if (this.mouse.pressed('right')) {
                        const isDeselect = !!(this._tileSelection && this._tileSelection.size > 0);
                        this._playSfx(isDeselect ? 'select.tile' : 'tile.remove');
                    }
                }
            } catch (e) {}

            // Build the frame stack so tile painting mirrors the 'y' bind behavior (multi-select aware).
            const buildStack = () => {
                const frames = this._tileBrushStackBuffer || (this._tileBrushStackBuffer = []);
                frames.length = 0;
                const pushFrame = (v) => {
                    if (!Number.isFinite(v)) return;
                    const n = Number(v) | 0;
                    for (let i = 0; i < frames.length; i++) {
                        if (frames[i] === n) return;
                    }
                    frames.push(n);
                };
                try { pushFrame(this.selectedFrame); } catch (e) {}
                try {
                    const fs = this.FrameSelect;
                    if (fs && fs._multiSelected && fs._multiSelected.size > 0) {
                        for (const i of fs._multiSelected.values()) pushFrame(i);
                        frames.sort((a, b) => a - b);
                    }
                } catch (e) { /* ignore multi-select gather errors */ }
                return (frames.length > 1) ? frames : [];
            };

            const stack = buildStack();

            // Binding to apply comes from tile eyedrop (if any) or current selection
            const baseBinding = this._tileBrushBinding || { anim: this.selectedAnimation, index: this.selectedFrame };
            const baseTransform = this._tileBrushTransform ? { ...this._tileBrushTransform } : null;

            if (this.mouse.held('left')) {
                const updateSet = this._autotileNeighborCoordSet || (this._autotileNeighborCoordSet = new Set());
                if (this.autotile) updateSet.clear();
                for (const t of tiles) {
                    const idx = (typeof t.areaIndex === 'number') ? t.areaIndex : this._getAreaIndexForCoord(t.col, t.row);
                    if (idx === null || idx === undefined) continue;
                    this._activateTile(t.col, t.row);
                    const entry = { ...baseBinding };
                    if (stack.length > 0) entry.multiFrames = stack;
                    // apply autotile selection if enabled
                    if (this.autotile) {
                        try {
                            const logicalAnim = this._getAutotileLogicalAnimationName(entry.anim || (this.selectedAnimation || ''));
                            const resolved = this._resolveAutotileBindingForTile(t.col, t.row, logicalAnim);
                            if (resolved && typeof resolved === 'object') {
                                if (typeof resolved.anim === 'string' && resolved.anim) entry.anim = resolved.anim;
                                if (resolved.index !== null && typeof resolved.index !== 'undefined') entry.index = resolved.index;
                            }
                        } catch (e) {}
                    }
                    this._setAreaBindingAtIndex(idx, entry, true);
                    try {
                        const frameKey = (this.selectedAnimation || '') + '::' + (Number.isFinite(this.selectedFrame) ? this.selectedFrame : 0);
                        const connKey = this.selectedTileConnection || ((this._tileConnMap && this._tileConnMap[frameKey]) ? this._tileConnMap[frameKey] : null);
                        //console.log('Placed tile connection:', connKey, 'at', t.col, t.row, entry);
                    } catch (e) {}
                    if (baseTransform) this._setAreaTransformAtIndex(idx, { ...baseTransform }, true);
                    try { if (this.autotile) this._collectAutotileNeighborhoodKeys(t.col, t.row, updateSet); } catch (e) {}
                }

                if (this.autotile && updateSet.size > 0) {
                    const fallbackAnim = this._getAutotileLogicalAnimationName(baseBinding && baseBinding.anim ? baseBinding.anim : this.selectedAnimation);
                    for (const key of updateSet.values()) {
                        const p = this._parseTileKey(key);
                        if (!p) continue;
                        const ai = (typeof this._getAreaIndexForCoord === 'function') ? this._getAreaIndexForCoord(p.col, p.row) : null;
                        if (ai === null || ai === undefined) continue;
                        const b = Array.isArray(this._areaBindings) ? this._areaBindings[ai] : null;
                        if (!b || !b.anim) continue;
                        const logical = this._getAutotileLogicalAnimationName(b.anim) || fallbackAnim;
                        if (!logical) continue;
                        this._applyAutotileAt(p.col, p.row, logical);
                    }
                }
            } else if (this.mouse.held('right')) {
                // If tiles are selected, right-drag acts as deselect instead of erase
                if (this._tileSelection && this._tileSelection.size > 0) {
                    for (const t of tiles) this._tileSelection.delete(this._tileKey(t.col, t.row));
                    this.mouse.pause(0.2); // prevent the same press from leaking into erase
                    return;
                } else {
                    for (const t of tiles) {
                        const idx = (typeof t.areaIndex === 'number') ? t.areaIndex : this._getAreaIndexForCoord(t.col, t.row);
                        if (idx === null || idx === undefined) continue;
                        // capture old binding anim so neighbors of same animation can be updated
                        let oldAnim = null;
                        try {
                            const oldBinding = this.getAreaBinding(idx);
                            if (oldBinding && oldBinding.anim) oldAnim = this._getAutotileLogicalAnimationName(oldBinding.anim);
                        } catch(e){}
                        try { this._clearTileOnActiveLayer(t.col, t.row, true); } catch (e) { /* ignore */ }
                        // update neighbors if autotile enabled
                        try { if (this.autotile) this._updateAutotileNeighbors(t.col, t.row, oldAnim || this.selectedAnimation); } catch(e){}
                    }
                }
            }
        } catch (e) {
            console.warn('render-only tile paint failed', e);
        }
    }

    // Compute tile footprint for a brush centered at (col,row) covering `side` tiles per edge.
    _tileBrushTiles(centerCol, centerRow, side, outTiles = null) {
        const tiles = Array.isArray(outTiles) ? outTiles : [];
        tiles.length = 0;
        const n = Math.max(1, Math.min(1000, Number(side) || 1));
        const start = -Math.floor(n / 2);
        let k = 0;
        for (let ddy = 0; ddy < n; ddy++) {
            const dy = start + ddy;
            for (let ddx = 0; ddx < n; ddx++) {
                const dx = start + ddx;
                const col = centerCol + dx;
                const row = centerRow + dy;
                const areaIndex = (typeof this._getAreaIndexForCoord === 'function') ? this._getAreaIndexForCoord(col, row) : null;
                let entry = tiles[k];
                if (!entry) {
                    entry = { col: 0, row: 0, areaIndex: null };
                    tiles[k] = entry;
                }
                entry.col = col;
                entry.row = row;
                entry.areaIndex = areaIndex;
                k++;
            }
        }
        tiles.length = k;
        return tiles;
    }

    _collectAutotileNeighborhoodKeys(col, row, outSet) {
        const set = outSet || this._autotileNeighborCoordSet;
        if (!set) return;
        const deltas = this._autotileNeighborDeltas || [
            [0, 0],
            [0, -1], [1, 0], [0, 1], [-1, 0],
            [-1, -1], [1, -1], [1, 1], [-1, 1]
        ];
        for (let i = 0; i < deltas.length; i++) {
            const d = deltas[i];
            set.add(this._tileKey(col + d[0], row + d[1]));
        }
    }

    // Compute a 10-bit connection key for tile at (col,row) for a given animation name.
    // Bits 0-7: edges then corners (1 = outside, 0 = inside). Bits 8-9: extra flags.
    _computeConnectionKey(col, row, anim) {
        // bits: edges top,right,bottom,left then corners tl,tr,br,bl. '1' means closed (no neighbor)
        const hasNeighbor = (c, r) => {
            const ai = (typeof this._getAreaIndexForCoord === 'function') ? this._getAreaIndexForCoord(c, r) : null;
            if (ai === null || ai === undefined) return false;
            const b = Array.isArray(this._areaBindings) ? this._areaBindings[ai] : null;
            if (!b) return false;
            return (this._getAutotileLogicalAnimationName(b.anim) === anim);
        };

        const top = hasNeighbor(col, row-1);
        const right = hasNeighbor(col+1, row);
        const bottom = hasNeighbor(col, row+1);
        const left = hasNeighbor(col-1, row);
        // edges: closed if no neighbor
        let eTop = top ? '0' : '1';
        let eRight = right ? '0' : '1';
        let eBottom = bottom ? '0' : '1';
        let eLeft = left ? '0' : '1';

        // corners: check diagonal neighbors
        const tl = hasNeighbor(col-1, row-1);
        const tr = hasNeighbor(col+1, row-1);
        const br = hasNeighbor(col+1, row+1);
        const bl = hasNeighbor(col-1, row+1);
        let cTL = tl ? '0' : '1';
        let cTR = tr ? '0' : '1';
        let cBR = br ? '0' : '1';
        let cBL = bl ? '0' : '1';

        // If an edge is closed, its touching corners must also close
        if (eTop === '1') { cTL = '1'; cTR = '1'; }
        if (eRight === '1') { cTR = '1'; cBR = '1'; }
        if (eBottom === '1') { cBR = '1'; cBL = '1'; }
        if (eLeft === '1') { cTL = '1'; cBL = '1'; }

        // Final key: edges then corners (append two zeros for extra flags)
        return '' + eTop + eRight + eBottom + eLeft + cTL + cTR + cBR + cBL + '00';
    }

    _computeBinaryConnectionKey(col, row, predicate) {
        try {
            const has = (c, r) => {
                const ai = (typeof this._getAreaIndexForCoord === 'function') ? this._getAreaIndexForCoord(c, r) : null;
                if (ai === null || ai === undefined) return false;
                const b = Array.isArray(this._areaBindings) ? this._areaBindings[ai] : null;
                return !!predicate(b, c, r, ai);
            };

            const eTop = has(col, row - 1) ? '1' : '0';
            const eRight = has(col + 1, row) ? '1' : '0';
            const eBottom = has(col, row + 1) ? '1' : '0';
            const eLeft = has(col - 1, row) ? '1' : '0';

            const cTL = has(col - 1, row - 1) ? '1' : '0';
            const cTR = has(col + 1, row - 1) ? '1' : '0';
            const cBR = has(col + 1, row + 1) ? '1' : '0';
            const cBL = has(col - 1, row + 1) ? '1' : '0';

            return '' + eTop + eRight + eBottom + eLeft + cTL + cTR + cBR + cBL + '00';
        } catch (e) {
            return '0000000000';
        }
    }

    _computeTransitionConnectionKey(col, row, firstAnim, targetAnim = null) {
        try {
            const base = String(this._getAutotileLogicalAnimationName(firstAnim || '') || '').trim();
            if (!base) return '0000000000';
            const target = String(this._getAutotileLogicalAnimationName(targetAnim || '') || '').trim();

            const basePlain = this._computeBinaryConnectionKey(col, row, (binding) => {
                if (!binding || !binding.anim) return false;
                return this._getAutotileLogicalAnimationName(binding.anim) === base;
            });

            // Transition stack uses plain binary toward target animation:
            // bit=1 when the neighbor belongs to target (or non-base fallback).
            const plain = this._computeBinaryConnectionKey(col, row, (binding) => {
                if (!binding || !binding.anim) return false;
                const logical = this._getAutotileLogicalAnimationName(binding.anim);
                if (target) return logical === target;
                return !!logical && logical !== base;
            });

            const b = plain.split('');
            const bb = basePlain.split('');
            const eTop = b[0] === '1';
            const eRight = b[1] === '1';
            const eBottom = b[2] === '1';
            const eLeft = b[3] === '1';
            const cTL = b[4] === '1';
            const cTR = b[5] === '1';
            const cBR = b[6] === '1';
            const cBL = b[7] === '1';

            const baseTL = bb[4] === '1';
            const baseTR = bb[5] === '1';
            const baseBR = bb[6] === '1';
            const baseBL = bb[7] === '1';

            const edgeCount = (eTop ? 1 : 0) + (eRight ? 1 : 0) + (eBottom ? 1 : 0) + (eLeft ? 1 : 0);
            const cornerCount = (cTL ? 1 : 0) + (cTR ? 1 : 0) + (cBR ? 1 : 0) + (cBL ? 1 : 0);

            // Pure interior-corner transitions.
            if (edgeCount === 0) {
                if (cornerCount === 1) {
                    if (cTL) return '0000100000';
                    if (cTR) return '0000010000';
                    if (cBR) return '0000000100';
                    if (cBL) return '0000001000';
                }
                // Fallback: return normalized 10-bit form of plain binary semantics.
                return this._normalizeOpenConnectionKey(plain);
            }

            // Single-edge transitions: center band + edge-outline variants.
            if (edgeCount === 1) {
                const hash = Math.abs((((Number(col) | 0) * 73856093) ^ ((Number(row) | 0) * 19349663)) >>> 0);

                if (eTop) {
                    if (baseTL && !baseTR) return '1000110100';
                    if (baseTR && !baseTL) return '1000111000';
                    if (baseTL && baseTR) return (hash & 1) ? '1000110100' : '1000111000';
                    return '1000110000';
                }
                if (eRight) {
                    if (baseTR && !baseBR) return '0100111000';
                    if (baseBR && !baseTR) return '0100011100';
                    if (baseTR && baseBR) return (hash & 1) ? '0100111000' : '0100011100';
                    return '0100011000';
                }
                if (eBottom) {
                    if (baseBL && !baseBR) return '0010101100';
                    if (baseBR && !baseBL) return '0010011100';
                    if (baseBL && baseBR) return (hash & 1) ? '0010101100' : '0010011100';
                    return '0010001100';
                }
                if (eLeft) {
                    if (baseTL && !baseBL) return '0001110100';
                    if (baseBL && !baseTL) return '0001101100';
                    if (baseTL && baseBL) return (hash & 1) ? '0001110100' : '0001101100';
                    return '0001100100';
                }
            }

            // Complex/multi-edge junctions: normalize for robust best-match fallback.
            return this._normalizeOpenConnectionKey(plain);
        } catch (e) {
            return '0000000000';
        }
    }

    _getAutotileLogicalAnimationName(animName) {
        try {
            const raw = String(animName || '').trim();
            if (!raw) return '';
            const m = raw.match(/^(.+?)-to-(.+)$/i);
            if (m && m[1]) return String(m[1]).trim();
            return raw;
        } catch (e) {
            return String(animName || '').trim();
        }
    }

    _resolveAutotileTransitionTargetAt(col, row, baseAnim) {
        try {
            const base = String(baseAnim || '').trim();
            if (!base) return null;
            const sheet = this.currentSprite;
            if (!sheet || !sheet._frames || typeof sheet._frames.has !== 'function') return null;

            const counts = new Map();
            const edgeNeighbors = [[0, -1], [1, 0], [0, 1], [-1, 0]];
            for (const d of edgeNeighbors) {
                const ai = (typeof this._getAreaIndexForCoord === 'function') ? this._getAreaIndexForCoord(col + d[0], row + d[1]) : null;
                if (ai === null || ai === undefined) continue;
                const b = Array.isArray(this._areaBindings) ? this._areaBindings[ai] : null;
                if (!b || !b.anim) continue;
                const other = this._getAutotileLogicalAnimationName(b.anim);
                if (!other || other === base) continue;

                const transitionAnim = `${base}-to-${other}`;
                if (!sheet._frames.has(transitionAnim)) continue;
                if (this._getAnimationLogicalFrameCountExact(transitionAnim) <= 0) continue;

                counts.set(other, (counts.get(other) || 0) + 1);
            }

            if (counts.size === 0) return null;
            let bestOther = null;
            let bestCount = -1;
            for (const [other, n] of counts.entries()) {
                if (n > bestCount) {
                    bestCount = n;
                    bestOther = other;
                }
            }
            if (!bestOther) return null;
            return {
                targetAnim: bestOther,
                transitionAnim: `${base}-to-${bestOther}`
            };
        } catch (e) {
            return null;
        }
    }

    _resolveAutotileBindingForTile(col, row, baseAnim) {
        try {
            const base = String(this._getAutotileLogicalAnimationName(baseAnim || this.selectedAnimation || '') || '').trim();
            if (!base) return null;

            const transition = this._resolveAutotileTransitionTargetAt(col, row, base);
            const animForLookup = transition && transition.transitionAnim ? transition.transitionAnim : base;
            const key = transition
                ? this._computeTransitionConnectionKey(col, row, base, transition.targetAnim)
                : this._computeConnectionKey(col, row, base);
            let preferredDominant = null;
            if (transition && transition.targetAnim) {
                let baseCount = 0;
                let targetCount = 0;
                const ring = [
                    [0, -1], [1, 0], [0, 1], [-1, 0],
                    [-1, -1], [1, -1], [1, 1], [-1, 1]
                ];
                for (const d of ring) {
                    const ai = (typeof this._getAreaIndexForCoord === 'function') ? this._getAreaIndexForCoord(col + d[0], row + d[1]) : null;
                    if (ai === null || ai === undefined) continue;
                    const b = Array.isArray(this._areaBindings) ? this._areaBindings[ai] : null;
                    if (!b || !b.anim) continue;
                    const logical = this._getAutotileLogicalAnimationName(b.anim);
                    if (logical === base) baseCount++;
                    if (logical === transition.targetAnim) targetCount++;
                }
                preferredDominant = (targetCount > baseCount) ? 'to' : 'from';
            }

            const chosen = this._chooseBestTileIndex(key, animForLookup, { col, row, preferredDominant });
            if (chosen === null || typeof chosen === 'undefined') return null;

            return { anim: animForLookup, index: chosen, key };
        } catch (e) {
            return null;
        }
    }

    _normalizeOpenConnectionKey(key) {
        // Support 10-bit open-connection keys (8 basic + 2 extra bits)
        let bits = String(key || '0000000000').replace(/[^01]/g, '');
        while (bits.length < 10) bits += '0';
        bits = bits.slice(0, 10);
        const arr = bits.split('');
        // Preserve original 8-bit semantics for edges/corners
        const edgeTop = arr[0] === '1';
        const edgeRight = arr[1] === '1';
        const edgeBottom = arr[2] === '1';
        const edgeLeft = arr[3] === '1';
        if (edgeTop) { arr[4] = '1'; arr[5] = '1'; }
        if (edgeRight) { arr[5] = '1'; arr[6] = '1'; }
        if (edgeBottom) { arr[6] = '1'; arr[7] = '1'; }
        if (edgeLeft) { arr[4] = '1'; arr[7] = '1'; }
        // Bits 8 and 9 are preserved as-is (extra cliff/half-edge flags)
        return arr.join('');
    }

    _openConnectionToClosedKey(openKey) {
        const norm = this._normalizeOpenConnectionKey(openKey);
        // Return closed-key in legacy 8-bit form (edges then corners).
        // Normalization produces 10 bits; trim to first 8 for closed-key comparisons.
        return String(norm || '').slice(0, 8);
    }

    _getAllValidOpenConnectionKeys() {
        // Build canonical set based on original 8-bit semantics, then
        // append the two extra 10-bit tiles used for cliff halves.
        const set = new Set();
        // First, collect stable 8-bit keys (legacy behavior)
        for (let mask = 0; mask < 256; mask++) {
            const bits8 = mask.toString(2).padStart(8, '0');
            const norm8 = this._normalizeOpenConnectionKey(bits8);
            // normalize returns 10-bit canonical, but ensure we store canonical form
            set.add(norm8);
        }
        // Add the two extra 10-bit variants (bottom-left-half and flipped)
        // These are trailing bits beyond the original 8; keep them canonical via normalize.
        try {
            set.add(this._normalizeOpenConnectionKey('0000000001'));
            set.add(this._normalizeOpenConnectionKey('0000000010'));
        } catch (e) {}
        return Array.from(set.values());
    }

    _findConnectionFrameIndex(anim, normalizedOpenKey) {
        try {
            const target = this._normalizeOpenConnectionKey(normalizedOpenKey);
            const count = Math.max(1, Number(this._getAnimationLogicalFrameCount(anim)) || 1);
            for (let i = 0; i < count; i++) {
                const raw = this._tileConnMap && this._tileConnMap[anim + '::' + i];
                if (typeof raw !== 'string') continue;
                if (this._normalizeOpenConnectionKey(raw) === target) return i;
            }
        } catch (e) {}
        return null;
    }

    _noise01(x, y, seed = 1) {
        const n = Math.sin((x * 127.1) + (y * 311.7) + (seed * 74.7)) * 43758.5453123;
        return n - Math.floor(n);
    }

    _getAnimationLogicalFrameCountExact(anim) {
        try {
            const arr = (this.currentSprite && this.currentSprite._frames) ? (this.currentSprite._frames.get(anim) || []) : [];
            let logical = 0;
            for (let i = 0; i < arr.length; i++) {
                const entry = arr[i];
                if (!entry || entry.__groupStart || entry.__groupEnd) continue;
                logical++;
            }
            return Math.max(0, logical);
        } catch (e) {
            return 0;
        }
    }

    _parseTransitionAnimationName(animName) {
        try {
            const raw = String(animName || '').trim();
            if (!raw) return null;
            const match = raw.match(/^(.+?)-to-(.+)$/i);
            if (!match) return null;
            const fromAnim = String(match[1] || '').trim();
            const toAnim = String(match[2] || '').trim();
            if (!fromAnim || !toAnim) return null;
            return { fromAnim, toAnim };
        } catch (e) {
            return null;
        }
    }

    _renderTransitionBlendFrame(fromFrame, toFrame, mode = 'center', options = {}) {
        try {
            if (!fromFrame || !toFrame || typeof fromFrame.getContext !== 'function' || typeof toFrame.getContext !== 'function') return null;
            const px = Math.max(1, Number(this.currentSprite && this.currentSprite.slicePx) || Number(fromFrame.width) || Number(toFrame.width) || 16);

            const fromCanvas = document.createElement('canvas');
            fromCanvas.width = px;
            fromCanvas.height = px;
            const fctx = fromCanvas.getContext('2d');
            if (!fctx) return null;
            try { fctx.imageSmoothingEnabled = false; } catch (e) {}
            fctx.clearRect(0, 0, px, px);
            fctx.drawImage(fromFrame, 0, 0, fromFrame.width, fromFrame.height, 0, 0, px, px);

            const toCanvas = document.createElement('canvas');
            toCanvas.width = px;
            toCanvas.height = px;
            const tctx = toCanvas.getContext('2d');
            if (!tctx) return null;
            try { tctx.imageSmoothingEnabled = false; } catch (e) {}
            tctx.clearRect(0, 0, px, px);
            tctx.drawImage(toFrame, 0, 0, toFrame.width, toFrame.height, 0, 0, px, px);

            const fromImage = fctx.getImageData(0, 0, px, px);
            const toImage = tctx.getImageData(0, 0, px, px);
            const out = document.createElement('canvas');
            out.width = px;
            out.height = px;
            const octx = out.getContext('2d');
            if (!octx) return null;
            const outImage = octx.createImageData(px, px);

            const clamp01 = (v) => Math.max(0, Math.min(1, v));
            const noiseAmount = clamp01(Number(options.noiseAmount) || 0.3);
            const seed = Math.floor(Number(options.seed) || 1);
            const feather = Math.max(0.03, Math.min(0.45, Number(options.transitionFeather) || 0.12));
            const mirrorVariant = !!options.mirrorVariant;
            const perpendicularSplit = !!options.perpendicularSplit;
            const cornerDominant = (options.cornerDominant === 'to') ? 'to' : 'from';

            const fromWeightAt = (x, y) => {
                const nx = (x + 0.5) / px;
                const ny = (y + 0.5) / px;
                const n = ((this._noise01((x * 1.13) + 3, (y * 1.91) + 11, seed) * 2) - 1) * noiseAmount;
                const boundary = 0.5 + (n * 0.22);

                // Interior corner transition modes with circular quarter rounding.
                // Dominance controls whether this tile is mostly first or mostly second tilesheet.
                if (mode === 'corner-tl' || mode === 'corner-tr' || mode === 'corner-br' || mode === 'corner-bl') {
                    let ux = nx, uy = ny;
                    if (mode === 'corner-tr') { ux = 1 - nx; uy = ny; }
                    if (mode === 'corner-br') { ux = 1 - nx; uy = 1 - ny; }
                    if (mode === 'corner-bl') { ux = nx; uy = 1 - ny; }

                    const nCorner = ((this._noise01((x * 2.11) + 19, (y * 1.73) + 31, seed + 211) * 2) - 1) * noiseAmount;
                    const r = Math.max(0.24, Math.min(0.76, 0.48 + (nCorner * 0.06)));
                    const dist = Math.hypot(ux, uy);
                    const cornerFeather = Math.max(0.02, feather * 0.85);
                    const mask = clamp01(0.5 + ((r - dist) / cornerFeather)); // ~1 inside corner wedge

                    // `w` is globally flipped below (`w = 1 - fromWeightAt`), so return inverse.
                    const finalFromWeight = (cornerDominant === 'to') ? mask : (1 - mask);
                    return 1 - finalFromWeight;
                }

                // Default: transition varies along edge normal.
                // Edge-transition variants can opt into perpendicular splitting.
                let normalCoord = (mode === 'top' || mode === 'bottom') ? ny : nx;
                let tangentCoord = (mode === 'top' || mode === 'bottom') ? nx : ny;
                if (mirrorVariant) tangentCoord = 1 - tangentCoord;

                const activeCoord = perpendicularSplit ? tangentCoord : normalCoord;

                if (mode === 'top') return clamp01(((boundary - activeCoord) / feather) + 0.5);
                if (mode === 'right') return clamp01(((activeCoord - boundary) / feather) + 0.5);
                if (mode === 'bottom') return clamp01(((activeCoord - boundary) / feather) + 0.5);
                if (mode === 'left') return clamp01(((boundary - activeCoord) / feather) + 0.5);

                // center: patchy 50/50 blend with mild bias variation.
                const n2 = ((this._noise01((x * 2.37) + 17, (y * 2.09) + 29, seed + 37) * 2) - 1);
                return clamp01(0.5 + (n2 * (0.14 + noiseAmount * 0.2)));
            };

            for (let y = 0; y < px; y++) {
                for (let x = 0; x < px; x++) {
                    const i = (y * px + x) * 4;
                    // Flip orientation so transition sides align with autotile placement semantics.
                    const w = 1 - fromWeightAt(x, y);
                    const inv = 1 - w;

                    outImage.data[i] = Math.round((fromImage.data[i] * w) + (toImage.data[i] * inv));
                    outImage.data[i + 1] = Math.round((fromImage.data[i + 1] * w) + (toImage.data[i + 1] * inv));
                    outImage.data[i + 2] = Math.round((fromImage.data[i + 2] * w) + (toImage.data[i + 2] * inv));
                    outImage.data[i + 3] = Math.round((fromImage.data[i + 3] * w) + (toImage.data[i + 3] * inv));
                }
            }

                    // After applying the normal outline logic, if depth is used
                    // and two frames are multi-selected (top + wall), draw an
                    // additional seam outline at the depth boundary using the
                    // same outline parameters.
                    if (depthPx > 0) {
                        try {
                            const fs = this.FrameSelect;
                            if (fs && fs._multiSelected && fs._multiSelected.size >= 2) {
                                const seamY = Math.max(0, bottomBoundary);
                                const odata = outImage.data;
                                const stepDivLocal = Math.max(1, colorSteps - 1);
                                const stepUnitLocal = maxDelta / stepDivLocal;
                                for (let dy = -outlineWidth; dy <= outlineWidth; dy++) {
                                    const yy = seamY + dy;
                                    if (yy < 0 || yy >= px) continue;
                                    for (let xx = 0; xx < px; xx++) {
                                        const i = (yy * px + xx) * 4;
                                        const alpha = odata[i + 3] / 255;
                                        if (alpha <= 0) continue;
                                        const nearestLocal = Math.abs(dy);
                                        const tLocal = clamp01(nearestLocal / Math.max(0.0001, outlineWidth));
                                        const edgeBlendLocal = Math.pow(1 - tLocal, 1 + (falloff * 4));
                                        const noiseLocal = ((this._noise01((xx * 1.37) + 9, (yy * 0.83) + 17, seed + 97) * 2) - 1) * maxDelta * noiseAmount;
                                        let deltaLocal = (tone * edgeBlendLocal * maxDelta) + noiseLocal;
                                        deltaLocal = Math.round(deltaLocal / stepUnitLocal) * stepUnitLocal;

                                        if (useCustomOutline && _customBaseColor) {
                                            try {
                                                const srcRgb = new Color(odata[i], odata[i + 1], odata[i + 2], alpha, 'rgb');
                                                const customRgb = (_customBaseColor.type === 'rgb') ? _customBaseColor : _customBaseColor.toRgb();
                                                const noiseNorm = (maxDelta > 0) ? (noiseLocal / maxDelta) : 0;
                                                let mixAmt = edgeBlendLocal + noiseNorm;
                                                mixAmt = Math.max(0, Math.min(1, mixAmt));
                                                const quantMix = Math.round(mixAmt * stepDivLocal) / stepDivLocal;
                                                const r = Math.round(mix(srcRgb.a, customRgb.a, quantMix));
                                                const g = Math.round(mix(srcRgb.b, customRgb.b, quantMix));
                                                const b = Math.round(mix(srcRgb.c, customRgb.c, quantMix));
                                                const aMix = mix(srcRgb.d ?? alpha, customRgb.d ?? 1, quantMix);
                                                odata[i] = Math.max(0, Math.min(255, r));
                                                odata[i + 1] = Math.max(0, Math.min(255, g));
                                                odata[i + 2] = Math.max(0, Math.min(255, b));
                                                odata[i + 3] = Math.max(0, Math.min(255, Math.round((aMix ?? alpha) * 255)));
                                            } catch (e) {}
                                            continue;
                                        }

                                        let cLocal = new Color(odata[i], odata[i + 1], odata[i + 2], alpha, 'rgb').toHsv();
                                        if (!cLocal) continue;
                                        if (colorChannel === 'h') cLocal.a = ((cLocal.a + deltaLocal) % 1 + 1) % 1;
                                        if (colorChannel === 's') cLocal.b = clamp01(cLocal.b + deltaLocal);
                                        if (colorChannel === 'v') cLocal.c = clamp01(cLocal.c + deltaLocal);
                                        if (colorChannel === 'a') cLocal.d = clamp01(cLocal.d + deltaLocal);
                                        const rgbLocal = cLocal.toRgb();
                                        if (!rgbLocal) continue;
                                        odata[i] = Math.max(0, Math.min(255, Math.round(rgbLocal.a)));
                                        odata[i + 1] = Math.max(0, Math.min(255, Math.round(rgbLocal.b)));
                                        odata[i + 2] = Math.max(0, Math.min(255, Math.round(rgbLocal.c)));
                                        odata[i + 3] = Math.max(0, Math.min(255, Math.round((rgbLocal.d ?? alpha) * 255)));
                                    }
                                }
                            }
                        } catch (e) {}
                    }

                    octx.putImageData(outImage, 0, 0);
                    return out;
        } catch (e) {
            return null;
        }
    }

    _runNamedTransitionTilesetGeneration(settings = {}) {
        try {
            const anim = String(settings.sourceAnimation || this.selectedAnimation || 'idle').trim();
            const parsed = this._parseTransitionAnimationName(anim);
            if (!parsed) return { ok: false, reason: 'Animation name must follow "<from>-to-<to>" format.' };

            const sheet = this.currentSprite;
            if (!sheet || typeof sheet.getFrame !== 'function' || typeof sheet.insertFrame !== 'function') {
                return { ok: false, reason: 'Sprite sheet is not ready.' };
            }

            const existingCount = this._getAnimationLogicalFrameCountExact(anim);
            if (existingCount > 0) {
                return { ok: false, reason: 'Transition target animation must be empty before generation.' };
            }

            const fromBaseFrame = sheet.getFrame(parsed.fromAnim, 0);
            const toBaseFrame = sheet.getFrame(parsed.toAnim, 0);
            if (!fromBaseFrame || !toBaseFrame) {
                return { ok: false, reason: `Missing source frames. Ensure animations "${parsed.fromAnim}" and "${parsed.toAnim}" both have at least one frame.` };
            }

            if (!this._tileConnMap || typeof this._tileConnMap !== 'object') this._tileConnMap = {};

            const defs = [
                // Keep these 4 as center transition bands.
                    { mode: 'top', key: '1000110000', useConnFrames: false, mirrorVariant: false, perpendicularSplit: false },
                    { mode: 'right', key: '0100011000', useConnFrames: false, mirrorVariant: false, perpendicularSplit: false },
                    { mode: 'bottom', key: '0010001100', useConnFrames: false, mirrorVariant: false, perpendicularSplit: false },
                    { mode: 'left', key: '0001100100', useConnFrames: false, mirrorVariant: false, perpendicularSplit: false },

                    // 8 true edge-outline transitions (mirror pairs per direction).
                    { mode: 'top', key: '1000110100', sourceKey: '1000110000', useConnFrames: true, mirrorVariant: false, perpendicularSplit: true },
                    { mode: 'top', key: '1000111000', sourceKey: '1000110000', useConnFrames: true, mirrorVariant: true, perpendicularSplit: true },
                    { mode: 'right', key: '0100011100', sourceKey: '0100011000', useConnFrames: true, mirrorVariant: false, perpendicularSplit: true },
                    { mode: 'right', key: '0100111000', sourceKey: '0100011000', useConnFrames: true, mirrorVariant: true, perpendicularSplit: true },
                    { mode: 'bottom', key: '0010011100', sourceKey: '0010001100', useConnFrames: true, mirrorVariant: false, perpendicularSplit: true },
                    { mode: 'bottom', key: '0010101100', sourceKey: '0010001100', useConnFrames: true, mirrorVariant: true, perpendicularSplit: true },
                    { mode: 'left', key: '0001110100', sourceKey: '0001100100', useConnFrames: true, mirrorVariant: false, perpendicularSplit: true },
                    { mode: 'left', key: '0001101100', sourceKey: '0001100100', useConnFrames: true, mirrorVariant: true, perpendicularSplit: true },

                    // 8 interior-corner transitions:
                    // 4 mostly-first + 1-part-second, and 4 mostly-second + 1-part-first.
                    { mode: 'corner-tl', key: '0000100000', sourceKey: '0000100000', useConnFrames: true, mirrorVariant: false, perpendicularSplit: false, cornerDominant: 'from' },
                    { mode: 'corner-tr', key: '0000010000', sourceKey: '0000010000', useConnFrames: true, mirrorVariant: false, perpendicularSplit: false, cornerDominant: 'from' },
                    { mode: 'corner-br', key: '0000000100', sourceKey: '0000000100', useConnFrames: true, mirrorVariant: false, perpendicularSplit: false, cornerDominant: 'from' },
                    { mode: 'corner-bl', key: '0000001000', sourceKey: '0000001000', useConnFrames: true, mirrorVariant: false, perpendicularSplit: false, cornerDominant: 'from' },
                    { mode: 'corner-tl', key: '0000100000', sourceKey: '0000100000', useConnFrames: true, mirrorVariant: false, perpendicularSplit: false, cornerDominant: 'to' },
                    { mode: 'corner-tr', key: '0000010000', sourceKey: '0000010000', useConnFrames: true, mirrorVariant: false, perpendicularSplit: false, cornerDominant: 'to' },
                    { mode: 'corner-br', key: '0000000100', sourceKey: '0000000100', useConnFrames: true, mirrorVariant: false, perpendicularSplit: false, cornerDominant: 'to' },
                    { mode: 'corner-bl', key: '0000001000', sourceKey: '0000001000', useConnFrames: true, mirrorVariant: false, perpendicularSplit: false, cornerDominant: 'to' }
            ];

            if (!this._transitionVariantMeta || typeof this._transitionVariantMeta !== 'object') this._transitionVariantMeta = {};

            let created = 0;
            let dstIndex = 0;
            for (const def of defs) {
                let fromFrame = fromBaseFrame;
                let toFrame = toBaseFrame;

                // For true edge transitions, blend matching connector frames from each source tilesheet.
                if (def.useConnFrames) {
                            const sourceKey = String(def.sourceKey || def.key || '0000000000');
                    const fromIdx = this._findConnectionFrameIndex(parsed.fromAnim, sourceKey);
                    const toIdx = this._findConnectionFrameIndex(parsed.toAnim, sourceKey);
                    const maybeFrom = (fromIdx !== null && Number.isFinite(fromIdx)) ? sheet.getFrame(parsed.fromAnim, fromIdx) : null;
                    const maybeTo = (toIdx !== null && Number.isFinite(toIdx)) ? sheet.getFrame(parsed.toAnim, toIdx) : null;
                    if (maybeFrom) fromFrame = maybeFrom;
                    if (maybeTo) toFrame = maybeTo;
                }

                const rendered = this._renderTransitionBlendFrame(fromFrame, toFrame, def.mode, {
                    ...settings,
                    mirrorVariant: !!def.mirrorVariant,
                    perpendicularSplit: !!def.perpendicularSplit,
                    cornerDominant: def.cornerDominant || 'from'
                });
                if (!rendered) continue;

                sheet.insertFrame(anim);
                const dstFrame = sheet.getFrame(anim, dstIndex);
                const dctx = dstFrame && dstFrame.getContext ? dstFrame.getContext('2d') : null;
                if (!dctx) {
                    dstIndex++;
                    continue;
                }
                dctx.clearRect(0, 0, dstFrame.width, dstFrame.height);
                dctx.drawImage(rendered, 0, 0, dstFrame.width, dstFrame.height);
                try { this._setTileConnection(anim, dstIndex, def.key || '0000000000', false); } catch (e) { this._tileConnMap[anim + '::' + dstIndex] = this._normalizeOpenConnectionKey(def.key); }
                this._transitionVariantMeta[anim + '::' + dstIndex] = {
                    mode: String(def.mode || ''),
                    cornerDominant: def.cornerDominant || null
                };
                created++;
                dstIndex++;
            }

            try { if (typeof sheet._rebuildSheetCanvas === 'function') sheet._rebuildSheetCanvas(); } catch (e) {}
            if (created > 0) {
                try {
                    if (this.stateController && typeof this.stateController.setActiveFrame === 'function') this.stateController.setActiveFrame(0);
                    else this.selectedFrame = 0;
                } catch (e) {}
                return { ok: true, created, total: defs.length, fromAnim: parsed.fromAnim, toAnim: parsed.toAnim };
            }
            return { ok: false, reason: 'No transition tiles were generated.' };
        } catch (e) {
            return { ok: false, reason: String((e && e.message) || e || 'Unknown error') };
        }
    }

    _renderProceduralConnectionFrame(sourceFrame, openKey, options = {}) {
        try {
            if (!sourceFrame || typeof sourceFrame.getContext !== 'function') return null;
            const srcCtx = sourceFrame.getContext('2d');
            if (!srcCtx) return null;

            const px = Math.max(1, Number(sourceFrame.width) || Number(this.currentSprite && this.currentSprite.slicePx) || 16);
            const anim = String(options.sourceAnimation || this.selectedAnimation || 'idle');
            const bits = this._normalizeOpenConnectionKey(openKey).split('').map((b) => b === '1');
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

            // Helper: apply outline algorithm to a provided RGBA Uint8ClampedArray (width=px, height=px)
            const applyOutlineToImage = (idata, bitsObj) => {
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
                    // Top-left
                    if (edgeTopOutside && edgeLeftOutside && x <= cornerZone && y <= cornerZone) {
                        const dist = Math.hypot(x - radius, y - radius);
                        if (dist - radius > cornerCutoff) return true;
                    }
                    // Top-right
                    if (edgeTopOutside && edgeRightOutside && (px - 1 - x) <= cornerZone && y <= cornerZone) {
                        const dx = (px - 1 - x);
                        const dist = Math.hypot(dx - radius, y - radius);
                        if (dist - radius > cornerCutoff) return true;
                    }
                    // Bottom-right
                    if (edgeBottomOutside && edgeRightOutside && (px - 1 - x) <= cornerZone && (px - 1 - y) <= cornerZone) {
                        const dx = (px - 1 - x);
                        const dy = (px - 1 - y);
                        const dist = Math.hypot(dx - radius, dy - radius);
                        if (dist - radius > cornerCutoff) return true;
                    }
                    // Bottom-left
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
                        if (cornerBROutside && !edgeBottomOutside && !edgeRightOutside) nearest = Math.min(nearest, innerCornerDistance((px - 1 - x), (px - 1 - y)));
                        if (cornerBLOutside && !edgeBottomOutside && !edgeLeftOutside) nearest = Math.min(nearest, innerCornerDistance(x, (px - 1 - y)));

                        if (!Number.isFinite(nearest) || nearest > outlineWidth) continue;

                        const t = clamp01(nearest / Math.max(0.0001, outlineWidth));
                        const edgeBlend = Math.pow(1 - t, 1 + (falloff * 4));
                        const noise = ((this._noise01((x * 1.37) + 9, (y * 0.83) + 17, seed + 97) * 2) - 1) * maxDelta * noiseAmount;
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

            // If a depth value is provided and a multi-selected frame exists,
            // composite the ledge/wall (first multi-selected frame) beneath
            // the main tile starting at the depth threshold.
            const depthPx = Math.max(0, Math.min(px, Math.round(Number(options.depth) || 0)));
            const bottomBoundary = px - depthPx - 1; // last y index that belongs to the top tile
            if (depthPx > 0) {
                try {
                    const fs = this.FrameSelect;
                    if (fs && fs._multiSelected && fs._multiSelected.size >= 2) {
                        // If two or more frames selected, use first as TOP, second as WALL
                        // Preserve FrameSelect insertion order (first selected -> top)
                        const multi = Array.from(fs._multiSelected).map(i => Number(i)).filter(Number.isFinite);
                        const topIdx = multi[0];
                        const wallIdx = multi[1];
                        if (typeof this.currentSprite.getFrame === 'function') {
                            const topFrame = this.currentSprite.getFrame(anim, topIdx);
                            const wallFrame = this.currentSprite.getFrame(anim, wallIdx);
                            if (topFrame && wallFrame && topFrame.getContext && wallFrame.getContext) {
                                try {
                                    const seamY = Math.max(0, bottomBoundary);
                                    try { console.log('[gen] depth compositing', JSON.stringify({ openKey: openKey, bits, anim, topIdx, wallIdx, depthPx, seamY })); } catch (e) {}
                                    const tctx = topFrame.getContext('2d');
                                    const wctx = wallFrame.getContext('2d');
                                    const topImg = tctx.getImageData(0, 0, px, px).data;
                                    const wallImg = wctx.getImageData(0, 0, px, px).data;
                                    const odata = outImage.data;
                                    // Determine whether this openKey requests bottom/outside contributions
                                    const edgeBottomOutside = !!bits[2];
                                    const cornerBROutside = !!bits[6];
                                    const cornerBLOutside = !!bits[7];
                                    const needWall = edgeBottomOutside;
                                    try { console.log('[gen] depth needWall', JSON.stringify({ openKey: openKey, edgeBottomOutside, cornerBROutside, cornerBLOutside, needWall })); } catch (e) {}
                                    if (!needWall) {
                                        // no bottom/outside contribution requested for this key; keep top frame entirely
                                        outImage.data.set(topImg);
                                    } else {
                                        // Build separate layer buffers so we can apply outlines independently.
                                        const wallBuf = new Uint8ClampedArray(wallImg); // full tile
                                        const topBuf = new Uint8ClampedArray(topImg); // full tile; we'll mask below seam

                                        // Mask topBuf to only include pixels above the seam (top face)
                                        for (let yy = seamY + 1; yy < px; yy++) {
                                            for (let xx = 0; xx < px; xx++) {
                                                const idx = (yy * px + xx) * 4;
                                                topBuf[idx + 3] = 0; // transparent below seam
                                            }
                                        }

                                        // Carve rounded bottom corners from topBuf based on cornerRoundness
                                        if (cornerRoundness > 0) {
                                            const cornerRadiusLocal = Math.max(1, Math.round(px * 0.32));
                                            const radiusLocal = Math.max(0.0001, cornerRadiusLocal);
                                            const cornerZoneLocal = Math.max(1, Math.floor(cornerRadiusLocal));
                                            const cornerCutoff = radiusLocal * (1 - cornerRoundness);
                                            // centers for quarter-circles just above seam
                                            const centerY = seamY - Math.max(0, Math.round(radiusLocal)) + 1;
                                            const leftCenterX = Math.max(0, Math.round(radiusLocal));
                                            const rightCenterX = Math.max(0, px - 1 - Math.round(radiusLocal));
                                            for (let yy = Math.max(0, seamY - cornerZoneLocal); yy <= seamY; yy++) {
                                                for (let xx = 0; xx < px; xx++) {
                                                    // left corner - only round if left edge is an outside edge
                                                    if (bits[3] && xx <= cornerZoneLocal) {
                                                        const dx = xx - leftCenterX;
                                                        const dy = yy - centerY;
                                                        const dist = Math.hypot(dx, dy);
                                                        if (dist - radiusLocal > cornerCutoff) {
                                                            const idx = (yy * px + xx) * 4;
                                                            topBuf[idx + 3] = 0;
                                                        }
                                                    }
                                                    // right corner - only round if right edge is an outside edge
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

                                        // Apply outline to wall layer using original bits
                                        try { applyOutlineToImage(wallBuf, bits); } catch (e) {}

                                        // For the top face outline, force the bottom edge as an outside
                                        // edge so the seam line receives an outline, but keep other
                                        // edges as indicated by bits. We still ignore corner-only
                                        // signals for deciding to composite (needWall was bottom-only).
                                        const topBits = [bits[0], bits[1], true, bits[3], bits[4], bits[5], bits[6], bits[7]];
                                        try { applyOutlineToImage(topBuf, topBits); } catch (e) {}

                                        // Composite topBuf over wallBuf
                                        for (let yy = 0; yy < px; yy++) {
                                            for (let xx = 0; xx < px; xx++) {
                                                const idx = (yy * px + xx) * 4;
                                                const ta = topBuf[idx + 3] / 255;
                                                if (ta <= 0) continue;
                                                // simple overwrite (top face fully covers wall below)
                                                wallBuf[idx] = topBuf[idx];
                                                wallBuf[idx + 1] = topBuf[idx + 1];
                                                wallBuf[idx + 2] = topBuf[idx + 2];
                                                wallBuf[idx + 3] = topBuf[idx + 3];
                                            }
                                        }

                                        // Set final output to wallBuf (which now has top overlaid)
                                        // Draw an additional center-edge outline along the seam
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

                                            // Compute seam per-column from topBuf alpha so the seam follows curvature
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
                                                if (seamX < 0) continue; // no top pixel in this column
                                                for (let yy = Math.max(0, seamX - band); yy <= Math.min(px - 1, seamX + band); yy++) {
                                                    const yDist = Math.abs(yy - seamX);
                                                    const t = clamp01(yDist / Math.max(0.0001, band));
                                                    const edgeBlend = Math.pow(1 - t, 1 + (falloff * 4));

                                                    // corner-aware falloff: reduce effect near rounded corners
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

                                                    const noise = ((this._noise01((xx * 1.37) + 9, (yy * 0.83) + 17, seed + 97) * 2) - 1) * maxDelta * noiseAmount;
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
                                    }
                                } catch (e) {}
                            }
                        }
                    } else {
                        // fallback: previous behavior (sourceFrame top, first multi as ledge/wall)
                        const fs2 = this.FrameSelect;
                        if (fs2 && fs2._multiSelected && fs2._multiSelected.size > 0) {
                            const multi2 = Array.from(fs2._multiSelected).map(i => Number(i)).filter(Number.isFinite);
                            const srcIdxOpt = (typeof options.sourceFrame !== 'undefined' && options.sourceFrame !== null) ? Number(options.sourceFrame) : null;
                            let ledgeIdx = null;
                            for (const m of multi2) {
                                if (srcIdxOpt !== null && Number.isFinite(srcIdxOpt) && m === srcIdxOpt) continue;
                                ledgeIdx = m; break;
                            }
                            if (ledgeIdx === null && multi2.length > 0) ledgeIdx = multi2[0];
                            if (ledgeIdx !== null && typeof this.currentSprite.getFrame === 'function') {
                                const ledgeFrame = this.currentSprite.getFrame(anim, ledgeIdx);
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

            // Connection semantics follow frame-side UI toggles:
            // 1 = highlighted (outside edge / no neighbor), 0 = inside (connected).
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

            // If we've already applied per-layer outlines for depth compositing,
            // skip the main outline pass below to avoid double outlining.
            try { if (_skipMainOutline) { octx.putImageData(outImage, 0, 0); return out; } } catch (e) {}

            const clamp01 = (v) => Math.max(0, Math.min(1, v));
            const stepDiv = Math.max(1, colorSteps - 1);
            const stepUnit = maxDelta / stepDiv;
            const mix = (a, b, t) => (a * (1 - t)) + (b * t);
            // Keep corner curvature independent from outline thickness.
            // Thickness controls band width; cornerRadius controls arc shape.
            const cornerRadius = Math.max(1, Math.round(px * 0.32));
            const radius = Math.max(0.0001, cornerRadius);
            const cornerZone = Math.max(1, Math.floor(cornerRadius));
            const cornerInwardDistance = (dx, dy) => {
                // Distance inward from corner boundary:
                // - square: min(dx,dy) gives straight inside boundary
                // - round: r - dist(center,p) gives concentric quarter-circle inside boundary
                const squareIn = Math.min(dx, dy);
                const roundIn = radius - Math.hypot(dx - radius, dy - radius);
                return mix(squareIn, roundIn, cornerRoundness);
            };
            const applyRoundedCornerAlphaMask = (x, y, alphaByte) => {
                if (cornerRoundness <= 0 || alphaByte <= 0) return false;
                const cornerCutoff = radius * (1 - cornerRoundness);

                // Top-left
                if (edgeTopOutside && edgeLeftOutside && x <= cornerZone && y <= cornerZone) {
                    const dist = Math.hypot(x - radius, y - radius);
                    if (dist - radius > cornerCutoff) return true;
                }
                // Top-right
                if (edgeTopOutside && edgeRightOutside && (px - 1 - x) <= cornerZone && y <= cornerZone) {
                    const dx = (px - 1 - x);
                    const dist = Math.hypot(dx - radius, y - radius);
                    if (dist - radius > cornerCutoff) return true;
                }
                // Bottom-right
                if (edgeBottomOutside && edgeRightOutside && (px - 1 - x) <= cornerZone && (px - 1 - y) <= cornerZone) {
                    const dx = (px - 1 - x);
                    const dy = (px - 1 - y);
                    const dist = Math.hypot(dx - radius, dy - radius);
                    if (dist - radius > cornerCutoff) return true;
                }
                // Bottom-left
                if (edgeBottomOutside && edgeLeftOutside && x <= cornerZone && (px - 1 - y) <= cornerZone) {
                    const dy = (px - 1 - y);
                    const dist = Math.hypot(x - radius, dy - radius);
                    if (dist - radius > cornerCutoff) return true;
                }
                return false;
            };
            const innerCornerDistance = (dx, dy) => {
                // Use square width at roundness=0 so inner-corner width matches edges,
                // then blend toward circular distance as roundness increases.
                const sq = Math.max(dx, dy);
                const rd = Math.hypot(dx, dy);
                return mix(sq, rd, cornerRoundness);
            };

            for (let y = 0; y < px; y++) {
                for (let x = 0; x < px; x++) {
                    const i = (y * px + x) * 4;
                    const alpha = outImage.data[i + 3] / 255;
                    if (alpha <= 0) continue;

                    // Physically round outside corners by cutting alpha in corner zones.
                    if (applyRoundedCornerAlphaMask(x, y, outImage.data[i + 3])) {
                        outImage.data[i + 3] = 0;
                        continue;
                    }

                    let nearest = Infinity;
                    // Distances to outside edges selected in the frame-side connection UI.
                    if (edgeTopOutside) nearest = Math.min(nearest, y);
                    if (edgeRightOutside) nearest = Math.min(nearest, (px - 1 - x));
                    if (edgeBottomOutside) nearest = Math.min(nearest, (px - 1 - y));
                    if (edgeLeftOutside) nearest = Math.min(nearest, x);

                    // Round outside corners (where two adjacent outside edges meet).
                    // Use corner inward distance so both outer and inner boundaries curve.
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

                    // Handle inner-corner seams where only the diagonal is outside.
                    if (cornerTLOutside && !edgeTopOutside && !edgeLeftOutside) nearest = Math.min(nearest, innerCornerDistance(x, y));
                    if (cornerTROutside && !edgeTopOutside && !edgeRightOutside) nearest = Math.min(nearest, innerCornerDistance((px - 1 - x), y));
                    if (cornerBROutside && !edgeBottomOutside && !edgeRightOutside) nearest = Math.min(nearest, innerCornerDistance((px - 1 - x), (px - 1 - y)));
                    if (cornerBLOutside && !edgeBottomOutside && !edgeLeftOutside) nearest = Math.min(nearest, innerCornerDistance(x, (px - 1 - y)));

                    if (!Number.isFinite(nearest) || nearest > outlineWidth) continue;

                    const t = clamp01(nearest / Math.max(0.0001, outlineWidth));
                    const edgeBlend = Math.pow(1 - t, 1 + (falloff * 4));
                    const noise = ((this._noise01((x * 1.37) + 9, (y * 0.83) + 17, seed + 97) * 2) - 1) * maxDelta * noiseAmount;
                    let delta = (tone * edgeBlend * maxDelta) + noise;
                    delta = Math.round(delta / stepUnit) * stepUnit;

                    // If using a custom outline color: blend between source pixel and custom color
                    // across the falloff region, including noise perturbation, so the edge
                    // retains the same noisy transition behavior as the native outline.
                    if (useCustomOutline && _customBaseColor) {
                        try {
                            const srcRgb = new Color(outImage.data[i], outImage.data[i + 1], outImage.data[i + 2], alpha, 'rgb');
                            const customRgb = (_customBaseColor.type === 'rgb') ? _customBaseColor : _customBaseColor.toRgb();
                            const noiseNorm = (maxDelta > 0) ? (noise / maxDelta) : 0; // roughly in [-noiseAmount,noiseAmount]
                            let mixAmt = edgeBlend + noiseNorm;
                            mixAmt = Math.max(0, Math.min(1, mixAmt));
                            // Quantize the blend amount into discrete steps to match `colorSteps` (dithering)
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

    _runProceduralAutotileGeneration(settings = {}) {
        try {
            // remember requested depth for generation-time key expansion
            try { this._lastGenerationDepth = Math.max(0, Number(settings.depth) || 0); } catch (e) { this._lastGenerationDepth = 0; }
            try { console.debug && console.debug('[gen] _runProceduralAutotileGeneration start', { anim: String(settings.sourceAnimation || this.selectedAnimation || 'idle'), sourceFrame: settings.sourceFrame, handshakeOnly: !!this.localState?.collab?.handshakeOnly, webrtcReady: !!this.localState?.collab?.webrtcReady, queued: (this.collabTransport && this.collabTransport._dataQueue) ? this.collabTransport._dataQueue.length : 0 }); } catch(e) {}
            const anim = String(settings.sourceAnimation || this.selectedAnimation || 'idle');
            const sourceFrameIndex = Number.isFinite(Number(settings.sourceFrame))
                ? (Number(settings.sourceFrame) | 0)
                : (Number(this.selectedFrame) | 0);
            const sheet = this.currentSprite;
            if (!sheet || typeof sheet.getFrame !== 'function' || typeof sheet.insertFrame !== 'function') {
                return { ok: false, reason: 'Sprite sheet is not ready.' };
            }

            const sourceFrame = sheet.getFrame(anim, sourceFrameIndex);
            if (!sourceFrame) {
                return { ok: false, reason: 'Select a source tile frame first.' };
            }

            if (!this._tileConnMap || typeof this._tileConnMap !== 'object') this._tileConnMap = {};

            const keys = this._getAllValidOpenConnectionKeys();
            if (!Array.isArray(keys) || keys.length === 0) {
                return { ok: false, reason: 'No connection keys available.' };
            }

            const existingByConnKey = new Map();
            const initialLogicalCount = Math.max(0, Number(this._getAnimationLogicalFrameCount(anim)) || 0);
            for (let i = 0; i < initialLogicalCount; i++) {
                const raw = this._tileConnMap[anim + '::' + i];
                if (typeof raw !== 'string') continue;
                const norm = this._normalizeOpenConnectionKey(raw);
                if (!existingByConnKey.has(norm)) existingByConnKey.set(norm, i);
            }

            let created = 0;
            let updated = 0;
            let skipped = 0;
            const replaceExisting = !!settings.replaceExisting;
            let nextInsertIndex = initialLogicalCount;

            for (const rawKey of keys) {
                const key = this._normalizeOpenConnectionKey(rawKey);
                const existingIndex = existingByConnKey.has(key) ? existingByConnKey.get(key) : null;
                if (existingIndex !== null && !replaceExisting) {
                    skipped++;
                    continue;
                }

                const rendered = this._renderProceduralConnectionFrame(sourceFrame, key, settings);
                if (!rendered) {
                    skipped++;
                    continue;
                }

                let dstIndex = existingIndex;
                if (dstIndex === null) {
                    dstIndex = nextInsertIndex;
                    nextInsertIndex++;
                    sheet.insertFrame(anim);
                    created++;
                } else {
                    updated++;
                }

                const dstFrame = sheet.getFrame(anim, dstIndex);
                const dctx = dstFrame && dstFrame.getContext ? dstFrame.getContext('2d') : null;
                if (!dctx) {
                    skipped++;
                    continue;
                }
                try {
                    // Prefer using SpriteSheet APIs so multiplayer hooks detect pixel edits.
                    // Extract pixel data from the rendered canvas and apply via drawPixels/modifyFrame.
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
                                // encode as hex #RRGGBBAA
                                const toHex = (v) => (v < 16 ? '0' : '') + v.toString(16).toUpperCase();
                                const hex = '#' + toHex(r) + toHex(g) + toHex(b) + toHex(a);
                                pixels.push({ x: px, y: py, color: hex, blendType: 'replace' });
                            }
                        }
                        // Apply pixels via SpriteSheet API so wrapped modifyFrame will emit collab ops.
                        try {
                            try { console.debug && console.debug('[gen] applying pixels via sheet.drawPixels', { anim, dstIndex, pixelCount: pixels.length, handshakeOnly: !!this.localState?.collab?.handshakeOnly, webrtcReady: !!this.localState?.collab?.webrtcReady, queued: (this.collabTransport && this.collabTransport._dataQueue) ? this.collabTransport._dataQueue.length : 0 }); } catch(e) {}
                            sheet.drawPixels(anim, dstIndex, pixels);
                            try { console.debug && console.debug('[gen] sheet.drawPixels returned', { anim, dstIndex }); } catch(e) {}
                        } catch (e) {
                            // Fallback: draw directly if API fails
                            try { console.debug && console.debug('[gen] sheet.drawPixels failed, fallback to direct draw', e && e.message ? e.message : e); } catch(er) {}
                            dctx.clearRect(0, 0, dstFrame.width, dstFrame.height);
                            dctx.drawImage(rendered, 0, 0, dstFrame.width, dstFrame.height);
                        }
                    } else {
                        // If we couldn't read pixel data, fall back to direct draw.
                        dctx.clearRect(0, 0, dstFrame.width, dstFrame.height);
                        dctx.drawImage(rendered, 0, 0, dstFrame.width, dstFrame.height);
                    }
                        try { this._setTileConnection(anim, dstIndex, key, false); } catch (e) { this._tileConnMap[anim + '::' + dstIndex] = key; }
                        try { existingByConnKey.set(key, dstIndex); } catch (e) {}
                        try { console.debug && console.debug('[gen] about to send frameData', { anim, dstIndex, handshakeOnly: !!this.localState?.collab?.handshakeOnly, webrtcReady: !!this.localState?.collab?.webrtcReady, queued: (this.collabTransport && this.collabTransport._dataQueue) ? this.collabTransport._dataQueue.length : 0 }); } catch(e) {}
                        try { this._sendFrameDataForFrame(anim, dstIndex, dstFrame); } catch (e) {}
                } catch (e) {
                    // ensure generation continues even on errors
                    try { dctx.clearRect(0, 0, dstFrame.width, dstFrame.height); dctx.drawImage(rendered, 0, 0, dstFrame.width, dstFrame.height); } catch (er) {}
                    try { this._setTileConnection(anim, dstIndex, key, false); } catch (er) { this._tileConnMap[anim + '::' + dstIndex] = key; }
                    try { existingByConnKey.set(key, dstIndex); } catch (er) {}
                    try { this._sendFrameDataForFrame(anim, dstIndex, dstFrame); } catch (e) {}
                }
            }

            try { if (typeof sheet._rebuildSheetCanvas === 'function') sheet._rebuildSheetCanvas(); } catch (e) {}
            return { ok: true, created, updated, skipped, total: keys.length };
        } catch (e) {
            return { ok: false, reason: String((e && e.message) || e || 'Unknown error') };
        }
    }

    _generateMissingConnectionFramesFromTemplates(widthPx = 2) {
        try {
            const frameSelect = this.FrameSelect;
            const selected = Array.from((frameSelect && frameSelect._multiSelected) || [])
                .filter(i => Number.isFinite(i))
                .map(i => Number(i) | 0)
                .sort((a, b) => a - b);
            if (selected.length < 3) {
                return { ok: false, reason: 'Select 3 template frames first: all connectors, none, and 4 corners.' };
            }

            const anim = String(this.selectedAnimation || 'idle');
            const keyForFrame = (idx) => {
                const raw = (this._tileConnMap && this._tileConnMap[anim + '::' + idx]) || '0000000000';
                return this._normalizeOpenConnectionKey(raw);
            };

            const allKey = this._normalizeOpenConnectionKey('1111111100');
            const noneKey = this._normalizeOpenConnectionKey('0000000000');
            const cornersKey = this._normalizeOpenConnectionKey('0000111100');

            const allFrameIdx = selected.find(i => keyForFrame(i) === allKey);
            const noneFrameIdx = selected.find(i => keyForFrame(i) === noneKey);
            const cornersFrameIdx = selected.find(i => keyForFrame(i) === cornersKey);

            if (allFrameIdx === undefined || noneFrameIdx === undefined || cornersFrameIdx === undefined) {
                return { ok: false, reason: 'Multi-select must include frames tagged as 1111111100, 0000000000, and 0000111100.' };
            }

            const sheet = this.currentSprite;
            if (!sheet || typeof sheet.getFrame !== 'function' || typeof sheet.insertFrame !== 'function') {
                return { ok: false, reason: 'Sprite sheet is not ready.' };
            }

            const frameAll = sheet.getFrame(anim, allFrameIdx);
            const frameNone = sheet.getFrame(anim, noneFrameIdx);
            const frameCorners = sheet.getFrame(anim, cornersFrameIdx);
            if (!frameAll || !frameNone || !frameCorners) {
                return { ok: false, reason: 'Could not read one or more selected template frames.' };
            }

            const px = Math.max(1, Number(sheet.slicePx) || Number(frameNone.width) || 16);
            const edgeW = Math.max(1, Math.min(px, Math.floor(Number(widthPx) || 1)));

            if (!this._tileConnMap || typeof this._tileConnMap !== 'object') this._tileConnMap = {};

            const existing = new Set();
            const logicalCount = Math.max(1, Number(this._getAnimationLogicalFrameCount(anim)) || 1);
            for (let i = 0; i < logicalCount; i++) {
                const raw = this._tileConnMap[anim + '::' + i];
                if (typeof raw !== 'string') continue;
                existing.add(this._normalizeOpenConnectionKey(raw));
            }

            const targetKeys = this._getAllValidOpenConnectionKeys();
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

            let created = 0;
            for (const key of targetKeys) {
                if (existing.has(key)) continue;
                const bits = key.split('');

                const out = document.createElement('canvas');
                out.width = px;
                out.height = px;
                const octx = out.getContext('2d');
                if (!octx) continue;

                octx.clearRect(0, 0, px, px);
                octx.drawImage(frameNone, 0, 0, px, px);

                if (bits[0] === '1') copyRect(octx, frameAll, srcAreas.top);
                if (bits[1] === '1') copyRect(octx, frameAll, srcAreas.right);
                if (bits[2] === '1') copyRect(octx, frameAll, srcAreas.bottom);
                if (bits[3] === '1') copyRect(octx, frameAll, srcAreas.left);

                const drawCorner = (cornerBitIndex, edgeAIndex, edgeBIndex, area) => {
                    if (bits[cornerBitIndex] !== '1') return;
                    const neighborEdge = bits[edgeAIndex] === '1' || bits[edgeBIndex] === '1';
                    copyRect(octx, neighborEdge ? frameAll : frameCorners, area);
                };

                drawCorner(4, 0, 3, srcAreas.tl);
                drawCorner(5, 0, 1, srcAreas.tr);
                drawCorner(6, 1, 2, srcAreas.br);
                drawCorner(7, 2, 3, srcAreas.bl);

                const insertAt = Math.max(0, Number(this._getAnimationLogicalFrameCount(anim)) || 0);
                sheet.insertFrame(anim);
                const dstFrame = sheet.getFrame(anim, insertAt);
                const dctx = dstFrame && dstFrame.getContext ? dstFrame.getContext('2d') : null;
                if (!dctx) continue;
                try {
                    const rw = out.width || px;
                    const rh = out.height || px;
                    const rctx = (out && out.getContext) ? out.getContext('2d') : null;
                    let imgData = null;
                    try { if (rctx) imgData = rctx.getImageData(0, 0, rw, rh); } catch (e) { imgData = null; }
                    if (imgData && imgData.data && imgData.data.length >= 4) {
                        const pixels = [];
                        const data = imgData.data;
                        const w = Math.max(1, Math.min(dstFrame.width, rw));
                        const h = Math.max(1, Math.min(dstFrame.height, rh));
                        for (let py = 0; py < h; py++) {
                            for (let px2 = 0; px2 < w; px2++) {
                                const idx = (py * rw + px2) * 4;
                                const r = data[idx] | 0;
                                const g = data[idx + 1] | 0;
                                const b = data[idx + 2] | 0;
                                const a = data[idx + 3] | 0;
                                const toHex = (v) => (v < 16 ? '0' : '') + v.toString(16).toUpperCase();
                                const hex = '#' + toHex(r) + toHex(g) + toHex(b) + toHex(a);
                                pixels.push({ x: px2, y: py, color: hex, blendType: 'replace' });
                            }
                        }
                        try { sheet.drawPixels(anim, insertAt, pixels); } catch (e) {
                            dctx.clearRect(0, 0, px, px);
                            dctx.drawImage(out, 0, 0, px, px);
                        }
                    } else {
                        dctx.clearRect(0, 0, px, px);
                        dctx.drawImage(out, 0, 0, px, px);
                    }
                    try { this._setTileConnection(anim, insertAt, key, false); } catch (e) { this._tileConnMap[anim + '::' + insertAt] = key; }
                    try { existing.add(key); } catch (e) {}
                    created++;
                    try { this._sendFrameDataForFrame(anim, insertAt, dstFrame); } catch (e) {}
                } catch (e) {
                    try { dctx.clearRect(0, 0, px, px); dctx.drawImage(out, 0, 0, px, px); } catch (er) {}
                    try { this._setTileConnection(anim, insertAt, key, false); } catch (er) { this._tileConnMap[anim + '::' + insertAt] = key; }
                    try { existing.add(key); } catch (er) {}
                    created++;
                    try { this._sendFrameDataForFrame(anim, insertAt, dstFrame); } catch (e) {}
                }
            }

            // If duplicates slipped in (same connection key on multiple frames),
            // prune duplicate logical frames so the generated set stays canonical.
            const targetSet = new Set(targetKeys);
            const dupLogicalIndices = [];
            const seenKey = new Map();
            let currentLogicalCount = Math.max(1, Number(this._getAnimationLogicalFrameCount(anim)) || 1);
            for (let i = 0; i < currentLogicalCount; i++) {
                const raw = this._tileConnMap[anim + '::' + i];
                if (typeof raw !== 'string') continue;
                const norm = this._normalizeOpenConnectionKey(raw);
                if (!targetSet.has(norm)) continue;
                if (!seenKey.has(norm)) seenKey.set(norm, i);
                else dupLogicalIndices.push(i);
            }

            let removed = 0;
            const shiftConnMapAfterPop = (removedIdx, countBefore) => {
                for (let j = removedIdx; j < countBefore - 1; j++) {
                    const nextKey = this._tileConnMap[anim + '::' + (j + 1)];
                    if (typeof nextKey === 'string') this._tileConnMap[anim + '::' + j] = nextKey;
                    else delete this._tileConnMap[anim + '::' + j];
                }
                delete this._tileConnMap[anim + '::' + (countBefore - 1)];
            };

            dupLogicalIndices.sort((a, b) => b - a);
            for (const idx of dupLogicalIndices) {
                const before = Math.max(1, Number(this._getAnimationLogicalFrameCount(anim)) || 1);
                if (idx < 0 || idx >= before) continue;
                try {
                    sheet.popFrame(anim, idx);
                    shiftConnMapAfterPop(idx, before);
                    removed++;
                } catch (e) {}
            }

            try { if (typeof sheet._rebuildSheetCanvas === 'function') sheet._rebuildSheetCanvas(); } catch (e) {}
            return { ok: true, created, removed };
        } catch (e) {
            return { ok: false, reason: String((e && e.message) || e || 'Unknown error') };
        }
    }

    _isLegacyAutotileTemplateSelection(selected = null, anim = null) {
        try {
            const list = Array.isArray(selected)
                ? selected
                : Array.from((this.FrameSelect && this.FrameSelect._multiSelected) || []);
            const normalized = list
                .filter(i => Number.isFinite(i))
                .map(i => Number(i) | 0)
                .sort((a, b) => a - b);
            if (normalized.length !== 3) return false;

            const animation = String(anim || this.selectedAnimation || 'idle');
            const expected = new Set([
                this._normalizeOpenConnectionKey('1111111100'),
                this._normalizeOpenConnectionKey('0000000000'),
                this._normalizeOpenConnectionKey('0000111100')
            ]);
            const found = new Set();
            for (const idx of normalized) {
                const raw = (this._tileConnMap && this._tileConnMap[animation + '::' + idx]) || '0000000000';
                found.add(this._normalizeOpenConnectionKey(raw));
            }
            if (found.size !== 3) return false;
            for (const key of expected) {
                if (!found.has(key)) return false;
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    _chooseBestFrameByConnections(desiredClosedKey, anim, context = null) {
        try {
            if (!anim || !this.currentSprite || !this.currentSprite._frames) return null;
            const frames = this.currentSprite._frames.get(anim) || [];
            if (!Array.isArray(frames) || frames.length === 0) return null;
            if (!this._tileConnMap || typeof this._tileConnMap !== 'object') return null;

            const cx = (context && Number.isFinite(context.col)) ? (Number(context.col) | 0) : null;
            const cy = (context && Number.isFinite(context.row)) ? (Number(context.row) | 0) : null;
            const preferredDominant = (context && (context.preferredDominant === 'to' || context.preferredDominant === 'from'))
                ? context.preferredDominant
                : null;

            const scoreFor = (candClosedKey) => {
                let scClosedEdges = 0, scOpenEdges = 0, scOpenCorners = 0, scClosedCorners = 0;
                for (let i = 0; i < 4; i++) {
                    const d = desiredClosedKey[i];
                    const c = candClosedKey[i];
                    if (d === '1' && c === '1') scClosedEdges++;
                    if (d === '0' && c === '0') scOpenEdges++;
                }
                for (let i = 4; i < 8; i++) {
                    const d = desiredClosedKey[i];
                    const c = candClosedKey[i];
                    if (d === '0' && c === '0') scOpenCorners++;
                    if (d === '1' && c === '1') scClosedCorners++;
                }
                return [scClosedEdges, scOpenEdges, scOpenCorners, scClosedCorners];
            };

            const compareScore = (a, b) => {
                for (let i = 0; i < a.length; i++) {
                    if (a[i] > b[i]) return 1;
                    if (a[i] < b[i]) return -1;
                }
                return 0;
            };

            let bestIndex = null;
            let bestScore = null;
            const exact = [];
            for (let i = 0; i < frames.length; i++) {
                const key = String(anim) + '::' + i;
                    const openBits = this._tileConnMap[key];
                    if (typeof openBits !== 'string' || !/^[01]{10}$/.test(openBits)) continue;
                const candClosed = this._openConnectionToClosedKey(openBits);
                if (candClosed === desiredClosedKey) exact.push(i);
                const score = scoreFor(candClosed);
                if (!bestScore || compareScore(score, bestScore) > 0) {
                    bestScore = score;
                    bestIndex = i;
                }
            }

            if (exact.length > 0) {
                if (preferredDominant && this._transitionVariantMeta && typeof this._transitionVariantMeta === 'object') {
                    const preferred = exact.filter((idx) => {
                        const meta = this._transitionVariantMeta[String(anim) + '::' + idx];
                        return !!(meta && meta.cornerDominant === preferredDominant);
                    });
                    if (preferred.length === 1) return preferred[0];
                    if (preferred.length > 1) {
                        if (cx === null || cy === null) return preferred[0];
                        const hashPreferred = Math.abs((((cx * 73856093) ^ (cy * 19349663)) >>> 0));
                        return preferred[hashPreferred % preferred.length];
                    }
                }
                if (exact.length === 1 || cx === null || cy === null) return exact[0];
                const hash = Math.abs((((cx * 73856093) ^ (cy * 19349663)) >>> 0));
                return exact[hash % exact.length];
            }
            return bestIndex;
        } catch (e) {
            return null;
        }
    }

    // Choose best matching available tile index for a desired key and animation.
    _chooseBestTileIndex(desiredKey, anim, context = null) {
        const fromFrameConnections = this._chooseBestFrameByConnections(desiredKey, anim, context);
        if (fromFrameConnections !== null && fromFrameConnections !== undefined) return fromFrameConnections;

        if (!this._availableTileConn) return null;
        const candidates = this._availableTileKeys || Object.keys(this._availableTileConn || {});
        if (candidates.includes(desiredKey)) return this._availableTileConn[desiredKey];
        // Backwards-compat: if desiredKey is 10-bit but mapping uses 8-bit keys,
        // try matching on the first 8 bits as a fallback.
        if ((typeof desiredKey === 'string') && desiredKey.length === 10) {
            const short = desiredKey.slice(0, 8);
            if (candidates.includes(short)) return this._availableTileConn[short];
        }

        // scoring priorities: same closed edges, same open edges, same open corners, same closed corners
        const scoreFor = (candKey) => {
            let scClosedEdges = 0, scOpenEdges = 0, scOpenCorners = 0, scClosedCorners = 0;
            for (let i = 0; i < 4; i++) {
                const d = desiredKey[i];
                const c = candKey[i];
                if (d === '1' && c === '1') scClosedEdges++;
                if (d === '0' && c === '0') scOpenEdges++;
            }
            for (let i = 4; i < 8; i++) {
                const d = desiredKey[i];
                const c = candKey[i];
                if (d === '0' && c === '0') scOpenCorners++;
                if (d === '1' && c === '1') scClosedCorners++;
            }
            return [scClosedEdges, scOpenEdges, scOpenCorners, scClosedCorners];
        };

        let best = null;
        let bestScore = null;
        for (const ck of candidates) {
            const score = scoreFor(ck);
            if (!bestScore || compareScore(score, bestScore) > 0) {
                best = ck;
                bestScore = score;
            }
        }
        if (best) return this._availableTileConn[best];
        return null;

        function compareScore(a, b) {
            for (let i = 0; i < a.length; i++) {
                if (a[i] > b[i]) return 1;
                if (a[i] < b[i]) return -1;
            }
            return 0;
        }
    }

    // Apply autotile to the tile at (col,row) for a given anim: choose best tile and set binding.
    _applyAutotileAt(col, row, anim) {
        const areaIdx = (typeof this._getAreaIndexForCoord === 'function') ? this._getAreaIndexForCoord(col, row) : null;
        if (areaIdx === null || areaIdx === undefined) return;

        const old = this._areaBindings[areaIdx];
        const logicalAnim = String(this._getAutotileLogicalAnimationName(anim || (old && old.anim) || this.selectedAnimation || '') || '').trim();
        if (!logicalAnim) return;
        const resolved = this._resolveAutotileBindingForTile(col, row, logicalAnim);
        if (!resolved) return;

        const entry = (old && typeof old === 'object') ? { ...old } : { anim: resolved.anim, index: resolved.index };
        entry.anim = resolved.anim;
        entry.index = resolved.index;
        return this._setAreaBindingAtIndex(areaIdx, entry, true);
    }

    // Update neighboring tiles around (col,row) for autotile (4-way and diagonals)
    _updateAutotileNeighbors(col, row, anim) {
        const deltas = this._autotileNeighborDeltas || [
            [0, 0],
            [0, -1], [1, 0], [0, 1], [-1, 0],
            [-1, -1], [1, -1], [1, 1], [-1, 1]
        ];
        for (let i = 0; i < deltas.length; i++) {
            const d = deltas[i];
            const c = col + d[0];
            const r = row + d[1];
            const ai = (typeof this._getAreaIndexForCoord === 'function') ? this._getAreaIndexForCoord(c, r) : null;
            if (ai === null || ai === undefined) continue;
            const b = Array.isArray(this._areaBindings) ? this._areaBindings[ai] : null;
            if (!b) continue;
            const logical = this._getAutotileLogicalAnimationName(b.anim);
            if (!logical || logical !== anim) continue;
            this._applyAutotileAt(c, r, logical);
        }
    }

    // Ensure the current sprite has mirror-aware wrappers so any edit (not just pen) is mirrored.
    _ensureMirrorWrapper() {
        try {
            const sheet = this.currentSprite;
            if (!sheet || sheet._mirrorWrappedForScene) return;
            const scene = this;

            const origModify = (typeof sheet.modifyFrame === 'function') ? sheet.modifyFrame.bind(sheet) : null;
            const origSetPixel = (typeof sheet.setPixel === 'function') ? sheet.setPixel.bind(sheet) : null;
            const origFillRect = (typeof sheet.fillRect === 'function') ? sheet.fillRect.bind(sheet) : null;

            const mirrorChanges = (anim, frameIdx, changes) => {
                if (!scene.penMirrorH && !scene.penMirrorV) return changes;
                const frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, frameIdx) : null;
                const w = frameCanvas ? frameCanvas.width : null;
                const h = frameCanvas ? frameCanvas.height : null;
                if (w === null || h === null) return changes;
                if (scene._bypassMirrorWrap) return changes;
                const arr = Array.isArray(changes) ? changes : [changes];
                const out = [];
                const seen = new Set();
                for (const c of arr) {
                    if (!c || c.x === undefined || c.y === undefined) continue;
                    const color = c.color || c.col || c.c;
                    const blendType = c.blendType || 'replace';
                    const coords = [];
                    coords.push({ x: c.x, y: c.y, color, blendType });
                    if (scene.penMirrorH) coords.push({ x: w - 1 - c.x, y: c.y, color, blendType });
                    if (scene.penMirrorV) coords.push({ x: c.x, y: h - 1 - c.y, color, blendType });
                    if (scene.penMirrorH && scene.penMirrorV) coords.push({ x: w - 1 - c.x, y: h - 1 - c.y, color, blendType });
                    for (const p of coords) {
                        if (p.x < 0 || p.y < 0 || p.x >= w || p.y >= h) continue;
                        const key = p.x + ',' + p.y + ',' + (p.blendType || 'replace');
                        if (seen.has(key)) continue;
                        seen.add(key);
                        out.push(p);
                    }
                }
                return out;
            };

            if (origModify) {
                sheet.modifyFrame = function(anim, frameIdx, changes) {
                    if (!scene.penMirrorH && !scene.penMirrorV) return origModify(anim, frameIdx, changes);
                    if (scene._bypassMirrorWrap) return origModify(anim, frameIdx, changes);
                    const mirrored = mirrorChanges(anim, frameIdx, changes);
                    if (!mirrored || mirrored.length === 0) return;
                    return origModify(anim, frameIdx, mirrored);
                };
            }

            if (origSetPixel) {
                sheet.setPixel = function(anim, frameIdx, x, y, color, blendType) {
                    if (!scene.penMirrorH && !scene.penMirrorV) return origSetPixel(anim, frameIdx, x, y, color, blendType);
                    if (scene._bypassMirrorWrap) return origSetPixel(anim, frameIdx, x, y, color, blendType);
                    const changes = mirrorChanges(anim, frameIdx, { x, y, color, blendType });
                    if (!changes || changes.length === 0) return;
                    for (const c of changes) {
                        origSetPixel(anim, frameIdx, c.x, c.y, c.color, c.blendType);
                    }
                };
            }

            if (origFillRect) {
                sheet.fillRect = function(anim, frameIdx, x, y, wRect, hRect, color, blendType) {
                    if (!scene.penMirrorH && !scene.penMirrorV) return origFillRect(anim, frameIdx, x, y, wRect, hRect, color, blendType);
                    if (scene._bypassMirrorWrap) return origFillRect(anim, frameIdx, x, y, wRect, hRect, color, blendType);
                    const frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, frameIdx) : null;
                    const fw = frameCanvas ? frameCanvas.width : null;
                    const fh = frameCanvas ? frameCanvas.height : null;
                    if (fw === null || fh === null) return origFillRect(anim, frameIdx, x, y, wRect, hRect, color, blendType);
                    const pixels = [];
                    for (let yy = 0; yy < hRect; yy++) {
                        for (let xx = 0; xx < wRect; xx++) {
                            pixels.push({ x: x + xx, y: y + yy, color, blendType });
                        }
                    }
                    const mirrored = mirrorChanges(anim, frameIdx, pixels);
                    if (mirrored && mirrored.length) {
                        if (origModify) origModify(anim, frameIdx, mirrored);
                        else if (origSetPixel) {
                            for (const c of mirrored) origSetPixel(anim, frameIdx, c.x, c.y, c.color, c.blendType);
                        }
                    }
                };
            }

            sheet._mirrorWrappedForScene = true;
        } catch (e) { /* ignore wrapper errors */ }
    }

    // When mirror is toggled, immediately copy the side under the cursor to the opposite side (flipped).
    _applyInitialMirror(axis) {
        try {
            if (!axis || (axis !== 'h' && axis !== 'v')) return;
            const sheet = this.currentSprite;
            if (!sheet || !this.mouse) return;
            const pos = this.getPos(this.mouse.pos);
            if (!pos || !pos.inside) return;

            // resolve target anim/frame similar to pen tool
            const areaBinding = (pos && typeof pos.areaIndex === 'number' && Array.isArray(this._areaBindings)) ? this._areaBindings[pos.areaIndex] : null;
            const anim = (this.tilemode && areaBinding && areaBinding.anim) ? areaBinding.anim : this.selectedAnimation;
            const frameIdx = (this.tilemode && areaBinding && typeof areaBinding.index === 'number') ? areaBinding.index : this.selectedFrame;

            const frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, frameIdx) : null;
            if (!frameCanvas || !frameCanvas.getContext) return;
            const w = frameCanvas.width;
            const h = frameCanvas.height;
            if (!w || !h) return;
            const ctx = frameCanvas.getContext('2d');
            const img = ctx.getImageData(0, 0, w, h);
            const data = img.data;

            const changes = [];
            if (axis === 'h') {
                const mid = Math.floor(w / 2);
                const copyLeft = pos.x < w / 2;
                if (copyLeft) {
                    // copy left -> right
                    for (let y = 0; y < h; y++) {
                        for (let x = mid; x < w; x++) {
                            const srcX = w - 1 - x; // mirror from left side
                            const idx = (y * w + srcX) * 4;
                            const hex = this.rgbaToHex(data[idx], data[idx + 1], data[idx + 2], data[idx + 3]);
                            changes.push({ x, y, color: hex, blendType: 'replace' });
                        }
                    }
                } else {
                    // copy right -> left
                    for (let y = 0; y < h; y++) {
                        for (let x = 0; x < mid; x++) {
                            const srcX = w - 1 - x; // mirror from right side
                            const idx = (y * w + srcX) * 4;
                            const hex = this.rgbaToHex(data[idx], data[idx + 1], data[idx + 2], data[idx + 3]);
                            changes.push({ x, y, color: hex, blendType: 'replace' });
                        }
                    }
                }
            } else if (axis === 'v') {
                const mid = Math.floor(h / 2);
                const copyTop = pos.y < h / 2;
                if (copyTop) {
                    // copy top -> bottom
                    for (let y = mid; y < h; y++) {
                        const srcY = h - 1 - y; // mirror from top
                        for (let x = 0; x < w; x++) {
                            const idx = (srcY * w + x) * 4;
                            const hex = this.rgbaToHex(data[idx], data[idx + 1], data[idx + 2], data[idx + 3]);
                            changes.push({ x, y, color: hex, blendType: 'replace' });
                        }
                    }
                } else {
                    // copy bottom -> top
                    for (let y = 0; y < mid; y++) {
                        const srcY = h - 1 - y; // mirror from bottom
                        for (let x = 0; x < w; x++) {
                            const idx = (srcY * w + x) * 4;
                            const hex = this.rgbaToHex(data[idx], data[idx + 1], data[idx + 2], data[idx + 3]);
                            changes.push({ x, y, color: hex, blendType: 'replace' });
                        }
                    }
                }
            }

            if (!changes.length) return;
            const prevBypass = this._bypassMirrorWrap;
            this._bypassMirrorWrap = true; // avoid double-mirroring inside wrapper
            try {
                try { this._recordUndoPixels(anim, frameIdx, changes); } catch (e) { /* ignore undo capture errors */ }
                try { sheet.modifyFrame(anim, frameIdx, changes); } catch (e) {
                    for (const c of changes) {
                        try { sheet.setPixel(anim, frameIdx, c.x, c.y, c.color, 'replace'); } catch (er) { /* ignore */ }
                    }
                }
                try { if (sheet._rebuildSheetCanvas) sheet._rebuildSheetCanvas(); } catch (e) { /* ignore */ }
            } finally {
                this._bypassMirrorWrap = prevBypass;
            }
        } catch (e) {
            console.warn('initial mirror failed', e);
        }
    }

    _applyPixelPerfectPixel(sheet, anim, frameIdx, x, y, color, areaIndex) {
        try {
            if (!sheet) return;

            // Initialize stroke state on first pixel of a stroke
            if (!this._pixelPerfectStrokeActive) {
                this._pixelPerfectStrokeActive = true;
                this._pixelPerfectHistory = [];
                this._pixelPerfectOriginals = new Map();
            }

            const key = `${anim}:${frameIdx}:${x},${y}`;
            // Cache original color for this pixel once per stroke so we can restore it
            if (!this._pixelPerfectOriginals.has(key)) {
                try {
                    const frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, frameIdx) : null;
                    if (frameCanvas && frameCanvas.getContext) {
                        const ctx = frameCanvas.getContext('2d');
                        const d = ctx.getImageData(x, y, 1, 1).data;
                        const origHex = this.rgbaToHex(d[0], d[1], d[2], d[3]);
                        this._pixelPerfectOriginals.set(key, origHex);
                    }
                } catch (e) { /* ignore sampling errors */ }
            }

            // Draw the requested pixel
            try {
                if (typeof sheet.setPixel === 'function') sheet.setPixel(anim, frameIdx, x, y, color, 'replace');
                else if (typeof sheet.modifyFrame === 'function') sheet.modifyFrame(anim, frameIdx, { x, y, color, blendType: 'replace' });
            } catch (e) { /* ignore draw errors */ }

            const last = this._pixelPerfectHistory.length > 0 ? this._pixelPerfectHistory[this._pixelPerfectHistory.length - 1] : null;
            if (last && last.x === x && last.y === y && last.anim === anim && last.frameIdx === frameIdx) {
                // avoid duplicating the same point in history
                return;
            }

            const entry = { x, y, anim, frameIdx, areaIndex };
            this._pixelPerfectHistory.push(entry);
            if (this._pixelPerfectHistory.length > 3) this._pixelPerfectHistory.shift();

            // When we have three recent pixels, check for an L-shaped corner and
            // restore the bend pixel if needed.
            if (this._pixelPerfectHistory.length === 3) {
                const p1 = this._pixelPerfectHistory[0];
                const p2 = this._pixelPerfectHistory[1];
                const p3 = this._pixelPerfectHistory[2];
                if (this._isPixelPerfectLBend(p1, p2, p3)) {
                    const midKey = `${p2.anim}:${p2.frameIdx}:${p2.x},${p2.y}`;
                    const orig = this._pixelPerfectOriginals.get(midKey);
                    if (orig) {
                        try {
                            if (typeof sheet.setPixel === 'function') sheet.setPixel(p2.anim, p2.frameIdx, p2.x, p2.y, orig, 'replace');
                            else if (typeof sheet.modifyFrame === 'function') sheet.modifyFrame(p2.anim, p2.frameIdx, { x: p2.x, y: p2.y, color: orig, blendType: 'replace' });
                        } catch (e) { /* ignore restore errors */ }
                    }
                    // Remove the bend from history so the path continues from p1->p3
                    this._pixelPerfectHistory.splice(1, 1);
                }
            }
        } catch (e) {
            // ignore pixel-perfect errors and let normal drawing continue on next stroke
        }
    }

    _isPixelPerfectLBend(p1, p2, p3) {
        if (!p1 || !p2 || !p3) return false;
        // Must be in the same frame and area
        if (p1.anim !== p2.anim || p2.anim !== p3.anim) return false;
        if (p1.frameIdx !== p2.frameIdx || p2.frameIdx !== p3.frameIdx) return false;
        if (p1.areaIndex !== p2.areaIndex || p2.areaIndex !== p3.areaIndex) return false;

        const dx13 = p3.x - p1.x;
        const dy13 = p3.y - p1.y;
        // endpoints must be diagonal neighbors
        if (Math.abs(dx13) !== 1 || Math.abs(dy13) !== 1) return false;

        const adj12x = Math.abs(p2.x - p1.x);
        const adj12y = Math.abs(p2.y - p1.y);
        const adj23x = Math.abs(p3.x - p2.x);
        const adj23y = Math.abs(p3.y - p2.y);
        if (Math.max(adj12x, adj12y) !== 1) return false;
        if (Math.max(adj23x, adj23y) !== 1) return false;

        // Two possible patterns: vertical then horizontal, or horizontal then vertical.
        const pattern1 = (p1.x === p2.x && p2.y === p3.y); // step in Y then in X
        const pattern2 = (p1.y === p2.y && p2.x === p3.x); // step in X then in Y
        return pattern1 || pattern2;
    }



    // Build palette swap variant arrays between the current pen color and a target color.
    // Returns { sources: [{r,g,b,a}], targets: [{r,g,b,a}] } with base color plus
    // +/-1/2/3 step variants for H, S, and V (no cross-channel combos), mapped 1:1 by index.
    _buildPaletteSwapMap(sourceHex, targetHex) {
        try {
            const src = Color.convertColor(sourceHex || '#000000').toHsv();
            const dst = Color.convertColor(targetHex || '#000000').toHsv();

            const clamp01 = (v) => Math.max(0, Math.min(1, v));
            const wrap01 = (v) => {
                let r = v % 1;
                if (r < 0) r += 1;
                return r;
            };

            const buildSteps = (maxSteps) => {
                const m = Math.max(0, Math.floor(Number(maxSteps) || 0));
                const arr = [0];
                for (let i = m; i >= 1; i--) arr.push(-i);
                for (let i = 1; i <= m; i++) arr.push(i);
                return arr;
            };
            const steps = buildSteps(this.paletteStepMax || 3);
            const channelStep = (ch) => {
                const base = this._getAdjustPercent(ch);
                const mult = (ch === 'h') ? 0.2 : 1; // match lighten/darken hue scaling
                const step = (Number.isFinite(base) ? base : 0) * mult;
                return (step > 0) ? step : 0;
            };
            const hStep = channelStep('h');
            const sStep = channelStep('s');
            const vStep = channelStep('v');

            const srcVariants = [];
            const dstVariants = [];
            const toRgba = (hsv) => {
                const rgb = hsv.toRgb();
                return {
                    r: Math.round(rgb.a),
                    g: Math.round(rgb.b),
                    b: Math.round(rgb.c),
                    a: Math.round((rgb.d === undefined ? 1 : rgb.d) * 255)
                };
            };

            const pushPair = (hsvSrc, hsvDst) => {
                srcVariants.push(toRgba(hsvSrc));
                dstVariants.push(toRgba(hsvDst));
            };

            const applyDelta = (hsv, channel, delta) => {
                const h = channel === 'h' ? wrap01(hsv.a + delta) : hsv.a;
                const s = channel === 's' ? clamp01(hsv.b + delta) : hsv.b;
                const v = channel === 'v' ? clamp01(hsv.c + delta) : hsv.c;
                const a = hsv.d ?? 1;
                return new Color(h, s, v, a, 'hsv');
            };

            // Base entry
            pushPair(src, dst);

            // Per-channel stepped variants (no cross-channel combinations)
            const channelConfigs = [
                { key: 'h', step: hStep },
                { key: 's', step: sStep },
                { key: 'v', step: vStep }
            ];

            for (const cfg of channelConfigs) {
                const step = Number(cfg.step || 0);
                if (!Number.isFinite(step) || step <= 0) continue;
                for (const m of steps) {
                    if (m === 0) continue; // base already added
                    const delta = m * step;
                    const sVar = applyDelta(src, cfg.key, delta);
                    const dVar = applyDelta(dst, cfg.key, delta);
                    pushPair(sVar, dVar);
                }
            }

            return { sources: srcVariants, targets: dstVariants };
        } catch (e) {
            console.warn('build palette swap map failed', e);
            return null;
        }
    }

    // Apply a palette swap mapping (sources->targets arrays) to every frame in the current sprite.
    _applyPaletteSwap(mapping) {
        try {
            const sheet = this.currentSprite;
            if (!sheet || !mapping || !Array.isArray(mapping.sources) || !Array.isArray(mapping.targets)) return;
            const count = Math.min(mapping.sources.length, mapping.targets.length);
            if (count === 0) return;
            const animNames = (sheet._frames && typeof sheet._frames.keys === 'function') ? Array.from(sheet._frames.keys()) : [];
            let anyChanged = false;
            let fallbackRebuild = false;

            for (const anim of animNames) {
                const framesArr = sheet._frames.get(anim) || [];
                for (let idx = 0; idx < framesArr.length; idx++) {
                    const frame = sheet.getFrame(anim, idx);
                    if (!frame) continue;
                    const w = frame.width|0;
                    const h = frame.height|0;
                    if (w <= 0 || h <= 0) continue;
                    const ctx = frame.getContext('2d');
                    const img = ctx.getImageData(0, 0, w, h);
                    const data = img.data;
                    let changed = false;

                    for (let i = 0; i < data.length; i += 4) {
                        const pr = data[i], pg = data[i+1], pb = data[i+2], pa = data[i+3];
                        let matchIdx = -1;
                        for (let m = 0; m < count; m++) {
                            const s = mapping.sources[m];
                            if (!s) continue;
                            if (pr === s.r && pg === s.g && pb === s.b && pa === s.a) { matchIdx = m; break; }
                        }
                        if (matchIdx === -1) continue;
                        const t = mapping.targets[matchIdx];
                        if (!t) continue;
                        data[i] = t.r;
                        data[i+1] = t.g;
                        data[i+2] = t.b;
                        data[i+3] = t.a;
                        changed = true;
                    }

                    if (changed) {
                        anyChanged = true;
                        ctx.putImageData(img, 0, 0);
                        try {
                            if (typeof sheet._updatePackedFrame === 'function') sheet._updatePackedFrame(anim, idx);
                            else fallbackRebuild = true;
                        } catch (e) { fallbackRebuild = true; }
                    }
                }
            }

            if (anyChanged) {
                if (fallbackRebuild) {
                    try { sheet._rebuildSheetCanvas(); } catch (e) { /* ignore */ }
                }
                try { console.log('Palette swap applied'); } catch (e) {}
            }
        } catch (e) {
            console.warn('apply palette swap failed', e);
        }
    }

    // Prompt the user for a target color and perform a palette swap from the
    // current pen color to that target across all frames.
    _promptPaletteSwap() {
        try {
            const srcHex = this.penColor || '#000000';
            try { if (this.keys && typeof this.keys.pause === 'function') this.keys.pause(); if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause(); } catch(e){}
            const input = window.prompt('Palette swap target color (hex #RRGGBB or #RRGGBBAA)', srcHex);
            if (input === null || input === undefined) return;
            const targetHex = String(input).trim();
            if (!targetHex) return;
            const mapping = this._buildPaletteSwapMap(srcHex, targetHex);
            if (!mapping || !Array.isArray(mapping.sources) || mapping.sources.length === 0) return;
            this._applyPaletteSwap(mapping);
        } catch (e) {
            console.warn('palette swap prompt failed', e);
        }
    }

    selectionTool() {
        try {
            if (!this.mouse) return;

            const pos = this.getPos(this.mouse.pos);
            const renderOnlyTile = !!(this.tilemode && pos && pos.renderOnly);

            // Ensure pixel-mode Select All ('s' / Shift+S) fires reliably when not in render-only tile mode
            if (!renderOnlyTile && (this.keys.pressed('s') || this.keys.pressed('S')) && !this.keys.held('Alt')) {
                const col = Color.convertColor(this.penColor || '#000000');
                const hex = col.toHex();
                let buffer = 1;
                if (this.keys.held('Shift')) {
                    try {
                        try { if (this.keys && typeof this.keys.pause === 'function') this.keys.pause(); if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause(); } catch(e){}
                        const input = window.prompt('Buffer amount (default 1)', '1');
                        if (input !== null) {
                            const parsed = parseFloat(String(input).trim());
                            if (!Number.isNaN(parsed) && isFinite(parsed)) buffer = parsed;
                        }
                    } catch (e) { /* ignore prompt errors */ }
                }
                if (window.Debug && typeof window.Debug.emit === 'function') {
                    window.Debug.emit('select', hex, buffer);
                } else if (window.Debug && typeof window.Debug.createSignal === 'function') {
                    const sig = window.Debug.signals && window.Debug.signals.get && window.Debug.signals.get('select');
                    if (typeof sig === 'function') sig(hex, buffer);
                }
                // Prevent further handling in selectionTool for this keypress
                return;
            }
            if (renderOnlyTile && pos && pos.tileCol !== undefined && pos.tileRow !== undefined) {
                this._tileHoverAnchor = { col: pos.tileCol, row: pos.tileRow };
            }

            // Tile selection: 's' and Shift+S for select all (strictly render-only tilemode)
            if (renderOnlyTile && (this.keys.pressed('s') || this.keys.pressed('S'))) {
                const pos = this.getPos(this.mouse && this.mouse.pos);
                if (pos && typeof pos.tileCol === 'number' && typeof pos.tileRow === 'number') {
                    const idx = this._getAreaIndexForCoord(pos.tileCol, pos.tileRow);
                    const refBinding = (typeof idx === 'number') ? this.getAreaBinding(idx) : null;
                    // Default to {rot:0, flipH:false} if missing
                    const refTransform = (typeof idx === 'number' && Array.isArray(this._areaTransforms) && this._areaTransforms[idx]) ? this._areaTransforms[idx] : { rot: 0, flipH: false };
                    if (!this._tileSelection || !(this._tileSelection instanceof Set)) {
                        this._tileSelection = new Set();
                    }
                    for (let i = 0; Array.isArray(this._tileIndexToCoord) && i < this._tileIndexToCoord.length; i++) {
                        const tile = this._tileIndexToCoord[i];
                        if (!tile) continue;
                        const binding = this.getAreaBinding(i);
                        // Default to {rot:0, flipH:false} if missing
                        const transform = (Array.isArray(this._areaTransforms) && this._areaTransforms[i]) ? this._areaTransforms[i] : { rot: 0, flipH: false };
                        // Only select if binding exists and matches
                        if (!binding || !refBinding) continue;
                        const sameType = (binding.anim === refBinding.anim && Number(binding.index) === Number(refBinding.index));
                        if (this.keys.held('Shift')) {
                            // Shift+S: select all with same type only (additive)
                            if (sameType) {
                                this._tileSelection.add(this._tileKey(tile.col, tile.row));
                            }
                        } else {
                            // 's': select all with same type+rotation+flip (additive)
                            if (!sameType) continue;
                            const rotEq = (Number(refTransform.rot) === Number(transform.rot));
                            const flipEq = (!!refTransform.flipH === !!transform.flipH);
                            if (rotEq && flipEq) {
                                this._tileSelection.add(this._tileKey(tile.col, tile.row));
                            }
                        }
                    }
                }
                // Prevent pixel select all prompt when in renderOnlyTile mode
                return;
            }
            if (this.mouse.pressed('right') && !this.keys.held('Shift')) {
                const hadPixelSelection = (this.selectionPoints && this.selectionPoints.length) || this.selectionRegion;
                const hadTileSelection = renderOnlyTile && this._tileSelection && this._tileSelection.size > 0;
                const hadSpriteSelection = !!(this.selectedSpriteEntityId && this._getSpriteEntities()[this.selectedSpriteEntityId]);
                if (hadPixelSelection || hadTileSelection || hadSpriteSelection) {
                    if (this.stateController) this.stateController.clearPixelSelection();
                    else {
                        this.selectionPoints = [];
                        this.currentTool = null;
                        this.selectionRegion = null;
                    }
                    if (hadTileSelection) this._tileSelection.clear();
                    if (hadSpriteSelection) {
                        this.selectedSpriteEntityId = null;
                        this.modifyState(null, false, false, ['spriteLayer', 'selectedEntityId']);
                    }
                    this.mouse.pause(0.2);
                    return true;
                }
            }

            // Clear clipboard preview when Alt is released or preview expired
            if (this.clipboardPreview && (!this.keys.held('v'))) {
                this.clipboardPreview = false;
                this._clipboardPreviewDragging = null;
                this.keys.resetPasscode();
            }

            // In render-only tilemode, right-click clears the current tile selection (no erase).
            if (renderOnlyTile && this.mouse.pressed('right') && !this.keys.held('shift') && this._tileSelection && this._tileSelection.size) {
                this._tileSelection.clear();
                this.mouse.pause(0.2);
                return true;
            }

            // In tilemode, 'i' toggles a waypoint at the hovered tile.
            if (this.tilemode && (this.keys.released('i') || this.keys.released('I')) && !this.keys.held('Alt')) {
                this._toggleWaypointAtCursor(pos);
            }

            // Keyframing: Shift+I for selection, I for frame (non-tilemode only)
            if ((this.keys.released('i') || this.keys.released('I')) && !this.keys.held('Alt')) {
                if (!this.tilemode) {
                    if (this.keys.held('Shift')) this._handleSelectionKeyframeTap();
                    else this._handleFrameKeyframeTap();
                }
            }

            // Ctrl + Left = eyedropper: pick color from the current frame under the mouse
            let ctrlHeld = this.keys.held('Control',true)
            if (ctrlHeld) {
                try {
                    // Tile eyedrop (render-only tilemode): capture tile binding + transform
                    try {
                        if (renderOnlyTile && typeof pos.areaIndex === 'number') {
                            const binding = this.getAreaBinding(pos.areaIndex);
                            const transform = (Array.isArray(this._areaTransforms) && this._areaTransforms[pos.areaIndex]) ? this._areaTransforms[pos.areaIndex] : null;
                            if (binding && binding.anim !== undefined && binding.index !== undefined) {
                                if (this.stateController) this.stateController.setActiveSelection(binding.anim, Number(binding.index));
                                else {
                                    this.selectedAnimation = binding.anim;
                                    this.selectedFrame = Number(binding.index);
                                }
                            }
                            this._tileBrushBinding = binding ? { ...binding } : { anim: this.selectedAnimation, index: this.selectedFrame };
                            this._tileBrushTransform = transform ? { rot: transform.rot || 0, flipH: !!transform.flipH } : null;
                            return;
                        }
                    } catch (e) { /* ignore tile eyedrop errors */ }

                    // initialize stored original color when Control first held
                    if (this._eyedropperOriginalColor === undefined) {
                        this._eyedropperOriginalColor = this.penColor;
                        this._eyedropperCancelled = false;
                    }

                    // If user scrolled while holding Control, cancel eyedropper and revert
                    const wheelY_check = (this.mouse && typeof this.mouse.wheel === 'function') ? this.mouse.wheel() : 0;
                    const wheelX_check = (this.mouse && typeof this.mouse.wheelX === 'function') ? this.mouse.wheelX() : 0;
                    if (!this._eyedropperCancelled && (wheelY_check || wheelX_check)) {
                        try {
                            if (this._eyedropperOriginalColor !== undefined) {
                                if (this.stateController) this.stateController.setPenColor(this._eyedropperOriginalColor);
                                else this.penColor = this._eyedropperOriginalColor;
                                if (this._colorInput) {
                                    // sync HTML color input (drop alpha)
                                    const col = this.penColor || '#000000';
                                    // if stored color is 9 or 7 chars (#RRGGBBAA or #RRGGBB), pick first 7
                                    this._colorInput.value = col.length >= 7 ? col.slice(0,7) : col;
                                }
                            }
                        } catch (e) {}
                        this._eyedropperCancelled = true;
                    }

                    // if cancelled, skip sampling until Control released
                    if (this._eyedropperCancelled) {
                        // noop while cancelled
                    } else {
                        const posPrev = this.getPos(this.mouse.prevPos);
                        if (posPrev && posPrev.inside && this.currentSprite && (ctrlHeld<0.05 || ctrlHeld > 0.3)) {
                            const sheet = this.currentSprite;
                            // Prefer area binding only in tilemode; otherwise sample selected frame.
                            let anim = this.selectedAnimation;
                            let frameIdx = this.selectedFrame;
                            if (this.tilemode && typeof posPrev.areaIndex === 'number') {
                                const binding = this.getAreaBinding(posPrev.areaIndex);
                                if (binding && binding.anim !== undefined && binding.index !== undefined) {
                                    anim = binding.anim;
                                    frameIdx = Number(binding.index);
                                }
                            }
                            const frameCanvas = sheet.getFrame(anim, frameIdx);
                            if (frameCanvas) {
                                const ctx = frameCanvas.getContext('2d');
                                try {
                                    const d = ctx.getImageData(posPrev.x, posPrev.y, 1, 1).data;
                                    // set internal pen color including alpha
                                    const hex8 = this.rgbaToHex(d[0], d[1], d[2], d[3]);
                                    if (this.stateController) this.stateController.setPenColor(hex8);
                                    else this.penColor = hex8;
                                    // update HTML color input (6-digit, drop alpha)
                                    if (this._colorInput) {
                                        const toHex = (v) => (v < 16 ? '0' : '') + v.toString(16).toUpperCase();
                                        this._colorInput.value = '#' + toHex(d[0]) + toHex(d[1]) + toHex(d[2]);
                                    }
                                } catch (e) {
                                    // ignore getImageData errors
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.warn('eyedropper failed', e);
                }
            } else {
                // Control not held: if we previously had an eyedropper session, clear temporary state
                try {
                    if (this._eyedropperOriginalColor !== undefined) {
                        // If it was cancelled, we've already reverted. If not cancelled, keep sampled color.
                        this._eyedropperOriginalColor = undefined;
                        this._eyedropperCancelled = false;
                    }
                } catch (e) {}
            }

            // Middle-click eyedropper: immediate sample on middle button press
            try {
                if (this.mouse.held('middle')) {
                    const posMid = this.getPos(this.mouse.pos);
                    if (posMid && posMid.inside && this.currentSprite) {
                        const sheet = this.currentSprite;
                        let anim = this.selectedAnimation;
                        let frameIdx = this.selectedFrame;
                        if (this.tilemode && typeof posMid.areaIndex === 'number') {
                            const binding = this.getAreaBinding(posMid.areaIndex);
                            if (binding && binding.anim !== undefined && binding.index !== undefined) {
                                anim = binding.anim;
                                frameIdx = Number(binding.index);
                            }
                        }
                        const frameCanvas = sheet.getFrame(anim, frameIdx);
                        if (frameCanvas) {
                            const ctx = frameCanvas.getContext('2d');
                            try {
                                const d = ctx.getImageData(posMid.x, posMid.y, 1, 1).data;
                                const hex8 = this.rgbaToHex(d[0], d[1], d[2], d[3]);
                                if (this.stateController) this.stateController.setPenColor(hex8);
                                else this.penColor = hex8;
                                if (this._colorInput) {
                                    const toHex = (v) => (v < 16 ? '0' : '') + v.toString(16).toUpperCase();
                                    this._colorInput.value = '#' + toHex(d[0]) + toHex(d[1]) + toHex(d[2]);
                                }
                            } catch (e) {
                                // ignore getImageData errors
                            }
                        }
                    }
                }
            } catch (e) { console.warn('middle-click eyedropper failed', e); }

            // Shift + Left click to add points (respecting brush size) and
            // Shift + Right click to remove points under the cursor (also
            // respecting brush size). Skip this block when Shift is paired
            // with flood-fill keys so Shift+F can reach the fill handler.
            const shiftHeld = this.keys.held('Shift');
            const shiftForFill = shiftHeld && (this.keys.pressed('f') || this.keys.pressed('F') || this.keys.held('f') || this.keys.held('F'));
            // Skip the selection-add brush when Shift is being used for flood-fill (Shift+F)
            if (shiftHeld && !shiftForFill) {
                if (renderOnlyTile) {
                    // Tile selection in render-only tilemode
                    if (!this._tileSelection) this._tileSelection = new Set();
                    const tileBrush = this._tileBrushTiles(pos.tileCol ?? 0, pos.tileRow ?? 0, this.brushSize || 1, this._tileBrushTilesBuffer);
                    if (this.mouse.held('left')) {
                        for (const t of tileBrush) this._tileSelection.add(this._tileKey(t.col, t.row));
                    } else if (this.mouse.held('right')) {
                        for (const t of tileBrush) this._tileSelection.delete(this._tileKey(t.col, t.row));
                    }
                    return;
                }
                const posSel = this.getPos(this.mouse.pos);
                if (posSel && posSel.inside) {
                    if (this.mouse.held('left')) {
                        const side = Math.max(1, Math.min(15, this.brushSize || 1));
                        const half = Math.floor((side - 1) / 2);
                        const areaIndex = (typeof posSel.areaIndex === 'number') ? posSel.areaIndex : null;
                        const slice = (this.currentSprite && this.currentSprite.slicePx) ? this.currentSprite.slicePx : 1;
                        // map a local pixel (relative to the hovered tile) to its owning tile in tilemode
                        const mapToTile = (lx, ly) => {
                            if (!this.tilemode) return { x: lx, y: ly, areaIndex };
                            let baseCol = 0, baseRow = 0;
                            if (typeof areaIndex === 'number' && Array.isArray(this._tileIndexToCoord)) {
                                const cr = this._tileIndexToCoord[areaIndex];
                                if (cr) { baseCol = cr.col|0; baseRow = cr.row|0; }
                            }
                            const wx = baseCol * slice + lx;
                            const wy = baseRow * slice + ly;
                            const mapped = (typeof this._worldPixelToTile === 'function') ? this._worldPixelToTile(wx, wy, slice) : null;
                            if (!mapped) return { x: lx, y: ly, areaIndex };
                            return { x: mapped.localX, y: mapped.localY, areaIndex: mapped.areaIndex };
                        };
                        for (let yy = 0; yy < side; yy++) {
                            for (let xx = 0; xx < side; xx++) {
                                const px = posSel.x - half + xx;
                                const py = posSel.y - half + yy;
                                const mapped = mapToTile(px, py);
                                const tgtArea = (typeof mapped.areaIndex === 'number') ? mapped.areaIndex : areaIndex;
                                const exists = this.selectionPoints.some(p => p.x === mapped.x && p.y === mapped.y && p.areaIndex === tgtArea);
                                if (!exists) {
                                    // record the area index where this point was added so copy/cut can use the originating frame
                                    this.selectionPoints.push({ x: mapped.x, y: mapped.y, areaIndex: tgtArea });
                                    // adding a new anchor invalidates any previous region selection
                                    if (this.stateController) this.stateController.clearSelectionRegion();
                                    else this.selectionRegion = null;
                                }
                            }
                        }
                    } else if (this.mouse.held('right')) {
                        const side = Math.max(1, Math.min(15, this.brushSize || 1));
                        const half = Math.floor((side - 1) / 2);
                        const areaIndex = (typeof posSel.areaIndex === 'number') ? posSel.areaIndex : null;
                        const slice = (this.currentSprite && this.currentSprite.slicePx) ? this.currentSprite.slicePx : 1;
                        const mapToTile = (lx, ly) => {
                            if (!this.tilemode) return { x: lx, y: ly, areaIndex };
                            let baseCol = 0, baseRow = 0;
                            if (typeof areaIndex === 'number' && Array.isArray(this._tileIndexToCoord)) {
                                const cr = this._tileIndexToCoord[areaIndex];
                                if (cr) { baseCol = cr.col|0; baseRow = cr.row|0; }
                            }
                            const wx = baseCol * slice + lx;
                            const wy = baseRow * slice + ly;
                            const mapped = (typeof this._worldPixelToTile === 'function') ? this._worldPixelToTile(wx, wy, slice) : null;
                            if (!mapped) return { x: lx, y: ly, areaIndex };
                            return { x: mapped.localX, y: mapped.localY, areaIndex: mapped.areaIndex };
                        };
                        // remove any existing selection point within the brush square at this pixel (and area)
                        this.selectionPoints = this.selectionPoints.filter(p => {
                            // convert each selection point into world coords of its own area for fair comparison
                            let pArea = (typeof p.areaIndex === 'number') ? p.areaIndex : areaIndex;
                            let pX = p.x;
                            let pY = p.y;
                            if (this.tilemode && typeof pArea === 'number' && Array.isArray(this._tileIndexToCoord)) {
                                const cr = this._tileIndexToCoord[pArea];
                                if (cr) {
                                    const wx = cr.col * slice + p.x;
                                    const wy = cr.row * slice + p.y;
                                    const mapped = (typeof this._worldPixelToTile === 'function') ? this._worldPixelToTile(wx, wy, slice) : null;
                                    if (mapped) {
                                        pArea = mapped.areaIndex;
                                        pX = mapped.localX;
                                        pY = mapped.localY;
                                    }
                                }
                            }
                            const mappedPos = mapToTile(posSel.x, posSel.y);
                            const targetArea = (typeof mappedPos.areaIndex === 'number') ? mappedPos.areaIndex : areaIndex;
                            if (pArea !== targetArea) return true;
                            const dx = pX - mappedPos.x;
                            const dy = pY - mappedPos.y;
                            return !(dx >= -half && dx < side - half && dy >= -half && dy < side - half);
                        });
                    }
                }
            }

            // With 2+ selection points, 'l' draws a polygon (Alt to fill) in world space.
            // Holding Shift selects the polygon instead of drawing.
            const polyKey = (this.keys.pressed('l') || this.keys.pressed('L'));
            if (polyKey) {
                // Pixel mode: original behavior
                if (this.selectionPoints.length >= 2 && !(renderOnlyTile && this.tilemode)) {
                    if (this.keys.held('Shift')) this._selectPolygonFromSelection();
                    else this._commitPolygonFromSelection();
                }
                // Render-only tilemode: connect selected tiles as polygon
                if (renderOnlyTile && this._tileSelection && this._tileSelection.size >= 2) {
                    const tileKeys = Array.from(this._tileSelection);
                    const tilePoints = tileKeys.map(key => this._parseTileKey(key)).filter(Boolean);
                    if (tilePoints.length >= 2) {
                        // Build polygon path from tile integer coordinates
                        const poly = tilePoints.map(t => ({ x: t.col, y: t.row }));
                        // Rasterize polygon to tile set
                        let fillTiles = new Set();
                        if (this.keys.held('Alt')) {
                            // Fill polygon interior (simple scanline fill)
                            // Find bounds
                            let minX = Math.floor(Math.min(...poly.map(p => p.x)));
                            let maxX = Math.ceil(Math.max(...poly.map(p => p.x)));
                            let minY = Math.floor(Math.min(...poly.map(p => p.y)));
                            let maxY = Math.ceil(Math.max(...poly.map(p => p.y)));
                            for (let y = minY; y < maxY; ++y) {
                                // Find intersections with polygon edges
                                let nodes = [];
                                for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
                                    let yi = poly[i].y, yj = poly[j].y;
                                    let xi = poly[i].x, xj = poly[j].x;
                                    if ((yi < y && yj >= y) || (yj < y && yi >= y)) {
                                        let xInt = xi + (y - yi) * (xj - xi) / (yj - yi);
                                        nodes.push(xInt);
                                    }
                                }
                                nodes.sort((a, b) => a - b);
                                for (let k = 0; k + 1 < nodes.length; k += 2) {
                                    let xStart = Math.floor(nodes[k]);
                                    let xEnd = Math.ceil(nodes[k + 1]);
                                    for (let x = xStart; x < xEnd; ++x) {
                                        fillTiles.add(this._tileKey(x, y));
                                    }
                                }
                            }
                        } else {
                            // Outline: connect the dots
                            for (let i = 0; i < poly.length; ++i) {
                                let a = poly[i], b = poly[(i + 1) % poly.length];
                                // Bresenham's line between a and b
                                let x0 = Math.round(a.x), y0 = Math.round(a.y);
                                let x1 = Math.round(b.x), y1 = Math.round(b.y);
                                let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
                                let sx = x0 < x1 ? 1 : -1;
                                let sy = y0 < y1 ? 1 : -1;
                                let err = dx - dy;
                                while (true) {
                                    fillTiles.add(this._tileKey(x0, y0));
                                    if (x0 === x1 && y0 === y1) break;
                                    let e2 = 2 * err;
                                    if (e2 > -dy) { err -= dy; x0 += sx; }
                                    if (e2 < dx) { err += dx; y0 += sy; }
                                }
                            }
                        }
                        // Apply fill/outline to tiles
                        const binding = this._tileBrushBinding || { anim: this.selectedAnimation, index: this.selectedFrame };
                        const transform = this._tileBrushTransform ? { ...this._tileBrushTransform } : null;
                        for (const key of fillTiles) {
                            const tile = this._parseTileKey(key);
                            if (!tile) continue;
                            const idx = this._getAreaIndexForCoord(tile.col, tile.row);
                            if (!Number.isFinite(idx)) continue;
                            this._activateTile(tile.col, tile.row);
                            this._setAreaBindingAtIndex(idx, binding ? { ...binding } : null, true);
                            if (transform) this._setAreaTransformAtIndex(idx, { ...transform }, true);
                        }
                        return;
                    }
                }
            }


            // Grow / Shrink selection: ';' to grow, '\'' to shrink (released)
            try {
                if (this.keys.released(';')) {
                    if (renderOnlyTile && this._tileSelection && this._tileSelection.size > 0) {
                        // Grow tile selection
                        const newTiles = new Set(this._tileSelection);
                        for (const key of this._tileSelection) {
                            const tile = this._parseTileKey(key);
                            if (!tile) continue;
                            // 4-way neighbors
                            const neighbors = [
                                { col: tile.col - 1, row: tile.row },
                                { col: tile.col + 1, row: tile.row },
                                { col: tile.col, row: tile.row - 1 },
                                { col: tile.col, row: tile.row + 1 }
                            ];
                            for (const n of neighbors) {
                                newTiles.add(this._tileKey(n.col, n.row));
                            }
                        }
                        this._tileSelection = newTiles;
                    } else {
                        try { this._growSelection(); } catch (e) { /* ignore */ }
                    }
                }
                if (this.keys.released("'")) {
                    if (renderOnlyTile && this._tileSelection && this._tileSelection.size > 0) {
                        // Shrink tile selection
                        // Remove tiles that have any neighbor not in the selection
                        const toRemove = new Set();
                        for (const key of this._tileSelection) {
                            const tile = this._parseTileKey(key);
                            if (!tile) continue;
                            const neighbors = [
                                { col: tile.col - 1, row: tile.row },
                                { col: tile.col + 1, row: tile.row },
                                { col: tile.col, row: tile.row - 1 },
                                { col: tile.col, row: tile.row + 1 }
                            ];
                            for (const n of neighbors) {
                                if (!this._tileSelection.has(this._tileKey(n.col, n.row))) {
                                    toRemove.add(key);
                                    break;
                                }
                            }
                        }
                        for (const key of toRemove) this._tileSelection.delete(key);
                    } else {
                        try { this._shrinkSelection(); } catch (e) { /* ignore */ }
                    }
                }
            } catch (e) { /* ignore grow/shrink key errors */ }

            // set tool keys when we have a primary anchor point.
            // Circles support an "even-centered" mode when the selection is an
            // exact 2x2 block (treated as a 2x2 center anchor).
            const hasSingleAnchor = (this.selectionPoints.length === 1);
            const hasEvenCenterAnchor = this._hasEvenCircleAnchor();
            // Tile-mode: use tile selection set instead of pixel selectionPoints
            const tileHasSingle = (this.tilemode && this._tileSelection && this._tileSelection.size === 1);
            if (hasSingleAnchor || hasEvenCenterAnchor || tileHasSingle) {
                if (hasSingleAnchor) {
                    this._handleLineCircleSpiralShortcut();
                } else {
                    this._shapeComboPending = null;
                }
                if (!hasSingleAnchor && hasEvenCenterAnchor && this.keys.pressed('o')) {
                    if (this.stateController) this.stateController.setCurrentTool('circle');
                    else this.currentTool = 'circle';
                }

                // Tile-mode: support tile shape tools using a single tile anchor
                if (this.tilemode && tileHasSingle) {
                    if (this.keys.pressed('l')) this.currentToolTile = 'line';
                    if (this.keys.pressed('b')) this.currentToolTile = 'box';
                    if (this.keys.pressed('o')) this.currentToolTile = 'circle';
                }

                // If user clicks left (without Shift) while a pixel tool is active, commit the selection
                if (!this.keys.held('Shift') && this.mouse.pressed('left') && this.currentTool) {
                    const pos = this.getPos(this.mouse.pos);
                    const anchor = this._getShapeAnchorPoint(pos);
                    const anchorArea = (anchor && typeof anchor.areaIndex === 'number') ? anchor.areaIndex : null;
                    let target = null;
                    if (pos && pos.inside && (!this.tilemode || anchorArea === null || pos.areaIndex === anchorArea)) {
                        target = { x: pos.x, y: pos.y, areaIndex: pos.areaIndex };
                    } else if (anchor) {
                        target = this._unclampedPixelForArea(anchorArea, this.mouse.pos);
                    }
                    if (target) {
                        const start = anchor;
                        const end = { x: target.x, y: target.y };
                        this.commitSelection(start, end);
                        try { if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause(0.1); } catch (e) {}
                        if (this.stateController) this.stateController.clearCurrentTool();
                        else this.currentTool = null;
                    }
                }

                // Tile-mode: if a tile tool is active and user clicks, apply tile-shaped action
                if (this.tilemode && this.currentToolTile && this.mouse.pressed('left') && this._tileSelection && this._tileSelection.size === 1) {
                    const anchorKey = Array.from(this._tileSelection)[0];
                    const anchorTile = this._parseTileKey(anchorKey);
                    const pos = this.getPos(this.mouse.pos);
                    let targetTile = null;
                    if (pos && pos.renderOnly && typeof pos.tileCol === 'number') targetTile = { col: pos.tileCol, row: pos.tileRow };
                    if (!targetTile) targetTile = anchorTile;
                    if (anchorTile && targetTile) {
                        // compute interior vs border tiles so Alt (filled) vs outline-only matches preview
                        const interior = [];
                        const border = [];
                        const x0 = anchorTile.col, y0 = anchorTile.row, x1 = targetTile.col, y1 = targetTile.row;
                        if (this.currentToolTile === 'box') {
                            const minC = Math.min(x0,x1), maxC = Math.max(x0,x1);
                            const minR = Math.min(y0,y1), maxR = Math.max(y0,y1);
                            for (let r = minR; r <= maxR; r++) for (let c = minC; c <= maxC; c++) {
                                if (r === minR || r === maxR || c === minC || c === maxC) border.push({col:c,row:r});
                                else interior.push({col:c,row:r});
                            }
                        } else if (this.currentToolTile === 'line') {
                            let x = x0, y = y0;
                            const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
                            const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
                            let err = dx + dy;
                            while (true) {
                                border.push({col:x,row:y});
                                if (x === x1 && y === y1) break;
                                const e2 = 2 * err;
                                if (e2 >= dy) { err += dy; x += sx; }
                                if (e2 <= dx) { err += dx; y += sy; }
                            }
                        } else if (this.currentToolTile === 'circle') {
                            const dx = x1 - x0, dy = y1 - y0;
                            const r = Math.max(Math.abs(dx), Math.abs(dy));
                            const r2 = r * r;
                            const borderBand = Math.max(1, r);
                            for (let rr = -r; rr <= r; rr++) for (let cc = -r; cc <= r; cc++) {
                                const dist2 = cc*cc + rr*rr;
                                const isBorder = (dist2 >= r2 - borderBand && dist2 <= r2 + borderBand);
                                const isInside = (dist2 <= r2);
                                if (isBorder) border.push({col: x0+cc, row: y0+rr});
                                else if (isInside) interior.push({col: x0+cc, row: y0+rr});
                            }
                        }

                        const applyTiles = [];
                        const isAlt = (this.keys && typeof this.keys.held === 'function' && this.keys.held('Alt'));
                        if (this.currentToolTile === 'line') {
                            applyTiles.push(...border);
                        } else {
                            if (isAlt) applyTiles.push(...interior);
                            applyTiles.push(...border);
                        }

                        if (applyTiles.length) {
                            if (this.keys.held('Shift')) {
                                for (const t of applyTiles) this._tileSelection.add(this._tileKey(t.col,t.row));
                            } else {
                                // apply current tile brush binding to tiles
                                const binding = this._tileBrushBinding || { anim: this.selectedAnimation, index: this.selectedFrame };
                                const transform = this._tileBrushTransform ? { ...this._tileBrushTransform } : null;
                                for (const t of applyTiles) {
                                    const idx = this._getAreaIndexForCoord(t.col, t.row);
                                    this._activateTile(t.col, t.row);
                                    this._setAreaBindingAtIndex(idx, binding ? { ...binding } : null, true);
                                    if (transform) this._setAreaTransformAtIndex(idx, { ...transform }, true);
                                }
                            }
                        }
                        this.currentToolTile = null;
                        try { if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause(0.1); } catch (e) {}
                    }
                }
            } else {
                this._shapeComboPending = null;
            }

            // While a shape tool (line/box/circle/spiral/boxSpiral) is active, Shift+Left click adds
            // individual selection points along the shape instead of drawing.
            // The last added point becomes the new starting point for chaining.
            // While a shape tool (line/box/circle) is active, Shift+Left click
            // should select the previewed pixels (replace current selection)
            // instead of drawing them. This allows holding Shift to capture
            // the shape preview as a pixel selection.
            // When a shape tool is active, pressing Shift captures the shape
            // preview as a selection (replacing any existing selection) and
            // cancels the active shape tool — no mouse click required.
            if (this.currentTool && this.keys.pressed('Shift')) {
                const pos = this.getPos(this.mouse.pos);
                if (pos && pos.inside) {
                    // Determine start anchor: prefer last selection point, then first selection point,
                    // then fall back to the current mouse pos as anchor.
                    let start = null;
                    if (this.selectionPoints && this.selectionPoints.length > 0) start = this.selectionPoints[this.selectionPoints.length - 1];
                    else if (this.selectionPoints && this.selectionPoints.length === 0 && this.selectionRegion) {
                        // If a rectangular region exists, use its start corner
                        start = { x: this.selectionRegion.start.x, y: this.selectionRegion.start.y, areaIndex: this.selectionRegion.areaIndex };
                    } else if (pos && pos.inside) start = { x: pos.x, y: pos.y, areaIndex: pos.areaIndex };

                    if (!start) {
                        // no valid anchor, skip
                    } else {
                        const end = { x: pos.x, y: pos.y };
                        const filled = this.keys.held('Alt');
                        const strokeWidth = this._getShapeStrokeWidth();
                        let pixels = [];
                        if (this.currentTool === 'line' && typeof this.computeLinePixels === 'function') {
                            pixels = this.computeLinePixels(start, end, strokeWidth) || [];
                        } else if (this.currentTool === 'box' && typeof this.computeBoxPixels === 'function') {
                            pixels = this.computeBoxPixels(start, end, filled, strokeWidth) || [];
                        } else if (this.currentTool === 'circle' && typeof this.computeCirclePixels === 'function') {
                            pixels = this.computeCirclePixels(start, end, filled, strokeWidth) || [];
                        } else if (this.currentTool === 'spiral' && typeof this.computeSpiralPixels === 'function') {
                            pixels = this.computeSpiralPixels(start, end, strokeWidth) || [];
                        } else if (this.currentTool === 'boxSpiral' && typeof this.computeBoxSpiralPixels === 'function') {
                            pixels = this.computeBoxSpiralPixels(start, end, strokeWidth) || [];
                        }

                        if (pixels && pixels.length) {
                            const areaIndex = (typeof start.areaIndex === 'number') ? start.areaIndex : (typeof pos.areaIndex === 'number' ? pos.areaIndex : null);
                            // Replace current selection with the preview pixels
                            const newSel = [];
                            for (const p of pixels) {
                                newSel.push({ x: p.x, y: p.y, areaIndex });
                            }
                            if (this.stateController && typeof this.stateController.setSelectionPoints === 'function') {
                                try { this.stateController.setSelectionPoints(newSel); this.stateController.clearSelectionRegion(); } catch (e) {}
                            } else {
                                this.selectionPoints = newSel;
                                this.selectionRegion = null;
                            }
                            try { this._playSfx('select.pixel'); } catch (e) {}
                            // Clear the active shape tool so the preview is cancelled
                            if (this.stateController) this.stateController.clearCurrentTool(); else this.currentTool = null;
                        }
                    }
                }
            }

            // If two points are present and user presses 'b', perform a box select
            // but materialize it as a normal per-pixel selection instead of a
            // special rectangular region ("green box"). This keeps pixel art
            // workflows simple and consistent. The region is now inclusive:
            // it adds to any existing selectionPoints instead of replacing them.
            if (this.selectionPoints.length === 2) {
                if (this.keys.pressed('b')) {
                    try { this._playSfx('select.pixel'); } catch (e) {}
                    const start = this.selectionPoints[0];
                    const end = this.selectionPoints[1];
                    const filled = true; // box select should generally select the full area

                    let pixels = [];
                    if (typeof this.computeBoxPixels === 'function') {
                        pixels = this.computeBoxPixels(start, end, filled) || [];
                    }

                    // Determine area index for the selection if both anchors share one
                    let areaIdx = null;
                    if (start && end && start.areaIndex === end.areaIndex) areaIdx = start.areaIndex;

                    // Build a dense pixel selection for the region and merge it
                    // into any existing selectionPoints (inclusive selection).
                    const merged = (this.selectionPoints && this.selectionPoints.length > 0)
                        ? this.selectionPoints.slice()
                        : [];
                    for (const p of pixels) {
                        const exists = merged.some(sp => sp.x === p.x && sp.y === p.y && sp.areaIndex === areaIdx);
                        if (!exists) {
                            merged.push({ x: p.x, y: p.y, areaIndex: areaIdx });
                        }
                    }

                    if (this.stateController) this.stateController.setSelectionPoints(merged);
                    else this.selectionPoints = merged;

                    // Clear any previous rectangular region state so all tools
                    // operate purely on pixel selections.
                    if (this.stateController) {
                        this.stateController.clearSelectionRegion();
                        this.stateController.clearCurrentTool();
                    } else {
                        this.selectionRegion = null;
                        this.currentTool = null;
                    }
                }
            }

            // Tile-mode: if exactly two tiles are selected and user presses 'b',
            // expand selection to include the full tile rectangle between them (inclusive).
            try {
                if (this.tilemode && this._tileSelection && this._tileSelection.size === 2 && this.keys.pressed('b')) {
                    try { this._playSfx('select.tile'); } catch (e) {}
                    const keys = Array.from(this._tileSelection);
                    if (keys.length === 2) {
                        const a = this._parseTileKey(keys[0]);
                        const b = this._parseTileKey(keys[1]);
                        if (a && b) {
                            const minC = Math.min(a.col, b.col);
                            const maxC = Math.max(a.col, b.col);
                            const minR = Math.min(a.row, b.row);
                            const maxR = Math.max(a.row, b.row);
                            for (let r = minR; r <= maxR; r++) {
                                for (let c = minC; c <= maxC; c++) {
                                    this._tileSelection.add(this._tileKey(c, r));
                                }
                            }
                        }

                    }
                }
            } catch (e) { /* ignore tile box-select errors */ }

            // Clipboard operations: copy (c), cut (x), paste (v)
            // Copy/Cut operate on active selectionRegion or explicit selectionPoints.
            // Holding 'v' previews clipboard; releasing 'v' pastes at the mouse pixel.
            try {
                // Helper to pull transferable content from the system clipboard into this.clipboard.
                // When pasteAfter is true, also immediately paste at the mouse position.
                const fetchSystemClipboard = async (pasteAfter) => {
                    try {
                        if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') return;
                        const txt = await navigator.clipboard.readText();
                        if (!txt) return;
                        const doPasteNow = !!pasteAfter;
                        const applyPaste = () => {
                            if (!doPasteNow) return;
                            if (this.clipboard) {
                                this.doPaste(this.mouse && this.mouse.pos);
                                this._justPasted = true;
                            }
                        };

                        // If it's an image data URL, convert into image data for paste/preview
                        if (typeof txt === 'string' && txt.startsWith('data:image')) {
                            try {
                                const img = new Image();
                                img.src = txt;
                                await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
                                const c = document.createElement('canvas');
                                c.width = img.width; c.height = img.height;
                                const cx = c.getContext('2d');
                                cx.clearRect(0,0,c.width,c.height);
                                cx.drawImage(img,0,0);
                                const imgd = cx.getImageData(0,0,c.width,c.height);
                                this.clipboard = { type: 'image', w: c.width, h: c.height, data: imgd.data, originOffset: { ox: 0, oy: 0 } };
                                this._activeClipboardType = 'pixel';
                                applyPaste();
                                return;
                            } catch (e) {
                                // fall through
                            }
                        }

                        // Try to parse JSON representing our clipboard structure
                        try {
                            const obj = JSON.parse(txt);
                            if (obj && (obj.type === 'points' || obj.type === 'image')) {
                                // For image represented as dataURL, convert similarly
                                if (obj.type === 'image' && obj.data && typeof obj.data === 'string' && obj.data.startsWith('data:image')) {
                                    try {
                                        const img = new Image();
                                        img.src = obj.data;
                                        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
                                        const c = document.createElement('canvas');
                                        c.width = img.width; c.height = img.height;
                                        const cx = c.getContext('2d');
                                        cx.clearRect(0,0,c.width,c.height);
                                        cx.drawImage(img,0,0);
                                        const imgd = cx.getImageData(0,0,c.width,c.height);
                                        this.clipboard = { type: 'image', w: c.width, h: c.height, data: imgd.data, originOffset: obj.originOffset || { ox: 0, oy: 0 } };
                                        this._activeClipboardType = 'pixel';
                                        applyPaste();
                                        return;
                                    } catch (e) { /* ignore */ }
                                } else {
                                    // Points or already-structured image payload (dense numeric array) may be large; trust JSON
                                    this.clipboard = obj;
                                    this._activeClipboardType = 'pixel';
                                    applyPaste();
                                    return;
                                }
                            }
                        } catch (e) {
                            // nothing usable on clipboard
                        }
                    } catch (e) {
                        // ignore clipboard read failures (permissions, insecure context)
                    }
                };

                if (this.keys.held('v')) {
                    this.clipboardPreview = true;
                    this.keys.setPasscode('pasteMode');
                }
                // On initial press, prefer system clipboard so preview uses latest external content.
                if (this.keys.pressed('v')) {
                    // Always try to refresh from system clipboard; if it succeeds it overwrites any local copy.
                    fetchSystemClipboard(false);
                    // Always show clipboard preview after requesting clipboard
                    this.clipboardPreview = true;
                    this.keys.setPasscode('pasteMode');
                }
                const posForClipboard = this.getPos(this.mouse && this.mouse.pos);
                const allowTileClipboard = !!(this.tilemode && ((posForClipboard && posForClipboard.renderOnly) || (this._tileSelection && this._tileSelection.size > 0)));
                const allowSpriteClipboard = !!(this.tilemode && this.selectedSpriteEntityId && this._getSpriteEntities()[this.selectedSpriteEntityId]);
                if (this.keys.pressed('c')) {
                    if (allowSpriteClipboard || allowTileClipboard || this.selectionRegion || (this.selectionPoints && this.selectionPoints.length > 0)) this.doCopy();
                }
                if (this.keys.pressed('x')) {
                    if (allowSpriteClipboard || allowTileClipboard || this.selectionRegion || (this.selectionPoints && this.selectionPoints.length > 0)) this.doCut();
                }
                if (this.keys.released('v')) {
                    // paste at mouse position (tiles or pixels)
                    const posInfo = this.getPos(this.mouse && this.mouse.pos);
                    const activeType = this._activeClipboardType;
                    const hasSprite = !!(this.spriteClipboard || this._spriteClipboard);
                    const hasTile = !!this._tileClipboard;
                    const hasPixel = !!this.clipboard;
                    const canPasteSprite = !!(this.tilemode && posInfo && (posInfo.renderOnly || posInfo.inside) && hasSprite);
                    const canPasteTile = !!(this.tilemode && posInfo && posInfo.renderOnly && hasTile);
                    const canPastePixel = !!(posInfo && posInfo.inside && hasPixel);
                    let pasted = false;
                    if (activeType === 'sprite' && canPasteSprite) {
                        this.doPaste(this.mouse && this.mouse.pos);
                        pasted = true;
                    } else if (activeType === 'tile' && canPasteTile) {
                        this.doPaste(this.mouse && this.mouse.pos);
                        pasted = true;
                    } else if (activeType === 'pixel' && canPastePixel) {
                        this.doPaste(this.mouse && this.mouse.pos);
                        pasted = true;
                    } else if (!activeType) {
                        if (canPasteSprite || canPasteTile || canPastePixel) {
                            this.doPaste(this.mouse && this.mouse.pos);
                            pasted = true;
                        }
                    }
                    if (pasted) {
                        this._justPasted = true;
                    } else if (!hasSprite && !hasTile && !hasPixel) {
                        // No local data yet: pull from system clipboard and paste once ready.
                        fetchSystemClipboard(true);
                    }
                    this.clipboardPreview = false;
                    this._clipboardPreviewDragging = null;
                    this.keys.resetPasscode();
                }
                // rotate clipboard clockwise with 'r'
                if (this.keys.released('r','pasteMode')) {
                    try {
                        this.rotateClipboardCW();
                        try { this._playSfx('clipboard.rotate'); } catch (e) {}
                    } catch (e) { /* ignore */ }
                }
                // flip clipboard horizontally with 'f' while in pasteMode
                if (this.keys.released('f','pasteMode')) {
                    try {
                        if (typeof this.flipClipboardH === 'function') this.flipClipboardH();
                        try { this._playSfx('clipboard.flip'); } catch (e) {}
                    } catch (e) { /* ignore */ }
                }
            } catch (e) {
                console.warn('clipboard op failed', e);
            }

            // Fill bucket / flood-select: on 'f' (or 'F') release, flood-fill the area
            // under the mouse. When Shift is held, we select the region
            // instead of painting it.
            try {
                // Prevent fill while clipboard preview/pasting (v) is active
                const fHeldTime = Math.max(this.keys.held('f', true), this.keys.held('F', true));
                const fPressed = (this.keys.pressed('f') || this.keys.pressed('F'));
                const MIN_FILL_HOLD = 0.08; // seconds minimum hold to trigger fill
                const FILL_COOLDOWN = 0.25; // seconds between allowed fill triggers
                const nowSec = (this._sceneTime || 0);
                if (nowSec - (this._lastFillTriggered || 0) < FILL_COOLDOWN) return;
                if (fHeldTime >= MIN_FILL_HOLD || fPressed) {
                    this._lastFillTriggered = nowSec;
                    const pos = this.getPos(this.mouse && this.mouse.pos);
                    const hasSelection = (this.selectionPoints && this.selectionPoints.length > 0) || !!this.selectionRegion;
                    // If there's no selection, require the mouse to be over a frame (or renderOnly tile).
                    if (!hasSelection && (!pos || (!pos.inside && !(this.tilemode && pos.renderOnly)))) return;
                    // If there is an explicit selection (points or region), treat
                    // pressing 'f' as "draw selected" (same as Alt+S) instead of
                    // performing a flood-fill into the hovered frame.
                    try {
                        const hasSelection = (this.selectionPoints && this.selectionPoints.length > 0) || !!this.selectionRegion;
                        // Respect Shift+F: when Shift is held, 'f' should perform
                        // the flood-select behavior (different from Alt+S). Only
                        // trigger drawSelected when there is a selection and
                        // Shift is NOT held.
                        if (hasSelection && !this.keys.held('Shift')) {
                            // Schedule fill-selected with a short leeway so combos like
                            // F + N can be detected. If 'n' is held when the timeout
                            // fires, run the full gradient+noise animation. Otherwise
                            // apply the immediate fill (with small UI flair).
                            try {
                                    // Ensure a safe immediate-apply helper exists (may not be defined
                                    // until `drawSelected` has run). This fallback performs a plain
                                    // immediate fill for selectionPoints or selectionRegion.
                                    if (typeof this._applyDrawSelectedImmediate !== 'function') {
                                        this._applyDrawSelectedImmediate = (opts = {}) => {
                                            try {
                                                const sheet = this.currentSprite;
                                                if (!sheet) return;
                                                const colorHex = this.penColor || '#000000';
                                                if (this.selectionPoints && this.selectionPoints.length > 0) {
                                                    for (const p of this.selectionPoints) {
                                                        if (!p) continue;
                                                        let anim = this.selectedAnimation;
                                                        let frameIdx = this.selectedFrame;
                                                        if (this.tilemode && p && typeof p.areaIndex === 'number') {
                                                            const binding = this.getAreaBinding(p.areaIndex);
                                                            if (binding && binding.anim !== undefined && binding.index !== undefined) { anim = binding.anim; frameIdx = Number(binding.index); }
                                                        }
                                                        try {
                                                            if (typeof sheet.setPixel === 'function') sheet.setPixel(anim, frameIdx, p.x, p.y, colorHex, 'replace');
                                                            else {
                                                                const frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, frameIdx) : null;
                                                                if (frameCanvas) {
                                                                    const ctx = frameCanvas.getContext('2d');
                                                                    const col = Color.convertColor(colorHex).toRgb();
                                                                    const r = Math.round(col.a || 0), g = Math.round(col.b || 0), b = Math.round(col.c || 0), a = ((col.d === undefined) ? 1 : (col.d || 0));
                                                                    ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
                                                                    ctx.fillRect(p.x, p.y, 1, 1);
                                                                }
                                                            }
                                                        } catch (e) { /* ignore per-pixel failure */ }
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
                                                    for (let yy = minY; yy <= maxY; yy++) {
                                                        for (let xx = minX; xx <= maxX; xx++) {
                                                            try {
                                                                if (typeof sheet.setPixel === 'function') sheet.setPixel(anim, frameIdx, xx, yy, colorHex, 'replace');
                                                                else {
                                                                    const frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, frameIdx) : null;
                                                                    if (frameCanvas) {
                                                                        const ctx = frameCanvas.getContext('2d');
                                                                        const col = Color.convertColor(colorHex).toRgb();
                                                                        const r = Math.round(col.a || 0), g = Math.round(col.b || 0), b = Math.round(col.c || 0), a = ((col.d === undefined) ? 1 : (col.d || 0));
                                                                        ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
                                                                        ctx.fillRect(xx, yy, 1, 1);
                                                                    }
                                                                }
                                                            } catch (e) { /* ignore per-pixel failure */ }
                                                        }
                                                    }
                                                }
                                                if (typeof sheet._rebuildSheetCanvas === 'function') try { sheet._rebuildSheetCanvas(); } catch (e) {}
                                            } catch (e) { /* ignore */ }
                                        };
                                    }
                                    // Defer applying the fill briefly so quick N+F combos
                                    // can be detected; the timeout will either run the
                                    // animated path (if N held) or apply the immediate
                                    // fill when the leeway expires.
                                if (this._fillSelectedTimeout) try { clearTimeout(this._fillSelectedTimeout); } catch (e) {}
                                this._fillSelectedTimeout = setTimeout(() => {
                                    try {
                                        this._fillSelectedTimeout = null;
                                        // If 'n' is held within the leeway, run the animated gradient+noise
                                        if (this.keys && typeof this.keys.held === 'function' && this.keys.held('n', true) > 0) {
                                            // Gather pixels like drawSelected did, then animate
                                            try {
                                                const sheet = this.currentSprite;
                                                if (!sheet) return;
                                                const groups = new Map();
                                                // selectionPoints takes precedence
                                                if (this.selectionPoints && this.selectionPoints.length > 0) {
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
                                                        if (binding && binding.anim !== undefined && binding.index !== undefined) {
                                                            anim = binding.anim;
                                                            frameIdx = Number(binding.index);
                                                        }
                                                    }
                                                    const pts = [];
                                                    for (let yy = minY; yy <= maxY; yy++) for (let xx = minX; xx <= maxX; xx++) pts.push({ x: xx, y: yy, areaIndex: sr.areaIndex });
                                                    const key = anim + ':' + frameIdx;
                                                    groups.set(key, { anim, frameIdx, pts });
                                                }
                                                // For each group, build entries and animate
                                                for (const g of groups.values()) {
                                                    const frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(g.anim, g.frameIdx) : null;
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
                                                    const pos = this.getPos(this.mouse && this.mouse.pos) || {};
                                                    const origin = (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) ? { ox: pos.x, oy: pos.y } : null;
                                                    // full gradient+noise animation
                                                    this._animateFillSelected(entries, g.anim, g.frameIdx, 240, origin);
                                                }
                                                return;
                                            } catch (e) {
                                                // fallthrough to immediate
                                            }
                                        }
                                        // default: immediate apply but with a small UI flair (fade + noise).
                                        try { this._applyDrawSelectedImmediate({ flairMs: 120, noise: 0.12 }); } catch (e) { this._applyDrawSelectedImmediate(); }
                                    } catch (e) { /* ignore */ }
                                }, 100);
                            } catch (e) {
                                // fallback: immediate
                                try { this._applyDrawSelectedImmediate(); } catch (e) {}
                            }
                            return;
                        }
                    } catch (e) { /* ignore selection->draw dispatch errors */ }
                    const sheet = this.currentSprite;
                    // prefer the bound frame for the area under the mouse, but only
                    // when in tilemode. In non-tilemode we should not resolve into
                    // bound area frames (doing so could mutate a different animation).
                    let anim = this.selectedAnimation;
                    let frameIdx = this.selectedFrame;
                    if (this.tilemode && pos && typeof pos.areaIndex === 'number') {
                        const binding = this.getAreaBinding(pos.areaIndex);
                        if (binding && binding.anim !== undefined && binding.index !== undefined) {
                            anim = binding.anim;
                            frameIdx = Number(binding.index);
                        }
                    }
                    // Tile-mode: perform tile-region fill or tile-region select when renderOnly
                    if (this.tilemode && pos && pos.renderOnly) {
                        try {
                            // If there is a tile selection, fill all selected tiles
                            if (this._tileSelection && this._tileSelection.size > 0 && !this.keys.held('Shift')) {
                                try { this._playSfx('fill.tile'); } catch (e) {}
                                const binding = this._tileBrushBinding || { anim: this.selectedAnimation, index: this.selectedFrame };
                                const transform = this._tileBrushTransform ? { ...this._tileBrushTransform } : null;
                                for (const key of this._tileSelection) {
                                    const tile = this._parseTileKey(key);
                                    if (!tile) continue;
                                    const idx = this._getAreaIndexForCoord(tile.col, tile.row);
                                    if (!Number.isFinite(idx)) continue;
                                    this._activateTile(tile.col, tile.row);
                                    this._setAreaBindingAtIndex(idx, binding ? { ...binding } : null, true);
                                    if (transform) this._setAreaTransformAtIndex(idx, { ...transform }, true);
                                }
                                return;
                            }
                            console.log('hello')

                            // Otherwise, do normal flood fill/select
                            const startCol = (typeof pos.tileCol === 'number') ? pos.tileCol : null;
                            const startRow = (typeof pos.tileRow === 'number') ? pos.tileRow : null;
                            if (startCol === null || startRow === null) return;
                            const startIdx = this._getAreaIndexForCoord(startCol, startRow);
                            const startBinding = (typeof startIdx === 'number') ? this.getAreaBinding(startIdx) : null;
                            const matchBinding = (a, b) => {
                                if (!a && !b) return true;
                                if (!a || !b) return false;
                                return (a.anim === b.anim && Number(a.index) === Number(b.index));
                            };
                            const MAX_NODES = 200;
                            const stack = [{col: startCol, row: startRow}];
                            const seen = new Set();
                            const results = [];
                            while (stack.length) {
                                const n = stack.pop();
                                const key = this._tileKey(n.col, n.row);
                                if (seen.has(key)) continue;
                                seen.add(key);
                                const idx = this._getAreaIndexForCoord(n.col, n.row);
                                if (!Number.isFinite(idx)) continue;
                                // include inactive tiles as valid region members (empty tiles form regions)
                                // Do not skip based on _isTileActive here.
                                const b = this.getAreaBinding(idx);
                                if (!matchBinding(b, startBinding)) continue;
                                results.push({col: n.col, row: n.row, idx});
                                if (results.length >= MAX_NODES) break;
                                // neighbors 4-connected
                                stack.push({col: n.col - 1, row: n.row});
                                stack.push({col: n.col + 1, row: n.row});
                                stack.push({col: n.col, row: n.row - 1});
                                stack.push({col: n.col, row: n.row + 1});
                            }

                            if (results.length === 0) { return; }

                            // If we hit the MAX_NODES limit, treat as runoff and do not fill/select
                            if (results.length >= MAX_NODES) { return; }

                            
                            if (this.keys.held('Shift')) {
                                try { this._playSfx('select.tile'); } catch (e) {}
                                console.log('yay')
                                // select the region
                                if (!this._tileSelection) this._tileSelection = new Set();
                                for (const t of results) this._tileSelection.add(this._tileKey(t.col, t.row));
                                // update hover anchor so selection overlay shows immediately
                                this._tileHoverAnchor = { col: startCol, row: startRow };
                                return;
                            } else {
                                try { this._playSfx('fill.tile'); } catch (e) {}
                                console.log('heelo')
                                // apply fill binding to region
                                const binding = this._tileBrushBinding || { anim: this.selectedAnimation, index: this.selectedFrame };
                                const transform = this._tileBrushTransform ? { ...this._tileBrushTransform } : null;
                                for (const t of results) {
                                    this._activateTile(t.col, t.row);
                                    this._setAreaBindingAtIndex(t.idx, binding ? { ...binding } : null, true);
                                    if (transform) this._setAreaTransformAtIndex(t.idx, { ...transform }, true);
                                }
                                return;
                            }
                        } catch (e) { /* ignore tile fill/select errors */ return; }
                    }
                    if (!sheet) return;
                    const frameCanvas = sheet.getFrame(anim, frameIdx);
                    if (!frameCanvas) return;
                    try {
                        const w = frameCanvas.width;
                        const h = frameCanvas.height;
                        const ctx = frameCanvas.getContext('2d');
                        const img = ctx.getImageData(0, 0, w, h);
                        const data = img.data;
                        const sx = pos.x;
                        const sy = pos.y;
                        if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;
                        const startIdx = (sy * w + sx) * 4;
                        const srcR = data[startIdx], srcG = data[startIdx+1], srcB = data[startIdx+2], srcA = data[startIdx+3];
                        // If Shift is held, perform a flood-select instead of paint:
                        // build selectionPoints for the connected region matching src color.
                        if (this.keys.held('Shift')) {
                            try { this._playSfx('select.pixel'); } catch (e) {}
                            const wStride = w;
                            const stack = [];
                            const visited = new Set();
                            const areaIndex = (typeof pos.areaIndex === 'number') ? pos.areaIndex : null;
                            const newPoints = [];
                            stack.push(sy * w + sx);
                            while (stack.length) {
                                const p = stack.pop();
                                if (visited.has(p)) continue;
                                visited.add(p);
                                const y = Math.floor(p / wStride);
                                const x = p % wStride;
                                const idx = (y * wStride + x) * 4;
                                // match source color exactly
                                if (data[idx] !== srcR || data[idx+1] !== srcG || data[idx+2] !== srcB || data[idx+3] !== srcA) continue;
                                newPoints.push({ x, y, areaIndex });
                                // push neighbors
                                if (x > 0) stack.push(p - 1);
                                if (x < wStride - 1) stack.push(p + 1);
                                if (y > 0) stack.push(p - wStride);
                                if (y < h - 1) stack.push(p + wStride);
                            }

                            // Animate merge of flood-selected points into any existing selection
                            try {
                                this._animateSelectPoints(newPoints, 200, { ox: sx, oy: sy });
                            } catch (e) {
                                // fallback to immediate merge on failure
                                const merged = (this.selectionPoints && this.selectionPoints.length > 0)
                                    ? this.selectionPoints.slice()
                                    : [];
                                for (const p of newPoints) {
                                    const exists = merged.some(sp => sp.x === p.x && sp.y === p.y && sp.areaIndex === p.areaIndex);
                                    if (!exists) merged.push(p);
                                }
                                if (this.stateController) {
                                    try { this.stateController.setSelectionPoints(merged); this.stateController.clearSelectionRegion(); } catch (e) {}
                                } else {
                                    this.selectionPoints = merged;
                                    this.selectionRegion = null;
                                }
                            }
                            return;
                        }

                        // Otherwise, perform a paint fill using the current pen color.
                        try { this._playSfx('fill.pixel'); } catch (e) {}
                        const fillCol = Color.convertColor(this.penColor || '#000000');
                        const fRgb = fillCol.toRgb();
                        const fillR = Math.round(fRgb.a || 0);
                        const fillG = Math.round(fRgb.b || 0);
                        const fillB = Math.round(fRgb.c || 0);
                        const fillA = Math.round((fRgb.d ?? 1) * 255);
                        // If target color equals fill color, nothing to do
                        if (srcR === fillR && srcG === fillG && srcB === fillB && srcA === fillA) return;

                        const changes = [];
                        const fillHex = this.rgbaToHex(fillR, fillG, fillB, fillA);
                        const shiftHeld = this.keys.held('Shift');
                        if (shiftHeld) {
                            // Global exact replace: replace every pixel matching src color
                            for (let p = 0; p < w * h; p++) {
                                const idx = p * 4;
                                if (data[idx] === srcR && data[idx+1] === srcG && data[idx+2] === srcB && data[idx+3] === srcA) {
                                    changes.push({ x: (p % w), y: Math.floor(p / w), color: fillHex, blendType: 'replace' });
                                    data[idx] = fillR;
                                    data[idx+1] = fillG;
                                    data[idx+2] = fillB;
                                    data[idx+3] = fillA;
                                }
                            }
                        } else {
                            // Local flood-fill (4-connected) starting at mouse pixel
                            const wStride = w;
                            const stack = [];
                            stack.push(sy * w + sx);
                            while (stack.length) {
                                const p = stack.pop();
                                const y = Math.floor(p / wStride);
                                const x = p % wStride;
                                const idx = (y * wStride + x) * 4;
                                // match source color exactly
                                if (data[idx] !== srcR || data[idx+1] !== srcG || data[idx+2] !== srcB || data[idx+3] !== srcA) continue;
                                changes.push({ x, y, color: fillHex, blendType: 'replace' });
                                // set to fill (also marks visited for this pass)
                                data[idx] = fillR;
                                data[idx+1] = fillG;
                                data[idx+2] = fillB;
                                data[idx+3] = fillA;
                                // push neighbors
                                if (x > 0) stack.push(p - 1);
                                if (x < wStride - 1) stack.push(p + 1);
                                if (y > 0) stack.push(p - wStride);
                                if (y < h - 1) stack.push(p + wStride);
                            }
                        }

                        if (!changes.length) return;
                        try {
                            // Animate pixel changes as a short chain reaction (~200ms)
                            if (typeof this._animatePixelChanges === 'function') {
                                this._animatePixelChanges(changes, anim, frameIdx, sx, sy, 200);
                            } else if (typeof sheet.modifyFrame === 'function') {
                                sheet.modifyFrame(anim, frameIdx, changes);
                            } else {
                                for (const c of changes) {
                                    try { sheet.setPixel(anim, frameIdx, c.x, c.y, c.color, 'replace'); } catch (e) { /* ignore */ }
                                }
                            }
                        } catch (e) {
                            // fallback: apply immediately on any failure
                            if (typeof sheet.modifyFrame === 'function') {
                                try { sheet.modifyFrame(anim, frameIdx, changes); } catch (e) {}
                            } else {
                                for (const c of changes) {
                                    try { sheet.setPixel(anim, frameIdx, c.x, c.y, c.color, 'replace'); } catch (e) { /* ignore */ }
                                }
                            }
                        }
                    } catch (e) {
                        // ignore image read/write errors
                    }
                }
            } catch (e) {
                console.warn('fill bucket (f) failed', e);
            }

            // Average selected pixels into current pen color when 'j' released
            try {
                if (this.keys && typeof this.keys.released === 'function' && this.keys.released('j')) {
                    const sheet = this.currentSprite;
                    if (!sheet) return;
                    const samples = [];
                    // explicit point selection
                    if (this.selectionPoints && this.selectionPoints.length > 0) {
                        for (const p of this.selectionPoints) {
                            if (!p) continue;
                            const target = this._resolveAnimFrameForArea(p.areaIndex, this.selectedAnimation, this.selectedFrame);
                            const frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(target.anim, target.frameIdx) : null;
                            if (!frameCanvas) continue;
                            const ctx = frameCanvas.getContext('2d');
                            try {
                                const d = ctx.getImageData(p.x, p.y, 1, 1).data;
                                samples.push(d);
                            } catch (e) { /* ignore per-pixel errors */ }
                        }
                    } else if (this.selectionRegion) {
                        // rectangular region selection
                        const sr = this.selectionRegion;
                        const minX = Math.min(sr.start.x, sr.end.x);
                        const minY = Math.min(sr.start.y, sr.end.y);
                        const maxX = Math.max(sr.start.x, sr.end.x);
                        const maxY = Math.max(sr.start.y, sr.end.y);
                        const w = maxX - minX + 1;
                        const h = maxY - minY + 1;
                        const target = this._resolveAnimFrameForArea(sr.areaIndex, this.selectedAnimation, this.selectedFrame);
                        const frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(target.anim, target.frameIdx) : null;
                        if (frameCanvas) {
                            const ctx = frameCanvas.getContext('2d');
                            try {
                                const img = ctx.getImageData(minX, minY, w, h).data;
                                for (let yy = 0; yy < h; yy++) {
                                    for (let xx = 0; xx < w; xx++) {
                                        const idx = (yy * w + xx) * 4;
                                        samples.push([img[idx], img[idx+1], img[idx+2], img[idx+3]]);
                                    }
                                }
                            } catch (e) { /* ignore region read errors */ }
                        }
                    }

                    if (samples.length > 0) {
                        let r = 0, g = 0, b = 0, a = 0;
                        for (const s of samples) { r += (s[0] || 0); g += (s[1] || 0); b += (s[2] || 0); a += (s[3] || 0); }
                        const n = samples.length;
                        r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n); a = Math.round(a / n);
                        const hex8 = this.rgbaToHex(r, g, b, a);
                        if (this.stateController) this.stateController.setPenColor(hex8);
                        else this.penColor = hex8;
                        // update HTML color input (drop alpha)
                        if (this._colorInput) {
                            const toHex = (v) => (v < 16 ? '0' : '') + v.toString(16).toUpperCase();
                            try { this._colorInput.value = '#' + toHex(r) + toHex(g) + toHex(b); } catch (e) {}
                        }
                        try { this._playSfx('color.combine'); } catch (e) {}
                    }
                }
            } catch (e) { console.warn('average color (j) failed', e); }

            // Lighten (h) / Darken (k) selected pixels by a linear amount on
            // the currently-selected channel (this.adjustChannel). Use additive
            // deltas (this.adjustAmount) instead of multiplicative scaling.
            try {
                const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
                const applyAdjust = (direction) => {
                    const sheet = this.currentSprite;
                    if (!sheet) return;
                    const channel = this.state.brush.pixelBrush.channel;
                    // Reduce hue adjustments to a smaller fraction so keys change hue more finely
                    const channelMultiplier = (channel === 'h') ? 0.2 : 1.0;
                    const appliedDelta = direction * this.state.brush.pixelBrush.adjustAmount[channel] * channelMultiplier;

                    // point selection
                    if (this.selectionPoints && this.selectionPoints.length > 0) {
                        for (const p of this.selectionPoints) {
                            if (!p) continue;
                            const target = this._resolveAnimFrameForArea(p.areaIndex, this.selectedAnimation, this.selectedFrame);
                            const frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(target.anim, target.frameIdx) : null;
                            if (!frameCanvas) continue;
                            const ctx = frameCanvas.getContext('2d');
                            try {
                                const d = ctx.getImageData(p.x, p.y, 1, 1).data;
                                const col = Color.convertColor(this.rgbaToHex(d[0], d[1], d[2], d[3]));
                                const hsv = col.toHsv();
                                // hsv: a=h, b=s, c=v, d=alpha (0-1)
                                switch (channel) {
                                    case 'h':
                                        hsv.a = (hsv.a + appliedDelta) % 1; if (hsv.a < 0) hsv.a += 1;
                                        break;
                                    case 's':
                                        hsv.b = clamp(hsv.b + appliedDelta, 0, 1);
                                        break;
                                    case 'v':
                                        hsv.c = clamp(hsv.c + appliedDelta, 0, 1);
                                        break;
                                    case 'a':
                                        hsv.d = clamp(hsv.d + appliedDelta, 0, 1);
                                        break;
                                }
                                const rgb = hsv.toRgb();
                                const newHex = this.rgbaToHex(Math.round(rgb.a), Math.round(rgb.b), Math.round(rgb.c), Math.round((rgb.d ?? 1) * 255));
                                if (typeof sheet.setPixel === 'function') sheet.setPixel(target.anim, target.frameIdx, p.x, p.y, newHex, 'replace');
                            } catch (e) { /* ignore per-pixel errors */ }
                        }
                        if (typeof sheet._rebuildSheetCanvas === 'function') try { sheet._rebuildSheetCanvas(); } catch(e){}
                        return;
                    }

                    // region selection
                    if (this.selectionRegion) {
                        const sr = this.selectionRegion;
                        const minX = Math.min(sr.start.x, sr.end.x);
                        const minY = Math.min(sr.start.y, sr.end.y);
                        const maxX = Math.max(sr.start.x, sr.end.x);
                        const maxY = Math.max(sr.start.y, sr.end.y);
                        const w = maxX - minX + 1;
                        const h = maxY - minY + 1;
                        const target = this._resolveAnimFrameForArea(sr.areaIndex, this.selectedAnimation, this.selectedFrame);
                        const frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(target.anim, target.frameIdx) : null;
                        if (!frameCanvas) return;
                        const ctx = frameCanvas.getContext('2d');
                        try {
                            const img = ctx.getImageData(minX, minY, w, h);
                            const data = img.data;
                            for (let yy = 0; yy < h; yy++) {
                                for (let xx = 0; xx < w; xx++) {
                                    const idx = (yy * w + xx) * 4;
                                    const r = data[idx], g = data[idx+1], b = data[idx+2], a = data[idx+3];
                                    try {
                                        const col = Color.convertColor(this.rgbaToHex(r, g, b, a));
                                        const hsv = col.toHsv();
                                        switch (channel) {
                                            case 'h':
                                                hsv.a = (hsv.a + appliedDelta) % 1; if (hsv.a < 0) hsv.a += 1; break;
                                            case 's':
                                                hsv.b = clamp(hsv.b + appliedDelta, 0, 1); break;
                                            case 'v':
                                                hsv.c = clamp(hsv.c + appliedDelta, 0, 1); break;
                                            case 'a':
                                                hsv.d = clamp(hsv.d + appliedDelta, 0, 1); break;
                                        }
                                        const rgb = hsv.toRgb();
                                        data[idx] = Math.round(rgb.a);
                                        data[idx+1] = Math.round(rgb.b);
                                        data[idx+2] = Math.round(rgb.c);
                                        data[idx+3] = Math.round((rgb.d ?? 1) * 255);
                                    } catch (e) { /* ignore per-pixel errors */ }
                                }
                            }
                            ctx.putImageData(img, minX, minY);
                            if (typeof sheet._rebuildSheetCanvas === 'function') try { sheet._rebuildSheetCanvas(); } catch(e){}
                        } catch (e) { /* ignore region read/write errors */ }
                    }

                    // No active selection: apply adjustment to the current pen/draw color
                    if ((!this.selectionPoints || this.selectionPoints.length === 0) && !this.selectionRegion) {
                        try {
                            const cur = this.penColor || '#000000';
                            const col = Color.convertColor(cur);
                            const hsv = col.toHsv();
                            switch (channel) {
                                case 'h':
                                    hsv.a = (hsv.a + appliedDelta) % 1; if (hsv.a < 0) hsv.a += 1; break;
                                case 's':
                                    hsv.b = clamp(hsv.b + appliedDelta, 0, 1); break;
                                case 'v':
                                    hsv.c = clamp(hsv.c + appliedDelta, 0, 1); break;
                                case 'a':
                                    hsv.d = clamp(hsv.d + appliedDelta, 0, 1); break;
                            }
                            const rgb = hsv.toRgb();
                            const newHex8 = this.rgbaToHex(Math.round(rgb.a), Math.round(rgb.b), Math.round(rgb.c), Math.round((rgb.d ?? 1) * 255));
                            if (this.stateController) this.stateController.setPenColor(newHex8);
                            else this.penColor = newHex8;
                            // sync HTML color input (drop alpha component)
                            if (this._colorInput) {
                                const toHex = (v) => (v < 16 ? '0' : '') + v.toString(16).toUpperCase();
                                try { this._colorInput.value = '#' + toHex(Math.round(rgb.a)) + toHex(Math.round(rgb.b)) + toHex(Math.round(rgb.c)); } catch (e) {}
                            }
                        } catch (e) { /* ignore color math errors */ }
                    }
                };
                if (this.keys && typeof this.keys.released === 'function') {
                    if (this.keys.released('h')) {
                        applyAdjust(1); // additive lighten on selected channel
                        try { this._playSfx('color.adjust'); } catch (e) {}
                    }
                    if (this.keys.released('k')) {
                        applyAdjust(-1); // additive darken on selected channel
                        try { this._playSfx('color.adjust'); } catch (e) {}
                    }
                }
            } catch (e) { console.warn('lighten/darken (h/k) failed', e); }

            // Add subtle noise/randomness to the current frame on 'n' release
            const noisePressed = (this.keys.released('n') || this.keys.released('N'));
            if (noisePressed) {
                const sheet = this.currentSprite;
                // Prefer selection-origin area/frame when applying noise
                let sourceAreaIndex = null;
                if (this.selectionPoints && this.selectionPoints.length > 0 && typeof this.selectionPoints[0].areaIndex === 'number') {
                    sourceAreaIndex = this.selectionPoints[0].areaIndex;
                } else if (this.selectionRegion && typeof this.selectionRegion.areaIndex === 'number') {
                    sourceAreaIndex = this.selectionRegion.areaIndex;
                } else {
                    const posInfo = this.getPos(this.mouse && this.mouse.pos) || {};
                    if (posInfo && typeof posInfo.areaIndex === 'number') sourceAreaIndex = posInfo.areaIndex;
                }
                let anim = this.selectedAnimation;
                let frameIdx = this.selectedFrame;
                if (this.tilemode && typeof sourceAreaIndex === 'number') {
                    const binding = this.getAreaBinding(sourceAreaIndex);
                    if (binding && binding.anim !== undefined && binding.index !== undefined) {
                        anim = binding.anim;
                        frameIdx = Number(binding.index);
                    }
                }
                const frameCanvas = sheet.getFrame(anim, frameIdx);

                const w = frameCanvas.width;
                const h = frameCanvas.height;
                const ctx = frameCanvas.getContext('2d');
                const img = ctx.getImageData(0, 0, w, h);
                const data = img.data;
                const noiseChanges = [];
                const channel = this.state.brush.pixelBrush.channel;
                const baseAdjust = this.state.brush.pixelBrush.adjustAmount[channel];
                const channelMultiplier = (channel === 'h') ? 0.2 : 1.0;
                const hsvDelta = baseAdjust * channelMultiplier;
                const ratioRange = Math.max(0, Math.round(baseAdjust * 100));
                const spliceMode = !!(this.keys && this.keys.held && this.keys.held('Shift'));
                const clamp01 = (v) => Math.max(0, Math.min(1, v));
                const clamp255 = (v) => Math.max(0, Math.min(255, v));
                const randFloat = (range) => (Math.random() * 2 - 1) * range;
                const randIntRange = (range) => Math.floor(Math.random() * (range * 2 + 1)) - range;

                // Helper to apply noise to a pixel index using the current adjust channel/amount.
                const applyNoiseAtIdx = (idx) => {
                    const r = data[idx];
                    const g = data[idx + 1];
                    const b = data[idx + 2];
                    const a = data[idx + 3];

                    const hex = this.rgbaToHex(r, g, b, a);
                    const col = Color.convertColor(hex);
                    const hsv = col.toHsv(); // {a:h, b:s, c:v, d:alpha}

                    let nr = r, ng = g, nb = b, na = a;

                    if (spliceMode && channel === 'v') {
                        const deltaV = randIntRange(ratioRange);
                        nr = clamp255(r + deltaV);
                        ng = clamp255(g + deltaV);
                        nb = clamp255(b + deltaV);
                    } else {
                        switch (channel) {
                            case 'h': {
                                hsv.a = (hsv.a + randFloat(hsvDelta)) % 1; if (hsv.a < 0) hsv.a += 1;
                                break;
                            }
                            case 's': {
                                const deltaS = spliceMode ? randIntRange(ratioRange) / 100 : randFloat(hsvDelta);
                                hsv.b = clamp01(hsv.b + deltaS);
                                break;
                            }
                            case 'a': {
                                const deltaA = spliceMode ? randIntRange(ratioRange) / 100 : randFloat(hsvDelta);
                                hsv.d = clamp01(hsv.d + deltaA);
                                break;
                            }
                            case 'v':
                            default: {
                                const deltaV = spliceMode ? randIntRange(ratioRange) / 100 : randFloat(hsvDelta);
                                hsv.c = clamp01(hsv.c + deltaV);
                                break;
                            }
                        }

                        const rgb = hsv.toRgb(); // returns Color with rgb in a,b,c
                        nr = Math.round(rgb.a);
                        ng = Math.round(rgb.b);
                        nb = Math.round(rgb.c);
                        if (channel === 'a') {
                            const alphaComponent = rgb.d ?? hsv.d ?? 1;
                            na = Math.round(clamp255(alphaComponent * 255));
                        }
                    }

                    data[idx] = nr;
                    data[idx + 1] = ng;
                    data[idx + 2] = nb;
                    data[idx + 3] = na;

                    if (nr !== r || ng !== g || nb !== b || na !== a) {
                        const px = (idx / 4) % w;
                        const py = Math.floor((idx / 4) / w);
                        noiseChanges.push({ x: px, y: py, next: this.rgbaToHex(nr, ng, nb, na) });
                    }
                };

                // If there is any active selection (points or region), only affect those pixels.
                const hasPointSelection = (this.selectionPoints && this.selectionPoints.length > 0);
                const hasRegionSelection = !!this.selectionRegion;
                if (hasPointSelection) {
                    for (const p of this.selectionPoints) {
                        if (!p) continue;
                        if (p.x < 0 || p.y < 0 || p.x >= w || p.y >= h) continue;
                        const idx = (p.y * w + p.x) * 4;
                        applyNoiseAtIdx(idx);
                    }
                } else if (hasRegionSelection) {
                    const sr = this.selectionRegion;
                    const minX = Math.max(0, Math.min(sr.start.x, sr.end.x));
                    const minY = Math.max(0, Math.min(sr.start.y, sr.end.y));
                    const maxX = Math.min(w - 1, Math.max(sr.start.x, sr.end.x));
                    const maxY = Math.min(h - 1, Math.max(sr.start.y, sr.end.y));
                    for (let yy = minX ? minY : minY; yy <= maxY; yy++) {
                        for (let xx = minX; xx <= maxX; xx++) {
                            const idx = (yy * w + xx) * 4;
                            applyNoiseAtIdx(idx);
                        }
                    }
                } else {
                    // No selection -> apply full-frame subtle noise: affect a fraction of pixels
                    const prob = 0.18; // ~18% of pixels
                    for (let p = 0; p < w * h; p++) {
                        if (Math.random() < prob) applyNoiseAtIdx(p * 4);
                    }
                }

                if (noiseChanges.length && typeof this._recordUndoPixels === 'function') {
                    try { this._recordUndoPixels(anim, frameIdx, noiseChanges); } catch (e) { /* ignore undo capture errors */ }
                }

                ctx.putImageData(img, 0, 0);
                if (typeof sheet._rebuildSheetCanvas === 'function') {
                    try { sheet._rebuildSheetCanvas(); } catch (e) { }
                }
            }

            // If clipboard preview is active, allow left-click (press+hold) inside the preview
            // to pick a new origin inside the clipboard. We freeze the preview placement on
            // initial press so subsequent mouse movement moves the origin relative to that frozen preview.
            try {
                const activeType = this._activeClipboardType;
                if (this.clipboardPreview && this.clipboard && (!activeType || activeType === 'pixel')) {
                    const cb = this.clipboard;
                    // start dragging (freeze) on initial press
                    if (this.mouse.pressed('left') && !this._clipboardPreviewDragging) {
                        const posInfo = this.getPos(this.mouse.pos);
                        if (posInfo && posInfo.inside) {
                            const ox = (cb.originOffset && Number.isFinite(cb.originOffset.ox)) ? cb.originOffset.ox : 0;
                            const oy = (cb.originOffset && Number.isFinite(cb.originOffset.oy)) ? cb.originOffset.oy : 0;
                            const topLeftX = posInfo.x - ox;
                            const topLeftY = posInfo.y - oy;
                            this._clipboardPreviewDragging = { topLeftX, topLeftY, w: cb.w, h: cb.h };
                            // set initial origin based on where the mouse was pressed inside the frozen preview
                            const localX = Math.max(0, Math.min(cb.w - 1, posInfo.x - topLeftX));
                            const localY = Math.max(0, Math.min(cb.h - 1, posInfo.y - topLeftY));
                            cb.originOffset = { ox: localX, oy: localY };
                        }
                    }

                    // while holding left, update the origin based on mouse pos inside frozen preview
                    if (this._clipboardPreviewDragging && this.mouse.held('left',"pasteMode")) {
                        const posInfo = this.getPos(this.mouse.pos);
                        if (posInfo && posInfo.inside) {
                            const topLeftX = this._clipboardPreviewDragging.topLeftX;
                            const topLeftY = this._clipboardPreviewDragging.topLeftY;
                            const localX = Math.max(0, Math.min(cb.w - 1, posInfo.x - topLeftX));
                            const localY = Math.max(0, Math.min(cb.h - 1, posInfo.y - topLeftY));
                            cb.originOffset = { ox: localX, oy: localY };
                        }
                    }

                    // on release, stop dragging (but keep preview if Alt still held)
                    if (this._clipboardPreviewDragging && !this.mouse.held('left',"pasteMode")) {
                        this._clipboardPreviewDragging = null;
                    }
                }
            } catch (e) {
                console.warn('clipboard preview drag failed', e);
            }
            
            } catch (e) {
                console.warn('selectionTool failed', e);
            } finally {
                // clear transient paste flag so it only affects the current tick
                try { this._justPasted = false; } catch (ee) {}
            }
        }

    _handleSelectionKeyframeTap() {
        try {
            const snap = this._captureSelectionSnapshot();
            if (!snap) {
                this._selectionKeyframeStart = null;
                this._selectionKeyframePrompt = null;
                return;
            }
            if (!this._selectionKeyframeStart || this._selectionKeyframeStart.anim !== snap.anim || this._selectionKeyframeStart.frame === snap.frame) {
                this._selectionKeyframeTrack = null;
                this._selectionKeyframeStart = snap;
                this._selectionKeyframePrompt = 'Place second keyframe (tap i on a new selection)';
                return;
            }

            const track = this._buildSelectionKeyframeTrack(this._selectionKeyframeStart, snap);
            this._selectionKeyframeStart = null;
            this._selectionKeyframePrompt = null;
            if (track) {
                this._selectionKeyframeTrack = track;
                this._applySelectionSnapshot(snap);
            }
        } catch (e) {
            console.warn('selection keyframe tap failed', e);
        }
    }

    _captureSelectionSnapshot() {
        try {
            const anim = this.selectedAnimation;
            const frame = Number(this.selectedFrame || 0);
            if (this.selectionRegion) {
                const sr = this.selectionRegion;
                return {
                    type: 'region',
                    start: { x: sr.start.x, y: sr.start.y },
                    end: { x: sr.end.x, y: sr.end.y },
                    areaIndex: (typeof sr.areaIndex === 'number') ? sr.areaIndex : null,
                    anim,
                    frame
                };
            }
            if (this.selectionPoints && this.selectionPoints.length > 0) {
                const pts = this.selectionPoints.map(p => ({ x: p.x, y: p.y, areaIndex: (typeof p.areaIndex === 'number') ? p.areaIndex : null }));
                return { type: 'points', points: pts, anim, frame };
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    _snapshotToPoints(snapshot) {
        if (!snapshot) return [];
        if (snapshot.type === 'points' && Array.isArray(snapshot.points)) return snapshot.points.slice();
        if (snapshot.type === 'region' && snapshot.start && snapshot.end) {
            const minX = Math.min(snapshot.start.x, snapshot.end.x);
            const minY = Math.min(snapshot.start.y, snapshot.end.y);
            const maxX = Math.max(snapshot.start.x, snapshot.end.x);
            const maxY = Math.max(snapshot.start.y, snapshot.end.y);
            const pts = [];
            for (let y = minY; y <= maxY; y++) {
                for (let x = minX; x <= maxX; x++) {
                    pts.push({ x, y, areaIndex: (typeof snapshot.areaIndex === 'number') ? snapshot.areaIndex : null });
                }
            }
            return pts;
        }
        return [];
    }

    _applySelectionSnapshot(snapshot) {
        if (!snapshot) return;
        if (snapshot.type === 'region') {
            const nextRegion = {
                start: { x: snapshot.start.x, y: snapshot.start.y },
                end: { x: snapshot.end.x, y: snapshot.end.y },
                areaIndex: (typeof snapshot.areaIndex === 'number') ? snapshot.areaIndex : null
            };
            if (this.stateController) {
                this.stateController.setSelectionRegion(nextRegion);
                this.stateController.clearSelectionPoints();
            } else {
                this.selectionRegion = nextRegion;
                this.selectionPoints = [];
            }
        } else if (snapshot.type === 'points') {
            const nextPoints = (snapshot.points || []).map(p => ({ x: p.x, y: p.y, areaIndex: (typeof p.areaIndex === 'number') ? p.areaIndex : null }));
            if (this.stateController) {
                this.stateController.setSelectionPoints(nextPoints);
                this.stateController.clearSelectionRegion();
            } else {
                this.selectionPoints = nextPoints;
                this.selectionRegion = null;
            }
        }
    }

    _buildSelectionKeyframeTrack(startSnap, endSnap) {
        try {
            if (!startSnap || !endSnap) return null;
            if (startSnap.anim !== endSnap.anim) return null;
            const startFrame = Number(startSnap.frame || 0);
            const endFrame = Number(endSnap.frame || 0);
            if (startFrame === endFrame) return null;
            const distance = Math.abs(endFrame - startFrame);
            const dir = (endFrame >= startFrame) ? 1 : -1;
            const frames = {};
            const lerp = (a, b, t) => a + (b - a) * t;

            if (startSnap.type === 'region' && endSnap.type === 'region') {
                const areaMatch = (typeof startSnap.areaIndex === 'number') ? startSnap.areaIndex : ((typeof endSnap.areaIndex === 'number') ? endSnap.areaIndex : null);
                const startBox = {
                    minX: Math.min(startSnap.start.x, startSnap.end.x),
                    minY: Math.min(startSnap.start.y, startSnap.end.y),
                    maxX: Math.max(startSnap.start.x, startSnap.end.x),
                    maxY: Math.max(startSnap.start.y, startSnap.end.y)
                };
                const endBox = {
                    minX: Math.min(endSnap.start.x, endSnap.end.x),
                    minY: Math.min(endSnap.start.y, endSnap.end.y),
                    maxX: Math.max(endSnap.start.x, endSnap.end.x),
                    maxY: Math.max(endSnap.start.y, endSnap.end.y)
                };
                for (let step = 0; step <= distance; step++) {
                    const t = distance === 0 ? 1 : (step / distance);
                    const minX = Math.round(lerp(startBox.minX, endBox.minX, t));
                    const minY = Math.round(lerp(startBox.minY, endBox.minY, t));
                    const maxX = Math.round(lerp(startBox.maxX, endBox.maxX, t));
                    const maxY = Math.round(lerp(startBox.maxY, endBox.maxY, t));
                    const frame = startFrame + dir * step;
                    frames[frame] = {
                        type: 'region',
                        start: { x: Math.min(minX, maxX), y: Math.min(minY, maxY) },
                        end: { x: Math.max(minX, maxX), y: Math.max(minY, maxY) },
                        areaIndex: areaMatch
                    };
                }
                return { anim: startSnap.anim, startFrame, endFrame, frames };
            }

            const startPoints = this._snapshotToPoints(startSnap);
            const endPoints = this._snapshotToPoints(endSnap);
            if (!startPoints.length || !endPoints.length) return null;
            const sortPts = (arr) => arr.slice().sort((a, b) => (a.x - b.x) || (a.y - b.y));
            const sPts = sortPts(startPoints);
            const ePts = sortPts(endPoints);
            const maxLen = Math.max(sPts.length, ePts.length);

            for (let step = 0; step <= distance; step++) {
                const t = distance === 0 ? 1 : (step / distance);
                const frame = startFrame + dir * step;
                const dedup = new Map();
                for (let i = 0; i < maxLen; i++) {
                    const s = sPts[i % sPts.length];
                    const e = ePts[i % ePts.length];
                    const x = Math.round(lerp(s.x, e.x, t));
                    const y = Math.round(lerp(s.y, e.y, t));
                    const area = (typeof e.areaIndex === 'number') ? e.areaIndex : ((typeof s.areaIndex === 'number') ? s.areaIndex : null);
                    const key = `${area === null ? 'null' : area}:${x},${y}`;
                    if (!dedup.has(key)) dedup.set(key, { x, y, areaIndex: area });
                }
                frames[frame] = { type: 'points', points: Array.from(dedup.values()) };
            }
            return { anim: startSnap.anim, startFrame, endFrame, frames };
        } catch (e) {
            console.warn('build selection keyframe track failed', e);
            return null;
        }
    }

    _handleFrameKeyframeTap() {
        try {
            const snap = this._captureFrameKeyframeSnapshot();
            if (!snap) {
                this._frameKeyframeStart = null;
                this._frameKeyframePrompt = null;
                return;
            }
            if (!this._frameKeyframeStart || this._frameKeyframeStart.anim !== snap.anim || this._frameKeyframeStart.frame === snap.frame) {
                this._frameKeyframeStart = snap;
                this._frameKeyframePrompt = 'Place second frame keyframe (tap i on target frame)';
                return;
            }

            const track = this._buildFrameKeyframeTrack(this._frameKeyframeStart, snap);
            this._frameKeyframeStart = null;
            this._frameKeyframePrompt = null;
            if (track) this._applyFrameKeyframeTrack(track);
        } catch (e) {
            console.warn('frame keyframe tap failed', e);
        }
    }

    _captureFrameKeyframeSnapshot() {
        try {
            const anim = this.selectedAnimation;
            const frame = Number(this.selectedFrame || 0);
            const sheet = this.currentSprite;
            if (!sheet) return null;
            const canvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, frame) : null;
            if (!canvas) return null;
            const ctx = canvas.getContext('2d');

            // derive selection mask and bounding box (fallback to full frame)
            let minX = 0, minY = 0, maxX = canvas.width - 1, maxY = canvas.height - 1;
            let mask = null;
            if (this.selectionPoints && this.selectionPoints.length > 0) {
                minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
                const pts = [];
                for (const p of this.selectionPoints) {
                    if (!p) continue;
                    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
                    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
                    pts.push(p);
                }
                if (pts.length) {
                    const w = maxX - minX + 1;
                    const h = maxY - minY + 1;
                    mask = new Uint8Array(w * h);
                    for (const p of pts) {
                        const ix = p.x - minX;
                        const iy = p.y - minY;
                        if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
                        mask[iy * w + ix] = 1;
                    }
                } else {
                    minX = 0; minY = 0; maxX = canvas.width - 1; maxY = canvas.height - 1;
                }
            } else if (this.selectionRegion) {
                minX = Math.max(0, Math.min(this.selectionRegion.start.x, this.selectionRegion.end.x));
                minY = Math.max(0, Math.min(this.selectionRegion.start.y, this.selectionRegion.end.y));
                maxX = Math.min(canvas.width - 1, Math.max(this.selectionRegion.start.x, this.selectionRegion.end.x));
                maxY = Math.min(canvas.height - 1, Math.max(this.selectionRegion.start.y, this.selectionRegion.end.y));
                const w = maxX - minX + 1;
                const h = maxY - minY + 1;
                mask = new Uint8Array(w * h);
                mask.fill(1);
            }

            const boxW = maxX - minX + 1;
            const boxH = maxY - minY + 1;
            const img = ctx.getImageData(minX, minY, boxW, boxH);
            return {
                anim,
                frame,
                w: canvas.width,
                h: canvas.height,
                box: { minX, minY, maxX, maxY, w: boxW, h: boxH },
                data: new Uint8ClampedArray(img.data),
                mask,
                hasSelection: !!mask
            };
        } catch (e) {
            return null;
        }
    }

    _applyFrameSnapshot(snapshot) {
        try {
            if (!snapshot) return;
            const sheet = this.currentSprite;
            if (!sheet) return;
            const anim = snapshot.anim;
            const frameIdx = snapshot.frame;
            const box = snapshot.box || { minX: 0, minY: 0, w: snapshot.w, h: snapshot.h };
            const w = box.w|0;
            const h = box.h|0;
            if (w <= 0 || h <= 0) return;
            const data = snapshot.data;
            if (!data || data.length < w * h * 4) return;
            const changes = [];
            let i = 0;
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const r = data[i++];
                    const g = data[i++];
                    const b = data[i++];
                    const a = data[i++];
                    if (snapshot.hasSelection && a === 0) continue;
                    changes.push({ x: box.minX + x, y: box.minY + y, color: this.rgbaToHex(r, g, b, a), blendType: 'replace' });
                }
            }
            if (changes.length) sheet.modifyFrame(anim, frameIdx, changes);
        } catch (e) {
            console.warn('apply frame snapshot failed', e);
        }
    }

    _buildFrameKeyframeTrack(startSnap, endSnap) {
        try {
            if (!startSnap || !endSnap) return null;
            if (startSnap.anim !== endSnap.anim) return null;
            if (startSnap.w !== endSnap.w || startSnap.h !== endSnap.h) return null;
            const startFrame = Number(startSnap.frame || 0);
            const endFrame = Number(endSnap.frame || 0);
            const dist = Math.abs(endFrame - startFrame);
            if (dist === 0) return null;
            const dir = (endFrame >= startFrame) ? 1 : -1;
            const frames = {};
            const transform = this._detectSelectionTransform(startSnap, endSnap);

            for (let step = 0; step <= dist; step++) {
                const t = dist === 0 ? 1 : (step / dist);
                const frame = startFrame + dir * step;
                const snap = this._interpolateFrameSelectionPixels(startSnap, endSnap, t, frame, transform);
                if (snap) frames[frame] = snap;
            }
            return { anim: startSnap.anim, startFrame, endFrame, frames, transform };
        } catch (e) {
            console.warn('build frame keyframe track failed', e);
            return null;
        }
    }

    _interpolateFrameSelectionPixels(startSnap, endSnap, t, frameValue, detectedTransform = null) {
        try {
            const canvasW = startSnap.w|0;
            const canvasH = startSnap.h|0;
            if (canvasW <= 0 || canvasH <= 0) return null;
            const lerp = (a, b, tt) => a + (b - a) * tt;

            const sb = startSnap.box || { minX: 0, minY: 0, maxX: canvasW - 1, maxY: canvasH - 1, w: canvasW, h: canvasH };
            const eb = endSnap.box || { minX: 0, minY: 0, maxX: canvasW - 1, maxY: canvasH - 1, w: canvasW, h: canvasH };
            const tb = {
                minX: Math.round(lerp(sb.minX, eb.minX, t)),
                minY: Math.round(lerp(sb.minY, eb.minY, t)),
                maxX: Math.round(lerp(sb.maxX, eb.maxX, t)),
                maxY: Math.round(lerp(sb.maxY, eb.maxY, t))
            };
            tb.w = tb.maxX - tb.minX + 1;
            tb.h = tb.maxY - tb.minY + 1;
            if (tb.w <= 0 || tb.h <= 0) return null;

            const clamp01 = (v) => Math.max(0, Math.min(1, v));
            const wrap01 = (v) => {
                let r = v % 1;
                if (r < 0) r += 1;
                return r;
            };
            const channelStep = (channel) => {
                const base = (typeof this._getAdjustPercent === 'function')
                    ? this._getAdjustPercent(channel)
                    : (typeof this.adjustAmount === 'number' ? this.adjustAmount : 0.05);
                const multiplier = (channel === 'h') ? 0.2 : 1; // keep hue step aligned with lighten/darken behaviour
                const step = base * multiplier;
                return (Number.isFinite(step) && step > 0) ? step : 0;
            };
            const hStep = channelStep('h');
            const sStep = channelStep('s');
            const vStep = channelStep('v');
            const aStep = channelStep('a');

            const quantizeChannel = (start, end, tt, step, wrap = false) => {
                if (!Number.isFinite(step) || step <= 0) return wrap ? wrap01(lerp(start, end, tt)) : lerp(start, end, tt);
                if (tt <= 0) return wrap ? wrap01(start) : start;
                if (tt >= 1) return wrap ? wrap01(end) : end;

                let delta = end - start;
                if (wrap) delta = ((delta + 0.5) % 1) - 0.5; // shortest hue path

                const steps = delta / step;
                if (!Number.isFinite(steps) || steps === 0) return wrap ? wrap01(start) : start;

                const maxSteps = Math.abs(steps);
                const quantSteps = Math.min(Math.abs(Math.round(steps * tt)), Math.ceil(maxSteps));
                const signedSteps = Math.sign(steps) * quantSteps;
                const val = start + signedSteps * step;
                return wrap ? wrap01(val) : clamp01(val);
            };

            const rgbToHsv = (r, g, b, a = 255) => {
                const rn = (r || 0) / 255;
                const gn = (g || 0) / 255;
                const bn = (b || 0) / 255;
                const max = Math.max(rn, gn, bn);
                const min = Math.min(rn, gn, bn);
                const d = max - min;
                let h = 0;
                if (d !== 0) {
                    switch (max) {
                        case rn: h = ((gn - bn) / d) % 6; break;
                        case gn: h = (bn - rn) / d + 2; break;
                        default: h = (rn - gn) / d + 4; break;
                    }
                    h /= 6;
                    if (h < 0) h += 1;
                }
                const s = max === 0 ? 0 : d / max;
                const v = max;
                return { h, s, v, a: (a || 0) / 255 };
            };

            const hsvToRgba = (h, s, v, a = 1) => {
                const hh = wrap01(h) * 6;
                const i = Math.floor(hh);
                const f = hh - i;
                const p = v * (1 - s);
                const q = v * (1 - f * s);
                const tVal = v * (1 - (1 - f) * s);
                let r, g, b;
                switch (i % 6) {
                    case 0: r = v; g = tVal; b = p; break;
                    case 1: r = q; g = v; b = p; break;
                    case 2: r = p; g = v; b = tVal; break;
                    case 3: r = p; g = q; b = v; break;
                    case 4: r = tVal; g = p; b = v; break;
                    default: r = v; g = p; b = q; break;
                }
                return {
                    r: Math.round(clamp01(r) * 255),
                    g: Math.round(clamp01(g) * 255),
                    b: Math.round(clamp01(b) * 255),
                    a: Math.round(clamp01(a) * 255)
                };
            };

            // If masks describe an exact flip/rotation, steer interpolation with that transform.
            const tr = detectedTransform;
            const hasTransform = !!(tr && tr.kind);
            const startCenter = { x: sb.minX + (sb.w - 1) / 2, y: sb.minY + (sb.h - 1) / 2 };
            const endCenter = { x: eb.minX + (eb.w - 1) / 2, y: eb.minY + (eb.h - 1) / 2 };
            const center = { x: lerp(startCenter.x, endCenter.x, t), y: lerp(startCenter.y, endCenter.y, t) };

            // Y-axis "3D" spin for horizontal flips: collapse width at mid, reveal flipped art on second half.
            const isYSpin = hasTransform && tr.flipX && !tr.flipY;
            const spinAngle = isYSpin ? (Math.PI * t) : (hasTransform ? (tr.angleRad || 0) * t : 0);
            const minSpinScale = 1 / Math.max(1, Math.max(sb.w, eb.w));
            const spinScale = isYSpin ? Math.max(minSpinScale, Math.abs(Math.cos(spinAngle))) : 1;
            // For non-spin transforms we still allow flip/rot usage.
            const flipSignX = (!isYSpin && hasTransform && tr.flipX) ? (t >= 0.5 ? -1 : 1) : 1;
            const flipSignY = (!isYSpin && hasTransform && tr.flipY) ? (t >= 0.5 ? -1 : 1) : 1;
            const rot = (vx, vy, a, sx = 1, sy = 1) => {
                const ca = Math.cos(a);
                const sa = Math.sin(a);
                return { x: (vx * ca - vy * sa) * sx, y: (vx * sa + vy * ca) * sy };
            };

            const sample = (snap, x, y) => {
                const b = snap.box || { minX: 0, minY: 0, w: snap.w, h: snap.h };
                const lx = Math.round(x - b.minX);
                const ly = Math.round(y - b.minY);
                if (lx < 0 || ly < 0 || lx >= b.w || ly >= b.h) return [0,0,0,0];
                if (snap.mask) {
                    const mi = ly * b.w + lx;
                    if (snap.mask[mi] === 0) return [0,0,0,0];
                }
                const idx = (ly * b.w + lx) * 4;
                const d = snap.data;
                return [d[idx], d[idx+1], d[idx+2], d[idx+3]];
            };

            const changes = [];
            for (let yy = 0; yy < tb.h; yy++) {
                for (let xx = 0; xx < tb.w; xx++) {
                    const tx = tb.minX + xx;
                    const ty = tb.minY + yy;
                    if (tx < 0 || ty < 0 || tx >= canvasW || ty >= canvasH) continue;

                    // Centered vector for transform-aware mapping.
                    const vx = tx - center.x;
                    const vy = ty - center.y;

                    let sc, ec;
                    if (isYSpin) {
                        // Compress around center.x using spinScale; show only the front face for each half with no alpha fade.
                        const useEnd = t >= 0.5;
                        const srcSnap = useEnd ? endSnap : startSnap;
                        const srcCenter = useEnd ? endCenter : startCenter;
                        const lx = vx * spinScale;
                        const ly = vy;
                        const sxWorld = srcCenter.x + lx;
                        const syWorld = srcCenter.y + ly;
                        const face = sample(srcSnap, sxWorld, syWorld);
                        // Lock both samples to the active face so lerp keeps alpha constant.
                        sc = face;
                        ec = face;
                    } else if (hasTransform) {
                        const angle = (tr.angleRad || 0) * t;
                        const sv = rot(vx, vy, -angle, flipSignX, flipSignY);
                        const ev = rot(vx, vy, (tr.angleRad || 0) - angle, tr.flipX ? -flipSignX : flipSignX, tr.flipY ? -flipSignY : flipSignY);
                        const sxWorld = startCenter.x + sv.x;
                        const syWorld = startCenter.y + sv.y;
                        const exWorld = endCenter.x + ev.x;
                        const eyWorld = endCenter.y + ev.y;
                        sc = sample(startSnap, sxWorld, syWorld);
                        ec = sample(endSnap, exWorld, eyWorld);
                    } else {
                        const u = tb.w > 1 ? xx / (tb.w - 1) : 0.5;
                        const v = tb.h > 1 ? yy / (tb.h - 1) : 0.5;
                        const sx = sb.minX + u * (sb.w - 1);
                        const sy = sb.minY + v * (sb.h - 1);
                        const ex = eb.minX + u * (eb.w - 1);
                        const ey = eb.minY + v * (eb.h - 1);
                        sc = sample(startSnap, sx, sy);
                        ec = sample(endSnap, ex, ey);
                    }

                    if (sc[3] === 0 && ec[3] === 0) continue;
                    const sHsv = rgbToHsv(sc[0], sc[1], sc[2], sc[3]);
                    const eHsv = rgbToHsv(ec[0], ec[1], ec[2], ec[3]);

                    const h = quantizeChannel(sHsv.h, eHsv.h, t, hStep, true);
                    const s = quantizeChannel(sHsv.s, eHsv.s, t, sStep, false);
                    const v = quantizeChannel(sHsv.v, eHsv.v, t, vStep, false);
                    const a = quantizeChannel(sHsv.a, eHsv.a, t, aStep, false);

                    const rgba = hsvToRgba(h, s, v, a);
                    changes.push({ x: tx, y: ty, color: this.rgbaToHex(rgba.r, rgba.g, rgba.b, rgba.a), blendType: 'replace' });
                }
            }

            return { anim: startSnap.anim, frame: frameValue ?? startSnap.frame, box: tb, hasSelection: true, data: null, changes };
        } catch (e) {
            console.warn('interpolate frame selection pixels failed', e);
            return null;
        }
    }

    _detectSelectionTransform(startSnap, endSnap) {
        try {
            if (!startSnap || !endSnap) return null;
            if (!startSnap.data || !endSnap.data) return null;
            const sb = startSnap.box || { minX: 0, minY: 0, w: startSnap.w, h: startSnap.h };
            const eb = endSnap.box || { minX: 0, minY: 0, w: endSnap.w, h: endSnap.h };
            const sw = sb.w|0, sh = sb.h|0, ew = eb.w|0, eh = eb.h|0;
            if (sw <= 0 || sh <= 0 || ew <= 0 || eh <= 0) return null;

            const startMask = startSnap.mask || null;
            const endMask = endSnap.mask || null;
            const sData = startSnap.data;
            const eData = endSnap.data;

            const candidates = [
                { kind: 'identity', angleRad: 0, flipX: false, flipY: false, swap: false },
                { kind: 'flipX', angleRad: 0, flipX: true, flipY: false, swap: false },
                { kind: 'flipY', angleRad: 0, flipX: false, flipY: true, swap: false },
                { kind: 'flipXY', angleRad: Math.PI, flipX: true, flipY: true, swap: false },
                { kind: 'rot90', angleRad: Math.PI / 2, flipX: false, flipY: false, swap: true },
                { kind: 'rot180', angleRad: Math.PI, flipX: false, flipY: false, swap: false },
                { kind: 'rot270', angleRad: Math.PI * 1.5, flipX: false, flipY: false, swap: true }
            ];

            const applyTransform = (x, y, kind) => {
                switch (kind) {
                    case 'flipX': return { x: sw - 1 - x, y };
                    case 'flipY': return { x, y: sh - 1 - y };
                    case 'flipXY': return { x: sw - 1 - x, y: sh - 1 - y };
                    case 'rot90': return { x: sh - 1 - y, y: x };
                    case 'rot180': return { x: sw - 1 - x, y: sh - 1 - y };
                    case 'rot270': return { x: y, y: sw - 1 - x };
                    default: return { x, y };
                }
            };

            let best = null;
            let identityScore = null;

            for (const cand of candidates) {
                const expectedW = cand.swap ? sh : sw;
                const expectedH = cand.swap ? sw : sh;
                if (expectedW !== ew || expectedH !== eh) continue;

                let totalDiff = 0;
                let count = 0;
                let failed = false;

                for (let y = 0; y < sh && !failed; y++) {
                    for (let x = 0; x < sw; x++) {
                        const si = y * sw + x;
                        const sm = startMask ? startMask[si] : null;
                        const sIdx = si * 4;
                        const sa = sData[sIdx + 3];
                        // only evaluate pixels that are in mask or visible
                        if (sm === 0 || (!startMask && sa === 0)) continue;

                        const tPos = applyTransform(x, y, cand.kind);
                        const tx = tPos.x|0, ty = tPos.y|0;
                        if (tx < 0 || ty < 0 || tx >= ew || ty >= eh) { failed = true; break; }
                        const ti = ty * ew + tx;
                        const tm = endMask ? endMask[ti] : null;
                        const tIdx = ti * 4;
                        const ta = eData[tIdx + 3];

                        // Ignore mapping into empty end pixels unless a mask demands presence.
                        if (endMask && tm === 0) { failed = true; break; }
                        if (!endMask && ta === 0) continue;

                        const dr = Math.abs(sData[sIdx] - eData[tIdx]);
                        const dg = Math.abs(sData[sIdx+1] - eData[tIdx+1]);
                        const db = Math.abs(sData[sIdx+2] - eData[tIdx+2]);
                        const da = Math.abs(sa - ta);
                        totalDiff += dr + dg + db + da;
                        count++;
                    }
                }

                if (failed || count === 0) continue;
                const avgDiff = totalDiff / count;
                if (cand.kind === 'identity') identityScore = avgDiff;
                if (!best || avgDiff < best.avgDiff) {
                    best = { ...cand, avgDiff };
                }
            }

            if (!best) return null;
            const margin = 0.7; // require at least 30% better than identity to switch
            if (best.kind !== 'identity' && identityScore !== null && best.avgDiff <= identityScore * margin) {
                return best;
            }
            if (best.kind === 'identity') return null;
            return best;
        } catch (e) {
            return null;
        }
    }

    _applyFrameKeyframeTrack(track) {
        try {
            if (!track || !track.frames) return;
            const frames = track.frames;
            const keys = Object.keys(frames).map(k => Number(k)).sort((a,b)=>a-b);
            for (const fr of keys) {
                const snap = frames[fr];
                if (snap && snap.changes && snap.changes.length) {
                    if (this.currentSprite) {
                        this.currentSprite.modifyFrame(snap.anim, fr, snap.changes);
                    }
                } else if (snap && snap.data) {
                    this._applyFrameSnapshot(snap);
                }
            }
        } catch (e) {
            console.warn('apply frame keyframe track failed', e);
        } finally {
            this._frameKeyframeStart = null;
            this._frameKeyframePrompt = null;
        }
    }

    _getShapeStrokeWidth() {
        return Math.max(1, Math.min(15, this.brushSize || 1));
    }

    _resolveAnimFrameForArea(areaIndex = null, fallbackAnim = null, fallbackFrame = null) {
        let anim = (fallbackAnim !== null && fallbackAnim !== undefined) ? fallbackAnim : this.selectedAnimation;
        let frameIdx = (fallbackFrame !== null && fallbackFrame !== undefined) ? Number(fallbackFrame) : Number(this.selectedFrame || 0);
        if (this.tilemode && Number.isFinite(Number(areaIndex))) {
            const binding = this.getAreaBinding(Number(areaIndex) | 0);
            if (binding && binding.anim !== undefined && binding.index !== undefined) {
                anim = binding.anim;
                frameIdx = Number(binding.index);
            }
        }
        return { anim, frameIdx };
    }

    _getShapeAnchorPoint(posInfo = null) {
        try {
            if (!Array.isArray(this.selectionPoints) || this.selectionPoints.length === 0) return null;
            const points = this.selectionPoints.filter(Boolean);
            if (points.length === 0) return null;

            // Default to latest point so chained shape placement stays intuitive.
            let fallback = points[points.length - 1] || points[0];
            if (!this.tilemode) return fallback;

            const pos = posInfo || this.getPos(this.mouse && this.mouse.pos);
            const hoveredArea = (pos && Number.isFinite(Number(pos.areaIndex))) ? (Number(pos.areaIndex) | 0) : null;
            if (hoveredArea === null) return fallback;

            // In tilemode, prefer the anchor from the currently hovered tile.
            let best = null;
            let bestDist = Infinity;
            const hx = Number(pos && pos.x);
            const hy = Number(pos && pos.y);
            for (const p of points) {
                const pa = Number.isFinite(Number(p.areaIndex)) ? (Number(p.areaIndex) | 0) : null;
                if (pa !== hoveredArea) continue;
                const dx = Number.isFinite(hx) ? (Number(p.x) - hx) : 0;
                const dy = Number.isFinite(hy) ? (Number(p.y) - hy) : 0;
                const dist = dx * dx + dy * dy;
                if (dist < bestDist) {
                    bestDist = dist;
                    best = p;
                }
            }
            return best || fallback;
        } catch (e) {
            return (Array.isArray(this.selectionPoints) && this.selectionPoints.length > 0)
                ? this.selectionPoints[this.selectionPoints.length - 1]
                : null;
        }
    }

    _hasEvenCircleAnchor() {
        try {
            if (!Array.isArray(this.selectionPoints) || this.selectionPoints.length !== 4) return false;
            const pts = this.selectionPoints.filter(Boolean);
            if (pts.length !== 4) return false;

            const area = (typeof pts[0].areaIndex === 'number') ? pts[0].areaIndex : null;
            for (const p of pts) {
                const pa = (typeof p.areaIndex === 'number') ? p.areaIndex : null;
                if (pa !== area) return false;
            }

            const xs = Array.from(new Set(pts.map(p => Number(p.x)))).sort((a, b) => a - b);
            const ys = Array.from(new Set(pts.map(p => Number(p.y)))).sort((a, b) => a - b);
            if (xs.length !== 2 || ys.length !== 2) return false;
            if (Math.abs(xs[1] - xs[0]) !== 1 || Math.abs(ys[1] - ys[0]) !== 1) return false;

            const keys = new Set(pts.map(p => `${p.x},${p.y}`));
            return (
                keys.has(`${xs[0]},${ys[0]}`) &&
                keys.has(`${xs[1]},${ys[0]}`) &&
                keys.has(`${xs[0]},${ys[1]}`) &&
                keys.has(`${xs[1]},${ys[1]}`)
            );
        } catch (e) {
            return false;
        }
    }

    _expandPixelsWithBrush(pixels, brushSize = 1) {
        const side = Math.max(1, Math.min(15, Number(brushSize) || 1));
        if (!Array.isArray(pixels) || pixels.length === 0) return [];
        if (side <= 1) {
            const seenBase = new Set();
            const outBase = [];
            for (const p of pixels) {
                if (!p) continue;
                const x = Math.round(p.x);
                const y = Math.round(p.y);
                const key = `${x},${y}`;
                if (seenBase.has(key)) continue;
                seenBase.add(key);
                outBase.push({ x, y });
            }
            return outBase;
        }

        const half = Math.floor((side - 1) / 2);
        const seen = new Set();
        const expanded = [];
        for (const p of pixels) {
            if (!p) continue;
            const bx = Math.round(p.x);
            const by = Math.round(p.y);
            for (let oy = 0; oy < side; oy++) {
                for (let ox = 0; ox < side; ox++) {
                    const x = bx + ox - half;
                    const y = by + oy - half;
                    const key = `${x},${y}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    expanded.push({ x, y });
                }
            }
        }
        return expanded;
    }

    _nowMs() {
        try {
            if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
        } catch (e) {}
        return Date.now();
    }

    _setCurrentShapeTool(toolName) {
        if (!toolName) return;
        if (this.stateController) this.stateController.setCurrentTool(toolName);
        else this.currentTool = toolName;
    }

    _handleLineCircleSpiralShortcut() {
        const now = this._nowMs();
        const windowMs = 200;
        const lPressed = !!(this.keys && typeof this.keys.pressed === 'function' && this.keys.pressed('l'));
        const oPressed = !!(this.keys && typeof this.keys.pressed === 'function' && this.keys.pressed('o'));
        const bPressed = !!(this.keys && typeof this.keys.pressed === 'function' && this.keys.pressed('b'));

        if (lPressed && oPressed) {
            this._shapeComboPending = null;
            this._setCurrentShapeTool('spiral');
            return;
        }
        if (lPressed && bPressed) {
            this._shapeComboPending = null;
            this._setCurrentShapeTool('boxSpiral');
            return;
        }

        const handlePress = (key) => {
            const pending = this._shapeComboPending;
            if (pending && pending.key !== key && (now - pending.timeMs) <= windowMs) {
                this._shapeComboPending = null;
                const pair = [pending.key, key].sort().join('+');
                if (pair === 'l+o') this._setCurrentShapeTool('spiral');
                else if (pair === 'b+l') this._setCurrentShapeTool('boxSpiral');
                else this._setCurrentShapeTool(key === 'b' ? 'box' : (key === 'o' ? 'circle' : 'line'));
                return true;
            }
            this._shapeComboPending = { key, timeMs: now };
            return false;
        };

        if (lPressed) handlePress('l');
        if (oPressed) handlePress('o');
        if (bPressed) handlePress('b');

        const pending = this._shapeComboPending;
        if (pending && (now - pending.timeMs) > windowMs) {
            if (pending.key === 'l') this._setCurrentShapeTool('line');
            else if (pending.key === 'o') this._setCurrentShapeTool('circle');
            else if (pending.key === 'b') this._setCurrentShapeTool('box');
            this._shapeComboPending = null;
        }
    }

    // Generate list of pixel coordinates for a Bresenham line between start and end
    computeLinePixels(start, end, strokeWidth = 1) {
        const basePixels = [];
        let x0 = start.x;
        let y0 = start.y;
        let x1 = end.x;
        let y1 = end.y;
        let dx = Math.abs(x1 - x0);
        let dy = Math.abs(y1 - y0);
        let sx = (x0 < x1) ? 1 : -1;
        let sy = (y0 < y1) ? 1 : -1;
        let err = dx - dy;

        while (true) {
            basePixels.push({ x: x0, y: y0 });
            if ((x0 === x1) && (y0 === y1)) break;
            let e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x0 += sx; }
            if (e2 < dx) { err += dx; y0 += sy; }
        }
        return this._expandPixelsWithBrush(basePixels, strokeWidth);
    }

    // Generate an Archimedean spiral path using polar form r = a * theta.
    // `start` is center; `end` provides radius/direction hint.
    computeSpiralPixels(start, end, strokeWidth = 1) {
        const base = [];
        if (!start || !end) return base;

        const cx = Number(start.x);
        const cy = Number(start.y);
        const dx = Number(end.x) - cx;
        const dy = Number(end.y) - cy;
        const targetRadius = Math.max(0, Math.hypot(dx, dy));

        if (targetRadius <= 0) {
            return this._expandPixelsWithBrush([{ x: Math.round(cx), y: Math.round(cy) }], strokeWidth);
        }

        const twoPi = Math.PI * 2;
        const targetAngle = ((Math.atan2(dy, dx) % twoPi) + twoPi) % twoPi;
        // End on the target direction after at least one full turn.
        const thetaMax = targetAngle + twoPi;
        const a = targetRadius / Math.max(thetaMax, 1e-6);

        const seen = new Set();
        const add = (x, y) => {
            const ix = Math.round(x);
            const iy = Math.round(y);
            const key = `${ix},${iy}`;
            if (seen.has(key)) return;
            seen.add(key);
            base.push({ x: ix, y: iy });
        };

        let prev = { x: Math.round(cx), y: Math.round(cy) };
        add(prev.x, prev.y);

        const samplesPerRad = 24;
        const steps = Math.max(24, Math.ceil(thetaMax * samplesPerRad));
        for (let i = 1; i <= steps; i++) {
            const t = (i / steps) * thetaMax;
            const r = a * t;
            const x = cx + r * Math.cos(t);
            const y = cy + r * Math.sin(t);
            const curr = { x: Math.round(x), y: Math.round(y) };
            const seg = this.computeLinePixels(prev, curr, 1) || [];
            for (const p of seg) add(p.x, p.y);
            prev = curr;
        }

        return this._expandPixelsWithBrush(base, strokeWidth);
    }

    // Generate a square/box spiral path with 90-degree turns.
    computeBoxSpiralPixels(start, end, strokeWidth = 1) {
        const base = [];
        if (!start || !end) return base;
        const cx = Math.round(start.x);
        const cy = Math.round(start.y);
        const tx = Math.round(end.x);
        const ty = Math.round(end.y);
        const maxRadius = Math.max(0, Math.max(Math.abs(tx - cx), Math.abs(ty - cy)));
        if (maxRadius <= 0) return this._expandPixelsWithBrush([{ x: cx, y: cy }], strokeWidth);

        const seen = new Set();
        const add = (x, y) => {
            const key = `${x},${y}`;
            if (seen.has(key)) return;
            seen.add(key);
            base.push({ x, y });
        };

        // Exact sequence requested: 3,3,5,5,7,7... turning 90 degrees each segment.
        // Segment length includes the current point, so movement is (len - 1) steps.
        let dirIndex = 0; // start right
        const dirs = [
            { x: 1, y: 0 },
            { x: 0, y: 1 },
            { x: -1, y: 0 },
            { x: 0, y: -1 }
        ];

        let x = cx;
        let y = cy;
        add(x, y);

        let oddLen = 3;
        let shouldStop = false;
        const safeGuardMaxSegments = Math.max(16, maxRadius * 8);
        let segCount = 0;

        while (!shouldStop && segCount < safeGuardMaxSegments) {
            for (let rep = 0; rep < 2 && !shouldStop; rep++) {
                const dir = dirs[dirIndex];
                const moveSteps = Math.max(1, oddLen - 1);
                for (let s = 0; s < moveSteps; s++) {
                    x += dir.x;
                    y += dir.y;
                    add(x, y);
                    const r = Math.max(Math.abs(x - cx), Math.abs(y - cy));
                    if (r >= maxRadius) {
                        shouldStop = true;
                        break;
                    }
                }
                dirIndex = (dirIndex + 1) % 4;
                segCount++;
            }
            oddLen += 2;
        }

        return this._expandPixelsWithBrush(base, strokeWidth);
    }

    // Check whether a pixel at (x,y) should be masked by explicit selectionPoints.
    // If selectionPoints include an entry with matching x,y and matching areaIndex (or null), this returns true.
    isPixelMasked(x, y, targetAreaIndex = null) {
        try {
            if (!this.selectionPoints || this.selectionPoints.length === 0) return false;
            for (const p of this.selectionPoints) {
                if (!p) continue;
                if (p.x === x && p.y === y) {
                    // p.areaIndex may be undefined/null or a number. Treat undefined as null.
                    const pa = (typeof p.areaIndex === 'number') ? p.areaIndex : null;
                    const ta = (typeof targetAreaIndex === 'number') ? targetAreaIndex : null;
                    // If pa is null (e.g. selection created by a debug signal
                    // without area info), treat it as a global mask that
                    // applies to all areas. Otherwise require an exact area
                    // match so per-area selections still behave as before.
                    if (pa === null || pa === ta) return true;
                }
            }
        } catch (e) {}
        return false;
    }

    // Generate list of pixel coordinates for a box between start and end.
    // If filled is true, returns all pixels inside the rectangle, otherwise only the border.
    computeBoxPixels(start, end, filled, strokeWidth = 1) {
        const pixels = [];
        const minX = Math.min(start.x, end.x);
        const minY = Math.min(start.y, end.y);
        const maxX = Math.max(start.x, end.x);
        const maxY = Math.max(start.y, end.y);

        if (filled) {
            for (let y = minY; y <= maxY; y++) {
                for (let x = minX; x <= maxX; x++) {
                    pixels.push({ x, y });
                }
            }
        } else {
            for (let x = minX; x <= maxX; x++) {
                pixels.push({ x, y: minY });
                if (maxY !== minY) pixels.push({ x, y: maxY });
            }
            for (let y = minY + 1; y < maxY; y++) {
                pixels.push({ x: minX, y });
                if (maxX !== minX) pixels.push({ x: maxX, y });
            }
        }
        if (filled) return pixels;
        return this._expandPixelsWithBrush(pixels, strokeWidth);
    }

    // Generate list of pixel coordinates for a circle between start and end.
    // `start` is treated as the center; `end` defines the radius. If `filled`
    // is true, returns all pixels inside the circle **and** its border;
    // otherwise only the border.
    //
    // When selectionPoints form an exact 2x2 block, we treat those
    // 4 pixels as a center block and use their averaged center (e.g. 1.5,6.5)
    // to produce an even-centered circle.
    computeCirclePixels(start, end, filled, strokeWidth = 1) {
        const pixels = [];
        if (!start || !end) return pixels;

        // Default center from the provided start point.
        let cx = start.x;
        let cy = start.y;

        // Even-centered mode: if the user has selected an exact 2x2 block,
        // use the average of those pixels as the circle
        // center so the circle is centered between pixels instead of on one.
        try {
            if (this && typeof this._hasEvenCircleAnchor === 'function' && this._hasEvenCircleAnchor()) {
                let sumX = 0, sumY = 0;
                for (const p of this.selectionPoints) {
                    if (!p) continue;
                    sumX += p.x;
                    sumY += p.y;
                }
                cx = sumX / 4;
                cy = sumY / 4;
            }
        } catch (e) { /* fall back to integer center on error */ }
        const dx = end.x - cx;
        const dy = end.y - cy;
        const r = Math.max(0, Math.round(Math.sqrt(dx * dx + dy * dy)));
        if (r === 0) {
            return this._expandPixelsWithBrush([{ x: Math.round(cx), y: Math.round(cy) }], strokeWidth);
        }

        const innerR = Math.max(0, r - 0.5);
        const outerR = r + 0.5;
        const innerR2 = innerR * innerR;
        const outerR2 = outerR * outerR;

        // track pixels to avoid duplicates when combining fill + outline
        const seen = new Set();
        const addPixel = (x, y) => {
            const key = x + ',' + y;
            if (!seen.has(key)) {
                seen.add(key);
                pixels.push({ x, y });
            }
        };

        // Scan a bounding box around the circle and select pixels whose
        // distance from center is near the radius (border) or inside (filled).
        const minX = Math.floor(cx - outerR);
        const maxX = Math.ceil(cx + outerR);
        const minY = Math.floor(cy - outerR);
        const maxY = Math.ceil(cy + outerR);

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const ddx = x - cx;
                const ddy = y - cy;
                const dist2 = ddx * ddx + ddy * ddy;

                if (!filled) {
                    if (dist2 >= innerR2 && dist2 <= outerR2) {
                        addPixel(x, y);
                    }
                } else {
                    if (dist2 <= outerR2) {
                        addPixel(x, y);
                    }
                }
            }
        }
        if (filled) return pixels;
        return this._expandPixelsWithBrush(pixels, strokeWidth);
    }

    _selectionPointToWorld(pt) {
        try {
            if (!pt) return null;
            const sheet = this.currentSprite;
            const slice = (sheet && sheet.slicePx) ? sheet.slicePx : 1;
            let col = 0, row = 0;
            if (this.tilemode && typeof pt.areaIndex === 'number' && Array.isArray(this._tileIndexToCoord)) {
                const cr = this._tileIndexToCoord[pt.areaIndex];
                if (cr) { col = cr.col|0; row = cr.row|0; }
            }
            const wx = col * slice + pt.x;
            const wy = row * slice + pt.y;
            return { x: wx, y: wy, col, row };
        } catch (e) { return null; }
    }

    _unclampedPixelForArea(areaIndex = null, screenPos = null) {
        try {
            if (!this.currentSprite) return null;
            const mp = screenPos || (this.mouse && this.mouse.pos);
            if (!mp) return null;
            const slice = this.currentSprite.slicePx || 1;
            let col = 0, row = 0;
            if (this.tilemode && typeof areaIndex === 'number' && Array.isArray(this._tileIndexToCoord)) {
                const cr = this._tileIndexToCoord[areaIndex];
                if (cr) { col = cr.col|0; row = cr.row|0; }
            }
            const worldX = mp.x / this.zoom.x - this.offset.x;
            const worldY = mp.y / this.zoom.y - this.offset.y;
            const localX = Math.round(worldX - col * slice);
            const localY = Math.round(worldY - row * slice);
            return { x: localX, y: localY, areaIndex };
        } catch (e) { return null; }
    }

    _worldPixelToTile(wx, wy, sliceSize = 1) {
        try {
            if (!Number.isFinite(wx) || !Number.isFinite(wy)) return null;
            const slice = Math.max(1, Math.floor(sliceSize || 1));
            const col = Math.floor(wx / slice);
            const row = Math.floor(wy / slice);
            const mod = (v, m) => {
                const r = v % m;
                return r < 0 ? r + m : r;
            };
            const localX = mod(Math.round(wx), slice);
            const localY = mod(Math.round(wy), slice);
            const areaIndex = (typeof this._getAreaIndexForCoord === 'function') ? this._getAreaIndexForCoord(col, row) : null;
            return { col, row, localX, localY, areaIndex };
        } catch (e) { return null; }
    }

    _paintWorldPixels(worldPixels, color, options = null) {
        try {
            const sheet = this.currentSprite;
            if (!sheet || !worldPixels || worldPixels.length === 0) return;
            const slice = (sheet.slicePx) ? sheet.slicePx : 1;
            const dedupe = !(options && options.dedupe === false);
            const seen = dedupe ? (this._worldPixelDedupSet || (this._worldPixelDedupSet = new Set())) : null;
            if (seen) seen.clear();
            const bindingCache = this._paintBindingCache || (this._paintBindingCache = new Map());
            bindingCache.clear();
            const mod = (v, m) => {
                const r = v % m;
                return r < 0 ? r + m : r;
            };
            for (const wp of worldPixels) {
                if (!wp) continue;
                const wx = Number(wp.x) | 0;
                const wy = Number(wp.y) | 0;
                if (seen) {
                    const key = `${wx},${wy}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                }

                // In non-tile mode, drop pixels that fall outside the single frame instead of clamping.
                if (!this.tilemode) {
                    if (wx < 0 || wy < 0 || wx >= slice || wy >= slice) continue;
                }

                let localX = wx;
                let localY = wy;
                let areaIndex = null;
                if (this.tilemode) {
                    const col = Math.floor(wx / slice);
                    const row = Math.floor(wy / slice);
                    if (!this._isTileActive(col, row)) continue;
                    localX = mod(wx, slice);
                    localY = mod(wy, slice);
                    areaIndex = (typeof this._getAreaIndexForCoord === 'function') ? this._getAreaIndexForCoord(col, row) : null;
                }

                let anim = this.selectedAnimation;
                let frameIdx = this.selectedFrame;
                if (typeof areaIndex === 'number') {
                    let binding = bindingCache.get(areaIndex);
                    if (binding === undefined) {
                        binding = this.getAreaBinding(areaIndex) || null;
                        bindingCache.set(areaIndex, binding);
                    }
                    if (binding && binding.anim !== undefined && binding.index !== undefined) {
                        anim = binding.anim;
                        frameIdx = Number(binding.index);
                    }
                }

                if (this.maskShapesWithSelection && this.isPixelMasked(localX, localY, areaIndex)) continue;

                // If pixel-perfect mode is active, route single-pixel writes through
                // the pixel-perfect handler so strokes can restore L-bend pixels.
                if (this.pixelPerfect) {
                    try {
                        this._applyPixelPerfectPixel(sheet, anim, frameIdx, localX, localY, color, areaIndex);
                    } catch (e) { /* ignore pixel-perfect write errors */ }
                } else if (typeof sheet.setPixel === 'function') {
                    try { sheet.setPixel(anim, frameIdx, localX, localY, color, 'replace'); } catch (e) { /* ignore per-pixel errors */ }
                } else if (typeof sheet.modifyFrame === 'function') {
                    try { sheet.modifyFrame(anim, frameIdx, { x: localX, y: localY, color, blendType: 'replace' }); } catch (e) { /* ignore per-pixel errors */ }
                }
            }

            if (typeof sheet._rebuildSheetCanvas === 'function') {
                try { sheet._rebuildSheetCanvas(); } catch (e) { /* ignore */ }
            }
        } catch (e) {
            console.warn('_paintWorldPixels failed', e);
        }
    }

    _computePolygonPixelsWorld(worldVerts, filled) {
        if (!Array.isArray(worldVerts) || worldVerts.length < 3) return [];
        const verts = worldVerts.filter(Boolean);
        if (verts.length < 3) return [];
        const pixels = [];
        const seen = new Set();
        const addPixel = (x, y) => {
            const key = `${x|0},${y|0}`;
            if (!seen.has(key)) {
                seen.add(key);
                pixels.push({ x: x|0, y: y|0 });
            }
        };

        // Always include outline via edge lines
        for (let i = 0; i < verts.length; i++) {
            const a = verts[i];
            const b = verts[(i + 1) % verts.length];
            if (!a || !b) continue;
            const line = this.computeLinePixels({ x: Math.round(a.x), y: Math.round(a.y) }, { x: Math.round(b.x), y: Math.round(b.y) }) || [];
            for (const p of line) addPixel(p.x, p.y);
        }

        if (!filled) return pixels;

        // Scanline fill using edge intersections at pixel centers (y + 0.5)
        let minY = Infinity, maxY = -Infinity;
        for (const v of verts) { if (!v) continue; if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y; }
        const yStart = Math.floor(minY);
        const yEnd = Math.ceil(maxY);

        for (let y = yStart; y <= yEnd; y++) {
            const yc = y + 0.5;
            const xs = [];
            for (let i = 0; i < verts.length; i++) {
                const a = verts[i];
                const b = verts[(i + 1) % verts.length];
                if (!a || !b) continue;
                if ((a.y <= yc && b.y > yc) || (b.y <= yc && a.y > yc)) {
                    const t = (yc - a.y) / (b.y - a.y);
                    const x = a.x + t * (b.x - a.x);
                    xs.push(x);
                }
            }
            xs.sort((a, b) => a - b);
            for (let i = 0; i + 1 < xs.length; i += 2) {
                const x0 = xs[i];
                const x1 = xs[i + 1];
                const startX = Math.ceil(Math.min(x0, x1) - 0.5);
                const endX = Math.floor(Math.max(x0, x1) - 0.5);
                for (let x = startX; x <= endX; x++) addPixel(x, y);
            }
        }
        return pixels;
    }

    // Commit the selection pixels into the current sprite/frame using sheet API.
    commitSelection(start, end) {
        try {
            if (!this.currentSprite) return;
            const tool = this.currentTool;
            if (!tool) return;

            const filled = this.keys.held('Alt');
            const strokeWidth = this._getShapeStrokeWidth();
            let pixels = [];
            if (tool === 'line') {
                pixels = this.computeLinePixels(start, end, strokeWidth);
            } else if (tool === 'box') {
                pixels = this.computeBoxPixels(start, end, filled, strokeWidth);
            } else if (tool === 'circle' && typeof this.computeCirclePixels === 'function') {
                pixels = this.computeCirclePixels(start, end, filled, strokeWidth);
            } else if (tool === 'spiral' && typeof this.computeSpiralPixels === 'function') {
                pixels = this.computeSpiralPixels(start, end, strokeWidth);
            } else if (tool === 'boxSpiral' && typeof this.computeBoxSpiralPixels === 'function') {
                pixels = this.computeBoxSpiralPixels(start, end, strokeWidth);
            }

            if (!pixels || pixels.length === 0) return;

            const sheet = this.currentSprite;
            const color = this.penColor || '#000000';
            const slice = (sheet && sheet.slicePx) ? sheet.slicePx : 1;

            // Base tile for the originating anchor so we can map pixels into world coords
            let baseCol = 0, baseRow = 0;
            if (this.tilemode && start && typeof start.areaIndex === 'number' && Array.isArray(this._tileIndexToCoord)) {
                const cr = this._tileIndexToCoord[start.areaIndex];
                if (cr) { baseCol = cr.col|0; baseRow = cr.row|0; }
            }

            const worldPixels = [];
            for (const p of pixels) {
                if (!p) continue;
                const wx = baseCol * slice + p.x;
                const wy = baseRow * slice + p.y;
                worldPixels.push({ x: wx, y: wy });
            }

            this._paintWorldPixels(worldPixels, color);
        } catch (e) {
            console.warn('commitSelection failed', e);
        }
    }

    _commitPolygonFromSelection() {
        try {
            if (!this.currentSprite) return;
            if (!this.selectionPoints || this.selectionPoints.length < 2) return;
            const filled = !!(this.keys && this.keys.held && this.keys.held('Alt'));
            const color = this.penColor || '#000000';
            const verts = this.selectionPoints.map(p => this._selectionPointToWorld(p)).filter(v => v && Number.isFinite(v.x) && Number.isFinite(v.y));
            if (verts.length < 2) return;

            let worldPixels = [];
            if (verts.length === 2) {
                const a = verts[0];
                const b = verts[1];
                worldPixels = this.computeLinePixels({ x: Math.round(a.x), y: Math.round(a.y) }, { x: Math.round(b.x), y: Math.round(b.y) }) || [];
            } else {
                worldPixels = this._computePolygonPixelsWorld(verts, filled);
            }
            this._paintWorldPixels(worldPixels, color);
            // keep selection points so user can continue editing; exit polygon tool
            if (this.stateController) {
                this.stateController.clearSelectionRegion();
                this.stateController.clearCurrentTool();
            } else {
                this.selectionRegion = null;
                this.currentTool = null;
            }
        } catch (e) {
            console.warn('_commitPolygonFromSelection failed', e);
        }
    }

    _selectPolygonFromSelection() {
        try {
            if (!this.currentSprite) return;
            if (!this.selectionPoints || this.selectionPoints.length < 2) return;
            const filled = !!(this.keys && this.keys.held && this.keys.held('Alt'));
            const verts = this.selectionPoints.map(p => this._selectionPointToWorld(p)).filter(v => v && Number.isFinite(v.x) && Number.isFinite(v.y));
            if (verts.length < 2) return;

            let worldPixels = [];
            if (verts.length === 2) {
                const a = verts[0];
                const b = verts[1];
                worldPixels = this.computeLinePixels({ x: Math.round(a.x), y: Math.round(a.y) }, { x: Math.round(b.x), y: Math.round(b.y) }) || [];
            } else {
                worldPixels = this._computePolygonPixelsWorld(verts, filled);
            }

            const sheet = this.currentSprite;
            const slice = (sheet && sheet.slicePx) ? sheet.slicePx : 1;
            const seen = new Set();
            const nextSel = [];
            for (const wp of worldPixels) {
                if (!wp) continue;
                const key = `${wp.x|0},${wp.y|0}`;
                if (seen.has(key)) continue;
                seen.add(key);

                if (!this.tilemode) {
                    if (wp.x < 0 || wp.y < 0 || wp.x >= slice || wp.y >= slice) continue;
                }

                const target = this._worldPixelToTile(wp.x, wp.y, slice);
                if (!target) continue;
                if (this.tilemode && !this._isTileActive(target.col, target.row)) continue;
                const areaIndex = this.tilemode ? target.areaIndex : null;

                nextSel.push({ x: target.localX, y: target.localY, areaIndex });
            }

            if (this.stateController) {
                this.stateController.setSelectionPoints(nextSel);
                this.stateController.clearSelectionRegion();
                this.stateController.clearCurrentTool();
            } else {
                this.selectionPoints = nextSel;
                this.selectionRegion = null;
                this.currentTool = null;
            }
        } catch (e) {
            console.warn('_selectPolygonFromSelection failed', e);
        }
    }

    // Expand selection by one pixel in the 4 cardinal directions per-area.
    _growSelection() {
        try {
            const sheet = this.currentSprite;
            if (!sheet) return;
            const slice = (sheet && sheet.slicePx) ? sheet.slicePx : 1;

            // Build initial points list from explicit points or region fallback
            let pts = (this.selectionPoints && this.selectionPoints.length > 0) ? this.selectionPoints.slice() : [];
            if ((!pts || pts.length === 0) && this.selectionRegion) {
                pts = this._snapshotToPoints({ type: 'region', start: this.selectionRegion.start, end: this.selectionRegion.end, areaIndex: (typeof this.selectionRegion.areaIndex === 'number') ? this.selectionRegion.areaIndex : null });
            }
            if (!pts || pts.length === 0) return;

            // Determine target area indices to operate on.
            const areaSet = new Set();
            const anyGlobal = pts.some(p => p.areaIndex === null || p.areaIndex === undefined);
            if (this.tilemode) {
                if (anyGlobal) {
                    for (let i = 0; Array.isArray(this._tileIndexToCoord) && i < this._tileIndexToCoord.length; i++) {
                        if (this._isTileActive && !this._isTileActive(this._tileIndexToCoord[i].col, this._tileIndexToCoord[i].row)) continue;
                        areaSet.add(i);
                    }
                } else {
                    for (const p of pts) if (typeof p.areaIndex === 'number') areaSet.add(p.areaIndex);
                }
            } else {
                areaSet.add(null);
            }

            const nextSel = [];
            const seen = new Set();

            for (const areaIdx of Array.from(areaSet)) {
                // Build mask for this area
                const w = slice, h = slice;
                const n = w * h;
                const mask = new Uint8Array(n);
                for (const p of pts) {
                    const pa = (typeof p.areaIndex === 'number') ? p.areaIndex : null;
                    if (pa !== null && areaIdx !== null && pa !== areaIdx) continue;
                    if (pa === null && this.tilemode && areaIdx === null) continue; // skip invalid
                    const x = p.x|0; const y = p.y|0;
                    if (x < 0 || y < 0 || x >= w || y >= h) continue;
                    mask[y * w + x] = 1;
                }

                // Expand by neighbors into out. Use 8-way when Shift held.
                const useDiagonals = !!(this.keys && this.keys.held && this.keys.held('Shift'));
                const out = new Uint8Array(n);
                for (let y = 0; y < h; y++) {
                    for (let x = 0; x < w; x++) {
                        const i = y * w + x;
                        if (mask[i]) {
                            out[i] = 1;
                            if (x > 0) out[i - 1] = 1;
                            if (x < w - 1) out[i + 1] = 1;
                            if (y > 0) out[i - w] = 1;
                            if (y < h - 1) out[i + w] = 1;
                            if (useDiagonals) {
                                if (x > 0 && y > 0) out[i - w - 1] = 1;
                                if (x < w - 1 && y > 0) out[i - w + 1] = 1;
                                if (x > 0 && y < h - 1) out[i + w - 1] = 1;
                                if (x < w - 1 && y < h - 1) out[i + w + 1] = 1;
                            }
                        }
                    }
                }

                for (let y = 0; y < h; y++) {
                    for (let x = 0; x < w; x++) {
                        const i = y * w + x;
                        if (!out[i]) continue;
                        const key = `${areaIdx === null ? 'null' : areaIdx}:${x},${y}`;
                        if (seen.has(key)) continue;
                        seen.add(key);
                        nextSel.push({ x, y, areaIndex: (typeof areaIdx === 'number') ? areaIdx : null });
                    }
                }
            }

            if (this.stateController) {
                this.stateController.setSelectionPoints(nextSel);
                this.stateController.clearSelectionRegion();
            } else {
                this.selectionPoints = nextSel;
                this.selectionRegion = null;
            }
        } catch (e) {
            console.warn('_growSelection failed', e);
        }
    }

    // Contract selection by removing pixels at the outer boundary (4-direction erosion).
    _shrinkSelection() {
        try {
            const sheet = this.currentSprite;
            if (!sheet) return;
            const slice = (sheet && sheet.slicePx) ? sheet.slicePx : 1;

            let pts = (this.selectionPoints && this.selectionPoints.length > 0) ? this.selectionPoints.slice() : [];
            if ((!pts || pts.length === 0) && this.selectionRegion) {
                pts = this._snapshotToPoints({ type: 'region', start: this.selectionRegion.start, end: this.selectionRegion.end, areaIndex: (typeof this.selectionRegion.areaIndex === 'number') ? this.selectionRegion.areaIndex : null });
            }
            if (!pts || pts.length === 0) return;

            const areaSet = new Set();
            const anyGlobal = pts.some(p => p.areaIndex === null || p.areaIndex === undefined);
            if (this.tilemode) {
                if (anyGlobal) {
                    for (let i = 0; Array.isArray(this._tileIndexToCoord) && i < this._tileIndexToCoord.length; i++) {
                        if (this._isTileActive && !this._isTileActive(this._tileIndexToCoord[i].col, this._tileIndexToCoord[i].row)) continue;
                        areaSet.add(i);
                    }
                } else {
                    for (const p of pts) if (typeof p.areaIndex === 'number') areaSet.add(p.areaIndex);
                }
            } else {
                areaSet.add(null);
            }

            const nextSel = [];
            const seen = new Set();

            for (const areaIdx of Array.from(areaSet)) {
                const w = slice, h = slice;
                const n = w * h;
                const mask = new Uint8Array(n);
                for (const p of pts) {
                    const pa = (typeof p.areaIndex === 'number') ? p.areaIndex : null;
                    if (pa !== null && areaIdx !== null && pa !== areaIdx) continue;
                    const x = p.x|0; const y = p.y|0;
                    if (x < 0 || y < 0 || x >= w || y >= h) continue;
                    mask[y * w + x] = 1;
                }

                const out = new Uint8Array(n);
                const useDiagonals = !!(this.keys && this.keys.held && this.keys.held('Shift'));
                for (let y = 0; y < h; y++) {
                    for (let x = 0; x < w; x++) {
                        const i = y * w + x;
                        if (!mask[i]) continue;
                        // For shrink, require neighbors in cardinal directions;
                        // if Shift held, require all 8 neighbors to be present.
                        const left = (x > 0) ? mask[i - 1] : 0;
                        const right = (x < w - 1) ? mask[i + 1] : 0;
                        const up = (y > 0) ? mask[i - w] : 0;
                        const down = (y < h - 1) ? mask[i + w] : 0;
                        if (useDiagonals) {
                            const ul = (x > 0 && y > 0) ? mask[i - w - 1] : 0;
                            const ur = (x < w - 1 && y > 0) ? mask[i - w + 1] : 0;
                            const dl = (x > 0 && y < h - 1) ? mask[i + w - 1] : 0;
                            const dr = (x < w - 1 && y < h - 1) ? mask[i + w + 1] : 0;
                            if (left && right && up && down && ul && ur && dl && dr) out[i] = 1;
                        } else {
                            if (left && right && up && down) out[i] = 1;
                        }
                    }
                }

                for (let y = 0; y < h; y++) {
                    for (let x = 0; x < w; x++) {
                        const i = y * w + x;
                        if (!out[i]) continue;
                        const key = `${areaIdx === null ? 'null' : areaIdx}:${x},${y}`;
                        if (seen.has(key)) continue;
                        seen.add(key);
                        nextSel.push({ x, y, areaIndex: (typeof areaIdx === 'number') ? areaIdx : null });
                    }
                }
            }

            if (this.stateController) {
                this.stateController.setSelectionPoints(nextSel);
                this.stateController.clearSelectionRegion();
            } else {
                this.selectionPoints = nextSel;
                this.selectionRegion = null;
            }
        } catch (e) {
            console.warn('_shrinkSelection failed', e);
        }
    }

    // Convert RGBA components (0-255) to 8-digit hex '#RRGGBBAA'
    rgbaToHex(r, g, b, a) {
        const toHex = (v) => (v < 16 ? '0' : '') + v.toString(16).toUpperCase();
        return '#' + toHex(r) + toHex(g) + toHex(b) + toHex(a);
    }

    // Resize the current sprite sheet's slice size.
    // sliceSize: new tile size in pixels (integer > 0)
    // resizeContent: if true, scale existing frame content to the new size;
    // if false, copy content into top-left of new canvas (no scaling)
    resize(sliceSize, resizeContent = true) {
        try {
            sliceSize = Math.max(1, Math.floor(Number(sliceSize) || 0));
            if (!sliceSize) return false;
            const sheet = this.currentSprite;
            if (!sheet) return false;
            const oldSize = sheet.slicePx || 0;
            if (oldSize === sliceSize) return true; // nothing to do

            // Ensure all frames are materialized (lazy descriptors -> canvases)
            try {
                if (sheet._frames && typeof sheet._materializeFrame === 'function') {
                    for (const anim of Array.from(sheet._frames.keys())) {
                        const arr = sheet._frames.get(anim) || [];
                        for (let i = 0; i < arr.length; i++) {
                            const entry = arr[i];
                            if (entry && entry.__lazy === true) {
                                try { sheet._materializeFrame(anim, i); } catch (e) { /* ignore per-frame materialize errors */ }
                            }
                        }
                    }
                }
            } catch (e) { /* ignore materialize errors */ }

            // Resize each frame canvas
            try {
                for (const anim of Array.from(sheet._frames.keys())) {
                    const arr = sheet._frames.get(anim) || [];
                    for (let i = 0; i < arr.length; i++) {
                        const old = arr[i];
                        if (!old) continue;
                        // If entry is still a descriptor, skip (should be materialized above)
                        if (old.__lazy === true) continue;
                        const oldW = old.width || oldSize || 1;
                        const oldH = old.height || oldSize || 1;
                        const nc = document.createElement('canvas');
                        nc.width = sliceSize; nc.height = sliceSize;
                        const ctx = nc.getContext('2d');
                        try {
                            ctx.clearRect(0, 0, sliceSize, sliceSize);
                            // Use nearest-neighbor (no smoothing) for pixel art
                            try { ctx.imageSmoothingEnabled = false; } catch (e) {}
                            if (resizeContent) {
                                try { ctx.drawImage(old, 0, 0, oldW, oldH, 0, 0, sliceSize, sliceSize); } catch (e) { /* ignore draw errors */ }
                            } else {
                                try { ctx.drawImage(old, 0, 0); } catch (e) { /* ignore draw errors */ }
                            }
                        } catch (e) { /* ignore per-frame ops */ }
                        arr[i] = nc;
                    }
                }
            } catch (e) { /* ignore frame-level failures */ }

            // Update slice size and rebuild packed sheet
            try { sheet.slicePx = sliceSize; } catch (e) {}
            try { if (typeof sheet._rebuildSheetCanvas === 'function') sheet._rebuildSheetCanvas(); } catch (e) { /* ignore */ }

            // Notify FrameSelect to refresh if present
            try { if (this.FrameSelect && typeof this.FrameSelect.rebuild === 'function') this.FrameSelect.rebuild(); } catch (e) {}

            return true;
        } catch (e) {
            console.warn('resize failed', e);
            return false;
        }
    }

        // Save current sprite sheet image and metadata into the Saver instance.
        // name (optional): name/key to use for storage; defaults to current sprite name.
        doSave(name) {
            try {
                if (!this.saver) return false;
                const sprite = this.currentSprite || (this.scene && this.scene.currentSprite) || null;
                const keyName = name || (sprite && sprite.name) || 'spritesheet';

                // Ensure packed sheet is up-to-date
                try { if (sprite && typeof sprite._rebuildSheetCanvas === 'function') sprite._rebuildSheetCanvas(); } catch (e) {}

                const sheetCanvas = sprite && (sprite.sheet || sprite._sheet || null);
                if (!sheetCanvas || !sheetCanvas.toDataURL) {
                    // Nothing to save
                    return false;
                }

                // Convert packed canvas to dataURL and save
                let dataUrl = null;
                try { dataUrl = sheetCanvas.toDataURL('image/png'); } catch (e) { try { dataUrl = sheetCanvas.toDataURL(); } catch (ee) { dataUrl = null; } }
                if (dataUrl && typeof this.saver.setImage === 'function') {
                    try { this.saver.setImage('sprites/' + keyName + '/packed', dataUrl); } catch (e) { /* ignore save errors */ }
                }

                // Save each frame individually (animation -> frame index). This allows restoring
                // editable frame canvases on reload. We store under `sprites/<name>/frames/<anim>/<idx>`.
                try {
                    if (sprite && sprite._frames && typeof sprite._frames.entries === 'function') {
                        for (const [anim, arr] of sprite._frames.entries()) {
                            if (!Array.isArray(arr)) continue;
                            for (let i = 0; i < arr.length; i++) {
                                try {
                                    const entry = arr[i];
                                    let frameDataUrl = null;
                                    if (!entry) continue;
                                    if (entry.__lazy === true) {
                                        // attempt to draw from descriptor.src if available
                                        if (entry.src) {
                                            try {
                                                const c = document.createElement('canvas');
                                                c.width = entry.w || sprite.slicePx || 1;
                                                c.height = entry.h || sprite.slicePx || 1;
                                                const cx = c.getContext('2d');
                                                try { cx.imageSmoothingEnabled = false; } catch (e) {}
                                                cx.clearRect(0,0,c.width,c.height);
                                                cx.drawImage(entry.src, entry.sx || 0, entry.sy || 0, entry.w || sprite.slicePx, entry.h || sprite.slicePx, 0, 0, c.width, c.height);
                                                frameDataUrl = c.toDataURL('image/png');
                                            } catch (e) { frameDataUrl = null; }
                                        }
                                    } else if (entry instanceof HTMLCanvasElement) {
                                        try { frameDataUrl = entry.toDataURL('image/png'); } catch (e) { frameDataUrl = null; }
                                    }
                                    if (frameDataUrl && typeof this.saver.setImage === 'function') {
                                        try { this.saver.setImage('sprites/' + keyName + '/frames/' + encodeURIComponent(anim) + '/' + i, frameDataUrl); } catch (e) {}
                                    }
                                } catch (e) { /* ignore per-frame save errors */ }
                            }
                        }
                    }
                } catch (e) { /* ignore frames save errors */ }

                // Save non-base pixel-layer frame canvases separately.
                try {
                    this._ensureLayerState();
                    this._ensurePixelLayerStore();
                    const animEntries = (sprite && sprite._frames && typeof sprite._frames.entries === 'function')
                        ? Array.from(sprite._frames.entries())
                        : [];
                    for (let li = 1; li < (this._pixelLayers?.length || 0); li++) {
                        for (const [anim, arr] of animEntries) {
                            if (!Array.isArray(arr)) continue;
                            let logical = 0;
                            for (let i = 0; i < arr.length; i++) {
                                const entry = arr[i];
                                if (!entry || entry.__groupStart || entry.__groupEnd) continue;
                                const c = this._ensurePixelLayerFrameCanvas(li, anim, logical, false);
                                logical++;
                                if (!c || !c.toDataURL) continue;
                                let frameDataUrl = null;
                                try { frameDataUrl = c.toDataURL('image/png'); } catch (e) { frameDataUrl = null; }
                                if (!frameDataUrl || typeof this.saver.setImage !== 'function') continue;
                                try {
                                    this.saver.setImage('sprites/' + keyName + '/pixelLayers/' + li + '/frames/' + encodeURIComponent(anim) + '/' + (logical - 1), frameDataUrl);
                                } catch (e) {}
                            }
                        }
                    }
                } catch (e) { /* ignore pixel-layer frame save errors */ }

                // Minimal metadata: slice size, animations and frame counts, groups, tile layout
                const meta = { name: keyName, slicePx: (sprite && sprite.slicePx) || null, animations: {} };
                try {
                    if (sprite && sprite._frames && typeof sprite._frames.entries === 'function') {
                        for (const [anim, arr] of sprite._frames.entries()) {
                            meta.animations[anim] = Array.isArray(arr) ? arr.length : (arr && arr.length) || 0;
                        }
                    }
                } catch (e) {}
                try {
                    if (sprite && sprite._frameGroups && typeof sprite._frameGroups.entries === 'function') {
                        meta.frameGroups = {};
                        for (const [anim, groups] of sprite._frameGroups.entries()) {
                            meta.frameGroups[anim] = groups;
                        }
                    }
                } catch (e) {}

                // Persist per-frame connection toggles (anim::frame -> 8-bit open-connection key)
                try {
                    meta.tileConnections = {};
                    if (this._tileConnMap && typeof this._tileConnMap === 'object') {
                        for (const k of Object.keys(this._tileConnMap)) {
                            const v = this._tileConnMap[k];
                            if (typeof v !== 'string') continue;
                            meta.tileConnections[k] = (typeof this._normalizeOpenConnectionKey === 'function')
                                ? this._normalizeOpenConnectionKey(v)
                                : String(v).replace(/[^01]/g, '').padEnd(8, '0').slice(0, 8);
                        }
                    }
                } catch (e) { /* ignore tile connection save errors */ }

                // Persist tile-mode layout (grid size, bindings, preview transforms)
                try {
                    const layout = {};
                    layout.tilemode = !!this.tilemode;
                    layout.tileCols = Math.max(1, (this.tileCols|0) || 3);
                    layout.tileRows = Math.max(1, (this.tileRows|0) || 3);
                    this._ensureLayerState();
                    layout.pixelLayers = (this._pixelLayers || []).map((l, i) => ({
                        name: String((l && l.name) || ('Pixel Layer ' + (i + 1))),
                        visibility: this._normalizePixelLayerVisibility(l && l.visibility, 0)
                    }));
                    layout.activePixelLayerIndex = this.getActiveLayerIndex('pixel');
                    layout.activeTileLayerIndex = this.getActiveLayerIndex('tile');
                    layout.tileLayers = [];
                    layout.bindings = [];
                    layout.transforms = [];
                    layout.activeTiles = [];
                    layout.waypoints = this._getWaypointCoords(false).map((wp) => ({ col: wp.col, row: wp.row }));
                    if (this._tileActive && this._tileActive.size > 0) {
                        for (const key of this._tileActive.values()) {
                            const c = this._parseTileKey(key);
                            if (c) layout.activeTiles.push({ col: c.col, row: c.row });
                        }
                        // sort for deterministic ordering across saves so area indices line up
                        layout.activeTiles.sort((a, b) => (a.row - b.row) || (a.col - b.col));
                    }
                    if (Array.isArray(this._areaBindings)) {
                        for (let i = 0; i < this._areaBindings.length; i++) {
                            const b = this._areaBindings[i];
                            if (!b || b.anim === undefined || b.index === undefined) continue;
                            const coord = (this._tileIndexToCoord && this._tileIndexToCoord[i]) ? this._tileIndexToCoord[i] : null;
                            const entry = { areaIndex: i, anim: b.anim, index: Number(b.index) };
                            if (coord) { entry.col = coord.col; entry.row = coord.row; }
                            if (Array.isArray(b.multiFrames) && b.multiFrames.length > 0) entry.multiFrames = b.multiFrames.map(v => Number(v));
                            layout.bindings.push(entry);
                        }
                    }

                    const layersForSave = this._normalizeIncomingTileLayers(this._tileLayers);
                    if (Array.isArray(layersForSave)) {
                        for (let li = 0; li < layersForSave.length; li++) {
                            const layer = layersForSave[li] || {};
                            const layerBindings = [];
                            const layerTransforms = [];
                            const srcBindings = Array.isArray(layer.bindings) ? layer.bindings : [];
                            const srcTransforms = Array.isArray(layer.transforms) ? layer.transforms : [];

                            for (let i = 0; i < srcBindings.length; i++) {
                                const b = srcBindings[i];
                                if (!b || b.anim === undefined || b.index === undefined) continue;
                                const coord = (this._tileIndexToCoord && this._tileIndexToCoord[i]) ? this._tileIndexToCoord[i] : null;
                                const entry = { areaIndex: i, anim: b.anim, index: Number(b.index) };
                                if (coord) { entry.col = coord.col; entry.row = coord.row; }
                                if (Array.isArray(b.multiFrames) && b.multiFrames.length > 0) entry.multiFrames = b.multiFrames.map(v => Number(v));
                                layerBindings.push(entry);
                            }

                            for (let i = 0; i < srcTransforms.length; i++) {
                                const t = srcTransforms[i];
                                if (!t) continue;
                                const rot = (t.rot || 0);
                                const flipH = !!t.flipH;
                                if (rot !== 0 || flipH) {
                                    const coord = (this._tileIndexToCoord && this._tileIndexToCoord[i]) ? this._tileIndexToCoord[i] : null;
                                    const tx = { areaIndex: i, rot, flipH };
                                    if (coord) { tx.col = coord.col; tx.row = coord.row; }
                                    layerTransforms.push(tx);
                                }
                            }

                            layout.tileLayers.push({
                                name: String(layer.name || ('Tile Layer ' + (li + 1))),
                                visibility: this._normalizeTileLayerVisibility(layer && layer.visibility, 0),
                                bindings: layerBindings,
                                transforms: layerTransforms
                            });
                        }
                    }

                    if (Array.isArray(this._areaTransforms)) {
                        for (let i = 0; i < this._areaTransforms.length; i++) {
                            const t = this._areaTransforms[i];
                            if (!t) continue;
                            const rot = (t.rot || 0);
                            const flipH = !!t.flipH;
                            if (rot !== 0 || flipH) {
                                const coord = (this._tileIndexToCoord && this._tileIndexToCoord[i]) ? this._tileIndexToCoord[i] : null;
                                const tx = { areaIndex: i, rot, flipH };
                                if (coord) { tx.col = coord.col; tx.row = coord.row; }
                                layout.transforms.push(tx);
                            }
                        }
                        // stable ordering
                        layout.transforms.sort((a, b) => {
                            const ar = Number.isFinite(a.row) ? a.row : 0;
                            const br = Number.isFinite(b.row) ? b.row : 0;
                            const ac = Number.isFinite(a.col) ? a.col : 0;
                            const bc = Number.isFinite(b.col) ? b.col : 0;
                            return (ar - br) || (ac - bc) || (a.areaIndex - b.areaIndex);
                        });
                    }
                    meta.tileLayout = layout;
                } catch (e) { /* ignore tile layout save errors */ }

                // Persist sprite entities/state for reload recovery.
                try {
                    const layer = this._normalizeSpriteLayerState();
                    if (layer) {
                        const entities = {};
                        for (const id of Object.keys(layer.entities || {})) {
                            const entry = layer.entities[id];
                            if (!entry) continue;
                            entities[id] = { ...entry };
                        }
                        meta.spriteLayer = {
                            selectedAnimation: layer.selectedAnimation || null,
                            selectedEntityId: layer.selectedEntityId || null,
                            nextEntityId: Math.max(1, Number(layer.nextEntityId) || 1),
                            entities,
                            order: Array.isArray(layer.order) ? layer.order.slice() : Object.keys(entities),
                            animationProfiles: JSON.parse(JSON.stringify(layer.animationProfiles || {})),
                            clipboard: layer.clipboard ? JSON.parse(JSON.stringify(layer.clipboard)) : null
                        };
                    }
                } catch (e) { /* ignore sprite layer save errors */ }

                try { this.saver.set('sprites_meta/' + keyName, meta); } catch (e) {}
                this._autosaveLastRunAt = Date.now();
                this._autosaveDirty = false;
                return true;
            } catch (e) {
                console.warn('doSave failed', e);
                return false;
            }
        }

    // Copy the pixels inside this.selectionRegion into this.clipboard.
    doCopy(localOnly = false) {
        try {
            const sheet = this.currentSprite;
            const spriteLayer = this._normalizeSpriteLayerState();
            const selectedSpriteId = this.selectedSpriteEntityId || (spriteLayer ? spriteLayer.selectedEntityId : null);
            const selectedSprite = (spriteLayer && selectedSpriteId && spriteLayer.entities) ? spriteLayer.entities[selectedSpriteId] : null;
            if (this.tilemode && selectedSprite) {
                const payload = {
                    type: 'sprite-entity',
                    entity: {
                        anim: selectedSprite.anim || this.selectedSpriteAnimation || this.selectedAnimation,
                        fps: (selectedSprite.fps === null || selectedSprite.fps === undefined || selectedSprite.fps === '') ? null : (Number.isFinite(Number(selectedSprite.fps)) ? Number(selectedSprite.fps) : null),
                        parentAnim: selectedSprite.parentAnim || this._inferSpriteAnimationParent(selectedSprite.anim)
                    }
                };
                this.spriteClipboard = payload;
                this._spriteClipboard = payload;
                this._activeClipboardType = 'sprite';
                try { this._playSfx('clipboard.copy'); } catch (e) {}
                return;
            }
            const posInfoForTile = this.getPos(this.mouse && this.mouse.pos);
            const haveTileSelection = !!(this._tileSelection && this._tileSelection.size > 0);
            if (this.tilemode && (haveTileSelection || (posInfoForTile && posInfoForTile.renderOnly))) {
                const tiles = this._tileSelection && this._tileSelection.size > 0 ? Array.from(this._tileSelection) : (typeof posInfoForTile.areaIndex === 'number' ? [this._tileKey(posInfoForTile.tileCol, posInfoForTile.tileRow)] : []);
                const entries = [];
                for (const key of tiles) {
                    const c = this._parseTileKey(key);
                    if (!c) continue;
                    const idx = this._getAreaIndexForCoord(c.col, c.row);
                    const binding = this.getAreaBinding(idx);
                    const transform = (Array.isArray(this._areaTransforms) && this._areaTransforms[idx]) ? this._areaTransforms[idx] : null;
                    entries.push({ col: c.col, row: c.row, binding: binding ? { ...binding } : null, transform: transform ? { rot: transform.rot || 0, flipH: !!transform.flipH } : null });
                }
                if (entries.length > 0) {
                    const minCol = Math.min(...entries.map(e => e.col));
                    const minRow = Math.min(...entries.map(e => e.row));
                    // Determine origin tile relative to minCol/minRow based on mouse position
                    let originOffsetTile = { ox: 0, oy: 0 };
                    try {
                        if (posInfoForTile && typeof posInfoForTile.tileCol === 'number' && typeof posInfoForTile.tileRow === 'number') {
                            originOffsetTile.ox = posInfoForTile.tileCol - minCol;
                            originOffsetTile.oy = posInfoForTile.tileRow - minRow;
                        }
                    } catch (e) {}
                    this._tileClipboard = {
                        originOffsetTile,
                        tiles: entries.map(e => ({ dc: e.col - minCol, dr: e.row - minRow, binding: e.binding, transform: e.transform }))
                    };
                    this._activeClipboardType = 'tile';
                    try { this._playSfx('clipboard.copy'); } catch (e) {}
                }
                return;
            }
            // Determine source area/frame. Prefer the area where the selection was created
            // (selectionPoints or selectionRegion), otherwise fall back to the mouse-over area.
            let sourceAreaIndex = null;
            if (this.selectionPoints && this.selectionPoints.length > 0 && typeof this.selectionPoints[0].areaIndex === 'number') {
                sourceAreaIndex = this.selectionPoints[0].areaIndex;
            } else if (this.selectionRegion && typeof this.selectionRegion.areaIndex === 'number') {
                sourceAreaIndex = this.selectionRegion.areaIndex;
            } else {
                const posInfo = this.getPos(this.mouse && this.mouse.pos) || {};
                if (posInfo && typeof posInfo.areaIndex === 'number') sourceAreaIndex = posInfo.areaIndex;
            }

            let anim = this.selectedAnimation;
            let frameIdx = this.selectedFrame;
            if (this.tilemode && typeof sourceAreaIndex === 'number') {
                const binding = this.getAreaBinding(sourceAreaIndex);
                if (binding && binding.anim !== undefined && binding.index !== undefined) {
                    anim = binding.anim;
                    frameIdx = Number(binding.index);
                }
            }

            const resolvePixelClipboardOriginOffset = (minX, minY, maxX, maxY, areaIndexHint = null) => {
                try {
                    const pos = this.getPos(this.mouse && this.mouse.pos);
                    const hasLocal = !!(pos && pos.inside && Number.isFinite(pos.x) && Number.isFinite(pos.y));
                    const areaMatches = !this.tilemode || areaIndexHint === null || areaIndexHint === undefined || (pos && pos.areaIndex === areaIndexHint);
                    let candidateX = Number.isFinite(minX) ? minX : 0;
                    let candidateY = Number.isFinite(minY) ? minY : 0;
                    if (hasLocal && areaMatches) {
                        candidateX = pos.x;
                        candidateY = pos.y;
                    }
                    const originX = Math.max(minX, Math.min(maxX, candidateX));
                    const originY = Math.max(minY, Math.min(maxY, candidateY));
                    return {
                        ox: originX - minX,
                        oy: originY - minY
                    };
                } catch (e) {
                    return { ox: 0, oy: 0 };
                }
            };

            // If there are explicit selection points, copy those pixels
            if (this.selectionPoints && this.selectionPoints.length > 0) {
                const frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, frameIdx) : null;
                if (!frameCanvas) return;
                const ctx = frameCanvas.getContext('2d');
                // compute bounding box of selected points
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (const p of this.selectionPoints) {
                    if (p.x < minX) minX = p.x;
                    if (p.y < minY) minY = p.y;
                    if (p.x > maxX) maxX = p.x;
                    if (p.y > maxY) maxY = p.y;
                }
                const w = Math.max(1, maxX - minX + 1);
                const h = Math.max(1, maxY - minY + 1);
                const pixels = [];
                for (const p of this.selectionPoints) {
                    try {
                        const d = ctx.getImageData(p.x, p.y, 1, 1).data;
                        pixels.push({ x: p.x - minX, y: p.y - minY, r: d[0], g: d[1], b: d[2], a: d[3] });
                    } catch (e) {
                        // ignore
                    }
                }
                // Determine origin from current mouse pixel pos (clamped into bbox)
                const pointsAreaIndex = (this.tilemode && this.selectionPoints && this.selectionPoints.length > 0 && typeof this.selectionPoints[0].areaIndex === 'number')
                    ? this.selectionPoints[0].areaIndex
                    : sourceAreaIndex;
                const originOffset = resolvePixelClipboardOriginOffset(minX, minY, maxX, maxY, pointsAreaIndex);
                this.clipboard = { type: 'points', w, h, pixels, originOffset };
                this._activeClipboardType = 'pixel';
                try { this._playSfx('clipboard.copy'); } catch (e) {}
                // Attempt to also place a transferable representation on the system clipboard
                if (!localOnly) {
                    try {
                        if (typeof copyToClipboard === 'function') {
                            // Create a compact image data URL representing the selected points
                            const c = document.createElement('canvas');
                            c.width = w; c.height = h;
                            const cx = c.getContext('2d');
                            const imgd = cx.createImageData(w, h);
                            for (const p of pixels) {
                                const idx = (p.y * w + p.x) * 4;
                                imgd.data[idx] = p.r || 0;
                                imgd.data[idx + 1] = p.g || 0;
                                imgd.data[idx + 2] = p.b || 0;
                                imgd.data[idx + 3] = p.a || 0;
                            }
                            cx.putImageData(imgd, 0, 0);
                            const dataUrl = c.toDataURL('image/png');
                            // Copy a JSON wrapper including origin so paste can recover it
                            try { copyToClipboard(JSON.stringify({ type: 'image', w, h, originOffset, data: dataUrl })); } catch (e) { copyToClipboard(dataUrl); }
                        }
                    } catch (e) { /* ignore clipboard copy failures */ }
                }
                return;
            }

            // Otherwise fall back to rectangular region selection copy
            if (!this.selectionRegion || !sheet) return;
            const sr = this.selectionRegion;
            const minX = Math.min(sr.start.x, sr.end.x);
            const minY = Math.min(sr.start.y, sr.end.y);
            const maxX = Math.max(sr.start.x, sr.end.x);
            const maxY = Math.max(sr.start.y, sr.end.y);
            const w = maxX - minX + 1;
            const h = maxY - minY + 1;
            const frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, frameIdx) : null;
            if (!frameCanvas) return;
            const ctx = frameCanvas.getContext('2d');
            const img = ctx.getImageData(minX, minY, w, h);
            // Determine origin from current mouse pixel pos (clamped into region)
            const regionAreaIndex = (this.tilemode && sr && typeof sr.areaIndex === 'number') ? sr.areaIndex : sourceAreaIndex;
            const originOffset = resolvePixelClipboardOriginOffset(minX, minY, maxX, maxY, regionAreaIndex);
            this.clipboard = { type: 'image', w, h, data: img.data, originOffset };
            this._activeClipboardType = 'pixel';
            try { this._playSfx('clipboard.copy'); } catch (e) {}
            // Attempt to also place a transferable representation on the system clipboard (data URL wrapped in JSON)
            if (!localOnly) {
                try {
                    if (typeof copyToClipboard === 'function') {
                        const c = document.createElement('canvas');
                        c.width = w; c.height = h;
                        const cx = c.getContext('2d');
                        const imageData = cx.createImageData(w, h);
                        // copy numeric data into ImageData
                        try { imageData.data.set(img.data); } catch (e) {
                            for (let i = 0; i < Math.min(imageData.data.length, img.data.length); i++) imageData.data[i] = img.data[i];
                        }
                        cx.putImageData(imageData, 0, 0);
                        const dataUrl = c.toDataURL('image/png');
                        try { copyToClipboard(JSON.stringify({ type: 'image', w, h, originOffset, data: dataUrl })); } catch (e) { copyToClipboard(dataUrl); }
                    }
                } catch (e) { /* ignore clipboard copy failures */ }
            }
        } catch (e) {
            console.warn('doCopy failed', e);
        }
    }

    // Cut: copy then clear the source pixels (set transparent)
    doCut() {
        try {
            if (!this.currentSprite) return;
            const spriteLayer = this._normalizeSpriteLayerState();
            const selectedSpriteId = this.selectedSpriteEntityId || (spriteLayer ? spriteLayer.selectedEntityId : null);
            const selectedSprite = (spriteLayer && selectedSpriteId && spriteLayer.entities) ? spriteLayer.entities[selectedSpriteId] : null;
            if (this.tilemode && selectedSprite && selectedSpriteId) {
                this.doCopy(true);
                this._deleteSpriteEntity(selectedSpriteId, true);
                this.modifyState(null, false, false, ['spriteLayer', 'selectedEntityId']);
                try { this._playSfx('clipboard.cut'); } catch (e) {}
                return;
            }
            const posInfoForTile = this.getPos(this.mouse && this.mouse.pos);
            const haveTileSelection = !!(this._tileSelection && this._tileSelection.size > 0);
            if (this.tilemode && (haveTileSelection || (posInfoForTile && posInfoForTile.renderOnly))) {
                const tiles = this._tileSelection && this._tileSelection.size > 0 ? Array.from(this._tileSelection) : (typeof posInfoForTile.areaIndex === 'number' ? [this._tileKey(posInfoForTile.tileCol, posInfoForTile.tileRow)] : []);
                const entries = [];
                for (const key of tiles) {
                    const c = this._parseTileKey(key);
                    if (!c) continue;
                    const idx = this._getAreaIndexForCoord(c.col, c.row);
                    const binding = this.getAreaBinding(idx);
                    const transform = (Array.isArray(this._areaTransforms) && this._areaTransforms[idx]) ? this._areaTransforms[idx] : null;
                    entries.push({ col: c.col, row: c.row, binding: binding ? { ...binding } : null, transform: transform ? { rot: transform.rot || 0, flipH: !!transform.flipH } : null });
                    // Cut is layer-dependent: clear only active tile layer at this coord.
                    this._clearTileOnActiveLayer(c.col, c.row, true);
                }
                if (entries.length > 0) {
                    const minCol = Math.min(...entries.map(e => e.col));
                    const minRow = Math.min(...entries.map(e => e.row));
                    this._tileClipboard = {
                        tiles: entries.map(e => ({ dc: e.col - minCol, dr: e.row - minRow, binding: e.binding, transform: e.transform }))
                    };
                    this._activeClipboardType = 'tile';
                    try { this._playSfx('clipboard.cut'); } catch (e) {}
                }
                this._tileSelection = new Set();
                return;
            }
            // Determine source area/frame for cut: prefer selection origin, otherwise mouse-over
            let sourceAreaIndex = null;
            if (this.selectionPoints && this.selectionPoints.length > 0 && typeof this.selectionPoints[0].areaIndex === 'number') {
                sourceAreaIndex = this.selectionPoints[0].areaIndex;
            } else if (this.selectionRegion && typeof this.selectionRegion.areaIndex === 'number') {
                sourceAreaIndex = this.selectionRegion.areaIndex;
            } else {
                const posInfo = this.getPos(this.mouse && this.mouse.pos) || {};
                if (posInfo && typeof posInfo.areaIndex === 'number') sourceAreaIndex = posInfo.areaIndex;
            }
            let anim = this.selectedAnimation;
            let frameIdx = this.selectedFrame;
            // Only consider an area's binding for resolving anim/frame when in tilemode
            // (matching the logic used by `doCopy`). Otherwise `sourceAreaIndex` may
            // reference a tile area that should not affect the current single-frame edit.
            if (this.tilemode && typeof sourceAreaIndex === 'number') {
                const binding = this.getAreaBinding(sourceAreaIndex);
                if (binding && binding.anim !== undefined && binding.index !== undefined) {
                    anim = binding.anim;
                    frameIdx = Number(binding.index);
                }
            }
            // If selectionPoints exist, copy those and then clear each pixel
            if (this.selectionPoints && this.selectionPoints.length > 0) {
                this.doCopy();
                const sheet = this.currentSprite;
                for (const p of this.selectionPoints) {
                    if (typeof sheet.setPixel === 'function') {
                        try { sheet.setPixel(anim, frameIdx, p.x, p.y, '#00000000', 'replace'); } catch (e) { }
                    } else if (typeof sheet.modifyFrame === 'function') {
                        try { sheet.modifyFrame(anim, frameIdx, { x: p.x, y: p.y, color: '#00000000', blendType: 'replace' }); } catch (e) { }
                    }
                }
                if (typeof sheet._rebuildSheetCanvas === 'function') {
                    try { sheet._rebuildSheetCanvas(); } catch (e) { }
                }
                if (this.stateController) this.stateController.clearSelectionPoints();
                else this.selectionPoints = [];
                try { this._playSfx('clipboard.cut'); } catch (e) {}
                return;
            }

            // Otherwise rectangle cut
            if (!this.selectionRegion) return;
            // copy first
            this.doCopy();
            // then clear source
            const sr = this.selectionRegion;
            const minX = Math.min(sr.start.x, sr.end.x);
            const minY = Math.min(sr.start.y, sr.end.y);
            const maxX = Math.max(sr.start.x, sr.end.x);
            const maxY = Math.max(sr.start.y, sr.end.y);
            const sheet = this.currentSprite;
            for (let y = minY; y <= maxY; y++) {
                for (let x = minX; x <= maxX; x++) {
                    if (typeof sheet.setPixel === 'function') {
                        try { sheet.setPixel(anim, frameIdx, x, y, '#00000000', 'replace'); } catch (e) { }
                    } else if (typeof sheet.modifyFrame === 'function') {
                        try { sheet.modifyFrame(anim, frameIdx, { x, y, color: '#00000000', blendType: 'replace' }); } catch (e) { }
                    }
                }
            }
            if (typeof sheet._rebuildSheetCanvas === 'function') {
                try { sheet._rebuildSheetCanvas(); } catch (e) { }
            }
            // clear the selection region after cutting
            if (this.stateController) this.stateController.clearSelectionRegion();
            else this.selectionRegion = null;
            try { this._playSfx('clipboard.cut'); } catch (e) {}
        } catch (e) {
            console.warn('doCut failed', e);
        }
    }

    // Paste clipboard at a screen mouse position (mousePos is a Vector in screen space)
    doPaste(mousePos, { playSfx = true } = {}) {
        try {
            if (!this.clipboard && !this._tileClipboard && !this.spriteClipboard && !this._spriteClipboard) return;
            if (!this.currentSprite) return;
            const sheet = this.currentSprite;
            const slice = sheet.slicePx || 1;
            const pos = this.getPos(mousePos);
            if (!pos || (!pos.inside && !(this.tilemode && pos.renderOnly))) return;

            if (playSfx) {
                try { this._playSfx('clipboard.paste'); } catch (e) {}
            }

            const spriteClip = this.spriteClipboard || this._spriteClipboard || null;
            const activeType = this._activeClipboardType;
            if ((activeType === 'sprite' || (!activeType && !this._tileClipboard && !this.clipboard)) && this.tilemode && spriteClip && spriteClip.type === 'sprite-entity') {
                if (Number.isFinite(Number(pos.tileCol)) && Number.isFinite(Number(pos.tileRow))) {
                    const col = Number(pos.tileCol) | 0;
                    const row = Number(pos.tileRow) | 0;
                    const src = spriteClip.entity || {};
                    const created = this._addSpriteEntityAt(col, row, src.anim || this.selectedSpriteAnimation || this.selectedAnimation, true);
                    if (created && src.fps !== null && src.fps !== undefined && src.fps !== '' && Number.isFinite(Number(src.fps))) {
                        this._updateSpriteEntity(created.id, { fps: Number(src.fps) }, true);
                    }
                    if (created) {
                        this.selectedSpriteEntityId = created.id;
                        this.modifyState(created.id, false, false, ['spriteLayer', 'selectedEntityId']);
                    }
                }
                return;
            }

            // Resolve destination anim/frame and tile origin (col,row) when in tilemode
            let anim = this.selectedAnimation;
            let frameIdx = this.selectedFrame;
            let col = 0, row = 0;
            let areaIndex = (pos && typeof pos.areaIndex === 'number') ? pos.areaIndex : null;
            if (this.tilemode && typeof areaIndex === 'number' && Array.isArray(this._tileIndexToCoord)) {
                const cr = this._tileIndexToCoord[areaIndex];
                if (cr) { col = cr.col|0; row = cr.row|0; }
            }
            if (this.tilemode && typeof areaIndex === 'number') {
                const binding = this.getAreaBinding(areaIndex);
                if (binding && binding.anim !== undefined && binding.index !== undefined) {
                    anim = binding.anim;
                    frameIdx = Number(binding.index);
                }
            }

            // Tile clipboard paste in render-only tilemode
            if ((activeType === 'tile' || (!activeType && !!this._tileClipboard && !this.clipboard)) && this.tilemode && pos.renderOnly && this._tileClipboard) {
                const tiles = Array.isArray(this._tileClipboard.tiles) && this._tileClipboard.tiles.length > 0
                    ? this._tileClipboard.tiles
                    : (this._tileClipboard.binding ? [{ dc:0, dr:0, binding: this._tileClipboard.binding, transform: this._tileClipboard.transform }] : []);
                // honor originOffsetTile so mouse position maps to that origin when pasting
                const origin = (this._tileClipboard.originOffsetTile && Number.isFinite(this._tileClipboard.originOffsetTile.ox) && Number.isFinite(this._tileClipboard.originOffsetTile.oy))
                    ? this._tileClipboard.originOffsetTile : { ox: 0, oy: 0 };
                const baseCol = col - (origin.ox|0);
                const baseRow = row - (origin.oy|0);
                for (const t of tiles) {
                    const tCol = baseCol + (t.dc|0);
                    const tRow = baseRow + (t.dr|0);
                    const idx = this._getAreaIndexForCoord(tCol, tRow);
                    this._activateTile(tCol, tRow);
                    this._setAreaBindingAtIndex(idx, t.binding ? { ...t.binding } : { anim, index: frameIdx }, true);
                    if (t.transform) this._setAreaTransformAtIndex(idx, { ...t.transform }, true);
                }
                return;
            }

            if (activeType && activeType !== 'pixel') return;
            if (!this.clipboard) return;

            const ox = (this.clipboard.originOffset && Number.isFinite(this.clipboard.originOffset.ox)) ? this.clipboard.originOffset.ox : 0;
            const oy = (this.clipboard.originOffset && Number.isFinite(this.clipboard.originOffset.oy)) ? this.clipboard.originOffset.oy : 0;
            const targetLocalX = pos.x - ox;
            const targetLocalY = pos.y - oy;
            const targetWorldX = col * slice + targetLocalX;
            const targetWorldY = row * slice + targetLocalY;

            const writeRGBAWorld = (wx, wy, r, g, b, a) => {
                if (a === 0) return;
                // In non-tile mode, do not wrap pixels outside the single frame bounds.
                if (!this.tilemode) {
                    if (wx < 0 || wy < 0 || wx >= slice || wy >= slice) return;
                }
                const t = this._worldPixelToTile(wx, wy, slice);
                if (!t) return;
                if (this.tilemode && !this._isTileActive(t.col, t.row)) return;
                let aIdx = this.tilemode ? t.areaIndex : null;
                let an = anim, fi = frameIdx;
                if (typeof aIdx === 'number') {
                    const bnd = this.getAreaBinding(aIdx);
                    if (bnd && bnd.anim !== undefined && bnd.index !== undefined) {
                        an = bnd.anim;
                        fi = Number(bnd.index);
                    }
                }
                if (typeof sheet.setPixel === 'function') {
                    try { sheet.setPixel(an, fi, t.localX, t.localY, this.rgbaToHex(r, g, b, a), 'replace'); } catch (e) { }
                } else if (typeof sheet.modifyFrame === 'function') {
                    try { sheet.modifyFrame(an, fi, { x: t.localX, y: t.localY, color: this.rgbaToHex(r, g, b, a), blendType: 'replace' }); } catch (e) { }
                }
            };

            if (this.clipboard.type === 'points') {
                const pixels = this.clipboard.pixels || [];
                for (const p of pixels) {
                    if (p.a === 0) continue;
                    const wx = targetWorldX + p.x;
                    const wy = targetWorldY + p.y;
                    writeRGBAWorld(wx, wy, p.r, p.g, p.b, p.a);
                }
                if (typeof sheet._rebuildSheetCanvas === 'function') {
                    try { sheet._rebuildSheetCanvas(); } catch (e) { }
                }
                return;
            }

            // image clipboard paste (world-aware)
            const w = this.clipboard.w;
            const h = this.clipboard.h;
            const data = this.clipboard.data; // Uint8ClampedArray
            for (let yy = 0; yy < h; yy++) {
                for (let xx = 0; xx < w; xx++) {
                    const srcIdx = (yy * w + xx) * 4;
                    const r = data[srcIdx];
                    const g = data[srcIdx + 1];
                    const b = data[srcIdx + 2];
                    const a = data[srcIdx + 3];
                    if (a === 0) continue;
                    const wx = targetWorldX + xx;
                    const wy = targetWorldY + yy;
                    writeRGBAWorld(wx, wy, r, g, b, a);
                }
            }
            if (typeof sheet._rebuildSheetCanvas === 'function') {
                try { sheet._rebuildSheetCanvas(); } catch (e) { }
            }
        } catch (e) {
            console.warn('doPaste failed', e);
        }
    }

    // Erase using the clipboard footprint (transparent pixels are ignored; opaque pixels erase to transparent)
    doClipboardErase(mousePos, { playSfx = true } = {}) {
        try {
            if (!this.clipboard || !this.currentSprite) return;
            const sheet = this.currentSprite;
            const slice = sheet.slicePx || 1;
            const pos = this.getPos(mousePos);
            if (!pos || !pos.inside) return;

            if (playSfx) {
                try { this._playSfx('clipboard.erase'); } catch (e) {}
            }

            let anim = this.selectedAnimation;
            let frameIdx = this.selectedFrame;
            let col = 0, row = 0;
            let areaIndex = (pos && typeof pos.areaIndex === 'number') ? pos.areaIndex : null;
            if (this.tilemode && typeof areaIndex === 'number' && Array.isArray(this._tileIndexToCoord)) {
                const cr = this._tileIndexToCoord[areaIndex];
                if (cr) { col = cr.col|0; row = cr.row|0; }
            }
            if (this.tilemode && typeof areaIndex === 'number') {
                const binding = this.getAreaBinding(areaIndex);
                if (binding && binding.anim !== undefined && binding.index !== undefined) {
                    anim = binding.anim;
                    frameIdx = Number(binding.index);
                }
            }

            const ox = (this.clipboard.originOffset && Number.isFinite(this.clipboard.originOffset.ox)) ? this.clipboard.originOffset.ox : 0;
            const oy = (this.clipboard.originOffset && Number.isFinite(this.clipboard.originOffset.oy)) ? this.clipboard.originOffset.oy : 0;
            const targetLocalX = pos.x - ox;
            const targetLocalY = pos.y - oy;
            const targetWorldX = col * slice + targetLocalX;
            const targetWorldY = row * slice + targetLocalY;
            const eraseColor = '#00000000';

            const eraseWorld = (wx, wy) => {
                const t = this._worldPixelToTile(wx, wy, slice);
                if (!t) return;
                if (this.tilemode && !this._isTileActive(t.col, t.row)) return;
                let aIdx = this.tilemode ? t.areaIndex : null;
                let an = anim, fi = frameIdx;
                if (typeof aIdx === 'number') {
                    const bnd = this.getAreaBinding(aIdx);
                    if (bnd && bnd.anim !== undefined && bnd.index !== undefined) {
                        an = bnd.anim;
                        fi = Number(bnd.index);
                    }
                }
                if (typeof sheet.setPixel === 'function') {
                    try { sheet.setPixel(an, fi, t.localX, t.localY, eraseColor, 'replace'); } catch (e) { }
                } else if (typeof sheet.modifyFrame === 'function') {
                    try { sheet.modifyFrame(an, fi, { x: t.localX, y: t.localY, color: eraseColor, blendType: 'replace' }); } catch (e) { }
                }
            };

            if (this.clipboard.type === 'points') {
                const pixels = this.clipboard.pixels || [];
                for (const p of pixels) {
                    if (p.a === 0) continue; // ignore transparent source pixels
                    const wx = targetWorldX + p.x;
                    const wy = targetWorldY + p.y;
                    eraseWorld(wx, wy);
                }
                if (typeof sheet._rebuildSheetCanvas === 'function') {
                    try { sheet._rebuildSheetCanvas(); } catch (e) { }
                }
                return;
            }

            const w = this.clipboard.w;
            const h = this.clipboard.h;
            const data = this.clipboard.data;
            for (let yy = 0; yy < h; yy++) {
                for (let xx = 0; xx < w; xx++) {
                    const srcIdx = (yy * w + xx) * 4;
                    const a = data[srcIdx + 3];
                    if (a === 0) continue; // ignore transparent source
                    const wx = targetWorldX + xx;
                    const wy = targetWorldY + yy;
                    eraseWorld(wx, wy);
                }
            }
            if (typeof sheet._rebuildSheetCanvas === 'function') {
                try { sheet._rebuildSheetCanvas(); } catch (e) { }
            }
        } catch (e) {
            console.warn('doClipboardErase failed', e);
        }
    }

    // Animate applying pixel changes as a chain-reaction expanding from origin
    _animatePixelChanges(changes, anim, frameIdx, originX = 0, originY = 0, durationMs = 200) {
        try {
            if (!Array.isArray(changes) || changes.length === 0) return;
            const sheet = this.currentSprite;
            if (!sheet) return;
            this._animPixelToken = (Number(this._animPixelToken) || 0) + 1;
            const token = this._animPixelToken;
            // compute distance from origin for each change
            const entries = changes.map(c => ({ ...c, dist: Math.hypot((c.x - (originX||0)), (c.y - (originY||0))) }));
            const maxDist = entries.reduce((m, e) => Math.max(m, e.dist), 0) || 1;
            const steps = Math.min(12, Math.max(4, Math.ceil(entries.length / 25)));
            // bucket by normalized distance
            const buckets = Array.from({ length: steps }, () => []);
            for (const e of entries) {
                const n = Math.min(steps - 1, Math.floor((e.dist / maxDist) * steps));
                buckets[n].push(e);
            }
            const delay = Math.max(0, Math.round(durationMs / steps));
            // apply buckets in sequence
            for (let i = 0; i < buckets.length; i++) {
                const batch = buckets[i];
                setTimeout(() => {
                    try {
                        if (token !== this._animPixelToken) return;
                        if (!batch || batch.length === 0) return;
                        if (typeof sheet.modifyFrame === 'function') {
                            const simple = batch.map(b => ({ x: b.x, y: b.y, color: b.color, blendType: b.blendType || 'replace' }));
                            try { sheet.modifyFrame(anim, frameIdx, simple); } catch (e) {
                                for (const c of simple) {
                                    try { sheet.setPixel(anim, frameIdx, c.x, c.y, c.color, 'replace'); } catch (e) {}
                                }
                            }
                        } else {
                            for (const c of batch) {
                                try { sheet.setPixel(anim, frameIdx, c.x, c.y, c.color, 'replace'); } catch (e) {}
                            }
                        }
                        if (typeof sheet._rebuildSheetCanvas === 'function') {
                            try { sheet._rebuildSheetCanvas(); } catch (e) {}
                        }
                    } catch (e) { /* ignore per-batch errors */ }
                }, i * delay);
            }
        } catch (e) { /* ignore animation failures */ }
    }

    // Animate building selection points in a chain reaction over ~durationMs
    _animateSelectPoints(points, durationMs = 200, origin = null) {
        try {
            if (!Array.isArray(points) || points.length === 0) return;
            this._animSelectToken = (Number(this._animSelectToken) || 0) + 1;
            const token = this._animSelectToken;
            const steps = Math.min(12, Math.max(4, Math.ceil(points.length / 25)));
            // compute centroid to expand from
            let cx = 0, cy = 0;
            if (origin && Number.isFinite(origin.ox) && Number.isFinite(origin.oy)) {
                cx = origin.ox; cy = origin.oy;
            } else {
                for (const p of points) { cx += p.x; cy += p.y; }
                cx /= points.length; cy /= points.length;
            }
            const entries = points.map(p => ({ ...p, dist: Math.hypot(p.x - cx, p.y - cy) }));
            const maxDist = entries.reduce((m, e) => Math.max(m, e.dist), 0) || 1;
            const buckets = Array.from({ length: steps }, () => []);
            for (const e of entries) {
                const n = Math.min(steps - 1, Math.floor((e.dist / maxDist) * steps));
                buckets[n].push({ x: e.x, y: e.y, areaIndex: e.areaIndex });
            }
            const delay = Math.max(0, Math.round(durationMs / steps));
            let accumulated = this.selectionPoints && this.selectionPoints.length ? this.selectionPoints.slice() : [];
            const seen = new Set(accumulated.map((sp) => `${sp.x},${sp.y},${(typeof sp.areaIndex === 'number') ? sp.areaIndex : 'n'}`));
            for (let i = 0; i < buckets.length; i++) {
                const batch = buckets[i];
                setTimeout(() => {
                    try {
                        if (token !== this._animSelectToken) return;
                        if (!batch || batch.length === 0) return;
                        for (const p of batch) {
                            const pKey = `${p.x},${p.y},${(typeof p.areaIndex === 'number') ? p.areaIndex : 'n'}`;
                            if (seen.has(pKey)) continue;
                            seen.add(pKey);
                            accumulated.push(p);
                        }
                        if (this.stateController && typeof this.stateController.setSelectionPoints === 'function') {
                            try { this.stateController.setSelectionPoints(accumulated.slice()); this.stateController.clearSelectionRegion(); } catch (e) {}
                        } else {
                            this.selectionPoints = accumulated.slice();
                            this.selectionRegion = null;
                        }
                    } catch (e) { /* ignore per-batch errors */ }
                }, i * delay);
            }
        } catch (e) { /* ignore */ }
    }

    // Animate filling a set of selected pixels with a spatial gradient + noise.
    _animateFillSelected(entries, anim, frameIdx, durationMs = 220, origin = null) {
        try {
            if (!Array.isArray(entries) || entries.length === 0) return;
            const sheet = this.currentSprite;
            if (!sheet) return;
            this._animFillToken = (Number(this._animFillToken) || 0) + 1;
            const token = this._animFillToken;
            // Compute fill-iteration distances (BFS) from start so the animation
            // follows the actual topology of the selected pixels rather than a
            // radial or simple projection. Build a map of points for adjacency.
            const pointMap = new Map();
            for (const e of entries) {
                const key = e.x + ',' + e.y;
                pointMap.set(key, e);
                e._dist = Infinity;
            }
            // choose start: nearest entry to origin or centroid
            let sx = 0, sy = 0;
            if (origin && Number.isFinite(origin.ox) && Number.isFinite(origin.oy)) {
                sx = origin.ox; sy = origin.oy;
            } else {
                for (const e of entries) { sx += e.x; sy += e.y; }
                sx /= entries.length; sy /= entries.length;
            }
            // find nearest entry to start
            let startEntry = null, bestD = Infinity;
            for (const e of entries) {
                const d = Math.hypot(e.x - sx, e.y - sy);
                if (d < bestD) { bestD = d; startEntry = e; }
            }
            // BFS from startEntry to compute iteration distances
            if (startEntry) {
                const q = [];
                let head = 0;
                startEntry._dist = 0;
                q.push(startEntry);
                const visited = new Set();
                visited.add(startEntry.x + ',' + startEntry.y);
                while (head < q.length) {
                    const cur = q[head++];
                    const d = cur._dist;
                    const nx = cur.x, ny = cur.y;
                    const neigh = [ [nx+1, ny], [nx-1, ny], [nx, ny+1], [nx, ny-1] ];
                    for (const [ax, ay] of neigh) {
                        const k = ax + ',' + ay;
                        if (!pointMap.has(k) || visited.has(k)) continue;
                        const ne = pointMap.get(k);
                        ne._dist = d + 1;
                        visited.add(k);
                        q.push(ne);
                    }
                }
            }
            // Assign disconnected points a large distance (append at end)
            let maxDist = 0;
            for (const e of entries) {
                if (!Number.isFinite(e._dist)) e._dist = Infinity;
                else maxDist = Math.max(maxDist, e._dist);
            }
            const totalIters = Math.max(1, (Number.isFinite(maxDist) ? (maxDist + 1) : 1));
            const steps = Math.min(Math.max(4, totalIters), 60);
            const buckets = Array.from({ length: steps }, () => []);
            const scale = steps / totalIters;
            for (const e of entries) {
                const idx = (e._dist === Infinity) ? (steps - 1) : Math.min(steps - 1, Math.floor(e._dist * scale));
                buckets[idx].push(e);
            }
            // target color
            const targetCol = Color.convertColor(this.penColor || '#000000').toRgb();
            const tr = Math.round(targetCol.a || 0), tg = Math.round(targetCol.b || 0), tb = Math.round(targetCol.c || 0), ta = Math.round((targetCol.d ?? 1) * 255);
            const delay = Math.max(0, Math.round(durationMs / steps));
            // apply buckets sequentially with spatially-varying mix + noise
            for (let i = 0; i < buckets.length; i++) {
                const batch = buckets[i];
                setTimeout(() => {
                    try {
                        if (token !== this._animFillToken) return;
                        // for each pixel compute a mix factor based on normalized distance plus small noise
                        const changes = [];
                                for (const p of batch) {
                                    // mix factor: use BFS iteration distance when available
                                    // (normalized), otherwise fallback to radial distance.
                                    const base = (Number.isFinite(p._dist) && p._dist !== Infinity)
                                        ? Math.min(1, (p._dist / Math.max(1, maxDist)))
                                        : Math.min(1, (p.dist || 0) / (maxDist || 1));
                                    const noise = (Math.random() - 0.5) * 0.25; // noise magnitude
                                    const mix = Math.max(0, Math.min(1, base + noise));
                            // lerp original -> target
                            const r = Math.round((1 - mix) * (p.r || 0) + mix * tr);
                            const g = Math.round((1 - mix) * (p.g || 0) + mix * tg);
                            const b = Math.round((1 - mix) * (p.b || 0) + mix * tb);
                            const a = Math.round((1 - mix) * (p.a || 0) + mix * ta);
                            changes.push({ x: p.x, y: p.y, color: this.rgbaToHex(r, g, b, a), blendType: 'replace' });
                        }
                        if (!changes.length) return;
                        if (typeof sheet.modifyFrame === 'function') {
                            try { sheet.modifyFrame(anim, frameIdx, changes); } catch (e) {
                                for (const c of changes) try { sheet.setPixel(anim, frameIdx, c.x, c.y, c.color, 'replace'); } catch (e) {}
                            }
                        } else {
                            for (const c of changes) try { sheet.setPixel(anim, frameIdx, c.x, c.y, c.color, 'replace'); } catch (e) {}
                        }
                        if (typeof sheet._rebuildSheetCanvas === 'function') try { sheet._rebuildSheetCanvas(); } catch (e) {}
                    } catch (e) { /* ignore per-batch errors */ }
                }, i * delay);
            }
        } catch (e) { /* ignore */ }
    }

    // Schedule sending buffered ops (throttled)
    _scheduleSend() {
        try {
            if (this._sendScheduledId) return;
            this._sendScheduledId = setTimeout(() => {
                try { this.sendState(); } catch (e) { /* ignore */ }
                try { clearTimeout(this._sendScheduledId); } catch (e) {}
                this._sendScheduledId = null;
            }, this._sendIntervalMs || 120);
        } catch (e) { /* ignore */ }
    }

    _clearPendingCollabOps() {
        try {
            if (this._sendScheduledId) {
                try { clearTimeout(this._sendScheduledId); } catch (e) {}
                this._sendScheduledId = null;
            }
            if (Array.isArray(this._opBuffer) && this._opBuffer.length > 0) this._opBuffer.length = 0;
            if (this._tileOpPending && typeof this._tileOpPending.clear === 'function') this._tileOpPending.clear();
            if (this._spriteOpPending && typeof this._spriteOpPending.clear === 'function') this._spriteOpPending.clear();
            this._tileStatePending = null;
        } catch (e) { /* ignore */ }
    }

    _flushPendingTileOpsToBuffer() {
        try {
            if (!this._tileOpPending || this._tileOpPending.size === 0) return 0;
            if (!this._opBuffer) this._opBuffer = [];

            const chunkSize = 96;
            const now = Date.now();
            const entries = [];

            for (const [key, pending] of this._tileOpPending.entries()) {
                if (!pending || typeof pending !== 'object') continue;
                let rawKey = String(key);
                if (rawKey.startsWith('l')) {
                    const sep = rawKey.indexOf(':');
                    if (sep > 1) rawKey = rawKey.slice(sep + 1);
                }
                const parts = rawKey.split(',');
                if (parts.length !== 2) continue;
                const col = Number(parts[0]);
                const row = Number(parts[1]);
                if (!Number.isFinite(col) || !Number.isFinite(row)) continue;

                const compact = { c: col|0, r: row|0 };
                if (pending.layer !== undefined && Number.isFinite(Number(pending.layer))) compact.l = Number(pending.layer) | 0;

                if (pending.active !== undefined) compact.a = pending.active ? 1 : 0;

                if (pending.binding !== undefined) {
                    if (pending.binding === null) compact.b = 0;
                    else {
                        const b = pending.binding || {};
                        const mf = Array.isArray(b.multiFrames)
                            ? b.multiFrames.filter(v => Number.isFinite(v)).map(v => Number(v))
                            : null;
                        compact.b = {
                            a: b.anim || this.selectedAnimation,
                            i: Number(b.index) || 0,
                            m: (mf && mf.length > 0) ? mf : null
                        };
                    }
                }

                if (pending.transform !== undefined) {
                    if (pending.transform === null) compact.t = 0;
                    else {
                        const t = pending.transform || {};
                        compact.t = {
                            r: Number(t.rot || 0),
                            f: !!t.flipH ? 1 : 0
                        };
                    }
                }

                if (pending.waypoint !== undefined) compact.w = pending.waypoint ? 1 : 0;

                entries.push(compact);
            }

            for (let i = 0; i < entries.length; i += chunkSize) {
                const slice = entries.slice(i, i + chunkSize);
                this._opBuffer.push({
                    type: 'tileBlob',
                    client: this.clientId,
                    time: now,
                    tiles: slice
                });
            }

            this._tileOpPending.clear();
            return entries.length;
        } catch (e) {
            return 0;
        }
    }

    _queueTileStateOp(tileState = null) {
        try {
            if (this._suppressOutgoing) return false;
            const payload = tileState && typeof tileState === 'object' ? tileState : this._serializeTilemapState();
            if (!payload || typeof payload !== 'object') return false;
            this._tileStatePending = {
                type: 'tileState',
                client: this.clientId,
                time: Date.now(),
                tilemap: payload
            };
            this._scheduleSend && this._scheduleSend();
            return true;
        } catch (e) {
            return false;
        }
    }

    _flushPendingTileStateToBuffer() {
        try {
            if (!this._tileStatePending) return false;
            if (!this._opBuffer) this._opBuffer = [];
            this._opBuffer.push(this._tileStatePending);
            this._tileStatePending = null;
            return true;
        } catch (e) {
            return false;
        }
    }

    _flushPendingSpriteOpsToBuffer() {
        try {
            if (!this._spriteOpPending || this._spriteOpPending.size === 0) return 0;
            if (!this._opBuffer) this._opBuffer = [];
            const now = Date.now();
            const entries = [];
            for (const op of this._spriteOpPending.values()) {
                if (!op || typeof op !== 'object') continue;
                entries.push(op);
            }
            const chunkSize = 96;
            for (let i = 0; i < entries.length; i += chunkSize) {
                this._opBuffer.push({
                    type: 'spriteBlob',
                    client: this.clientId,
                    time: now,
                    ops: entries.slice(i, i + chunkSize)
                });
            }
            this._spriteOpPending.clear();
            return entries.length;
        } catch (e) {
            return 0;
        }
    }

    // Override Scene.sendState: send buffered pixel edit ops to server using per-op keys
    sendState() {
        try {
            if (!this._canSendCollab()) {
                // When collab data transport is not currently available (e.g. WebRTC down),
                // do NOT drop pending edits. Instead, flush pending tile/sprite ops into
                // the op buffer and hand the batch to the collab transport which will
                // queue and retry delivery when WebRTC returns. This avoids routing
                // data through the server while preserving edits.
                try {
                    this._flushPendingTileOpsToBuffer();
                    this._flushPendingSpriteOpsToBuffer();
                    if (this._opBuffer && this._opBuffer.length > 0) {
                        const batch = this._opBuffer.splice(0, 512);
                        const diff = {};
                        for (const op of batch) {
                            const id = (op.time || Date.now()) + '_' + Math.random().toString(36).slice(2,6);
                            diff['edits/' + id] = op;
                        }
                        try { this._sendCollabDiff(diff); } catch (e) { /* enqueue attempt failed */ }
                    }
                } catch (e) { /* ignore flush errors */ }
                // schedule a retry later
                this._scheduleSend();
                return;
            }

            // Full tile-state blob sync is disabled in favor of granular layer-aware tile ops.
            // Clear any stale pending state blob (e.g. from older runtime state) to avoid
            // oversized payloads that can block transport updates.
            this._tileStatePending = null;

            // Coalesce queued per-tile mutations into compact tileBlob ops.
            this._flushPendingTileOpsToBuffer();
            this._flushPendingSpriteOpsToBuffer();

            // Build an update object mapping nested keys to op payloads so firebase update() creates distinct children
            const diff = {};
            if (this._opBuffer && this._opBuffer.length > 0) {
                // limit how many ops we send in one batch to avoid huge updates
                const batch = this._opBuffer.splice(0, 512);
                for (const op of batch) {
                    const id = (op.time || Date.now()) + '_' + Math.random().toString(36).slice(2,6);
                    // store under edits/<id>
                    diff['edits/' + id] = op;
                }
            }

            if (Object.keys(diff).length > 0) {
                try { this._sendCollabDiff(diff); } catch (e) { console.warn('sendState sendDiff failed', e); }
            }

            // If backlog remains, keep draining without waiting for new edits.
            if ((this._opBuffer && this._opBuffer.length > 0) || (this._tileOpPending && this._tileOpPending.size > 0) || (this._spriteOpPending && this._spriteOpPending.size > 0)) {
                this._scheduleSend();
            }
        } catch (e) { console.warn('sendState failed', e); }
    }

    // Apply remote state sent by other clients. Accepts the full remote state blob.
    applyRemoteState(state) {
        try {
            if (!state) return;
            try {
                if (this.webrtcCollab && typeof this.webrtcCollab.handleRemoteState === 'function') {
                    this.webrtcCollab.handleRemoteState(state);
                }
            } catch (e) { /* ignore webrtc signal parsing failures */ }
            // Handle sync handshake (pause + full snapshot) before applying incremental edits
            try {
                const blocking = this._handleSyncState(state.sync || null);
                if (blocking) return; // wait until sync completes before applying edits
            } catch (e) { console.warn('applyRemoteState sync handler failed', e); }
            // state may contain an `edits` object (map of id -> op)
            const edits = state.edits || null;
            // also handle structural metadata under state.meta.animations
            const meta = (state && state.meta && state.meta.animations) ? state.meta.animations : null;
            const sheet = this.currentSprite;
            if (!sheet && !meta) return;

            let applied = 0;

            // Detect which animations have explicit structural ops in this batch so we
            // don't also try to "fix up" their frame counts using only totals.
            const structAnims = new Set();
            try {
                if (edits && typeof edits === 'object') {
                    for (const id of Object.keys(edits)) {
                        try {
                            const op = edits[id];
                            if (op && op.type === 'struct' && op.anim) structAnims.add(op.anim);
                        } catch (e) { continue; }
                    }
                }
            } catch (e) { /* ignore struct detection errors */ }

            // First apply metadata structural changes (create/remove frames) while suppressing outgoing echoes.
            // Skip animations that already have explicit struct ops in this batch to avoid double-applying
            // inserts/deletes and desynchronizing indices.
            if (meta && typeof meta === 'object') {
                try {
                    this._suppressOutgoing = true;
                    for (const anim of Object.keys(meta)) {
                        try {
                            if (structAnims.has(anim)) continue; // this anim handled by struct ops below
                            const targetCount = Number(meta[anim]) || 0;
                            // ensure frames array exists
                            if (!this.currentSprite._frames.has(anim)) this.currentSprite._frames.set(anim, []);
                            const arr = this.currentSprite._frames.get(anim) || [];
                            // compute logical count
                            let logical = 0;
                            for (let i = 0; i < arr.length; i++) { const e = arr[i]; if (!e) continue; if (e.__groupStart||e.__groupEnd) continue; logical++; }
                            if (logical < targetCount) {
                                // add frames
                                for (let k = 0; k < (targetCount - logical); k++) {
                                    try { this.currentSprite.insertFrame(anim); } catch(e){}
                                    try { this._syncPixelLayerAnimationStructure('insert', anim, null); } catch (e) {}
                                }
                            } else if (logical > targetCount) {
                                // remove frames (from the end when no struct ops are present)
                                for (let k = 0; k < (logical - targetCount); k++) {
                                    try { this.currentSprite.popFrame(anim); } catch(e){}
                                    try { this._syncPixelLayerAnimationStructure('delete', anim, null); } catch (e) {}
                                }
                            }
                        } catch(e){}
                    }
                } finally { this._suppressOutgoing = false; }
                // rebuild packed sheet to reflect structural changes
                try { if (typeof sheet._rebuildSheetCanvas === 'function') sheet._rebuildSheetCanvas(); } catch(e){}
            }

            // handle incoming chat/messages under state.messages
            const msgs = state.messages || null;
            if (msgs && typeof msgs === 'object') {
                for (const mid of Object.keys(msgs)) {
                    try {
                        if (this._seenMsgIds && this._seenMsgIds.has(mid)) continue;
                        const m = msgs[mid];
                        if (!m) { if (this._seenMsgIds) this._seenMsgIds.add(mid); continue; }
                        const from = m.from || m.client || 'anon';
                        const text = m.text || '';
                        try { console.log('[msg] ' + from + ': ' + text); } catch (e) {}
                        if (this._seenMsgIds) this._seenMsgIds.add(mid);
                    } catch (e) { continue; }
                }
            }
            // handle incoming cursors under state.cursors
            try {
                const curs = state.cursors || null;
                if (curs && typeof curs === 'object') {
                    for (const cid of Object.keys(curs)) {
                        try {
                            const c = curs[cid];
                            if (!c) { try { this._remoteCursors && this._remoteCursors.delete(cid); } catch(e){}; continue; }
                            // skip own cursor (we already send our own)
                            if (cid === this.clientId) continue;
                            const entry = {
                                x: Number(c.x || 0),
                                y: Number(c.y || 0),
                                time: Number(c.time || Date.now()),
                                client: cid,
                                zx: Number.isFinite(Number(c.zx)) ? Number(c.zx) : null,
                                zy: Number.isFinite(Number(c.zy)) ? Number(c.zy) : null,
                                ox: Number.isFinite(Number(c.ox)) ? Number(c.ox) : null,
                                oy: Number.isFinite(Number(c.oy)) ? Number(c.oy) : null,
                                tm: Number(c.tm || 0),
                                inside: Number(c.in || 0),
                                renderOnly: Number(c.ro || 0),
                                px: Number.isFinite(Number(c.px)) ? Number(c.px) : null,
                                py: Number.isFinite(Number(c.py)) ? Number(c.py) : null,
                                tc: Number.isFinite(Number(c.tc)) ? Number(c.tc) : null,
                                tr: Number.isFinite(Number(c.tr)) ? Number(c.tr) : null,
                                ai: Number.isFinite(Number(c.ai)) ? Number(c.ai) : null,
                                bs: Math.max(1, Math.min(64, Number(c.bs) || 1)),
                                sel: (c.sel && typeof c.sel === 'object') ? c.sel : null
                            };
                            if (c.name) entry.name = c.name;
                            try { this._remoteCursors && this._remoteCursors.set(cid, entry); } catch(e){}
                        } catch (e) { continue; }
                    }
                }
            } catch (e) {}
            try {
                const sims = state.playerSims || null;
                if (sims && typeof sims === 'object') {
                    for (const cid of Object.keys(sims)) {
                        try {
                            if (!cid || cid === this.clientId) continue;
                            const raw = sims[cid];
                            if (!raw || raw === null) {
                                try { this._remotePlayerSims && this._remotePlayerSims.delete(cid); } catch (e) {}
                                continue;
                            }
                            const normalized = this._normalizeIncomingPlayerSim(raw);
                            if (!normalized) {
                                try { this._remotePlayerSims && this._remotePlayerSims.delete(cid); } catch (e) {}
                                continue;
                            }
                            try { this._upsertRemotePlayerSim(cid, normalized); } catch (e) {}
                        } catch (e) { continue; }
                    }
                }
            } catch (e) {}
            if (!edits || typeof edits !== 'object') return;
            for (const id of Object.keys(edits)) {
                if (this._seenOpIds && this._seenOpIds.has(id)) continue;
                const op = edits[id];
                // record seen remote edit time so we can prune old entries later
                try { if (this._remoteEdits) this._remoteEdits.set(id, (op && op.time) ? Number(op.time) : Date.now()); } catch (e) {}
                if (!op || op.client === this.clientId) {
                    // ignore self-originated edits
                    if (this._seenOpIds) this._seenOpIds.add(id);
                    continue;
                }
                try {
                    if (op.type === 'struct') {
                        // Structural operations: explicit insert/delete of frames at a logical index.
                        try {
                            if (!this.currentSprite) { /* nothing to apply */ }
                            else if (op.action === 'insertFrame') {
                                const idx = (typeof op.index === 'number' && op.index >= 0) ? Number(op.index) : undefined;
                                try { this._suppressOutgoing = true; this.currentSprite.insertFrame(op.anim, idx); } finally { this._suppressOutgoing = false; }
                                try { this._syncPixelLayerAnimationStructure('insert', op.anim, idx); } catch (e) {}
                                applied++;
                            } else if (op.action === 'deleteFrame') {
                                const idx = (typeof op.index === 'number' && op.index >= 0) ? Number(op.index) : undefined;
                                try { this._suppressOutgoing = true; this.currentSprite.popFrame(op.anim, idx); } finally { this._suppressOutgoing = false; }
                                try { this._syncPixelLayerAnimationStructure('delete', op.anim, idx); } catch (e) {}
                                applied++;
                            } else if (op.action === 'renameAnimation') {
                                const from = String(op.from || '').trim();
                                const to = String(op.to || '').trim();
                                if (from && to && from !== to) {
                                    try {
                                        this._suppressOutgoing = true;
                                        if (typeof this.currentSprite.renameAnimation === 'function') {
                                            this.currentSprite.renameAnimation(from, to);
                                        } else if (this.currentSprite._frames && !this.currentSprite._frames.has(to) && this.currentSprite._frames.has(from)) {
                                            const arr = this.currentSprite._frames.get(from);
                                            this.currentSprite._frames.set(to, arr);
                                            this.currentSprite._frames.delete(from);
                                            if (typeof this.currentSprite._rebuildSheetCanvas === 'function') this.currentSprite._rebuildSheetCanvas();
                                        }
                                    } finally {
                                        this._suppressOutgoing = false;
                                    }
                                    try { this._syncPixelLayerAnimationStructure('rename', from, null, to); } catch (e) {}
                                    try { this._remapAnimationReferences(from, to); } catch (e) {}
                                    try { this._onAnimationRenamed(from, to); } catch (e) {}
                                    applied++;
                                }
                            }
                        } catch (e) { /* ignore struct op errors */ }
                    } else if (op.type === 'tileState' && op.tilemap && typeof op.tilemap === 'object') {
                        try {
                            this._suppressOutgoing = true;
                            this._applyTilemapState(op.tilemap);
                            applied++;
                        } catch (e) { /* ignore tile state op errors */ }
                        finally { this._suppressOutgoing = false; }
                    } else if (op.type === 'tile') {
                        try {
                            const col = Number(op.col);
                            const row = Number(op.row);
                            if (!Number.isFinite(col) || !Number.isFinite(row)) {
                                if (this._seenOpIds) this._seenOpIds.add(id);
                                continue;
                            }
                            this._suppressOutgoing = true;
                            const c = col|0;
                            const r = row|0;
                            const layerIndex = Number.isFinite(Number(op.layer))
                                ? this._ensureTileLayerIndex(Number(op.layer))
                                : this._resolveTileLayerIndex(op.layer, false);
                            if (op.action === 'activate') {
                                this._activateTile(c, r, false);
                            } else if (op.action === 'deactivate') {
                                this._deactivateTile(c, r, false);
                            } else if (op.action === 'bind') {
                                const idx = this._getAreaIndexForCoord(c, r);
                                this._activateTile(c, r, false);
                                const mf = Array.isArray(op.multiFrames)
                                    ? op.multiFrames.filter(v => Number.isFinite(v)).map(v => Number(v))
                                    : null;
                                this._setAreaBindingAtIndexForLayer(idx, layerIndex, {
                                    anim: op.anim || this.selectedAnimation,
                                    index: Number(op.index) || 0,
                                    multiFrames: (mf && mf.length > 0) ? mf : null
                                });
                            } else if (op.action === 'clearBinding') {
                                const idx = this._getAreaIndexForCoord(c, r);
                                this._setAreaBindingAtIndexForLayer(idx, layerIndex, null);
                            } else if (op.action === 'setTransform') {
                                const idx = this._getAreaIndexForCoord(c, r);
                                this._activateTile(c, r, false);
                                this._setAreaTransformAtIndexForLayer(idx, layerIndex, { rot: Number(op.rot || 0), flipH: !!op.flipH });
                            } else if (op.action === 'clearTransform') {
                                const idx = this._getAreaIndexForCoord(c, r);
                                this._setAreaTransformAtIndexForLayer(idx, layerIndex, null);
                            } else if (op.action === 'setWaypoint') {
                                this._setWaypointAtTile(c, r, false);
                            } else if (op.action === 'clearWaypoint') {
                                this._removeWaypointAtTile(c, r, false);
                            }
                            applied++;
                        } catch (e) { /* ignore tile op errors */ }
                        finally { this._suppressOutgoing = false; }
                    } else if (op.type === 'tileBlob' && Array.isArray(op.tiles)) {
                        try {
                            this._suppressOutgoing = true;
                            for (const tile of op.tiles) {
                                if (!tile) continue;
                                const c = Number(tile.c !== undefined ? tile.c : tile.col);
                                const r = Number(tile.r !== undefined ? tile.r : tile.row);
                                if (!Number.isFinite(c) || !Number.isFinite(r)) continue;
                                const col = c | 0;
                                const row = r | 0;
                                const rawLayer = (tile.l !== undefined ? tile.l : tile.layer);
                                const layerIndex = Number.isFinite(Number(rawLayer))
                                    ? this._ensureTileLayerIndex(Number(rawLayer))
                                    : this._resolveTileLayerIndex(rawLayer, false);
                                const idx = this._getAreaIndexForCoord(col, row);

                                if (tile.a !== undefined) {
                                    if (Number(tile.a) === 1) this._activateTile(col, row, false);
                                    else if (Number(tile.a) === 0) this._deactivateTile(col, row, false);
                                }

                                if (tile.b !== undefined) {
                                    if (tile.b === 0) this._setAreaBindingAtIndexForLayer(idx, layerIndex, null);
                                    else {
                                        const b = tile.b || {};
                                        const mf = Array.isArray(b.m)
                                            ? b.m.filter(v => Number.isFinite(v)).map(v => Number(v))
                                            : (Array.isArray(b.multiFrames) ? b.multiFrames.filter(v => Number.isFinite(v)).map(v => Number(v)) : null);
                                        this._activateTile(col, row, false);
                                        this._setAreaBindingAtIndexForLayer(idx, layerIndex, {
                                            anim: b.a || b.anim || this.selectedAnimation,
                                            index: Number(b.i !== undefined ? b.i : b.index) || 0,
                                            multiFrames: (mf && mf.length > 0) ? mf : null
                                        });
                                    }
                                }

                                if (tile.t !== undefined) {
                                    if (tile.t === 0) this._setAreaTransformAtIndexForLayer(idx, layerIndex, null);
                                    else {
                                        const t = tile.t || {};
                                        this._activateTile(col, row, false);
                                        this._setAreaTransformAtIndexForLayer(idx, layerIndex, {
                                            rot: Number(t.r !== undefined ? t.r : t.rot) || 0,
                                            flipH: !!(t.f !== undefined ? Number(t.f) : t.flipH)
                                        });
                                    }
                                }

                                if (tile.w !== undefined) {
                                    if (Number(tile.w) === 1) this._setWaypointAtTile(col, row, false);
                                    else if (Number(tile.w) === 0) this._removeWaypointAtTile(col, row, false);
                                }
                            }
                            applied++;
                        } catch (e) { /* ignore tile blob errors */ }
                        finally { this._suppressOutgoing = false; }
                    } else if (op.type === 'spriteBlob' && Array.isArray(op.ops)) {
                        try {
                            this._suppressOutgoing = true;
                            this._normalizeSpriteLayerState();
                            for (const sop of op.ops) {
                                if (!sop || typeof sop !== 'object') continue;
                                if (sop.k === 'add' && sop.e && sop.e.id) {
                                    const layer = this._normalizeSpriteLayerState();
                                    const id = String(sop.e.id);
                                    layer.entities[id] = { ...sop.e };
                                    if (!Array.isArray(layer.order)) layer.order = [];
                                    if (!layer.order.includes(id)) layer.order.push(id);
                                    const numericId = Number(String(id).replace(/^sp_/, ''));
                                    if (Number.isFinite(numericId)) layer.nextEntityId = Math.max(Number(layer.nextEntityId) || 1, numericId + 1);
                                } else if (sop.k === 'update' && sop.id) {
                                    const entities = this._getSpriteEntities();
                                    const id = String(sop.id);
                                    if (entities[id]) Object.assign(entities[id], sop.p || {});
                                } else if (sop.k === 'delete' && sop.id) {
                                    this._deleteSpriteEntity(String(sop.id), false);
                                } else if (sop.k === 'profile' && sop.anim) {
                                    this._setSpriteAnimationProfile(String(sop.anim), { fps: Number(sop.fps) || 0, parent: sop.parent || null }, false);
                                }
                            }
                            applied++;
                        } catch (e) { /* ignore sprite blob errors */ }
                        finally { this._suppressOutgoing = false; }
                    } else if (op.type === 'tileConn' && typeof op.key === 'string' && op.anim !== undefined) {
                        try {
                            this._suppressOutgoing = true;
                            const animName = String(op.anim || '');
                            const frameIdx = (Number.isFinite(Number(op.index)) ? Number(op.index) : null);
                            const key = String(op.key || '');
                            if (animName && frameIdx !== null) {
                                try {
                                    if (!this._tileConnMap || typeof this._tileConnMap !== 'object') this._tileConnMap = {};
                                    const norm = (typeof this._normalizeOpenConnectionKey === 'function') ? this._normalizeOpenConnectionKey(key) : String(key).replace(/[^01]/g, '').padEnd(8, '0').slice(0, 8);
                                    this._tileConnMap[animName + '::' + (frameIdx|0)] = norm;
                                    try { if (this.FrameSelect && typeof this.FrameSelect.rebuild === 'function') this.FrameSelect.rebuild(); } catch (e) {}
                                    applied++;
                                } catch (e) {}
                            }
                        } catch (e) { /* ignore */ }
                        finally { this._suppressOutgoing = false; }
                    } else if (op.type === 'frameData' && typeof op.dataUrl === 'string' && op.anim !== undefined) {
                        try {
                            this._suppressOutgoing = true;
                            const animName = String(op.anim || '');
                            const frameIdx = (Number.isFinite(Number(op.index)) ? Number(op.index) : null);
                            const dataUrl = String(op.dataUrl || '');
                            const dstFrame = (frameIdx !== null && typeof sheet.getFrame === 'function') ? sheet.getFrame(animName, frameIdx) : null;
                            if (dstFrame && dstFrame.getContext) {
                                const ctx = dstFrame.getContext('2d');
                                const img = new Image();
                                img.onload = () => {
                                    try { ctx.clearRect(0, 0, dstFrame.width, dstFrame.height); ctx.drawImage(img, 0, 0, dstFrame.width, dstFrame.height); } catch (e) {}
                                    try { if (typeof sheet._rebuildSheetCanvas === 'function') sheet._rebuildSheetCanvas(); } catch (e) {}
                                };
                                img.onerror = () => {};
                                img.src = dataUrl;
                                applied++;
                            }
                        } catch (e) { /* ignore */ }
                        finally { this._suppressOutgoing = false; }
                    } else if (op.type === 'draw' && Array.isArray(op.pixels)) {
                        // Apply incoming draw ops as-is and rely on server/update
                        // ordering, instead of comparing client-local timestamps.
                        // Using Date.now() across machines can easily become
                        // skewed (one clock ahead/behind), which caused one
                        // client to "always win" and the other client's edits
                        // to be ignored. We now accept all remote pixels and
                        // let the latest-arriving update win visually.
                        const toApply = [];
                        for (const p of op.pixels) {
                            try {
                                const px = Number(p.x);
                                const py = Number(p.y);
                                if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
                                toApply.push({ x: px, y: py, color: p.color || '#000000' });
                            } catch (e) { continue; }
                        }
                        if (toApply.length) {
                            const prevLayer = this._activePixelLayerIndex | 0;
                            const opLayer = Number.isFinite(Number(op.pixelLayer))
                                ? Math.max(0, Math.min(Number(op.pixelLayer) | 0, Math.max(0, (this._pixelLayers?.length || 1) - 1)))
                                : prevLayer;
                            try {
                                this._activePixelLayerIndex = opLayer;
                                if (typeof sheet.drawPixels === 'function') {
                                    try { this._suppressOutgoing = true; sheet.drawPixels(op.anim, op.frame, toApply); } catch (e) {
                                        for (const px of toApply) { try { sheet.setPixel(op.anim, op.frame, px.x, px.y, px.color, 'replace'); } catch (er) {} }
                                    } finally { this._suppressOutgoing = false; }
                                } else {
                                    try { this._suppressOutgoing = true; for (const px of toApply) { try { sheet.setPixel(op.anim, op.frame, px.x, px.y, px.color, 'replace'); } catch (er) {} } } finally { this._suppressOutgoing = false; }
                                }
                            } finally {
                                this._activePixelLayerIndex = prevLayer;
                            }
                            // mark applied pixels as modified at remote op time
                            try { const t = op.time || Date.now(); for (const a of toApply) { try { this._markPixelModified(op.anim, op.frame, a.x, a.y, t); } catch(e){} } } catch(e){}
                            applied++;
                        }
                    }
                } catch (e) { /* ignore per-op apply errors */ }
                if (this._seenOpIds) this._seenOpIds.add(id);
            }
            if (applied > 0) {
                try { if (typeof sheet._rebuildSheetCanvas === 'function') sheet._rebuildSheetCanvas(); } catch (e) {}
            }
        } catch (e) { console.warn('applyRemoteState failed', e); }
    }

    // Sync handshake handler: coordinates pause, snapshot build/apply and acknowledgements.
    // Returns true when callers should skip further remote processing (while paused).
    _handleSyncState(sync) {
        if (!sync || typeof sync !== 'object') return false;
        const status = sync.status || 'idle';
        const requestId = sync.requestId || sync.reqId || null;
        const paused = !!sync.paused;

        // New request -> reset applied guard so we accept the incoming snapshot
        if (status === 'pending' && requestId && this._lastSyncSnapshotId !== requestId) {
            this._lastSyncSnapshotId = null;
        }

        if (paused) this._enterSyncPause('Syncing...');
        else if (!paused && this._syncPaused && status === 'done') this._exitSyncPause();

        // Host builds and publishes a full snapshot once per request
        if (status === 'pending' && requestId && this._isHostClient() && this._syncBuildInFlight !== requestId && this._lastSyncRequestId !== requestId) {
            this._syncBuildInFlight = requestId;
            try {
                const snapshot = this._buildFullSnapshot();
                if (snapshot) {
                    const diff = {};
                    diff['sync/requestId'] = requestId;
                    diff['sync/status'] = 'ready';
                    diff['sync/host'] = this.clientId;
                    diff['sync/paused'] = true;
                    diff['sync/snapshot'] = snapshot;
                    diff['sync/message'] = 'snapshot-ready';
                    diff['sync/acks'] = null;
                    if (sync.requester) diff['sync/requester'] = sync.requester;
                    try { this._sendHandshakeSignal(diff); } catch (e) { console.warn('sync snapshot send failed', e); }
                    this._lastSyncRequestId = requestId;
                }
            } finally {
                this._syncBuildInFlight = null;
            }
        }

        // Apply snapshot when ready
        if (status === 'ready' && requestId && sync.snapshot) {
            const alreadyApplied = (this._lastSyncSnapshotId === requestId);
            if (!alreadyApplied && (!this._syncApplyInFlight || this._syncApplyInFlight.id !== requestId)) {
                const promise = (async () => {
                    try {
                        await this._applySnapshot(sync.snapshot, requestId);
                        this._lastSyncSnapshotId = requestId;
                        this._sendSyncAck(requestId);
                    } catch (e) {
                        console.warn('apply snapshot failed', e);
                    }
                })();
                this._syncApplyInFlight = { id: requestId, promise };
            }
        }

        // Host finishes sync once requester acks
        const requester = sync.requester || null;
        const acks = (sync.acks && typeof sync.acks === 'object') ? sync.acks : null;
        // Consider sync complete if requester acked OR any client has acked this requestId
        const anyAcked = (() => {
            if (!acks) return false;
            const values = Object.values(acks);
            return values.some(v => v === requestId);
        })();
        const requesterAcked = requester && acks && acks[requester] === requestId;
        if (status === 'ready' && requestId && this._isHostClient() && (requesterAcked || anyAcked)) {
            const diff = {
                'sync/status': 'done',
                'sync/paused': false,
                'sync/lastComplete': requestId,
                'sync/snapshot': null,
                'sync/acks': null,
                'sync/message': null
            };
            try { this._sendHandshakeSignal(diff); } catch (e) { console.warn('sync completion send failed', e); }
        }

        if (status === 'done' && this._syncPaused) this._exitSyncPause();

        // Block downstream remote processing while syncing to avoid diverging edits
        if ((paused || status === 'pending' || status === 'ready') && status !== 'done') return true;
        return false;
    }

    _isHostClient() {
        try { return (this.server && this.server.playerId === 'p1'); } catch (e) { return false; }
    }

    _ensureSyncOverlay(message = 'Syncing...') {
        if (this._syncOverlay) {
            if (this._syncOverlayLabel && message) this._syncOverlayLabel.textContent = message;
            return this._syncOverlay;
        }
        const size = new Vector(380, 120);
        const pos = new Vector((1920 - size.x) / 2, (1080 - size.y) / 2);
        const panel = createHDiv('sync-overlay', pos, size, '#000000CC', {
            borderRadius: '10px',
            border: '1px solid #666',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: '18px',
            fontFamily: 'sans-serif',
            padding: '12px',
            gap: '6px',
            backdropFilter: 'blur(4px)'
        }, 'UI');
        panel.style.pointerEvents = 'auto';
        panel.style.zIndex = 2000;
        const label = document.createElement('div');
        label.textContent = message;
        label.style.color = '#fff';
        label.style.textAlign = 'center';
        label.style.fontSize = '18px';
        label.style.width = '100%';
        label.setAttribute('data-ui','1');
        panel.appendChild(label);
        panel.style.display = 'none';
        this._syncOverlay = panel;
        this._syncOverlayLabel = label;
        return panel;
    }

    _showSyncOverlay(message = 'Syncing...') {
        const panel = this._ensureSyncOverlay(message);
        if (this._syncOverlayLabel && message) this._syncOverlayLabel.textContent = message;
        if (panel) panel.style.display = 'flex';
    }

    _hideSyncOverlay() {
        if (this._syncOverlay) {
            this._syncOverlay.style.display = 'none';
        }
    }

    _enterSyncPause(message = 'Syncing...') {
        this._syncPaused = true;
        try { this.pause(); } catch (e) { this.paused = true; }
        this._showSyncOverlay(message);
    }

    _exitSyncPause() {
        this._syncPaused = false;
        this._hideSyncOverlay();
        try { this.unpause(); } catch (e) { this.paused = false; }
    }

    _buildFullSnapshot() {
        try {
            const sheet = this.currentSprite;
            if (!sheet || !sheet._frames) return null;
            const snap = {
                slicePx: sheet.slicePx || 16,
                time: Date.now(),
                client: this.clientId,
                frames: {},
                animations: {},
                activePixelLayerIndex: Math.max(0, Number(this._activePixelLayerIndex) | 0),
                pixelLayers: [],
                pixelLayerFrames: {},
                tileCols: this.tileCols,
                tileRows: this.tileRows,
                activeTileLayerIndex: Math.max(0, Number(this._activeTileLayerIndex) | 0),
                tileLayers: [],
                spriteLayer: null,
            };
            if (Array.isArray(this._areaBindings)) {
                snap.bindings = this._areaBindings.map((b, i) => {
                    if (!b) return null;
                    const mf = Array.isArray(b.multiFrames) ? b.multiFrames.filter(v => Number.isFinite(v)).map(v => Number(v)) : null;
                    const coord = (this._tileIndexToCoord && this._tileIndexToCoord[i]) ? this._tileIndexToCoord[i] : null;
                    return { anim: b.anim, index: Number(b.index), multiFrames: (mf && mf.length > 0) ? mf.slice() : null, col: coord ? coord.col : null, row: coord ? coord.row : null };
                });
            }
            if (this._tileActive && this._tileActive.size > 0) {
                snap.activeTiles = Array.from(this._tileActive.values()).map(k => this._parseTileKey(k)).filter(Boolean);
            }
            snap.waypoints = this._getWaypointCoords(false).map((wp) => ({ col: wp.col, row: wp.row }));
            if (Array.isArray(this._areaTransforms)) snap.transforms = this._areaTransforms.slice();
            this._ensureLayerState();
            if (Array.isArray(this._tileLayers)) {
                for (let li = 0; li < this._tileLayers.length; li++) {
                    const layer = this._tileLayers[li] || {};
                    const out = {
                        name: String(layer.name || ('Tile Layer ' + (li + 1))),
                        visibility: this._normalizeTileLayerVisibility(layer && layer.visibility, 0),
                        bindings: [],
                        transforms: []
                    };
                    const srcBindings = Array.isArray(layer.bindings) ? layer.bindings : [];
                    for (let i = 0; i < srcBindings.length; i++) {
                        const b = srcBindings[i];
                        if (!b || typeof b !== 'object') continue;
                        const coord = (this._tileIndexToCoord && this._tileIndexToCoord[i]) ? this._tileIndexToCoord[i] : null;
                        if (!coord) continue;
                        const mf = Array.isArray(b.multiFrames) ? b.multiFrames.filter(v => Number.isFinite(v)).map(v => Number(v)) : null;
                        out.bindings.push({
                            anim: b.anim,
                            index: Number(b.index),
                            multiFrames: (mf && mf.length > 0) ? mf.slice() : null,
                            col: Number(coord.col),
                            row: Number(coord.row)
                        });
                    }
                    const srcTransforms = Array.isArray(layer.transforms) ? layer.transforms : [];
                    for (let i = 0; i < srcTransforms.length; i++) {
                        const t = srcTransforms[i];
                        if (!t || typeof t !== 'object') continue;
                        const coord = (this._tileIndexToCoord && this._tileIndexToCoord[i]) ? this._tileIndexToCoord[i] : null;
                        if (!coord) continue;
                        out.transforms.push({
                            rot: Number(t.rot || 0),
                            flipH: !!t.flipH,
                            col: Number(coord.col),
                            row: Number(coord.row)
                        });
                    }
                    snap.tileLayers.push(out);
                }
            }
            if (Array.isArray(this._pixelLayers)) {
                snap.pixelLayers = this._pixelLayers.map((l, i) => ({
                    name: String((l && l.name) || ('Pixel Layer ' + (i + 1))),
                    visibility: this._normalizePixelLayerVisibility(l && l.visibility, 0)
                }));
            }
            this._ensurePixelLayerStore();
            try {
                const layer = this._normalizeSpriteLayerState();
                if (layer) {
                    const entities = {};
                    for (const id of Object.keys(layer.entities || {})) {
                        const e = layer.entities[id];
                        if (!e) continue;
                        entities[id] = { ...e };
                    }
                    snap.spriteLayer = {
                        selectedAnimation: layer.selectedAnimation || null,
                        selectedEntityId: layer.selectedEntityId || null,
                        nextEntityId: Number(layer.nextEntityId) || 1,
                        entities,
                        order: Array.isArray(layer.order) ? layer.order.slice() : [],
                        animationProfiles: JSON.parse(JSON.stringify(layer.animationProfiles || {})),
                        clipboard: layer.clipboard ? JSON.parse(JSON.stringify(layer.clipboard)) : null
                    };
                }
            } catch (e) { /* ignore sprite snapshot errors */ }
            const animNames = Array.from(sheet._frames.keys());
            let row = 0;
            for (const name of animNames) {
                const arr = sheet._frames.get(name) || [];
                const frames = [];
                let logical = 0;
                for (let i = 0; i < arr.length; i++) {
                    const entry = arr[i];
                    if (!entry || entry.__groupStart || entry.__groupEnd) continue;
                    const frameCanvas = this._rawSheetGetFrame(name, logical);
                    let dataUrl = null;
                    try { dataUrl = frameCanvas && frameCanvas.toDataURL ? frameCanvas.toDataURL('image/png') : null; } catch (e) { dataUrl = null; }
                    frames.push(dataUrl);
                    logical++;
                }
                snap.frames[name] = frames;
                snap.animations[name] = { row, frames: frames.length };
                row++;
            }

            for (let li = 1; li < (this._pixelLayers?.length || 0); li++) {
                const outByAnim = {};
                for (const name of animNames) {
                    const frameCount = (snap.frames && Array.isArray(snap.frames[name])) ? snap.frames[name].length : 0;
                    const arr = [];
                    for (let fi = 0; fi < frameCount; fi++) {
                        const frameCanvas = this._ensurePixelLayerFrameCanvas(li, name, fi, false);
                        let dataUrl = null;
                        try { dataUrl = frameCanvas && frameCanvas.toDataURL ? frameCanvas.toDataURL('image/png') : null; } catch (e) { dataUrl = null; }
                        arr.push(dataUrl);
                    }
                    outByAnim[name] = arr;
                }
                snap.pixelLayerFrames[String(li)] = outByAnim;
            }
            return snap;
        } catch (e) {
            console.warn('_buildFullSnapshot failed', e);
            return null;
        }
    }

    async _applySnapshot(snapshot, requestId = null) {
        if (!snapshot || !snapshot.frames) return false;
        this._enterSyncPause('Syncing...');
        this._suppressOutgoing = true;
        try {
            const slice = Number(snapshot.slicePx || (this.currentSprite && this.currentSprite.slicePx) || 16);
            const sheet = this.currentSprite || SpriteSheet.createNew(slice, 'idle');
            if (!this.currentSprite) this.currentSprite = sheet;
            try { if (typeof sheet.disposeAll === 'function') sheet.disposeAll(); } catch (e) { /* ignore */ }
            sheet.slicePx = slice;
            sheet._frames = new Map();
            sheet.animations = new Map();

            const animNames = Object.keys(snapshot.frames || {});
            let row = 0;
            for (const name of animNames) {
                const frameUrls = snapshot.frames[name] || [];
                const arr = [];
                for (const dataUrl of frameUrls) {
                    const c = document.createElement('canvas');
                    c.width = slice; c.height = slice;
                    const ctx = c.getContext('2d');
                    ctx.clearRect(0, 0, c.width, c.height);
                    if (dataUrl) {
                        try { await this._drawDataUrlToCanvas(ctx, dataUrl, slice, slice); } catch (e) { /* blank on error */ }
                    }
                    arr.push(c);
                }
                sheet._frames.set(name, arr);
                sheet.animations.set(name, { row, frameCount: arr.length });
                row++;
            }
            this._pixelLayers = (Array.isArray(snapshot.pixelLayers) && snapshot.pixelLayers.length > 0)
                ? snapshot.pixelLayers.map((src, i) => {
                    const l = (src && typeof src === 'object') ? src : { name: String(src || '') };
                    return {
                        name: String(l.name || ('Pixel Layer ' + (i + 1))).trim() || ('Pixel Layer ' + (i + 1)),
                        visibility: this._normalizePixelLayerVisibility(l.visibility, 0)
                    };
                })
                : [{ name: 'Pixel Layer 1', visibility: 0 }];
            this._activePixelLayerIndex = Math.max(0, Math.min(Number(snapshot.activePixelLayerIndex) | 0, this._pixelLayers.length - 1));
            this._pixelLayerStores = [];
            this._ensurePixelLayerStore();

            const plFrames = (snapshot && snapshot.pixelLayerFrames && typeof snapshot.pixelLayerFrames === 'object') ? snapshot.pixelLayerFrames : {};
            for (let li = 1; li < this._pixelLayers.length; li++) {
                const byAnim = plFrames[String(li)] || {};
                for (const name of animNames) {
                    const urls = Array.isArray(byAnim[name]) ? byAnim[name] : [];
                    for (let fi = 0; fi < urls.length; fi++) {
                        const dataUrl = urls[fi];
                        if (!dataUrl) continue;
                        const c = this._ensurePixelLayerFrameCanvas(li, name, fi, true);
                        if (!c) continue;
                        const ctx = c.getContext('2d');
                        try { ctx.clearRect(0, 0, c.width, c.height); } catch (e) {}
                        try { await this._drawDataUrlToCanvas(ctx, dataUrl, c.width, c.height); } catch (e) {}
                    }
                }
            }
            this._installPixelLayerHooks();
            try { sheet._rebuildSheetCanvas(); } catch (e) {}
            if (this.stateController) this.stateController.setActiveSelection(animNames[0] || this.selectedAnimation || 'idle', 0);
            else {
                this.selectedAnimation = animNames[0] || this.selectedAnimation || 'idle';
                this.selectedFrame = 0;
            }
            if (this.FrameSelect) {
                this.FrameSelect.sprite = sheet;
                try { if (this.FrameSelect._multiSelected) this.FrameSelect._multiSelected.clear(); } catch (e) {}
                try { if (typeof this.FrameSelect.rebuild === 'function') this.FrameSelect.rebuild(); } catch (e) {}
            }
            if (Number.isFinite(snapshot.tileCols) || Number.isFinite(snapshot.tileRows)) {
                const cols = Number.isFinite(snapshot.tileCols) ? snapshot.tileCols : this.tileCols;
                const rows = Number.isFinite(snapshot.tileRows) ? snapshot.tileRows : this.tileRows;
                if (this.stateController) this.stateController.setTileGrid(cols, rows);
                else {
                    if (Number.isFinite(snapshot.tileCols)) this.tileCols = snapshot.tileCols;
                    if (Number.isFinite(snapshot.tileRows)) this.tileRows = snapshot.tileRows;
                }
            }
            if (!this._tileActive) this._tileActive = new Set();
            if (Array.isArray(snapshot.activeTiles)) {
                for (const t of snapshot.activeTiles) {
                    if (!t) continue;
                    const c = Number(t.col);
                    const r = Number(t.row);
                    if (Number.isFinite(c) && Number.isFinite(r)) this._activateTile(c, r, false);
                }
            } else {
                const cols = Math.max(1, Number(this.tileCols) | 0);
                const rows = Math.max(1, Number(this.tileRows) | 0);
                const midC = Math.floor(cols / 2);
                const midR = Math.floor(rows / 2);
                for (let row = 0; row < rows; row++) {
                    for (let col = 0; col < cols; col++) {
                        this._activateTile(col - midC, row - midR, false);
                    }
                }
            }
            if (Array.isArray(snapshot.waypoints)) {
                const waypointKeys = [];
                for (const wp of snapshot.waypoints) {
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
            const snapshotTileLayers = this._normalizeIncomingTileLayers(snapshot.tileLayers);
            const hasLayeredSnapshot = Array.isArray(snapshotTileLayers) && snapshotTileLayers.length > 0;

            if (!hasLayeredSnapshot && Array.isArray(snapshot.bindings)) {
                this._areaBindings = [];
                for (let i = 0; i < snapshot.bindings.length; i++) {
                    const b = snapshot.bindings[i];
                    if (!b) continue;
                    let idx = i;
                    if (Number.isFinite(b.col) && Number.isFinite(b.row)) {
                        idx = this._getAreaIndexForCoord(Number(b.col), Number(b.row));
                        this._activateTile(Number(b.col), Number(b.row), false);
                    }
                    const mf = Array.isArray(b.multiFrames) ? b.multiFrames.filter(v => Number.isFinite(v)).map(v => Number(v)) : null;
                    this._setAreaBindingAtIndex(idx, { anim: b.anim, index: Number(b.index), multiFrames: (mf && mf.length > 0) ? mf.slice() : null }, false);
                }
            }
            if (!hasLayeredSnapshot && Array.isArray(snapshot.transforms)) {
                this._areaTransforms = [];
                for (let i = 0; i < snapshot.transforms.length; i++) {
                    const t = snapshot.transforms[i];
                    if (!t) continue;
                    let idx = i;
                    if (Number.isFinite(t.col) && Number.isFinite(t.row)) {
                        idx = this._getAreaIndexForCoord(Number(t.col), Number(t.row));
                        this._activateTile(Number(t.col), Number(t.row), false);
                    }
                    this._setAreaTransformAtIndex(idx, { rot: Number(t.rot || 0), flipH: !!t.flipH }, false);
                }
            }

            if (hasLayeredSnapshot) {
                this._tileLayers = [];
                for (let li = 0; li < snapshotTileLayers.length; li++) {
                    const srcRaw = snapshotTileLayers[li];
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
                        }
                        if (!Number.isFinite(idx)) continue;
                        const mf = Array.isArray(b.multiFrames)
                            ? b.multiFrames.filter(v => Number.isFinite(v)).map(v => Number(v))
                            : null;
                        outLayer.bindings[idx | 0] = {
                            anim: b.anim,
                            index: Number(b.index),
                            multiFrames: (mf && mf.length > 0) ? mf.slice() : null
                        };
                    }
                    const layerTransforms = Array.isArray(srcLayer.transforms) ? srcLayer.transforms : [];
                    for (const t of layerTransforms) {
                        if (!t || typeof t !== 'object') continue;
                        let idx = null;
                        if (Number.isFinite(t.col) && Number.isFinite(t.row)) {
                            idx = this._getAreaIndexForCoord(Number(t.col), Number(t.row));
                            this._activateTile(Number(t.col), Number(t.row), false);
                        }
                        if (!Number.isFinite(idx)) continue;
                        outLayer.transforms[idx | 0] = { rot: Number(t.rot || 0), flipH: !!t.flipH };
                    }
                    this._tileLayers.push(outLayer);
                }
                if (this._tileLayers.length <= 0) this._tileLayers = [{ name: 'Tile Layer 1', visibility: 0, bindings: [], transforms: [] }];
                this._activeTileLayerIndex = this._resolveTileLayerIndex(snapshot.activeTileLayerIndex, false);
                this._syncActiveTileLayerReferences();
            }

            this._adoptCurrentTileArraysIntoActiveLayer();
            if (snapshot.spriteLayer && typeof snapshot.spriteLayer === 'object') {
                const incoming = snapshot.spriteLayer;
                const layer = this._normalizeSpriteLayerState();
                layer.selectedAnimation = incoming.selectedAnimation || null;
                layer.selectedEntityId = incoming.selectedEntityId || null;
                layer.nextEntityId = Math.max(1, Number(incoming.nextEntityId) || 1);
                layer.entities = (incoming.entities && typeof incoming.entities === 'object') ? JSON.parse(JSON.stringify(incoming.entities)) : {};
                layer.order = Array.isArray(incoming.order) ? incoming.order.slice() : Object.keys(layer.entities || {});
                layer.animationProfiles = (incoming.animationProfiles && typeof incoming.animationProfiles === 'object')
                    ? JSON.parse(JSON.stringify(incoming.animationProfiles))
                    : {};
                layer.clipboard = incoming.clipboard ? JSON.parse(JSON.stringify(incoming.clipboard)) : null;
                this.selectedSpriteAnimation = layer.selectedAnimation;
                this.selectedSpriteEntityId = layer.selectedEntityId;
            }
            return true;
        } catch (e) {
            console.warn('_applySnapshot failed', e);
            return false;
        } finally {
            this._suppressOutgoing = false;
        }
    }

    _drawDataUrlToCanvas(ctx, dataUrl, w, h) {
        return new Promise((resolve) => {
            if (!ctx || !dataUrl) { resolve(false); return; }
            const img = new Image();
            img.onload = () => {
                try { ctx.clearRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h); } catch (e) { /* ignore */ }
                resolve(true);
            };
            img.onerror = () => resolve(false);
            img.src = dataUrl;
        });
    }

    _sendSyncAck(requestId) {
        if (!requestId || !this._canSendSignal()) return;
        const diff = {};
        const ackId = (this.playerId) ? this.playerId : (this.clientId || 'client');
        diff['sync/acks/' + ackId] = requestId;
        try { this._sendHandshakeSignal(diff); } catch (e) { console.warn('sync ack send failed', e); }
    }

    // --- Undo / Redo helpers ---
    _captureTileUndoState() {
        try {
            this._ensureLayerState();
            const activeTiles = [];
            if (this._tileActive && this._tileActive.size > 0) {
                const keys = Array.from(this._tileActive).sort();
                for (const key of keys) {
                    const c = this._parseTileKey(key);
                    if (c) activeTiles.push({ col: c.col | 0, row: c.row | 0 });
                }
            }

            const bindings = [];
            if (Array.isArray(this._areaBindings)) {
                for (let i = 0; i < this._areaBindings.length; i++) {
                    const b = this._areaBindings[i];
                    if (!b || typeof b !== 'object') continue;
                    bindings.push({
                        i,
                        anim: String(b.anim || ''),
                        index: Number.isFinite(Number(b.index)) ? (Number(b.index) | 0) : 0,
                        multiFrames: Array.isArray(b.multiFrames) ? b.multiFrames.filter(v => Number.isFinite(v)).map(v => Number(v) | 0) : null
                    });
                }
            }

            const transforms = [];
            if (Array.isArray(this._areaTransforms)) {
                for (let i = 0; i < this._areaTransforms.length; i++) {
                    const t = this._areaTransforms[i];
                    if (!t || typeof t !== 'object') continue;
                    transforms.push({ i, rot: Number(t.rot || 0) | 0, flipH: !!t.flipH });
                }
            }

            const selectionPoints = Array.isArray(this.selectionPoints)
                ? this.selectionPoints
                    .map((p) => ({
                        x: Number(p && p.x) | 0,
                        y: Number(p && p.y) | 0,
                        areaIndex: Number.isFinite(Number(p && p.areaIndex)) ? (Number(p.areaIndex) | 0) : null
                    }))
                : [];

            const selectionRegion = this.selectionRegion
                ? {
                    start: {
                        x: Number(this.selectionRegion.start && this.selectionRegion.start.x) | 0,
                        y: Number(this.selectionRegion.start && this.selectionRegion.start.y) | 0
                    },
                    end: {
                        x: Number(this.selectionRegion.end && this.selectionRegion.end.x) | 0,
                        y: Number(this.selectionRegion.end && this.selectionRegion.end.y) | 0
                    },
                    areaIndex: Number.isFinite(Number(this.selectionRegion.areaIndex)) ? (Number(this.selectionRegion.areaIndex) | 0) : null
                }
                : null;

            const tileSelection = (this._tileSelection && this._tileSelection.size > 0)
                ? Array.from(this._tileSelection).sort()
                : [];

            const waypoints = this._getWaypointCoords(false).map((wp) => ({ col: wp.col | 0, row: wp.row | 0 }));

            const tileLayers = Array.isArray(this._tileLayers)
                ? this._tileLayers.map((layer, li) => {
                    const srcBindings = (layer && Array.isArray(layer.bindings)) ? layer.bindings : [];
                    const srcTransforms = (layer && Array.isArray(layer.transforms)) ? layer.transforms : [];
                    const outBindings = [];
                    const outTransforms = [];

                    for (let i = 0; i < srcBindings.length; i++) {
                        const b = srcBindings[i];
                        if (!b || typeof b !== 'object') continue;
                        outBindings.push({
                            i,
                            anim: String(b.anim || ''),
                            index: Number.isFinite(Number(b.index)) ? (Number(b.index) | 0) : 0,
                            multiFrames: Array.isArray(b.multiFrames) ? b.multiFrames.filter(v => Number.isFinite(v)).map(v => Number(v) | 0) : null
                        });
                    }

                    for (let i = 0; i < srcTransforms.length; i++) {
                        const t = srcTransforms[i];
                        if (!t || typeof t !== 'object') continue;
                        outTransforms.push({ i, rot: Number(t.rot || 0) | 0, flipH: !!t.flipH });
                    }

                    return {
                        name: String((layer && layer.name) || ('Tile Layer ' + (li + 1))),
                        visibility: this._normalizeTileLayerVisibility(layer && layer.visibility, 0),
                        bindings: outBindings,
                        transforms: outTransforms
                    };
                })
                : [];

            return {
                tilemode: !!this.tilemode,
                tileCols: Number(this.tileCols) | 0,
                tileRows: Number(this.tileRows) | 0,
                activeTileLayerIndex: Math.max(0, Number(this._activeTileLayerIndex) | 0),
                tileLayers,
                activeTiles,
                bindings,
                transforms,
                waypoints,
                selectionPoints,
                selectionRegion,
                tileSelection
            };
        } catch (e) {
            return null;
        }
    }

    _tileUndoStateHash(state) {
        try { return JSON.stringify(state || null); } catch (e) { return ''; }
    }

    _captureSelectionUndoState() {
        try {
            return {
                selectionPoints: Array.isArray(this.selectionPoints)
                    ? this.selectionPoints.map((p) => ({
                        x: Number(p && p.x) | 0,
                        y: Number(p && p.y) | 0,
                        areaIndex: Number.isFinite(Number(p && p.areaIndex)) ? (Number(p.areaIndex) | 0) : null
                    }))
                    : [],
                selectionRegion: this.selectionRegion
                    ? {
                        start: {
                            x: Number(this.selectionRegion.start && this.selectionRegion.start.x) | 0,
                            y: Number(this.selectionRegion.start && this.selectionRegion.start.y) | 0
                        },
                        end: {
                            x: Number(this.selectionRegion.end && this.selectionRegion.end.x) | 0,
                            y: Number(this.selectionRegion.end && this.selectionRegion.end.y) | 0
                        },
                        areaIndex: Number.isFinite(Number(this.selectionRegion.areaIndex)) ? (Number(this.selectionRegion.areaIndex) | 0) : null
                    }
                    : null,
                tileSelection: (this._tileSelection && this._tileSelection.size > 0)
                    ? Array.from(this._tileSelection).sort()
                    : []
            };
        } catch (e) {
            return { selectionPoints: [], selectionRegion: null, tileSelection: [] };
        }
    }

    _applySelectionUndoState(state) {
        try {
            if (!state || typeof state !== 'object') return false;
            this.selectionPoints = Array.isArray(state.selectionPoints)
                ? state.selectionPoints.map((p) => ({
                    x: Number(p && p.x) | 0,
                    y: Number(p && p.y) | 0,
                    areaIndex: Number.isFinite(Number(p && p.areaIndex)) ? (Number(p.areaIndex) | 0) : null
                }))
                : [];
            this.selectionRegion = state.selectionRegion
                ? {
                    start: {
                        x: Number(state.selectionRegion.start && state.selectionRegion.start.x) | 0,
                        y: Number(state.selectionRegion.start && state.selectionRegion.start.y) | 0
                    },
                    end: {
                        x: Number(state.selectionRegion.end && state.selectionRegion.end.x) | 0,
                        y: Number(state.selectionRegion.end && state.selectionRegion.end.y) | 0
                    },
                    areaIndex: Number.isFinite(Number(state.selectionRegion.areaIndex)) ? (Number(state.selectionRegion.areaIndex) | 0) : null
                }
                : null;
            this._tileSelection = new Set(Array.isArray(state.tileSelection) ? state.tileSelection : []);
            return true;
        } catch (e) {
            return false;
        }
    }

    _trackSelectionUndoState() {
        try {
            const cur = this._captureSelectionUndoState();
            const curHash = this._tileUndoStateHash(cur);
            if (!this._selectionUndoStateHash) {
                this._selectionUndoStateHash = curHash;
                this._selectionUndoState = cur;
                return;
            }
            if (curHash === this._selectionUndoStateHash) return;

            // Keep baseline synced when undo capture is suppressed (e.g. during undo/redo apply).
            if (this._ignoreUndoCapture) {
                this._selectionUndoStateHash = curHash;
                this._selectionUndoState = cur;
                return;
            }

            const before = this._selectionUndoState || { selectionPoints: [], selectionRegion: null, tileSelection: [] };
            const now = Date.now();
            const last = this._undoStack[this._undoStack.length - 1];
            const canMerge = last && last.type === 'selection-state' && (now - Number(last.time || 0)) <= Math.max(150, Number(this._undoMergeMs) || 0);
            if (canMerge) {
                last.after = cur;
                last.afterHash = curHash;
                last.time = now;
                this._redoStack = [];
            } else {
                this._pushUndo({
                    type: 'selection-state',
                    before,
                    after: cur,
                    beforeHash: this._selectionUndoStateHash,
                    afterHash: curHash,
                    time: now
                });
            }
            this._selectionUndoStateHash = curHash;
            this._selectionUndoState = cur;
        } catch (e) {
            /* ignore selection undo tracking errors */
        }
    }

    _recordUndoTileState(beforeState, afterState) {
        if (this._ignoreUndoCapture) return;
        if (!beforeState || !afterState) return;
        const beforeHash = this._tileUndoStateHash(beforeState);
        const afterHash = this._tileUndoStateHash(afterState);
        if (!beforeHash || beforeHash === afterHash) return;

        const now = Date.now();
        const last = this._undoStack[this._undoStack.length - 1];
        const canMerge = last && last.type === 'tile-state' && (now - Number(last.time || 0)) <= Math.max(150, Number(this._undoMergeMs) || 0);
        if (canMerge) {
            last.after = afterState;
            last.afterHash = afterHash;
            last.time = now;
            this._redoStack = [];
            return;
        }
        this._pushUndo({ type: 'tile-state', before: beforeState, after: afterState, beforeHash, afterHash, time: now });
    }

    _queueDeferredTileUndoCapture(syncOp = true) {
        try {
            if (!syncOp || this._ignoreUndoCapture) return false;
            if (!this._tileUndoPendingBefore) this._tileUndoPendingBefore = this._captureTileUndoState();
            if (this._tileUndoFinalizeScheduled) return true;

            this._tileUndoFinalizeScheduled = true;
            setTimeout(() => {
                try { this._flushPendingTileUndoCapture(); } catch (e) { /* ignore */ }
            }, 0);
            return true;
        } catch (e) {
            return false;
        }
    }

    _flushPendingTileUndoCapture() {
        try {
            if (this._tileUndoFinalizeScheduled) this._tileUndoFinalizeScheduled = false;
            if (!this._tileUndoPendingBefore) return false;
            const beforeState = this._tileUndoPendingBefore;
            this._tileUndoPendingBefore = null;
            const afterState = this._captureTileUndoState();
            this._recordUndoTileState(beforeState, afterState);
            return true;
        } catch (e) {
            return false;
        }
    }

    _syncTileStateToCollab(fromState, toState) {
        try {
            if (this._suppressOutgoing || !this._canSendCollab || !this._canSendCollab()) return false;
            if (!fromState || !toState) return false;

            if (Array.isArray(toState.tileLayers) && toState.tileLayers.length > 0) {
                const fromTiles = new Set((Array.isArray(fromState.activeTiles) ? fromState.activeTiles : [])
                    .map((t) => this._tileKey(Number(t && t.col) | 0, Number(t && t.row) | 0)));
                const toTiles = new Set((Array.isArray(toState.activeTiles) ? toState.activeTiles : [])
                    .map((t) => this._tileKey(Number(t && t.col) | 0, Number(t && t.row) | 0)));

                for (const key of fromTiles) {
                    if (toTiles.has(key)) continue;
                    const c = this._parseTileKey(key);
                    if (!c) continue;
                    this._queueTileOp('deactivate', { col: c.col | 0, row: c.row | 0 });
                }

                for (const key of toTiles) {
                    const c = this._parseTileKey(key);
                    if (!c) continue;
                    this._queueTileOp('activate', { col: c.col | 0, row: c.row | 0 });
                }

                const fromLayers = Array.isArray(fromState.tileLayers) ? fromState.tileLayers : [];
                const toLayers = Array.isArray(toState.tileLayers) ? toState.tileLayers : [];
                const maxLayers = Math.max(fromLayers.length, toLayers.length);

                const mapByIndex = (arr = []) => {
                    const out = new Map();
                    for (const item of arr) {
                        if (!item || !Number.isFinite(Number(item.i))) continue;
                        out.set(Number(item.i) | 0, item);
                    }
                    return out;
                };

                for (let li = 0; li < maxLayers; li++) {
                    const fromLayer = fromLayers[li] || null;
                    const toLayer = toLayers[li] || null;
                    const fromBindingMap = mapByIndex(fromLayer && Array.isArray(fromLayer.bindings) ? fromLayer.bindings : []);
                    const toBindingMap = mapByIndex(toLayer && Array.isArray(toLayer.bindings) ? toLayer.bindings : []);
                    const fromTransformMap = mapByIndex(fromLayer && Array.isArray(fromLayer.transforms) ? fromLayer.transforms : []);
                    const toTransformMap = mapByIndex(toLayer && Array.isArray(toLayer.transforms) ? toLayer.transforms : []);

                    const indexSet = new Set();
                    for (const i of fromBindingMap.keys()) indexSet.add(i);
                    for (const i of toBindingMap.keys()) indexSet.add(i);
                    for (const i of fromTransformMap.keys()) indexSet.add(i);
                    for (const i of toTransformMap.keys()) indexSet.add(i);

                    for (const idx of indexSet) {
                        const coord = (Array.isArray(this._tileIndexToCoord) && this._tileIndexToCoord[idx | 0]) ? this._tileIndexToCoord[idx | 0] : null;
                        if (!coord) continue;
                        const col = Number(coord.col) | 0;
                        const row = Number(coord.row) | 0;

                        const b = toBindingMap.get(idx | 0) || null;
                        if (b) {
                            this._queueTileOp('bind', {
                                col,
                                row,
                                layer: li,
                                anim: String(b.anim || this.selectedAnimation || 'idle'),
                                index: Number.isFinite(Number(b.index)) ? (Number(b.index) | 0) : 0,
                                multiFrames: Array.isArray(b.multiFrames)
                                    ? b.multiFrames.filter(v => Number.isFinite(v)).map(v => Number(v) | 0)
                                    : null
                            });
                        } else {
                            this._queueTileOp('clearBinding', { col, row, layer: li });
                        }

                        const t = toTransformMap.get(idx | 0) || null;
                        if (t) {
                            this._queueTileOp('setTransform', {
                                col,
                                row,
                                layer: li,
                                rot: Number(t.rot || 0) | 0,
                                flipH: !!t.flipH
                            });
                        } else {
                            this._queueTileOp('clearTransform', { col, row, layer: li });
                        }
                    }
                }

                const fromWaypoints = new Set((Array.isArray(fromState.waypoints) ? fromState.waypoints : [])
                    .map((w) => this._tileKey(Number(w && w.col) | 0, Number(w && w.row) | 0)));
                const toWaypoints = new Set((Array.isArray(toState.waypoints) ? toState.waypoints : [])
                    .map((w) => this._tileKey(Number(w && w.col) | 0, Number(w && w.row) | 0)));

                for (const key of fromWaypoints) {
                    if (toWaypoints.has(key)) continue;
                    const c = this._parseTileKey(key);
                    if (!c) continue;
                    this._queueTileOp('clearWaypoint', { col: c.col | 0, row: c.row | 0 });
                }

                for (const key of toWaypoints) {
                    const c = this._parseTileKey(key);
                    if (!c) continue;
                    this._queueTileOp('setWaypoint', { col: c.col | 0, row: c.row | 0 });
                }

                return true;
            }

            const fromTiles = new Set((Array.isArray(fromState.activeTiles) ? fromState.activeTiles : [])
                .map((t) => this._tileKey(Number(t && t.col) | 0, Number(t && t.row) | 0)));
            const toTiles = new Set((Array.isArray(toState.activeTiles) ? toState.activeTiles : [])
                .map((t) => this._tileKey(Number(t && t.col) | 0, Number(t && t.row) | 0)));

            for (const key of fromTiles) {
                if (toTiles.has(key)) continue;
                const c = this._parseTileKey(key);
                if (!c) continue;
                this._queueTileOp('deactivate', { col: c.col | 0, row: c.row | 0 });
            }

            for (const key of toTiles) {
                const c = this._parseTileKey(key);
                if (!c) continue;
                this._queueTileOp('activate', { col: c.col | 0, row: c.row | 0 });
            }

            const bindingByIndex = new Map();
            for (const b of (Array.isArray(toState.bindings) ? toState.bindings : [])) {
                if (!b || !Number.isFinite(Number(b.i))) continue;
                bindingByIndex.set(Number(b.i) | 0, b);
            }

            const transformByIndex = new Map();
            for (const t of (Array.isArray(toState.transforms) ? toState.transforms : [])) {
                if (!t || !Number.isFinite(Number(t.i))) continue;
                transformByIndex.set(Number(t.i) | 0, t);
            }

            for (const key of toTiles) {
                const c = this._parseTileKey(key);
                if (!c) continue;
                const idx = this._getAreaIndexForCoord(c.col | 0, c.row | 0);
                if (!Number.isFinite(idx)) continue;

                const b = bindingByIndex.get(idx | 0);
                if (b) {
                    this._queueTileOp('bind', {
                        col: c.col | 0,
                        row: c.row | 0,
                        anim: String(b.anim || this.selectedAnimation || 'idle'),
                        index: Number.isFinite(Number(b.index)) ? (Number(b.index) | 0) : 0,
                        multiFrames: Array.isArray(b.multiFrames) ? b.multiFrames.filter(v => Number.isFinite(v)).map(v => Number(v) | 0) : null
                    });
                } else {
                    this._queueTileOp('clearBinding', { col: c.col | 0, row: c.row | 0 });
                }

                const t = transformByIndex.get(idx | 0);
                if (t) {
                    this._queueTileOp('setTransform', {
                        col: c.col | 0,
                        row: c.row | 0,
                        rot: Number(t.rot || 0) | 0,
                        flipH: !!t.flipH
                    });
                } else {
                    this._queueTileOp('clearTransform', { col: c.col | 0, row: c.row | 0 });
                }
            }

            const fromWaypoints = new Set((Array.isArray(fromState.waypoints) ? fromState.waypoints : [])
                .map((w) => this._tileKey(Number(w && w.col) | 0, Number(w && w.row) | 0)));
            const toWaypoints = new Set((Array.isArray(toState.waypoints) ? toState.waypoints : [])
                .map((w) => this._tileKey(Number(w && w.col) | 0, Number(w && w.row) | 0)));

            for (const key of fromWaypoints) {
                if (toWaypoints.has(key)) continue;
                const c = this._parseTileKey(key);
                if (!c) continue;
                this._queueTileOp('clearWaypoint', { col: c.col | 0, row: c.row | 0 });
            }

            for (const key of toWaypoints) {
                const c = this._parseTileKey(key);
                if (!c) continue;
                this._queueTileOp('setWaypoint', { col: c.col | 0, row: c.row | 0 });
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    _applyTileUndoState(state) {
        try {
            if (!state || typeof state !== 'object') return false;

            this._ensureLayerState();
            this.tilemode = !!state.tilemode;
            this.tileCols = Math.max(1, Number(state.tileCols) | 0 || this.tileCols || 3);
            this.tileRows = Math.max(1, Number(state.tileRows) | 0 || this.tileRows || this.tileCols || 3);

            this._tileActive = new Set();
            if (!(this._tileCoordToIndex instanceof Map)) this._tileCoordToIndex = new Map();
            if (!Array.isArray(this._tileIndexToCoord)) this._tileIndexToCoord = [];

            const activeTiles = Array.isArray(state.activeTiles) ? state.activeTiles : [];
            for (const t of activeTiles) {
                if (!t) continue;
                const c = Number(t.col);
                const r = Number(t.row);
                if (!Number.isFinite(c) || !Number.isFinite(r)) continue;
                this._activateTile(c | 0, r | 0, false);
            }

            const hasLayered = Array.isArray(state.tileLayers) && state.tileLayers.length > 0;
            if (hasLayered) {
                this._tileLayers = state.tileLayers.map((src, li) => {
                    const layer = {
                        name: String((src && src.name) || ('Tile Layer ' + (li + 1))),
                        visibility: this._normalizeTileLayerVisibility(src && src.visibility, 0),
                        bindings: [],
                        transforms: []
                    };
                    const bindings = (src && Array.isArray(src.bindings)) ? src.bindings : [];
                    for (const b of bindings) {
                        if (!b || !Number.isFinite(Number(b.i))) continue;
                        const idx = Number(b.i) | 0;
                        layer.bindings[idx] = {
                            anim: String(b.anim || ''),
                            index: Number.isFinite(Number(b.index)) ? (Number(b.index) | 0) : 0,
                            multiFrames: Array.isArray(b.multiFrames) ? b.multiFrames.filter(v => Number.isFinite(v)).map(v => Number(v) | 0) : null
                        };
                    }
                    const transforms = (src && Array.isArray(src.transforms)) ? src.transforms : [];
                    for (const t of transforms) {
                        if (!t || !Number.isFinite(Number(t.i))) continue;
                        const idx = Number(t.i) | 0;
                        layer.transforms[idx] = { rot: Number(t.rot || 0) | 0, flipH: !!t.flipH };
                    }
                    return layer;
                });
                const maxLayer = Math.max(0, this._tileLayers.length - 1);
                this._activeTileLayerIndex = Math.max(0, Math.min(Number(state.activeTileLayerIndex) | 0, maxLayer));
                this._syncActiveTileLayerReferences();
            } else {
                this._areaBindings = [];
                const bindings = Array.isArray(state.bindings) ? state.bindings : [];
                for (const b of bindings) {
                    if (!b || !Number.isFinite(Number(b.i))) continue;
                    const idx = Number(b.i) | 0;
                    this._areaBindings[idx] = {
                        anim: String(b.anim || ''),
                        index: Number.isFinite(Number(b.index)) ? (Number(b.index) | 0) : 0,
                        multiFrames: Array.isArray(b.multiFrames) ? b.multiFrames.filter(v => Number.isFinite(v)).map(v => Number(v) | 0) : null
                    };
                }

                this._areaTransforms = [];
                const transforms = Array.isArray(state.transforms) ? state.transforms : [];
                for (const t of transforms) {
                    if (!t || !Number.isFinite(Number(t.i))) continue;
                    const idx = Number(t.i) | 0;
                    this._areaTransforms[idx] = { rot: Number(t.rot || 0) | 0, flipH: !!t.flipH };
                }
                this._adoptCurrentTileArraysIntoActiveLayer();
            }

            const waypointKeys = [];
            const waypoints = Array.isArray(state.waypoints) ? state.waypoints : [];
            for (const wp of waypoints) {
                if (!wp) continue;
                const c = Number(wp.col);
                const r = Number(wp.row);
                if (!Number.isFinite(c) || !Number.isFinite(r)) continue;
                waypointKeys.push(this._tileKey(c | 0, r | 0));
            }
            this._setWaypointKeys(waypointKeys, false, true);

            this.selectionPoints = Array.isArray(state.selectionPoints)
                ? state.selectionPoints.map((p) => ({
                    x: Number(p && p.x) | 0,
                    y: Number(p && p.y) | 0,
                    areaIndex: Number.isFinite(Number(p && p.areaIndex)) ? (Number(p.areaIndex) | 0) : null
                }))
                : [];

            this.selectionRegion = state.selectionRegion
                ? {
                    start: {
                        x: Number(state.selectionRegion.start && state.selectionRegion.start.x) | 0,
                        y: Number(state.selectionRegion.start && state.selectionRegion.start.y) | 0
                    },
                    end: {
                        x: Number(state.selectionRegion.end && state.selectionRegion.end.x) | 0,
                        y: Number(state.selectionRegion.end && state.selectionRegion.end.y) | 0
                    },
                    areaIndex: Number.isFinite(Number(state.selectionRegion.areaIndex)) ? (Number(state.selectionRegion.areaIndex) | 0) : null
                }
                : null;

            this._tileSelection = new Set(Array.isArray(state.tileSelection) ? state.tileSelection : []);
            this._tileActiveVersion = (Number.isFinite(this._tileActiveVersion) ? this._tileActiveVersion : 0) + 1;
            return true;
        } catch (e) {
            return false;
        }
    }

    _pushUndo(entry) {
        if (!entry || this._ignoreUndoCapture) return;
        this._undoStack.push(entry);
        // trim to max and clear redo on new action
        if (this._undoStack.length > this._undoMax) this._undoStack.shift();
        this._redoStack = [];
    }

    _recordUndoPixels(anim, frameIdx, changes, pixelLayer = null) {
        if (this._ignoreUndoCapture) return;
        const sheet = this.currentSprite;
        if (!sheet || !sheet.getFrame) return;
        const frame = sheet.getFrame(anim, frameIdx);
        if (!frame || !frame.getContext) return;
        const ctx = frame.getContext('2d');
        const w = frame.width, h = frame.height;
        if (!w || !h) return;

        const coords = [];
        if (Array.isArray(changes)) {
            for (const c of changes) {
                if (!c || c.x === undefined || c.y === undefined) continue;
                coords.push({ x: Number(c.x), y: Number(c.y), next: c.color || c.col || c.c || '#000000' });
            }
        } else if (changes && changes.x !== undefined && changes.y !== undefined) {
            coords.push({ x: Number(changes.x), y: Number(changes.y), next: changes.color || changes.col || changes.c || '#000000' });
        }
        if (!coords.length) return;

        let img;
        try { img = ctx.getImageData(0, 0, w, h); } catch (e) { return; }
        const data = img.data;
        // Deduplicate coords inside the batch
        const samples = [];
        const seen = new Map(); // key: "x,y" -> index in samples
        for (const c of coords) {
            const x = Math.max(0, Math.min(w - 1, Math.floor(c.x)));
            const y = Math.max(0, Math.min(h - 1, Math.floor(c.y)));
            const key = x + ',' + y;
            const idx = (y * w + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            const a = data[idx + 3];
            const prevHex = this.rgbaToHex(r, g, b, a);
            const nextHex = c.next || '#000000';
            if (seen.has(key)) {
                // Keep earliest prev, update next to latest
                const sIdx = seen.get(key);
                samples[sIdx].next = nextHex;
            } else {
                seen.set(key, samples.length);
                samples.push({ x, y, prev: prevHex, next: nextHex });
            }
        }
        if (!samples.length) return;

        const maxSamples = Math.max(256, Number(this._undoPixelSampleLimit) || 12000);
        if (samples.length > maxSamples) {
            const trimmed = [];
            const step = samples.length / maxSamples;
            for (let i = 0; i < maxSamples; i++) {
                const idx = Math.min(samples.length - 1, Math.floor(i * step));
                trimmed.push(samples[idx]);
            }
            samples.length = 0;
            for (const s of trimmed) samples.push(s);
        }

        const now = Date.now();
        const layerIndex = Number.isFinite(Number(pixelLayer)) ? (Number(pixelLayer) | 0) : (this._activePixelLayerIndex | 0);
        const last = this._undoStack[this._undoStack.length - 1];
        const canMerge = last && last.type === 'pixels' && last.anim === anim && last.frame === Number(frameIdx) && (last.pixelLayer | 0) === (layerIndex | 0) && (now - last.time) <= this._undoMergeMs;
        if (canMerge) {
            // Merge into last entry while preserving original prev colors
            const map = new Map();
            for (let i = 0; i < last.pixels.length; i++) {
                const p = last.pixels[i];
                map.set(p.x + ',' + p.y, { idx: i, prev: p.prev });
            }
            for (const s of samples) {
                const key = s.x + ',' + s.y;
                if (map.has(key)) {
                    const entry = map.get(key);
                    last.pixels[entry.idx].next = s.next;
                    // keep existing prev (earliest)
                } else {
                    last.pixels.push(s);
                    map.set(key, { idx: last.pixels.length - 1, prev: s.prev });
                }
            }
            last.time = now;
            this._redoStack = []; // new edits invalidate redo even when merged
        } else {
            this._pushUndo({ type: 'pixels', anim, frame: Number(frameIdx) || 0, pixelLayer: layerIndex | 0, pixels: samples, time: now });
        }
    }

    _applyPixelBatch(anim, frameIdx, pixels, useNext, pixelLayer = null) {
        if (!pixels || pixels.length === 0) return;
        const sheet = this.currentSprite;
        if (!sheet) return;
        const prevLayer = this._activePixelLayerIndex | 0;
        const targetLayer = Number.isFinite(Number(pixelLayer)) ? (Number(pixelLayer) | 0) : prevLayer;
        this._activePixelLayerIndex = Math.max(0, Math.min(targetLayer, Math.max(0, (this._pixelLayers?.length || 1) - 1)));
        const changes = pixels.map(p => ({ x: p.x, y: p.y, color: useNext ? p.next : p.prev, blendType: 'replace' }));
        try { sheet.modifyFrame(anim, frameIdx, changes); } catch (e) {
            // fallback per-pixel
            for (const p of changes) {
                try { sheet.setPixel(anim, frameIdx, p.x, p.y, p.color, 'replace'); } catch (er) { /* ignore */ }
            }
        } finally {
            this._activePixelLayerIndex = prevLayer;
        }
        try { if (sheet._rebuildSheetCanvas) sheet._rebuildSheetCanvas(); } catch (e) { /* ignore */ }
    }

    undo() {
        this._flushPendingTileUndoCapture();
        if (!this._undoStack || this._undoStack.length === 0) return false;
        const now = Date.now();
        let entry = null;
        while (this._undoStack.length > 0) {
            const cand = this._undoStack.pop();
            if (cand.type === 'delete-frame' && this._undoTimeWindowMs && cand.time && (now - cand.time) > this._undoTimeWindowMs) {
                continue; // expired frame delete
            }
            entry = cand; break;
        }
        if (!entry) return false;
        this._ignoreUndoCapture = true;
        try {
            if (entry.type === 'pixels') {
                this._applyPixelBatch(entry.anim, entry.frame, entry.pixels, false, entry.pixelLayer);
            } else if (entry.type === 'delete-frame') {
                this._restoreDeletedFrame(entry);
            } else if (entry.type === 'tile-state') {
                const preState = this._captureTileUndoState();
                this._applyTileUndoState(entry.before);
                this._syncTileStateToCollab(preState, entry.before);
            } else if (entry.type === 'selection-state') {
                this._applySelectionUndoState(entry.before);
            }
            this._redoStack.push(entry);
            if (this._redoStack.length > this._undoMax) this._redoStack.shift();
        } finally {
            const curSel = this._captureSelectionUndoState();
            this._selectionUndoState = curSel;
            this._selectionUndoStateHash = this._tileUndoStateHash(curSel);
            this._ignoreUndoCapture = false;
        }
        try { this._playSfx('history.undo'); } catch (e) {}
        return true;
    }

    redo() {
        this._flushPendingTileUndoCapture();
        if (!this._redoStack || this._redoStack.length === 0) return false;
        const entry = this._redoStack.pop();
        this._ignoreUndoCapture = true;
        try {
            if (entry.type === 'pixels') {
                this._applyPixelBatch(entry.anim, entry.frame, entry.pixels, true, entry.pixelLayer);
            } else if (entry.type === 'delete-frame') {
                // redo delete: re-apply removal
                try { this.currentSprite && this.currentSprite.popFrame(entry.anim, entry.index); } catch (e) { /* ignore */ }
            } else if (entry.type === 'tile-state') {
                const preState = this._captureTileUndoState();
                this._applyTileUndoState(entry.after);
                this._syncTileStateToCollab(preState, entry.after);
            } else if (entry.type === 'selection-state') {
                this._applySelectionUndoState(entry.after);
            }
            this._undoStack.push(entry);
        } finally {
            const curSel = this._captureSelectionUndoState();
            this._selectionUndoState = curSel;
            this._selectionUndoStateHash = this._tileUndoStateHash(curSel);
            this._ignoreUndoCapture = false;
        }
        try { this._playSfx('history.redo'); } catch (e) {}
        return true;
    }

    _restoreDeletedFrame(entry) {
        if (!entry || !entry.dataUrl) return;
        const sheet = this.currentSprite;
        if (!sheet) return;
        const slice = entry.size || sheet.slicePx || 16;
        try { sheet.insertFrame(entry.anim, entry.index); } catch (e) { /* ignore */ }
        const frame = sheet.getFrame(entry.anim, entry.index);
        if (frame && frame.getContext) {
            const ctx = frame.getContext('2d');
            ctx.clearRect(0, 0, frame.width, frame.height);
            const img = new Image();
            img.onload = () => {
                try { ctx.drawImage(img, 0, 0, slice, slice); if (sheet._rebuildSheetCanvas) sheet._rebuildSheetCanvas(); } catch (e) { /* ignore */ }
            };
            img.src = entry.dataUrl;
        }
        // restore selection to the reinstated frame
        if (this.stateController) this.stateController.setActiveSelection(entry.anim, entry.index);
        else {
            this.selectedAnimation = entry.anim;
            this.selectedFrame = entry.index;
        }
    }

    // Helper: mark a pixel as modified locally at given timestamp (ms)
    _markPixelModified(anim, frameIdx, x, y, timestamp) {
        try {
            if (!this._lastModified) this._lastModified = new Map();
            if (!this.currentSprite) return;
            const size = this.currentSprite.slicePx || 0;
            if (!size) return;
            if (!this._lastModified.has(anim)) this._lastModified.set(anim, new Map());
            const frameMap = this._lastModified.get(anim);
            if (!frameMap.has(frameIdx)) {
                frameMap.set(frameIdx, new Uint32Array(size * size));
            }
            const arr = frameMap.get(frameIdx);
            if (!arr) return;
            const idx = (y * size) + x;
            if (idx < 0 || idx >= arr.length) return;
            arr[idx] = Math.max(arr[idx] || 0, Math.floor(timestamp || Date.now()));
        } catch (e) { /* ignore */ }
    }

    // Helper: get last-modified timestamp for a pixel
    _getPixelModified(anim, frameIdx, x, y) {
        try {
            if (!this._lastModified) return 0;
            const frameMap = this._lastModified.get(anim);
            if (!frameMap) return 0;
            const arr = frameMap.get(frameIdx);
            if (!arr) return 0;
            const size = this.currentSprite.slicePx || 0;
            const idx = (y * size) + x;
            if (idx < 0 || idx >= arr.length) return 0;
            return arr[idx] || 0;
        } catch (e) { return 0; }
    }

    // Periodically prune old remote edits from server state to avoid unbounded growth.
    // Deletes `edits/<id>` entries older than `_pruneThresholdMs` (default 30000ms).
    _pruneOldEdits() {
        try {
            if (!this._canSendCollab()) return;
            if (!this._remoteEdits || this._remoteEdits.size === 0) return;
            const now = Date.now();
            const cutoff = now - (this._pruneThresholdMs || 30000);
            const diff = {};
            const removed = [];
            for (const [id, t] of this._remoteEdits.entries()) {
                try {
                    const ts = Number(t) || 0;
                    if (ts && ts < cutoff) {
                        diff['edits/' + id] = null;
                        removed.push(id);
                    }
                    if (Object.keys(diff).length >= 128) break; // avoid huge updates
                } catch (e) { continue; }
            }
            if (Object.keys(diff).length > 0) {
                try { this._sendCollabDiff(diff); } catch (e) { console.warn('pruneOldEdits sendDiff failed', e); }
                for (const id of removed) try { this._remoteEdits.delete(id); } catch (e) {}
            }
        } catch (e) { console.warn('pruneOldEdits failed', e); }
    }

    // Schedule a throttled cursor send
    _scheduleCursorSend() {
        try {
            if (this._cursorThrottleId) return;
            this._cursorThrottleId = setTimeout(() => {
                try { this._sendCursor(); } catch (e) {}
                try { clearTimeout(this._cursorThrottleId); } catch(e) {}
                this._cursorThrottleId = null;
            }, this._cursorSendIntervalMs || 100);
        } catch (e) {}
    }

    // Send current cursor position to server under cursors/<clientId>
    _sendCursor() {
        try {
            if (!this._canSendCollab()) return;
            if (!this.mouse || !this.mouse.pos) return;
            const pos = this.mouse.pos;
            const payload = { x: Number(pos.x || 0), y: Number(pos.y || 0), time: Date.now(), client: this.clientId };
            payload.zx = Number(this.zoom?.x || 1);
            payload.zy = Number(this.zoom?.y || 1);
            payload.ox = Number(this.offset?.x || 0);
            payload.oy = Number(this.offset?.y || 0);
            const p = this.getPos(pos);
            payload.tm = this.tilemode ? 1 : 0;
            payload.in = (p && p.inside) ? 1 : 0;
            payload.ro = (p && p.renderOnly) ? 1 : 0;
            payload.bs = Math.max(1, Math.min(64, Number(this.brushSize) || 1));
            if (p && Number.isFinite(p.x)) payload.px = Number(p.x);
            if (p && Number.isFinite(p.y)) payload.py = Number(p.y);
            if (p && Number.isFinite(p.tileCol)) payload.tc = Number(p.tileCol);
            if (p && Number.isFinite(p.tileRow)) payload.tr = Number(p.tileRow);
            if (p && Number.isFinite(p.areaIndex)) payload.ai = Number(p.areaIndex);
            const sel = this._buildCursorSelectionPayload();
            if (sel) payload.sel = sel;
            if (this.playerName) payload.name = this.playerName;
            const diff = {};
            diff['cursors/' + this.clientId] = payload;
            try { this._sendCollabDiff(diff); } catch (e) {}
        } catch (e) { /* ignore */ }
    }

    _buildCursorSelectionPayload() {
        try {
            if (this.selectionRegion && this.selectionRegion.start && this.selectionRegion.end) {
                const sr = this.selectionRegion;
                return {
                    t: 'r',
                    x0: Math.min(Number(sr.start.x) || 0, Number(sr.end.x) || 0),
                    y0: Math.min(Number(sr.start.y) || 0, Number(sr.end.y) || 0),
                    x1: Math.max(Number(sr.start.x) || 0, Number(sr.end.x) || 0),
                    y1: Math.max(Number(sr.start.y) || 0, Number(sr.end.y) || 0),
                    ai: (this.tilemode && Number.isFinite(sr.areaIndex)) ? Number(sr.areaIndex) : null
                };
            }
            if (Array.isArray(this.selectionPoints) && this.selectionPoints.length > 0) {
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                let areaIdx = null;
                for (const p of this.selectionPoints) {
                    if (!p) continue;
                    const x = Number(p.x);
                    const y = Number(p.y);
                    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
                    if (x < minX) minX = x;
                    if (y < minY) minY = y;
                    if (x > maxX) maxX = x;
                    if (y > maxY) maxY = y;
                    if (this.tilemode && Number.isFinite(p.areaIndex)) {
                        if (areaIdx === null) areaIdx = Number(p.areaIndex);
                        else if (areaIdx !== Number(p.areaIndex)) { areaIdx = null; }
                    }
                }
                if (Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)) {
                    return {
                        t: 'p',
                        x0: minX|0,
                        y0: minY|0,
                        x1: maxX|0,
                        y1: maxY|0,
                        ai: (this.tilemode && areaIdx !== null) ? Number(areaIdx) : null
                    };
                }
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    _getRemoteCursorTargetScreen(entry) {
        try {
            if (!entry || !this.currentSprite) return null;
            const base = this.computeDrawArea();
            if (!base || !base.topLeft || !base.size) return null;
            const slice = Math.max(1, Number(this.currentSprite.slicePx || 1));

            let col = Number.isFinite(entry.tc) ? Number(entry.tc) : 0;
            let row = Number.isFinite(entry.tr) ? Number(entry.tr) : 0;
            if (!Number.isFinite(col)) col = 0;
            if (!Number.isFinite(row)) row = 0;

            const hasPixel = Number.isFinite(entry.px) && Number.isFinite(entry.py);
            let relX = 0.5;
            let relY = 0.5;
            if (hasPixel) {
                relX = (Number(entry.px) + 0.5) / slice;
                relY = (Number(entry.py) + 0.5) / slice;
                const ai = this._getAreaIndexForCoord(col, row);
                const tr = (Array.isArray(this._areaTransforms) && Number.isFinite(ai)) ? this._areaTransforms[ai] : null;
                if (tr) {
                    const mapped = this._sourceToDisplayPixel(relX, relY, tr, slice);
                    if (mapped) {
                        relX = mapped.relX;
                        relY = mapped.relY;
                    }
                }
            }

            const zoomX = (this.zoom?.x || 1);
            const zoomY = (this.zoom?.y || 1);
            const offX = (this.offset?.x || 0);
            const offY = (this.offset?.y || 0);
            const tileWorldX = base.topLeft.x + col * base.size.x;
            const tileWorldY = base.topLeft.y + row * base.size.y;
            const cellWorldW = base.size.x / slice;
            const cellWorldH = base.size.y / slice;

            let worldX = tileWorldX;
            let worldY = tileWorldY;
            let worldW = base.size.x;
            let worldH = base.size.y;
            if (hasPixel) {
                const brush = Math.max(1, Math.min(64, Number(entry.bs) || 1));
                const px = Number(entry.px) || 0;
                const py = Number(entry.py) || 0;
                const half = Math.floor((brush - 1) / 2);
                const startPx = px - half;
                const startPy = py - half;
                worldX = tileWorldX + startPx * cellWorldW;
                worldY = tileWorldY + startPy * cellWorldH;
                worldW = cellWorldW * brush;
                worldH = cellWorldH * brush;
            } else if (Number(entry.tm) === 1) {
                // In render-only tilemode there may be no pixel coords; use brush size as tile footprint.
                const brushTiles = Math.max(1, Math.min(64, Number(entry.bs) || 1));
                const halfTiles = Math.floor((brushTiles - 1) / 2);
                worldX = tileWorldX - halfTiles * base.size.x;
                worldY = tileWorldY - halfTiles * base.size.y;
                worldW = base.size.x * brushTiles;
                worldH = base.size.y * brushTiles;
            }

            const screenX = (worldX + offX) * zoomX;
            const screenY = (worldY + offY) * zoomY;
            const screenW = Math.max(2, worldW * zoomX);
            const screenH = Math.max(2, worldH * zoomY);

            let label = '';
            if (Number(entry.tm) === 1 && Number.isFinite(entry.tc) && Number.isFinite(entry.tr)) {
                if (hasPixel) label = `t:${entry.tc|0},${entry.tr|0} p:${entry.px|0},${entry.py|0}`;
                else label = `t:${entry.tc|0},${entry.tr|0}`;
            } else if (hasPixel) {
                label = `p:${entry.px|0},${entry.py|0}`;
            }

            return { x: screenX, y: screenY, w: screenW, h: screenH, label };
        } catch (e) {
            return null;
        }
    }

    _getRemoteSelectionOverlay(entry) {
        try {
            if (!entry || !entry.sel || !this.currentSprite) return null;
            const s = entry.sel;
            const x0 = Number(s.x0), y0 = Number(s.y0), x1 = Number(s.x1), y1 = Number(s.y1);
            if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) return null;
            const base = this.computeDrawArea();
            if (!base || !base.topLeft || !base.size) return null;
            const slice = Math.max(1, Number(this.currentSprite.slicePx || 1));
            const cellWorldW = base.size.x / slice;
            const cellWorldH = base.size.y / slice;

            let col = Number.isFinite(entry.tc) ? Number(entry.tc) : 0;
            let row = Number.isFinite(entry.tr) ? Number(entry.tr) : 0;
            if (Number.isFinite(s.ai) && Array.isArray(this._tileIndexToCoord) && this._tileIndexToCoord[Number(s.ai)]) {
                const cr = this._tileIndexToCoord[Number(s.ai)];
                col = Number(cr.col) || 0;
                row = Number(cr.row) || 0;
            }

            const minX = Math.min(x0, x1);
            const minY = Math.min(y0, y1);
            const maxX = Math.max(x0, x1);
            const maxY = Math.max(y0, y1);

            const worldX = base.topLeft.x + col * base.size.x + minX * cellWorldW;
            const worldY = base.topLeft.y + row * base.size.y + minY * cellWorldH;
            const worldW = (maxX - minX + 1) * cellWorldW;
            const worldH = (maxY - minY + 1) * cellWorldH;

            const screenX = (worldX + (this.offset?.x || 0)) * (this.zoom?.x || 1);
            const screenY = (worldY + (this.offset?.y || 0)) * (this.zoom?.y || 1);
            const screenW = Math.max(2, worldW * (this.zoom?.x || 1));
            const screenH = Math.max(2, worldH * (this.zoom?.y || 1));
            return { x: screenX, y: screenY, w: screenW, h: screenH };
        } catch (e) {
            return null;
        }
    }

    // Remove stale remote cursors from local map
    _cleanupCursors() {
        try {
            const now = Date.now();
            const ttl = this._cursorTTLms || 5000;
            if (this._remoteCursors) {
                for (const [id, entry] of Array.from(this._remoteCursors.entries())) {
                    try {
                        const t = Number(entry.time) || 0;
                        if (t && (now - t) > ttl) this._remoteCursors.delete(id);
                    } catch (e) { continue; }
                }
            }
            if (this._remotePlayerSims) {
                const simTtl = this._playerSimTTLms || 6000;
                for (const [id, entry] of Array.from(this._remotePlayerSims.entries())) {
                    try {
                        const t = Number(entry.time) || 0;
                        if (t && (now - t) > simTtl) this._remotePlayerSims.delete(id);
                    } catch (e) { continue; }
                }
            }
        } catch (e) {}
    }

    // Rotate the stored clipboard 90 degrees clockwise.
    rotateClipboardCW() {
        try {
            if (!this.clipboard && !this._tileClipboard) return;
            const cb = this.clipboard;
            if (cb) {
                // Image clipboard (dense RGBA array)
                if ((cb.type === 'image' || !cb.type) && typeof cb.w === 'number' && typeof cb.h === 'number' && cb.data) {
                    const w = cb.w;
                    const h = cb.h;
                    const old = cb.data;
                    const nw = h;
                    const nh = w;
                    const out = new Uint8ClampedArray(nw * nh * 4);
                    for (let y = 0; y < h; y++) {
                        for (let x = 0; x < w; x++) {
                            const srcIdx = (y * w + x) * 4;
                            const nx = h - 1 - y;
                            const ny = x;
                            const dstIdx = (ny * nw + nx) * 4;
                            out[dstIdx] = old[srcIdx];
                            out[dstIdx + 1] = old[srcIdx + 1];
                            out[dstIdx + 2] = old[srcIdx + 2];
                            out[dstIdx + 3] = old[srcIdx + 3];
                        }
                    }
                    cb.data = out;
                    cb.w = nw;
                    cb.h = nh;
                    if (cb.originOffset) {
                        const ox = cb.originOffset.ox || 0;
                        const oy = cb.originOffset.oy || 0;
                        cb.originOffset = { ox: h - 1 - oy, oy: ox };
                    }
                } else if (cb.type === 'points' && Array.isArray(cb.pixels)) {
                    // Sparse point clipboard: rotate each point and adjust bbox
                    const oldW = cb.w || 0;
                    const oldH = cb.h || 0;
                    for (const p of cb.pixels) {
                        const nx = oldH - 1 - p.y;
                        const ny = p.x;
                        p.x = nx;
                        p.y = ny;
                    }
                    const nw = oldH;
                    const nh = oldW;
                    cb.w = nw;
                    cb.h = nh;
                    if (cb.originOffset) {
                        const ox = cb.originOffset.ox || 0;
                        const oy = cb.originOffset.oy || 0;
                        cb.originOffset = { ox: oldH - 1 - oy, oy: ox };
                    }
                }
            }
            // also rotate tile clipboard if present
            try { this._rotateTileClipboardCW(); } catch (e) {}
        } catch (e) {
            console.warn('rotateClipboardCW failed', e);
        }
    }

    // Rotate the stored tile clipboard 90 degrees clockwise (if present).
    // This will rotate tile positions within the clipboard and bump per-tile transform.rot.
    _rotateTileClipboardCW() {
        try {
            if (!this._tileClipboard || !Array.isArray(this._tileClipboard.tiles) || this._tileClipboard.tiles.length === 0) return;
            const tiles = this._tileClipboard.tiles;
            let maxDc = 0, maxDr = 0;
            for (const t of tiles) {
                const dc = Number(t.dc) || 0;
                const dr = Number(t.dr) || 0;
                if (dc > maxDc) maxDc = dc;
                if (dr > maxDr) maxDr = dr;
            }
            const oldW = maxDc + 1;
            const oldH = maxDr + 1;
            // rotate positions and update transforms
            for (const t of tiles) {
                const dc = Number(t.dc) || 0;
                const dr = Number(t.dr) || 0;
                const nx = oldH - 1 - dr;
                const ny = dc;
                t.dc = nx;
                t.dr = ny;
                if (!t.transform) t.transform = { rot: 0, flipH: false };
                t.transform.rot = ((Number(t.transform.rot) || 0) + 90) % 360;
            }
            // update originOffsetTile if present
            if (this._tileClipboard.originOffsetTile) {
                const ox = Number(this._tileClipboard.originOffsetTile.ox) || 0;
                const oy = Number(this._tileClipboard.originOffsetTile.oy) || 0;
                this._tileClipboard.originOffsetTile = { ox: oldH - 1 - oy, oy: ox };
            }
        } catch (e) {
            console.warn('_rotateTileClipboardCW failed', e);
        }
    }

    // Flip the stored tile clipboard horizontally (mirror left-right).
    _flipTileClipboardH() {
        try {
            if (!this._tileClipboard || !Array.isArray(this._tileClipboard.tiles) || this._tileClipboard.tiles.length === 0) return;
            const tiles = this._tileClipboard.tiles;
            let maxDc = 0;
            for (const t of tiles) {
                const dc = Number(t.dc) || 0;
                if (dc > maxDc) maxDc = dc;
            }
            const oldW = maxDc + 1;
            for (const t of tiles) {
                const dc = Number(t.dc) || 0;
                const nx = oldW - 1 - dc;
                t.dc = nx;
                if (!t.transform) t.transform = { rot: 0, flipH: false };
                t.transform.flipH = !Boolean(t.transform.flipH);
            }
            if (this._tileClipboard.originOffsetTile) {
                const ox = Number(this._tileClipboard.originOffsetTile.ox) || 0;
                const oy = Number(this._tileClipboard.originOffsetTile.oy) || 0;
                this._tileClipboard.originOffsetTile = { ox: oldW - 1 - ox, oy };
            }
        } catch (e) {
            console.warn('_flipTileClipboardH failed', e);
        }
    }

    // Flip the stored clipboard horizontally (mirror left-right).
    flipClipboardH() {
        try {
            if (!this.clipboard && !this._tileClipboard) return;
            const cb = this.clipboard;
            if (cb) {
                // Image clipboard (dense RGBA array)
                if ((cb.type === 'image' || !cb.type) && typeof cb.w === 'number' && typeof cb.h === 'number' && cb.data) {
                    const w = cb.w;
                    const h = cb.h;
                    const old = cb.data;
                    const out = new Uint8ClampedArray(w * h * 4);
                    for (let y = 0; y < h; y++) {
                        for (let x = 0; x < w; x++) {
                            const srcIdx = (y * w + x) * 4;
                            const nx = w - 1 - x;
                            const ny = y;
                            const dstIdx = (ny * w + nx) * 4;
                            out[dstIdx] = old[srcIdx];
                            out[dstIdx + 1] = old[srcIdx + 1];
                            out[dstIdx + 2] = old[srcIdx + 2];
                            out[dstIdx + 3] = old[srcIdx + 3];
                        }
                    }
                    cb.data = out;
                    // dimensions unchanged
                    // adjust originOffset if present (mirror ox horizontally)
                    if (cb.originOffset) {
                        const ox = cb.originOffset.ox || 0;
                        const oy = cb.originOffset.oy || 0;
                        cb.originOffset = { ox: w - 1 - ox, oy };
                    }
                } else if (cb.type === 'points' && Array.isArray(cb.pixels)) {
                    // Sparse point clipboard: mirror each point across vertical center
                    const oldW = cb.w || 0;
                    for (const p of cb.pixels) {
                        p.x = oldW - 1 - p.x;
                    }
                    if (cb.originOffset) {
                        const ox = cb.originOffset.ox || 0;
                        const oy = cb.originOffset.oy || 0;
                        cb.originOffset = { ox: oldW - 1 - ox, oy };
                    }
                }
            }
            // also flip tile clipboard if present
            try { this._flipTileClipboardH(); } catch (e) {}
        } catch (e) {
            console.warn('flipClipboardH failed', e);
        }
    }

    // Compute the draw area used by displayDrawArea and tools.
    // Returns { topLeft, size, padding, dstW, dstH, dstPos }
    computeDrawArea() {
        const drawCtx = this.Draw && this.Draw.ctx;
        if (!drawCtx || !drawCtx.canvas) return null;
        const uiW = drawCtx.canvas.width / this.Draw.Scale.x;
        const uiH = drawCtx.canvas.height / this.Draw.Scale.y;
        const size = new Vector(384, 384);
        const topLeft = new Vector((uiW - size.x) / 2, (uiH - size.y) / 2);
        const padding = 0;
        const dstW = Math.max(1, size.x - padding * 2);
        const dstH = Math.max(1, size.y - padding * 2);
        const dstPos = new Vector(topLeft.x + (size.x - dstW) / 2, topLeft.y + (size.y - dstH) / 2);
        return { topLeft, size, padding, dstW, dstH, dstPos };
    }

    // --- Infinite tile helpers ---
    _tileKey(col, row) {
        return `${col|0},${row|0}`;
    }

    _parseTileKey(key) {
        if (typeof key !== 'string') return null;
        const parts = key.split(',');
        if (parts.length !== 2) return null;
        const c = Number(parts[0]);
        const r = Number(parts[1]);
        if (!Number.isFinite(c) || !Number.isFinite(r)) return null;
        return { col: c|0, row: r|0 };
    }

    _normalizeWaypointKeyList(rawList) {
        try {
            if (!Array.isArray(rawList)) return [];
            const out = [];
            const seen = new Set();
            for (const entry of rawList) {
                let key = null;
                if (typeof entry === 'string') {
                    key = this._parseTileKey(entry) ? entry : null;
                } else if (entry && typeof entry === 'object') {
                    const c = Number(entry.col);
                    const r = Number(entry.row);
                    if (Number.isFinite(c) && Number.isFinite(r)) key = this._tileKey(c | 0, r | 0);
                }
                if (!key || seen.has(key)) continue;
                seen.add(key);
                out.push(key);
            }
            return out;
        } catch (e) {
            return [];
        }
    }

    _getWaypointKeys() {
        try {
            if (!this.state || !this.state.tilemap || !Array.isArray(this.state.tilemap.waypoints)) {
                this.modifyState([], false, false, ['tilemap', 'waypoints']);
                return [];
            }
            const normalized = this._normalizeWaypointKeyList(this.state.tilemap.waypoints);
            if (normalized.length !== this.state.tilemap.waypoints.length
                || normalized.some((v, i) => v !== this.state.tilemap.waypoints[i])) {
                this.modifyState(normalized, false, false, ['tilemap', 'waypoints']);
            }
            return normalized;
        } catch (e) {
            return [];
        }
    }

    _setWaypointKeys(keys, syncOp = true, persistState = true) {
        try {
            const next = this._normalizeWaypointKeyList(keys);
            const prev = this._getWaypointKeys();
            const prevSet = new Set(prev);
            const nextSet = new Set(next);

            if (persistState) this.modifyState(next, false, false, ['tilemap', 'waypoints']);

            if (syncOp) {
                for (const key of prevSet) {
                    if (nextSet.has(key)) continue;
                    const c = this._parseTileKey(key);
                    if (!c) continue;
                    this._queueTileOp('clearWaypoint', { col: c.col | 0, row: c.row | 0 });
                }
                for (const key of nextSet) {
                    if (prevSet.has(key)) continue;
                    const c = this._parseTileKey(key);
                    if (!c) continue;
                    this._queueTileOp('setWaypoint', { col: c.col | 0, row: c.row | 0 });
                }
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    _setWaypointAtTile(col, row, syncOp = true) {
        try {
            const key = this._tileKey(col, row);
            const keys = this._getWaypointKeys();
            if (keys.includes(key)) return false;
            keys.push(key);
            this._setWaypointKeys(keys, syncOp, true);
            return true;
        } catch (e) {
            return false;
        }
    }

    _removeWaypointAtTile(col, row, syncOp = true) {
        try {
            const key = this._tileKey(col, row);
            const keys = this._getWaypointKeys();
            const idx = keys.indexOf(key);
            if (idx < 0) return false;
            keys.splice(idx, 1);
            this._setWaypointKeys(keys, syncOp, true);
            return true;
        } catch (e) {
            return false;
        }
    }

    _toggleWaypointAtTile(col, row, syncOp = true) {
        try {
            return this._removeWaypointAtTile(col, row, syncOp) ? false : this._setWaypointAtTile(col, row, syncOp);
        } catch (e) {
            return false;
        }
    }

    _toggleWaypointAtCursor(posHint = null) {
        try {
            if (!this.tilemode) return false;
            const pos = posHint || this.getPos(this.mouse && this.mouse.pos);
            if (!pos || (!pos.renderOnly && !pos.inside)) return false;
            const c = Number(pos.tileCol);
            const r = Number(pos.tileRow);
            if (!Number.isFinite(c) || !Number.isFinite(r)) return false;
            return this._toggleWaypointAtTile(c | 0, r | 0, true);
        } catch (e) {
            return false;
        }
    }

    _getWaypointCoords(activeOnly = false) {
        try {
            const keys = this._getWaypointKeys();
            const out = [];
            for (const key of keys) {
                const c = this._parseTileKey(key);
                if (!c) continue;
                if (activeOnly && !this._isTileActive(c.col, c.row)) continue;
                out.push(c);
            }
            return out;
        } catch (e) {
            return [];
        }
    }

    _getAreaIndexForCoord(col, row) {
        const key = this._tileKey(col, row);
        if (this._tileCoordToIndex.has(key)) return this._tileCoordToIndex.get(key);
        const idx = this._tileIndexToCoord.length;
        this._tileCoordToIndex.set(key, idx);
        this._tileIndexToCoord.push({ col, row });
        return idx;
    }

    _isTileActive(col, row) {
        return this._tileActive && this._tileActive.has(this._tileKey(col, row));
    }

    _getActiveTileCoords() {
        try {
            if (!this._tileActive || this._tileActive.size === 0) return [];
            const refChanged = this._tileActiveCoordCacheRef !== this._tileActive;
            const version = Number.isFinite(this._tileActiveVersion) ? this._tileActiveVersion : 0;
            const versionChanged = this._tileActiveCoordCacheVersion !== version;
            if (!refChanged && !versionChanged && Array.isArray(this._tileActiveCoordCache)) return this._tileActiveCoordCache;

            const parsed = [];
            for (const key of this._tileActive.values()) {
                const c = this._parseTileKey(key);
                if (c) parsed.push(c);
            }
            this._tileActiveCoordCache = parsed;
            this._tileActiveCoordCacheRef = this._tileActive;
            this._tileActiveCoordCacheVersion = version;
            return parsed;
        } catch (e) {
            return [];
        }
    }

    _getVisibleTileBounds(basePos, size, marginTiles = 1) {
        try {
            const zx = (this.zoom && this.zoom.x) ? this.zoom.x : 1;
            const zy = (this.zoom && this.zoom.y) ? this.zoom.y : 1;
            const ox = (this.offset && this.offset.x) ? this.offset.x : 0;
            const oy = (this.offset && this.offset.y) ? this.offset.y : 0;
            const w = 1920;
            const h = 1080;

            // Inverse of screen = (world + offset) * zoom
            const worldLeft = (0 / zx) - ox;
            const worldTop = (0 / zy) - oy;
            const worldRight = (w / zx) - ox;
            const worldBottom = (h / zy) - oy;

            const sx = size && size.x ? size.x : 1;
            const sy = size && size.y ? size.y : 1;
            const bx = basePos && basePos.x ? basePos.x : 0;
            const by = basePos && basePos.y ? basePos.y : 0;

            return {
                minCol: Math.floor((worldLeft - bx) / sx) - marginTiles,
                maxCol: Math.floor((worldRight - bx) / sx) + marginTiles,
                minRow: Math.floor((worldTop - by) / sy) - marginTiles,
                maxRow: Math.floor((worldBottom - by) / sy) + marginTiles
            };
        } catch (e) {
            return { minCol: -Infinity, maxCol: Infinity, minRow: -Infinity, maxRow: Infinity };
        }
    }

    _activateTile(col, row, syncOp = true) {
        this._queueDeferredTileUndoCapture(syncOp);
        try {
            if (!this._tileActive) this._tileActive = new Set();
            this._tileActive.add(this._tileKey(col, row));
            this._getAreaIndexForCoord(col, row);
            this._tileActiveVersion = (Number.isFinite(this._tileActiveVersion) ? this._tileActiveVersion : 0) + 1;
            if (syncOp) this._queueTileOp('activate', { col: col|0, row: row|0 });
        } catch (e) { /* ignore */ }
    }

    _deactivateTile(col, row, syncOp = true) {
        this._queueDeferredTileUndoCapture(syncOp);
        try {
            const key = this._tileKey(col, row);
            if (this._tileActive) this._tileActive.delete(key);
            this._removeWaypointAtTile(col, row, syncOp);
            this._tileActiveVersion = (Number.isFinite(this._tileActiveVersion) ? this._tileActiveVersion : 0) + 1;
            const idx = this._tileCoordToIndex ? this._tileCoordToIndex.get(key) : null;
            if (Number.isFinite(idx)) {
                this._setAreaBindingAtIndex(idx, null, false);
                this._setAreaTransformAtIndex(idx, null, false);
            }
            if (syncOp) this._queueTileOp('deactivate', { col: col|0, row: row|0 });
        } catch (e) { /* ignore */ }
    }

    _hasAnyTileLayerBindingAtIndex(areaIndex) {
        try {
            this._ensureLayerState();
            if (!Number.isFinite(areaIndex) || areaIndex < 0) return false;
            const idx = areaIndex | 0;
            for (const layer of (this._tileLayers || [])) {
                if (!layer || !Array.isArray(layer.bindings)) continue;
                const b = layer.bindings[idx];
                if (b && b.anim !== undefined && b.index !== undefined) return true;
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    _clearTileOnActiveLayer(col, row, syncOp = true) {
        this._queueDeferredTileUndoCapture(syncOp);
        try {
            this._adoptCurrentTileArraysIntoActiveLayer();
            const idx = this._getAreaIndexForCoord(col, row);
            this._setAreaBindingAtIndex(idx, null, syncOp);
            this._setAreaTransformAtIndex(idx, null, syncOp);

            // Keep tile active if any other tile layer still has content at this coord.
            if (!this._hasAnyTileLayerBindingAtIndex(idx)) {
                this._deactivateTile(col, row, syncOp);
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    _resolveTileLayerIndex(rawLayer = null, fallbackToActive = true) {
        try {
            this._ensureLayerState();
            const max = Math.max(0, (Array.isArray(this._tileLayers) ? this._tileLayers.length : 1) - 1);
            if (!Number.isFinite(Number(rawLayer))) return fallbackToActive ? (this._activeTileLayerIndex | 0) : 0;
            return Math.max(0, Math.min((Number(rawLayer) | 0), max));
        } catch (e) {
            return 0;
        }
    }

    _ensureTileLayerIndex(rawLayer = 0) {
        try {
            this._ensureLayerState();
            let idx = Number(rawLayer);
            if (!Number.isFinite(idx)) idx = 0;
            idx = Math.max(0, idx | 0);
            while (this._tileLayers.length <= idx) {
                const n = this._tileLayers.length + 1;
                this._tileLayers.push({ name: 'Tile Layer ' + n, visibility: 0, bindings: [], transforms: [] });
            }
            return idx;
        } catch (e) {
            return this._resolveTileLayerIndex(rawLayer, false);
        }
    }

    _setAreaBindingAtIndexForLayer(areaIndex, layerIndex, bindingEntry) {
        try {
            this._ensureLayerState();
            if (!Number.isFinite(areaIndex) || areaIndex < 0) return false;
            const idx = areaIndex | 0;
            const li = this._resolveTileLayerIndex(layerIndex, false);
            const layer = this._tileLayers[li];
            if (!layer) return false;
            if (!Array.isArray(layer.bindings)) layer.bindings = [];
            layer.bindings[idx] = bindingEntry;
            if ((this._activeTileLayerIndex | 0) === li) this._areaBindings = layer.bindings;
            return true;
        } catch (e) {
            return false;
        }
    }

    _setAreaTransformAtIndexForLayer(areaIndex, layerIndex, transformEntry) {
        try {
            this._ensureLayerState();
            if (!Number.isFinite(areaIndex) || areaIndex < 0) return false;
            const idx = areaIndex | 0;
            const li = this._resolveTileLayerIndex(layerIndex, false);
            const layer = this._tileLayers[li];
            if (!layer) return false;
            if (!Array.isArray(layer.transforms)) layer.transforms = [];
            layer.transforms[idx] = transformEntry;
            if ((this._activeTileLayerIndex | 0) === li) this._areaTransforms = layer.transforms;
            return true;
        } catch (e) {
            return false;
        }
    }

    _queueTileOp(action, payload = {}) {
        try {
            if (this._suppressOutgoing) return false;
            if (!this._canSendCollab || !this._canSendCollab()) return false;
            const col = Number(payload.col);
            const row = Number(payload.row);
            if (!Number.isFinite(col) || !Number.isFinite(row)) return false;
            if (!this._tileOpPending) this._tileOpPending = new Map();

            const isLayerScoped = (action === 'bind' || action === 'clearBinding' || action === 'setTransform' || action === 'clearTransform');
            const layerForTileData = Number.isFinite(Number(payload.layer))
                ? this._resolveTileLayerIndex(Number(payload.layer), false)
                : this._resolveTileLayerIndex(null, true);

            const key = isLayerScoped
                ? ('l' + String(layerForTileData) + ':' + this._tileKey(col, row))
                : this._tileKey(col, row);
            const pending = this._tileOpPending.get(key) || {};
            if (isLayerScoped) pending.layer = layerForTileData;

            if (action === 'activate') {
                pending.active = true;
            } else if (action === 'deactivate') {
                pending.active = false;
            } else if (action === 'bind') {
                pending.active = true;
                pending.binding = {
                    anim: payload.anim || this.selectedAnimation,
                    index: Number(payload.index) || 0,
                    multiFrames: Array.isArray(payload.multiFrames)
                        ? payload.multiFrames.filter(v => Number.isFinite(v)).map(v => Number(v))
                        : null
                };
            } else if (action === 'clearBinding') {
                pending.binding = null;
            } else if (action === 'setTransform') {
                pending.active = true;
                pending.transform = {
                    rot: Number(payload.rot || 0),
                    flipH: !!payload.flipH
                };
            } else if (action === 'clearTransform') {
                pending.transform = null;
            } else if (action === 'setWaypoint') {
                pending.waypoint = true;
            } else if (action === 'clearWaypoint') {
                pending.waypoint = false;
            } else {
                return false;
            }

            this._tileOpPending.set(key, pending);
            this._autosaveDirty = true;
            this._scheduleSend && this._scheduleSend();
            return true;
        } catch (e) {
            return false;
        }
    }

    _seedTileActives(cols = null, rows = null) {
        try {
            const c = Math.max(1, Number(cols !== null ? cols : this.tileCols) || 1);
            const r = Math.max(1, Number(rows !== null ? rows : this.tileRows) || 1);
            const midC = Math.floor(c / 2);
            const midR = Math.floor(r / 2);
            for (let row = 0; row < r; row++) {
                for (let col = 0; col < c; col++) {
                    const tc = col - midC;
                    const tr = row - midR;
                    this._activateTile(tc, tr);
                }
            }
        } catch (e) { /* ignore */ }
    }

    _tileCoordToPos(col, row, basePos, size) {
        return basePos.clone().add(new Vector(col * size.x, row * size.y));
    }

    _worldToTileCoord(mx, my, basePos, size) {
        const col = Math.floor((mx - basePos.x) / size.x);
        const row = Math.floor((my - basePos.y) / size.y);
        return { col, row };
    }

    _coordFromLegacyIndex(idx, cols, rows) {
        const c = Math.max(1, cols|0);
        const r = Math.max(1, rows|0);
        const midC = Math.floor(c / 2);
        const midR = Math.floor(r / 2);
        const row = Math.floor(idx / c);
        const col = idx % c;
        return { col: col - midC, row: row - midR };
    }

    _normalizeSpriteLayerState() {
        try {
            if (!this.state) this.state = {};
            if (!this.state.spriteLayer || typeof this.state.spriteLayer !== 'object') this.state.spriteLayer = {};
            const layer = this.state.spriteLayer;
            if (!layer.entities || typeof layer.entities !== 'object') layer.entities = {};
            if (!Array.isArray(layer.order)) layer.order = [];
            if (!layer.animationProfiles || typeof layer.animationProfiles !== 'object') layer.animationProfiles = {};
            if (!Number.isFinite(layer.nextEntityId) || layer.nextEntityId < 1) layer.nextEntityId = 1;
            if (!Object.prototype.hasOwnProperty.call(layer, 'selectedAnimation')) layer.selectedAnimation = null;
            if (!Object.prototype.hasOwnProperty.call(layer, 'selectedEntityId')) layer.selectedEntityId = null;
            if (!Object.prototype.hasOwnProperty.call(layer, 'clipboard')) layer.clipboard = null;
            return layer;
        } catch (e) {
            return null;
        }
    }

    _getSpriteEntities() {
        const layer = this._normalizeSpriteLayerState();
        return layer ? layer.entities : {};
    }

    _inferSpriteAnimationParent(anim) {
        try {
            const name = String(anim || '').trim();
            if (!name || !name.includes('-')) return null;
            const parent = name.split('-')[0] || null;
            if (!parent) return null;
            const sheet = this.currentSprite;
            if (!sheet || !sheet._frames || !sheet._frames.has(parent)) return null;
            return parent;
        } catch (e) {
            return null;
        }
    }

    _getSpriteAnimationProfile(anim, createIfMissing = true) {
        try {
            const name = String(anim || '').trim();
            if (!name) return null;
            const layer = this._normalizeSpriteLayerState();
            if (!layer) return null;
            if (!layer.animationProfiles[name] && createIfMissing) {
                layer.animationProfiles[name] = {
                    fps: 8,
                    parent: this._inferSpriteAnimationParent(name)
                };
            }
            return layer.animationProfiles[name] || null;
        } catch (e) {
            return null;
        }
    }

    _getSpriteAnimationFps(anim, fallback = 8) {
        try {
            const profile = this._getSpriteAnimationProfile(anim, true);
            const val = Number(profile && profile.fps);
            return Number.isFinite(val) ? Math.max(0, val) : fallback;
        } catch (e) {
            return fallback;
        }
    }

    _resolveEntityFpsValue(entity, anim, fallback = 8) {
        try {
            const raw = entity ? entity.fps : undefined;
            if (raw === null || raw === undefined || raw === '') return this._getSpriteAnimationFps(anim, fallback);
            const n = Number(raw);
            if (!Number.isFinite(n)) return this._getSpriteAnimationFps(anim, fallback);
            return Math.max(0, n);
        } catch (e) {
            return this._getSpriteAnimationFps(anim, fallback);
        }
    }

    _setSpriteAnimationProfile(anim, patch = {}, syncOp = true) {
        try {
            const name = String(anim || '').trim();
            if (!name) return false;
            const profile = this._getSpriteAnimationProfile(name, true);
            if (!profile) return false;
            if (patch.fps !== undefined) profile.fps = Math.max(0, Number(patch.fps) || 0);
            if (Object.prototype.hasOwnProperty.call(patch, 'parent')) profile.parent = patch.parent || null;
            if (syncOp) this._queueSpriteOp('profile', { anim: name, fps: profile.fps, parent: profile.parent || null });
            return true;
        } catch (e) {
            return false;
        }
    }

    _syncSpriteAnimationProfilesFromSheet() {
        try {
            const layer = this._normalizeSpriteLayerState();
            if (!layer) return;
            const sheet = this.currentSprite;
            if (!sheet || !sheet._frames) return;
            const names = Array.from(sheet._frames.keys());
            for (const name of names) {
                const p = this._getSpriteAnimationProfile(name, true);
                if (p && !Object.prototype.hasOwnProperty.call(p, 'parent')) p.parent = this._inferSpriteAnimationParent(name);
                if (p && (p.fps === null || p.fps === undefined || !Number.isFinite(Number(p.fps)))) p.fps = 8;
            }
            for (const key of Object.keys(layer.animationProfiles)) {
                if (!names.includes(key)) delete layer.animationProfiles[key];
            }
            if (this.selectedSpriteAnimation && !names.includes(this.selectedSpriteAnimation)) {
                this.selectedSpriteAnimation = names[0] || null;
            }
        } catch (e) { /* ignore */ }
    }

    _onAnimationAdded(name) {
        try {
            const anim = String(name || '').trim();
            if (!anim) return;
            this._getSpriteAnimationProfile(anim, true);
            if (!this.selectedSpriteAnimation) this.selectedSpriteAnimation = anim;
        } catch (e) { /* ignore */ }
    }

    _onAnimationRemoved(name) {
        try {
            const anim = String(name || '').trim();
            if (!anim) return;
            const layer = this._normalizeSpriteLayerState();
            if (!layer) return;
            delete layer.animationProfiles[anim];
            for (const id of Object.keys(layer.entities || {})) {
                const ent = layer.entities[id];
                if (ent && ent.anim === anim) this._deleteSpriteEntity(id, true);
            }
            if (this.selectedSpriteAnimation === anim) {
                const names = this.currentSprite && this.currentSprite._frames ? Array.from(this.currentSprite._frames.keys()) : [];
                this.selectedSpriteAnimation = names[0] || null;
            }
        } catch (e) { /* ignore */ }
    }

    _onAnimationRenamed(oldName, newName) {
        try {
            const from = String(oldName || '').trim();
            const to = String(newName || '').trim();
            if (!from || !to || from === to) return;
            const layer = this._normalizeSpriteLayerState();
            if (!layer) return;
            if (layer.animationProfiles[from] && !layer.animationProfiles[to]) {
                layer.animationProfiles[to] = layer.animationProfiles[from];
            }
            delete layer.animationProfiles[from];
            for (const id of Object.keys(layer.entities || {})) {
                const ent = layer.entities[id];
                if (ent && ent.anim === from) ent.anim = to;
            }
            for (const key of Object.keys(layer.animationProfiles || {})) {
                const p = layer.animationProfiles[key];
                if (p && p.parent === from) p.parent = to;
            }
            if (this.selectedSpriteAnimation === from) this.selectedSpriteAnimation = to;
            this._setSpriteAnimationProfile(to, { parent: this._inferSpriteAnimationParent(to) }, true);
        } catch (e) { /* ignore */ }
    }

    _setSpritePlacementAnimation(animName) {
        try {
            const anim = String(animName || '').trim();
            if (!anim) return null;
            this._getSpriteAnimationProfile(anim, true);
            this.selectedSpriteAnimation = anim;
            return anim;
        } catch (e) {
            return null;
        }
    }

    _createSpriteEntityId() {
        const layer = this._normalizeSpriteLayerState();
        if (!layer) return `sp_${Date.now()}`;
        const id = `sp_${Math.max(1, Number(layer.nextEntityId) || 1)}`;
        layer.nextEntityId = Math.max(1, Number(layer.nextEntityId) || 1) + 1;
        return id;
    }

    _addSpriteEntityAt(col, row, anim = null, syncOp = true) {
        try {
            const layer = this._normalizeSpriteLayerState();
            if (!layer) return null;
            const targetAnim = String(anim || this.selectedSpriteAnimation || this.selectedAnimation || '').trim();
            if (!targetAnim) return null;
            const ent = {
                id: this._createSpriteEntityId(),
                col: Number(col) | 0,
                row: Number(row) | 0,
                anim: targetAnim,
                phaseMs: Date.now(),
                fps: null,
                parentAnim: this._inferSpriteAnimationParent(targetAnim)
            };
            layer.entities[ent.id] = ent;
            if (!layer.order.includes(ent.id)) layer.order.push(ent.id);
            layer.selectedEntityId = ent.id;
            this.selectedSpriteEntityId = ent.id;
            this._getSpriteAnimationProfile(targetAnim, true);
            if (syncOp) this._queueSpriteOp('add', { entity: { ...ent } });
            return ent;
        } catch (e) {
            return null;
        }
    }

    _updateSpriteEntity(id, patch = {}, syncOp = true) {
        try {
            const entities = this._getSpriteEntities();
            if (!id || !entities[id]) return false;
            const ent = entities[id];
            Object.assign(ent, patch || {});
            if (patch && patch.anim) ent.parentAnim = this._inferSpriteAnimationParent(ent.anim);
            if (syncOp) this._queueSpriteOp('update', { id, patch: { ...patch } });
            return true;
        } catch (e) {
            return false;
        }
    }

    _deleteSpriteEntity(id, syncOp = true) {
        try {
            const layer = this._normalizeSpriteLayerState();
            if (!layer || !id || !layer.entities[id]) return false;
            delete layer.entities[id];
            layer.order = (layer.order || []).filter(v => v !== id);
            if (layer.selectedEntityId === id) layer.selectedEntityId = null;
            if (this.selectedSpriteEntityId === id) this.selectedSpriteEntityId = null;
            if (syncOp) this._queueSpriteOp('delete', { id });
            return true;
        } catch (e) {
            return false;
        }
    }

    _hitTestSpriteEntityAt(col, row) {
        try {
            const layer = this._normalizeSpriteLayerState();
            if (!layer) return null;
            const order = Array.isArray(layer.order) ? layer.order : [];
            const entities = layer.entities || {};
            for (let i = order.length - 1; i >= 0; i--) {
                const id = order[i];
                const e = entities[id];
                if (!e) continue;
                if ((Number(e.col) | 0) === (Number(col) | 0) && (Number(e.row) | 0) === (Number(row) | 0)) return id;
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    _queueSpriteOp(action, payload = {}) {
        try {
            if (this._suppressOutgoing) return false;
            if (!this._canSendCollab || !this._canSendCollab()) return false;
            if (!this._spriteOpPending) this._spriteOpPending = new Map();
            if (action === 'add') {
                const entity = payload && payload.entity ? payload.entity : null;
                if (!entity || !entity.id) return false;
                this._spriteOpPending.set(String(entity.id), { k: 'add', e: { ...entity } });
            } else if (action === 'update') {
                const id = String(payload.id || '');
                if (!id) return false;
                const current = this._spriteOpPending.get(id);
                if (current && current.k === 'add') {
                    current.e = { ...current.e, ...(payload.patch || {}) };
                    this._spriteOpPending.set(id, current);
                } else {
                    const prevPatch = (current && current.k === 'update' && current.p) ? current.p : {};
                    this._spriteOpPending.set(id, { k: 'update', id, p: { ...prevPatch, ...(payload.patch || {}) } });
                }
            } else if (action === 'delete') {
                const id = String(payload.id || '');
                if (!id) return false;
                this._spriteOpPending.set(id, { k: 'delete', id });
            } else if (action === 'profile') {
                const anim = String(payload.anim || '');
                if (!anim) return false;
                this._spriteOpPending.set(`profile:${anim}`, { k: 'profile', anim, fps: Number(payload.fps) || 0, parent: payload.parent || null });
            } else {
                return false;
            }
            this._autosaveDirty = true;
            this._scheduleSend && this._scheduleSend();
            return true;
        } catch (e) {
            return false;
        }
    }

    _getAnimationLogicalFrameCount(anim) {
        try {
            const arr = (this.currentSprite && this.currentSprite._frames) ? (this.currentSprite._frames.get(anim) || []) : [];
            let logical = 0;
            for (let i = 0; i < arr.length; i++) {
                const entry = arr[i];
                if (!entry || entry.__groupStart || entry.__groupEnd) continue;
                logical++;
            }
            return Math.max(1, logical);
        } catch (e) {
            return 1;
        }
    }

    _advanceSpriteEntityAnimation(tickDelta = 0) {
        try {
            const layer = this._normalizeSpriteLayerState();
            if (!layer || !layer.entities) return;
            if (!this._spriteAnimRuntime || !(this._spriteAnimRuntime instanceof Map)) this._spriteAnimRuntime = new Map();

            const dt = Math.max(0, Number(tickDelta) || 0);
            const entities = layer.entities;
            const activeAnims = new Set();

            for (const ent of Object.values(entities)) {
                if (!ent) continue;
                const anim = String(ent.anim || this.selectedAnimation || 'idle');
                if (!anim) continue;
                activeAnims.add(anim);
            }

            for (const anim of activeAnims.values()) {
                const frameCount = this._getAnimationLogicalFrameCount(anim);
                const fps = this._getSpriteAnimationFps(anim, 8);

                let runtime = this._spriteAnimRuntime.get(String(anim));
                if (!runtime || runtime.anim !== anim || runtime.fps !== fps || runtime.frameCount !== frameCount) {
                    runtime = {
                        anim,
                        fps,
                        frameCount,
                        frame: 0,
                        accSec: 0
                    };
                }

                if (fps > 0 && frameCount > 1 && dt > 0) {
                    runtime.accSec += dt;
                    const step = 1 / fps;
                    while (runtime.accSec >= step) {
                        runtime.accSec -= step;
                        runtime.frame = (runtime.frame + 1) % frameCount;
                    }
                } else {
                    runtime.frame = Math.max(0, Math.min(frameCount - 1, Number(runtime.frame) || 0));
                    if (!(fps > 0)) runtime.accSec = 0;
                }

                this._spriteAnimRuntime.set(String(anim), runtime);
            }

            for (const key of Array.from(this._spriteAnimRuntime.keys())) {
                if (!activeAnims.has(String(key))) this._spriteAnimRuntime.delete(key);
            }
        } catch (e) { /* ignore sprite anim runtime errors */ }
    }

    _drawRenderOnlyTileBatch(basePos, size, visible, hoverCoord = null) {
        try {
            const ctx = this.Draw && this.Draw.ctx;
            const sheet = this.currentSprite;
            if (!ctx || !sheet || !visible || !size || !basePos) return [];

            const activeSet = this._tileActive;
            const activeCount = activeSet ? (activeSet.size || 0) : 0;
            const minCol = visible.minCol | 0;
            const maxCol = visible.maxCol | 0;
            const minRow = visible.minRow | 0;
            const maxRow = visible.maxRow | 0;
            const visibleCols = Math.max(0, maxCol - minCol + 1);
            const visibleRows = Math.max(0, maxRow - minRow + 1);
            const visibleCount = visibleCols * visibleRows;
            const iterateVisibleWindow = visibleCount > 0 && (activeCount === 0 || activeCount > (visibleCount * 2));

            const frameCache = this._renderOnlyFrameCache || (this._renderOnlyFrameCache = new Map());
            frameCache.clear();
            const frameFor = (anim, frameIdx) => {
                const k = `${anim || ''}::${Number(frameIdx) || 0}`;
                if (frameCache.has(k)) return frameCache.get(k);
                let fr = null;
                try { fr = this._getCompositedPixelFrame(anim, frameIdx, false, true); } catch (e) { fr = null; }
                frameCache.set(k, fr || null);
                return fr;
            };

            const sx = size.x;
            const sy = size.y;
            const bx = basePos.x;
            const by = basePos.y;
            const scaleX = (this.Draw && this.Draw.Scale && Number.isFinite(this.Draw.Scale.x)) ? this.Draw.Scale.x : 1;
            const scaleY = (this.Draw && this.Draw.Scale && Number.isFinite(this.Draw.Scale.y)) ? this.Draw.Scale.y : 1;
            const entryCache = this._renderOnlyEntryCache || (this._renderOnlyEntryCache = new Map());
            entryCache.clear();
            const entriesForIdx = (idx) => {
                const key = idx | 0;
                if (entryCache.has(key)) return entryCache.get(key);
                const list = this._getTileLayerDrawEntries(key) || [];
                entryCache.set(key, list);
                return list;
            };

            const prevSmooth = ctx.imageSmoothingEnabled;
            try { ctx.imageSmoothingEnabled = false; } catch (e) {}

            const drawTileAt = (col, row, isActive) => {
                const x = bx + col * sx;
                const y = by + row * sy;
                const dx = x * scaleX;
                const dy = y * scaleY;
                const dw = sx * scaleX;
                const dh = sy * scaleY;
                if (!isActive) {
                    if (hoverCoord && col === hoverCoord.col && row === hoverCoord.row) {
                        ctx.fillStyle = '#222222DD';
                        ctx.fillRect(dx, dy, dw, dh);
                        ctx.strokeStyle = '#000000AA';
                        ctx.lineWidth = Math.max(1, Math.round(scaleX));
                        ctx.strokeRect(dx + 0.5, dy + 0.5, Math.max(1, dw - 1), Math.max(1, dh - 1));
                    }
                    return;
                }

                const idx = this._getAreaIndexForCoord(col, row);
                const entries = entriesForIdx(idx);
                if (!entries || entries.length === 0) return;
                for (const entry of entries) {
                    if (!entry || !entry.binding) continue;
                    const b = entry.binding;
                    const anim = b.anim;
                    const multi = Array.isArray(b.multiFrames) ? b.multiFrames : null;
                    ctx.save();
                    ctx.globalAlpha = Math.max(0, Math.min(1, Number(entry.alpha) || 1));
                    if (multi && multi.length > 0) {
                        for (let mi = 0; mi < multi.length; mi++) {
                            const fi = Number(multi[mi]);
                            if (!Number.isFinite(fi)) continue;
                            const fr = frameFor(anim, fi);
                            if (!fr) continue;
                            ctx.drawImage(fr, dx, dy, dw, dh);
                        }
                    } else {
                        const fr = frameFor(anim, Number(b.index) || 0);
                        if (fr) ctx.drawImage(fr, dx, dy, dw, dh);
                    }
                    ctx.restore();
                    if ((Number(entry.darken) || 0) > 0) {
                        ctx.save();
                        ctx.globalAlpha = Math.max(0, Math.min(1, Number(entry.darken) || 0));
                        ctx.fillStyle = '#000000';
                        ctx.fillRect(dx, dy, dw, dh);
                        ctx.restore();
                    }
                }
            };

            const hoverCol = hoverCoord ? (hoverCoord.col | 0) : null;
            const hoverRow = hoverCoord ? (hoverCoord.row | 0) : null;

            if (iterateVisibleWindow) {
                for (let row = minRow; row <= maxRow; row++) {
                    for (let col = minCol; col <= maxCol; col++) {
                        const isActive = !!(activeSet && activeSet.has(`${col},${row}`));
                        if (!isActive && !(hoverCoord && col === hoverCol && row === hoverRow)) continue;
                        drawTileAt(col, row, isActive);
                    }
                }
            } else {
                const activeCoords = this._getActiveTileCoords();
                for (let i = 0; i < activeCoords.length; i++) {
                    const c = activeCoords[i];
                    const col = c.col | 0;
                    const row = c.row | 0;
                    if (col < minCol || col > maxCol || row < minRow || row > maxRow) continue;
                    drawTileAt(col, row, true);
                }
                if (hoverCoord) {
                    const hk = `${hoverCol},${hoverRow}`;
                    if (!(activeSet && activeSet.has(hk)) && hoverCol >= minCol && hoverCol <= maxCol && hoverRow >= minRow && hoverRow <= maxRow) {
                        drawTileAt(hoverCol, hoverRow, false);
                    }
                }
            }

            try { ctx.imageSmoothingEnabled = prevSmooth; } catch (e) {}

            // Keep minimal draw-area metadata for hit resolution and UI overlays.
            const areas = this._renderOnlyAreas || (this._renderOnlyAreas = []);
            areas.length = 0;
            if (hoverCoord && Number.isFinite(hoverCol) && Number.isFinite(hoverRow)) {
                const hx = bx + hoverCol * sx;
                const hy = by + hoverRow * sy;
                const info = this._renderOnlyHoverArea || (this._renderOnlyHoverArea = {
                    topLeft: new Vector(0, 0),
                    size: null,
                    padding: 0,
                    dstW: 0,
                    dstH: 0,
                    dstPos: new Vector(0, 0),
                    renderOnly: true,
                    areaIndex: 0,
                    tileCol: 0,
                    tileRow: 0,
                    active: false
                });
                info.topLeft.x = hx;
                info.topLeft.y = hy;
                info.size = size;
                info.padding = 0;
                info.dstW = sx;
                info.dstH = sy;
                info.dstPos.x = hx;
                info.dstPos.y = hy;
                info.renderOnly = true;
                info.areaIndex = this._getAreaIndexForCoord(hoverCol, hoverRow);
                info.tileCol = hoverCol;
                info.tileRow = hoverRow;
                info.active = !!this._isTileActive(info.tileCol, info.tileRow);
                areas.push(info);
            }
            return areas;
        } catch (e) {
            return [];
        }
    }

    _shouldCullArea(area) {
        // Use fixed 1920x1080 screen for culling; skip render only when fully off-screen.
        const SCREEN_W = 1920;
        const SCREEN_H = 1080;
        if (!area || !area.dstPos || area.dstW === undefined || area.dstH === undefined) return false;
        const zx = this.zoom && this.zoom.x ? this.zoom.x : 1;
        const zy = this.zoom && this.zoom.y ? this.zoom.y : 1;
        const ox = this.offset && this.offset.x ? this.offset.x : 0;
        const oy = this.offset && this.offset.y ? this.offset.y : 0;

        // screen-space rectangle after current transform: screen = (world + offset) * zoom
        const scrX = (area.dstPos.x + ox) * zx;
        const scrY = (area.dstPos.y + oy) * zy;
        const scrW = area.dstW * zx;
        const scrH = area.dstH * zy;

        // Off-screen cull only
        if (scrX > SCREEN_W || scrX + scrW < 0) return true;
        if (scrY > SCREEN_H || scrY + scrH < 0) return true;
        return false;
    }

    _isSimTooSmall(area) {
        // Simulation distance: if on-screen size is tiny, treat as render-only (no UI/edits).
        const SCREEN_W = 1920;
        const SCREEN_H = 1080;
        if (!area || area.dstW === undefined || area.dstH === undefined) return false;
        const zx = this.zoom && this.zoom.x ? this.zoom.x : 1;
        const zy = this.zoom && this.zoom.y ? this.zoom.y : 1;
        const scrW = area.dstW * zx;
        const scrH = area.dstH * zy;
        const minW = SCREEN_W / 6;
        const minH = SCREEN_H / 6;
        return (scrW < minW) || (scrH < minH);
    }

    // Compute area info for an arbitrary pos/size (same return shape as computeDrawArea)
    computeAreaInfo(pos, size) {
        const drawCtx = this.Draw && this.Draw.ctx;
        if (!drawCtx || !drawCtx.canvas || !pos || !size) return null;
        const uiW = drawCtx.canvas.width / this.Draw.Scale.x;
        const uiH = drawCtx.canvas.height / this.Draw.Scale.y;
        const padding = 0;
        const dstW = Math.max(1, size.x - padding * 2);
        const dstH = Math.max(1, size.y - padding * 2);
        const dstPos = new Vector(pos.x + (size.x - dstW) / 2, pos.y + (size.y - dstH) / 2);
        return { topLeft: pos, size, padding, dstW, dstH, dstPos };
    }

    _getCheckerboardCanvas(width, height, tileSize = null) {
        try {
            const w = Math.max(1, Math.ceil(Number(width) || 1));
            const h = Math.max(1, Math.ceil(Number(height) || 1));
            const ts = Math.max(1, Math.floor(Number(tileSize || this._checkerboardTileSize || 16)));
            const light = this._checkerboardLight || '#3a3a3aff';
            const dark = this._checkerboardDark || '#2e2e2eff';
            const key = `${w}x${h}@${ts}:${light}:${dark}`;
            if (this._checkerboardCache && this._checkerboardCache.has(key)) return this._checkerboardCache.get(key);

            const base = document.createElement('canvas');
            base.width = ts * 2;
            base.height = ts * 2;
                                    const tctx = topFrame.getContext('2d');
                                    const wctx = wallFrame.getContext('2d');
                                    const topImg = tctx.getImageData(0, 0, px, px).data;
                                    const wallImg = wctx.getImageData(0, 0, px, px).data;
                                    const odata = outImage.data;
                                    const seamY = Math.max(0, bottomBoundary);
                                    // Determine which connection bits indicate bottom/outside
                                    const edgeBottomOutside = !!bits[2];
                                    const cornerBROutside = !!bits[6];
                                    const cornerBLOutside = !!bits[7];
                                    // Only trigger wall compositing when the bottom edge is outside.
                                    // Ignore corner-only outside signals so left/right edges forcing
                                    // corner bits don't cause bottom compositing.
                                    const needWall = edgeBottomOutside;
                                    try { console.log('[gen] depth needWall', JSON.stringify({ openKey: openKey, edgeBottomOutside, cornerBROutside, cornerBLOutside, needWall })); } catch (e) {}
                                    if (!needWall) {
                                        // copy top frame entirely
                                        outImage.data.set(topImg);
                                    } else {
                                        // corner sizing - match later outline corner math
                                        const cornerRadiusLocal = Math.max(1, Math.round(px * 0.32));
                                        const cornerZone = Math.max(1, Math.floor(cornerRadiusLocal));
                                        const isInBottomRightCorner = (xx, yy) => {
                                            return ((px - 1 - xx) <= cornerZone) && ((px - 1 - yy) <= cornerZone);
                                        };
                                        const isInBottomLeftCorner = (xx, yy) => {
                                            return (xx <= cornerZone) && ((px - 1 - yy) <= cornerZone);
                                        };
                                        for (let yy = 0; yy < px; yy++) {
                                            for (let xx = 0; xx < px; xx++) {
                                                const idx = (yy * px + xx) * 4;
                                                // keep top pixels above seam
                                                if (yy <= seamY) {
                                                    odata[idx] = topImg[idx];
                                                    odata[idx + 1] = topImg[idx + 1];
                                                    odata[idx + 2] = topImg[idx + 2];
                                                    odata[idx + 3] = topImg[idx + 3];
                                                    continue;
                                                }
                                                // below seam: only replace where bottom/outside is requested
                                                let useWall = false;
                                                if (edgeBottomOutside) useWall = true;
                                                else if (cornerBROutside && isInBottomRightCorner(xx, yy)) useWall = true;
                                                else if (cornerBLOutside && isInBottomLeftCorner(xx, yy)) useWall = true;

                                                if (useWall) {
                                                    odata[idx] = wallImg[idx];
                                                    odata[idx + 1] = wallImg[idx + 1];
                                                    odata[idx + 2] = wallImg[idx + 2];
                                                    odata[idx + 3] = wallImg[idx + 3];
                                                } else {
                                                    // use the top frame pixel when wall isn't requested
                                                    odata[idx] = topImg[idx];
                                                    odata[idx + 1] = topImg[idx + 1];
                                                    odata[idx + 2] = topImg[idx + 2];
                                                    odata[idx + 3] = topImg[idx + 3];
                                                }
                                            }
                                        }
                                    }
        } catch (e) {
            return null;
        }
    }

    // Helpers to map between displayed (transformed) pixel coords and source pixel coords
    // relX/relY are fractions in [0,1) across the frame (0 => left/top, 1 => right/bottom)
    _displayToSourcePixel(relX, relY, transform, slicePx) {
        // Map display fractional coords to source fractional coords by applying inverse transform
        if (!transform || (!transform.rot && !transform.flipH)) return { relX, relY };
        const N = slicePx || 1;
        // Convert to pixel-space float
        const dx = relX * N;
        const dy = relY * N;
        const cx = dx - N / 2;
        const cy = dy - N / 2;
        // inverse rotate: rotate CCW by rot degrees
        let ix = cx;
        let iy = cy;
        const rot = (transform.rot || 0) % 360;
        // inverse rotate mapping
        if (rot === 90) { // display = rotateCW(source) so inverse is rotateCCW
            // rotate CCW 90: (x,y) -> ( -y, x )
            ix = -cx; iy = cy;
            // Wait: careful: for inverse of cw90, use (x,y) -> ( -y, x ) applied to display coords
            const tmpx = -cy; const tmpy = cx; ix = tmpx; iy = tmpy;
        } else if (rot === 180) {
            ix = -cx; iy = -cy;
        } else if (rot === 270) {
            // inverse of 270cw is rotateCW 90 (or rotate CCW 270): (x,y)->( y, -x )
            const tmpx = cy; const tmpy = -cx; ix = tmpx; iy = tmpy;
        }
        // inverse flip (flip was applied before rotation), so inverse order: inverse rotate then flip
        if (transform.flipH) {
            ix = -ix;
        }
        // back to fractional coords
        const sx = (ix + N / 2) / N;
        const sy = (iy + N / 2) / N;
        return { relX: sx, relY: sy };
    }

    _sourceToDisplayPixel(relX, relY, transform, slicePx) {
        // Map source fractional coords to displayed fractional coords by applying forward transform
        if (!transform || (!transform.rot && !transform.flipH)) return { relX, relY };
        const N = slicePx || 1;
        const sx = relX * N;
        const sy = relY * N;
        let cx = sx - N / 2;
        let cy = sy - N / 2;
        // apply flip then rotation as in drawing code (flip before rotate)
        if (transform.flipH) cx = -cx;
        const rot = (transform.rot || 0) % 360;
        let dx = cx;
        let dy = cy;
        if (rot === 90) {
            // rotate 90 CW: (x,y) -> ( y, -x )
            const tmpx = cy; const tmpy = -cx; dx = tmpx; dy = tmpy;
        } else if (rot === 180) {
            dx = -cx; dy = -cy;
        } else if (rot === 270) {
            // rotate 270 CW (or 90 CCW): (x,y) -> ( -y, x )
            const tmpx = -cy; const tmpy = cx; dx = tmpx; dy = tmpy;
        }
        const relDx = (dx + N / 2) / N;
        const relDy = (dy + N / 2) / N;
        return { relX: relDx, relY: relDy };
    }

    _remapAnimationReferences(oldName, newName) {
        try {
            const from = String(oldName || '').trim();
            const to = String(newName || '').trim();
            if (!from || !to || from === to) return false;

            if (this.selectedAnimation === from) this.selectedAnimation = to;

            if (this._tileBrushBinding && this._tileBrushBinding.anim === from) {
                this._tileBrushBinding = { ...this._tileBrushBinding, anim: to };
            }

            if (Array.isArray(this._areaBindings)) {
                for (let i = 0; i < this._areaBindings.length; i++) {
                    const b = this._areaBindings[i];
                    if (!b || typeof b !== 'object') continue;
                    if (b.anim === from) b.anim = to;
                }
            }

            if (this._selectionKeyframeTrack && this._selectionKeyframeTrack.anim === from) {
                this._selectionKeyframeTrack.anim = to;
            }

            if (this._tileConnMap && typeof this._tileConnMap === 'object') {
                const next = {};
                for (const key of Object.keys(this._tileConnMap)) {
                    const value = this._tileConnMap[key];
                    if (key.startsWith(from + '::')) {
                        next[to + key.slice(from.length)] = value;
                    } else {
                        next[key] = value;
                    }
                }
                this._tileConnMap = next;
            }

            return true;
        } catch (e) {
            return false;
        }
    }//

    _remapAnimationFrameReferences(animName, oldToNew, options = {}) {
        try {
            const anim = String(animName || '').trim();
            if (!anim || !oldToNew || typeof oldToNew !== 'object') return false;
            const skipSelection = !!(options && options.skipSelection);

            const hasMapped = (idx) => Object.prototype.hasOwnProperty.call(oldToNew, String(idx));
            const mapIndex = (idx) => {
                if (!Number.isFinite(Number(idx))) return null;
                const key = String(Number(idx) | 0);
                if (!hasMapped(key)) return null;
                const mapped = Number(oldToNew[key]);
                if (!Number.isFinite(mapped) || mapped < 0) return null;
                return mapped | 0;
            };

            const frameCount = Math.max(0, Number(this._getAnimationFrameCountSafe(anim)) || 0);
            const fallbackFrame = frameCount > 0 ? (frameCount - 1) : 0;

            if (!skipSelection && this.selectedAnimation === anim && Number.isFinite(Number(this.selectedFrame))) {
                const mappedSelected = mapIndex(this.selectedFrame);
                this.selectedFrame = Number.isFinite(mappedSelected)
                    ? mappedSelected
                    : Math.max(0, Math.min(fallbackFrame, Number(this.selectedFrame) | 0));
            }

            if (this._tileBrushBinding && this._tileBrushBinding.anim === anim) {
                const mappedBrush = mapIndex(this._tileBrushBinding.index);
                if (Number.isFinite(mappedBrush)) {
                    this._tileBrushBinding = { ...this._tileBrushBinding, index: mappedBrush };
                } else if (frameCount > 0) {
                    this._tileBrushBinding = { ...this._tileBrushBinding, index: fallbackFrame };
                } else {
                    this._tileBrushBinding = null;
                }
            }

            const remapBindingArray = (arr) => {
                if (!Array.isArray(arr)) return;
                for (let i = 0; i < arr.length; i++) {
                    const binding = arr[i];
                    if (!binding || typeof binding !== 'object') continue;
                    if (binding.anim !== anim) continue;

                    const mappedPrimary = mapIndex(binding.index);
                    let mappedMulti = null;
                    if (Array.isArray(binding.multiFrames)) {
                        const next = [];
                        const seen = new Set();
                        for (const v of binding.multiFrames) {
                            const m = mapIndex(v);
                            if (!Number.isFinite(m)) continue;
                            if (seen.has(m)) continue;
                            seen.add(m);
                            next.push(m);
                        }
                        mappedMulti = next;
                    }

                    if (Number.isFinite(mappedPrimary)) {
                        binding.index = mappedPrimary;
                    } else if (mappedMulti && mappedMulti.length > 0) {
                        binding.index = mappedMulti[0];
                    } else {
                        arr[i] = null;
                        continue;
                    }

                    if (Array.isArray(binding.multiFrames)) {
                        binding.multiFrames = (mappedMulti && mappedMulti.length > 0) ? mappedMulti : null;
                    }
                }
            };

            const seenBindingArrays = new Set();
            if (Array.isArray(this._areaBindings)) {
                seenBindingArrays.add(this._areaBindings);
                remapBindingArray(this._areaBindings);
            }
            if (Array.isArray(this._tileLayers)) {
                for (const layer of this._tileLayers) {
                    if (!layer || !Array.isArray(layer.bindings)) continue;
                    if (seenBindingArrays.has(layer.bindings)) continue;
                    seenBindingArrays.add(layer.bindings);
                    remapBindingArray(layer.bindings);
                }
            }

            if (this._selectionKeyframeTrack && this._selectionKeyframeTrack.anim === anim && Array.isArray(this._selectionKeyframeTrack.frames)) {
                const nextFrames = [];
                const srcFrames = this._selectionKeyframeTrack.frames;
                for (let oldIdx = 0; oldIdx < srcFrames.length; oldIdx++) {
                    const mapped = mapIndex(oldIdx);
                    if (!Number.isFinite(mapped)) continue;
                    nextFrames[mapped] = srcFrames[oldIdx];
                }
                this._selectionKeyframeTrack.frames = nextFrames;
            }

            if (!skipSelection && this._selectionKeyframeLastAnim === anim) {
                const mappedLast = mapIndex(this._selectionKeyframeLastFrame);
                this._selectionKeyframeLastFrame = Number.isFinite(mappedLast)
                    ? mappedLast
                    : Math.max(0, Math.min(fallbackFrame, Number(this._selectionKeyframeLastFrame) | 0));
            }

            if (this._tileConnMap && typeof this._tileConnMap === 'object') {
                const nextConnMap = {};
                for (const key of Object.keys(this._tileConnMap)) {
                    const value = this._tileConnMap[key];
                    const splitAt = key.lastIndexOf('::');
                    if (splitAt <= 0) {
                        nextConnMap[key] = value;
                        continue;
                    }
                    const keyAnim = key.slice(0, splitAt);
                    if (keyAnim !== anim) {
                        nextConnMap[key] = value;
                        continue;
                    }
                    const keyIndex = Number(key.slice(splitAt + 2));
                    const mapped = mapIndex(keyIndex);
                    if (!Number.isFinite(mapped)) continue;
                    nextConnMap[keyAnim + '::' + mapped] = value;
                }
                this._tileConnMap = nextConnMap;
            }

            return true;
        } catch (e) {
            return false;
        }
    }

    _normalizePixelLayerVisibility(value, fallback = 0) {
        const n = Number(value);
        if (!Number.isFinite(n)) return Math.max(0, Math.min(2, Number(fallback) | 0));
        return Math.max(0, Math.min(2, n | 0)); // 0=half,1=full,2=hidden
    }

    _ensurePixelLayerStore() {
        if (!Array.isArray(this._pixelLayerStores)) this._pixelLayerStores = [];
        const targetLen = Math.max(1, Array.isArray(this._pixelLayers) ? this._pixelLayers.length : 1);
        while (this._pixelLayerStores.length < targetLen) this._pixelLayerStores.push({ byAnim: new Map() });
        if (this._pixelLayerStores.length > targetLen) this._pixelLayerStores.length = targetLen;
        for (let i = 0; i < this._pixelLayerStores.length; i++) {
            const e = this._pixelLayerStores[i];
            if (!e || !(e.byAnim instanceof Map)) this._pixelLayerStores[i] = { byAnim: new Map() };
        }
    }

    _rawSheetGetFrame(anim, frameIdx) {
        try {
            const sheet = this.currentSprite;
            if (!sheet) return null;
            if (sheet.__pixelLayerRawGetFrame) return sheet.__pixelLayerRawGetFrame(anim, frameIdx);
            if (typeof sheet.getFrame === 'function') return sheet.getFrame(anim, frameIdx);
            return null;
        } catch (e) {
            return null;
        }
    }

    _ensurePixelLayerFrameCanvas(layerIndex, anim, frameIdx, create = true) {
        try {
            const li = Math.max(0, Number(layerIndex) | 0);
            const a = String(anim || this.selectedAnimation || 'idle');
            const fi = Math.max(0, Number(frameIdx) | 0);
            const sheet = this.currentSprite;
            if (!sheet) return null;
            if (li === 0) {
                return this._rawSheetGetFrame(a, fi);
            }

            this._ensurePixelLayerStore();
            const store = this._pixelLayerStores[li];
            if (!store || !(store.byAnim instanceof Map)) return null;
            let arr = store.byAnim.get(a);
            if (!Array.isArray(arr)) {
                if (!create) return null;
                arr = [];
                store.byAnim.set(a, arr);
            }
            if (!create && !arr[fi]) return null;
            while (arr.length <= fi) arr.push(null);
            if (!arr[fi] && create) {
                const ref = this._rawSheetGetFrame(a, fi);
                const c = document.createElement('canvas');
                c.width = (ref && ref.width) ? ref.width : (sheet.slicePx || 16);
                c.height = (ref && ref.height) ? ref.height : (sheet.slicePx || 16);
                const cx = c.getContext('2d');
                try { cx.clearRect(0, 0, c.width, c.height); } catch (e) {}
                arr[fi] = c;
            }
            return arr[fi] || null;
        } catch (e) {
            return null;
        }
    }

    _applyPixelsToPixelLayer(anim, frameIdx, pixels, layerIndex = null) {
        try {
            const li = Number.isFinite(Number(layerIndex))
                ? Math.max(0, Math.min(Number(layerIndex) | 0, Math.max(0, (this._pixelLayers?.length || 1) - 1)))
                : (this._activePixelLayerIndex | 0);
            if (!Array.isArray(pixels) || pixels.length <= 0) return false;
            const frame = this._ensurePixelLayerFrameCanvas(li, anim, frameIdx, true);
            if (!frame || !frame.getContext) return false;
            const ctx = frame.getContext('2d');
            const parseColor = (raw) => {
                try {
                    const colorObj = Color.convertColor(raw);
                    const rgb = (colorObj && typeof colorObj.toRgb === 'function') ? colorObj.toRgb() : colorObj;

                    const rRaw = (rgb && rgb.a !== undefined) ? rgb.a : rgb?.r;
                    const gRaw = (rgb && rgb.b !== undefined) ? rgb.b : rgb?.g;
                    const bRaw = (rgb && rgb.c !== undefined) ? rgb.c : rgb?.b;
                    const aRaw = (rgb && rgb.d !== undefined) ? rgb.d : rgb?.a;

                    const rr = Math.max(0, Math.min(255, Number(rRaw) | 0));
                    const gg = Math.max(0, Math.min(255, Number(gRaw) | 0));
                    const bb = Math.max(0, Math.min(255, Number(bRaw) | 0));
                    let aa = Number(aRaw);
                    if (!Number.isFinite(aa)) aa = 1;
                    // Accept 0..255 alpha too.
                    if (aa > 1) aa = aa / 255;
                    aa = Math.max(0, Math.min(1, aa));
                    return { r: rr, g: gg, b: bb, a: aa };
                } catch (e) {
                    return { r: 0, g: 0, b: 0, a: 0 };
                }
            };
            for (const p of pixels) {
                if (!p) continue;
                const x = Math.floor(Number(p.x));
                const y = Math.floor(Number(p.y));
                if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
                if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) continue;
                const color = (p.color !== undefined) ? p.color : ((p.col !== undefined) ? p.col : ((p.c !== undefined) ? p.c : '#00000000'));
                const rgba = parseColor(color);

                if (rgba.a <= 0) {
                    ctx.clearRect(x, y, 1, 1);
                    continue;
                }

                ctx.fillStyle = `rgba(${rgba.r},${rgba.g},${rgba.b},${rgba.a})`;
                ctx.fillRect(x, y, 1, 1);
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    _getCompositedPixelFrame(anim, frameIdx, includeHidden = false, forceDimFullVisibility = false) {
        try {
            this._ensureLayerState();
            this._ensurePixelLayerStore();
            const a = String(anim || this.selectedAnimation || 'idle');
            const fi = Math.max(0, Number(frameIdx) | 0);
            const layers = Array.isArray(this._pixelLayers) ? this._pixelLayers : [{ name: 'Pixel Layer 1', visibility: 0 }];
            const active = Math.max(0, Math.min((this._activePixelLayerIndex | 0), layers.length - 1));
            const previewActive = !!(this._playerSimMode && this._playerSimMode.active);
            const cache = (this._compositedFrameCache && this._compositedFrameCache instanceof Map) ? this._compositedFrameCache : null;
            const cacheKey = `${a}|${fi}|${includeHidden ? 1 : 0}|${forceDimFullVisibility ? 1 : 0}|${active}|${previewActive ? 1 : 0}|${layers.length}`;
            if (cache && cache.has(cacheKey)) return cache.get(cacheKey);

            let width = 0;
            let height = 0;
            const refs = [];
            for (let i = 0; i < layers.length; i++) {
                const layer = layers[i] || {};
                const vis = this._normalizePixelLayerVisibility(layer.visibility, 0);
                if (!includeHidden && vis === 2) continue;
                const frame = this._ensurePixelLayerFrameCanvas(i, a, fi, false);
                if (!frame) continue;
                width = Math.max(width, Number(frame.width) || 0);
                height = Math.max(height, Number(frame.height) || 0);
                refs.push({ i, frame, vis });
            }

            if (refs.length === 0) {
                const fallback = this._ensurePixelLayerFrameCanvas(active, a, fi, true);
                if (cache) cache.set(cacheKey, fallback || null);
                return fallback || null;
            }

            const c = document.createElement('canvas');
            c.width = Math.max(1, width);
            c.height = Math.max(1, height);
            const ctx = c.getContext('2d');
            try { ctx.imageSmoothingEnabled = false; } catch (e) {}

            for (const ref of refs) {
                const rel = ref.i - active;
                let alpha = 1;
                if (!previewActive) {
                    if (ref.vis === 1) alpha = 1;
                    else if (ref.vis === 0) {
                        alpha = forceDimFullVisibility ? 1 : (rel > 0 ? Math.max(0.06, 0.22 - (rel - 1) * 0.08) : 1);
                    }
                }
                ctx.save();
                ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
                ctx.drawImage(ref.frame, 0, 0);
                ctx.restore();
                if (!previewActive && !forceDimFullVisibility && ref.vis === 0 && rel < 0) {
                    const dark = Math.min(0.9, 0.55 + (Math.abs(rel) - 1) * 0.18);
                    ctx.save();
                    ctx.globalAlpha = dark;
                    ctx.fillStyle = '#000000';
                    ctx.fillRect(0, 0, c.width, c.height);
                    ctx.restore();
                }
            }
            if (cache) cache.set(cacheKey, c);
            return c;
        } catch (e) {
            return null;
        }
    }

    _syncPixelLayerAnimationStructure(action, anim, index = null, extra = null) {
        try {
            this._ensureLayerState();
            this._ensurePixelLayerStore();
            const name = String(anim || '');
            if (!name) return;
            const liMax = (this._pixelLayerStores && this._pixelLayerStores.length) ? this._pixelLayerStores.length : 0;
            for (let li = 1; li < liMax; li++) {
                const store = this._pixelLayerStores[li];
                if (!store || !(store.byAnim instanceof Map)) continue;
                if (action === 'rename') {
                    const to = String(extra || '').trim();
                    if (!to || to === name) continue;
                    if (store.byAnim.has(name)) {
                        const arr = store.byAnim.get(name);
                        store.byAnim.set(to, arr);
                        store.byAnim.delete(name);
                    }
                    continue;
                }
                if (action === 'removeAnim') {
                    store.byAnim.delete(name);
                    continue;
                }
                let arr = store.byAnim.get(name);
                if (!Array.isArray(arr)) {
                    if (action === 'insert' || action === 'addAnim') {
                        arr = [];
                        store.byAnim.set(name, arr);
                    } else {
                        continue;
                    }
                }
                if (action === 'addAnim') {
                    const count = Math.max(0, Number(index) | 0);
                    while (arr.length < count) arr.push(null);
                } else if (action === 'insert') {
                    const at = Number.isFinite(Number(index)) ? Math.max(0, Math.min(Number(index) | 0, arr.length)) : arr.length;
                    arr.splice(at, 0, null);
                } else if (action === 'delete') {
                    if (arr.length <= 0) continue;
                    const at = Number.isFinite(Number(index)) ? Math.max(0, Math.min(Number(index) | 0, arr.length - 1)) : (arr.length - 1);
                    arr.splice(at, 1);
                }
                store.byAnim.set(name, arr);
            }
        } catch (e) {}
    }

    _installPixelLayerHooks() {
        try {
            this._ensureLayerState();
            const sheet = this.currentSprite;
            if (!sheet) return false;
            this._ensurePixelLayerStore();

            if (sheet.__pixelLayerHookInstalled && sheet.__pixelLayerHookOwner === this) return true;
            if (typeof sheet.getFrame !== 'function' || typeof sheet.setPixel !== 'function' || typeof sheet.modifyFrame !== 'function') return false;

            const scene = this;
            const rawGetFrame = sheet.getFrame.bind(sheet);
            const rawSetPixel = sheet.setPixel.bind(sheet);
            const rawModifyFrame = sheet.modifyFrame.bind(sheet);

            sheet.__pixelLayerRawGetFrame = rawGetFrame;
            sheet.__pixelLayerRawSetPixel = rawSetPixel;
            sheet.__pixelLayerRawModifyFrame = rawModifyFrame;

            sheet.getFrame = function(anim, frameIdx) {
                const li = Math.max(0, Math.min((scene._activePixelLayerIndex | 0), Math.max(0, (scene._pixelLayers?.length || 1) - 1)));
                if (li === 0) return rawGetFrame(anim, frameIdx);
                return scene._ensurePixelLayerFrameCanvas(li, anim, frameIdx, true);
            };

            sheet.setPixel = function(anim, frameIdx, x, y, color, blendType = 'replace') {
                const li = Math.max(0, Math.min((scene._activePixelLayerIndex | 0), Math.max(0, (scene._pixelLayers?.length || 1) - 1)));
                if (li === 0) return rawSetPixel(anim, frameIdx, x, y, color, blendType);
                return scene._applyPixelsToPixelLayer(anim, frameIdx, [{ x, y, color }], li);
            };

            sheet.modifyFrame = function(anim, frameIdx, changes) {
                const li = Math.max(0, Math.min((scene._activePixelLayerIndex | 0), Math.max(0, (scene._pixelLayers?.length || 1) - 1)));
                if (li === 0) return rawModifyFrame(anim, frameIdx, changes);
                const arr = Array.isArray(changes) ? changes : [changes];
                return scene._applyPixelsToPixelLayer(anim, frameIdx, arr, li);
            };

            sheet.__pixelLayerHookInstalled = true;
            sheet.__pixelLayerHookOwner = this;
            return true;
        } catch (e) {
            return false;
        }
    }

    _normalizeLayerType(type) {
        return String(type || '').toLowerCase() === 'tile' ? 'tile' : 'pixel';
    }

    _normalizeTileLayerVisibility(value, fallback = 0) {
        const n = Number(value);
        if (!Number.isFinite(n)) return Math.max(0, Math.min(2, Number(fallback) | 0));
        return Math.max(0, Math.min(2, n | 0)); // 0=half,1=full,2=hidden
    }

    _tileLayerHasMeaningfulContent(layer) {
        try {
            if (!layer || typeof layer !== 'object') return false;
            const bindings = Array.isArray(layer.bindings) ? layer.bindings : [];
            for (const b of bindings) {
                if (!b || typeof b !== 'object') continue;
                if (b.anim !== undefined && b.index !== undefined) return true;
                if (Array.isArray(b.multiFrames) && b.multiFrames.length > 0) return true;
            }
            const transforms = Array.isArray(layer.transforms) ? layer.transforms : [];
            for (const t of transforms) {
                if (!t || typeof t !== 'object') continue;
                if ((Number(t.rot || 0) !== 0) || !!t.flipH) return true;
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    _normalizeIncomingTileLayers(rawLayers) {
        try {
            const layers = Array.isArray(rawLayers) ? rawLayers.slice() : [];
            if (layers.length <= 1) return layers;

            // Remove a stray auto-created default layer if empty and other layers are present.
            const defaultIdx = layers.findIndex((l) => {
                const nm = (l && typeof l === 'object') ? l.name : l;
                return String(nm || '').trim().toLowerCase() === 'tile layer 1';
            });
            if (defaultIdx < 0) return layers;

            const defaultLayer = layers[defaultIdx];
            if (this._tileLayerHasMeaningfulContent(defaultLayer)) return layers;

            let hasOtherMeaningful = false;
            let hasOtherNamedLayer = false;
            for (let i = 0; i < layers.length; i++) {
                if (i === defaultIdx) continue;
                const l = layers[i];
                const nm = String((l && l.name) || '').trim().toLowerCase();
                if (nm && nm !== 'tile layer 1') hasOtherNamedLayer = true;
                if (this._tileLayerHasMeaningfulContent(l)) {
                    hasOtherMeaningful = true;
                    break;
                }
            }

            if (hasOtherMeaningful || hasOtherNamedLayer) {
                layers.splice(defaultIdx, 1);
            }
            return layers;
        } catch (e) {
            return Array.isArray(rawLayers) ? rawLayers : [];
        }
    }

    _ensureLayerState() {
        try {
            if (!Array.isArray(this._pixelLayers) || this._pixelLayers.length === 0) {
                this._pixelLayers = [{ name: 'Pixel Layer 1', visibility: 0 }];
            }
            this._pixelLayers = this._pixelLayers.map((l, i) => {
                const src = (l && typeof l === 'object') ? l : { name: String(l || '') };
                return {
                    name: String(src.name || ('Pixel Layer ' + (i + 1))).trim() || ('Pixel Layer ' + (i + 1)),
                    visibility: this._normalizePixelLayerVisibility(src.visibility, 0)
                };
            });
            if (!Number.isFinite(this._activePixelLayerIndex)) this._activePixelLayerIndex = 0;
            this._activePixelLayerIndex = Math.max(0, Math.min(this._activePixelLayerIndex | 0, this._pixelLayers.length - 1));
            this._ensurePixelLayerStore();

            const seedBindings = Array.isArray(this._areaBindings) ? this._areaBindings : [];
            const seedTransforms = Array.isArray(this._areaTransforms) ? this._areaTransforms : [];
            if (!Array.isArray(this._tileLayers) || this._tileLayers.length === 0) {
                this._tileLayers = [{ name: 'Tile Layer 1', visibility: 0, bindings: seedBindings, transforms: seedTransforms }];
            }
            for (let i = 0; i < this._tileLayers.length; i++) {
                const l = this._tileLayers[i] || {};
                l.name = String(l.name || ('Tile Layer ' + (i + 1))).trim() || ('Tile Layer ' + (i + 1));
                l.visibility = this._normalizeTileLayerVisibility(l.visibility, 0);
                if (!Array.isArray(l.bindings)) l.bindings = [];
                if (!Array.isArray(l.transforms)) l.transforms = [];
                this._tileLayers[i] = l;
            }
            // Guard against accidental shared references between layers.
            // Shared arrays would cause edits on one selected layer to mutate another.
            const seenBindings = new Set();
            const seenTransforms = new Set();
            for (let i = 0; i < this._tileLayers.length; i++) {
                const l = this._tileLayers[i];
                if (seenBindings.has(l.bindings)) l.bindings = Array.isArray(l.bindings) ? l.bindings.slice() : [];
                if (seenTransforms.has(l.transforms)) l.transforms = Array.isArray(l.transforms) ? l.transforms.slice() : [];
                seenBindings.add(l.bindings);
                seenTransforms.add(l.transforms);
            }
            if (!Number.isFinite(this._activeTileLayerIndex)) this._activeTileLayerIndex = 0;
            this._activeTileLayerIndex = Math.max(0, Math.min(this._activeTileLayerIndex | 0, this._tileLayers.length - 1));
            this._syncActiveTileLayerReferences();
        } catch (e) {}
    }

    _syncActiveTileLayerReferences() {
        try {
            if (!Array.isArray(this._tileLayers) || this._tileLayers.length === 0) return;
            const idx = Math.max(0, Math.min((this._activeTileLayerIndex | 0), this._tileLayers.length - 1));
            const layer = this._tileLayers[idx] || null;
            if (!layer) return;
            if (!Array.isArray(layer.bindings)) layer.bindings = [];
            if (!Array.isArray(layer.transforms)) layer.transforms = [];
            this._activeTileLayerIndex = idx;
            const bindingsChanged = this._areaBindings !== layer.bindings;
            const transformsChanged = this._areaTransforms !== layer.transforms;
            this._areaBindings = layer.bindings;
            this._areaTransforms = layer.transforms;
            try {
                if (bindingsChanged) this.modifyState(this._areaBindings, false, false, ['tilemap', 'bindings']);
                if (transformsChanged) this.modifyState(this._areaTransforms, false, false, ['tilemap', 'transforms']);
            } catch (e) {}
        } catch (e) {}
    }

    _adoptCurrentTileArraysIntoActiveLayer() {
        try {
            this._ensureLayerState();
            const idx = Math.max(0, Math.min((this._activeTileLayerIndex | 0), this._tileLayers.length - 1));
            const layer = this._tileLayers[idx] || null;
            if (!layer) return null;
            if (Array.isArray(this._areaBindings) && this._areaBindings !== layer.bindings) layer.bindings = this._areaBindings;
            if (Array.isArray(this._areaTransforms) && this._areaTransforms !== layer.transforms) layer.transforms = this._areaTransforms;
            this._syncActiveTileLayerReferences();
            return this._tileLayers[this._activeTileLayerIndex] || null;
        } catch (e) {
            return null;
        }
    }

    getLayerNames(type = 'pixel') {
        this._ensureLayerState();
        const kind = this._normalizeLayerType(type);
        const arr = (kind === 'tile') ? this._tileLayers : this._pixelLayers;
        return arr.map((l, i) => String((l && l.name) || ((kind === 'tile' ? 'Tile Layer ' : 'Pixel Layer ') + (i + 1))));
    }

    getActiveLayerIndex(type = 'pixel') {
        this._ensureLayerState();
        return this._normalizeLayerType(type) === 'tile' ? (this._activeTileLayerIndex | 0) : (this._activePixelLayerIndex | 0);
    }

    getLayerVisibilityState(type = 'pixel', index = 0) {
        this._ensureLayerState();
        const kind = this._normalizeLayerType(type);
        if (kind === 'pixel') {
            const i = index | 0;
            if (i < 0 || i >= this._pixelLayers.length) return 0;
            return this._normalizePixelLayerVisibility(this._pixelLayers[i] && this._pixelLayers[i].visibility, 0);
        }
        const i = index | 0;
        if (i < 0 || i >= this._tileLayers.length) return 0;
        return this._normalizeTileLayerVisibility(this._tileLayers[i] && this._tileLayers[i].visibility, 0);
    }

    cycleLayerVisibility(type = 'pixel', index = 0) {
        this._ensureLayerState();
        const kind = this._normalizeLayerType(type);
        if (kind === 'pixel') {
            const i = index | 0;
            if (i < 0 || i >= this._pixelLayers.length) return 0;
            const cur = this._normalizePixelLayerVisibility(this._pixelLayers[i] && this._pixelLayers[i].visibility, 0);
            const next = (cur + 1) % 3;
            this._pixelLayers[i].visibility = next;
            return next;
        }
        const i = index | 0;
        if (i < 0 || i >= this._tileLayers.length) return 0;
        const cur = this._normalizeTileLayerVisibility(this._tileLayers[i] && this._tileLayers[i].visibility, 0);
        const next = (cur + 1) % 3;
        this._tileLayers[i].visibility = next;
        return next;
    }

    setActiveLayerIndex(type = 'pixel', index = 0) {
        this._ensureLayerState();
        const kind = this._normalizeLayerType(type);
        if (kind === 'tile') {
            // Persist any in-flight edits into the currently selected layer before switching.
            this._adoptCurrentTileArraysIntoActiveLayer();
            const max = Math.max(0, this._tileLayers.length - 1);
            this._activeTileLayerIndex = Math.max(0, Math.min((index | 0), max));
            this._syncActiveTileLayerReferences();
            return this._activeTileLayerIndex;
        }
        const max = Math.max(0, this._pixelLayers.length - 1);
        this._activePixelLayerIndex = Math.max(0, Math.min((index | 0), max));
        return this._activePixelLayerIndex;
    }

    addLayer(type = 'pixel', name = null) {
        this._ensureLayerState();
        const kind = this._normalizeLayerType(type);
        if (kind === 'tile') {
            const n = this._tileLayers.length + 1;
            const entry = {
                name: String((name || ('Tile Layer ' + n))).trim() || ('Tile Layer ' + n),
                visibility: 0,
                bindings: [],
                transforms: []
            };
            this._tileLayers.push(entry);
            this._activeTileLayerIndex = this._tileLayers.length - 1;
            this._syncActiveTileLayerReferences();
            return this._activeTileLayerIndex;
        }
        const n = this._pixelLayers.length + 1;
        this._pixelLayers.push({ name: String((name || ('Pixel Layer ' + n))).trim() || ('Pixel Layer ' + n), visibility: 0 });
        this._activePixelLayerIndex = this._pixelLayers.length - 1;
        this._ensurePixelLayerStore();
        return this._activePixelLayerIndex;
    }

    renameLayer(type = 'pixel', index = 0, nextName = '') {
        this._ensureLayerState();
        const kind = this._normalizeLayerType(type);
        const arr = (kind === 'tile') ? this._tileLayers : this._pixelLayers;
        const i = index | 0;
        if (i < 0 || i >= arr.length) return false;
        const v = String(nextName || '').trim();
        if (!v) return false;
        arr[i].name = v;
        return true;
    }

    removeLayer(type = 'pixel', index = 0) {
        this._ensureLayerState();
        const kind = this._normalizeLayerType(type);
        if (kind === 'tile') {
            if (this._tileLayers.length <= 1) return false;
            const i = index | 0;
            if (i < 0 || i >= this._tileLayers.length) return false;
            this._tileLayers.splice(i, 1);
            this._activeTileLayerIndex = Math.max(0, Math.min(this._activeTileLayerIndex, this._tileLayers.length - 1));
            this._syncActiveTileLayerReferences();
            return true;
        }
        if (this._pixelLayers.length <= 1) return false;
        const i = index | 0;
        if (i < 0 || i >= this._pixelLayers.length) return false;
        this._pixelLayers.splice(i, 1);
        if (Array.isArray(this._pixelLayerStores) && this._pixelLayerStores.length > i) this._pixelLayerStores.splice(i, 1);
        this._activePixelLayerIndex = Math.max(0, Math.min(this._activePixelLayerIndex, this._pixelLayers.length - 1));
        return true;
    }

    moveLayerDown(type = 'pixel', index = 0) {
        this._ensureLayerState();
        const kind = this._normalizeLayerType(type);
        const i = index | 0;
        if (kind === 'tile') {
            if (!Array.isArray(this._tileLayers) || this._tileLayers.length <= 1) return false;
            if (i < 0 || i >= this._tileLayers.length - 1) return false;
            // Preserve in-flight active tile edits before reordering.
            this._adoptCurrentTileArraysIntoActiveLayer();
            const arr = this._tileLayers;
            const tmp = arr[i];
            arr[i] = arr[i + 1];
            arr[i + 1] = tmp;

            if ((this._activeTileLayerIndex | 0) === i) this._activeTileLayerIndex = i + 1;
            else if ((this._activeTileLayerIndex | 0) === (i + 1)) this._activeTileLayerIndex = i;

            this._syncActiveTileLayerReferences();
            return true;
        }

        if (!Array.isArray(this._pixelLayers) || this._pixelLayers.length <= 1) return false;
        if (i < 0 || i >= this._pixelLayers.length - 1) return false;
        const arr = this._pixelLayers;
        const tmp = arr[i];
        arr[i] = arr[i + 1];
        arr[i + 1] = tmp;

        if (Array.isArray(this._pixelLayerStores) && this._pixelLayerStores.length > (i + 1)) {
            const s = this._pixelLayerStores[i];
            this._pixelLayerStores[i] = this._pixelLayerStores[i + 1];
            this._pixelLayerStores[i + 1] = s;
        }

        if ((this._activePixelLayerIndex | 0) === i) this._activePixelLayerIndex = i + 1;
        else if ((this._activePixelLayerIndex | 0) === (i + 1)) this._activePixelLayerIndex = i;
        return true;
    }

    _getTileLayerDrawEntries(areaIndex) {
        try {
            this._ensureLayerState();
            if (!Number.isFinite(areaIndex) || areaIndex < 0) return [];
            const idx = areaIndex | 0;
            const active = Math.max(0, Math.min((this._activeTileLayerIndex | 0), this._tileLayers.length - 1));
            const hasValidBinding = (b) => !!(b && b.anim !== undefined && b.index !== undefined);
            const layerVisibility = (layer) => this._normalizeTileLayerVisibility(layer && layer.visibility, 0);
            let anyBound = false;
            for (let i = 0; i < this._tileLayers.length; i++) {
                const l = this._tileLayers[i];
                if (layerVisibility(l) === 2) continue;
                if (l && Array.isArray(l.bindings) && hasValidBinding(l.bindings[idx])) { anyBound = true; break; }
            }

            const buildVisual = (layerIndex) => {
                const previewActive = !!(this._playerSimMode && this._playerSimMode.active);
                if (previewActive) {
                    return { alpha: 1, darken: 0 };
                }
                const v = layerVisibility(this._tileLayers[layerIndex]);
                if (v === 1) return { alpha: 1, darken: 0 }; // full visible
                const rel = layerIndex - active;
                // Exaggerated separation:
                // - Layers above active are very faint.
                // - Layers below active are strongly darkened.
                const alpha = rel > 0 ? Math.max(0.06, 0.22 - (rel - 1) * 0.08) : 1;
                const darken = rel < 0 ? Math.min(0.9, 0.55 + (Math.abs(rel) - 1) * 0.18) : 0;
                return { alpha, darken };
            };

            const out = [];
            if (!anyBound) {
                const activeLayer = this._tileLayers[active] || { transforms: [] };
                if (layerVisibility(activeLayer) === 2) return [];
                const t = Array.isArray(activeLayer.transforms) ? (activeLayer.transforms[idx] || null) : null;
                out.push({
                    layerIndex: active,
                    binding: { anim: this.selectedAnimation, index: this.selectedFrame, multiFrames: null },
                    transform: t,
                    ...buildVisual(active)
                });
                return out;
            }

            for (let i = 0; i < this._tileLayers.length; i++) {
                const l = this._tileLayers[i] || {};
                if (layerVisibility(l) === 2) continue;
                const b = Array.isArray(l.bindings) ? l.bindings[idx] : null;
                if (!hasValidBinding(b)) continue;
                const t = Array.isArray(l.transforms) ? (l.transforms[idx] || null) : null;
                out.push({ layerIndex: i, binding: b, transform: t, ...buildVisual(i) });
            }
            return out;
        } catch (e) {
            return [];
        }
    }

    _drawTileLayerStackToArea(dstPos, dstW, dstH, areaIndex, frameResolver, renderOnly = false) {
        try {
            const entries = this._getTileLayerDrawEntries(areaIndex);
            if (!entries || entries.length === 0) return false;
            const drawCtx = this.Draw && this.Draw.ctx;
            if (!drawCtx) return false;
            const drawSize = new Vector(dstW, dstH);

            const getScratch = (key) => {
                if (!this._renderScratchCanvases || typeof this._renderScratchCanvases !== 'object') {
                    this._renderScratchCanvases = Object.create(null);
                }
                let canvas = this._renderScratchCanvases[key];
                if (!canvas) {
                    canvas = document.createElement('canvas');
                    this._renderScratchCanvases[key] = canvas;
                }
                const w = Math.max(1, Math.floor(dstW));
                const h = Math.max(1, Math.floor(dstH));
                if (canvas.width !== w) canvas.width = w;
                if (canvas.height !== h) canvas.height = h;
                return canvas;
            };

            for (const entry of entries) {
                if (!entry || !entry.binding) continue;
                const b = entry.binding;
                const anim = b.anim;
                const frameList = (Array.isArray(b.multiFrames) && b.multiFrames.length > 0) ? b.multiFrames : null;
                const hasTransform = !!(entry.transform && ((entry.transform.rot || 0) !== 0 || entry.transform.flipH));
                const needsCompose = hasTransform && !renderOnly;

                if (!needsCompose) {
                    drawCtx.save();
                    drawCtx.globalAlpha = Math.max(0, Math.min(1, Number(entry.alpha) || 1));
                    if (frameList && frameList.length > 0) {
                        for (let i = 0; i < frameList.length; i++) {
                            const fi = Number(frameList[i]);
                            if (!Number.isFinite(fi)) continue;
                            const fr = frameResolver(anim, fi);
                            if (!fr) continue;
                            this.Draw.image(fr, dstPos, drawSize, null, 0, 1, false);
                        }
                    } else {
                        const fr = frameResolver(anim, Number(b.index) || 0);
                        if (fr) this.Draw.image(fr, dstPos, drawSize, null, 0, 1, false);
                    }
                    drawCtx.restore();
                } else {
                    const composeCanvas = getScratch('compose');
                    const cctx = composeCanvas.getContext('2d');
                    try { cctx.imageSmoothingEnabled = false; } catch (e) {}
                    cctx.clearRect(0, 0, composeCanvas.width, composeCanvas.height);
                    if (frameList && frameList.length > 0) {
                        for (let i = 0; i < frameList.length; i++) {
                            const fi = Number(frameList[i]);
                            if (!Number.isFinite(fi)) continue;
                            const fr = frameResolver(anim, fi);
                            if (!fr) continue;
                            cctx.drawImage(fr, 0, 0, fr.width, fr.height, 0, 0, composeCanvas.width, composeCanvas.height);
                        }
                    } else {
                        const fr = frameResolver(anim, Number(b.index) || 0);
                        if (fr) cctx.drawImage(fr, 0, 0, fr.width, fr.height, 0, 0, composeCanvas.width, composeCanvas.height);
                    }

                    let drawable = composeCanvas;
                    try {
                        const t = entry.transform;
                        const tcanvas = getScratch('transform');
                        const tctx = tcanvas.getContext('2d');
                        try { tctx.imageSmoothingEnabled = false; } catch (e) {}
                        tctx.clearRect(0, 0, tcanvas.width, tcanvas.height);
                        tctx.save();
                        tctx.translate(tcanvas.width / 2, tcanvas.height / 2);
                        if (t.flipH) tctx.scale(-1, 1);
                        tctx.rotate((Number(t.rot || 0) * Math.PI) / 180);
                        tctx.drawImage(composeCanvas, -tcanvas.width / 2, -tcanvas.height / 2);
                        tctx.restore();
                        drawable = tcanvas;
                    } catch (e) {}

                    drawCtx.save();
                    drawCtx.globalAlpha = Math.max(0, Math.min(1, Number(entry.alpha) || 1));
                    this.Draw.image(drawable, dstPos, drawSize, null, 0, 1, false);
                    drawCtx.restore();
                }

                if ((Number(entry.darken) || 0) > 0) {
                    drawCtx.save();
                    drawCtx.globalAlpha = Math.max(0, Math.min(1, Number(entry.darken) || 0));
                    // Hot path: avoid Draw.rect allocations, but still honor Draw-scale mapping.
                    drawCtx.fillStyle = '#000000';
                    const sx = (this.Draw && typeof this.Draw.px === 'function') ? this.Draw.px(dstPos.x) : dstPos.x;
                    const sy = (this.Draw && typeof this.Draw.py === 'function') ? this.Draw.py(dstPos.y) : dstPos.y;
                    const sw = (this.Draw && typeof this.Draw.px === 'function') ? this.Draw.px(dstW) : dstW;
                    const sh = (this.Draw && typeof this.Draw.py === 'function') ? this.Draw.py(dstH) : dstH;
                    drawCtx.fillRect(sx, sy, sw, sh);
                    drawCtx.restore();
                }
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    _setAreaBindingAtIndex(areaIndex, bindingEntry, syncOp = true) {
        this._queueDeferredTileUndoCapture(syncOp);
        try {
            this._adoptCurrentTileArraysIntoActiveLayer();
            if (!Number.isFinite(areaIndex) || areaIndex < 0) return false;
            areaIndex = areaIndex | 0;
            if (!Array.isArray(this._areaBindings)) this._areaBindings = [];
            this._areaBindings[areaIndex] = bindingEntry;
            if (!syncOp) return true;
            const coord = (Array.isArray(this._tileIndexToCoord) && this._tileIndexToCoord[areaIndex]) ? this._tileIndexToCoord[areaIndex] : null;
            if (!coord) return true;
            if (!bindingEntry) return this._queueTileOp('clearBinding', { col: coord.col|0, row: coord.row|0, layer: this._activeTileLayerIndex | 0 });
            const mf = Array.isArray(bindingEntry.multiFrames)
                ? bindingEntry.multiFrames.filter(v => Number.isFinite(v)).map(v => Number(v))
                : null;
            return this._queueTileOp('bind', {
                col: coord.col|0,
                row: coord.row|0,
                layer: this._activeTileLayerIndex | 0,
                anim: bindingEntry.anim || this.selectedAnimation,
                index: Number(bindingEntry.index) || 0,
                multiFrames: (mf && mf.length > 0) ? mf : null
            });
        } catch (e) {
            return false;
        }
    }

    _setAreaTransformAtIndex(areaIndex, transformEntry, syncOp = true) {
        this._queueDeferredTileUndoCapture(syncOp);
        try {
            this._adoptCurrentTileArraysIntoActiveLayer();
            if (!Number.isFinite(areaIndex) || areaIndex < 0) return false;
            areaIndex = areaIndex | 0;
            if (!Array.isArray(this._areaTransforms)) this._areaTransforms = [];
            this._areaTransforms[areaIndex] = transformEntry;
            if (!syncOp) return true;
            const coord = (Array.isArray(this._tileIndexToCoord) && this._tileIndexToCoord[areaIndex]) ? this._tileIndexToCoord[areaIndex] : null;
            if (!coord) return true;
            if (!transformEntry) return this._queueTileOp('clearTransform', { col: coord.col|0, row: coord.row|0, layer: this._activeTileLayerIndex | 0 });
            return this._queueTileOp('setTransform', {
                col: coord.col|0,
                row: coord.row|0,
                layer: this._activeTileLayerIndex | 0,
                rot: Number(transformEntry.rot || 0),
                flipH: !!transformEntry.flipH
            });
        } catch (e) {
            return false;
        }
    }

    // Bind a specific animation/frame to a rendered area index
    bindArea(areaIndex, anim, frameIdx, multiFrames = null) {
        try {
            if (typeof areaIndex !== 'number' || areaIndex < 0) return false;
            const stack = Array.isArray(multiFrames) ? multiFrames.filter(i => Number.isFinite(i)).map(i => Number(i)) : null;
            return this._setAreaBindingAtIndex(areaIndex, { anim: anim || this.selectedAnimation, index: Number(frameIdx) || 0, multiFrames: (stack && stack.length > 0) ? stack : null }, true);
        } catch (e) { return false; }
    }

    // Toggle preview rotation (90deg CW) for an area
    toggleAreaPreviewRotate(areaIndex) {
        if (typeof areaIndex !== 'number' || areaIndex < 0) return false;
        const t = this._areaTransforms[areaIndex] || { rot: 0, flipH: false };
        t.rot = ((t.rot || 0) + 90) % 360;
        try { this._playSfx('tile.rotate'); } catch (e) {}
        return this._setAreaTransformAtIndex(areaIndex, t, true);
    }

    // Toggle preview horizontal flip for an area
    toggleAreaPreviewFlip(areaIndex) {
        if (typeof areaIndex !== 'number' || areaIndex < 0) return false;
        const t = this._areaTransforms[areaIndex] || { rot: 0, flipH: false };
        t.flipH = !t.flipH;
        try { this._playSfx('tile.flip'); } catch (e) {}
        return this._setAreaTransformAtIndex(areaIndex, t, true);
    }

    // Apply a 90deg CW rotation to the actual frame data for the bound frame at areaIndex
    applyAreaRotateData(areaIndex) {
        try {
            if (typeof areaIndex !== 'number') return false;
            const binding = this.getAreaBinding(areaIndex);
            const anim = (binding && binding.anim) ? binding.anim : this.selectedAnimation;
            const frameIdx = (binding && typeof binding.index === 'number') ? Number(binding.index) : this.selectedFrame;
            const sheet = this.currentSprite;
            if (!sheet) return false;
            // ensure frame is materialized if API exists
            try { if (typeof sheet._materializeFrame === 'function') sheet._materializeFrame(anim, frameIdx); } catch (e) {}
            const src = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, frameIdx) : null;
            if (!src) return false;
            const w = src.width, h = src.height;
            // create rotated canvas of same size
            const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
            const tctx = tmp.getContext('2d'); try { tctx.imageSmoothingEnabled = false; } catch (e) {}
            // rotate 90deg CW around center
            tctx.translate(w / 2, h / 2);
            tctx.rotate(Math.PI / 2);
            tctx.translate(-w / 2, -h / 2);
            tctx.drawImage(src, 0, 0);
            // Prefer drawing into the existing materialized frame canvas so references remain stable
            try {
                const dest = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, frameIdx) : null;
                if (dest && dest.getContext) {
                    const dctx = dest.getContext('2d');
                    try { dctx.clearRect(0, 0, dest.width, dest.height); } catch (e) {}
                    try { dctx.imageSmoothingEnabled = false; } catch (e) {}
                    try { dctx.drawImage(tmp, 0, 0, dest.width, dest.height); } catch (e) { /* ignore draw errors */ }
                    try { if (typeof sheet._updatePackedFrame === 'function') sheet._updatePackedFrame(anim, frameIdx); else if (typeof sheet._rebuildSheetCanvas === 'function') sheet._rebuildSheetCanvas(); } catch (e) { try { sheet._rebuildSheetCanvas(); } catch (er) {} }
                    try { this._playSfx('tile.rotate'); } catch (e) {}
                    return true;
                }
                // fallback: replace physical slot if materialized frame not available
                if (sheet._frames && sheet._frames.has(anim)) {
                    const arr = sheet._frames.get(anim) || [];
                    let logical = Math.max(0, Math.floor(frameIdx || 0));
                    let found = -1;
                    for (let i = 0; i < arr.length; i++) {
                        const entry = arr[i];
                        if (!entry) continue;
                        if (entry.__groupStart || entry.__groupEnd) continue;
                        if (logical === 0) { found = i; break; }
                        logical--; }
                    if (found !== -1) {
                        arr[found] = tmp;
                        try { if (typeof sheet._updatePackedFrame === 'function') sheet._updatePackedFrame(anim, frameIdx); else if (typeof sheet._rebuildSheetCanvas === 'function') sheet._rebuildSheetCanvas(); } catch (e) { try { sheet._rebuildSheetCanvas(); } catch (er) {} }
                        try { this._playSfx('tile.rotate'); } catch (e) {}
                        return true;
                    }
                }
            } catch (e) {}
            return false;
        } catch (e) { return false; }
    }

    // Apply a horizontal flip to the actual frame data for the bound frame at areaIndex
    applyAreaFlipData(areaIndex) {
        try {
            if (typeof areaIndex !== 'number') return false;
            const binding = this.getAreaBinding(areaIndex);
            const anim = (binding && binding.anim) ? binding.anim : this.selectedAnimation;
            const frameIdx = (binding && typeof binding.index === 'number') ? Number(binding.index) : this.selectedFrame;
            const sheet = this.currentSprite;
            if (!sheet) return false;
            try { if (typeof sheet._materializeFrame === 'function') sheet._materializeFrame(anim, frameIdx); } catch (e) {}
            const src = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, frameIdx) : null;
            if (!src) return false;
            const w = src.width, h = src.height;
            const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
            const tctx = tmp.getContext('2d'); try { tctx.imageSmoothingEnabled = false; } catch (e) {}
            tctx.translate(w, 0); tctx.scale(-1, 1);
            tctx.drawImage(src, 0, 0);
            try {
                const dest = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, frameIdx) : null;
                if (dest && dest.getContext) {
                    const dctx = dest.getContext('2d');
                    try { dctx.clearRect(0, 0, dest.width, dest.height); } catch (e) {}
                    try { dctx.imageSmoothingEnabled = false; } catch (e) {}
                    try { dctx.drawImage(tmp, 0, 0, dest.width, dest.height); } catch (e) { /* ignore draw errors */ }
                    try { if (typeof sheet._updatePackedFrame === 'function') sheet._updatePackedFrame(anim, frameIdx); else if (typeof sheet._rebuildSheetCanvas === 'function') sheet._rebuildSheetCanvas(); } catch (e) { try { sheet._rebuildSheetCanvas(); } catch (er) {} }
                    try { this._playSfx('tile.flip'); } catch (e) {}
                    return true;
                }
                if (sheet._frames && sheet._frames.has(anim)) {
                    const arr = sheet._frames.get(anim) || [];
                    let logical = Math.max(0, Math.floor(frameIdx || 0));
                    let found = -1;
                    for (let i = 0; i < arr.length; i++) {
                        const entry = arr[i];
                        if (!entry) continue;
                        if (entry.__groupStart || entry.__groupEnd) continue;
                        if (logical === 0) { found = i; break; }
                        logical--; }
                    if (found !== -1) {
                        arr[found] = tmp;
                        try { if (typeof sheet._updatePackedFrame === 'function') sheet._updatePackedFrame(anim, frameIdx); else if (typeof sheet._rebuildSheetCanvas === 'function') sheet._rebuildSheetCanvas(); } catch (e) { try { sheet._rebuildSheetCanvas(); } catch (er) {} }
                        try { this._playSfx('tile.flip'); } catch (e) {}
                        return true;
                    }
                }
            } catch (e) {}
            return false;
        } catch (e) { return false; }
    }

    getAreaBinding(areaIndex) {
        this._adoptCurrentTileArraysIntoActiveLayer();
        if (!Array.isArray(this._areaBindings)) return null;
        return this._areaBindings[areaIndex] || null;
    }

    clearAreaBinding(areaIndex) {
        return this._setAreaBindingAtIndex(areaIndex, null, true);
    }

    draw() {
        if (!this.isReady) return;
        if (!this._compositedFrameCache || !(this._compositedFrameCache instanceof Map)) this._compositedFrameCache = new Map();
        else this._compositedFrameCache.clear();
        this._frameMousePosInfo = null;
        this._trackSelectionUndoState();
        this.Draw.background('#222')
        this.Draw.pushMatrix()
        this.Draw.scale(this.zoom)
        this.Draw.translate(this.offset)
        
        // display the editable frame centered on the screen
        const size = this._mainDrawSize || (this._mainDrawSize = new Vector(384, 384));
        const center = this._mainDrawCenter || (this._mainDrawCenter = new Vector(0, 0));
        center.x = (1920 - size.x) / 2;
        center.y = (1080 - size.y) / 2;

        // Build all displayed tile positions.
        // When tilemode is off, show a single central area.
        // When tilemode is on, draw all active tiles (infinite grid), plus the hovered tile even if inactive.
        let areas = [];
        const basePos = this._mainDrawBasePos || (this._mainDrawBasePos = new Vector(0, 0)); // tile (0,0) top-left
        basePos.x = center.x;
        basePos.y = center.y;
        let usedFastRenderOnly = false;
        let hover = null;
        let visible = null;

        if (!this.tilemode) {
            const info = this.computeAreaInfo(basePos, size);
            if (info) {
                info.areaIndex = 0;
                info.tileCol = 0;
                info.tileRow = 0;
                info.active = true;
                info.renderOnly = this._isSimTooSmall(info);
                if (!this._shouldCullArea(info)) areas.push(info);
            }
        } else {
            if (!this._tileActive || this._tileActive.size === 0) this._seedTileActives();
            const seen = new Set();
            visible = this._getVisibleTileBounds(basePos, size, 1);
            this._lastVisibleTileBounds = visible;
            this._renderOnlyAllVisible = !!this._isSimTooSmall({ dstW: size.x, dstH: size.y });
            const addTileArea = (col, row, active=true) => {
                if (col < visible.minCol || col > visible.maxCol || row < visible.minRow || row > visible.maxRow) return;
                const key = this._tileKey(col, row);
                if (seen.has(key)) return;
                seen.add(key);
                const x = basePos.x + col * size.x;
                const y = basePos.y + row * size.y;
                const topLeft = new Vector(x, y);
                const info = { topLeft, size, padding: 0, dstW: size.x, dstH: size.y, dstPos: topLeft };
                info.renderOnly = this._isSimTooSmall(info);
                const idx = this._getAreaIndexForCoord(col, row);
                info.areaIndex = idx;
                info.tileCol = col;
                info.tileRow = row;
                info.active = !!active;
                areas.push(info);
            };

            // include hovered tile even if inactive
            const mp = this.mouse && this.mouse.pos ? this.mouse.pos : new Vector(0,0);
            let mx = mp.x || 0;
            let my = mp.y || 0;
            mx = mx / this.zoom.x - this.offset.x;
            my = my / this.zoom.y - this.offset.y;
            hover = this._worldToTileCoord(mx, my, basePos, size);

            if (this._renderOnlyAllVisible) {
                areas = this._drawRenderOnlyTileBatch(basePos, size, visible, hover);
                usedFastRenderOnly = true;
            } else {
                // draw all active tiles
                const activeCoords = this._getActiveTileCoords();
                for (let i = 0; i < activeCoords.length; i++) {
                    const c = activeCoords[i];
                    addTileArea(c.col, c.row, true);
                }

                // include hovered tile even if inactive
                if (hover) addTileArea(hover.col, hover.row, this._isTileActive(hover.col, hover.row));
            }
        }

        this._drawAreas = areas;
        this._drawAreaIndexMap.clear();
        for (let i = 0; i < areas.length; i++) {
            const area = areas[i];
            if (!area) continue;
            const idx = (typeof area.areaIndex === 'number') ? area.areaIndex : i;
            this._drawAreaIndexMap.set(idx, area);
        }

        // Cache mouse hit info once per frame to avoid repeated O(area count) hit-tests in overlay passes.
        try {
            this._frameMousePosInfo = this.getPos(this.mouse && this.mouse.pos);
        } catch (e) {
            this._frameMousePosInfo = null;
        }

        if (!this.tilemode) this._renderOnlyAllVisible = false;

        // First pass: base layer (frame, checkerboard, labels)
        if (!usedFastRenderOnly) {
            for (const area of areas) {
                this.displayDrawArea(area.topLeft, size, this.currentSprite, this.selectedAnimation, this.selectedFrame, area.areaIndex, area, 'base');
            }
        }

        // Second pass: overlays (cursor, selections, previews) to avoid being occluded by later tiles
        if (!usedFastRenderOnly) {
            for (const area of areas) {
                if (area && !area.renderOnly) this.displayDrawArea(area.topLeft, size, this.currentSprite, this.selectedAnimation, this.selectedFrame, area.areaIndex, area, 'overlay');
            }
        }
        this._drawSpriteEntities(basePos, size, visible);
        this._drawRemotePlayerSims(basePos, size);
        this._drawPlayerSim(basePos, size);
        // Draw the global tile cursor / selection / paste preview once (not per-area)
        this._drawTileCursorOverlay();

        // Remove previous transform container to prevent transform stacking
        this.Draw.popMatrix()
        this.UIDraw.useCtx('UI');
        this.UIDraw.clear()
        this.FrameSelect.draw()
        if (this.autoTileGenerationMenu && typeof this.autoTileGenerationMenu.draw === 'function') {
            this.autoTileGenerationMenu.draw(this.UIDraw);
        }
        // Draw remote cursors from other clients
        if (this._remoteCursors && this._remoteCursors.size > 0) {
            const colors = ['#FF5555FF','#55FF55FF','#5555FFFF','#FFFF55FF','#FF55FFFF','#55FFFFFF','#FFA500FF','#FFFFFF88'];
            for (const [cid, entry] of this._remoteCursors.entries()) {
                if (!entry) continue;
                if (cid === this.clientId) continue;
                const age = Date.now() - (Number(entry.time) || 0);
                if (age > (this._cursorTTLms || 5000)) { this._remoteCursors.delete(cid); continue; }
                const hash = (cid || '').split('').reduce((s,c)=>s + c.charCodeAt(0),0) || 0;
                const col = colors[hash % colors.length] || '#FFFFFF88';
                try {
                    const rgb = (typeof col === 'string' && col.length >= 7 && col[0] === '#') ? col.slice(1, 7) : 'FFFFFF';
                    const selFill = `#${rgb}22`;
                    const selStroke = `#${rgb}66`;
                    const curStroke = `#${rgb}CC`;
                    const sel = this._getRemoteSelectionOverlay(entry);
                    if (sel) {
                        const selPos = new Vector(sel.x, sel.y);
                        const selSize = new Vector(sel.w, sel.h);
                        this.UIDraw.rect(selPos, selSize, selFill, true);
                        this.UIDraw.rect(selPos, selSize, selStroke, false, true, 1, selStroke);
                    }
                    const target = this._getRemoteCursorTargetScreen(entry);
                    if (target) {
                        const rectPos = new Vector(target.x, target.y);
                        const rectSize = new Vector(target.w, target.h);
                        this.UIDraw.rect(rectPos, rectSize, curStroke, false, true, 2, curStroke);
                        try {
                            const cx = target.x + target.w * 0.5;
                            const cy = target.y + target.h * 0.5;
                            const inView = (cx >= 0 && cy >= 0 && cx <= 1920 && cy <= 1080);
                            if (!inView) {
                                const mx = Math.max(6, Math.min(1914, cx));
                                const my = Math.max(6, Math.min(1074, cy));
                                const mpos = new Vector(mx - 5, my - 5);
                                const msize = new Vector(10, 10);
                                this.UIDraw.rect(mpos, msize, curStroke, true);
                                this.UIDraw.rect(mpos, msize, '#00000000', false, true, 1, '#FFFFFFFF');
                            }
                        } catch (e) {}
                        if (entry.name) this.UIDraw.text(entry.name, new Vector(rectPos.x + rectSize.x + 5, rectPos.y - 4), '#FFFFFFFF', 0, 12, { align: 'left', baseline: 'middle', font: 'monospace' });
                        if (target.label) this.UIDraw.text(target.label, new Vector(rectPos.x + rectSize.x + 5, rectPos.y + rectSize.y + 10), '#FFFFFFFF', 0, 11, { align: 'left', baseline: 'middle', font: 'monospace' });
                    }
                } catch (e) { /* ignore remote cursor target draw errors */ }
            }
        }
        // Prompt for selection keyframing
        if (this._selectionKeyframePrompt) {
            this.UIDraw.text(this._selectionKeyframePrompt, new Vector(1920 / 2, 8), '#FFE066FF', 0, 14, { align: 'center', baseline: 'top', font: 'monospace' });
        }
        // Prompt for frame keyframing
        if (this._frameKeyframePrompt) {
            this.UIDraw.text(this._frameKeyframePrompt, new Vector(1920 / 2, 26), '#66CCFFFF', 0, 14, { align: 'center', baseline: 'top', font: 'monospace' });
        }

        // Draw a small bottom-right label showing the current adjust channel
        const key = this.state.brush.pixelBrush.channel;
        const ch = key.toUpperCase();
        const pct = Math.round(this.state.brush.pixelBrush.adjustAmount[key] * 100);
        const label = `Adjust: ${ch}  ${pct}%`;
        this.UIDraw.text(label, new Vector(1920 - 12, 1080 - 8), '#FFFFFFFF', 1, 14, { align: 'right', baseline: 'bottom', font: 'monospace' });
        const spriteAnimLabel = this.selectedSpriteAnimation ? `Sprite Place: ${this.selectedSpriteAnimation}` : 'Sprite Place: (none)';
        this.UIDraw.text(spriteAnimLabel, new Vector(1920 - 12, 1080 - 28), '#66FFCCFF', 1, 13, { align: 'right', baseline: 'bottom', font: 'monospace' });
        if (this.selectedSpriteEntityId) {
            this.UIDraw.text(`Sprite Selected: ${this.selectedSpriteEntityId}`, new Vector(1920 - 12, 1080 - 46), '#66CCFFFF', 1, 12, { align: 'right', baseline: 'bottom', font: 'monospace' });
        }
        this._frameMousePosInfo = null;
    }

    /**
     * Render the sprite editing area: a background box at `pos` with `size`,
     * and draw the specified frame from `sheet` (SpriteSheet instance).
     * `animation` is the animation name and `frame` the frame index.
     */
    displayDrawArea(pos, size, sheet, animation = 'idle', frame = 0, areaIndex = null, areaInfo = null, drawMode = 'both') {
        try {
            if (!pos || !size) return;
            this.Draw.useCtx('base');
            const renderOnly = !!(areaInfo && areaInfo.renderOnly);
            const modeBase = drawMode === 'both' || drawMode === 'base';
            const modeOverlay = drawMode === 'both' || drawMode === 'overlay';
            const hideGrid = renderOnly; // renderOnly already signals "simplified" mode when zoomed out
            // draw a subtle checkerboard background for transparency
            if (modeBase) {
                if (!hideGrid) {
                    const checker = this._getCheckerboardCanvas(size.x, size.y, this._checkerboardTileSize);
                    if (checker && typeof this.Draw.image === 'function') {
                        this.Draw.image(checker, pos, size, null, 0, 1, false);
                    } else {
                        this.Draw.rect(pos, size, this._checkerboardDark || '#2e2e2eff', true);
                    }
                } else {
                    // flat fill to avoid drawing many rects when zoomed out
                    this.Draw.rect(pos, size, '#2e2e2eff', true);
                }

                // draw border
                if (!renderOnly) this.Draw.rect(pos, size, '#FFFFFF88', false, true, 2, '#FFFFFF88');

                // show active mirror axes for the pen tool
                if (!renderOnly) {
                    try {
                        const midX = pos.x + size.x / 2;
                        const midY = pos.y + size.y / 2;
                        if (this.penMirrorH) {
                            this.Draw.line(new Vector(midX, pos.y), new Vector(midX, pos.y + size.y), '#FFFFFF88', 2);
                        }
                        if (this.penMirrorV) {
                            this.Draw.line(new Vector(pos.x, midY), new Vector(pos.x + size.x, midY), '#FFFFFF88', 2);
                        }
                    } catch (e) { /* ignore mirror guideline errors */ }
                }
            }

            // draw the frame image centered inside the box with some padding
            if (sheet) {
                // determine effective animation/frame for this area (respect bindings only in tilemode)
                const binding = (this.tilemode && typeof areaIndex === 'number') ? this.getAreaBinding(areaIndex) : null;
                const coordForArea = (typeof areaIndex === 'number' && Array.isArray(this._tileIndexToCoord)) ? this._tileIndexToCoord[areaIndex] : null;
                const tileIsActive = (!this.tilemode) || (coordForArea && this._isTileActive(coordForArea.col, coordForArea.row));
                if (this.tilemode && !tileIsActive) {
                    if (modeBase) {
                        // Draw placeholder for inactive tile slot; no mirroring/binding until activated.
                        this.Draw.rect(pos, size, '#222222DD', true);
                        this.Draw.rect(pos, size, '#000000aa', false, true, 1, '#000000AA');
                    }
                    return;
                }

                const padding = 0;
                const dstW = Math.max(1, size.x - padding * 2);
                const dstH = Math.max(1, size.y - padding * 2);
                const dstPos = new Vector(pos.x + (size.x - dstW) / 2, pos.y + (size.y - dstH) / 2);

                if (this.tilemode) {
                    const effAnim = (binding && binding.anim !== undefined) ? binding.anim : this.selectedAnimation;
                    const effFrame = (binding && binding.index !== undefined) ? binding.index : this.selectedFrame;
                    if (modeBase) {
                        const frameFor = (animName, frameIdx) => {
                            try { return this._getCompositedPixelFrame(animName, frameIdx, false, !!renderOnly); } catch (e) { return null; }
                        };
                        this._drawTileLayerStackToArea(dstPos, dstW, dstH, areaIndex, frameFor, renderOnly);
                    }
                    if (modeOverlay && (!renderOnly || this.tilemode)) {
                        this.displayCursor(dstPos, dstW, dstH, binding, effAnim, effFrame, areaIndex, renderOnly);
                    }
                    return;
                }

                let effAnim = null;
                let effFrame = null;
                if (binding && binding.anim !== undefined && binding.index !== undefined) {
                    effAnim = binding.anim;
                    effFrame = binding.index;
                } else {
                    effAnim = this.selectedAnimation;
                    effFrame = this.selectedFrame;
                }

                // Fast path for tiny on-screen tiles: skip expensive compositing/transforms.
                if (renderOnly && modeBase && effAnim !== null && sheet && typeof this.Draw.sheet === 'function') {
                    try {
                        const simpleFrame = this._getCompositedPixelFrame(effAnim, effFrame, false, true);
                        if (simpleFrame && typeof this.Draw.image === 'function') {
                            // Snap tile bounds to outward screen-pixel edges so neighboring tiles
                            // can't round in opposite directions and leave seams.
                            const zx = (this.zoom && this.zoom.x) ? this.zoom.x : 1;
                            const zy = (this.zoom && this.zoom.y) ? this.zoom.y : 1;
                            const ox = (this.offset && this.offset.x) ? this.offset.x : 0;
                            const oy = (this.offset && this.offset.y) ? this.offset.y : 0;

                            const sx0 = (pos.x + ox) * zx;
                            const sy0 = (pos.y + oy) * zy;
                            const sx1 = (pos.x + size.x + ox) * zx;
                            const sy1 = (pos.y + size.y + oy) * zy;

                            // Expand by 1px on each side to guarantee overlap after rasterization.
                            const ssx0 = Math.floor(sx0) - 1;
                            const ssy0 = Math.floor(sy0) - 1;
                            const ssx1 = Math.ceil(sx1) + 1;
                            const ssy1 = Math.ceil(sy1) + 1;

                            const drawPos = new Vector((ssx0 / zx) - ox, (ssy0 / zy) - oy);
                            const drawSize = new Vector(Math.max(1, (ssx1 - ssx0) / zx), Math.max(1, (ssy1 - ssy0) / zy));
                            this.Draw.image(simpleFrame, drawPos, drawSize, null, 0, 1, false);
                        } else {
                            // fallback: atlas draw
                            this.Draw.sheet(sheet, pos, size, effAnim, effFrame, null, 1, false);
                        }
                    } catch (e) {
                        try {
                            const simpleFrame = this._getCompositedPixelFrame(effAnim, effFrame, false, true);
                            if (simpleFrame) this.Draw.image(simpleFrame, pos, size, null, 0, 1, false);
                        } catch (e2) { /* ignore simplified render fallback errors */ }
                    }
                    return;
                }

                const frameCanvas = (effAnim !== null) ? this._getCompositedPixelFrame(effAnim, effFrame) : null;
                // Prefer Draw.sheet which understands SpriteSheet metadata (rows/frames).
                let layeredCanvas = null;
                if (modeBase && effAnim !== null && sheet && typeof this.Draw.sheet === 'function') {
                    try {
                        // Draw.sheet expects a sheet-like object with `.sheet` (Image/Canvas)
                        // and `.slicePx` and an animations map. Our SpriteSheet provides those.
                        // Before drawing the active frame, optionally draw onion-skin layers
                        // (neighboring frames) with reduced alpha so users see motion context.
                        try {
                            const drawCtx = this.Draw && this.Draw.ctx;
                            const onionEnabled = (!this.tilemode) && ((typeof this.onionSkin === 'boolean') ? this.onionSkin : false);
                            // If FrameSelect has multi-selected frames, composite those instead. Allow in tilemode too.
                            const multiSet = (this.FrameSelect && this.FrameSelect._multiSelected) ? this.FrameSelect._multiSelected : null;
                            const framesArr = (sheet && sheet._frames && effAnim) ? (sheet._frames.get(effAnim) || []) : [];
                            const baseAlpha = (typeof this.onionAlpha === 'number') ? this.onionAlpha : 1;
                            const layerAlpha = (typeof this.layerAlpha === 'number') ? Math.max(0, Math.min(1, this.layerAlpha)) : 1;
                            let compositeIdxs = null;

                            if (binding && Array.isArray(binding.multiFrames) && binding.multiFrames.length > 0) {
                                compositeIdxs = binding.multiFrames.filter(i => Number.isFinite(i)).map(i => Number(i));
                            } else if (multiSet && multiSet.size > 0) {
                                compositeIdxs = Array.from(multiSet).filter(i => typeof i === 'number' && i >= 0 && i < framesArr.length).map(Number);
                            }

                            if (effAnim !== null && drawCtx && compositeIdxs && compositeIdxs.length >= 2) {
                                try {
                                    if (!compositeIdxs.includes(effFrame)) compositeIdxs.push(effFrame);
                                    compositeIdxs = compositeIdxs.filter(i => i >= 0 && i < framesArr.length).sort((a,b)=>a-b);
                                    if (compositeIdxs.length >= 2) {
                                        // Composite every selected frame with shared alpha so none dominates.
                                        const tmp = document.createElement('canvas');
                                        tmp.width = dstW; tmp.height = dstH;
                                        const tctx = tmp.getContext('2d');
                                        try { tctx.imageSmoothingEnabled = false; } catch (e) {}
                                        // Multi-select layering uses layerAlpha (independent of onion skin).
                                        const alphaPerLayer = layerAlpha;
                                        for (const ii of compositeIdxs) {
                                            try {
                                                const fCanvas = this._getCompositedPixelFrame(effAnim, ii);
                                                if (!fCanvas) continue;
                                                tctx.save();
                                                tctx.globalAlpha = alphaPerLayer;
                                                tctx.drawImage(fCanvas, 0, 0, fCanvas.width, fCanvas.height, 0, 0, dstW, dstH);
                                                tctx.restore();
                                            } catch (e) { /* ignore per-frame */ }
                                        }
                                        layeredCanvas = tmp;
                                    }
                                } catch (e) { /* ignore multi-select compositing errors */ }
                            } else if (effAnim !== null && drawCtx && onionEnabled) {
                                const r = this.onionRange;
                                let before = 1, after = 1;
                                if (typeof r === 'number') {
                                    before = after = Math.max(0, Math.abs(Math.floor(r)));
                                } else if (r && typeof r === 'object') {
                                    before = Math.max(0, Math.abs(Math.floor(r.before !== undefined ? r.before : 1)));
                                    after = Math.max(0, Math.abs(Math.floor(r.after !== undefined ? r.after : 1)));
                                }
                                const maxRange = Math.max(1, before, after);
                                for (let off = -before; off <= after; off++) {
                                    if (off === 0) continue;
                                    try {
                                        const idx = effFrame + off;
                                        const fCanvas = this._getCompositedPixelFrame(effAnim, idx);
                                        if (!fCanvas) continue;
                                        drawCtx.save();
                                        // Fade more for frames further away
                                        const distance = Math.abs(off);
                                        const alpha = Math.max(0, baseAlpha * (1 - (distance - 1) / maxRange));
                                        drawCtx.globalAlpha = alpha;
                                        // Use Draw.image so transforms / scaling are respected
                                        this.Draw.image(fCanvas, dstPos, new Vector(dstW, dstH), null, 0, 1, false);
                                        drawCtx.restore();
                                    } catch (e) { /* ignore per-frame draw errors */ }
                                }
                            }
                        } catch (e) { /* ignore onion/multi preparation errors */ }

                        // If a preview transform exists for this area (tilemode only), draw a transformed temporary canvas
                        const transform = (this.tilemode && typeof areaIndex === 'number' && Array.isArray(this._areaTransforms)) ? this._areaTransforms[areaIndex] : null;
                        const hasTransform = !!(transform && ((transform.rot || 0) !== 0 || transform.flipH));
                        const drawable = layeredCanvas || frameCanvas;
                        if (hasTransform && drawable) {
                            try {
                                const tmp = document.createElement('canvas'); tmp.width = dstW; tmp.height = dstH;
                                const tctx = tmp.getContext('2d'); try { tctx.imageSmoothingEnabled = false; } catch (e) {}
                                tctx.save();
                                // translate to center for rotation
                                tctx.translate(dstW / 2, dstH / 2);
                                if (transform.flipH) tctx.scale(-1, 1);
                                tctx.rotate((transform.rot || 0) * Math.PI / 180);
                                // draw scaled to dstW/dstH centered
                                tctx.drawImage(drawable, -dstW / 2, -dstH / 2, dstW, dstH);
                                tctx.restore();
                                this.Draw.image(tmp, dstPos, new Vector(dstW, dstH), null, 0, 1, false);
                            } catch (e) {
                                // fallback to composited frame if transform draw fails
                                if (layeredCanvas) this.Draw.image(layeredCanvas, dstPos, new Vector(dstW, dstH), null, 0, 1, false);
                                else if (frameCanvas) this.Draw.image(frameCanvas, dstPos, new Vector(dstW, dstH), null, 0, 1, false);
                                else this.Draw.sheet(sheet, dstPos, new Vector(dstW, dstH), effAnim, effFrame, null, 1, false);
                            }
                        } else if (layeredCanvas) {
                            this.Draw.image(layeredCanvas, dstPos, new Vector(dstW, dstH), null, 0, 1, false);
                        } else if (frameCanvas) {
                            this.Draw.image(frameCanvas, dstPos, new Vector(dstW, dstH), null, 0, 1, false);
                        } else {
                            this.Draw.sheet(sheet, dstPos, new Vector(dstW, dstH), effAnim, effFrame, null, 1, false);
                        }
                    } catch (e) {
                        // fallback to per-frame canvas if Draw.sheet fails
                        if (frameCanvas) this.Draw.image(frameCanvas, dstPos, new Vector(dstW, dstH), null, 0, 1, false);
                        else if (sheet && sheet.sheet) this.Draw.image(sheet.sheet, dstPos, new Vector(dstW, dstH), null, 0, 1, false);
                    }
                } else if (modeBase && frameCanvas) {
                    // fallback: draw per-frame canvas
                    this.Draw.image(frameCanvas, dstPos, new Vector(dstW, dstH), null, 0, 1, false);
                } else if (modeBase && !this.tilemode && sheet && sheet.sheet) {
                    // fallback when not in tilemode: draw the packed sheet (will show full sheet)
                    this.Draw.image(sheet.sheet, dstPos, new Vector(dstW, dstH), null, 0, 1, false);
                }

                // After drawing the frame, show binding label (or mirrored note).
                if (modeBase) {
                    try {
                        if (typeof areaIndex === 'number' && Array.isArray(this._areaBindings) && this._areaBindings[areaIndex] && this.tilemode) {
                            const b = this._areaBindings[areaIndex];
                            const label = (b && b.anim) ? `${b.anim}:${b.index}` : String(b && b.index);
                            this.Draw.text(label, new Vector(pos.x + 6, pos.y + 14), '#FFFFFF', 0, 12, { align: 'left', baseline: 'top', font: 'monospace' });
                        } else if (this.tilemode) {
                            //this.Draw.text('(selected)', new Vector(pos.x + 6, pos.y + 14), '#AAAAAA', 0, 12, { align: 'left', baseline: 'top', font: 'monospace' });
                        }
                    } catch (e) { }
                }

                // Draw a pixel cursor / selection preview unless render-only.
                if (modeOverlay && (!renderOnly || this.tilemode)) {
                    // In tilemode this is restricted to tiles that mirror the same effective frame
                    this.displayCursor(dstPos,dstW,dstH,binding,effAnim,effFrame,areaIndex,renderOnly)
                }
            }
        } catch (e) {
            console.warn('displayDrawArea failed', e);
        }
    }
    displayCursor(dstPos,dstW,dstH,binding,effAnim,effFrame,areaIndex,renderOnly=false){
        try {
            const isRenderOnly = !!renderOnly;
            const cellW = dstW / this.currentSprite.slicePx;
            const cellH = dstH / this.currentSprite.slicePx;

            // Keep cursor/selection outlines thin on larger canvases
            const sliceSize = Math.max(1, this.currentSprite && this.currentSprite.slicePx ? this.currentSprite.slicePx : 1);
            const outlineScale = Math.max(0.35, Math.min(1, 32 / sliceSize));
            const scaleOutline = (base) => base * outlineScale;

            // Determine which draw area (if any) the mouse is currently over
            // so we can limit tilemode previews to matching frame types.
            const posInfoGlobal = this._frameMousePosInfo || this.getPos(this.mouse && this.mouse.pos);
            const hoveredInside = !!(posInfoGlobal && posInfoGlobal.inside);
            const hoveredAreaIndex = hoveredInside ? posInfoGlobal.areaIndex : null;

            // Render-only handled separately to avoid per-area stacking
            if (isRenderOnly) return;

            // If there is an active selection tied to this area, always draw it here
            // even if the cursor is hovering a different tile.
            const selectionAnchoredHere = !!(this.tilemode && typeof areaIndex === 'number' && (
                (this.selectionPoints && this.selectionPoints.some(p => typeof p?.areaIndex === 'number' && p.areaIndex === areaIndex)) ||
                (this.selectionRegion && typeof this.selectionRegion.areaIndex === 'number' && this.selectionRegion.areaIndex === areaIndex)
            ));

            if (this.tilemode && typeof hoveredAreaIndex === 'number' && !selectionAnchoredHere) {
                // In tilemode, previews should be shown only on the hovered tile
                // unless the preview is anchored by an existing per-area selection.
                if (typeof areaIndex === 'number' && areaIndex !== hoveredAreaIndex) return;
            }

            // Draw selection points
            if (this.selectionPoints && this.selectionPoints.length > 0) {
                for (const point of this.selectionPoints) {
                    const pointArea = (typeof point.areaIndex === 'number') ? point.areaIndex : null;
                    if (this.tilemode && pointArea !== null && typeof areaIndex === 'number' && pointArea !== areaIndex) continue;
                    const cellX = dstPos.x + point.x * cellW;
                    const cellY = dstPos.y + point.y * cellH;
                    this.Draw.rect(new Vector(cellX, cellY), new Vector(cellW/3, cellH/3), '#00FFFF55', true); // Aqua fill
                    this.Draw.rect(new Vector(cellX, cellY), new Vector(cellW, cellH), '#00FFFFFF', false, true, scaleOutline(1), '#00FFFFFF'); // Aqua outline
                }
            }

            // Draw active region selection (created when two points + 'b' pressed)
            if (this.selectionRegion) {
                try {
                    const sr = this.selectionRegion;
                    const regionArea = (typeof sr.areaIndex === 'number') ? sr.areaIndex : null;
                    const shouldRenderRegionHere = !(this.tilemode && regionArea !== null && typeof areaIndex === 'number' && regionArea !== areaIndex);
                    if (shouldRenderRegionHere) {
                        const minX = Math.min(sr.start.x, sr.end.x);
                        const minY = Math.min(sr.start.y, sr.end.y);
                        const maxX = Math.max(sr.start.x, sr.end.x);
                        const maxY = Math.max(sr.start.y, sr.end.y);
                        const rectX = dstPos.x + minX * cellW;
                        const rectY = dstPos.y + minY * cellH;
                        const rectW = (maxX - minX + 1) * cellW;
                        const rectH = (maxY - minY + 1) * cellH;
                        // translucent fill + outline for selection region
                        this.Draw.rect(new Vector(rectX, rectY), new Vector(rectW, rectH), '#00FF0055', true);
                        this.Draw.rect(new Vector(rectX, rectY), new Vector(rectW, rectH), '#00FF00AA', false, true, scaleOutline(2), '#00FF00AA');
                    }
                } catch (e) {
                    // ignore region-draw errors
                }
            }

            // Draw clipboard preview (Alt+C) aligned so clipboard origin matches mouse pixel
            if (this.clipboardPreview && this.clipboard && (!this._activeClipboardType || this._activeClipboardType === 'pixel')) {
                try {
                    const cb = this.clipboard;
                    // mouse position in frame coords
                    const posInfo = posInfoGlobal;
                    if (!posInfo || !posInfo.inside) return;
                    // determine frozen placement if dragging, otherwise compute placement aligning origin under mouse
                    const ox = (cb.originOffset && Number.isFinite(cb.originOffset.ox)) ? cb.originOffset.ox : 0;
                    const oy = (cb.originOffset && Number.isFinite(cb.originOffset.oy)) ? cb.originOffset.oy : 0;
                    const w = cb.w;
                    const h = cb.h;
                    let topLeftX, topLeftY;
                    if (this._clipboardPreviewDragging) {
                        topLeftX = this._clipboardPreviewDragging.topLeftX;
                        topLeftY = this._clipboardPreviewDragging.topLeftY;
                    } else {
                        topLeftX = posInfo.x - ox;
                        topLeftY = posInfo.y - oy;
                    }

                    if (cb.type === 'points') {
                        // draw sparse points relative to topLeftX/topLeftY
                        const pixels = cb.pixels || [];
                        for (const p of pixels) {
                            if (!p) continue;
                            if (p.a === 0) continue;
                            const hex = this.rgbaToHex(p.r, p.g, p.b, p.a);
                            const drawX = dstPos.x + (topLeftX + p.x) * cellW;
                            const drawY = dstPos.y + (topLeftY + p.y) * cellH;
                            this.Draw.rect(new Vector(drawX, drawY), new Vector(cellW, cellH), hex, true);
                        }
                    } else {
                        // image clipboard: create a temporary canvas and put image data
                        const tmp = document.createElement('canvas');
                        tmp.width = w;
                        tmp.height = h;
                        const tctx = tmp.getContext('2d');
                        try {
                            const imgData = new ImageData(new Uint8ClampedArray(cb.data), w, h);
                            tctx.putImageData(imgData, 0, 0);
                            const dstX = dstPos.x + topLeftX * cellW;
                            const dstY = dstPos.y + topLeftY * cellH;
                            const dstWpx = w * cellW;
                            const dstHpx = h * cellH;
                            this.Draw.image(tmp, new Vector(dstX, dstY), new Vector(dstWpx, dstHpx), null, 0, 0.85, false);
                        } catch (e) {
                            // fallback: draw per-pixel rectangles if putImageData fails
                            for (let yy = 0; yy < h; yy++) {
                                for (let xx = 0; xx < w; xx++) {
                                    const i = (yy * w + xx) * 4;
                                    const r = cb.data[i];
                                    const g = cb.data[i+1];
                                    const b = cb.data[i+2];
                                    const a = cb.data[i+3];
                                    if (a === 0) continue;
                                    const hex = this.rgbaToHex(r,g,b,a);
                                    const drawX = dstPos.x + (topLeftX + xx) * cellW;
                                    const drawY = dstPos.y + (topLeftY + yy) * cellH;
                                    this.Draw.rect(new Vector(drawX, drawY), new Vector(cellW, cellH), hex, true);
                                }
                            }
                        }
                    }
                } catch (e) {
                    // ignore preview errors
                }
            }

            // Draw a blinking, low-alpha preview when clipboard brush mode is active (non-preview mode)
            if (this._clipboardBrushActive && this.clipboard && !this.clipboardPreview) {
                try {
                    const cb = this.clipboard;
                    const posInfo = posInfoGlobal;
                    if (posInfo && posInfo.inside && typeof areaIndex === 'number' && posInfo.areaIndex === areaIndex) {
                        const ox = (cb.originOffset && Number.isFinite(cb.originOffset.ox)) ? cb.originOffset.ox : 0;
                        const oy = (cb.originOffset && Number.isFinite(cb.originOffset.oy)) ? cb.originOffset.oy : 0;
                        const w = cb.w;
                        const h = cb.h;
                        const topLeftX = posInfo.x - ox;
                        const topLeftY = posInfo.y - oy;
                        const blink = 0.2 * (0.5 + 0.5 * Math.sin((this._clipboardBrushBlinkPhase || 0) * 6));
                        const ghostAlpha = Math.max(0.05, Math.min(0.6, 0.25 + blink));

                        if (cb.type === 'points') {
                            const pixels = cb.pixels || [];
                            for (const p of pixels) {
                                if (!p) continue;
                                if (p.a === 0) continue;
                                const drawX = dstPos.x + (topLeftX + p.x) * cellW;
                                const drawY = dstPos.y + (topLeftY + p.y) * cellH;
                                this.Draw.rect(new Vector(drawX, drawY), new Vector(cellW, cellH), `rgba(${p.r||0},${p.g||0},${p.b||0},${ghostAlpha})`, true);
                            }
                        } else {
                            const tmp = document.createElement('canvas');
                            tmp.width = w;
                            tmp.height = h;
                            const tctx = tmp.getContext('2d');
                            try {
                                const imgData = new ImageData(new Uint8ClampedArray(cb.data), w, h);
                                tctx.putImageData(imgData, 0, 0);
                                const dstX = dstPos.x + topLeftX * cellW;
                                const dstY = dstPos.y + topLeftY * cellH;
                                const dstWpx = w * cellW;
                                const dstHpx = h * cellH;
                                this.Draw.image(tmp, new Vector(dstX, dstY), new Vector(dstWpx, dstHpx), null, 0, ghostAlpha, false);
                            } catch (e) {
                                for (let yy = 0; yy < h; yy++) {
                                    for (let xx = 0; xx < w; xx++) {
                                        const i = (yy * w + xx) * 4;
                                        const a = cb.data[i+3];
                                        if (a === 0) continue;
                                        const r = cb.data[i];
                                        const g = cb.data[i+1];
                                        const b = cb.data[i+2];
                                        const hex = this.rgbaToHex(r,g,b, Math.round(a * ghostAlpha));
                                        const drawX = dstPos.x + (topLeftX + xx) * cellW;
                                        const drawY = dstPos.y + (topLeftY + yy) * cellH;
                                        this.Draw.rect(new Vector(drawX, drawY), new Vector(cellW, cellH), hex, true);
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {
                    // ignore brush preview errors
                }
            }

            const posInfo = posInfoGlobal;
            const anchor = this._getShapeAnchorPoint(posInfo);
            const anchorArea = (anchor && typeof anchor.areaIndex === 'number') ? anchor.areaIndex : null;

            // Only show shape previews on the anchor's tile when known to avoid duplication across tiles.
            if (anchorArea !== null && typeof areaIndex === 'number' && areaIndex !== anchorArea) {
                return;
            }

            // Only preview when the cursor is actually over a valid tile pixel.
            let mousePixelPos = null;
            if (posInfo && posInfo.inside && (anchorArea === null || posInfo.areaIndex === anchorArea)) {
                mousePixelPos = { x: posInfo.x, y: posInfo.y };
            }

            if (mousePixelPos) {
                // Color tokens: default white, switch to yellow when pixel-perfect pen enabled
                const useYellow = (!this.tilemode && this.pixelPerfect) || (this.tilemode && this.autotile);
                const previewLineColor = useYellow ? '#FFFF0088' : '#FFFFFF88';
                const previewFillColor = useYellow ? '#FFFF0044' : '#FFFFFF44';
                const cursorFillColor = useYellow ? '#FFFF0022' : '#FFFFFF22';
                const cursorOutlineColor = useYellow ? '#FFFF00EE' : '#FFFFFFEE';

                if (this.currentTool === 'line' && this.selectionPoints.length === 1) {
                    this.drawLine(anchor, mousePixelPos, previewLineColor, dstPos, cellW, cellH);
                } else if (this.currentTool === 'box' && this.selectionPoints.length === 1) {
                    this.drawBox(anchor, mousePixelPos, previewLineColor, this.keys.held('Alt'), dstPos, cellW, cellH);
                } else if (this.currentTool === 'circle' && this.selectionPoints && this.selectionPoints.length > 0 && typeof this.computeCirclePixels === 'function') {
                    // For circles, allow preview with either a single anchor pixel
                    // or an even-centered 2x2 anchor (4 pixels). In both cases we
                    // pass the first point; computeCirclePixels will adjust center
                    // when the selection is a 2x2 even anchor.
                    const start = anchor;
                    const end = mousePixelPos;
                    const filled = this.keys.held('Alt');
                    const strokeWidth = this._getShapeStrokeWidth();
                    const circlePixels = this.computeCirclePixels(start, end, filled, strokeWidth) || [];
                    for (const p of circlePixels) {
                        const cellX = dstPos.x + p.x * cellW;
                        const cellY = dstPos.y + p.y * cellH;
                        this.Draw.rect(new Vector(cellX, cellY), new Vector(cellW, cellH), previewFillColor, true);
                    }
                } else if (this.currentTool === 'spiral' && this.selectionPoints && this.selectionPoints.length > 0 && typeof this.computeSpiralPixels === 'function') {
                    const start = anchor;
                    const end = mousePixelPos;
                    const strokeWidth = this._getShapeStrokeWidth();
                    const spiralPixels = this.computeSpiralPixels(start, end, strokeWidth) || [];
                    for (const p of spiralPixels) {
                        const cellX = dstPos.x + p.x * cellW;
                        const cellY = dstPos.y + p.y * cellH;
                        this.Draw.rect(new Vector(cellX, cellY), new Vector(cellW, cellH), previewFillColor, true);
                    }
                } else if (this.currentTool === 'boxSpiral' && this.selectionPoints && this.selectionPoints.length > 0 && typeof this.computeBoxSpiralPixels === 'function') {
                    const start = anchor;
                    const end = mousePixelPos;
                    const strokeWidth = this._getShapeStrokeWidth();
                    const spiralPixels = this.computeBoxSpiralPixels(start, end, strokeWidth) || [];
                    for (const p of spiralPixels) {
                        const cellX = dstPos.x + p.x * cellW;
                        const cellY = dstPos.y + p.y * cellH;
                        this.Draw.rect(new Vector(cellX, cellY), new Vector(cellW, cellH), previewFillColor, true);
                    }
                }

                // draw brush-sized cursor (NxN where N is this.brushSize)
                    try {
                    const side = Math.max(1, Math.min(15, this.brushSize || 1));
                    const half = Math.floor((side - 1) / 2);
                    const sx = mousePixelPos.x - half;
                    const sy = mousePixelPos.y - half;
                    const drawX = dstPos.x + sx * cellW;
                    const drawY = dstPos.y + sy * cellH;
                    const drawW = side * cellW;
                    const drawH = side * cellH;
                    this.Draw.rect(new Vector(drawX, drawY), new Vector(drawW, drawH), cursorFillColor, true);
                    this.Draw.rect(new Vector(drawX, drawY), new Vector(drawW, drawH), cursorOutlineColor, false, true, scaleOutline(2), cursorOutlineColor);
                } catch (e) {
                    const cellX = dstPos.x + mousePixelPos.x * cellW;
                    const cellY = dstPos.y + mousePixelPos.y * cellH;
                    this.Draw.rect(new Vector(cellX, cellY), new Vector(cellW, cellH), cursorFillColor, true);
                    this.Draw.rect(new Vector(cellX, cellY), new Vector(cellW, cellH), cursorOutlineColor, false, true, scaleOutline(2), cursorOutlineColor);
                }
            }
        } catch (e) {
            // ignore cursor errors
        }
    }

    drawLine(start, end, color, dstPos = null, cellW = null, cellH = null) {
        const strokeWidth = this._getShapeStrokeWidth();
        const pixels = this.computeLinePixels(start, end, strokeWidth) || [];
        for (const p of pixels) this.drawPixel(p.x, p.y, color, dstPos, cellW, cellH);
    }

    drawBox(start, end, color, filled, dstPos = null, cellW = null, cellH = null) {
        const strokeWidth = this._getShapeStrokeWidth();
        const pixels = this.computeBoxPixels(start, end, filled, strokeWidth) || [];
        for (const p of pixels) this.drawPixel(p.x, p.y, color, dstPos, cellW, cellH);
    }

    drawPixel(x, y, color, dstPos = null, cellW = null, cellH = null) {
        if (dstPos && Number.isFinite(Number(cellW)) && Number.isFinite(Number(cellH))) {
            const cellX = dstPos.x + x * cellW;
            const cellY = dstPos.y + y * cellH;
            this.Draw.rect(new Vector(cellX, cellY), new Vector(cellW, cellH), color, true);
            return;
        }
        // prefer the area the user last interacted with; fallback to centered area
        let area = null;
        if (typeof this._activeDrawAreaIndex === 'number') {
            if (this._drawAreaIndexMap && typeof this._drawAreaIndexMap.get === 'function') {
                area = this._drawAreaIndexMap.get(this._activeDrawAreaIndex) || null;
            }
            if (!area && Array.isArray(this._drawAreas) && this._drawAreas[this._activeDrawAreaIndex]) {
                area = this._drawAreas[this._activeDrawAreaIndex];
            }
        }
        if (!area) area = this.computeDrawArea();
        if (!area) return;
        const fallbackCellW = area.dstW / this.currentSprite.slicePx;
        const fallbackCellH = area.dstH / this.currentSprite.slicePx;
        const cellX = area.dstPos.x + x * fallbackCellW;
        const cellY = area.dstPos.y + y * fallbackCellH;
        this.Draw.rect(new Vector(cellX, cellY), new Vector(fallbackCellW, fallbackCellH), color, true);
    }

    _drawSpriteEntities(basePos, tileSize, visible = null) {
        try {
            if (!this.tilemode || !this.currentSprite) return;
            const layer = this._normalizeSpriteLayerState();
            if (!layer) return;
            const order = Array.isArray(layer.order) ? layer.order : [];
            const entities = layer.entities || {};

            for (let i = 0; i < order.length; i++) {
                const id = order[i];
                const ent = entities[id];
                if (!ent) continue;
                const col = Number(ent.col) | 0;
                const row = Number(ent.row) | 0;
                if (visible && (col < visible.minCol || col > visible.maxCol || row < visible.minRow || row > visible.maxRow)) continue;
                const pos = this._tileCoordToPos(col, row, basePos, tileSize);

                const anim = ent.anim || this.selectedAnimation;
                const runtime = (this._spriteAnimRuntime && this._spriteAnimRuntime.get(String(anim))) ? this._spriteAnimRuntime.get(String(anim)) : null;
                const frameCount = this._getAnimationLogicalFrameCount(anim);
                let frameIndex = 0;
                if (runtime && runtime.anim === anim) {
                    frameIndex = Math.max(0, Math.min(frameCount - 1, Number(runtime.frame) || 0));
                }
                const frameCanvas = (typeof this.currentSprite.getFrame === 'function')
                    ? this.currentSprite.getFrame(anim, frameIndex)
                    : null;
                if (frameCanvas) {
                    this.Draw.image(frameCanvas, pos, tileSize, null, 0, 0.95, false);
                }

                if (this.selectedSpriteEntityId && String(this.selectedSpriteEntityId) === String(id)) {
                    this.Draw.rect(pos, tileSize, '#00FF66FF', false, true, Math.max(2, Math.round(Math.min(tileSize.x, tileSize.y) * 0.03)), '#00FF66FF');
                } else if (this._spriteHoverEntityId && String(this._spriteHoverEntityId) === String(id)) {
                    this.Draw.rect(pos, tileSize, '#FFFFFFFF', false, true, Math.max(1, Math.round(Math.min(tileSize.x, tileSize.y) * 0.02)), '#FFFFFFFF');
                }
            }
        } catch (e) { /* ignore sprite entity draw errors */ }
    }

    // Draw the tile cursor, selection outlines, and paste preview once per frame.
    _drawTileCursorOverlay() {
        try {
            if (!this.tilemode) return;
            const allRenderOnly = !!this._renderOnlyAllVisible;
            const baseArea = (typeof this.computeDrawArea === 'function') ? this.computeDrawArea() : null;
            if (!baseArea) return;
            const basePos = baseArea.topLeft;
            const tileSize = baseArea.size;
            // anchor tile (last hovered or explicit)
            const anchor = this._tileHoverAnchor || null;

            // Draw selection outlines for selected tiles — only when relevant renderOnly areas exist
            try {
                let showTileSelection = !!(allRenderOnly && this._tileSelection && this._tileSelection.size > 0);
                if (this._tileSelection && this._tileSelection.size > 0) {
                    if (!allRenderOnly) {
                        for (const key of this._tileSelection) {
                            const c = this._parseTileKey(key);
                            if (!c) continue;
                            // try to find in current draw areas first
                            const idx = this._getAreaIndexForCoord(c.col, c.row);
                            let areaInfo = (this._drawAreaIndexMap && typeof this._drawAreaIndexMap.get === 'function' && typeof idx === 'number')
                                ? (this._drawAreaIndexMap.get(idx) || null)
                                : null;
                            // fallback: compute area info from tile coords
                            if (!areaInfo) {
                                try {
                                    const pos = this._tileCoordToPos(c.col, c.row, basePos, tileSize);
                                    areaInfo = this.computeAreaInfo(pos, tileSize);
                                    if (areaInfo) areaInfo.renderOnly = this._isSimTooSmall(areaInfo);
                                } catch (e) { areaInfo = null; }
                            }
                            if (areaInfo && areaInfo.renderOnly) { showTileSelection = true; break; }
                        }
                    }
                }
                // also allow selection drawing when anchor is over a renderOnly tile
                if (!showTileSelection && anchor && !allRenderOnly) {
                    const aidx = this._getAreaIndexForCoord(anchor.col, anchor.row);
                    let ainfo = (this._drawAreaIndexMap && typeof this._drawAreaIndexMap.get === 'function' && typeof aidx === 'number')
                        ? (this._drawAreaIndexMap.get(aidx) || null)
                        : null;
                    if (!ainfo) {
                        try { const pos = this._tileCoordToPos(anchor.col, anchor.row, basePos, tileSize); ainfo = this.computeAreaInfo(pos, tileSize); if (ainfo) ainfo.renderOnly = this._isSimTooSmall(ainfo); } catch(e) { ainfo = null; }
                    }
                    if (ainfo && ainfo.renderOnly) showTileSelection = true;
                }

                if (showTileSelection) {
                    const selStroke = '#00FFFFFF';
                    const selStrokeW = Math.max(2, Math.round(Math.min(tileSize.x, tileSize.y) * 0.015));
                    for (const key of this._tileSelection) {
                        const c = this._parseTileKey(key);
                        if (!c) continue;
                        const topLeft = this._tileCoordToPos(c.col, c.row, basePos, tileSize);
                        this.Draw.rect(topLeft, tileSize, null, false, true, selStrokeW, selStroke);
                        const cornerSize = Math.max(4, Math.round(Math.min(tileSize.x, tileSize.y) * 0.18));
                        this.Draw.rect(new Vector(topLeft.x + 1, topLeft.y + 1), new Vector(cornerSize, cornerSize), null, false, true, Math.max(1, selStrokeW - 1), selStroke);
                    }
                }
            } catch (e) { /* ignore selection draw errors */ }

            // Draw waypoint markers.
            try {
                const waypoints = this._getWaypointCoords(false);
                if (waypoints.length > 0) {
                    const bounds = this._getVisibleTileBounds(basePos, tileSize, 1);
                    const markerFill = '#00E5FF88';
                    const markerStroke = '#00E5FFFF';
                    const markerStrokeW = Math.max(1, Math.round(Math.min(tileSize.x, tileSize.y) * 0.02));
                    for (const wp of waypoints) {
                        if (wp.col < bounds.minCol || wp.col > bounds.maxCol || wp.row < bounds.minRow || wp.row > bounds.maxRow) continue;
                        const topLeft = this._tileCoordToPos(wp.col, wp.row, basePos, tileSize);
                        const center = new Vector(topLeft.x + tileSize.x * 0.5, topLeft.y + tileSize.y * 0.5);
                        const markerSize = new Vector(Math.max(5, tileSize.x * 0.34), Math.max(5, tileSize.y * 0.34));
                        const markerPos = new Vector(center.x - markerSize.x * 0.5, center.y - markerSize.y * 0.5);
                        this.Draw.rect(markerPos, markerSize, markerFill, true);
                        this.Draw.rect(markerPos, markerSize, null, false, true, markerStrokeW, markerStroke);
                    }
                }
            } catch (e) { /* ignore waypoint draw errors */ }

            // Tile cursor (single rect matching brush footprint) — only draw when anchor area is renderOnly
            if (anchor) {
                let showCursor = allRenderOnly;
                try {
                    if (!allRenderOnly) {
                        const aidx = this._getAreaIndexForCoord(anchor.col, anchor.row);
                        let ainfo = (this._drawAreaIndexMap && typeof this._drawAreaIndexMap.get === 'function' && typeof aidx === 'number')
                            ? (this._drawAreaIndexMap.get(aidx) || null)
                            : null;
                        if (!ainfo) {
                            try { const pos = this._tileCoordToPos(anchor.col, anchor.row, basePos, tileSize); ainfo = this.computeAreaInfo(pos, tileSize); if (ainfo) ainfo.renderOnly = this._isSimTooSmall(ainfo); } catch(e) { ainfo = null; }
                        }
                        if (ainfo && ainfo.renderOnly) showCursor = true;
                    }
                } catch (e) { showCursor = false; }
                if (showCursor) {
                const side = Math.max(1, Math.min(15, this.brushSize || 1));
                const start = -Math.floor(side / 2);
                const topLeftTile = { col: anchor.col + start, row: anchor.row + start };
                const topLeft = this._tileCoordToPos(topLeftTile.col, topLeftTile.row, basePos, tileSize);
                const rectPos = topLeft;
                const rectSize = new Vector(side * tileSize.x, side * tileSize.y);
                // use yellow cursor when autotile is enabled
                const useYellowTileCursor = !!this.autotile;
                const cursorFill = useYellowTileCursor ? '#FFFF0022' : '#FFFFFF22';
                const cursorStroke = useYellowTileCursor ? '#FFFF00EE' : '#FFFFFFEE';
                    const strokeW = Math.max(2, Math.round(Math.min(tileSize.x, tileSize.y) * 0.03));
                    this.Draw.rect(rectPos, rectSize, cursorFill, true);
                    this.Draw.rect(rectPos, rectSize, cursorStroke, false, true, strokeW, cursorStroke);
                }
            }

            // Tile shape preview (when a single tile is selected and a tile tool is active)
            try {
                if (this.currentToolTile && this._tileSelection && this._tileSelection.size === 1) {
                    const selKey = Array.from(this._tileSelection)[0];
                    const anchorTile = this._parseTileKey(selKey);
                    if (anchorTile) {
                        // determine hovered/target tile under mouse
                        let posInfo = null;
                        try { posInfo = (typeof this.getPos === 'function') ? this.getPos(this.mouse && this.mouse.pos) : null; } catch (e) { posInfo = null; }
                        let targetTile = null;
                        if (posInfo && posInfo.renderOnly && typeof posInfo.tileCol === 'number' && typeof posInfo.tileRow === 'number') {
                            targetTile = { col: posInfo.tileCol, row: posInfo.tileRow };
                        } else {
                            targetTile = anchorTile;
                        }

                        // compute tile list for preview, separating interior and border
                        const interior = [];
                        const border = [];
                        const x0 = anchorTile.col, y0 = anchorTile.row;
                        const x1 = targetTile.col, y1 = targetTile.row;
                        if (this.currentToolTile === 'box') {
                            const minC = Math.min(x0,x1), maxC = Math.max(x0,x1);
                            const minR = Math.min(y0,y1), maxR = Math.max(y0,y1);
                            for (let r = minR; r <= maxR; r++) for (let c = minC; c <= maxC; c++) {
                                if (r === minR || r === maxR || c === minC || c === maxC) border.push({col:c,row:r});
                                else interior.push({col:c,row:r});
                            }
                        } else if (this.currentToolTile === 'line') {
                            let x = x0, y = y0;
                            const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
                            const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
                            let err = dx + dy;
                            while (true) {
                                border.push({col:x,row:y});
                                if (x === x1 && y === y1) break;
                                const e2 = 2 * err;
                                if (e2 >= dy) { err += dy; x += sx; }
                                if (e2 <= dx) { err += dx; y += sy; }
                            }
                        } else if (this.currentToolTile === 'circle') {
                            const dx = x1 - x0, dy = y1 - y0;
                            const r = Math.max(Math.abs(dx), Math.abs(dy));
                            const r2 = r * r;
                            const borderBand = Math.max(1, r);
                            for (let rr = -r; rr <= r; rr++) for (let cc = -r; cc <= r; cc++) {
                                const dist2 = cc*cc + rr*rr;
                                const isBorder = (dist2 >= r2 - borderBand && dist2 <= r2 + borderBand);
                                const isInside = (dist2 <= r2);
                                if (isBorder) border.push({col: x0+cc, row: y0+rr});
                                else if (isInside) interior.push({col: x0+cc, row: y0+rr});
                            }
                        }

                        // draw preview: outline-only by default; Alt -> fill + outline for box/circle
                        const isAlt = (this.keys && typeof this.keys.held === 'function' && this.keys.held('Alt'));
                        const previewFill = '#FFFFFF33';
                        const previewStroke = '#FFFFFFEE';
                        const previewStrokeW = Math.max(1, Math.round(Math.min(tileSize.x, tileSize.y) * 0.03));

                        // draw interior first (if Alt and for box/circle)
                        if (isAlt && (this.currentToolTile === 'box' || this.currentToolTile === 'circle')) {
                            for (const t of interior) {
                                const posVec = this._tileCoordToPos(t.col, t.row, basePos, tileSize);
                                this.Draw.rect(posVec, tileSize, previewFill, true);
                            }
                        }

                        // draw border/outline
                        for (const t of border) {
                            const posVec = this._tileCoordToPos(t.col, t.row, basePos, tileSize);
                            this.Draw.rect(posVec, tileSize, null, false, true, previewStrokeW, previewStroke);
                        }
                    }
                }
            } catch (e) { /* ignore preview errors */ }

            // Paste preview: draw actual tiles from tile clipboard (alpha)
            const showPreview = this.keys && (this.keys.held('v') || this.clipboardPreview);
            const activeType = this._activeClipboardType;
            if (showPreview && (activeType === 'tile' || (!activeType && this._tileClipboard && !this.spriteClipboard)) && this._tileClipboard && anchor) {
                const tiles = Array.isArray(this._tileClipboard.tiles) && this._tileClipboard.tiles.length > 0
                    ? this._tileClipboard.tiles
                    : (this._tileClipboard.binding ? [{ dc:0, dr:0, binding: this._tileClipboard.binding, transform: this._tileClipboard.transform }] : []);
                const sheet = this.currentSprite;
                const alpha = 0.6;
                const drawTilePreview = (binding, transform, posVec) => {
                    if (!sheet) return;
                    const anim = (binding && binding.anim !== undefined) ? binding.anim : this.selectedAnimation;
                    const idx = (binding && binding.index !== undefined) ? binding.index : this.selectedFrame;
                    const frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, idx) : null;
                    if (!frameCanvas) return;
                    const sizeVec = tileSize.clone ? tileSize.clone() : new Vector(tileSize.x, tileSize.y);
                    const hasTx = !!(transform && ((transform.rot || 0) !== 0 || transform.flipH));
                    if (hasTx) {
                        const tmp = document.createElement('canvas');
                        tmp.width = sizeVec.x; tmp.height = sizeVec.y;
                        const tctx = tmp.getContext('2d');
                        try { tctx.imageSmoothingEnabled = false; } catch (e) {}
                        tctx.save();
                        tctx.translate(sizeVec.x / 2, sizeVec.y / 2);
                        if (transform.flipH) tctx.scale(-1, 1);
                        if (transform.rot) tctx.rotate((transform.rot || 0) * Math.PI / 180);
                        tctx.drawImage(frameCanvas, -sizeVec.x / 2, -sizeVec.y / 2, sizeVec.x, sizeVec.y);
                        tctx.restore();
                        this.Draw.image(tmp, posVec, sizeVec, null, 0, alpha, false);
                    } else {
                        this.Draw.image(frameCanvas, posVec, sizeVec, null, 0, alpha, false);
                    }
                };
                // honor originOffsetTile so preview matches paste origin
                const origin = (this._tileClipboard && this._tileClipboard.originOffsetTile && Number.isFinite(this._tileClipboard.originOffsetTile.ox) && Number.isFinite(this._tileClipboard.originOffsetTile.oy))
                    ? this._tileClipboard.originOffsetTile : { ox: 0, oy: 0 };
                const baseCol = anchor.col - (origin.ox|0);
                const baseRow = anchor.row - (origin.oy|0);
                for (const t of tiles) {
                    const gx = baseCol + (t.dc|0);
                    const gy = baseRow + (t.dr|0);
                    const gPos = this._tileCoordToPos(gx, gy, basePos, tileSize);
                    drawTilePreview(t.binding, t.transform, gPos);
                }
            } else if (showPreview && (activeType === 'sprite' || (!activeType && !this._tileClipboard)) && this.spriteClipboard && anchor) {
                try {
                    const entry = this.spriteClipboard && this.spriteClipboard.entity ? this.spriteClipboard.entity : null;
                    if (entry) {
                        const anim = entry.anim || this.selectedSpriteAnimation || this.selectedAnimation;
                        const fps = this._resolveEntityFpsValue(entry, anim, 8);
                        const frameCount = (() => {
                            const arr = (this.currentSprite && this.currentSprite._frames) ? (this.currentSprite._frames.get(anim) || []) : [];
                            let logical = 0;
                            for (let i = 0; i < arr.length; i++) {
                                const e = arr[i];
                                if (!e || e.__groupStart || e.__groupEnd) continue;
                                logical++;
                            }
                            return Math.max(1, logical);
                        })();
                        const phase = Number(entry.phaseMs) || Date.now();
                        const idx = (fps > 0 && frameCount > 0)
                            ? (Math.floor((Date.now() - phase) / (1000 / fps)) % frameCount)
                            : 0;
                        const frameCanvas = (this.currentSprite && typeof this.currentSprite.getFrame === 'function')
                            ? this.currentSprite.getFrame(anim, idx)
                            : null;
                        if (frameCanvas) {
                            const previewPos = this._tileCoordToPos(anchor.col, anchor.row, basePos, tileSize);
                            this.Draw.image(frameCanvas, previewPos, tileSize, null, 0, 0.65, false);
                            this.Draw.rect(previewPos, tileSize, '#00FFFFFF', false, true, Math.max(2, Math.round(Math.min(tileSize.x, tileSize.y) * 0.03)), '#00FFFFFF');
                        }
                    }
                } catch (e) { /* ignore sprite preview draw errors */ }
            }
        } catch (e) { /* ignore overlay draw errors */ }
    }
}
