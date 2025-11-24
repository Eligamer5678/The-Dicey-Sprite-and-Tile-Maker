import Scene from './Scene.js';
import Vector from '../js/Vector.js';
import createHButton from '../js/htmlElements/createHButton.js';
import createHDiv from '../js/htmlElements/createHDiv.js';
import createHInput from '../js/htmlElements/createHInput.js';
import SpriteSheet from '../js/Spritesheet.js';
import FrameSelect from '../js/UI/frameSelect.js';
import Color from '../js/Color.js';

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
        const zX = this.zoom.x;
        const zY = this.zoom.y;
        // invert direction so wheel down moves content up (typical UX)
        const impulseX = -wheelX * (this.panImpulse) * (1 / zX);
        const impulseY = -wheelY * (this.panImpulse) * (1 / zY);
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
            const area = this.computeDrawArea();
            if (!area) return null;
            const sp = screenPos || (this.mouse && this.mouse.pos) || new Vector(0,0);
            let mx = sp.x || 0;
            let my = sp.y || 0;
            
            // Apply inverse transforms in reverse order:
            // The draw() method does: scale(zoom) then translate(offset)
            // Since translate happens in scaled space, we reverse:
            // 1. Divide by zoom to undo the scale
            // 2. Subtract offset/zoom to undo the scaled translation
            mx = mx / this.zoom.x - this.offset.x;
            my = my / this.zoom.y - this.offset.y;
            
            if (mx < area.dstPos.x || my < area.dstPos.y || mx > area.dstPos.x + area.dstW || my > area.dstPos.y + area.dstH) return { inside: false };
            const relX = (mx - area.dstPos.x) / area.dstW;
            const relY = (my - area.dstPos.y) / area.dstH;
            const px = Math.min(this.currentSprite.slicePx - 1, Math.max(0, Math.floor(relX * this.currentSprite.slicePx)));
            const py = Math.min(this.currentSprite.slicePx - 1, Math.max(0, Math.floor(relY * this.currentSprite.slicePx)));
            return { inside: true, x: px, y: py, relX, relY };
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
            const area = this.computeDrawArea();
            if (!area) return null;
            let pxCenterX = area.dstPos.x + ((x + 0.5) / this.currentSprite.slicePx) * area.dstW;
            let pxCenterY = area.dstPos.y + ((y + 0.5) / this.currentSprite.slicePx) * area.dstH;
            
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
        this.mouse.setMask(0)
        this.FrameSelect.update()
        this.mouse.setPower(0)
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
            const color = this.penColor || '#000000';
            if (this.mouse.held('left')) { // early return as requested
                sheet.setPixel(this.selectedAnimation, this.selectedFrame, pos.x, pos.y, color, 'replace');
            }
            if (this.mouse.held('right')) { // early return as requested
                sheet.setPixel(this.selectedAnimation, this.selectedFrame, pos.x, pos.y, '#00000000', 'replace');
            }
            
        } catch (e) {
            console.warn('penTool failed', e);
        }
    }

    selectionTool() {
        try {
            if (!this.mouse) return;

            // Right click to cancel selection (also clear any region selection)
            if (this.mouse.held('right') && this.selectionPoints.length !== 0) {
                this.selectionPoints = [];
                this.currentTool = null;
                this.selectionRegion = null;
                this.mouse.pause(0.15)
            }

            // Clear clipboard preview when Alt is released or preview expired
            if (this.clipboardPreview && (!this.keys.held('v'))) {
                this.clipboardPreview = false;
                this._clipboardPreviewDragging = null;
            }

            // Ctrl + Left = eyedropper: pick color from the current frame under the mouse
            if (this.keys.held('Control')) {
                try {
                    const pos = this.getPos(this.mouse.pos);
                    if (pos && pos.inside && this.currentSprite) {
                        const sheet = this.currentSprite;
                        const anim = this.selectedAnimation;
                        const frameIdx = this.selectedFrame;
                        const frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(anim, frameIdx) : null;
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
                    const exists = this.selectionPoints.some(p => p.x === pos.x && p.y === pos.y);
                    if (!exists) {
                        this.selectionPoints.push({ x: pos.x, y: pos.y });
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
                    this.selectionRegion = { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y }, filled };
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
                }
                if (this.keys.pressed('c')) {
                    if (this.selectionRegion || (this.selectionPoints && this.selectionPoints.length > 0)) this.doCopy();
                }
                if (this.keys.pressed('x')) {
                    if (this.selectionRegion || (this.selectionPoints && this.selectionPoints.length > 0)) this.doCut();
                }
                if (this.keys.released('v')) {
                    // paste at mouse pixel position using stored origin offset
                    if (this.clipboard) this.doPaste(this.mouse && this.mouse.pos);
                    this.clipboardPreview = false;
                    this._clipboardPreviewDragging = null;
                }
                // rotate clipboard clockwise with 'r'
                if (this.keys.released('r')) {
                    try { this.rotateClipboardCW && this.rotateClipboardCW(); } catch (e) { console.warn('rotate key failed', e); }
                }
            } catch (e) {
                console.warn('clipboard op failed', e);
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
            const anim = this.selectedAnimation;
            const frameIdx = this.selectedFrame;
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

    // Copy the pixels inside this.selectionRegion into this.clipboard.
    doCopy() {
        try {
            const sheet = this.currentSprite;
            const anim = this.selectedAnimation;
            const frameIdx = this.selectedFrame;

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
            // If selectionPoints exist, copy those and then clear each pixel
            if (this.selectionPoints && this.selectionPoints.length > 0) {
                this.doCopy();
                const sheet = this.currentSprite;
                const anim = this.selectedAnimation;
                const frameIdx = this.selectedFrame;
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
            const anim = this.selectedAnimation;
            const frameIdx = this.selectedFrame;
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
            const anim = this.selectedAnimation;
            const frameIdx = this.selectedFrame;
            // determine mouse pixel position in frame coords
            const pos = this.getPos(mousePos);
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
            const topLeft = new Vector((uiW - size.x) / 2, (uiH - size.y) / 2);
            this.displayDrawArea(topLeft, size, this.currentSprite, this.selectedAnimation, this.selectedFrame);
        }

        // Remove previous transform container to prevent transform stacking
        this.Draw.popMatrix()
        this.UIDraw.useCtx('UI');
        this.UIDraw.clear()
        this.FrameSelect.draw()
    }

    /**
     * Render the sprite editing area: a background box at `pos` with `size`,
     * and draw the specified frame from `sheet` (SpriteSheet instance).
     * `animation` is the animation name and `frame` the frame index.
     */
    displayDrawArea(pos, size, sheet, animation = 'idle', frame = 0) {
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

            // draw the frame image centered inside the box with some padding
            if (sheet) {
                const frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(animation, frame) : null;
                const padding = 0;
                const dstW = Math.max(1, size.x - padding * 2);
                const dstH = Math.max(1, size.y - padding * 2);
                const dstPos = new Vector(pos.x + (size.x - dstW) / 2, pos.y + (size.y - dstH) / 2);
                // Prefer Draw.sheet which understands SpriteSheet metadata (rows/frames).
                if (sheet && typeof this.Draw.sheet === 'function') {
                    try {
                        // Draw.sheet expects a sheet-like object with `.sheet` (Image/Canvas)
                        // and `.slicePx` and an animations map. Our SpriteSheet provides those.
                        this.Draw.sheet(sheet, dstPos, new Vector(dstW, dstH), animation, frame, null, 1, false);
                    } catch (e) {
                        // fallback to per-frame canvas if Draw.sheet fails
                        if (frameCanvas) this.Draw.image(frameCanvas, dstPos, new Vector(dstW, dstH), null, 0, 1, false);
                        else if (sheet && sheet.sheet) this.Draw.image(sheet.sheet, dstPos, new Vector(dstW, dstH), null, 0, 1, false);
                    }
                } else if (frameCanvas) {
                    // fallback: draw per-frame canvas
                    this.Draw.image(frameCanvas, dstPos, new Vector(dstW, dstH), null, 0, 1, false);
                } else if (sheet && sheet.sheet) {
                    // fallback: draw the packed sheet (will show full sheet)
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
                    this.Draw.rect(new Vector(cellX, cellY), new Vector(cellW, cellH), '#00FFFF55', true); // Aqua fill
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

                const cellX = dstPos.x + posInfo.x * cellW;
                const cellY = dstPos.y + posInfo.y * cellH;
                // translucent fill + stroked outline
                this.Draw.rect(new Vector(cellX, cellY), new Vector(cellW, cellH), '#FFFFFF22', true);
                this.Draw.rect(new Vector(cellX, cellY), new Vector(cellW, cellH), '#FFFFFFEE', false, true, 2, '#FFFFFFEE');
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
        const area = this.computeDrawArea();
        if (!area) return;
        const cellW = area.dstW / this.currentSprite.slicePx;
        const cellH = area.dstH / this.currentSprite.slicePx;
        const cellX = area.dstPos.x + x * cellW;
        const cellY = area.dstPos.y + y * cellH;
        this.Draw.rect(new Vector(cellX, cellY), new Vector(cellW, cellH), color, true);
    }
}
