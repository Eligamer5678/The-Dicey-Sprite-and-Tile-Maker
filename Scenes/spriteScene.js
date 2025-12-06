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
        // which channel to adjust with h/k: 'h'|'s'|'v'|'a'
        this.adjustChannel = 'v';
        // linear adjustment amount (0-1 for S/V/A, wrapped for H)
        this.adjustAmount = 0.05;
        // zoom limits and smoothing params
        this.minZoom = 0.25;
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

        // region-based selection (for cut/copy/paste)
        this.selectionRegion = null;
        // clipboard stores { w, h, data(Uint8ClampedArray), originOffset: {ox,oy} }
        this.clipboard = null;
        // transient flag set when a paste just occurred to avoid key-order races
        this._justPasted = false;
        this.tilemode = false;

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
                    try { img = ctx.getImageData(0, 0, w, h); } catch (e) { window.Debug && window.Debug.error && window.Debug.error('SelectColor: getImageData failed'); return; }
                    const data = img.data;

                    const matches = [];
                    const maxDistSq = tol * tol;
                    for (let y = 0; y < h; y++) {
                        for (let x = 0; x < w; x++) {
                            const i = (y * w + x) * 4;
                            const r = data[i];
                            const g = data[i + 1];
                            const b = data[i + 2];
                            const dr = r - tr;
                            const dg = g - tg;
                            const db = b - tb;
                            const distSq = dr * dr + dg * dg + db * db;
                            if (distSq <= maxDistSq) {
                                matches.push({ x, y });
                            }
                        }
                    }

                    // set selection to the matched points
                    this.selectionPoints = matches;
                    this.selectionRegion = null;
                    window.Debug && window.Debug.log && window.Debug.log(`SelectColor: selected ${matches.length} pixels matching ${hex} (tol=${tol})`);
                } catch (err) {
                    window.Debug && window.Debug.error && window.Debug.error('SelectColor failed: ' + err);
                }
            });
        } catch (e) {
            console.warn('Failed to register select debug signal', e);
        }

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
        // mark not ready so switching back will re-run onReady
        this.isReady = false;
        // call parent behaviour
        if (super.onSwitchFrom) try { super.onSwitchFrom(resources); } catch(e){}
        

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
        if (this.keys && this.keys.held && this.keys.held('Shift')) {
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
            this._activeDrawAreaIndex = null;
            if (Array.isArray(this._drawAreas) && this._drawAreas.length > 0) {
                for (let i = 0; i < this._drawAreas.length; i++) {
                    const a = this._drawAreas[i];
                    if (!a) continue;
                    if (mx >= a.dstPos.x && my >= a.dstPos.y && mx <= a.dstPos.x + a.dstW && my <= a.dstPos.y + a.dstH) {
                        area = a;
                        this._activeDrawAreaIndex = i;
                        break;
                    }
                }
            }

            // fallback to single centered area
            if (!area) {
                area = this.computeDrawArea();
                this._activeDrawAreaIndex = null;
            }
            if (!area) return null;

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
            const px = Math.min(this.currentSprite.slicePx - 1, Math.max(0, Math.floor(relX * this.currentSprite.slicePx)));
            const py = Math.min(this.currentSprite.slicePx - 1, Math.max(0, Math.floor(relY * this.currentSprite.slicePx)));
            return { inside: true, x: px, y: py, relX, relY, areaIndex: this._activeDrawAreaIndex };
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
            if (typeof this._activeDrawAreaIndex === 'number' && Array.isArray(this._drawAreas) && this._drawAreas[this._activeDrawAreaIndex]) {
                area = this._drawAreas[this._activeDrawAreaIndex];
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
        this.mouse.setMask(0)
        this.FrameSelect.update()
        this.mouse.setPower(0)
        // handle numeric keys to change brush size (1..4)
        try {
            if (this.keys && this.keys.released) {
                if (this.keys.released('1')) this.brushSize = 1;
                if (this.keys.released('2')) this.brushSize = 2;
                if (this.keys.released('3')) this.brushSize = 3;
                if (this.keys.released('4')) this.brushSize = 4;
                // choose which channel to adjust with h/k: 6->H, 7->S, 8->V, 9->A
                if (this.keys.released('6')) this.adjustChannel = 'h';
                if (this.keys.released('7')) this.adjustChannel = 's';
                if (this.keys.released('8')) this.adjustChannel = 'v';
                if (this.keys.released('9')) this.adjustChannel = 'a';
            }
        } catch (e) { /* ignore */ }
        if (this.keys.released('t')){
            if(this.tilemode) {
                this.tilemode = false;
            } else {
                this.tilemode = true;
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
                        const pos = this.getPos(this.mouse && this.mouse.pos);
                        if (pos && pos.inside && typeof pos.areaIndex === 'number') {
                            // determine which frame to bind: prefer single multi-selected frame in FrameSelect
                            let frameIdx = this.selectedFrame;
                            let anim = this.selectedAnimation;
                            try {
                                const fs = this.FrameSelect;
                                if (fs && fs._multiSelected && fs._multiSelected.size === 1) {
                                    frameIdx = Array.from(fs._multiSelected)[0];
                                }
                            } catch (e) {}
                            // Toggle behavior: if area already bound to same anim/frame, clear it
                            const existing = (Array.isArray(this._areaBindings) && this._areaBindings[pos.areaIndex]) ? this._areaBindings[pos.areaIndex] : null;
                            if (existing && existing.anim === anim && Number(existing.index) === Number(frameIdx)) {
                                this.clearAreaBinding(pos.areaIndex);
                            } else {
                                this.bindArea(pos.areaIndex, anim, frameIdx);
                            }
                        }
                    }
                } catch (e) { console.warn('area bind key failed', e); }

                    // Rotate / Flip preview and commit handlers for area under mouse
                    try {
                        const posForTransform = this.getPos(this.mouse && this.mouse.pos);
                        if (posForTransform && posForTransform.inside && typeof posForTransform.areaIndex === 'number') {
                            const ai = posForTransform.areaIndex;
                            // Rotate: plain 'r' = preview rotate 90deg CW, Shift+'r' = commit rotate to frame data
                            if ((this.keys.released('R')||this.keys.released('r'))) {
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

                // tools (pen) operate during ticks
                this.selectionTool && this.selectionTool();
                this.penTool && this.penTool();
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
            if (!pos || !pos.inside) return;
            const sheet = this.currentSprite;
            // if mouse is over a bound area, use that binding for target anim/frame
            const areaBinding = (pos && typeof pos.areaIndex === 'number' && Array.isArray(this._areaBindings)) ? this._areaBindings[pos.areaIndex] : null;
            // determine draw target: if area has a binding use it, otherwise use the global selected
            // (unassigned areas visually mirror the selected frame and edits should affect the selected frame)
            // Note: we no longer block drawing into unbound areas; they target `selectedAnimation/selectedFrame`.
            const targetAnim = (areaBinding && areaBinding.anim) ? areaBinding.anim : this.selectedAnimation;
            const targetFrame = (areaBinding && typeof areaBinding.index === 'number') ? areaBinding.index : this.selectedFrame;
            const color = this.penColor || '#000000';
            const side = Math.max(1, Math.min(4, this.brushSize || 1));
            const half = Math.floor((side - 1) / 2);
            if (this.mouse.held('left')) { // draw an NxN square centered on cursor (top-left bias for even sizes)
                const sx = pos.x - half;
                const sy = pos.y - half;
                if (typeof sheet.fillRect === 'function') {
                    sheet.fillRect(targetAnim, targetFrame, sx, sy, side, side, color, 'replace');
                } else {
                    for (let yy = 0; yy < side; yy++) {
                        for (let xx = 0; xx < side; xx++) {
                            try { sheet.setPixel(targetAnim, targetFrame, sx + xx, sy + yy, color, 'replace'); } catch (e) {}
                        }
                    }
                }
                // update packed sheet for preview
                if (typeof sheet._rebuildSheetCanvas === 'function') {
                    try { sheet._rebuildSheetCanvas(); } catch (e) {}
                }
            }
            if (this.mouse.held('right')) { // erase NxN square
                const eraseColor = '#00000000';
                const sx = pos.x - half;
                const sy = pos.y - half;
                if (typeof sheet.fillRect === 'function') {
                    sheet.fillRect(targetAnim, targetFrame, sx, sy, side, side, eraseColor, 'replace');
                } else {
                    for (let yy = 0; yy < side; yy++) {
                        for (let xx = 0; xx < side; xx++) {
                            try { sheet.setPixel(targetAnim, targetFrame, sx + xx, sy + yy, eraseColor, 'replace'); } catch (e) {}
                        }
                    }
                }
                if (typeof sheet._rebuildSheetCanvas === 'function') {
                    try { sheet._rebuildSheetCanvas(); } catch (e) {}
                }
            }
            
        } catch (e) {
            console.warn('penTool failed', e);
        }
    }

    selectionTool() {
        try {
            if (!this.mouse) return;

            // Right click to cancel selection (also clear any region selection)
            if (this.mouse.pressed('right') && this.selectionPoints.length !== 0) {
                this.selectionPoints = [];
                this.currentTool = null;
                this.selectionRegion = null;
                this.mouse.pause(0.3)
            }

            // Clear clipboard preview when Alt is released or preview expired
            if (this.clipboardPreview && (!this.keys.held('v'))) {
                this.clipboardPreview = false;
                this._clipboardPreviewDragging = null;
                this.keys.resetPasscode();
            }

            // Ctrl + Left = eyedropper: pick color from the current frame under the mouse
            if (this.keys.held('Control')) {
                try {
                    const pos = this.getPos(this.mouse.pos);
                    if (pos && pos.inside && this.currentSprite) {
                        const sheet = this.currentSprite;
                        // Prefer the frame bound to the area under the mouse. Fall back to selected frame.
                        let anim = this.selectedAnimation;
                        let frameIdx = this.selectedFrame;
                        if (typeof pos.areaIndex === 'number') {
                            const binding = this.getAreaBinding(pos.areaIndex);
                            if (binding && binding.anim !== undefined && binding.index !== undefined) {
                                anim = binding.anim;
                                frameIdx = Number(binding.index);
                            }
                        }
                        const frameCanvas = sheet.getFrame(anim, frameIdx);
                        if (frameCanvas) {
                            const ctx = frameCanvas.getContext('2d');
                            try {
                                const d = ctx.getImageData(pos.x, pos.y, 1, 1).data;
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
                } catch (e) {
                    console.warn('eyedropper failed', e);
                }
            }

            // Shift + Left click to add a point (avoid double-selecting the same pixel)
            if (this.keys.held('Shift') && this.mouse.held('left')) {
                const pos = this.getPos(this.mouse.pos);
                if (pos && pos.inside) {
                    const exists = this.selectionPoints.some(p => p.x === pos.x && p.y === pos.y && p.areaIndex === pos.areaIndex);
                    if (!exists) {
                        // record the area index where this point was added so copy/cut can use the originating frame
                        this.selectionPoints.push({ x: pos.x, y: pos.y, areaIndex: (typeof pos.areaIndex === 'number') ? pos.areaIndex : null });
                        // adding a new anchor invalidates any previous region selection
                        this.selectionRegion = null;
                    }
                }
            }

            // set tool keys when we have a single anchor point
            if (this.selectionPoints.length === 1) {
                if (this.keys.pressed('l')) {
                    this.currentTool = 'line';
                }
                if (this.keys.pressed('b')) {
                    this.currentTool = 'box';
                }

                // If user clicks left (without Shift) while a tool is active, commit the selection
                // This draws the computed pixels into the current sprite/frame.
                if (!this.keys.held('Shift') && this.mouse.pressed('left') && this.currentTool) {
                    const pos = this.getPos(this.mouse.pos);
                    if (pos && pos.inside) {
                        const start = this.selectionPoints[0];
                        const end = { x: pos.x, y: pos.y };
                        this.commitSelection(start, end);
                        // clear selection after commit
                        this.selectionPoints = [];
                        this.currentTool = null;
                    }
                }
            }

            // If two points are present and user presses 'b', create a region selection (don't draw).
            // This sets up for cut/copy/paste workflows.
            if (this.selectionPoints.length === 2) {
                if (this.keys.pressed('b')) {
                    const start = this.selectionPoints[0];
                    const end = this.selectionPoints[1];
                    const filled = this.keys.held('Alt');
                    // store as a selection region instead of committing pixels
                        // record the areaIndex for the region if both points came from the same area
                        let areaIdx = null;
                        if (start && end && start.areaIndex === end.areaIndex) areaIdx = start.areaIndex;
                        this.selectionRegion = { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y }, filled, areaIndex: areaIdx };
                    // consume anchor points
                    this.selectionPoints = [];
                    this.currentTool = null;
                }
            }

            // Clipboard operations: copy (c), cut (x), paste (v)
            // Copy/Cut operate on active selectionRegion or explicit selectionPoints.
            // Holding 'v' previews clipboard; releasing 'v' pastes at the mouse pixel.
            try {
                if (this.keys.held('v')) {
                    this.clipboardPreview = true;
                    this.keys.setPasscode('pasteMode'); 
                }
                if (this.keys.pressed('c')) {
                    if (this.selectionRegion || (this.selectionPoints && this.selectionPoints.length > 0)) this.doCopy();
                }
                if (this.keys.pressed('x')) {
                    if (this.selectionRegion || (this.selectionPoints && this.selectionPoints.length > 0)) this.doCut();
                }
                if (this.keys.released('v')) {
                    // paste at mouse pixel position using stored origin offset
                    if (this.clipboard) {
                        this.doPaste(this.mouse && this.mouse.pos);
                        // mark that a paste just occurred so we can avoid key-order races
                        this._justPasted = true;
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

            // Fill bucket: on 'f' release, flood-fill the area under the mouse
            try {
                // Prevent fill while clipboard preview/pasting (v) is active
                if (this.keys.held('f', true) > 1 || this.keys.pressed('f')&&!this.keys.held('Alt')) {
                    console.log('hello')
                    const pos = this.getPos(this.mouse && this.mouse.pos);
                    if (!pos || !pos.inside) return;
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
                        // target fill color from penColor (convert to rgba 0..255)
                        const fillCol = Color.convertColor(this.penColor || '#000000');
                        const fRgb = fillCol.toRgb();
                        const fillR = Math.round(fRgb.a || 0);
                        const fillG = Math.round(fRgb.b || 0);
                        const fillB = Math.round(fRgb.c || 0);
                        const fillA = Math.round((fRgb.d || 1) * 255);
                        // If target color equals fill color, nothing to do
                        if (srcR === fillR && srcG === fillG && srcB === fillB && srcA === fillA) return;

                        const shiftHeld = this.keys.held('a');
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
                const applyAdjust = (delta) => {
                    const sheet = this.currentSprite;
                    const anim = this.selectedAnimation;
                    const frameIdx = this.selectedFrame;
                    if (!sheet) return;
                    const channel = this.adjustChannel || 'v';
                    // Reduce hue adjustments to a smaller fraction so keys change hue more finely
                    const channelMultiplier = (channel === 'h') ? 0.2 : 1.0;
                    const appliedDelta = delta * channelMultiplier;

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
                                const newHex = this.rgbaToHex(Math.round(rgb.a), Math.round(rgb.b), Math.round(rgb.c), Math.round((rgb.d || 1) * 255));
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
                                        data[idx+3] = Math.round((rgb.d || 1) * 255);
                                    } catch (e) { /* ignore per-pixel errors */ }
                                }
                            }
                            ctx.putImageData(img, minX, minY);
                            if (typeof sheet._rebuildSheetCanvas === 'function') try { sheet._rebuildSheetCanvas(); } catch(e){}
                        } catch (e) { /* ignore region read/write errors */ }
                    }
                };
                if (this.keys && typeof this.keys.released === 'function') {
                    if (this.keys.released('h')) {
                        applyAdjust(this.adjustAmount); // additive lighten on selected channel
                    }
                    if (this.keys.released('k')) {
                        applyAdjust(-this.adjustAmount); // additive darken on selected channel
                    }
                }
            } catch (e) { console.warn('lighten/darken (h/k) failed', e); }

            // Add subtle noise/randomness to the current frame on 'n' release
            try {
                if (this.keys && typeof this.keys.released === 'function' && this.keys.held('n')) {
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
                        // Value/hue noise parameters
                        const valueStrength = 1; // larger uniform value change (applied equally to R/G/B)
                        const hueStrength = 0.00001; // small hue shift (in 0..1 space)

                        // Helper to apply noise to a pixel index:
                        // 1) add a single random delta to all RGB channels (value change)
                        // 2) apply a smaller random hue rotation
                        const applyNoiseAtIdx = (idx) => {
                            const r = data[idx];
                            const g = data[idx + 1];
                            const b = data[idx + 2];
                            const a = data[idx + 3];

                            // uniform value change
                            const deltaV = Math.floor(Math.random() * (valueStrength * 2 + 1)) - valueStrength;
                            let nr = r + deltaV;
                            let ng = g + deltaV;
                            let nb = b + deltaV;
                            // clamp preliminarily
                            nr = Math.max(0, Math.min(255, nr));
                            ng = Math.max(0, Math.min(255, ng));
                            nb = Math.max(0, Math.min(255, nb));

                            try {
                                // small hue rotation
                                const hex = this.rgbaToHex(nr, ng, nb, a);
                                const col = Color.convertColor(hex);
                                const hsv = col.toHsv(); // {a:h, b:s, c:v, d:alpha}
                                const deltaH = (Math.random() * 2 - 1) * hueStrength;
                                hsv.a = (hsv.a + deltaH) % 1; if (hsv.a < 0) hsv.a += 1;
                                const rgb = hsv.toRgb(); // returns Color with rgb in a,b,c
                                data[idx] = Math.round(rgb.a);
                                data[idx + 1] = Math.round(rgb.b);
                                data[idx + 2] = Math.round(rgb.c);
                                // keep original alpha
                                data[idx + 3] = a;
                            } catch (e) {
                                // fallback: write the uniform-changed RGB if color math fails
                                data[idx] = nr;
                                data[idx + 1] = ng;
                                data[idx + 2] = nb;
                                data[idx + 3] = a;
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
                    if (this._clipboardPreviewDragging && this.mouse.held('left')) {
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
                    if (this._clipboardPreviewDragging && !this.mouse.held('left')) {
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
            }

            if (!pixels || pixels.length === 0) return;

            const sheet = this.currentSprite;
            // Prefer the area where the selection originated (start point), then selectionRegion's areaIndex,
            // then the current mouse-over area. Fall back to selectedAnimation/selectedFrame.
            let anim = this.selectedAnimation;
            let frameIdx = this.selectedFrame;
            let sourceAreaIndex = null;
            if (start && typeof start.areaIndex === 'number') sourceAreaIndex = start.areaIndex;
            else if (this.selectionRegion && typeof this.selectionRegion.areaIndex === 'number') sourceAreaIndex = this.selectionRegion.areaIndex;
            else {
                const posInfo = this.getPos(this.mouse && this.mouse.pos) || {};
                if (posInfo && typeof posInfo.areaIndex === 'number') sourceAreaIndex = posInfo.areaIndex;
            }
            if (typeof sourceAreaIndex === 'number') {
                const binding = this.getAreaBinding(sourceAreaIndex);
                if (binding && binding.anim !== undefined && binding.index !== undefined) {
                    anim = binding.anim;
                    frameIdx = Number(binding.index);
                }
            }
            const color = this.penColor || '#000000';

            for (const p of pixels) {
                // clamp
                const x = Math.max(0, Math.min((sheet.slicePx || 1) - 1, p.x));
                const y = Math.max(0, Math.min((sheet.slicePx || 1) - 1, p.y));
                if (typeof sheet.setPixel === 'function') {
                    try { sheet.setPixel(anim, frameIdx, x, y, color, 'replace'); } catch (e) { /* ignore per-pixel errors */ }
                } else if (typeof sheet.modifyFrame === 'function') {
                    try { sheet.modifyFrame(anim, frameIdx, { x, y, color, blendType: 'replace' }); } catch (e) { }
                }
            }

            // rebuild packed sheet if available so drawing code picks up changes
            if (typeof sheet._rebuildSheetCanvas === 'function') {
                try { sheet._rebuildSheetCanvas(); } catch (e) { }
            }
        } catch (e) {
            console.warn('commitSelection failed', e);
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

    // Copy the pixels inside this.selectionRegion into this.clipboard.
    doCopy() {
        try {
            const sheet = this.currentSprite;
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
        } catch (e) {
            console.warn('doCopy failed', e);
        }
    }

    // Cut: copy then clear the source pixels (set transparent)
    doCut() {
        try {
            if (!this.currentSprite) return;
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
            if (!this.clipboard || !this.currentSprite) return;
            const sheet = this.currentSprite;
            // determine destination animation/frame based on mouse-over area (where paste occurs)
            const posInfo = this.getPos(mousePos);
            let anim = this.selectedAnimation;
            let frameIdx = this.selectedFrame;
            if (posInfo && typeof posInfo.areaIndex === 'number') {
                const binding = this.getAreaBinding(posInfo.areaIndex);
                if (binding && binding.anim !== undefined && binding.index !== undefined) {
                    anim = binding.anim;
                    frameIdx = Number(binding.index);
                }
            }
            // determine mouse pixel position in frame coords
            const pos = posInfo || this.getPos(mousePos);
            if (!pos || !pos.inside) return;
            // handle point-list clipboard
            if (this.clipboard.type === 'points') {
                const pixels = this.clipboard.pixels || [];
                const ox = (this.clipboard.originOffset && typeof this.clipboard.originOffset.ox === 'number') ? this.clipboard.originOffset.ox : 0;
                const oy = (this.clipboard.originOffset && typeof this.clipboard.originOffset.oy === 'number') ? this.clipboard.originOffset.oy : 0;
                const targetX = pos.x - ox;
                const targetY = pos.y - oy;
                for (const p of pixels) {
                    const destX = targetX + p.x;
                    const destY = targetY + p.y;
                    if (destX < 0 || destY < 0 || destX >= (sheet.slicePx || 0) || destY >= (sheet.slicePx || 0)) continue;
                    if (p.a === 0) continue;
                    const hex = this.rgbaToHex(p.r, p.g, p.b, p.a);
                    if (typeof sheet.setPixel === 'function') {
                        try { sheet.setPixel(anim, frameIdx, destX, destY, hex, 'replace'); } catch (e) { }
                    } else if (typeof sheet.modifyFrame === 'function') {
                        try { sheet.modifyFrame(anim, frameIdx, { x: destX, y: destY, color: hex, blendType: 'replace' }); } catch (e) { }
                    }
                }
                if (typeof sheet._rebuildSheetCanvas === 'function') {
                    try { sheet._rebuildSheetCanvas(); } catch (e) { }
                }
                return;
            }

            // image clipboard paste (existing behavior)
            const targetX = pos.x - (this.clipboard.originOffset ? this.clipboard.originOffset.ox : 0);
            const targetY = pos.y - (this.clipboard.originOffset ? this.clipboard.originOffset.oy : 0);
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
                    // skip fully transparent pixels to avoid overwriting
                    if (a === 0) continue;
                    const destX = targetX + xx;
                    const destY = targetY + yy;
                    if (destX < 0 || destY < 0 || destX >= (sheet.slicePx || 0) || destY >= (sheet.slicePx || 0)) continue;
                    const hex = this.rgbaToHex(r, g, b, a);
                    if (typeof sheet.setPixel === 'function') {
                        try { sheet.setPixel(anim, frameIdx, destX, destY, hex, 'replace'); } catch (e) { }
                    } else if (typeof sheet.modifyFrame === 'function') {
                        try { sheet.modifyFrame(anim, frameIdx, { x: destX, y: destY, color: hex, blendType: 'replace' }); } catch (e) { }
                    }
                }
            }
            if (typeof sheet._rebuildSheetCanvas === 'function') {
                try { sheet._rebuildSheetCanvas(); } catch (e) { }
            }
        } catch (e) {
            console.warn('doPaste failed', e);
        }
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
    bindArea(areaIndex, anim, frameIdx) {
        try {
            if (typeof areaIndex !== 'number' || areaIndex < 0) return false;
            if (!this._areaBindings) this._areaBindings = [];
            this._areaBindings[areaIndex] = { anim: anim || this.selectedAnimation, index: Number(frameIdx) || 0 };
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

            // Build all displayed tile positions (center + neighbors when tilemode)
            const positions = [];
            positions.push(center.clone());
            if (this.tilemode) {
                positions.push(center.clone().add(size));
                positions.push(center.clone().sub(size));
                positions.push(new Vector(center.x, center.y + size.y));
                positions.push(new Vector(center.x, center.y - size.y));
                positions.push(new Vector(center.x + size.x, center.y - size.y));
                positions.push(new Vector(center.x + size.x, center.y));
                positions.push(new Vector(center.x - size.x, center.y));
                positions.push(new Vector(center.x - size.x, center.y + size.y));
            }

            // compute and cache area infos for input mapping
            const areas = [];
            for (const p of positions) {
                const info = this.computeAreaInfo(p, size);
                if (info) areas.push(info);
            }
            this._drawAreas = areas;

            // render each area and pass area index so display can show bindings
            for (let i = 0; i < positions.length; i++) {
                this.displayDrawArea(positions[i], size, this.currentSprite, this.selectedAnimation, this.selectedFrame, i);
            }
        }

        // Remove previous transform container to prevent transform stacking
        this.Draw.popMatrix()
        this.UIDraw.useCtx('UI');
        this.UIDraw.clear()
        this.FrameSelect.draw()
        // Draw a small bottom-right label showing the current adjust channel
        try {
            const uctx = this.UIDraw && this.UIDraw.ctx;
            if (uctx && uctx.canvas) {
                const uiW = uctx.canvas.width / (this.Draw ? this.Draw.Scale.x : 1);
                const uiH = uctx.canvas.height / (this.Draw ? this.Draw.Scale.y : 1);
                const ch = (this.adjustChannel || 'v').toUpperCase();
                const effMult = (this.adjustChannel === 'h') ? 0.2 : 1.0;
                const pct = Math.round((this.adjustAmount || 0.05) * 100 * effMult);
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
    displayDrawArea(pos, size, sheet, animation = 'idle', frame = 0, areaIndex = null) {
        try {
            if (!this.Draw || !pos || !size) return;
            this.Draw.useCtx('base');
            // draw a subtle checkerboard background for transparency
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

            // draw border
            this.Draw.rect(pos, size, '#FFFFFF88', false, true, 2, '#FFFFFF88');

            // show binding label if this area is bound to a frame; otherwise show faint mirrored note when tilemode
            try {
                if (typeof areaIndex === 'number' && Array.isArray(this._areaBindings) && this._areaBindings[areaIndex]) {
                    const b = this._areaBindings[areaIndex];
                    const label = (b && b.anim) ? `${b.anim}:${b.index}` : String(b && b.index);
                    this.Draw.text(label, new Vector(pos.x + 6, pos.y + 14), '#FFFFFF', 0, 12, { align: 'left', baseline: 'top', font: 'monospace' });
                } else if (this.tilemode) {
                    this.Draw.text('(mirrored)', new Vector(pos.x + 6, pos.y + 14), '#AAAAAA', 0, 12, { align: 'left', baseline: 'top', font: 'monospace' });
                }
            } catch (e) { }

            // draw the frame image centered inside the box with some padding
            if (sheet) {
                // determine effective animation/frame for this area (respect bindings)
                const binding = (typeof areaIndex === 'number' && Array.isArray(this._areaBindings)) ? this._areaBindings[areaIndex] : null;
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
                if (effAnim !== null && sheet && typeof this.Draw.sheet === 'function') {
                    try {
                        // Draw.sheet expects a sheet-like object with `.sheet` (Image/Canvas)
                        // and `.slicePx` and an animations map. Our SpriteSheet provides those.
                        // Before drawing the active frame, optionally draw onion-skin layers
                        // (neighboring frames) with reduced alpha so users see motion context.
                        try {
                            const drawCtx = this.Draw && this.Draw.ctx;
                            const onionEnabled = (!this.tilemode) && ((typeof this.onionSkin === 'boolean') ? this.onionSkin : true);
                            // If FrameSelect has multi-selected frames, composite those instead (disabled when tilemode)
                            const multiSet = (!this.tilemode && this.FrameSelect && this.FrameSelect._multiSelected) ? this.FrameSelect._multiSelected : null;
                            const framesArr = (sheet && sheet._frames && effAnim) ? (sheet._frames.get(effAnim) || []) : [];
                            const baseAlpha = (typeof this.onionAlpha === 'number') ? this.onionAlpha : 0.35;

                            if (effAnim !== null && drawCtx && multiSet && multiSet.size >= 2) {
                                try {
                                    // Build arrays of indices from the multi-selected set
                                    const idxs = Array.from(multiSet).filter(i => typeof i === 'number' && i >= 0 && i < framesArr.length).sort((a,b)=>a-b);
                                    if (idxs.length >= 2) {
                                        const beforeIdxs = idxs.filter(i => i < effFrame);
                                        const afterIdxs = idxs.filter(i => i > effFrame);

                                        // Helper to composite a set of frames into a temporary canvas
                                        const compositeSet = (indices) => {
                                            if (!indices || indices.length === 0) return null;
                                            const tmp = document.createElement('canvas');
                                            tmp.width = dstW; tmp.height = dstH;
                                            const tctx = tmp.getContext('2d');
                                            try { tctx.imageSmoothingEnabled = false; } catch (e) {}
                                            // draw each frame in order onto tmp (ascending indices)
                                            for (const ii of indices) {
                                                try {
                                                    const fCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(effAnim, ii) : null;
                                                    if (!fCanvas) continue;
                                                    tctx.drawImage(fCanvas, 0, 0, fCanvas.width, fCanvas.height, 0, 0, dstW, dstH);
                                                } catch (e) { /* ignore per-frame */ }
                                            }
                                            return tmp;
                                        };

                                        const beforeCanvas = compositeSet(beforeIdxs);
                                        const afterCanvas = compositeSet(afterIdxs);

                                        // Draw the composited before/after canvases with alpha
                                        if (beforeCanvas) {
                                            drawCtx.save();
                                            drawCtx.globalAlpha = baseAlpha;
                                            this.Draw.image(beforeCanvas, dstPos, new Vector(dstW, dstH), null, 0, 1, false);
                                            drawCtx.restore();
                                        }
                                        if (afterCanvas) {
                                            drawCtx.save();
                                            drawCtx.globalAlpha = baseAlpha;
                                            this.Draw.image(afterCanvas, dstPos, new Vector(dstW, dstH), null, 0, 1, false);
                                            drawCtx.restore();
                                        }
                                    }
                                } catch (e) { /* ignore multi-select compositing errors */ }
                            } else if (effAnim !== null && drawCtx && onionEnabled) {
                                const onionRange = (typeof this.onionRange === 'number') ? this.onionRange : 1;
                                for (let off = -onionRange; off <= onionRange; off++) {
                                    if (off === 0) continue;
                                    try {
                                        const idx = effFrame + off;
                                        const fCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(effAnim, idx) : null;
                                        if (!fCanvas) continue;
                                        drawCtx.save();
                                        // Fade more for frames further away
                                        const distance = Math.abs(off);
                                        const alpha = Math.max(0, baseAlpha * (1 - (distance - 1) / Math.max(1, onionRange)));
                                        drawCtx.globalAlpha = alpha;
                                        // Use Draw.image so transforms / scaling are respected
                                        this.Draw.image(fCanvas, dstPos, new Vector(dstW, dstH), null, 0, 1, false);
                                        drawCtx.restore();
                                    } catch (e) { /* ignore per-frame draw errors */ }
                                }
                            }
                        } catch (e) { /* ignore onion/multi preparation errors */ }

                        // If a preview transform exists for this area, draw a transformed temporary canvas
                        const transform = (typeof areaIndex === 'number' && Array.isArray(this._areaTransforms)) ? this._areaTransforms[areaIndex] : null;
                        const hasTransform = !!(transform && ((transform.rot || 0) !== 0 || transform.flipH));
                        if (hasTransform && frameCanvas) {
                            try {
                                const tmp = document.createElement('canvas'); tmp.width = dstW; tmp.height = dstH;
                                const tctx = tmp.getContext('2d'); try { tctx.imageSmoothingEnabled = false; } catch (e) {}
                                tctx.save();
                                // translate to center for rotation
                                tctx.translate(dstW / 2, dstH / 2);
                                if (transform.flipH) tctx.scale(-1, 1);
                                tctx.rotate((transform.rot || 0) * Math.PI / 180);
                                // draw frameCanvas scaled to dstW/dstH centered
                                tctx.drawImage(frameCanvas, -dstW / 2, -dstH / 2, dstW, dstH);
                                tctx.restore();
                                this.Draw.image(tmp, dstPos, new Vector(dstW, dstH), null, 0, 1, false);
                            } catch (e) {
                                // fallback to sheet if transform draw fails
                                this.Draw.sheet(sheet, dstPos, new Vector(dstW, dstH), effAnim, effFrame, null, 1, false);
                            }
                        } else {
                            this.Draw.sheet(sheet, dstPos, new Vector(dstW, dstH), effAnim, effFrame, null, 1, false);
                        }
                    } catch (e) {
                        // fallback to per-frame canvas if Draw.sheet fails
                        if (frameCanvas) this.Draw.image(frameCanvas, dstPos, new Vector(dstW, dstH), null, 0, 1, false);
                        else if (sheet && sheet.sheet) this.Draw.image(sheet.sheet, dstPos, new Vector(dstW, dstH), null, 0, 1, false);
                    }
                } else if (frameCanvas) {
                    // fallback: draw per-frame canvas
                    this.Draw.image(frameCanvas, dstPos, new Vector(dstW, dstH), null, 0, 1, false);
                } else if (!this.tilemode && sheet && sheet.sheet) {
                    // fallback when not in tilemode: draw the packed sheet (will show full sheet)
                    this.Draw.image(sheet.sheet, dstPos, new Vector(dstW, dstH), null, 0, 1, false);
                }

                // Draw a pixel cursor preview if the mouse is over the draw area
                this.displayCursor(dstPos,dstW,dstH)
            }
        } catch (e) {
            console.warn('displayDrawArea failed', e);
        }
    }
    displayCursor(dstPos,dstW,dstH){
        try {
            const cellW = dstW / this.currentSprite.slicePx;
            const cellH = dstH / this.currentSprite.slicePx;

            // Draw selection points
            if (this.selectionPoints && this.selectionPoints.length > 0) {
                for (const point of this.selectionPoints) {
                    const cellX = dstPos.x + point.x * cellW;
                    const cellY = dstPos.y + point.y * cellH;
                    this.Draw.rect(new Vector(cellX, cellY), new Vector(cellW/3, cellH/3), '#00FFFF55', true); // Aqua fill
                    this.Draw.rect(new Vector(cellX, cellY), new Vector(cellW, cellH), '#00FFFFFF', false, true, 1, '#00FFFFFF'); // Aqua outline
                }
            }

            // Draw active region selection (created when two points + 'b' pressed)
            if (this.selectionRegion) {
                try {
                    const sr = this.selectionRegion;
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
                    this.Draw.rect(new Vector(rectX, rectY), new Vector(rectW, rectH), '#00FF00AA', false, true, 2, '#00FF00AA');
                } catch (e) {
                    // ignore region-draw errors
                }
            }

            // Draw clipboard preview (Alt+C) aligned so clipboard origin matches mouse pixel
            if (this.clipboardPreview && this.clipboard) {
                try {
                    const cb = this.clipboard;
                    // mouse position in frame coords
                    const posInfo = this.getPos(this.mouse && this.mouse.pos);
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

            const posInfo = this.getPos(this.mouse && this.mouse.pos);
            if (posInfo && posInfo.inside) {
                const mousePixelPos = { x: posInfo.x, y: posInfo.y };

                if (this.currentTool === 'line' && this.selectionPoints.length === 1) {
                    this.drawLine(this.selectionPoints[0], mousePixelPos, '#FFFFFF88');
                } else if (this.currentTool === 'box' && this.selectionPoints.length === 1) {
                    this.drawBox(this.selectionPoints[0], mousePixelPos, '#FFFFFF88', this.keys.held('Alt'));
                }

                // draw brush-sized cursor (NxN where N is this.brushSize)
                try {
                    const side = Math.max(1, Math.min(4, this.brushSize || 1));
                    const half = Math.floor((side - 1) / 2);
                    const sx = posInfo.x - half;
                    const sy = posInfo.y - half;
                    const drawX = dstPos.x + sx * cellW;
                    const drawY = dstPos.y + sy * cellH;
                    const drawW = side * cellW;
                    const drawH = side * cellH;
                    this.Draw.rect(new Vector(drawX, drawY), new Vector(drawW, drawH), '#FFFFFF22', true);
                    this.Draw.rect(new Vector(drawX, drawY), new Vector(drawW, drawH), '#FFFFFFEE', false, true, 2, '#FFFFFFEE');
                } catch (e) {
                    const cellX = dstPos.x + posInfo.x * cellW;
                    const cellY = dstPos.y + posInfo.y * cellH;
                    this.Draw.rect(new Vector(cellX, cellY), new Vector(cellW, cellH), '#FFFFFF22', true);
                    this.Draw.rect(new Vector(cellX, cellY), new Vector(cellW, cellH), '#FFFFFFEE', false, true, 2, '#FFFFFFEE');
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
}
