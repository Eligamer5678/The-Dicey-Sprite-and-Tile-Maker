import Scene from './Scene.js';
import Vector from '../js/Vector.js';
import createHButton from '../js/htmlElements/createHButton.js';
import createHDiv from '../js/htmlElements/createHDiv.js';
import createHInput from '../js/htmlElements/createHInput.js';
import SpriteSheet from '../js/Spritesheet.js';
import FrameSelect from '../js/UI/frameSelect.js';
import Color from '../js/Color.js';
import { copyToClipboard } from '../js/Support.js';

export class SpriteScene extends Scene {
    constructor(...args) {
        super('spriteScene', ...args);
        this.loaded = 0;
        this.isReady = false;
    }

    onReady() {
        // Whether shape tools (line/box) should treat selected points as a protective mask.
        // Default `false` because shapes often use selected points as an origin.
        this.maskShapesWithSelection = false;

        // quick canvas clear 
        const worldLayers = ['bg', 'base', 'overlay'];
        for (const ln of worldLayers) {
            try {
                this.Draw.useCtx(ln);
                this.Draw.popMatrix(false,true)
                this.Draw.clear();
            } catch (e) { console.warn('Could not clear world layer', ln, e); }
        }
        const UILayers = ['UI', 'overlays'];
        for (const ln of UILayers) {
            try {
                this.UIDraw.useCtx(ln);
                this.UIDraw.popMatrix(false,true)
                this.UIDraw.clear();
            } catch (e) { console.warn('Could not clear UI layer', ln, e); }
        }
        this.Draw.useCtx('base')
        this.UIDraw.useCtx('UI')

        // Create or reuse the shared layer panel for persistent HTML buttons
        try {
            const panel = document.getElementById('layer-panel');
            if (panel) {
                // If the panel was created by the Tiles scene, update the scene buttons
                const tilesBtn = document.getElementById('tiles-scene-btn');
                const spritesBtn = document.getElementById('sprites-scene-btn');
                const collisionBtn = document.getElementById('collision-scene-btn');
                if (tilesBtn) {
                    tilesBtn.style.background = '#333';
                    tilesBtn.onclick = () => { try { this.switchScene && this.switchScene('title'); } catch(e){} };
                }
                if (spritesBtn) {
                    spritesBtn.style.background = '#555';
                    spritesBtn.onclick = () => { try { this.switchScene && this.switchScene('spriteScene'); } catch(e){} };
                }
                if (collisionBtn) {
                    collisionBtn.style.background = '#333';
                    collisionBtn.onclick = () => { try { this.switchScene && this.switchScene('collision'); } catch(e){} };
                }
            } else {
                // If the panel doesn't exist (edge case), create a small placeholder panel
                const panel2 = createHDiv('layer-panel', new Vector(8,8), new Vector(540,44), '#00000033', { borderRadius: '6px', border: '1px solid #FFFFFF22', padding: '6px', display: 'flex', alignItems: 'center', gap: '6px' }, 'UI');
                const sceneBtnSize = new Vector(80, 28);
                const tilesSceneBtn = createHButton('tiles-scene-btn', new Vector(6, 8), sceneBtnSize, '#333', { color: '#fff', borderRadius: '4px', fontSize: 13, border: '1px solid #777' }, panel2);
                tilesSceneBtn.textContent = 'Tiles';
                const spritesSceneBtn = createHButton('sprites-scene-btn', new Vector(92, 8), sceneBtnSize, '#333', { color: '#fff', borderRadius: '4px', fontSize: 13, border: '1px solid #777' }, panel2);
                spritesSceneBtn.textContent = 'Sprites';
                const collisionSceneBtn = createHButton('collision-scene-btn', new Vector(178, 8), sceneBtnSize, '#333', { color: '#fff', borderRadius: '4px', fontSize: 13, border: '1px solid #777' }, panel2);
                collisionSceneBtn.textContent = 'Collision';
                tilesSceneBtn.onclick = () => { try { this.switchScene && this.switchScene('title'); } catch(e){} };
                spritesSceneBtn.onclick = () => { try { this.switchScene && this.switchScene('spriteScene'); } catch(e){} };
                spritesSceneBtn.style.background = '#555';
            }
        } catch (e) { console.warn('SpriteScene.createUI failed', e); }

        // Minimal scene state
        this.infoText = 'Sprites editor — import images and build animations.';
        // create a default editable spritesheet to show a blank frame
        try {
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
        } catch (e) { console.warn('failed to create default SpriteSheet', e); }

        // --- Multiplayer edit buffering / hooks ---
        try {
            // op buffer collects small edit objects before sending to server
            this._opBuffer = [];
            this._seenOpIds = new Set();
            this._sendScheduledId = null;
            this._sendIntervalMs = 120; // throttle outgoing batches
            this.clientId = this.playerId || ('c' + Math.random().toString(36).slice(2,8));
            this._lastModified = new Map(); // anim -> frameIndex -> Uint32Array timestamps (ms)
            this._suppressOutgoing = false;
            // track remote edit entries we have seen so we can prune older ops
            this._remoteEdits = new Map(); // id -> timestamp (ms)
            // pruning configuration: prune edits older than 30s (30000ms)
            this._pruneIntervalMs = 10000;
            this._pruneThresholdMs = 30000;
            this._pruneIntervalId = null;
            // message tracking and local username
            this._seenMsgIds = new Set();
            try {
                this.playerName = (this.saver && typeof this.saver.get === 'function') ? this.saver.get('player_name') : null;
            } catch (e) { this.playerName = null; }

            const sheet = this.currentSprite;
            if (sheet) {
                // wrap modifyFrame to record pixel changes
                if (typeof sheet.modifyFrame === 'function') {
                    const _origModify = sheet.modifyFrame.bind(sheet);
                    sheet.modifyFrame = (animation, index, changes) => {
                        try { this._recordUndoPixels(animation, index, changes); } catch (e) { /* ignore undo capture errors */ }
                        const res = _origModify(animation, index, changes);
                        try {
                            const pixels = [];
                            if (Array.isArray(changes)) {
                                for (const c of changes) {
                                    if (!c) continue;
                                    if (c.x === undefined || c.y === undefined) continue;
                                    pixels.push({ x: Number(c.x), y: Number(c.y), color: (c.color || c.col || c.c || '#000000') });
                                }
                            } else if (changes && typeof changes.x === 'number') {
                                pixels.push({ x: Number(changes.x), y: Number(changes.y), color: (changes.color || '#000000') });
                            }
                            if (pixels.length) {
                                // update last-modified timestamps for local pixels
                                try { const now = Date.now(); for (const p of pixels) { try { this._markPixelModified(animation, Number(index), Number(p.x), Number(p.y), now); } catch(e){} } } catch(e){}
                                if (!this._suppressOutgoing) {
                                    this._opBuffer.push({ type: 'draw', anim: animation, frame: Number(index), pixels, client: this.clientId, time: Date.now() });
                                    this._scheduleSend && this._scheduleSend();
                                }
                            }
                        } catch (e) { /* non-fatal */ }
                        return res;
                    };
                }
                // wrap setPixel convenience if present
                if (typeof sheet.setPixel === 'function') {
                    const _origSet = sheet.setPixel.bind(sheet);
                    sheet.setPixel = (animation, index, x, y, color, blendType) => {
                        try { this._recordUndoPixels(animation, index, { x, y, color, blendType }); } catch (e) { /* ignore undo capture errors */ }
                        const res = _origSet(animation, index, x, y, color, blendType);
                        try {
                            const now = Date.now(); try { this._markPixelModified(animation, Number(index), Number(x), Number(y), now); } catch(e){}
                            if (!this._suppressOutgoing) {
                                this._opBuffer.push({ type: 'draw', anim: animation, frame: Number(index), pixels: [{ x: Number(x), y: Number(y), color: (color || '#000000') }], client: this.clientId, time: now });
                                this._scheduleSend && this._scheduleSend();
                            }
                        } catch (e) { /* ignore */ }
                        return res;
                    };
                }
                // wrap structural frame/animation methods so remote peers receive metadata updates
                if (typeof sheet.insertFrame === 'function') {
                    const _origInsert = sheet.insertFrame.bind(sheet);
                    sheet.insertFrame = (animation, index) => {
                        const res = _origInsert(animation, index);
                        try {
                            // compute logical count AFTER insertion
                            const arr = sheet._frames.get(animation) || [];
                            let logical = 0; for (let i=0;i<arr.length;i++){ const e=arr[i]; if(!e) continue; if(e.__groupStart||e.__groupEnd) continue; logical++; }
                            if (this.server && !this._suppressOutgoing) {
                                const diff = {};
                                // update metadata with new logical frame count
                                diff['meta/animations/' + encodeURIComponent(animation)] = logical;
                                // also send an explicit structural op so peers know WHICH index was inserted
                                const opIndex = (typeof index === 'number' && index >= 0) ? Number(index) : Math.max(0, logical - 1);
                                const id = (Date.now()) + '_' + Math.random().toString(36).slice(2,6);
                                diff['edits/' + id] = { type: 'struct', action: 'insertFrame', anim: animation, index: opIndex, client: this.clientId, time: Date.now() };
                                try { this.server.sendDiff(diff); } catch(e){}
                            }
                        } catch(e){}
                        return res;
                    };
                }
                if (typeof sheet.popFrame === 'function') {
                    const _origPop = sheet.popFrame.bind(sheet);
                    sheet.popFrame = (animation, index) => {
                        // capture frame canvas for undo before deletion
                        let removedCanvas = null;
                        try {
                            const logicalIdx = (typeof index === 'number' && index >= 0) ? Number(index) : 0;
                            removedCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(animation, logicalIdx) : null;
                        } catch (e) { /* ignore capture errors */ }
                        // compute logical count BEFORE deletion so we can infer which index was removed when index is undefined
                        let preLogical = 0;
                        try {
                            const preArr = sheet._frames.get(animation) || [];
                            for (let i=0;i<preArr.length;i++){ const e=preArr[i]; if(!e) continue; if(e.__groupStart||e.__groupEnd) continue; preLogical++; }
                        } catch(e) {}

                        const res = _origPop(animation, index);
                        try {
                            const arr = sheet._frames.get(animation) || [];
                            let logical = 0; for (let i=0;i<arr.length;i++){ const e=arr[i]; if(!e) continue; if(e.__groupStart||e.__groupEnd) continue; logical++; }
                            if (this.server && !this._suppressOutgoing) {
                                const diff = {};
                                // update metadata with new logical frame count
                                diff['meta/animations/' + encodeURIComponent(animation)] = logical;
                                // and send a structural op describing exactly which logical index was deleted
                                let opIndex;
                                if (typeof index === 'number' && index >= 0) opIndex = Number(index);
                                else opIndex = Math.max(0, preLogical - 1); // last logical frame prior to deletion
                                const id = (Date.now()) + '_' + Math.random().toString(36).slice(2,6);
                                diff['edits/' + id] = { type: 'struct', action: 'deleteFrame', anim: animation, index: opIndex, client: this.clientId, time: Date.now() };
                                try {
                                    const dataUrl = removedCanvas && removedCanvas.toDataURL ? removedCanvas.toDataURL('image/png') : null;
                                    this._pushUndo({ type: 'delete-frame', anim: animation, index: opIndex, dataUrl, size: sheet.slicePx || 16, time: Date.now() });
                                } catch (e) { /* ignore undo capture errors */ }
                                try { this.server.sendDiff(diff); } catch(e){}
                            }
                        } catch(e){}
                        return res;
                    };
                }
                if (typeof sheet.addAnimation === 'function') {
                    const _origAddAnim = sheet.addAnimation.bind(sheet);
                    sheet.addAnimation = (name,row,frameCount) => {
                        const res = _origAddAnim(name,row,frameCount);
                        try {
                            if (this.server && !this._suppressOutgoing) {
                                const diff = {};
                                diff['meta/animations/' + encodeURIComponent(name)] = Number(frameCount) || 0;
                                try { this.server.sendDiff(diff); } catch(e){}
                            }
                        } catch(e){}
                        return res;
                    };
                }
                if (typeof sheet.removeAnimation === 'function') {
                    const _origRemoveAnim = sheet.removeAnimation.bind(sheet);
                    sheet.removeAnimation = (name) => {
                        const res = _origRemoveAnim(name);
                        try {
                            if (this.server && !this._suppressOutgoing) {
                                const diff = {};
                                // set count to 0 to indicate removal
                                diff['meta/animations/' + encodeURIComponent(name)] = 0;
                                try { this.server.sendDiff(diff); } catch(e){}
                            }
                        } catch(e){}
                        return res;
                    };
                }
            }

            // hide multiplayer menu by default if present
            try {
                const mp = document.getElementById('multiplayer-menu');
                if (mp) mp.style.display = 'none';
            } catch (e) {}

            // start periodic pruning of old edits (safe to run even if no edits known yet)
            try {
                this._pruneIntervalId = setInterval(() => { try { this._pruneOldEdits(); } catch (e) {} }, this._pruneIntervalMs || 10000);
            } catch (e) {}
            // cursor presence state
            try {
                this._cursorSendIntervalMs = 100; // send at most every 100ms
                this._cursorThrottleId = null;
                this._lastCursorPos = null;
                this._remoteCursors = new Map(); // clientId -> { x,y,time,client,name }
                this._cursorTTLms = 5000; // remove cursors older than 5s
                this._cursorCleanupId = setInterval(() => { try { this._cleanupCursors(); } catch (e) {} }, 2000);
            } catch (e) {}
        } catch (e) { console.warn('multiplayer hooks setup failed', e); }

        // Sync handshake state (initial full-sync when a collaborator joins)
        this._syncPaused = false;             // true while sync pause banner visible
        this._syncOverlay = null;             // DOM overlay shown during sync
        this._syncOverlayLabel = null;        // overlay text node
        this._lastSyncRequestId = null;       // last request id we responded to
        this._lastSyncSnapshotId = null;      // last snapshot id we applied
        this._syncApplyInFlight = null;       // promise guard for applying snapshot
        this._syncBuildInFlight = null;       // request id currently being built

        // Undo/redo stacks for pixel edits and frame deletions
        this._undoStack = [];
        this._redoStack = [];
        this._undoMax = 200;
        this._undoTimeWindowMs = 30000; // 30s window for frame delete undo validity
        this._ignoreUndoCapture = false; // skip capturing when replaying undo/redo
        this._undoMergeMs = 100; // merge consecutive pixel edits within this window
        this._bypassMirrorWrap = false; // allow tools to skip mirror wrapper when they already mirror
        
        
        this.zoom = new Vector(1,1)
        this.pan = new Vector(0,0)
        this.offset = new Vector(0,0)
        this.zoomPos = new Vector(0,0)
        this.panVlos = new Vector(0,0)
        this.zoomVlos = new Vector(0,0)
        this.selectedAnimation = 'idle'
        this.selectedFrame = 0
        // brush size: 1..4 (mapped to square sizes 1,3,5,7)
        this.brushSize = 1;
        this.penMirrorH = false;
        this.penMirrorV = false;
        const defaultAdjust = 0.05;
        // which channel to adjust with h/k: 'h'|'s'|'v'|'a'
        this.adjustChannel = 'v';
        // per-channel linear adjustment amount (0-1 for S/V/A, wrapped for H)
        this.adjustPercents = { h: defaultAdjust, s: defaultAdjust, v: defaultAdjust, a: defaultAdjust };
        this.adjustAmount = defaultAdjust;
        // palette swap variant step depth (number of +/- steps per channel)
        this.paletteStepMax = 3;
        // zoom limits and smoothing params
        this.minZoom = 0.05;
        this.maxZoom = 16;
        this.zoomSmooth = 8; // damping (larger = snappier)
        this.zoomImpulse = 12; // multiplier for wheel->velocity impulse
        this.zoomStep = -0.001; // exponential factor per wheel delta (use with Math.exp)
        // pan smoothing and impulse (wheel -> pan velocity)
        this.panSmooth = 8; // damping for panning velocity
        this.panImpulse = 1.0; // multiplier for wheel->pan velocity
        // note: use this.mouse.Wheel (vertical) and this.mouse.WheelX (horizontal) where available
        
        this.selectionPoints = [];
        this.currentTool = null;
        this._selectionKeyframeStart = null;
        this._selectionKeyframeTrack = null;
        this._selectionKeyframePrompt = null;
        this._selectionKeyframeLastFrame = null;
        this._selectionKeyframeLastAnim = null;
        this._selectionKeyframeLastAppliedFrame = null;
        this._frameKeyframeStart = null;
        this._frameKeyframePrompt = null;

        // Onion skin + layering visibility
        this.onionSkin = false;
        this.onionAlpha = 0.3;
        this.layerAlpha = 1;
        this.onionRange = { before: 1, after: 1 };

        // Pixel-perfect drawing mode (toggle with 'a'). When enabled, the pen
        // tool tracks the last few pixels in the current stroke and avoids
        // drawing "L"-shaped corners by restoring the bend pixel.
        this.pixelPerfect = false;
        this._pixelPerfectStrokeActive = false;
        this._pixelPerfectHistory = [];
        this._pixelPerfectOriginals = new Map();

        // region-based selection (for cut/copy/paste)
        this.selectionRegion = null;
        // clipboard stores { w, h, data(Uint8ClampedArray), originOffset: {ox,oy} }
        this.clipboard = null;
        // tile clipboard (render-only tilemode): { binding, transform }
        this._tileClipboard = null;
        // tile selection set (render-only tilemode)
        this._tileSelection = new Set();
        // When true, pen pastes clipboard content each frame (custom brush)
        this._clipboardBrushActive = false;
        // Latch to avoid re-triggering clipboard brush activation every frame while keys are held
        this._clipboardBrushFired = false;
        // Phase accumulator for clipboard brush preview blinking
        this._clipboardBrushBlinkPhase = 0;
        // transient flag set when a paste just occurred to avoid key-order races
        this._justPasted = false;
        this.tilemode = false;
        // tile grid configuration (columns x rows) when tilemode is enabled.
        this.tileCols = 3;
        this.tileRows = 3;
        // Infinite tile-mode support: track which tile coordinates are active.
        // Coordinates are centered on (0,0) at the middle tile; keys are "col,row".
        this._tileActive = new Set();
        this._tileCoordToIndex = new Map();
        this._tileIndexToCoord = [];
        this._seedTileActives();

        // cache of draw areas rendered this tick so input mapping can hit the correct one
        this._drawAreas = [];
        // per-area bindings: array where index -> { anim, index }
        this._areaBindings = [];
        // per-area visual transforms for previews: { rot: 0|90|180|270, flipH: bool }
        this._areaTransforms = [];

        this.FrameSelect = new FrameSelect(this,this.currentSprite,this.mouse,this.keys,this.UIDraw,1)
        // create a simple color picker input positioned to the right of the left menu (shifted 200px)
        try {
            // ensure a default pen color exists
            this.penColor = this.penColor || '#000000';
            // place near the bottom-left, just right of the 200px-wide FrameSelect menu
            const pickerPos = new Vector(208, 1040);
            const pickerSize = new Vector(40, 28);
            const colorInput = createHInput('pen-color', pickerPos, pickerSize, 'color', { borderRadius: '4px', border: '1px solid #444', padding: '2px' }, 'UI');
            colorInput.value = this.penColor || '#000000';
            colorInput.title = 'Pen color';
            colorInput.addEventListener('input', (e) => {
                try { this.penColor = e.target.value; } catch (ee) {}
            });
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

        // Register debug signal to grayscale the current frame
        try {
            if (typeof window !== 'undefined' && window.Debug && typeof window.Debug.createSignal === 'function') {
                try {
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
                } catch (e) {
                    console.warn('Failed to register Grayscale debug signal', e);
                }
                // Also register CopyColor signal in the same try so both are available
                try {
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
                } catch (e) {
                    console.warn('Failed to register CopyColor debug signal', e);
                }
                try {
                    window.Debug.createSignal('resize', (sliceSize,resizeContent=true) => {
                        try {
                            this.resize(sliceSize,resizeContent)
                            window.Debug && window.Debug.log && window.Debug.log('Resized canvas to:',sliceSize,'x',sliceSize,'px');
                        } catch (err) {
                            window.Debug && window.Debug.error && window.Debug.error('Failed to resize canvas' + err);
                        }
                    });
                } catch (e) {
                    console.warn('Failed to register CopyColor debug signal', e);
                }
                // Configure tile-mode grid size: tileArray(cols, rows).
                // Example: tileArray(5,5) -> 5x5 grid of mirrored tiles.
                try {
                    window.Debug.createSignal('tileArray', (cols = 3, rows = cols) => {
                        try {
                            const toInt = (v, def) => {
                                const n = Math.floor(Number(v));
                                return Number.isFinite(n) && n > 0 ? n : def;
                            };
                            const c = Math.max(1, toInt(cols, this.tileCols || 3));
                            const r = Math.max(1, toInt(rows, this.tileRows || 3));
                            this.tileCols = c;
                            this.tileRows = r;
                            this._seedTileActives(c, r);
                            window.Debug && window.Debug.log && window.Debug.log('Tile array size set to', c + 'x' + r);
                        } catch (err) {
                            window.Debug && window.Debug.error && window.Debug.error('tileArray signal failed: ' + err);
                        }
                    });
                } catch (e) {
                    console.warn('Failed to register tileArray debug signal', e);
                }
            }
        } catch (e) {}

        // Register SelectColor debug signal: select(hex, buffer=1)
        try {
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
                    this.selectionPoints = merged;
                    this.selectionRegion = null;
                    window.Debug && window.Debug.log && window.Debug.log(`SelectColor: selected ${matches.length} pixels matching ${hex} (tol=${tol})`);
                } catch (err) {
                    window.Debug && window.Debug.error && window.Debug.error('SelectColor failed: ' + err);
                }
            });
        } catch (e) {
            console.warn('Failed to register select debug signal', e);
        }

        // Register ReplaceColor debug signal: replace(hex1, hex2, include='frame'|'animation'|'all', buffer=1)
        try {
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
        } catch (e) {
            console.warn('Failed to register replace debug signal', e);
        }

        // Debug: draw the current pen color into all selected pixels/region
        try {
            if (typeof window !== 'undefined' && window.Debug && typeof window.Debug.createSignal === 'function') {
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

                        // If explicit point selection exists, use those points (respect areaIndex per-point)
                        if (this.selectionPoints && this.selectionPoints.length > 0) {
                            for (const p of this.selectionPoints) {
                                if (!p) continue;
                                let anim = this.selectedAnimation;
                                let frameIdx = this.selectedFrame;
                                if (p && typeof p.areaIndex === 'number') {
                                    const binding = this.getAreaBinding(p.areaIndex);
                                    if (binding && binding.anim !== undefined && binding.index !== undefined) {
                                        anim = binding.anim;
                                        frameIdx = Number(binding.index);
                                    }
                                }
                                writePixel(anim, frameIdx, p.x, p.y);
                            }
                        } else if (this.selectionRegion) {
                            // region selection: paint every pixel inside the region
                            const sr = this.selectionRegion;
                            const minX = Math.min(sr.start.x, sr.end.x);
                            const minY = Math.min(sr.start.y, sr.end.y);
                            const maxX = Math.max(sr.start.x, sr.end.x);
                            const maxY = Math.max(sr.start.y, sr.end.y);
                            // prefer region's areaIndex if present
                            let anim = this.selectedAnimation;
                            let frameIdx = this.selectedFrame;
                            if (sr && typeof sr.areaIndex === 'number') {
                                const binding = this.getAreaBinding(sr.areaIndex);
                                if (binding && binding.anim !== undefined && binding.index !== undefined) {
                                    anim = binding.anim;
                                    frameIdx = Number(binding.index);
                                }
                            }
                            for (let yy = minY; yy <= maxY; yy++) {
                                for (let xx = minX; xx <= maxX; xx++) {
                                    writePixel(anim, frameIdx, xx, yy);
                                }
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
            }
        } catch (e) { console.warn('Failed to register drawSelected debug signal', e); }

        // Debug: procedural textures on the current frame.
        // texture(type, ...args)
        // 1) texture("pointLight", centerX, centerY, gradStart, gradEnd, lerpCenter)
        // 2) texture("points", count, color, seed=1)
        // 3) texture("linear", gradStart, gradEnd, lerpCenter, angleDeg)
        try {
            if (typeof window !== 'undefined' && window.Debug && typeof window.Debug.createSignal === 'function') {
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
            }
        } catch (e) { console.warn('Failed to register texture debug signal', e); }

        // Register debug signals for onion-skin control: layerAlpha(alpha), toggleOnion()
        try {
            if (typeof window !== 'undefined' && window.Debug && typeof window.Debug.createSignal === 'function') {
                window.Debug.createSignal('layerAlpha', (alpha) => {
                    try {
                        const a = Number(alpha);
                        if (Number.isFinite(a)) {
                            this.onionAlpha = Math.max(0, Math.min(1, a));
                            console.log('onionAlpha set to', this.onionAlpha);
                            return this.onionAlpha;
                        }
                    } catch (e) { /* ignore */ }
                    return null;
                });

                window.Debug.createSignal('toggleOnion', () => {
                    try {
                        this.onionSkin = !(typeof this.onionSkin === 'boolean' ? this.onionSkin : true);
                        console.log('onionSkin toggled to', this.onionSkin);
                        return this.onionSkin;
                    } catch (e) { /* ignore */ }
                    return null;
                });
            }
        } catch (e) { console.warn('Failed to register onion debug signals', e); }

        // Debug: show multiplayer menu (hidden by default). Call via Debug signal to unhide.
        try {
            if (typeof window !== 'undefined' && window.Debug && typeof window.Debug.createSignal === 'function') {
                try {
                    window.Debug.createSignal('enableColab', () => {
                        try {
                            const el = document.getElementById('multiplayer-menu');
                            if (el) {
                                el.style.display = 'flex';
                                try { if (this.server && typeof this.server.unpause === 'function') this.server.unpause(); } catch (e) {}
                                return true;
                            }
                        } catch (e) {}
                        return false;
                    });
                } catch (e) { console.warn('Failed to register showMultiplayerMenu debug signal', e); }
            }
        } catch (e) { /* ignore debug registration errors */ }

        // Debug: set player name (persisted) and send/receive simple chat messages
        try {
            if (typeof window !== 'undefined' && window.Debug && typeof window.Debug.createSignal === 'function') {
                try {
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
                } catch (e) { console.warn('Failed to register name debug signal', e); }

                try {
                    window.Debug.createSignal('msg', (text) => {
                        try {
                            if (!text) return false;
                            const body = String(text);
                            const from = this.playerName || this.clientId || 'anon';
                            const payload = { from, text: body, time: Date.now(), client: this.clientId };
                            const id = (payload.time || Date.now()) + '_' + Math.random().toString(36).slice(2,6);
                            // send via server if available
                            try {
                                if (this.server && typeof this.server.sendDiff === 'function') {
                                    const diff = {};
                                    diff['messages/' + id] = payload;
                                    this.server.sendDiff(diff);
                                }
                            } catch (e) {}
                            // also locally log/display
                            try { console.log('[msg] ' + from + ': ' + body); } catch (e) {}
                            try { if (window.Debug && window.Debug.log) window.Debug.log('[msg] ' + from + ': ' + body); } catch (e) {}
                            return true;
                        } catch (e) { return false; }
                    });
                } catch (e) { console.warn('Failed to register msg debug signal', e); }
            }
        } catch (e) { /* ignore debug registration errors */ }

        // Autosave defaults
        this._autosaveEnabled = true;
        this._autosaveIntervalSeconds = 5;
        this._autosaveIntervalId = null;

        

        // Start autosave timer if enabled
        try {
            if (this._autosaveEnabled) {
                this._autosaveIntervalId = setInterval(() => {
                    try { this.doSave(); } catch (e) { /* ignore autosave errors */ }
                }, (this._autosaveIntervalSeconds || 60) * 1000);
            }
        } catch (e) {}

        // Attempt to load previously-saved sprite frames/metdata (async). We call
        // saver.load() to make sure savedata is fresh, then restore per-frame images
        // if present under `sprites/<name>/frames/...`.
        try {
            if (this.saver && typeof this.saver.load === 'function') {
                try { this.saver.load(); } catch (e) {}
            }
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
                            this.tileCols = Math.max(1, cols);
                            this.tileRows = Math.max(1, rows);
                            this.tilemode = !!layout.tilemode;
                            if (!Array.isArray(this._areaBindings)) this._areaBindings = [];
                            if (!Array.isArray(this._areaTransforms)) this._areaTransforms = [];
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
                            if (Array.isArray(layout.bindings)) {
                                for (const b of layout.bindings) {
                                    if (!b) continue;
                                    let idx = null;
                                    if (Number.isFinite(b.col) && Number.isFinite(b.row)) {
                                        idx = this._getAreaIndexForCoord(Number(b.col), Number(b.row));
                                        this._activateTile(Number(b.col), Number(b.row));
                                    } else {
                                        const i = Number(b.areaIndex);
                                        if (!Number.isFinite(i) || i < 0) continue;
                                        const legacy = this._coordFromLegacyIndex(i, this.tileCols, this.tileRows);
                                        idx = this._getAreaIndexForCoord(legacy.col, legacy.row);
                                        this._activateTile(legacy.col, legacy.row);
                                    }
                                    if (!Number.isFinite(idx)) continue;
                                    const mf = Array.isArray(b.multiFrames) ? b.multiFrames.filter(v => Number.isFinite(v)).map(v => Number(v)) : null;
                                    this._areaBindings[idx] = { anim: b.anim, index: Number(b.index), multiFrames: (mf && mf.length > 0) ? mf : null };
                                }
                            }
                            if (Array.isArray(layout.transforms)) {
                                for (const t of layout.transforms) {
                                    if (!t) continue;
                                    let idx = null;
                                    if (Number.isFinite(t.col) && Number.isFinite(t.row)) {
                                        idx = this._getAreaIndexForCoord(Number(t.col), Number(t.row));
                                        this._activateTile(Number(t.col), Number(t.row));
                                    } else {
                                        const i = Number(t.areaIndex);
                                        if (!Number.isFinite(i) || i < 0) continue;
                                        idx = i;
                                    }
                                    if (!Number.isFinite(idx)) continue;
                                    this._areaTransforms[idx] = { rot: (t.rot || 0), flipH: !!t.flipH };
                                }
                            }
                        }
                    } catch (e) { /* ignore tile layout restore errors */ }

                    // Reconstruct frames from saved per-frame images
                    if (!this.currentSprite || !this.currentSprite._frames) return;
                    const animNames = Object.keys(meta.animations || {});
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
                    }
                    // If nothing pending, still rebuild so packed sheet picks up metadata
                    if (pending === 0) {
                        try { this.currentSprite._rebuildSheetCanvas(); } catch (e) {}
                    }
                } catch (e) { /* ignore load errors */ }
            })();
        } catch (e) {}

        // Register debug signals for save/clear/autosave control
        try {
            if (typeof window !== 'undefined' && window.Debug && typeof window.Debug.createSignal === 'function') {
                // save([name]) -> explicitly save current sheet and metadata
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
                        if (typeof seconds === 'number' && seconds > 0) this._autosaveIntervalSeconds = Math.max(1, Math.floor(seconds));
                        if (this._autosaveIntervalId) { try { clearInterval(this._autosaveIntervalId); } catch (e) {} this._autosaveIntervalId = null; }
                        if (this._autosaveEnabled) {
                            this._autosaveIntervalId = setInterval(() => { try { this.doSave(); } catch (e) {} }, (this._autosaveIntervalSeconds || 60) * 1000);
                        }
                    } catch (e) { console.warn('debug autosave failed', e); }
                });
            }
        } catch (e) { /* ignore debug registration errors */ }

        this.isReady = true;
    }
    // When switching away from this scene, dispose any UI-created DOM elements
    // and free large resources so GC can reclaim them.
    onSwitchFrom(resources){
        try {
            if (this.FrameSelect && typeof this.FrameSelect.dispose === 'function') {
                try { this.FrameSelect.dispose(); } catch(e){}
            }
        } catch (e) { console.warn('spriteScene.onSwitchFrom cleanup failed', e); }
        // clear autosave timer if present
        try { if (this._autosaveIntervalId) { try { clearInterval(this._autosaveIntervalId); } catch (e) {} this._autosaveIntervalId = null; } } catch (e) {}
        // clear any pending multiplayer send timer
        try { if (this._sendScheduledId) { try { clearTimeout(this._sendScheduledId); } catch (e) {} this._sendScheduledId = null; } } catch (e) {}
        // clear cursor send/cleanup timers
        try { if (this._cursorThrottleId) { try { clearTimeout(this._cursorThrottleId); } catch (e) {} this._cursorThrottleId = null; } } catch (e) {}
        try { if (this._cursorCleanupId) { try { clearInterval(this._cursorCleanupId); } catch (e) {} this._cursorCleanupId = null; } } catch (e) {}
        // remove our cursor entry from server state if possible
        try { if (this.server && typeof this.server.sendDiff === 'function') { const d = {}; d['cursors/' + this.clientId] = null; try { this.server.sendDiff(d); } catch (e) {} } } catch (e) {}
        // clear pruning interval if present
        try { if (this._pruneIntervalId) { try { clearInterval(this._pruneIntervalId); } catch (e) {} this._pruneIntervalId = null; } } catch (e) {}
        // mark not ready so switching back will re-run onReady
        this.isReady = false;
        // call parent behaviour
        if (super.onSwitchFrom) try { super.onSwitchFrom(resources); } catch(e){}
        
        // remove sync overlay if present
        try { if (this._syncOverlay && this._syncOverlay.parentNode) this._syncOverlay.remove(); } catch (e) {}
        this._syncOverlay = null; this._syncOverlayLabel = null;
        this._colorInput = null; this._colorLabel = null;
    }

    // When switching to this scene, ensure it is initialized. If we were
    // previously disposed (isReady === false), re-run onReady() to recreate
    // UI and resources. This allows loadScene('spriteScene') followed by
    // switchScene('spriteScene') to re-initialize cleanly.
    onSwitchTo(resources){
        // call parent behaviour first (reconnect any RSS etc.)
        if (super.onSwitchTo) {
            try { super.onSwitchTo(resources); } catch(e) { console.warn('spriteScene.onSwitchTo super failed', e); }
        }
        try {
            if (!this.isReady) {
                try { this.onReady(); } catch(e){ console.warn('spriteScene.onSwitchTo onReady failed', e); }
            } else {
                // if frame select was disposed, recreate it
                if (!this.FrameSelect) {
                    try { this.FrameSelect = new FrameSelect(this,this.currentSprite,this.mouse,this.keys,this.UIDraw,1); } catch(e) { console.warn('recreate FrameSelect failed', e); }
                }
            }
        } catch (e) { console.warn('spriteScene.onSwitchTo failed', e); }
        // remove color picker input/label added in onReady to avoid leaving DOM/listeners behind
        try {
            if (this._colorInput && this._colorInput.parentNode) { try { this._colorInput.remove(); } catch(e){} }
            if (this._colorLabel && this._colorLabel.parentNode) { try { this._colorLabel.remove(); } catch(e){} }
        } catch (e) {}
        try {
            const pen = document.getElementById('pen-color'); if (pen && pen.parentNode) try { pen.remove(); } catch(e){}
        } catch (e) {}
        try {
            const impBtn = document.getElementById('import-spritesheet-btn'); if (impBtn && impBtn.parentNode) try { impBtn.remove(); } catch(e){}
        } catch (e) {}
        try {
            const expBtn = document.getElementById('export-spritesheet-btn'); if (expBtn && expBtn.parentNode) try { expBtn.remove(); } catch(e){}
        } catch (e) {}
        try {
            const impInput = document.getElementById('import-spritesheet-input'); if (impInput && impInput.parentNode) try { impInput.remove(); } catch(e){}
        } catch (e) {}
        return this.packResources ? this.packResources() : null;
    }
    
    // Handle wheel-based panning. Reads horizontal/vertical wheel deltas from
    // this.mouse.Wheel and this.mouse.WheelX (with fallbacks) and converts them
    // into pan velocity impulses. If ctrl+wheel was used for zooming we skip
    // panning (zoomScreen handles ctrl+wheel separately).
    panScreen(tickDelta){
        if (this.keys.held('Control')) return; // prefer zoom when ctrl is pressed
        // Read wheel deltas (robustly handle multiple mouse APIs)
        let wheelY = 0, wheelX = 0;
        wheelY = this.mouse.wheel();
        wheelX = this.mouse.wheelX();
        
        // Convert wheel deltas to pan velocity impulses. We divide by zoom so
        // panning speed feels consistent at different zoom levels.
        // When Shift is held, interpret vertical wheel (wheelY) as horizontal
        // scrolling (common UX: Shift + scroll -> horizontal pan).
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
        const impulseX = -horiz * (this.panImpulse) * (1 / zX);
        const impulseY = -vert * (this.panImpulse) * (1 / zY);
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
            if (typeof this._activeDrawAreaIndex === 'number' && Array.isArray(this._drawAreas)) {
                const direct = this._drawAreas[this._activeDrawAreaIndex];
                if (direct) area = direct;
                if (!area) {
                    for (const a of this._drawAreas) {
                        if (a && typeof a.areaIndex === 'number' && a.areaIndex === this._activeDrawAreaIndex) { area = a; break; }
                    }
                }
            }
            if (!area) area = this.computeDrawArea();
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

    // tick handler: called by Scene.tick() via sceneTick
    sceneTick(tickDelta){
        this.mouse.update(tickDelta)
        this.keys.update(tickDelta)
        this._clipboardBrushBlinkPhase = (this._clipboardBrushBlinkPhase || 0) + tickDelta;
        this.mouse.setMask(0)
        this.FrameSelect.update()
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
        // handle numeric keys to change brush size (1..5). If multiple number keys are pressed simultaneously,
        // sum them for larger brushes (e.g., 2+3 => size 5, 1+2+3+4+5 => size 15). Max capped at 15.
        // Holding Shift while pressing number keys captures the current selection into the clipboard and
        // enables "clipboard brush" mode (pen pastes the selection each frame). Pressing numbers without
        // Shift disables clipboard brush and sets a numeric brush size.
        try {
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
                    let total = 0;
                    for (const k of numKeys) {
                        if (this.keys.pressed(k) || this.keys.held(k)) total += numKeyMap[k] || 0;
                    }
                    this.brushSize = Math.max(1, Math.min(15, total || 1));
                    this._clipboardBrushActive = false;
                }

                // Reset latch when Shift is not held to allow future activations
                if (!this.keys.held('Shift')) this._clipboardBrushFired = false;

                // choose which channel to adjust with h/k: 6->H, 7->S, 8->V, 9->A
                const setAdjustChannel = (ch) => {
                    this.adjustChannel = ch;
                    this.adjustAmount = this._getAdjustPercent(ch);
                };
                if (this.keys.released('6')) setAdjustChannel('h');
                if (this.keys.released('7')) setAdjustChannel('s');
                if (this.keys.released('8')) setAdjustChannel('v');
                if (this.keys.released('9')) setAdjustChannel('a');

                // Arrow left/right step selected frame within the current animation.
                const framesArr = (this.currentSprite && this.currentSprite._frames && this.selectedAnimation)
                    ? (this.currentSprite._frames.get(this.selectedAnimation) || [])
                    : [];
                const frameCount = Array.isArray(framesArr) ? framesArr.length : 0;
                if (frameCount > 0) {
                    const wrap = (v) => (v % frameCount + frameCount) % frameCount;
                    if (this.keys.released('ArrowLeft')) {
                        this.selectedFrame = wrap((this.selectedFrame || 0) - 1);
                        if (this.FrameSelect && this.FrameSelect._multiSelected) this.FrameSelect._multiSelected.clear();
                    }
                    if (this.keys.released('ArrowRight')) {
                        this.selectedFrame = wrap((this.selectedFrame || 0) + 1);
                        if (this.FrameSelect && this.FrameSelect._multiSelected) this.FrameSelect._multiSelected.clear();
                    }
                }

                // +/- adjust the per-channel adjustment percent (Shift = 0.1% steps, else 1%)
                const activeChannel = this.adjustChannel || 'v';
                const incPressed = this.keys.released('+') || this.keys.released('=');
                const decPressed = this.keys.released('-') || this.keys.released('_');
                if (incPressed || decPressed) {
                    const step = this.keys.held('Shift') ? 0.001 : 0.01;
                    const current = this._getAdjustPercent(activeChannel);
                    const next = incPressed ? current + step : current - step;
                    this._setAdjustPercent(activeChannel, next);
                    this.adjustAmount = this._getAdjustPercent(activeChannel);
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
                                this.onionRange = { before: newBefore, after: newAfter };
                                try { console.log('Onion range set to', this.onionRange); } catch (e) {}
                            }
                        } catch (e) { /* ignore prompt failures */ }
                        return;
                    }
                    if (!shiftHeld) {
                        this.onionSkin = !(typeof this.onionSkin === 'boolean' ? this.onionSkin : false);
                        try { console.log('Onion skin:', this.onionSkin); } catch (e) {}
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
                                    if (multiActive) this.layerAlpha = clamped;
                                    else this.onionAlpha = clamped;
                                }
                            }
                        } catch (e) { /* ignore prompt failures */ }
                    }
                }

                // Toggle pixel-perfect drawing mode with 'a'. When enabled,
                // the pen tool performs corner-cutting to avoid "L" shapes.
                if (this.keys.released('a') || this.keys.released('A')) {
                    this.pixelPerfect = !this.pixelPerfect;
                    try { console.log('Pixel-perfect mode:', this.pixelPerfect); } catch (e) {}
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
                                this.paletteStepMax = clamped || 0;
                            }
                        } catch (e) { /* ignore prompt errors */ }
                    } else {
                        try { this._promptPaletteSwap(); } catch (e) { console.warn('palette swap failed', e); }
                    }
                }
                if (this.keys.comboPressed(['s','Alt'])) {
                    console.log('emmiting')
                    window.Debug.emit('drawSelected');
                } else if ((this.keys.pressed('s')||this.keys.pressed('S')) && !this.keys.held('Alt')) {
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
        } catch (e) { /* ignore */ }

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
                this.tilemode = !this.tilemode;
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
                            this.tileRows = Math.max(1, rows);
                            this.tileCols = Math.max(1, cols);
                            this.tilemode = true;
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

                // Toggle tile activation under cursor when in tilemode (infinite grid). Space adds/removes tiles.
                try {
                    if (this.tilemode && this.keys && typeof this.keys.released === 'function' && (this.keys.released(' ') || this.keys.released('Space') || this.keys.released('Spacebar'))) {
                        const slashHeld = (this.keys.held && (this.keys.held('/') || this.keys.held('?')));
                        const shiftHeld = this.keys.held && this.keys.held('Shift');
                        const mirrorChord = slashHeld || shiftHeld;
                        const pos = this.getPos(this.mouse && this.mouse.pos);
                        if (pos && pos.tileCol !== null && pos.tileRow !== null) {
                            const areaIdx = (typeof pos.areaIndex === 'number') ? pos.areaIndex : this._getAreaIndexForCoord(pos.tileCol, pos.tileRow);
                            if (mirrorChord) {
                                // Space + hold '/' -> ensure tile active, add mirrored frame, bind tile to it.
                                this._activateTile(pos.tileCol, pos.tileRow);
                                const sheet = this.currentSprite;
                                const anim = this.selectedAnimation;
                                const srcFrame = this.selectedFrame;
                                if (sheet && anim !== undefined && anim !== null && Number.isFinite(srcFrame)) {
                                    const insertAt = Math.max(0, Math.floor(srcFrame) + 1);
                                    try { if (typeof sheet.insertFrame === 'function') sheet.insertFrame(anim, insertAt); } catch (e) { /* ignore insert errors */ }
                                    try {
                                        const src = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, srcFrame) : null;
                                        const dst = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, insertAt) : null;
                                        if (src && dst && src.width && src.height && dst.getContext) {
                                            const dctx = dst.getContext('2d');
                                            try { dctx.clearRect(0, 0, dst.width, dst.height); } catch (e) {}
                                            try { dctx.imageSmoothingEnabled = false; } catch (e) {}
                                            dctx.save();
                                            dctx.translate(dst.width, 0);
                                            dctx.scale(-1, 1);
                                            dctx.drawImage(src, 0, 0);
                                            dctx.restore();
                                        }
                                        if (typeof sheet._rebuildSheetCanvas === 'function') try { sheet._rebuildSheetCanvas(); } catch (e) {}
                                        if (!Array.isArray(this._areaBindings)) this._areaBindings = [];
                                        this._areaBindings[areaIdx] = { anim, index: insertAt };
                                        this.selectedFrame = insertAt;
                                    } catch (e) { /* ignore mirror copy errors */ }
                                }
                            } else {
                                if (pos.tileActive) this._deactivateTile(pos.tileCol, pos.tileRow);
                                else this._activateTile(pos.tileCol, pos.tileRow);
                            }
                        }
                    }
                } catch (e) { console.warn('tile activation toggle failed', e); }

                    // Rotate / Flip preview and commit handlers for area under mouse
                    try {
                        const posForTransform = this.getPos(this.mouse && this.mouse.pos);
                        if (this.tilemode) {
                            const ai = posForTransform.areaIndex;
                            // Rotate: plain 'r' = preview rotate 90deg CW, Shift+'r' = commit rotate to frame data
                            if ((this.keys.pressed('R')||this.keys.pressed('r'))) {
                                if (this.keys.held('Shift')) {
                                    try { this.applyAreaRotateData(ai); } catch (e) { /* ignore */ }
                                } else {
                                    try { this.toggleAreaPreviewRotate(ai); } catch (e) { /* ignore */ }
                                }
                            }
                            // Flip: Alt+f toggles preview flip, Alt+Shift+f applies flip to frame data
                            if ((this.keys.pressed('F')||this.keys.pressed('f')) && this.keys.held('Alt')) {
                                if (this.keys.held('Shift')) {
                                    try { this.applyAreaFlipData(ai); } catch (e) { /* ignore */ }
                                } else {
                                    try { this.toggleAreaPreviewFlip(ai); } catch (e) { /* ignore */ }
                                }
                            }
                        }
                    } catch (e) { /* ignore transform key errors */ }

                // Toggle pen mirroring: '[' horizontal, ']' vertical
                try {
                    if (this.keys && typeof this.keys.pressed === 'function') {
                        if (this.keys.pressed('[')) {
                            this.penMirrorH = !this.penMirrorH;
                            this._pixelPerfectStrokeActive = false;
                            this._applyInitialMirror('h');
                        }
                        if (this.keys.pressed(']')) {
                            this.penMirrorV = !this.penMirrorV;
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
        } catch (e) {
            console.warn('sceneTick failed', e);
        }

        
    }

    // Simple pen tool: paint a single pixel into the current frame while left mouse is held.
    // Returns early if left button isn't held.
    penTool() {
        try {
            if (!this.mouse || !this.currentSprite) return;
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
                    this.doPaste(this.mouse.pos);
                    return;
                }
                if (this.mouse.held('right')) {
                    this.doClipboardErase(this.mouse.pos);
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

            const worldPixelsFromBrush = (sx, sy) => {
                const pixels = [];
                const pushWorld = (lx, ly) => {
                    // In tilemode, allow brush footprints to spill across tiles; in single-frame mode, drop out-of-bounds.
                    if (!this.tilemode && frameW !== null && frameH !== null) {
                        if (lx < 0 || ly < 0 || lx >= frameW || ly >= frameH) return;
                    }
                    if (this.isPixelMasked(lx, ly, areaIndexForPos)) return;
                    const wx = baseCol * slice + lx;
                    const wy = baseRow * slice + ly;
                    pixels.push({ x: wx, y: wy });
                };
                const addMirrored = (lx, ly) => {
                    const coords = [];
                    coords.push({ x: lx, y: ly });
                    if (mirrorH && frameW !== null) coords.push({ x: frameW - 1 - lx, y: ly });
                    if (mirrorV && frameH !== null) coords.push({ x: lx, y: frameH - 1 - ly });
                    if (mirrorH && mirrorV && frameW !== null && frameH !== null) coords.push({ x: frameW - 1 - lx, y: frameH - 1 - ly });
                    const seen = new Set();
                    for (const c of coords) {
                        const key = c.x + ',' + c.y;
                        if (seen.has(key)) continue;
                        seen.add(key);
                        pushWorld(c.x, c.y);
                    }
                };
                for (let yy = 0; yy < side; yy++) {
                    for (let xx = 0; xx < side; xx++) {
                        addMirrored(sx + xx, sy + yy);
                    }
                }
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
                const worldPixels = worldPixelsFromBrush(sx, sy);
                this._paintWorldPixels(worldPixels, color);
            }
            if (this.mouse.held('right')) { // erase NxN square
                const eraseColor = '#00000000';
                const sx = pos.x - half;
                const sy = pos.y - half;
                const worldPixels = worldPixelsFromBrush(sx, sy);
                this._paintWorldPixels(worldPixels, eraseColor);
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
            const tiles = this._tileBrushTiles(center.col, center.row, side);
            if (!tiles.length) return;

            // Build the frame stack so tile painting mirrors the 'y' bind behavior (multi-select aware).
            const buildStack = () => {
                const frames = [];
                const pushFrame = (v) => {
                    if (!Number.isFinite(v)) return;
                    const n = Number(v);
                    if (!frames.includes(n)) frames.push(n);
                };
                try { pushFrame(this.selectedFrame); } catch (e) {}
                try {
                    const fs = this.FrameSelect;
                    if (fs && fs._multiSelected && fs._multiSelected.size > 0) {
                        const arr = Array.from(fs._multiSelected).filter(i => Number.isFinite(i)).map(Number).sort((a,b)=>a-b);
                        for (const i of arr) pushFrame(i);
                    }
                } catch (e) { /* ignore multi-select gather errors */ }
                const deduped = Array.from(new Set(frames)).sort((a,b)=>a-b);
                return (deduped.length > 1) ? deduped : [];
            };

            const stack = buildStack();

            // Binding to apply comes from tile eyedrop (if any) or current selection
            const baseBinding = this._tileBrushBinding || { anim: this.selectedAnimation, index: this.selectedFrame };
            const baseTransform = this._tileBrushTransform ? { ...this._tileBrushTransform } : null;

            if (this.mouse.held('left')) {
                if (!Array.isArray(this._areaBindings)) this._areaBindings = [];
                for (const t of tiles) {
                    const idx = (typeof t.areaIndex === 'number') ? t.areaIndex : this._getAreaIndexForCoord(t.col, t.row);
                    if (idx === null || idx === undefined) continue;
                    this._activateTile(t.col, t.row);
                    const entry = { ...baseBinding };
                    if (stack.length > 0) entry.multiFrames = stack;
                    this._areaBindings[idx] = entry;
                    if (!this._areaTransforms) this._areaTransforms = [];
                    this._areaTransforms[idx] = baseTransform ? { ...baseTransform } : this._areaTransforms[idx];
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
                        try { this._deactivateTile(t.col, t.row); } catch (e) { /* ignore */ }
                        if (Array.isArray(this._areaBindings)) this._areaBindings[idx] = null;
                        if (Array.isArray(this._areaTransforms)) this._areaTransforms[idx] = null;
                    }
                }
            }
        } catch (e) {
            console.warn('render-only tile paint failed', e);
        }
    }

    // Compute tile footprint for a brush centered at (col,row) covering `side` tiles per edge.
    _tileBrushTiles(centerCol, centerRow, side) {
        const tiles = [];
        const n = Math.max(1, Math.min(1000, Number(side) || 1));
        const start = -Math.floor(n / 2);
        for (let ddy = 0; ddy < n; ddy++) {
            const dy = start + ddy;
            for (let ddx = 0; ddx < n; ddx++) {
                const dx = start + ddx;
                const col = centerCol + dx;
                const row = centerRow + dy;
                const areaIndex = (typeof this._getAreaIndexForCoord === 'function') ? this._getAreaIndexForCoord(col, row) : null;
                tiles.push({ col, row, areaIndex });
            }
        }
        return tiles;
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
            const anim = (areaBinding && areaBinding.anim) ? areaBinding.anim : this.selectedAnimation;
            const frameIdx = (areaBinding && typeof areaBinding.index === 'number') ? areaBinding.index : this.selectedFrame;

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

    _getAdjustPercent(channel) {
        const table = this.adjustPercents || {};
        const fallback = (typeof this.adjustAmount === 'number') ? this.adjustAmount : 0.05;
        const key = channel || this.adjustChannel || 'v';
        const val = table[key];
        return (typeof val === 'number' && Number.isFinite(val)) ? val : fallback;
    }

    _setAdjustPercent(channel, value) {
        const key = channel || this.adjustChannel || 'v';
        const num = Number(value);
        if (!Number.isFinite(num)) return;
        const clamped = Math.max(0, Math.min(1, num));
        if (!this.adjustPercents) this.adjustPercents = {};
        this.adjustPercents[key] = clamped;
        if (key === (this.adjustChannel || 'v')) {
            this.adjustAmount = clamped;
        }
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
            if (renderOnlyTile && pos && pos.tileCol !== undefined && pos.tileRow !== undefined) {
                this._tileHoverAnchor = { col: pos.tileCol, row: pos.tileRow };
            }

            // Right click (without Shift) clears existing selection(s); when none, allow erase to proceed.
            if (this.mouse.pressed('right') && !this.keys.held('Shift')) {
                const hadPixelSelection = (this.selectionPoints && this.selectionPoints.length) || this.selectionRegion;
                const hadTileSelection = renderOnlyTile && this._tileSelection && this._tileSelection.size > 0;
                if (hadPixelSelection || hadTileSelection) {
                    this.selectionPoints = [];
                    this.currentTool = null;
                    this.selectionRegion = null;
                    if (hadTileSelection) this._tileSelection.clear();
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

            // Keyframing: Shift+I for selection, I for frame (uses selection mask if present)
            if ((this.keys.released('i') || this.keys.released('I')) && !this.keys.held('Alt')) {
                if (this.keys.held('Shift')) this._handleSelectionKeyframeTap();
                else this._handleFrameKeyframeTap();
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
                                this.selectedAnimation = binding.anim;
                                this.selectedFrame = Number(binding.index);
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
                                this.penColor = this._eyedropperOriginalColor;
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
                            // Prefer the frame bound to the area under the mouse. Fall back to selected frame.
                            let anim = this.selectedAnimation;
                            let frameIdx = this.selectedFrame;
                            if (typeof posPrev.areaIndex === 'number') {
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
                                    this.penColor = hex8;
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
                        if (typeof posMid.areaIndex === 'number') {
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
                                this.penColor = hex8;
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
            // respecting brush size).
            if (this.keys.held('Shift')) {
                if (renderOnlyTile) {
                    // Tile selection in render-only tilemode
                    const tileBrush = this._tileBrushTiles(pos.tileCol ?? 0, pos.tileRow ?? 0, this.brushSize || 1);
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
                                    this.selectionRegion = null;
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
            if (this.selectionPoints.length >= 2 && polyKey) {
                if (this.keys.held('Shift')) this._selectPolygonFromSelection();
                else this._commitPolygonFromSelection();
            }

            // Grow / Shrink selection: ';' to grow, '\'' to shrink (released)
            try {
                if (this.keys.released(';')) {
                    try { this._growSelection(); } catch (e) { /* ignore */ }
                }
                if (this.keys.released("'")) {
                    try { this._shrinkSelection(); } catch (e) { /* ignore */ }
                }
            } catch (e) { /* ignore grow/shrink key errors */ }

            // set tool keys when we have a primary anchor point.
            // Circles support an "even-centered" mode when 4 pixels are selected
            // and brushSize === 2 (treated as a 2x2 center block).
            const hasSingleAnchor = (this.selectionPoints.length === 1);
            const hasEvenCenterAnchor = (this.selectionPoints.length === 4 && this.brushSize === 2);
            // Tile-mode: use tile selection set instead of pixel selectionPoints
            const tileHasSingle = (this.tilemode && this._tileSelection && this._tileSelection.size === 1);
            if (hasSingleAnchor || hasEvenCenterAnchor || tileHasSingle) {
                if (hasSingleAnchor && this.keys.pressed('l')) {
                    this.currentTool = 'line';
                }
                if (hasSingleAnchor && this.keys.pressed('b')) {
                    this.currentTool = 'box';
                }
                if (this.keys.pressed('o')) {
                    this.currentTool = 'circle';
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
                    const anchor = this.selectionPoints[0];
                    const anchorArea = (anchor && typeof anchor.areaIndex === 'number') ? anchor.areaIndex : null;
                    let target = null;
                    if (pos && pos.inside && (!this.tilemode || anchorArea === null || pos.areaIndex === anchorArea)) {
                        target = { x: pos.x, y: pos.y, areaIndex: pos.areaIndex };
                    } else if (anchor) {
                        target = this._unclampedPixelForArea(anchorArea, this.mouse.pos);
                    }
                    if (target) {
                        const start = this.selectionPoints[0];
                        const end = { x: target.x, y: target.y };
                        this.commitSelection(start, end);
                        try { if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause(0.1); } catch (e) {}
                        this.currentTool = null;
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
                                if (!Array.isArray(this._areaBindings)) this._areaBindings = [];
                                if (!Array.isArray(this._areaTransforms)) this._areaTransforms = [];
                                for (const t of applyTiles) {
                                    const idx = this._getAreaIndexForCoord(t.col, t.row);
                                    this._activateTile(t.col, t.row);
                                    this._areaBindings[idx] = binding ? { ...binding } : null;
                                    this._areaTransforms[idx] = transform ? { ...transform } : this._areaTransforms[idx];
                                }
                            }
                        }
                        this.currentToolTile = null;
                        try { if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause(0.1); } catch (e) {}
                    }
                }
            }

            // While a shape tool (line/box/circle) is active, Shift+Left click adds
            // individual selection points along the shape instead of drawing.
            // The last added point becomes the new starting point for chaining.
            if (this.currentTool && this.keys.held('Shift') && this.mouse.pressed('left') && this.selectionPoints && this.selectionPoints.length > 0) {
                const pos = this.getPos(this.mouse.pos);
                if (pos && pos.inside) {
                    const start = this.selectionPoints[this.selectionPoints.length - 1];
                    const end = { x: pos.x, y: pos.y };
                    const filled = this.keys.held('Alt');
                    let pixels = [];
                    if (this.currentTool === 'line' && typeof this.computeLinePixels === 'function') {
                        pixels = this.computeLinePixels(start, end) || [];
                    } else if (this.currentTool === 'box' && typeof this.computeBoxPixels === 'function') {
                        pixels = this.computeBoxPixels(start, end, filled) || [];
                    } else if (this.currentTool === 'circle' && typeof this.computeCirclePixels === 'function') {
                        pixels = this.computeCirclePixels(start, end, filled) || [];
                    }

                    if (pixels && pixels.length) {
                        const areaIndex = (typeof start.areaIndex === 'number') ? start.areaIndex : (typeof pos.areaIndex === 'number' ? pos.areaIndex : null);
                        for (const p of pixels) {
                            const exists = this.selectionPoints.some(sp => sp.x === p.x && sp.y === p.y && sp.areaIndex === areaIndex);
                            if (!exists) {
                                this.selectionPoints.push({ x: p.x, y: p.y, areaIndex });
                            }
                        }
                        // Ensure the end point is the last element so it becomes the next start.
                        const endExists = this.selectionPoints.some(sp => sp.x === end.x && sp.y === end.y && sp.areaIndex === areaIndex);
                        if (!endExists) {
                            this.selectionPoints.push({ x: end.x, y: end.y, areaIndex });
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

                    this.selectionPoints = merged;

                    // Clear any previous rectangular region state so all tools
                    // operate purely on pixel selections.
                    this.selectionRegion = null;
                    this.currentTool = null;
                }
            }

            // Tile-mode: if exactly two tiles are selected and user presses 'b',
            // expand selection to include the full tile rectangle between them (inclusive).
            try {
                if (this.tilemode && this._tileSelection && this._tileSelection.size === 2 && this.keys.pressed('b')) {
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
                                        applyPaste();
                                        return;
                                    } catch (e) { /* ignore */ }
                                } else {
                                    // Points or already-structured image payload (dense numeric array) may be large; trust JSON
                                    this.clipboard = obj;
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
                }
                const posForClipboard = this.getPos(this.mouse && this.mouse.pos);
                const allowTileClipboard = !!(this.tilemode && ((posForClipboard && posForClipboard.renderOnly) || (this._tileSelection && this._tileSelection.size > 0)));
                if (this.keys.pressed('c')) {
                    if (allowTileClipboard || this.selectionRegion || (this.selectionPoints && this.selectionPoints.length > 0)) this.doCopy();
                }
                if (this.keys.pressed('x')) {
                    if (allowTileClipboard || this.selectionRegion || (this.selectionPoints && this.selectionPoints.length > 0)) this.doCut();
                }
                if (this.keys.released('v')) {
                    // paste at mouse position (tiles or pixels)
                    const posInfo = this.getPos(this.mouse && this.mouse.pos);
                    const allowTilePaste = !!(this.tilemode && posInfo && posInfo.renderOnly && this._tileClipboard);
                    if (allowTilePaste) {
                        this.doPaste(this.mouse && this.mouse.pos);
                        this._justPasted = true;
                    } else if (this.clipboard) {
                        this.doPaste(this.mouse && this.mouse.pos);
                        this._justPasted = true;
                    } else {
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
                    } catch (e) { /* ignore */ }
                }
                // flip clipboard horizontally with 'f' while in pasteMode
                if (this.keys.released('f','pasteMode')) {
                    try {
                        if (typeof this.flipClipboardH === 'function') this.flipClipboardH();
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
                if (fHeldTime > 1 || (fPressed && !this.keys.held('Alt'))) {
                    const pos = this.getPos(this.mouse && this.mouse.pos);
                    if (!pos || (!pos.inside && !(this.tilemode && pos.renderOnly))) return;
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
                            if (window.Debug && typeof window.Debug.emit === 'function') {
                                window.Debug.emit('drawSelected');
                            } else if (window.Debug && typeof window.Debug.createSignal === 'function') {
                                const sig = window.Debug.signals && window.Debug.signals.get && window.Debug.signals.get('drawSelected');
                                if (typeof sig === 'function') sig();
                            }
                            return;
                        }
                    } catch (e) { /* ignore selection->draw dispatch errors */ }
                    const sheet = this.currentSprite;
                    // prefer the bound frame for the area under the mouse
                    let anim = this.selectedAnimation;
                    let frameIdx = this.selectedFrame;
                    if (pos && typeof pos.areaIndex === 'number') {
                        const binding = this.getAreaBinding(pos.areaIndex);
                        if (binding && binding.anim !== undefined && binding.index !== undefined) {
                            anim = binding.anim;
                            frameIdx = Number(binding.index);
                        }
                    }
                    // Tile-mode: perform tile-region fill or tile-region select when renderOnly
                    if (this.tilemode && pos && pos.renderOnly) {
                        try {
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

                            if (results.length === 0) return;

                            if (this.keys.held('Shift')) {
                                // select the region
                                if (!this._tileSelection) this._tileSelection = new Set();
                                for (const t of results) this._tileSelection.add(this._tileKey(t.col, t.row));
                                // update hover anchor so selection overlay shows immediately
                                this._tileHoverAnchor = { col: startCol, row: startRow };
                                return;
                            } else {
                                // apply fill binding to region
                                const binding = this._tileBrushBinding || { anim: this.selectedAnimation, index: this.selectedFrame };
                                const transform = this._tileBrushTransform ? { ...this._tileBrushTransform } : null;
                                if (!Array.isArray(this._areaBindings)) this._areaBindings = [];
                                if (!Array.isArray(this._areaTransforms)) this._areaTransforms = [];
                                for (const t of results) {
                                    this._activateTile(t.col, t.row);
                                    this._areaBindings[t.idx] = binding ? { ...binding } : null;
                                    this._areaTransforms[t.idx] = transform ? { ...transform } : this._areaTransforms[t.idx];
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

                            // Merge flood-selected points into any existing selection
                            const merged = (this.selectionPoints && this.selectionPoints.length > 0)
                                ? this.selectionPoints.slice()
                                : [];
                            for (const p of newPoints) {
                                const exists = merged.some(sp => sp.x === p.x && sp.y === p.y && sp.areaIndex === p.areaIndex);
                                if (!exists) merged.push(p);
                            }
                            this.selectionPoints = merged;
                            this.selectionRegion = null;
                            return;
                        }

                        // Otherwise, perform a paint fill using the current pen color.
                        const fillCol = Color.convertColor(this.penColor || '#000000');
                        const fRgb = fillCol.toRgb();
                        const fillR = Math.round(fRgb.a || 0);
                        const fillG = Math.round(fRgb.b || 0);
                        const fillB = Math.round(fRgb.c || 0);
                        const fillA = Math.round((fRgb.d ?? 1) * 255);
                        // If target color equals fill color, nothing to do
                        if (srcR === fillR && srcG === fillG && srcB === fillB && srcA === fillA) return;

                        const shiftHeld = this.keys.held('Shift');
                        if (shiftHeld) {
                            // Global exact replace: replace every pixel matching src color
                            for (let p = 0; p < w * h; p++) {
                                const idx = p * 4;
                                if (data[idx] === srcR && data[idx+1] === srcG && data[idx+2] === srcB && data[idx+3] === srcA) {
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
                                // set to fill
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

                        // write back and rebuild sheet
                        ctx.putImageData(img, 0, 0);
                        if (typeof sheet._rebuildSheetCanvas === 'function') try { sheet._rebuildSheetCanvas(); } catch (e) {}
                        // Mirror the result immediately when mirror modes are active
                        try {
                            if (this.penMirrorH) this._applyInitialMirror('h');
                            if (this.penMirrorV) this._applyInitialMirror('v');
                        } catch (e) { /* ignore mirror apply errors */ }
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
                    const anim = this.selectedAnimation;
                    const frameIdx = this.selectedFrame;
                    if (!sheet) return;
                    const samples = [];
                    // explicit point selection
                    if (this.selectionPoints && this.selectionPoints.length > 0) {
                        const frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, frameIdx) : null;
                        if (frameCanvas) {
                            const ctx = frameCanvas.getContext('2d');
                            for (const p of this.selectionPoints) {
                                try {
                                    const d = ctx.getImageData(p.x, p.y, 1, 1).data;
                                    samples.push(d);
                                } catch (e) { /* ignore per-pixel errors */ }
                            }
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
                        const frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, frameIdx) : null;
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
                        this.penColor = hex8;
                        // update HTML color input (drop alpha)
                        if (this._colorInput) {
                            const toHex = (v) => (v < 16 ? '0' : '') + v.toString(16).toUpperCase();
                            try { this._colorInput.value = '#' + toHex(r) + toHex(g) + toHex(b); } catch (e) {}
                        }
                    }
                }
            } catch (e) { console.warn('average color (j) failed', e); }

            // Lighten (h) / Darken (k) selected pixels by a linear amount on
            // the currently-selected channel (this.adjustChannel). Use additive
            // deltas (this.adjustAmount) instead of multiplicative scaling.
            try {
                const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
                const getAdjust = (channel) => {
                    if (typeof this._getAdjustPercent === 'function') return this._getAdjustPercent(channel);
                    return (typeof this.adjustAmount === 'number') ? this.adjustAmount : 0.05;
                };
                const applyAdjust = (direction) => {
                    const sheet = this.currentSprite;
                    const anim = this.selectedAnimation;
                    const frameIdx = this.selectedFrame;
                    if (!sheet) return;
                    const channel = this.adjustChannel || 'v';
                    // Reduce hue adjustments to a smaller fraction so keys change hue more finely
                    const channelMultiplier = (channel === 'h') ? 0.2 : 1.0;
                    const appliedDelta = direction * getAdjust(channel) * channelMultiplier;

                    // point selection
                    if (this.selectionPoints && this.selectionPoints.length > 0) {
                        const frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, frameIdx) : null;
                        if (!frameCanvas) return;
                        const ctx = frameCanvas.getContext('2d');
                        for (const p of this.selectionPoints) {
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
                                if (typeof sheet.setPixel === 'function') sheet.setPixel(anim, frameIdx, p.x, p.y, newHex, 'replace');
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
                        const frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, frameIdx) : null;
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
                            this.penColor = newHex8;
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
                    }
                    if (this.keys.released('k')) {
                        applyAdjust(-1); // additive darken on selected channel
                    }
                }
            } catch (e) { console.warn('lighten/darken (h/k) failed', e); }

            // Add subtle noise/randomness to the current frame on 'n' release
            try {
                const noisePressed = this.keys && typeof this.keys.released === 'function' && (this.keys.released('n') || this.keys.released('N'));
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
                    if (typeof sourceAreaIndex === 'number') {
                        const binding = this.getAreaBinding(sourceAreaIndex);
                        if (binding && binding.anim !== undefined && binding.index !== undefined) {
                            anim = binding.anim;
                            frameIdx = Number(binding.index);
                        }
                    }
                    if (!sheet) return;
                    const frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, frameIdx) : null;
                    if (!frameCanvas) return;
                    try {
                        const w = frameCanvas.width;
                        const h = frameCanvas.height;
                        const ctx = frameCanvas.getContext('2d');
                        const img = ctx.getImageData(0, 0, w, h);
                        const data = img.data;
                        const noiseChanges = [];
                        const channel = this.adjustChannel || 'v';
                        const baseAdjust = (typeof this._getAdjustPercent === 'function') ? this._getAdjustPercent(channel) : ((typeof this.adjustAmount === 'number') ? this.adjustAmount : 0.05);
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
                    } catch (e) {
                        // ignore image ops errors
                    }
                }
            } catch (e) {
                console.warn('noise (n) failed', e);
            }

            // If clipboard preview is active, allow left-click (press+hold) inside the preview
            // to pick a new origin inside the clipboard. We freeze the preview placement on
            // initial press so subsequent mouse movement moves the origin relative to that frozen preview.
            try {
                if (this.clipboardPreview && this.clipboard) {
                    const cb = this.clipboard;
                    // start dragging (freeze) on initial press
                    if (this.mouse.pressed('left') && !this._clipboardPreviewDragging) {
                        const posInfo = this.getPos(this.mouse.pos);
                        if (posInfo && posInfo.inside) {
                            const ox = (cb.originOffset && typeof cb.originOffset.ox === 'number') ? cb.originOffset.ox : 0;
                            const oy = (cb.originOffset && typeof cb.originOffset.oy === 'number') ? cb.originOffset.oy : 0;
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
            this.selectionRegion = {
                start: { x: snapshot.start.x, y: snapshot.start.y },
                end: { x: snapshot.end.x, y: snapshot.end.y },
                areaIndex: (typeof snapshot.areaIndex === 'number') ? snapshot.areaIndex : null
            };
            this.selectionPoints = [];
        } else if (snapshot.type === 'points') {
            this.selectionPoints = (snapshot.points || []).map(p => ({ x: p.x, y: p.y, areaIndex: (typeof p.areaIndex === 'number') ? p.areaIndex : null }));
            this.selectionRegion = null;
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

    // Generate list of pixel coordinates for a Bresenham line between start and end
    computeLinePixels(start, end) {
        const pixels = [];
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
            pixels.push({ x: x0, y: y0 });
            if ((x0 === x1) && (y0 === y1)) break;
            let e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x0 += sx; }
            if (e2 < dx) { err += dx; y0 += sy; }
        }
        return pixels;
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
    computeBoxPixels(start, end, filled) {
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
        return pixels;
    }

    // Generate list of pixel coordinates for a circle between start and end.
    // `start` is treated as the center; `end` defines the radius. If `filled`
    // is true, returns all pixels inside the circle **and** its border;
    // otherwise only the border.
    //
    // When brushSize === 2 and exactly 4 selectionPoints exist, we treat those
    // 4 pixels as a 2x2 center block and use their averaged center (e.g. 1.5,6.5)
    // to produce an even-centered circle.
    computeCirclePixels(start, end, filled) {
        const pixels = [];
        if (!start || !end) return pixels;

        // Default center from the provided start point.
        let cx = start.x;
        let cy = start.y;

        // Even-centered mode: if the user has selected a 2x2 block (4 pixels)
        // and brushSize is 2, use the average of those pixels as the circle
        // center so the circle is centered between pixels instead of on one.
        try {
            if (this && this.brushSize === 2 && Array.isArray(this.selectionPoints) && this.selectionPoints.length === 4) {
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
            pixels.push({ x: cx, y: cy });
            return pixels;
        }

        const r2 = r * r;

        // use a small band around r^2 for the outline thickness
        const borderBand = Math.max(1, r);

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
        const minX = Math.floor(cx - r);
        const maxX = Math.ceil(cx + r);
        const minY = Math.floor(cy - r);
        const maxY = Math.ceil(cy + r);

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const ddx = x - cx;
                const ddy = y - cy;
                const dist2 = ddx * ddx + ddy * ddy;

                if (!filled) {
                    // outline-only: accept pixels whose distance^2 is close to r^2
                    if (dist2 >= r2 - borderBand && dist2 <= r2 + borderBand) {
                        addPixel(x, y);
                    }
                } else {
                    // filled: include interior AND outline band
                    if (dist2 <= r2) {
                        addPixel(x, y);
                    }
                    if (dist2 >= r2 - borderBand && dist2 <= r2 + borderBand) {
                        addPixel(x, y);
                    }
                }
            }
        }
        return pixels;
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

    _paintWorldPixels(worldPixels, color) {
        try {
            const sheet = this.currentSprite;
            if (!sheet || !worldPixels || worldPixels.length === 0) return;
            const slice = (sheet.slicePx) ? sheet.slicePx : 1;
            const seen = new Set();
            for (const wp of worldPixels) {
                if (!wp) continue;
                const key = `${wp.x|0},${wp.y|0}`;
                if (seen.has(key)) continue;
                seen.add(key);

                // In non-tile mode, drop pixels that fall outside the single frame instead of clamping.
                if (!this.tilemode) {
                    if (wp.x < 0 || wp.y < 0 || wp.x >= slice || wp.y >= slice) continue;
                }

                const target = this._worldPixelToTile(wp.x, wp.y, slice);
                if (!target) continue;
                if (this.tilemode && !this._isTileActive(target.col, target.row)) continue;
                const areaIndex = this.tilemode ? target.areaIndex : null;
                let anim = this.selectedAnimation;
                let frameIdx = this.selectedFrame;
                if (typeof areaIndex === 'number') {
                    const binding = this.getAreaBinding(areaIndex);
                    if (binding && binding.anim !== undefined && binding.index !== undefined) {
                        anim = binding.anim;
                        frameIdx = Number(binding.index);
                    }
                }

                if (this.maskShapesWithSelection && this.isPixelMasked(target.localX, target.localY, areaIndex)) continue;

                // If pixel-perfect mode is active, route single-pixel writes through
                // the pixel-perfect handler so strokes can restore L-bend pixels.
                if (this.pixelPerfect) {
                    try {
                        this._applyPixelPerfectPixel(sheet, anim, frameIdx, target.localX, target.localY, color, areaIndex);
                    } catch (e) { /* ignore pixel-perfect write errors */ }
                } else if (typeof sheet.setPixel === 'function') {
                    try { sheet.setPixel(anim, frameIdx, target.localX, target.localY, color, 'replace'); } catch (e) { /* ignore per-pixel errors */ }
                } else if (typeof sheet.modifyFrame === 'function') {
                    try { sheet.modifyFrame(anim, frameIdx, { x: target.localX, y: target.localY, color, blendType: 'replace' }); } catch (e) { /* ignore per-pixel errors */ }
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
            let pixels = [];
            if (tool === 'line') {
                pixels = this.computeLinePixels(start, end);
            } else if (tool === 'box') {
                pixels = this.computeBoxPixels(start, end, filled);
            } else if (tool === 'circle' && typeof this.computeCirclePixels === 'function') {
                pixels = this.computeCirclePixels(start, end, filled);
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
            this.selectionRegion = null;
            this.currentTool = null;
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

            this.selectionPoints = nextSel;
            this.selectionRegion = null;
            this.currentTool = null;
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

            this.selectionPoints = nextSel;
            this.selectionRegion = null;
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

            this.selectionPoints = nextSel;
            this.selectionRegion = null;
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

                // Persist tile-mode layout (grid size, bindings, preview transforms)
                try {
                    const layout = {};
                    layout.tilemode = !!this.tilemode;
                    layout.tileCols = Math.max(1, (this.tileCols|0) || 3);
                    layout.tileRows = Math.max(1, (this.tileRows|0) || 3);
                    layout.bindings = [];
                    layout.transforms = [];
                    layout.activeTiles = [];
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

                try { this.saver.set('sprites_meta/' + keyName, meta); } catch (e) {}
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
                    this._tileClipboard = {
                        tiles: entries.map(e => ({ dc: e.col - minCol, dr: e.row - minRow, binding: e.binding, transform: e.transform }))
                    };
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
            if (typeof sourceAreaIndex === 'number') {
                const binding = this.getAreaBinding(sourceAreaIndex);
                if (binding && binding.anim !== undefined && binding.index !== undefined) {
                    anim = binding.anim;
                    frameIdx = Number(binding.index);
                }
            }

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
                const mpos = this.getPos(this.mouse && this.mouse.pos) || { x: minX, y: minY };
                const originX = Math.max(minX, Math.min(maxX, mpos.x));
                const originY = Math.max(minY, Math.min(maxY, mpos.y));
                const originOffset = { ox: originX - minX, oy: originY - minY };
                this.clipboard = { type: 'points', w, h, pixels, originOffset };
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
            const mpos = this.getPos(this.mouse && this.mouse.pos) || { x: minX, y: minY };
            const originX = Math.max(minX, Math.min(maxX, mpos.x));
            const originY = Math.max(minY, Math.min(maxY, mpos.y));
            const originOffset = { ox: originX - minX, oy: originY - minY };
            this.clipboard = { type: 'image', w, h, data: img.data, originOffset };
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
                    // clear tile binding/transform and deactivate tile so it no longer renders
                    if (Array.isArray(this._areaBindings)) this._areaBindings[idx] = null;
                    if (Array.isArray(this._areaTransforms)) this._areaTransforms[idx] = null;
                    this._deactivateTile(c.col, c.row);
                }
                if (entries.length > 0) {
                    const minCol = Math.min(...entries.map(e => e.col));
                    const minRow = Math.min(...entries.map(e => e.row));
                    this._tileClipboard = {
                        tiles: entries.map(e => ({ dc: e.col - minCol, dr: e.row - minRow, binding: e.binding, transform: e.transform }))
                    };
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
            if (typeof sourceAreaIndex === 'number') {
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
                this.selectionPoints = [];
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
            this.selectionRegion = null;
        } catch (e) {
            console.warn('doCut failed', e);
        }
    }

    // Paste clipboard at a screen mouse position (mousePos is a Vector in screen space)
    doPaste(mousePos) {
        try {
            if (!this.clipboard && !this._tileClipboard) return;
            if (!this.currentSprite) return;
            const sheet = this.currentSprite;
            const slice = sheet.slicePx || 1;
            const pos = this.getPos(mousePos);
            if (!pos || (!pos.inside && !(this.tilemode && pos.renderOnly))) return;

            // Resolve destination anim/frame and tile origin (col,row) when in tilemode
            let anim = this.selectedAnimation;
            let frameIdx = this.selectedFrame;
            let col = 0, row = 0;
            let areaIndex = (pos && typeof pos.areaIndex === 'number') ? pos.areaIndex : null;
            if (this.tilemode && typeof areaIndex === 'number' && Array.isArray(this._tileIndexToCoord)) {
                const cr = this._tileIndexToCoord[areaIndex];
                if (cr) { col = cr.col|0; row = cr.row|0; }
            }
            if (typeof areaIndex === 'number') {
                const binding = this.getAreaBinding(areaIndex);
                if (binding && binding.anim !== undefined && binding.index !== undefined) {
                    anim = binding.anim;
                    frameIdx = Number(binding.index);
                }
            }

            // Tile clipboard paste in render-only tilemode
            if (this.tilemode && pos.renderOnly && this._tileClipboard) {
                const tiles = Array.isArray(this._tileClipboard.tiles) && this._tileClipboard.tiles.length > 0
                    ? this._tileClipboard.tiles
                    : (this._tileClipboard.binding ? [{ dc:0, dr:0, binding: this._tileClipboard.binding, transform: this._tileClipboard.transform }] : []);
                for (const t of tiles) {
                    const tCol = col + (t.dc|0);
                    const tRow = row + (t.dr|0);
                    const idx = this._getAreaIndexForCoord(tCol, tRow);
                    this._activateTile(tCol, tRow);
                    if (!Array.isArray(this._areaBindings)) this._areaBindings = [];
                    if (!Array.isArray(this._areaTransforms)) this._areaTransforms = [];
                    this._areaBindings[idx] = t.binding ? { ...t.binding } : { anim, index: frameIdx };
                    this._areaTransforms[idx] = t.transform ? { ...t.transform } : this._areaTransforms[idx];
                }
                return;
            }

            if (!this.clipboard) return;

            const ox = (this.clipboard.originOffset && typeof this.clipboard.originOffset.ox === 'number') ? this.clipboard.originOffset.ox : 0;
            const oy = (this.clipboard.originOffset && typeof this.clipboard.originOffset.oy === 'number') ? this.clipboard.originOffset.oy : 0;
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
    doClipboardErase(mousePos) {
        try {
            if (!this.clipboard || !this.currentSprite) return;
            const sheet = this.currentSprite;
            const slice = sheet.slicePx || 1;
            const pos = this.getPos(mousePos);
            if (!pos || !pos.inside) return;

            let anim = this.selectedAnimation;
            let frameIdx = this.selectedFrame;
            let col = 0, row = 0;
            let areaIndex = (pos && typeof pos.areaIndex === 'number') ? pos.areaIndex : null;
            if (this.tilemode && typeof areaIndex === 'number' && Array.isArray(this._tileIndexToCoord)) {
                const cr = this._tileIndexToCoord[areaIndex];
                if (cr) { col = cr.col|0; row = cr.row|0; }
            }
            if (typeof areaIndex === 'number') {
                const binding = this.getAreaBinding(areaIndex);
                if (binding && binding.anim !== undefined && binding.index !== undefined) {
                    anim = binding.anim;
                    frameIdx = Number(binding.index);
                }
            }

            const ox = (this.clipboard.originOffset && typeof this.clipboard.originOffset.ox === 'number') ? this.clipboard.originOffset.ox : 0;
            const oy = (this.clipboard.originOffset && typeof this.clipboard.originOffset.oy === 'number') ? this.clipboard.originOffset.oy : 0;
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

    // Override Scene.sendState: send buffered pixel edit ops to server using per-op keys
    sendState() {
        try {
            if (!this.server || !this._opBuffer || this._opBuffer.length === 0) return;
            if (!this.server.sendDiff) {
                // fallback to parent behaviour
                if (super.sendState) return super.sendState();
                return;
            }

            // Build an update object mapping nested keys to op payloads so firebase update() creates distinct children
            const diff = {};
            // limit how many ops we send in one batch to avoid huge updates
            const batch = this._opBuffer.splice(0, 256);
            for (const op of batch) {
                const id = (op.time || Date.now()) + '_' + Math.random().toString(36).slice(2,6);
                // store under edits/<id>
                diff['edits/' + id] = op;
            }

            if (Object.keys(diff).length > 0) {
                try { this.server.sendDiff(diff); } catch (e) { console.warn('sendState sendDiff failed', e); }
            }
        } catch (e) { console.warn('sendState failed', e); }
    }

    // Apply remote state sent by other clients. Accepts the full remote state blob.
    applyRemoteState(state) {
        try {
            if (!state) return;
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
                                }
                            } else if (logical > targetCount) {
                                // remove frames (from the end when no struct ops are present)
                                for (let k = 0; k < (logical - targetCount); k++) {
                                    try { this.currentSprite.popFrame(anim); } catch(e){}
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
                            const entry = { x: Number(c.x || 0), y: Number(c.y || 0), time: Number(c.time || Date.now()), client: cid };
                            if (c.name) entry.name = c.name;
                            try { this._remoteCursors && this._remoteCursors.set(cid, entry); } catch(e){}
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
                                applied++;
                            } else if (op.action === 'deleteFrame') {
                                const idx = (typeof op.index === 'number' && op.index >= 0) ? Number(op.index) : undefined;
                                try { this._suppressOutgoing = true; this.currentSprite.popFrame(op.anim, idx); } finally { this._suppressOutgoing = false; }
                                applied++;
                            }
                        } catch (e) { /* ignore struct op errors */ }
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
                            if (typeof sheet.drawPixels === 'function') {
                                try { this._suppressOutgoing = true; sheet.drawPixels(op.anim, op.frame, toApply); } catch (e) {
                                    for (const px of toApply) { try { sheet.setPixel(op.anim, op.frame, px.x, px.y, px.color, 'replace'); } catch (er) {} }
                                } finally { this._suppressOutgoing = false; }
                            } else {
                                try { this._suppressOutgoing = true; for (const px of toApply) { try { sheet.setPixel(op.anim, op.frame, px.x, px.y, px.color, 'replace'); } catch (er) {} } } finally { this._suppressOutgoing = false; }
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
                    try { if (this.server && this.server.sendDiff) this.server.sendDiff(diff); } catch (e) { console.warn('sync snapshot send failed', e); }
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
            try { if (this.server && this.server.sendDiff) this.server.sendDiff(diff); } catch (e) { console.warn('sync completion send failed', e); }
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
                tileCols: this.tileCols,
                tileRows: this.tileRows,
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
            if (Array.isArray(this._areaTransforms)) snap.transforms = this._areaTransforms.slice();
            const animNames = Array.from(sheet._frames.keys());
            let row = 0;
            for (const name of animNames) {
                const arr = sheet._frames.get(name) || [];
                const frames = [];
                let logical = 0;
                for (let i = 0; i < arr.length; i++) {
                    const entry = arr[i];
                    if (!entry || entry.__groupStart || entry.__groupEnd) continue;
                    const frameCanvas = sheet.getFrame(name, logical);
                    let dataUrl = null;
                    try { dataUrl = frameCanvas && frameCanvas.toDataURL ? frameCanvas.toDataURL('image/png') : null; } catch (e) { dataUrl = null; }
                    frames.push(dataUrl);
                    logical++;
                }
                snap.frames[name] = frames;
                snap.animations[name] = { row, frames: frames.length };
                row++;
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
            try { sheet._rebuildSheetCanvas(); } catch (e) {}
            this.selectedAnimation = animNames[0] || this.selectedAnimation || 'idle';
            this.selectedFrame = 0;
            if (this.FrameSelect) {
                this.FrameSelect.sprite = sheet;
                try { if (this.FrameSelect._multiSelected) this.FrameSelect._multiSelected.clear(); } catch (e) {}
                try { if (typeof this.FrameSelect.rebuild === 'function') this.FrameSelect.rebuild(); } catch (e) {}
            }
            if (Number.isFinite(snapshot.tileCols)) this.tileCols = snapshot.tileCols;
            if (Number.isFinite(snapshot.tileRows)) this.tileRows = snapshot.tileRows;
            if (!this._tileActive) this._tileActive = new Set();
            if (Array.isArray(snapshot.activeTiles)) {
                for (const t of snapshot.activeTiles) {
                    if (!t) continue;
                    const c = Number(t.col);
                    const r = Number(t.row);
                    if (Number.isFinite(c) && Number.isFinite(r)) this._activateTile(c, r);
                }
            } else {
                this._seedTileActives(this.tileCols, this.tileRows);
            }
            if (Array.isArray(snapshot.bindings)) {
                this._areaBindings = snapshot.bindings.map((b, i) => {
                    if (!b) return null;
                    let idx = i;
                    if (Number.isFinite(b.col) && Number.isFinite(b.row)) {
                        idx = this._getAreaIndexForCoord(Number(b.col), Number(b.row));
                        this._activateTile(Number(b.col), Number(b.row));
                    }
                    const mf = Array.isArray(b.multiFrames) ? b.multiFrames.filter(v => Number.isFinite(v)).map(v => Number(v)) : null;
                    const entry = { anim: b.anim, index: Number(b.index), multiFrames: (mf && mf.length > 0) ? mf.slice() : null };
                    this._areaBindings[idx] = entry;
                    return entry;
                });
            }
            if (Array.isArray(snapshot.transforms)) this._areaTransforms = snapshot.transforms;
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
        if (!requestId || !this.server || !this.server.sendDiff) return;
        const diff = {};
        const ackId = (this.playerId) ? this.playerId : (this.clientId || 'client');
        diff['sync/acks/' + ackId] = requestId;
        try { this.server.sendDiff(diff); } catch (e) { console.warn('sync ack send failed', e); }
    }

    // --- Undo / Redo helpers ---
    _pushUndo(entry) {
        if (!entry || this._ignoreUndoCapture) return;
        this._undoStack.push(entry);
        // trim to max and clear redo on new action
        if (this._undoStack.length > this._undoMax) this._undoStack.shift();
        this._redoStack = [];
    }

    _recordUndoPixels(anim, frameIdx, changes) {
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

        const now = Date.now();
        const last = this._undoStack[this._undoStack.length - 1];
        const canMerge = last && last.type === 'pixels' && last.anim === anim && last.frame === Number(frameIdx) && (now - last.time) <= this._undoMergeMs;
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
            this._pushUndo({ type: 'pixels', anim, frame: Number(frameIdx) || 0, pixels: samples, time: now });
        }
    }

    _applyPixelBatch(anim, frameIdx, pixels, useNext) {
        if (!pixels || pixels.length === 0) return;
        const sheet = this.currentSprite;
        if (!sheet) return;
        const changes = pixels.map(p => ({ x: p.x, y: p.y, color: useNext ? p.next : p.prev, blendType: 'replace' }));
        try { sheet.modifyFrame(anim, frameIdx, changes); } catch (e) {
            // fallback per-pixel
            for (const p of changes) {
                try { sheet.setPixel(anim, frameIdx, p.x, p.y, p.color, 'replace'); } catch (er) { /* ignore */ }
            }
        }
        try { if (sheet._rebuildSheetCanvas) sheet._rebuildSheetCanvas(); } catch (e) { /* ignore */ }
    }

    undo() {
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
                this._applyPixelBatch(entry.anim, entry.frame, entry.pixels, false);
            } else if (entry.type === 'delete-frame') {
                this._restoreDeletedFrame(entry);
            }
            this._redoStack.push(entry);
            if (this._redoStack.length > this._undoMax) this._redoStack.shift();
        } finally {
            this._ignoreUndoCapture = false;
        }
        return true;
    }

    redo() {
        if (!this._redoStack || this._redoStack.length === 0) return false;
        const entry = this._redoStack.pop();
        this._ignoreUndoCapture = true;
        try {
            if (entry.type === 'pixels') {
                this._applyPixelBatch(entry.anim, entry.frame, entry.pixels, true);
            } else if (entry.type === 'delete-frame') {
                // redo delete: re-apply removal
                try { this.currentSprite && this.currentSprite.popFrame(entry.anim, entry.index); } catch (e) { /* ignore */ }
            }
            this._undoStack.push(entry);
        } finally {
            this._ignoreUndoCapture = false;
        }
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
        this.selectedAnimation = entry.anim;
        this.selectedFrame = entry.index;
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
            if (!this.server || !this.server.sendDiff) return;
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
                try { this.server.sendDiff(diff); } catch (e) { console.warn('pruneOldEdits sendDiff failed', e); }
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
            if (!this.server || !this.server.sendDiff) return;
            if (!this.mouse || !this.mouse.pos) return;
            const pos = this.mouse.pos;
            const payload = { x: Number(pos.x || 0), y: Number(pos.y || 0), time: Date.now(), client: this.clientId };
            if (this.playerName) payload.name = this.playerName;
            const diff = {};
            diff['cursors/' + this.clientId] = payload;
            try { this.server.sendDiff(diff); } catch (e) {}
        } catch (e) { /* ignore */ }
    }

    // Remove stale remote cursors from local map
    _cleanupCursors() {
        try {
            if (!this._remoteCursors) return;
            const now = Date.now();
            const ttl = this._cursorTTLms || 5000;
            for (const [id, entry] of Array.from(this._remoteCursors.entries())) {
                try {
                    const t = Number(entry.time) || 0;
                    if (t && (now - t) > ttl) this._remoteCursors.delete(id);
                } catch (e) { continue; }
            }
        } catch (e) {}
    }

    // Rotate the stored clipboard 90 degrees clockwise.
    rotateClipboardCW() {
        try {
            if (!this.clipboard) return;
            const cb = this.clipboard;
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
        } catch (e) {
            console.warn('rotateClipboardCW failed', e);
        }
    }

    // Flip the stored clipboard horizontally (mirror left-right).
    flipClipboardH() {
        try {
            if (!this.clipboard) return;
            const cb = this.clipboard;
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

    _activateTile(col, row) {
        try {
            if (!this._tileActive) this._tileActive = new Set();
            this._tileActive.add(this._tileKey(col, row));
            this._getAreaIndexForCoord(col, row);
        } catch (e) { /* ignore */ }
    }

    _deactivateTile(col, row) {
        try {
            const key = this._tileKey(col, row);
            if (this._tileActive) this._tileActive.delete(key);
            const idx = this._tileCoordToIndex ? this._tileCoordToIndex.get(key) : null;
            if (Number.isFinite(idx)) {
                if (Array.isArray(this._areaBindings)) this._areaBindings[idx] = null;
                if (Array.isArray(this._areaTransforms)) this._areaTransforms[idx] = null;
            }
        } catch (e) { /* ignore */ }
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

    // Bind a specific animation/frame to a rendered area index
    bindArea(areaIndex, anim, frameIdx, multiFrames = null) {
        try {
            if (typeof areaIndex !== 'number' || areaIndex < 0) return false;
            if (!this._areaBindings) this._areaBindings = [];
            const stack = Array.isArray(multiFrames) ? multiFrames.filter(i => Number.isFinite(i)).map(i => Number(i)) : null;
            this._areaBindings[areaIndex] = { anim: anim || this.selectedAnimation, index: Number(frameIdx) || 0, multiFrames: (stack && stack.length > 0) ? stack : null };
            return true;
        } catch (e) { return false; }
    }

    // Toggle preview rotation (90deg CW) for an area
    toggleAreaPreviewRotate(areaIndex) {
        if (typeof areaIndex !== 'number' || areaIndex < 0) return false;
        if (!this._areaTransforms) this._areaTransforms = [];
        const t = this._areaTransforms[areaIndex] || { rot: 0, flipH: false };
        t.rot = ((t.rot || 0) + 90) % 360;
        this._areaTransforms[areaIndex] = t;
        return true;
    }

    // Toggle preview horizontal flip for an area
    toggleAreaPreviewFlip(areaIndex) {
        if (typeof areaIndex !== 'number' || areaIndex < 0) return false;
        if (!this._areaTransforms) this._areaTransforms = [];
        const t = this._areaTransforms[areaIndex] || { rot: 0, flipH: false };
        t.flipH = !t.flipH;
        this._areaTransforms[areaIndex] = t;
        return true;
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
                        return true;
                    }
                }
            } catch (e) {}
            return false;
        } catch (e) { return false; }
    }

    getAreaBinding(areaIndex) {
        if (!Array.isArray(this._areaBindings)) return null;
        return this._areaBindings[areaIndex] || null;
    }

    clearAreaBinding(areaIndex) {
        if (!Array.isArray(this._areaBindings)) return false;
        this._areaBindings[areaIndex] = null;
        return true;
    }

    draw() {
        if (!this.isReady) return;
        // Clear and draw a simple background + text
        this.Draw.background('#222')
        // Create a transform container.
        this.Draw.pushMatrix()
        // scale first
        this.Draw.scale(this.zoom)
        // then transform
        this.Draw.translate(this.offset)
        
        // display the editable frame centered on the screen
        const drawCtx = this.Draw.ctx;
        if (drawCtx && drawCtx.canvas) {
            const uiW = drawCtx.canvas.width / this.Draw.Scale.x;
            const uiH = drawCtx.canvas.height / this.Draw.Scale.y;
            const size = new Vector(384, 384);
            const center = new Vector((uiW - size.x) / 2, (uiH - size.y) / 2);

            // Build all displayed tile positions.
            // When tilemode is off, show a single central area.
            // When tilemode is on, draw all active tiles (infinite grid), plus the hovered tile even if inactive.
            const areas = [];
            const basePos = center.clone(); // tile (0,0) top-left

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
                const addTileArea = (col, row, active=true) => {
                    const key = this._tileKey(col, row);
                    if (seen.has(key)) return;
                    seen.add(key);
                    const pos = this._tileCoordToPos(col, row, basePos, size);
                    const info = this.computeAreaInfo(pos, size);
                    if (!info || this._shouldCullArea(info)) return;
                    info.renderOnly = this._isSimTooSmall(info);
                    const idx = this._getAreaIndexForCoord(col, row);
                    info.areaIndex = idx;
                    info.tileCol = col;
                    info.tileRow = row;
                    info.active = !!active;
                    areas.push(info);
                };

                // draw all active tiles
                for (const key of this._tileActive.values()) {
                    const c = this._parseTileKey(key);
                    if (c) addTileArea(c.col, c.row, true);
                }

                // include hovered tile even if inactive
                try {
                    const mp = this.mouse && this.mouse.pos ? this.mouse.pos : new Vector(0,0);
                    let mx = mp.x || 0;
                    let my = mp.y || 0;
                    mx = mx / this.zoom.x - this.offset.x;
                    my = my / this.zoom.y - this.offset.y;
                    const hover = this._worldToTileCoord(mx, my, basePos, size);
                    if (hover) addTileArea(hover.col, hover.row, this._isTileActive(hover.col, hover.row));
                } catch (e) { /* ignore hover add errors */ }
            }

            this._drawAreas = areas;

            // First pass: base layer (frame, checkerboard, labels)
            for (const area of areas) {
                this.displayDrawArea(area.topLeft, size, this.currentSprite, this.selectedAnimation, this.selectedFrame, area.areaIndex, area, 'base');
            }

            // Second pass: overlays (cursor, selections, previews) to avoid being occluded by later tiles
            for (const area of areas) {
                this.displayDrawArea(area.topLeft, size, this.currentSprite, this.selectedAnimation, this.selectedFrame, area.areaIndex, area, 'overlay');
            }
            // Draw the global tile cursor / selection / paste preview once (not per-area)
            try { if (typeof this._drawTileCursorOverlay === 'function') this._drawTileCursorOverlay(); } catch (e) {}
        }

        // Remove previous transform container to prevent transform stacking
        this.Draw.popMatrix()
        this.UIDraw.useCtx('UI');
        this.UIDraw.clear()
        this.FrameSelect.draw()
        // Draw remote cursors from other clients
        try {
            if (this._remoteCursors && this._remoteCursors.size > 0) {
                const colors = ['#FF5555FF','#55FF55FF','#5555FFFF','#FFFF55FF','#FF55FFFF','#55FFFFFF','#FFA500FF','#FFFFFF88'];
                for (const [cid, entry] of this._remoteCursors.entries()) {
                    try {
                        if (!entry) continue;
                        if (cid === this.clientId) continue;
                        const age = Date.now() - (Number(entry.time) || 0);
                        if (age > (this._cursorTTLms || 5000)) { this._remoteCursors.delete(cid); continue; }
                        const hash = (cid || '').split('').reduce((s,c)=>s + c.charCodeAt(0),0) || 0;
                        const col = colors[hash % colors.length] || '#FFFFFF88';
                        const pos = new Vector(Number(entry.x || 0), Number(entry.y || 0));
                        // small 5px diameter circle (radius 2.5)
                        try { this.UIDraw.circle(pos, 2.5, col, true); } catch (e) { /* fallback ignore */ }
                        // optional name label a little offset to the right
                        if (entry.name) {
                            try { this.UIDraw.text(entry.name, new Vector(pos.x + 6, pos.y + 2), '#FFFFFFFF', 0, 12, { align: 'left', baseline: 'middle', font: 'monospace' }); } catch (e) {}
                        }
                    } catch (e) { continue; }
                }
            }
        } catch (e) {}
        // Prompt for selection keyframing
        try {
            const uctx = this.UIDraw && this.UIDraw.ctx;
            if (uctx && uctx.canvas && this._selectionKeyframePrompt) {
                const uiW = uctx.canvas.width / (this.Draw ? this.Draw.Scale.x : 1);
                this.UIDraw.text(this._selectionKeyframePrompt, new Vector(uiW / 2, 8), '#FFE066FF', 0, 14, { align: 'center', baseline: 'top', font: 'monospace' });
            }
        } catch (e) {}
        // Prompt for frame keyframing
        try {
            const uctx = this.UIDraw && this.UIDraw.ctx;
            if (uctx && uctx.canvas && this._frameKeyframePrompt) {
                const uiW = uctx.canvas.width / (this.Draw ? this.Draw.Scale.x : 1);
                this.UIDraw.text(this._frameKeyframePrompt, new Vector(uiW / 2, 26), '#66CCFFFF', 0, 14, { align: 'center', baseline: 'top', font: 'monospace' });
            }
        } catch (e) {}
        // Draw a small bottom-right label showing the current adjust channel
        try {
            const uctx = this.UIDraw && this.UIDraw.ctx;
            if (uctx && uctx.canvas) {
                const uiW = uctx.canvas.width / (this.Draw ? this.Draw.Scale.x : 1);
                const uiH = uctx.canvas.height / (this.Draw ? this.Draw.Scale.y : 1);
                const key = this.adjustChannel || 'v';
                const ch = key.toUpperCase();
                const effMult = (key === 'h') ? 0.2 : 1.0;
                const pct = Math.round(((typeof this._getAdjustPercent === 'function' ? this._getAdjustPercent(key) : (this.adjustAmount || 0.05))) * 100 * effMult);
                const label = `Adjust: ${ch}  ${pct}%`;
                this.UIDraw.text(label, new Vector(uiW - 12, uiH - 8), '#FFFFFFFF', 1, 14, { align: 'right', baseline: 'bottom', font: 'monospace' });
            }
        } catch (e) {}
    }

    /**
     * Render the sprite editing area: a background box at `pos` with `size`,
     * and draw the specified frame from `sheet` (SpriteSheet instance).
     * `animation` is the animation name and `frame` the frame index.
     */
    displayDrawArea(pos, size, sheet, animation = 'idle', frame = 0, areaIndex = null, areaInfo = null, drawMode = 'both') {
        try {
            if (!this.Draw || !pos || !size) return;
            this.Draw.useCtx('base');
            const renderOnly = !!(areaInfo && areaInfo.renderOnly);
            const modeBase = drawMode === 'both' || drawMode === 'base';
            const modeOverlay = drawMode === 'both' || drawMode === 'overlay';
            const hideGrid = renderOnly; // renderOnly already signals "simplified" mode when zoomed out
            // draw a subtle checkerboard background for transparency
            if (modeBase) {
                if (!hideGrid) {
                    const tile = 16;
                    const cols = Math.ceil(size.x / tile);
                    const rows = Math.ceil(size.y / tile);
                    for (let y = 0; y < rows; y++) {
                        for (let x = 0; x < cols; x++) {
                            const px = pos.x + x * tile;
                            const py = pos.y + y * tile;
                            const isLight = ((x + y) % 2) === 0;
                            this.Draw.rect(new Vector(px, py), new Vector(tile, tile), isLight ? '#3a3a3aff' : '#2e2e2eff', true);
                        }
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
                const binding = (this.tilemode && typeof areaIndex === 'number' && Array.isArray(this._areaBindings)) ? this._areaBindings[areaIndex] : null;
                const coordForArea = (typeof areaIndex === 'number' && Array.isArray(this._tileIndexToCoord)) ? this._tileIndexToCoord[areaIndex] : null;
                const tileIsActive = (!this.tilemode) || (coordForArea && this._isTileActive(coordForArea.col, coordForArea.row));
                if (this.tilemode && !tileIsActive) {
                    if (modeBase) {
                        // Draw placeholder for inactive tile slot; no mirroring/binding until activated.
                        this.Draw.rect(pos, size, '#222222DD', true);
                        this.Draw.rect(pos, size, '#000000aa', false, true, 1, '#000000AA');
                        try { this.Draw.text('Press space to add tile', new Vector(pos.x + 8, pos.y + 12), '#AAAAAA', 0, 12, { align: 'left', baseline: 'top', font: 'monospace' }); } catch (e) {}
                    }
                    return;
                }
                let effAnim = null;
                let effFrame = null;
                let isMirrored = false;
                if (binding && binding.anim !== undefined && binding.index !== undefined) {
                    effAnim = binding.anim;
                    effFrame = binding.index;
                } else {
                    // Unbound: visually mirror the selected frame when in tilemode
                    effAnim = this.selectedAnimation;
                    effFrame = this.selectedFrame;
                    isMirrored = !!this.tilemode;
                }
                const frameCanvas = (effAnim !== null && typeof sheet.getFrame === 'function') ? sheet.getFrame(effAnim, effFrame) : null;
                const padding = 0;
                const dstW = Math.max(1, size.x - padding * 2);
                const dstH = Math.max(1, size.y - padding * 2);
                const dstPos = new Vector(pos.x + (size.x - dstW) / 2, pos.y + (size.y - dstH) / 2);
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
                                                const fCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(effAnim, ii) : null;
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
                                        const fCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(effAnim, idx) : null;
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
                                // fallback to sheet if transform draw fails
                                if (!layeredCanvas) this.Draw.sheet(sheet, dstPos, new Vector(dstW, dstH), effAnim, effFrame, null, 1, false);
                                else this.Draw.image(layeredCanvas, dstPos, new Vector(dstW, dstH), null, 0, 1, false);
                            }
                        } else if (layeredCanvas) {
                            this.Draw.image(layeredCanvas, dstPos, new Vector(dstW, dstH), null, 0, 1, false);
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
            const posInfoGlobal = this.getPos(this.mouse && this.mouse.pos);
            const hoveredInside = !!(posInfoGlobal && posInfoGlobal.inside);
            const hoveredAreaIndex = hoveredInside ? posInfoGlobal.areaIndex : null;
            const areaInfo = (Array.isArray(this._drawAreas) && typeof areaIndex === 'number')
                ? this._drawAreas.find(a => a && a.areaIndex === areaIndex)
                : null;

            // Render-only handled separately to avoid per-area stacking
            if (isRenderOnly) return;

            // If there is an active selection tied to this area, always draw it here
            // even if the cursor is hovering a different tile.
            const selectionAnchoredHere = !!(this.tilemode && typeof areaIndex === 'number' && (
                (this.selectionPoints && this.selectionPoints.some(p => typeof p?.areaIndex === 'number' && p.areaIndex === areaIndex)) ||
                (this.selectionRegion && typeof this.selectionRegion.areaIndex === 'number' && this.selectionRegion.areaIndex === areaIndex)
            ));

            if (this.tilemode && typeof hoveredAreaIndex === 'number' && !selectionAnchoredHere) {
                try {
                    const hoveredBinding = this.getAreaBinding(hoveredAreaIndex) || null;
                    const hoveredAnim = (hoveredBinding && hoveredBinding.anim) ? hoveredBinding.anim : this.selectedAnimation;
                    const hoveredFrame = (hoveredBinding && typeof hoveredBinding.index === 'number') ? Number(hoveredBinding.index) : this.selectedFrame;

                    const thisBinding = binding || null;
                    const thisAnim = (thisBinding && thisBinding.anim) ? thisBinding.anim : effAnim;
                    const thisFrame = (thisBinding && typeof thisBinding.index === 'number') ? Number(thisBinding.index) : effFrame;

                    // If this tile does not mirror the same effective frame
                    // as the tile under the cursor, skip all preview drawing
                    // for this area.
                    if (!(hoveredAnim === thisAnim && hoveredFrame === thisFrame)) {
                        return;
                    }
                } catch (e) {
                    // If matching fails for any reason, fall back to drawing
                    // the preview to avoid breaking basic cursor behavior.
                }
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
            if (this.clipboardPreview && this.clipboard) {
                try {
                    const cb = this.clipboard;
                    // mouse position in frame coords
                    const posInfo = posInfoGlobal;
                    if (!posInfo || !posInfo.inside) return;
                    // determine frozen placement if dragging, otherwise compute placement aligning origin under mouse
                    const ox = (cb.originOffset && typeof cb.originOffset.ox === 'number') ? cb.originOffset.ox : 0;
                    const oy = (cb.originOffset && typeof cb.originOffset.oy === 'number') ? cb.originOffset.oy : 0;
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
                        const ox = (cb.originOffset && typeof cb.originOffset.ox === 'number') ? cb.originOffset.ox : 0;
                        const oy = (cb.originOffset && typeof cb.originOffset.oy === 'number') ? cb.originOffset.oy : 0;
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
            const anchor = (this.selectionPoints && this.selectionPoints.length > 0) ? this.selectionPoints[0] : null;
            const anchorArea = (anchor && typeof anchor.areaIndex === 'number') ? anchor.areaIndex : null;

            // Only show shape previews on the anchor's tile when known to avoid duplication across tiles.
            if (anchorArea !== null && typeof areaIndex === 'number' && areaIndex !== anchorArea) {
                return;
            }

            // Determine mouse pixel even when off-frame for circle/line previews.
            let mousePixelPos = null;
            if (posInfo && posInfo.inside && (anchorArea === null || posInfo.areaIndex === anchorArea)) {
                mousePixelPos = { x: posInfo.x, y: posInfo.y };
            } else if (anchor) {
                const fallback = this._unclampedPixelForArea(anchorArea !== null ? anchorArea : areaIndex, this.mouse && this.mouse.pos);
                if (fallback) mousePixelPos = { x: fallback.x, y: fallback.y };
            }

            if (mousePixelPos) {
                // Color tokens: default white, switch to yellow when pixel-perfect pen enabled
                const previewLineColor = this.pixelPerfect ? '#FFFF0088' : '#FFFFFF88';
                const previewFillColor = this.pixelPerfect ? '#FFFF0044' : '#FFFFFF44';
                const cursorFillColor = this.pixelPerfect ? '#FFFF0022' : '#FFFFFF22';
                const cursorOutlineColor = this.pixelPerfect ? '#FFFF00EE' : '#FFFFFFEE';

                if (this.currentTool === 'line' && this.selectionPoints.length === 1) {
                    this.drawLine(this.selectionPoints[0], mousePixelPos, previewLineColor);
                } else if (this.currentTool === 'box' && this.selectionPoints.length === 1) {
                    this.drawBox(this.selectionPoints[0], mousePixelPos, previewLineColor, this.keys.held('Alt'));
                } else if (this.currentTool === 'circle' && this.selectionPoints && this.selectionPoints.length > 0 && typeof this.computeCirclePixels === 'function') {
                    // For circles, allow preview with either a single anchor pixel
                    // or an even-centered 2x2 anchor (4 pixels). In both cases we
                    // pass the first point; computeCirclePixels will adjust center
                    // when 4 points + brushSize == 2.
                    const start = this.selectionPoints[0];
                    const end = mousePixelPos;
                    const filled = this.keys.held('Alt');
                    const circlePixels = this.computeCirclePixels(start, end, filled) || [];
                    for (const p of circlePixels) {
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

    drawLine(start, end, color) {
        // Bresenham's line algorithm
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
            this.drawPixel(x0, y0, color);

            if ((x0 === x1) && (y0 === y1)) break;
            let e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x0 += sx; }
            if (e2 < dx) { err += dx; y0 += sy; }
        }
    }

    drawBox(start, end, color, filled) {
        const minX = Math.min(start.x, end.x);
        const minY = Math.min(start.y, end.y);
        const maxX = Math.max(start.x, end.x);
        const maxY = Math.max(start.y, end.y);

        if (filled) {
            for (let y = minY; y <= maxY; y++) {
                for (let x = minX; x <= maxX; x++) {
                    this.drawPixel(x, y, color);
                }
            }
        } else {
            for (let x = minX; x <= maxX; x++) {
                this.drawPixel(x, minY, color);
                this.drawPixel(x, maxY, color);
            }
            for (let y = minY + 1; y < maxY; y++) {
                this.drawPixel(minX, y, color);
                this.drawPixel(maxX, y, color);
            }
        }
    }

    drawPixel(x, y, color) {
        // prefer the area the user last interacted with; fallback to centered area
        let area = null;
        if (typeof this._activeDrawAreaIndex === 'number' && Array.isArray(this._drawAreas) && this._drawAreas[this._activeDrawAreaIndex]) {
            area = this._drawAreas[this._activeDrawAreaIndex];
        }
        if (!area) area = this.computeDrawArea();
        if (!area) return;
        const cellW = area.dstW / this.currentSprite.slicePx;
        const cellH = area.dstH / this.currentSprite.slicePx;
        const cellX = area.dstPos.x + x * cellW;
        const cellY = area.dstPos.y + y * cellH;
        this.Draw.rect(new Vector(cellX, cellY), new Vector(cellW, cellH), color, true);
    }

    // Draw the tile cursor, selection outlines, and paste preview once per frame.
    _drawTileCursorOverlay() {
        try {
            if (!this.tilemode) return;
            const baseArea = (typeof this.computeDrawArea === 'function') ? this.computeDrawArea() : null;
            if (!baseArea) return;
            const basePos = baseArea.topLeft;
            const tileSize = baseArea.size;
            // anchor tile (last hovered or explicit)
            const anchor = this._tileHoverAnchor ? { ...this._tileHoverAnchor } : null;

            // Draw selection outlines for selected tiles — only when relevant renderOnly areas exist
            try {
                let showTileSelection = false;
                if (this._tileSelection && this._tileSelection.size > 0) {
                    for (const key of this._tileSelection) {
                        const c = this._parseTileKey(key);
                        if (!c) continue;
                        // try to find in current draw areas first
                        const idx = this._getAreaIndexForCoord(c.col, c.row);
                        let areaInfo = (Array.isArray(this._drawAreas) && typeof idx === 'number') ? this._drawAreas.find(a => a && a.areaIndex === idx) : null;
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
                // also allow selection drawing when anchor is over a renderOnly tile
                if (!showTileSelection && anchor) {
                    const aidx = this._getAreaIndexForCoord(anchor.col, anchor.row);
                    let ainfo = (Array.isArray(this._drawAreas) && typeof aidx === 'number') ? this._drawAreas.find(a => a && a.areaIndex === aidx) : null;
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

            // Tile cursor (single rect matching brush footprint) — only draw when anchor area is renderOnly
            if (anchor) {
                let showCursor = false;
                try {
                    const aidx = this._getAreaIndexForCoord(anchor.col, anchor.row);
                    let ainfo = (Array.isArray(this._drawAreas) && typeof aidx === 'number') ? this._drawAreas.find(a => a && a.areaIndex === aidx) : null;
                    if (!ainfo) {
                        try { const pos = this._tileCoordToPos(anchor.col, anchor.row, basePos, tileSize); ainfo = this.computeAreaInfo(pos, tileSize); if (ainfo) ainfo.renderOnly = this._isSimTooSmall(ainfo); } catch(e) { ainfo = null; }
                    }
                    if (ainfo && ainfo.renderOnly) showCursor = true;
                } catch (e) { showCursor = false; }
                if (showCursor) {
                const side = Math.max(1, Math.min(15, this.brushSize || 1));
                const start = -Math.floor(side / 2);
                const topLeftTile = { col: anchor.col + start, row: anchor.row + start };
                const topLeft = this._tileCoordToPos(topLeftTile.col, topLeftTile.row, basePos, tileSize);
                const rectPos = topLeft;
                const rectSize = new Vector(side * tileSize.x, side * tileSize.y);
                const cursorFill = '#FFFFFF22';
                const cursorStroke = '#FFFFFFEE';
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
            if (showPreview && this._tileClipboard && anchor) {
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
                for (const t of tiles) {
                    const gx = anchor.col + (t.dc|0);
                    const gy = anchor.row + (t.dr|0);
                    const gPos = this._tileCoordToPos(gx, gy, basePos, tileSize);
                    drawTilePreview(t.binding, t.transform, gPos);
                }
            }
        } catch (e) { /* ignore overlay draw errors */ }
    }
}
