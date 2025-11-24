    
import Scene from './Scene.js';
import Vector from '../js/Vector.js';
import Geometry from '../js/Geometry.js';
import createHButton from '../js/htmlElements/createHButton.js';
import createHDiv from '../js/htmlElements/createHDiv.js';
import createHLabel from '../js/htmlElements/createHLabel.js';
import SpriteSheet from '../js/Spritesheet.js';
import Cat from '../js/sprites/Cat.js';
import PackageManager from '../js/PackageManager.js';
import BufferedSegment from '../js/physics/BufferedSegment.js';
import BufferedPolygon from '../js/physics/BufferedPolygon.js';
import Menu from '../js/UI/Menu.js';
import UIButton from '../js/UI/Button.js';
import UIRect from '../js/UI/Rect.js';
import UISlider from '../js/UI/Slider.js';
import Sprite from '../js/sprites/Sprite.js';

export class CollisionScene extends Scene {
    constructor(...args) {
        super('collision', ...args);
        this.isReady = false;
        this.importedSheets = []; // [{id, slicePx, image, url}] (tilesheets import - legacy)
        this.importedChunks = []; // [{layer, x, y, image, url}] (image chunk import)
        this._importUrls = []; // object URLs to revoke on cleanup
        this.packageManager = new PackageManager(null, this);
        this.segment = null; // single test segment (legacy/demo)
        // removed test polygon; editor-created polygons live in this.editor.polyObjects
        this.editor = {
            polygons: [],        // Array<Vector[]> finalized polygons
            polyObjects: [],     // Array<BufferedPolygon>
            current: [],         // Array<Vector> current in-progress points
            baseRadius: 22,
            coeffs: { kv: 0.20, ka: 0.06, min: 3 },
                selected: -1,
                selectedVertex: -1,
        };
        // Grab/transform state for keyboard-driven polygon ops (g=move, r=rotate, s=scale)
        this._grabState = { active: false, idx: -1, originalVerts: null, mode: null, origin: null, initialAngle: 0, initialDist: 0 };
        // Editor action history for undo (stack of {type, sel, before, after, beforeBase, afterBase})
        this._editorHistory = [];
        // Level data for export (JSON)
        this.levelData = {
            spawn: null,   // { pos: {x,y}, size: {x,y} }
            goal: null,    // { pos: {x,y}, size: {x,y} }
            entities: [],  // placeholder for future
        };
        this._placeMode = null; // 'spawn' | 'goal' | null
        this.spawnSize = new Vector(48, 48);
        this.goalSize = new Vector(48, 48);
 
        // Entities (UI + data)
        this.entitiesUI = null;
        this.defaultEntitySize = new Vector(64, 64);
        this.defaultEntityMass = 5; // boxes heavier than cat
        this.defaultFriction = 0.45; // default Coulomb friction coefficient for entities
        this.gravityEnabled = false;
        this.gravity = new Vector(0, 20); // px/s^2 downward
        this.entitiesRuntime = [];
        this.assets = { boxImage: null };
    }
    // Handle cat picking up, dropping, and throwing boxes.
    _handleCatPickDrop() {
        try {
            if (!this.cat || !Array.isArray(this.entitiesRuntime)) return;
            const cat = this.cat;
            // If currently holding an entity, drop or throw it
            if (typeof cat.heldEntity === 'number' && cat.heldEntity >= 0) {
                const idx = cat.heldEntity;
                const ent = this.entitiesRuntime[idx];
                if (!ent) { cat.heldEntity = null; return; }
                // Determine if we're moving: if moving horizontally, treat as throw
                const moving = Math.abs(cat.vlos.x) > 1.0;
                try {
                    if (moving) {
                        // Throw: spawn slightly in front, give velocity impulse
                        // Use the configured throwOffset as-is (do not mirror it). Only flip the velocity X by facing.
                        const throwOff = cat.throwOffset ? cat.throwOffset.clone() : new Vector(48, -12);
                        try { ent.sprite.pos = cat.pos.clone().add(throwOff); } catch (e) {}
                        try { ent.sprite.vlos = (cat.vlos && cat.vlos.clone) ? cat.vlos.clone() : new Vector(0,0); } catch (e) { ent.sprite.vlos = new Vector(0,0); }
                        try { ent.sprite.vlos.addS(new Vector(cat.throwPower.x * cat.facing, cat.throwPower.y)); } catch (e) {}
                        // Temporarily ignore collisions between the thrown box and the cat
                        // Use a timer (seconds) driven by tickDelta instead of Date.now()
                        try { ent._ignoreCat = true; ent._ignoreCatTimer = 1.0; } catch (e) {}
                    } else {
                        // Drop: place at dropOffset relative to cat.
                        // If dropping mid-air, preserve the cat's velocity so the box continues moving/falling.
                        // Choose different offsets when dropping mid-air so the box lands beneath the cat
                        const dropOff = (!cat.jumpAllowed && cat.airDropOffset) ? cat.airDropOffset.clone() : (cat.dropOffset ? cat.dropOffset.clone() : new Vector(48, 8));
                        try { ent.sprite.pos = cat.pos.clone().add(dropOff); } catch (e) {}
                        try {
                            if (cat.jumpAllowed) {
                                // standing on ground: drop in place
                                ent.sprite.vlos = new Vector(0,0);
                            } else {
                                // in air: give the box the cat's current velocity so it moves/falls naturally
                                ent.sprite.vlos = (cat.vlos && cat.vlos.clone) ? cat.vlos.clone() : new Vector(0,0);
                                // Temporarily ignore collisions between the dropped box and the cat
                                // so it doesn't immediately overlap the cat while both are airborne.
                                try { ent._ignoreCat = true; ent._ignoreCatTimer = 0.5; } catch (e) {}
                            }
                        } catch (e) { ent.sprite.vlos = new Vector(0,0); }
                    }
                } catch (e) {}
                // Re-enable physics/collision for the entity and rebuild its poly if localVerts available
                try {
                    ent.held = false;
                    ent._heldBy = null;
                    if (Array.isArray(ent.localVerts) && ent.sprite) {
                        const worldVerts = ent.localVerts.map(v => v.add(ent.sprite.pos));
                        try { ent.poly = new BufferedPolygon(worldVerts, ent.cornerRadius || this.editor.baseRadius, this.editor.coeffs); } catch (e) { ent.poly = null; }
                    }
                } catch (e) {}
                // Move cat a bit when dropping so it doesn't overlap the placed box.
                // Only apply this displacement for drops (not throws) and only when the cat is on the ground.
                try {
                    if (!moving) {
                        // only nudge the cat when it's on the ground (placing beneath you), not while airborne
                        if (cat.jumpAllowed) {
                            try { cat.pos.addS(new Vector((cat.dropCatOffset?.x || -12) * (cat.facing || 1), (cat.dropCatOffset?.y || 0))); } catch (e) {}
                        }
                    }
                } catch (e) {}
                cat.heldEntity = null;
                return;
            }

            // Otherwise attempt to pick up the nearest box within range
            const catCenter = this.cat.pos.add(this.cat.size.mult(0.5));
            let bestIdx = -1; let bestDist = Infinity;
            const PICK_RANGE = 96; // world pixels
            for (let i = 0; i < this.entitiesRuntime.length; i++) {
                const ent = this.entitiesRuntime[i];
                try {
                    if (!ent || ent.held) continue;
                    if (ent.type !== 'box' || !ent.sprite) continue;
                    const center = ent.sprite.pos.add(ent.sprite.size.mult(0.5));
                    const d = center.sub(catCenter).mag();
                    if (d < bestDist && d <= PICK_RANGE) { bestDist = d; bestIdx = i; }
                } catch (e) {}
            }
            if (bestIdx >= 0) {
                try {
                    const ent = this.entitiesRuntime[bestIdx];
                    ent.held = true;
                    ent._heldBy = cat;
                    // remove world-collider while held (store original if needed)
                    try { ent._origPoly = ent.poly; } catch (e) {}
                    ent.poly = null;
                    // zero velocity and snap to hold offset
                    try { ent.sprite.vlos = new Vector(0,0); } catch (e) {}
                    try { ent.sprite.pos = cat.pos.clone().add(cat.holdOffset || new Vector(40, -20)); } catch (e) {}
                    cat.heldEntity = bestIdx;
                } catch (e) {}
            }
        } catch (e) { /* ignore handler errors */ }
    }

    onReady() {
        // Ensure draw contexts are set
        try {
            const worldLayers = ['bg', 'base', 'overlay'];
            for (const ln of worldLayers) {
                try {
                    this.Draw.useCtx(ln);
                    this.Draw.popMatrix(false, true);
                    this.Draw.clear();
                } catch (e) { /* ignore per-layer errors */ }
            }
            const uiLayers = ['UI', 'overlays'];
            for (const ln of uiLayers) {
                try {
                    this.UIDraw.useCtx(ln);
                    this.UIDraw.popMatrix(false, true);
                    this.UIDraw.clear();
                } catch (e) { /* ignore per-layer errors */ }
            }
            this.Draw.useCtx('base');
            this.UIDraw.useCtx('UI');
        } catch (e) { /* ignore */ }

        // Update or create the shared scene switcher panel
        try {
            const panel = document.getElementById('layer-panel');
            if (panel) {
                const tilesBtn = document.getElementById('tiles-scene-btn');
                const spritesBtn = document.getElementById('sprites-scene-btn');
                const collisionBtn = document.getElementById('collision-scene-btn');
                if (tilesBtn) {
                    tilesBtn.style.background = '#333';
                    tilesBtn.onclick = () => { try { this.switchScene && this.switchScene('title'); } catch(e){} };
                }
                if (spritesBtn) {
                    spritesBtn.style.background = '#333';
                    spritesBtn.onclick = () => { try { this.switchScene && this.switchScene('spriteScene'); } catch(e){} };
                }
                if (collisionBtn) {
                    collisionBtn.style.background = '#555';
                    collisionBtn.onclick = () => { try { this.switchScene && this.switchScene('collision'); } catch(e){} };
                }

                // Import button is handled as a floating control (bottom-right), not in this panel.
            } else {
                // minimal fallback if panel wasn't created
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
                collisionSceneBtn.onclick = () => { try { this.switchScene && this.switchScene('collision'); } catch(e){} };
                collisionSceneBtn.style.background = '#555';
                // Import button is handled as a floating control (bottom-right), not in this panel.
            }
        } catch (e) { /* ignore */ }

        this.zoom = new Vector(1,1)
        this.pan = new Vector(0,0)
        this.offset = new Vector(0,0)
        this.zoomPos = new Vector(0,0)
        this.panVlos = new Vector(0,0)
        this.zoomVlos = new Vector(0,0)
        // zoom limits and smoothing params
        this.minZoom = 0.25;
        this.maxZoom = 16;
        this.zoomSmooth = 8; // damping (larger = snappier)
        this.zoomImpulse = 12; // multiplier for wheel->velocity impulse
        this.zoomStep = -0.001; // exponential factor per wheel delta (use with Math.exp)
        // pan smoothing and impulse (wheel -> pan velocity)
        this.panSmooth = 8; // damping for panning velocity
        this.panImpulse = 1.0; // multiplier for wheel->pan velocity
        // spawn a test Cat sprite (load cat spritesheet lazily)
        const img = new Image();
        img.onload = () => {
            try {
                const sheet = new SpriteSheet(img, 32);
                const animList = ['sit','sit2','lick','lick2','walk','run','sleep','play','jump','stretch'];
                const frameCounts = [4,4,4,4,8,8,4,6,7,8];
                for (let i = 0; i < animList.length; i++) {
                    sheet.addAnimation(animList[i], i, frameCounts[i]);
                }
                sheet.addAnimation('land', 8, 7);
                this.cat = new Cat(this.keys, this.Draw, new Vector(628,328), new Vector(256,256), sheet);
                this.catRadius = 24; // collision radius for the cat, independent of draw size
                try { this._initialCatPos = this.cat.pos.clone(); } catch (e) {}
                console.log('CollisionScene: cat spritesheet loaded and Cat created');
                // Wire up platformer "fall" (down) event to pickup/drop/throw boxes
                try {
                    this.cat.input.onFall.connect(() => {
                        try { this._handleCatPickDrop(); } catch (e) { console.warn('pick/drop handler failed', e); }
                    });
                } catch (e) {}
            } catch (e) { console.warn('Failed to build cat sheet', e); }
        };
        img.onerror = () => {
            try {
                console.warn('CollisionScene: failed to load cat image, creating fallback Cat');
                this.cat = new Cat(this.keys, this.Draw, new Vector(628,328), new Vector(256,256), null);
                this.catRadius = 24;
                    try { this._initialCatPos = this.cat.pos.clone(); } catch (e) {}
                try {
                    this.cat.input.onFall.connect(() => { try { this._handleCatPickDrop(); } catch (e) {} });
                } catch (e) {}
            } catch (e) { console.warn('Failed to create fallback Cat', e); }
        };
        img.src = 'Assets/Sprites/cat.png';

        // Create or recreate a floating Import button at bottom-right (1920x1080 logical)
        try {
            const existing = document.getElementById('import-images-btn');
            if (existing && existing.parentNode) { try { existing.remove(); } catch(e){} }
            const btnSize = new Vector(140, 36);
            const pos = new Vector(1920 - btnSize.x - 12, 1080 - btnSize.y - 12);

            // Optionally keep a single segment for quick comparison; disabled by default
            // this.segment = new BufferedSegment(new Vector(420, 420), new Vector(1280, 720), 18, { kv: 0.20, ka: 0.06 });
            this._prevCatVel = new Vector(0,0);
            const importBtn = createHButton('import-images-btn', pos, btnSize, '#444', { color: '#fff', borderRadius: '6px', fontSize: 14, border: '1px solid #777' }, 'UI');
            importBtn.textContent = 'Import Images';
            importBtn.onclick = async () => { try { await this.promptImportImagesTar(); } catch(e){ console.warn('import failed', e); } };

            // Export JSON button above Import
            const exportPos = new Vector(pos.x, pos.y - (btnSize.y + 8));
            const exportBtn = createHButton('export-json-btn', exportPos, btnSize, '#446', { color: '#fff', borderRadius: '6px', fontSize: 14, border: '1px solid #778' }, 'UI');
            exportBtn.textContent = 'Export JSON';
            exportBtn.onclick = async () => { try { await this.exportLevelTar(); } catch (e){ console.warn('export failed', e); } };
        } catch (e) { /* ignore button errors */ }

        // Collision editor UI panel (minimal)
        try {
            const panelId = 'collision-editor-panel';
            const old = document.getElementById(panelId);
            if (old) old.remove();
            const panel = createHDiv(panelId, new Vector(8, 60), new Vector(560, 120), '#00000055', { borderRadius: '6px', border: '1px solid #FFFFFF22', padding: '8px' }, 'UI');
            createHLabel(null, new Vector(12, 8), new Vector(396, 20), 'Collision Editor: click to add points; Space = new polygon; Backspace = undo', { color: '#fff', fontSize: 13, justifyContent: 'left' }, panel);
            const newBtn = createHButton('editor-new-poly', new Vector(12, 38), new Vector(130, 28), '#333', { color: '#fff', borderRadius: '4px', fontSize: 13, border: '1px solid #777' }, panel);
            newBtn.textContent = 'New (Space)';
            newBtn.onclick = () => this._finalizeCurrentPolygon();
            const undoBtn = createHButton('editor-undo', new Vector(152, 38), new Vector(100, 28), '#333', { color: '#fff', borderRadius: '4px', fontSize: 13, border: '1px solid #777' }, panel);
            undoBtn.textContent = 'Undo (Bksp)';
            undoBtn.onclick = () => this._undoPoint();
            const clearBtn = createHButton('editor-clear', new Vector(262, 38), new Vector(130, 28), '#333', { color: '#fff', borderRadius: '4px', fontSize: 13, border: '1px solid #777' }, panel);
            clearBtn.textContent = 'Clear All';
            clearBtn.onclick = () => this._clearAllPolygons();

            // Spawn/Goal placement controls
            const spawnBtn = createHButton('editor-set-spawn', new Vector(402, 38), new Vector(70, 28), '#665500', { color: '#fff', borderRadius: '4px', fontSize: 13, border: '1px solid #AA8' }, panel);
            spawnBtn.textContent = 'Spawn';
            spawnBtn.onclick = () => { this._placeMode = 'spawn'; };
            const goalBtn = createHButton('editor-set-goal', new Vector(482, 38), new Vector(66, 28), '#225522', { color: '#fff', borderRadius: '4px', fontSize: 13, border: '1px solid #7A7' }, panel);
            goalBtn.textContent = 'Goal';
            goalBtn.onclick = () => { this._placeMode = 'goal'; };
        } catch (e) { /* ignore editor UI errors */ }

        // Entities UI (JS UI components with signals)
        try {
            // Create a menu at the top-right of the screen
            const menuSize = new Vector(260, 70);
            const layer = 60;
            const menuPos = new Vector(1920 - menuSize.x - 8, 8);
            const menu = new Menu(this.mouse, this.keys, menuPos, menuSize, layer, '#222A');
            const labelBg = new UIRect(new Vector(8, 8), new Vector(244, 20), layer + 1, '#00000055');
            const addBoxBtn = new UIButton(this.mouse, this.keys, new Vector(8, 34), new Vector(120, 28), layer + 2, null, '#444', '#555', '#222');
            // quick title by drawing an overlay rect; we'll draw the text with UIDraw later
            addBoxBtn.onPressed.left.connect(() => { this._placeMode = 'entity-box'; console.log('place mode updated')});
            menu.addElement('labelBg', labelBg);
            menu.addElement('addBox', addBoxBtn);
            // Buffer radius slider (controls this.editor.baseRadius)
            try {
                const sliderPos = new Vector(136, 34);
                const sliderSize = new Vector(116, 28);
                const bufSlider = new UISlider(this.mouse, this.keys, sliderPos, sliderSize, layer + 2, 'scalar', this.editor.baseRadius || 12, 2, 64, '#333', '#444', '#222', '#88AAFF');
                bufSlider.onChange.connect((val) => {
                    try {
                        const newVal = Number(val) || this.editor.baseRadius;
                        // set the default for future polygons
                        this.editor.baseRadius = newVal;
                        // update only the most recently finalized polygon's buffer radius
                        const lastIdx = (this.editor.polygons && this.editor.polygons.length) ? this.editor.polygons.length - 1 : -1;
                        if (lastIdx >= 0) {
                            try {
                                const lastPoly = this.editor.polygons[lastIdx];
                                const newObj = new BufferedPolygon(lastPoly, newVal, this.editor.coeffs);
                                // replace or append to polyObjects at lastIdx
                                this.editor.polyObjects[lastIdx] = newObj;
                            } catch (e) {
                                try { this.editor.polyObjects[lastIdx] = null; } catch (ee) {}
                            }
                        }
                    } catch (e) { console.warn('buffer slider change failed', e); }
                });
                menu.addElement('bufferSlider', bufSlider);
            } catch (e) { console.warn('Failed to create buffer slider', e); }
            this.entitiesUI = { menu, addBoxBtn };
        } catch (e) { /* ignore entities UI errors */ }

        // Preload box image asset
        try {
            const img = new Image();
            img.onload = () => { this.assets.boxImage = img; };
            img.src = 'Assets/Sprites/box.png';
        } catch (e) { /* ignore asset load errors */ }

        this.isReady = true;
    }

    onSwitchFrom() {
        // Cleanup object URLs to avoid leaks
        try {
            if (Array.isArray(this._importUrls)) {
                for (const url of this._importUrls) { try { URL.revokeObjectURL(url); } catch(e){} }
            }
        } catch (e) { /* ignore */ }
        this._importUrls = [];
        try { const btn = document.getElementById('import-images-btn'); if (btn) btn.remove(); } catch (e) {}
        try { const btn2 = document.getElementById('export-json-btn'); if (btn2) btn2.remove(); } catch (e) {}
        try { const panel = document.getElementById('collision-editor-panel'); if (panel) panel.remove(); } catch (e) {}
        // call parent if defined
        if (super.onSwitchFrom) try { super.onSwitchFrom(); } catch(e){}
    }

    // Coordinate helpers
    getWorldPos(screen){
        const s = screen || this.mouse.pos || new Vector(0,0);
        return new Vector(s.x / this.zoom.x - this.offset.x, s.y / this.zoom.y - this.offset.y);
    }
    getScreenPos(world){
        const w = world || new Vector(0,0);
        return new Vector((w.x + this.offset.x) * this.zoom.x, (w.y + this.offset.y) * this.zoom.y);
    }

    // Editor helpers
    _finalizeCurrentPolygon(){
        const pts = this.editor.current;
        if (!pts || pts.length === 0) return;
        if (pts.length === 1) {
            // create a short segment from single point
            const p0 = pts[0];
            pts.push(p0.add(new Vector(32, 0)));
        }
        const polyPts = pts.map(v => v.clone());
        this.editor.polygons.push(polyPts);
        try {
            const obj = new BufferedPolygon(polyPts, this.editor.baseRadius, this.editor.coeffs);
            this.editor.polyObjects.push(obj);
        } catch (e) {}
        this.editor.current = [];
    }
    _undoPoint(){
        // First prefer undoing recorded editor actions (transforms, extrudes)
        try {
            if (Array.isArray(this._editorHistory) && this._editorHistory.length > 0) {
                const action = this._editorHistory.pop();
                if (action && typeof action.sel === 'number') {
                    const si = action.sel;
                    try {
                        if (action.before && Array.isArray(action.before)) {
                            this.editor.polygons[si] = action.before.map(v => v.clone());
                            try { this.editor.polyObjects[si] = new BufferedPolygon(this.editor.polygons[si], (typeof action.beforeBase === 'number') ? action.beforeBase : this.editor.baseRadius, this.editor.coeffs); } catch (e) { try { this.editor.polyObjects[si] = null; } catch (ee) {} }
                        }
                        // clear any vertex selection
                        try { if (this.editor) this.editor.selectedVertex = -1; } catch (e) {}
                    } catch (e) {}
                }
                return;
            }
        } catch (e) {}
        // Prefer removing the last-inserted point. If there are points in the
        // current in-progress polygon, pop from that. Otherwise pop the last
        // point from the most recently finalized polygon. If that polygon
        // becomes empty, remove the polygon object as well.
        try {
            if (this.editor.current.length > 0) {
                this.editor.current.pop();
                return;
            }
            // No in-progress points: remove last point from last finalized polygon
            if (this.editor.polygons.length > 0) {
                const lastIdx = this.editor.polygons.length - 1;
                const lastPoly = this.editor.polygons[lastIdx];
                if (Array.isArray(lastPoly) && lastPoly.length > 0) {
                    lastPoly.pop();
                    // If polygon now empty, remove it and its polyObject
                    if (lastPoly.length === 0) {
                        this.editor.polygons.pop();
                        try { this.editor.polyObjects.pop(); } catch (e) {}
                    } else {
                        // rebuild BufferedPolygon for the modified polygon
                        try {
                            const newObj = new BufferedPolygon(lastPoly, this.editor.baseRadius, this.editor.coeffs);
                            this.editor.polyObjects[lastIdx] = newObj;
                        } catch (e) {
                            // if rebuilding fails, remove the polyObject to avoid mismatch
                            try { this.editor.polyObjects[lastIdx] = null; } catch (ee) {}
                        }
                    }
                } else {
                    // defensive: if structure unexpected, remove whole polygon and object
                    this.editor.polygons.pop();
                    try { this.editor.polyObjects.pop(); } catch (e) {}
                }
            }
        } catch (e) { /* ignore undo errors */ }
    }
    _clearAllPolygons(){
        this.editor.current = [];
        this.editor.polygons = [];
        this.editor.polyObjects = [];
    }

    // Prompt user to pick an image-chunks tar (bg/base/overlay folders with x_y.png) or a tilesheets tar. Prefer chunks.
    async promptImportImagesTar(){
        return new Promise((resolve) => {
            try {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.tar,application/x-tar,application/tar';
                input.style.display = 'none';
                input.onchange = async (e) => {
                    const file = e.target.files && e.target.files[0];
                    if (!file) { resolve(false); return; }
                    try {
                        const arrayBuf = await file.arrayBuffer();
                        // First try image-chunk tar format (bg/base/overlay/<x>_<y>.png)
                        const chunksParsed = await this.packageManager.parseImageChunksTar(arrayBuf);
                        if (chunksParsed && chunksParsed.chunks && chunksParsed.chunks.length) {
                            this.importedChunks = [];
                            for (const c of chunksParsed.chunks) {
                                if (!c.url) continue;
                                this._importUrls.push(c.url);
                                const img = new Image();
                                const p = new Promise((res)=>{ img.onload = () => res(true); img.onerror = () => res(false); });
                                img.src = c.url;
                                await p;
                                this.importedChunks.push({ layer: c.layer, x: c.x, y: c.y, image: img, url: c.url });
                            }
                            console.log('Imported chunks:', this.importedChunks.length);
                            // if the tar also contained a level payload (level.json / map.json), apply it
                            if (chunksParsed.levelPayload && this.loadMapFromPayload) {
                                try { this.loadMapFromPayload(chunksParsed.levelPayload); } catch (e) { console.warn('Failed to load level payload from chunks tar', e); }
                            }
                            resolve(this.importedChunks.length > 0);
                        } else {
                            // Fallback to tilesheets tar format
                            const parsed = await this.packageManager.parseTarBuffer(arrayBuf);
                            if (parsed && parsed.sheetsPayload && Array.isArray(parsed.sheetsPayload.sheets)) {
                                this.importedSheets = [];
                                for (const s of parsed.sheetsPayload.sheets) {
                                    if (!s.imageData) continue;
                                    this._importUrls.push(s.imageData);
                                    const img = new Image();
                                    const p = new Promise((res)=>{ img.onload = () => res(true); img.onerror = () => res(false); });
                                    img.src = s.imageData; await p;
                                    this.importedSheets.push({ id: s.id || 'sheet', slicePx: s.slicePx || 16, image: img, url: s.imageData });
                                }
                                console.log('Imported tilesheets:', this.importedSheets.map(x=>x.id));
                                resolve(this.importedSheets.length > 0);
                            } else {
                                resolve(false);
                            }
                        }
                    } catch (err) {
                        console.warn('Import tar failed', err); resolve(false);
                    }
                    try { input.remove(); } catch (ee){}
                };
                document.body.appendChild(input);
                input.click();
                setTimeout(() => { try { input.remove(); } catch (e){} }, 3000);
            } catch (e) { console.warn('promptImportImagesTar failed', e); resolve(false); }
        });
    }

    // Handle ctrl+wheel zooming with smooth velocity integration
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

    // Called by base Scene.tick() at fixed rate
    sceneTick(tickDelta) {
        this.mouse.setMask(0)
        // Update Entities UI
        try { if (this.entitiesUI && this.entitiesUI.menu) this.entitiesUI.menu.update(tickDelta); } catch (e) {}
        this.mouse.setPower(0)
        // If mouse is over the general UI area, pause mouse input briefly to prevent bleed-through
        const inTopLeft = (this.mouse.pos.x < 700 && this.mouse.pos.y < 200);
        const inTopRight = (this.mouse.pos.x > (1920 - 300) && this.mouse.pos.y < 200);
        if (inTopLeft && inTopRight) this.mouse.pause(0.1);        

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
        // update cat (guard in case sprite hasn't loaded yet)
        try {
            if (!this.cat) {
                // intermittent missing-cat observed; log for diagnostics
                if (!this._catMissingLogged) { console.warn('CollisionScene: cat sprite is not yet available'); this._catMissingLogged = true; }
            } else {
                // compute acceleration from velocity delta
                const lastV = this.cat.vlos.clone();
                this.cat.update(tickDelta);
                const curV = this.cat.vlos.clone();
                const accelMag = tickDelta > 0 ? curV.sub(this._prevCatVel || lastV).divS(tickDelta).mag() : 0;
                const velMag = curV.mag();
                if (this.segment) this.segment.updateBuffer(velMag, accelMag);
                if (this.editor && this.editor.polyObjects) {
                    for (const obj of this.editor.polyObjects) obj.updateBuffer(velMag, accelMag);
                }
                this._prevCatVel = curV;
            }
        } catch (e) { console.warn('CollisionScene: error updating cat', e); }
        
        // Camera lock/follow: when arrow keys are pressed, lock camera onto the cat
        // uses smooth damp and a horizontal bias so the direction you're moving in has more visual space
        try {
            if (!this.camera) this.camera = { locked: false, smooth: 5, bias: 0.25, lastMousePos: this.mouse ? this.mouse.pos.clone() : new Vector(0,0), unlockDistance: 4 };
            const left = this.keys.held('ArrowLeft') || this.keys.held('Left');
            const right = this.keys.held('ArrowRight') || this.keys.held('Right');
            const up = this.keys.held('ArrowUp') || this.keys.held('Up');
            const down = this.keys.held('ArrowDown') || this.keys.held('Down');
            const arrowPressed = left || right || up || down;
            // engage lock when any arrow pressed
            if (arrowPressed) {this.camera.locked = true;
                this.zoom.y = 3;
                this.zoom.x = 3;
            }

            // detect mouse movement to unlock camera
            if (this.camera.locked && this.mouse && this.mouse.pos) {
                const md = this.mouse.pos.sub(this.camera.lastMousePos || this.mouse.pos);
                if (Math.abs(md.x) > (this.camera.unlockDistance || 4) || Math.abs(md.y) > (this.camera.unlockDistance || 4)) {
                    this.camera.locked = false;
                }
                // update last mouse pos
                this.camera.lastMousePos = this.mouse.pos.clone();
            } else if (this.mouse && this.mouse.pos) {
                this.camera.lastMousePos = this.mouse.pos.clone();
            }

            // if locked, compute desired offset so the cat appears offset from center
            if (this.camera.locked && this.cat && this.cat.pos) {
                const drawCtx = this.Draw && this.Draw.ctx;
                if (drawCtx && drawCtx.canvas) {
                    const scaleX = (this.Draw && this.Draw.Scale && typeof this.Draw.Scale.x === 'number') ? this.Draw.Scale.x : 1;
                    const scaleY = (this.Draw && this.Draw.Scale && typeof this.Draw.Scale.y === 'number') ? this.Draw.Scale.y : scaleX;
                    const uiW = drawCtx.canvas.width / scaleX;
                    const uiH = drawCtx.canvas.height / scaleY;
                    const center = new Vector(uiW / 2-230, uiH / 2-100);
                    const origin = this.zoomOrigin ? this.zoomOrigin : center;

                    // horizontal bias: position player slightly opposite movement so there's more view ahead
                    let vx = 0; let vy = 0;
                    if (this.cat && this.cat.vlos) { vx = this.cat.vlos.x; vy = this.cat.vlos.y; }
                    const maxSpeed = 300;
                    const norm = Math.max(-1, Math.min(1, vx / maxSpeed));
                    const biasPixels = (this.camera.bias || 0.25) * uiW * norm * 30;
                    const normY = Math.max(-1, Math.min(1, vy / maxSpeed));
                    const biasPixelsY = (this.camera.bias || 0.25) * uiH * normY * 30 - 150;
                    
                    const Sx = center.x - biasPixels - ((this.cat.size && this.cat.size.x) ? (this.cat.size.x / 2) : 0);
                    const Sy = center.y - biasPixelsY - ((this.cat.size && this.cat.size.y) ? (this.cat.size.y) : 0);
                    const Sdes = new Vector(Sx, Sy);

                    // desired world offset such that (cat.pos + offset) maps to screen Sdes
                    // Use direct mapping offset = Sdes / zoom - cat.pos so it remains correct when zoom != 1
                    const zx = (this.zoom && typeof this.zoom.x === 'number') ? this.zoom.x : 1;
                    const zy = (this.zoom && typeof this.zoom.y === 'number') ? this.zoom.y : zx;
                    const desiredOffset = new Vector(Sdes.x / zx - this.cat.pos.x, Sdes.y / zy - this.cat.pos.y);

                    const smooth = this.camera.smooth || 8;
                    const t = 1 - Math.exp(-smooth * tickDelta);
                    this.offset = this.offset.add(desiredOffset.sub(this.offset).mult(t));
                }
            }
        } catch (e) { /* ignore camera update errors */ }

        // Editor input: add points and finalize polygons
        if (this.mouse && this.mouse.pressed('left')) {
            const wp = this.getWorldPos(this.mouse.pos);
            // Allow Shift+Click to select a polygon. If a polygon was selected
            // by this click, skip placement behavior for this click.
            let skipPlacement = false;
            try {
                const shiftHeld = this.keys && (this.keys.held && this.keys.held('Shift'));
                if (shiftHeld && this.editor && Array.isArray(this.editor.polygons) && this.editor.polygons.length) {
                    // Prefer selecting the most-recent polygon under the point
                    let handled = false;
                    for (let i = this.editor.polygons.length - 1; i >= 0; i--) {
                        const poly = this.editor.polygons[i];
                        if (!poly || !Array.isArray(poly) || poly.length < 2) continue;
                        try {
                            const polyObj = (this.editor.polyObjects && this.editor.polyObjects[i]) ? this.editor.polyObjects[i] : null;
                            let hitDetected = false;
                            if (polyObj && Array.isArray(polyObj.edges) && polyObj.edges.length) {
                                // Test against buffered edges (capsules) using collideCircle with radius=0
                                for (const edge of polyObj.edges) {
                                    try {
                                        const h = edge.collideCircle(wp, 0);
                                        if (h && h.collides) { hitDetected = true; break; }
                                    } catch (ee) {}
                                }
                            } else {
                                // Fallback: point-in-polygon if buffered poly not available
                                try {
                                    const polyAdapter = { getTransform: () => poly };
                                    if (Geometry.pointInPoly(wp, polyAdapter)) hitDetected = true;
                                } catch (ee) {}
                            }
                            if (hitDetected) {
                                // toggle selection
                                this.editor.selected = (this.editor.selected === i) ? -1 : i;
                                handled = true;
                                break;
                            }
                        } catch (e) {}
                    }
                    if (handled) skipPlacement = true;
                }
            } catch (e) {}
            // If a polygon is currently selected, allow clicking its vertices to select a vertex
            try {
                const sel = (this.editor && typeof this.editor.selected === 'number') ? this.editor.selected : -1;
                if (sel >= 0 && Array.isArray(this.editor.polygons) && this.editor.polygons[sel] && !skipPlacement) {
                    // Choose preview vertices when a transform preview is active so clicks hit the live positions
                    const usePreview = (this._grabState && this._grabState.active && typeof this._grabState.idx === 'number' && this._grabState.idx === sel && this.editor.polyObjects && this.editor.polyObjects[sel]);
                    const polySource = usePreview ? (this.editor.polyObjects[sel] && this.editor.polyObjects[sel].vertices ? this.editor.polyObjects[sel].vertices : this.editor.polygons[sel]) : this.editor.polygons[sel];
                    // handle radius in world-space so hits are consistent across zoom
                    const handlePx = 10; // screen pixels
                    const handleWorldR = handlePx / (this.zoom.x || 1);
                    for (let vi = 0; vi < polySource.length; vi++) {
                        try {
                            const v = polySource[vi];
                            const d = v.sub(wp).mag();
                            if (d <= handleWorldR) {
                                this.editor.selectedVertex = vi;
                                skipPlacement = true;
                                break;
                            }
                        } catch (ee) {}
                    }
                }
            } catch (e) {}
            // If a polygon is selected, do not allow placing new points (unless a vertex was hit)
            try {
                const sel2 = (this.editor && typeof this.editor.selected === 'number') ? this.editor.selected : -1;
                if (sel2 >= 0 && !skipPlacement) {
                    skipPlacement = true;
                }
            } catch (e) {}
            if (this._placeMode === 'spawn') {
                const topLeft = wp.sub(this.spawnSize.mult(0.5));
                this.levelData.spawn = { pos: { x: topLeft.x, y: topLeft.y }, size: { x: this.spawnSize.x, y: this.spawnSize.y } };
                this._placeMode = null;
            } else if (this._placeMode === 'goal') {
                const topLeft = wp.sub(this.goalSize.mult(0.5));
                this.levelData.goal = { pos: { x: topLeft.x, y: topLeft.y }, size: { x: this.goalSize.x, y: this.goalSize.y } };
                this._placeMode = null;
            } else if (this._placeMode === 'entity-box') {
                console.log('box should be placed')
                const sz = this.defaultEntitySize;
                const topLeft = wp.sub(sz.mult(0.5));
                const entData = { type: 'box', pos: { x: topLeft.x, y: topLeft.y }, size: { x: sz.x, y: sz.y } };
                this.levelData.entities.push(entData);
                let BoxSheet = new SpriteSheet(this.assets.boxImage,16)
                BoxSheet.addAnimation('base',0,8)

                const sprite = new Sprite(this.Draw, new Vector(entData.pos.x, entData.pos.y), new Vector(entData.size.x, entData.size.y), BoxSheet);
                // ensure sprite has appropriate mass
                try { sprite.mass = this.defaultEntityMass; } catch (e) {}
                // Build a polygon collider for the box (closed rectangle). Use a corner curvature
                // by setting the baseRadius (buffer) to a fraction of the box size.
                const cornerRadius = Math.max(4, Math.min(sz.x, sz.y) * 0.12);
                // Inset the polygon vertices by one radius (cornerRadius) so the
                // buffered capsule (which expands by cornerRadius) aligns with
                // the sprite texture edges.
                const localVerts = [
                    new Vector(cornerRadius, cornerRadius),
                    new Vector(Math.max(cornerRadius, sz.x - cornerRadius), cornerRadius),
                    new Vector(Math.max(cornerRadius, sz.x - cornerRadius), Math.max(cornerRadius, sz.y - cornerRadius)),
                    new Vector(cornerRadius, Math.max(cornerRadius, sz.y - cornerRadius))
                ];
                // world vertices are local + sprite.pos
                const worldVerts = localVerts.map(v => v.add(sprite.pos));
                let polyObj = null;
                try { polyObj = new BufferedPolygon(worldVerts, cornerRadius, this.editor.coeffs, true); } catch (e) { polyObj = null; }
                this.entitiesRuntime.push({ type:'box', sprite, poly: polyObj, localVerts, cornerRadius });

                this._placeMode = null;
            } else {
                // Polygon placement; support Shift to snap to 8 directions from last point.
                // If shift-click selection handled this click, skip placement.
                if (!skipPlacement && (this.keys.held('n') || this.keys.held('N'))) {
                    let newPt = wp;
                    try {
                        const shiftHeld = this.keys && (this.keys.held && this.keys.held('Shift'));
                        const cur = this.editor && this.editor.current ? this.editor.current : [];
                        if (shiftHeld && cur.length > 0) {
                            const last = cur[cur.length - 1];
                            const delta = wp.sub(last);
                            const len = delta.mag();
                            if (len > 1e-6) {
                                const step = Math.PI / 4; // 8 directions
                                const ang = Math.atan2(delta.y, delta.x);
                                const snapped = Math.round(ang / step) * step;
                                const dir = new Vector(Math.cos(snapped), Math.sin(snapped));
                                // project onto snapped direction so distance follows mouse along that axis
                                const projLen = delta.x * dir.x + delta.y * dir.y;
                                newPt = last.add(dir.mult(projLen));
                            } else {
                                newPt = last.clone();
                            }
                        }
                    } catch (e) { /* ignore snapping errors; fall back to raw point */ }
                    this.editor.current.push(newPt);
                }
            }
        }
        if (this.keys && this.keys.pressed(' ')) {
            this._finalizeCurrentPolygon();
        }
        if (this.keys && this.keys.pressed('Backspace')) {
            this._undoPoint();
        }

        // Delete selected polygon or vertex with 'x'
        if (this.keys && this.keys.pressed && this.keys.pressed('x')) {
            try {
                const sel = (this.editor && typeof this.editor.selected === 'number') ? this.editor.selected : -1;
                const vIdx = (this.editor && typeof this.editor.selectedVertex === 'number') ? this.editor.selectedVertex : -1;
                if (sel >= 0 && Array.isArray(this.editor.polygons) && this.editor.polygons[sel]) {
                    const poly = this.editor.polygons[sel];
                    try {
                        // record before snapshot
                        const before = poly.map(v => v.clone());
                        const beforeBase = (this.editor.polyObjects && this.editor.polyObjects[sel] && typeof this.editor.polyObjects[sel].baseRadius === 'number') ? this.editor.polyObjects[sel].baseRadius : this.editor.baseRadius;

                        if (vIdx >= 0 && vIdx < poly.length) {
                            // Delete a single vertex
                            const newPoly = poly.filter((_, i) => i !== vIdx).map(v => v.clone());
                            if (newPoly.length < 2) {
                                // If removing the vertex collapses the polygon, remove the whole polygon
                                this.editor.polygons.splice(sel, 1);
                                if (this.editor.polyObjects && this.editor.polyObjects.length > sel) this.editor.polyObjects.splice(sel, 1);
                                // push history: before->null (deleted)
                                try { this._editorHistory.push({ type: 'delete', sel: sel, before: before, after: null, beforeBase: beforeBase, afterBase: null }); } catch (e) {}
                                this.editor.selected = -1;
                                this.editor.selectedVertex = -1;
                            } else {
                                // Replace polygon with vertex removed
                                this.editor.polygons[sel] = newPoly;
                                try { this.editor.polyObjects[sel] = new BufferedPolygon(newPoly, this.editor.baseRadius, this.editor.coeffs); } catch (e) {}
                                // push history: before->after
                                try { this._editorHistory.push({ type: 'delete', sel: sel, before: before, after: newPoly.map(v => v.clone()), beforeBase: beforeBase, afterBase: (this.editor.polyObjects && this.editor.polyObjects[sel] && typeof this.editor.polyObjects[sel].baseRadius === 'number') ? this.editor.polyObjects[sel].baseRadius : this.editor.baseRadius }); } catch (e) {}
                                // clamp selected vertex
                                this.editor.selectedVertex = Math.max(0, Math.min(vIdx, this.editor.polygons[sel].length - 1));
                            }
                        } else {
                            // No vertex selected: delete entire polygon
                            this.editor.polygons.splice(sel, 1);
                            if (this.editor.polyObjects && this.editor.polyObjects.length > sel) this.editor.polyObjects.splice(sel, 1);
                            try { this._editorHistory.push({ type: 'delete', sel: sel, before: before, after: null, beforeBase: beforeBase, afterBase: null }); } catch (e) {}
                            this.editor.selected = -1;
                            this.editor.selectedVertex = -1;
                        }
                    } catch (e) {}
                }
            } catch (e) {}
        }

        // Toggle gravity with '9'
        try {
            if (this.keys.pressed('9')) {
                this.gravityEnabled = !this.gravityEnabled;
                console.log('gravity:', this.gravityEnabled);
            }
            // Reset cat to initial position and zero velocity with '0'
            if (this.keys.pressed('0')) {
                try {
                    if (this.cat) {
                        if (this._initialCatPos && typeof this._initialCatPos.clone === 'function') {
                            this.cat.pos = this._initialCatPos.clone();
                        } else {
                            this.cat.pos = new Vector(628,328);
                        }
                        if (this.cat.vlos) {
                            this.cat.vlos.x = 0; this.cat.vlos.y = 0;
                        } else {
                            this.cat.vlos = new Vector(0,0);
                        }
                        // reset any cached prev velocity
                        try { this._prevCatVel = new Vector(0,0); } catch (e) {}
                        console.log('CollisionScene: cat reset to initial position');
                    }
                } catch (e) {}
            }
        } catch (e) {}

        // Keyboard-driven transforms: when a polygon is selected, press 'g' to move, 'r' to rotate, 's' to scale.
        // While active the polygon is previewed; right-click cancels (revert), left-click commits.
        try {
            // Start operation: move (g), rotate (r), scale (s)
            const startMove = this.keys && this.keys.pressed && this.keys.pressed('g');
            const startRotate = this.keys && this.keys.pressed && this.keys.pressed('r');
            const startScale = this.keys && this.keys.pressed && this.keys.pressed('s');
            // Extrude: create new endpoint vertex and auto-start a grab
            const startExtrude = this.keys && this.keys.pressed && this.keys.pressed('e');
            // Duplicate selected polygon and start grab
            const startDuplicate = this.keys && this.keys.pressed && this.keys.pressed('c');
            if (startDuplicate && this.editor && typeof this.editor.selected === 'number' && this.editor.selected >= 0 && !this._grabState.active) {
                try {
                    const sel = this.editor.selected;
                    const poly = (this.editor.polygons && this.editor.polygons[sel]) ? this.editor.polygons[sel] : null;
                    if (poly && Array.isArray(poly)) {
                        // clone polygon and insert after selected
                        const newPoly = poly.map(v => v.clone());
                        const newIndex = sel + 1;
                        this.editor.polygons.splice(newIndex, 0, newPoly);
                        // preserve baseRadius from original polyObject when possible
                        const base = (this.editor.polyObjects && this.editor.polyObjects[sel] && typeof this.editor.polyObjects[sel].baseRadius === 'number') ? this.editor.polyObjects[sel].baseRadius : this.editor.baseRadius;
                        try { this.editor.polyObjects.splice(newIndex, 0, new BufferedPolygon(newPoly, base, this.editor.coeffs)); } catch (e) { try { this.editor.polyObjects.splice(newIndex, 0, null); } catch (ee){} }
                        // select the new polygon
                        this.editor.selected = newIndex;
                        this.editor.selectedVertex = -1;

                        // record history (best-effort) so user can see action in history stack
                        try { const action = { type: 'duplicate', sel: newIndex, before: null, after: newPoly.map(v=>v.clone()), beforeBase: null, afterBase: base }; this._editorHistory.push(action); this._grabState.historyAction = action; } catch (e) {}

                        // start a grab on the new polygon in move mode
                        const orig = newPoly.map(v => v.clone());
                        let minX = orig[0].x, minY = orig[0].y, maxX = orig[0].x, maxY = orig[0].y;
                        for (const p of orig) { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; }
                        const origin = new Vector((minX + maxX) * 0.5, (minY + maxY) * 0.5);
                        this._grabState.active = true;
                        this._grabState.idx = newIndex;
                        this._grabState.vertexIndex = -1;
                        this._grabState.originalVerts = orig;
                        this._grabState.previewReplaced = false;
                        const polyObj = (this.editor.polyObjects && this.editor.polyObjects[newIndex]) ? this.editor.polyObjects[newIndex] : null;
                        this._grabState.originalPolyObject = polyObj;
                        this._grabState.originalBaseRadius = (polyObj && typeof polyObj.baseRadius === 'number') ? polyObj.baseRadius : (this.editor.baseRadius || 12);
                        this._grabState.origin = origin;
                        this._grabState.mode = 'move';
                        try { if (this.mouse && this.mouse.grab) this.mouse.grab(this.mouse.pos); } catch (e) {}
                    }
                } catch (e) {}
            }
            if (startExtrude && this.editor && typeof this.editor.selected === 'number' && this.editor.selected >= 0 && !this._grabState.active) {
                const sel = this.editor.selected;
                const poly = (this.editor.polygons && this.editor.polygons[sel]) ? this.editor.polygons[sel] : null;
                const vIdx = (this.editor && typeof this.editor.selectedVertex === 'number') ? this.editor.selectedVertex : -1;
                if (poly && Array.isArray(poly) && poly.length >= 1 && (vIdx === 0 || vIdx === poly.length - 1)) {
                    try {
                        // create new vertex at the same world position as the selected endpoint
                        const newV = poly[vIdx].clone();
                        let newPoly = poly.map(v => v.clone());
                        // record history for the extrude action (before -> after)
                        let extrudeAction = null;
                        let newIndex = -1;
                        if (vIdx === poly.length - 1) {
                            newPoly.push(newV);
                            newIndex = newPoly.length - 1;
                        } else {
                            newPoly.unshift(newV);
                            newIndex = 0;
                        }
                        // persist the new polygon and rebuild its BufferedPolygon
                        try {
                            const origBase = (this.editor.polyObjects && this.editor.polyObjects[sel] && typeof this.editor.polyObjects[sel].baseRadius === 'number') ? this.editor.polyObjects[sel].baseRadius : this.editor.baseRadius;
                            extrudeAction = { type: 'extrude', sel: sel, before: poly.map(v => v.clone()), after: newPoly.map(v => v.clone()), beforeBase: origBase, afterBase: origBase };
                            this._editorHistory.push(extrudeAction);
                        } catch (e) {}
                        this.editor.polygons[sel] = newPoly;
                        try { this.editor.polyObjects[sel] = new BufferedPolygon(newPoly, this.editor.baseRadius, this.editor.coeffs); } catch (e) {}
                        // select the newly created vertex
                        this.editor.selectedVertex = newIndex;

                        // Start a grab in move mode for that new vertex
                        const orig = newPoly.map(v => v.clone());
                        // compute bounding-box origin
                        let minX = orig[0].x, minY = orig[0].y, maxX = orig[0].x, maxY = orig[0].y;
                        for (const p of orig) { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; }
                        const origin = new Vector((minX + maxX) * 0.5, (minY + maxY) * 0.5);
                        this._grabState.active = true;
                        this._grabState.idx = sel;
                        this._grabState.vertexIndex = newIndex;
                        // attach history action to grabState so we can update/remove it on commit/cancel
                        try { this._grabState.historyAction = extrudeAction; } catch (e) {}
                        this._grabState.originalVerts = orig;
                        this._grabState.previewReplaced = false;
                        const polyObj = (this.editor.polyObjects && this.editor.polyObjects[sel]) ? this.editor.polyObjects[sel] : null;
                        this._grabState.originalPolyObject = polyObj;
                        this._grabState.originalBaseRadius = (polyObj && typeof polyObj.baseRadius === 'number') ? polyObj.baseRadius : (this.editor.baseRadius || 12);
                        this._grabState.origin = origin;
                        this._grabState.mode = 'move';
                        try { if (this.mouse && this.mouse.grab) this.mouse.grab(this.mouse.pos); } catch (e) {}
                    } catch (e) { /* ignore extrude errors */ }
                }
            }
            if ((startMove || startRotate || startScale) && this.editor && typeof this.editor.selected === 'number' && this.editor.selected >= 0 && !this._grabState.active) {
                const sel = this.editor.selected;
                const orig = (this.editor.polygons && this.editor.polygons[sel]) ? this.editor.polygons[sel].map(v => v.clone()) : null;
                const vertexIdx = (this.editor && typeof this.editor.selectedVertex === 'number' && this.editor.selectedVertex >= 0) ? this.editor.selectedVertex : -1;
                if (orig && orig.length) {
                    // compute bounding-box origin (center of bounds)
                    let minX = orig[0].x, minY = orig[0].y, maxX = orig[0].x, maxY = orig[0].y;
                    for (const p of orig) { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; }
                    const origin = new Vector((minX + maxX) * 0.5, (minY + maxY) * 0.5);
                    // mouse world pos
                    const mWorld = (this.mouse && this.getWorldPos) ? this.getWorldPos(this.mouse.pos) : new Vector(0,0);
                    this._grabState.active = true;
                    this._grabState.idx = sel;
                    this._grabState.vertexIndex = vertexIdx;
                    this._grabState.originalVerts = orig;
                    this._grabState.previewReplaced = false;
                    // store the original BufferedPolygon and its base radius so we can revert or scale buffer
                    const polyObj = (this.editor.polyObjects && this.editor.polyObjects[sel]) ? this.editor.polyObjects[sel] : null;
                    this._grabState.originalPolyObject = polyObj;
                    this._grabState.originalBaseRadius = (polyObj && typeof polyObj.baseRadius === 'number') ? polyObj.baseRadius : (this.editor.baseRadius || 12);
                    // record a history action so the transform can be undone
                    try {
                        const action = { type: 'transform', sel: sel, before: orig.map(v => v.clone()), after: null, beforeBase: this._grabState.originalBaseRadius, afterBase: null };
                        this._grabState.historyAction = action;
                        this._editorHistory.push(action);
                    } catch (e) {}
                    this._grabState.origin = origin;
                    if (startRotate) {
                        this._grabState.mode = 'rotate';
                        this._grabState.initialAngle = Math.atan2(mWorld.y - origin.y, mWorld.x - origin.x);
                    } else if (startScale) {
                        this._grabState.mode = 'scale';
                        this._grabState.initialDist = Math.max(1e-3, mWorld.sub(origin).mag());
                    } else {
                        this._grabState.mode = 'move';
                    }
                    try { if (this.mouse && this.mouse.grab) this.mouse.grab(this.mouse.pos); } catch (e) {}
                }
            }

            // Cancel on right-release: revert preview to original verts
            if (this._grabState.active && this.mouse && this.mouse.released && this.mouse.released('right')) {
                try {
                    const si = this._grabState.idx;
                    const origVerts = this._grabState.originalVerts;
                    const origPoly = this._grabState.originalPolyObject;
                    const origBase = (typeof this._grabState.originalBaseRadius === 'number') ? this._grabState.originalBaseRadius : (this.editor.baseRadius || 12);
                    if (si >= 0) {
                        // If we replaced the polyObject during preview (e.g., alt-scale), restore the original object
                        if (this._grabState.previewReplaced && origPoly) {
                            this.editor.polyObjects[si] = origPoly;
                        } else if (this.editor.polyObjects && this.editor.polyObjects[si]) {
                            try { this.editor.polyObjects[si].setVertices(origVerts); } catch (e) {}
                        } else {
                            try { this.editor.polyObjects[si] = new BufferedPolygon(origVerts, origBase, this.editor.coeffs); } catch (e) {}
                        }
                    }
                } catch (e) {}
                try { if (this.mouse && this.mouse.releaseGrab) this.mouse.releaseGrab(); } catch (e) {}
                // If there was a pending history action for this grab (transform/extrude), remove it
                try {
                    const act = this._grabState.historyAction;
                    if (act && Array.isArray(this._editorHistory)) {
                        const idx = this._editorHistory.indexOf(act);
                        if (idx >= 0) this._editorHistory.splice(idx, 1);
                    }
                } catch (e) {}
                this._grabState.active = false;
                this._grabState.idx = -1;
                this._grabState.originalVerts = null;
                this._grabState.mode = null;
                this._grabState.origin = null;
                this._grabState.initialAngle = 0;
                this._grabState.initialDist = 0;
                this._grabState.historyAction = null;
            }

            // Active preview and commit handling
            if (this._grabState.active) {
                try {
                    const si = this._grabState.idx;
                    const orig = this._grabState.originalVerts;
                    const mode = this._grabState.mode;
                    const origin = this._grabState.origin || new Vector(0,0);
                    if (si >= 0 && orig && this.editor.polyObjects && this.editor.polyObjects[si]) {
                        const mWorld = (this.mouse && this.getWorldPos) ? this.getWorldPos(this.mouse.pos) : new Vector(0,0);
                        let temp = orig;
                        if (mode === 'move') {
                            const deltaScreen = (this.mouse && this.mouse.getGrabDelta) ? this.mouse.getGrabDelta() : new Vector(0,0);
                            const deltaWorld = new Vector(deltaScreen.x / (this.zoom.x || 1), deltaScreen.y / (this.zoom.y || 1));
                            if (typeof this._grabState.vertexIndex === 'number' && this._grabState.vertexIndex >= 0) {
                                const vi = this._grabState.vertexIndex;
                                temp = orig.map((v, idx) => idx === vi ? v.add(deltaWorld) : v.clone());
                            } else {
                                temp = orig.map(v => v.add(deltaWorld));
                            }
                            try { if (this.editor.polyObjects[si]) this.editor.polyObjects[si].setVertices(temp); } catch (e) {}
                        } else if (mode === 'rotate') {
                            const angleNow = Math.atan2(mWorld.y - origin.y, mWorld.x - origin.x);
                            const deltaAngle = angleNow - (this._grabState.initialAngle || 0);
                            if (typeof this._grabState.vertexIndex === 'number' && this._grabState.vertexIndex >= 0) {
                                const vi = this._grabState.vertexIndex;
                                temp = orig.map((v, idx) => idx === vi ? origin.add(v.sub(origin).rotate(deltaAngle)) : v.clone());
                            } else {
                                temp = orig.map(v => origin.add(v.sub(origin).rotate(deltaAngle)));
                            }
                            try { if (this.editor.polyObjects[si]) this.editor.polyObjects[si].setVertices(temp); } catch (e) {}
                        } else if (mode === 'scale') {
                            const curDist = Math.max(1e-3, mWorld.sub(origin).mag());
                            const scale = curDist / (this._grabState.initialDist || 1);
                            const minScale = 0.05; // avoid collapsing
                            const s = Math.max(minScale, scale);
                            temp = orig.map(v => origin.add(v.sub(origin).mult(s)));
                            // If Alt is held, also scale the polygon buffer radius for preview
                            const altHeld = this.keys && this.keys.held && this.keys.held('Alt');
                            if (altHeld) {
                                try {
                                    const origBase = (typeof this._grabState.originalBaseRadius === 'number') ? this._grabState.originalBaseRadius : (this.editor.baseRadius || 12);
                                    const newBase = Math.max(1, origBase * s);
                                    // Create a temporary BufferedPolygon for preview with scaled base
                                    try {
                                        const previewObj = new BufferedPolygon(temp, newBase, this.editor.coeffs);
                                        // replace for preview and remember we did so
                                        this.editor.polyObjects[si] = previewObj;
                                        this._grabState.previewReplaced = true;
                                    } catch (e) {
                                        // fallback to setVertices if creation fails
                                        try { if (this.editor.polyObjects[si]) this.editor.polyObjects[si].setVertices(temp); } catch (ee) {}
                                    }
                                } catch (e) {}
                            } else {
                                try { if (this.editor.polyObjects[si]) this.editor.polyObjects[si].setVertices(temp); } catch (e) {}
                            }
                        }
                        else {
                            try { if (this.editor.polyObjects[si]) this.editor.polyObjects[si].setVertices(temp); } catch (e) {}
                        }

                        // commit when left button released
                        if (this.mouse && this.mouse.released && this.mouse.released('left')) {
                            try {
                                this.editor.polygons[si] = temp.map(v => v.clone());
                                // If Alt was held during scale, preserve the scaled base radius; otherwise rebuild with editor.baseRadius
                                const altHeldCommit = (this._grabState.mode === 'scale') && (this.keys && this.keys.held && this.keys.held('Alt'));
                                if (altHeldCommit) {
                                    try {
                                        const origBase = (typeof this._grabState.originalBaseRadius === 'number') ? this._grabState.originalBaseRadius : (this.editor.baseRadius || 12);
                                        const curDist = Math.max(1e-3, mWorld.sub(origin).mag());
                                        const scale = curDist / (this._grabState.initialDist || 1);
                                        const newBase = Math.max(1, origBase * scale);
                                        try { this.editor.polyObjects[si] = new BufferedPolygon(this.editor.polygons[si], newBase, this.editor.coeffs); } catch (ee) { try { this.editor.polyObjects[si] = new BufferedPolygon(this.editor.polygons[si], this.editor.baseRadius, this.editor.coeffs); } catch(e){} }
                                    } catch (e) { try { this.editor.polyObjects[si] = new BufferedPolygon(this.editor.polygons[si], this.editor.baseRadius, this.editor.coeffs); } catch(e){} }
                                } else {
                                    try { this.editor.polyObjects[si] = new BufferedPolygon(this.editor.polygons[si], this._grabState.originalBaseRadius || this.editor.baseRadius, this.editor.coeffs); } catch (ee) { try { this.editor.polyObjects[si] = new BufferedPolygon(this.editor.polygons[si], this.editor.baseRadius, this.editor.coeffs); } catch(e){} }
                                }
                            } catch (e) {}
                            try { if (this.mouse && this.mouse.releaseGrab) this.mouse.releaseGrab(); } catch (e) {}
                            // finalize history action (set after snapshot)
                            try {
                                const act = this._grabState.historyAction;
                                if (act) {
                                    try { act.after = this.editor.polygons[si].map(v => v.clone()); } catch (e) { act.after = null; }
                                    try { act.afterBase = (this.editor.polyObjects && this.editor.polyObjects[si] && typeof this.editor.polyObjects[si].baseRadius === 'number') ? this.editor.polyObjects[si].baseRadius : (this._grabState.originalBaseRadius || this.editor.baseRadius); } catch (e) { act.afterBase = (this._grabState.originalBaseRadius || this.editor.baseRadius); }
                                }
                            } catch (e) {}
                            this._grabState.active = false;
                            this._grabState.idx = -1;
                            // clear vertex selection after committing a vertex transform
                            try { if (this.editor) this.editor.selectedVertex = -1; } catch (e) {}
                            this._grabState.originalVerts = null;
                            this._grabState.mode = null;
                            this._grabState.origin = null;
                            this._grabState.initialAngle = 0;
                            this._grabState.initialDist = 0;
                            this._grabState.historyAction = null;
                        }
                    }
                } catch (e) {}
            }
        } catch (e) {}

        // Resolve collision between cat (circle) and buffered shapes (edge-only)
        try {
            if (this.cat && this.segment) {
                const center = this.cat.pos.add(this.cat.size.mult(0.5));
                const radius = Math.min(this.cat.size.x, this.cat.size.y) * 0.2;
                const hit = this.segment.collideCircle(center, radius);
                if (hit && hit.collides) {
                    // push cat out along normal by penetration
                    const push = hit.normal.mult(hit.penetration);
                    // move top-left by same push as center
                    if (push) this.cat.pos.addS(push);
                    // remove inward normal component of velocity (simple resolve, no bounce)
                    if(hit.normal){
                        const vn = this.cat.vlos.dot(hit.normal);
                        if (vn < 0) this.cat.vlos.subS(hit.normal.mult(vn));
                    }
                }
            }
            // removed test polygon collision; editor polygons below handle collisions
            if (this.cat && this.editor && this.editor.polyObjects && this.editor.polyObjects.length) {
                for (let iter = 0; iter < 2; iter++) {
                    const center = this.cat.pos.add(this.cat.size.mult(0.5));
                    const radius = Math.min(this.cat.size.x, this.cat.size.y) * 0.1;
                    let resolved = false;
                    // collide against all editor polygons; apply deepest first
                    let best = null; let bestPen = 0; let bestObj = null;
                    for (const obj of this.editor.polyObjects) {
                        const hit = obj.collideCircle(center, radius);
                        if (hit && hit.collides && hit.penetration > bestPen) { best = hit; bestPen = hit.penetration; bestObj = obj; }
                    }
                    if (best && best.collides) {
                        const push = best.normal.mult(best.penetration);
                        if (push) this.cat.pos.addS(push);
                        if(best.normal){
                            const vn = this.cat.vlos.dot(best.normal);
                            if (vn < 0) this.cat.vlos.subS(best.normal.mult(vn));
                        }
                        resolved = true;
                    }
                    if (!resolved) break;
                }
            }
            // Resolve collision for any placed runtime entities (use a circle approx for consistency)
            if (Array.isArray(this.entitiesRuntime) && this.entitiesRuntime.length) {
                for (const ent of this.entitiesRuntime) {
                    if (!ent || !ent.sprite) continue;
                    if (ent.held) continue;
                    const sprite = ent.sprite;
                    // iterate a couple times to avoid deep tunneling
                    for (let iter = 0; iter < 2; iter++) {
                        let resolved = false;
                        // If entity has a polygon collider, test polygon-vs-segment and polygon-vs-editor-polys
                        if (ent.held) continue;
                        if (ent.poly) {
                            try {
                                // Test against demo segment by wrapping it as a 2-vertex BufferedPolygon
                                if (this.segment) {
                                    try {
                                        const segPoly = new BufferedPolygon([this.segment.a, this.segment.b], this.segment.currentRadius || this.segment.baseRadius, {}, false);
                                        const hit = ent.poly.collidePolygon(segPoly);
                                        if (hit && hit.collides) {
                                            const push = hit.normal.mult(hit.penetration);
                                            sprite.pos.addS(push);
                                            const vn = sprite.vlos ? sprite.vlos.dot(hit.normal) : 0;
                                            if (vn < 0 && sprite.vlos) sprite.vlos.subS(hit.normal.mult(vn));
                                            resolved = true;
                                        }
                                    } catch (e) {}
                                }
                                // Then against editor polygons (deepest collision first)
                                if (!resolved && this.editor && this.editor.polyObjects && this.editor.polyObjects.length) {
                                    let best = null; let bestPen = 0;
                                        for (const obj of this.editor.polyObjects) {
                                        const hit = ent.poly.collidePolygon(obj);
                                        if (hit && hit.collides && hit.penetration > bestPen) { best = hit; bestPen = hit.penetration; }
                                    }
                                    if (best && best.collides) {
                                        const push = best.normal.mult(best.penetration);
                                        sprite.pos.addS(push);
                                        const vn = sprite.vlos ? sprite.vlos.dot(best.normal) : 0;
                                        if (vn < 0 && sprite.vlos) sprite.vlos.subS(best.normal.mult(vn));
                                        resolved = true;
                                    }
                                }
                            } catch (e) {}
                        } else {
                            // Fallback: circle-approx path (legacy behavior)
                            try {
                                const center = sprite.pos.add(sprite.size.mult(0.5));
                                const radius = Math.min(sprite.size.x, sprite.size.y) * 0.4;
                                if (this.segment) {
                                    const hit = this.segment.collideCircle(center, radius);
                                    if (hit && hit.collides) {
                                        const push = hit.normal.mult(hit.penetration);
                                        sprite.pos.addS(push);
                                        const vn = sprite.vlos ? sprite.vlos.dot(hit.normal) : 0;
                                        if (vn < 0 && sprite.vlos) sprite.vlos.subS(hit.normal.mult(vn));
                                        resolved = true;
                                    }
                                }
                                if (!resolved && this.editor && this.editor.polyObjects && this.editor.polyObjects.length) {
                                    let best = null; let bestPen = 0;
                                    for (const obj of this.editor.polyObjects) {
                                        const hit = obj.collideCircle(center, radius);
                                        if (hit && hit.collides && hit.penetration > bestPen) { best = hit; bestPen = hit.penetration; }
                                    }
                                    if (best && best.collides) {
                                        const push = best.normal.mult(best.penetration);
                                        sprite.pos.addS(push);
                                        const vn = sprite.vlos ? sprite.vlos.dot(best.normal) : 0;
                                        if (vn < 0 && sprite.vlos) sprite.vlos.subS(best.normal.mult(vn));
                                        resolved = true;
                                    }
                                }
                            } catch (e) {}
                        }
                        if (!resolved) break;
                    }
                }
            }
            // Apply gravity (if enabled) then run pairwise circle-circle collisions between cat and boxes, and box-box
            try {
                // Ground-check for jumping: sample a small rect below the cat using
                // three small circle probes (left, center, right). If any probe
                // intersects world geometry, allow jumping for this tick.
                try {
                    const probeInfo = this.cat.getGroundProbePoints();
                    const probes = probeInfo.points;
                    const probeRadius = probeInfo.radius;
                    let groundHit = false;
                    const testProbe = (p) => {
                        // test against demo segment
                        try { if (this.segment) { const h = this.segment.collideCircle(p, probeRadius); if (h && h.collides) return true; } } catch (e) {}
                        // test against editor collision polygons
                        try {
                            if (this.editor && this.editor.polyObjects) {
                                for (const obj of this.editor.polyObjects) {
                                    try { const h = obj.collideCircle(p, probeRadius); if (h && h.collides) return true; } catch(e){}
                                }
                            }
                        } catch (e) {}
                        // test against placed entities (poly or circle approx)
                        try {
                            if (Array.isArray(this.entitiesRuntime)) {
                                for (const ent of this.entitiesRuntime) {
                                    if (!ent || !ent.sprite) continue;
                                    try {
                                        if (ent.poly) {
                                            const h = ent.poly.collideCircle(p, probeRadius);
                                            if (h && h.collides) return true;
                                        } else {
                                            const s = ent.sprite;
                                            const cent = s.pos.add(s.size.mult(0.5));
                                            const er = Math.min(s.size.x, s.size.y) * 0.35;
                                            const d = cent.sub(p).mag();
                                            if (d < (er + probeRadius)) return true;
                                        }
                                    } catch (e) {}
                                }
                            }
                        } catch (e) {}
                        return false;
                    };
                    for (const p of probes) {
                        if (testProbe(p)) { groundHit = true; break; }
                    }
                    try { this.cat.jumpAllowed = !!groundHit; } catch (e) {}
                } catch (e) {}
                const dt = tickDelta;
                if (this.gravityEnabled && dt > 0) {
                    try {
                        // apply gravity acceleration to cat
                        this.cat.vlos.addS(this.gravity.mult(dt));
                    } catch (e) {}
                    try {
                        for (const ent of this.entitiesRuntime) {
                            if (ent && ent.sprite && ent.sprite.vlos) {
                                ent.sprite.vlos.addS(this.gravity.mult(dt));
                            }
                        }
                    } catch (e) {}
                }

                // Update entity sprites (use their own update method instead of manual integration)
                try {
                    for (const ent of this.entitiesRuntime) {
                        if (!ent) continue;
                        // Skip entities that are currently held by the cat
                        if (ent.held) continue;
                        if (ent && ent.sprite && typeof ent.sprite.update === 'function') {
                            try { ent.sprite.update(dt); } catch (e) {}
                        }
                        // Update polygon collider world vertices to follow sprite position
                        try {
                            if (ent && ent.sprite && ent.poly && Array.isArray(ent.localVerts)) {
                                const worldVerts = ent.localVerts.map(v => v.add(ent.sprite.pos));
                                try { ent.poly.setVertices(worldVerts); } catch (e) {}
                            }
                        } catch (e) {}
                    }
                } catch (e) {}

                // Pairwise collisions between cat (circle) and entity polygons, and box-box poly-poly

                // Decrement per-entity ignore timers (driven by tickDelta) so we avoid Date.now() usage
                try {
                    for (const ent of this.entitiesRuntime) {
                        if (!ent) continue;
                        if (typeof ent._ignoreCatTimer === 'number' && ent._ignoreCatTimer > 0) {
                            ent._ignoreCatTimer = Math.max(0, ent._ignoreCatTimer - (tickDelta || 0));
                        }
                    }
                } catch (e) {}

                const collidables = [];
                // add cat if present (circle)
                if (this.cat) {
                    const ccenter = this.cat.pos.add(this.cat.size.mult(0.5));
                    const cradius = this.catRadius || Math.min(this.cat.size.x, this.cat.size.y) * 0.2;
                    collidables.push({ kind: 'circle', id: 'cat', sprite: this.cat, center: ccenter, radius: cradius, mass: 0.5, restitution: 0.2 });
                }

                // add entities: always expose an inner circle collider (more stable),
                // and also expose the polygon collider when present. During pairwise
                // tests we will prefer the inner circle collision if it intersects.
                for (let i = 0; i < this.entitiesRuntime.length; i++) {
                    const e = this.entitiesRuntime[i];
                    if (!e) continue;
                    if (e.held) continue;
                    if (!e || !e.sprite) continue;
                    const s = e.sprite;
                    // compute an inner circle (centered on sprite) — stable, used preferentially
                    const innerCenter = s.pos.add(s.size.mult(0.5));
                    const innerRadius = Math.min(s.size.x, s.size.y) * 0.35;
                    // always push the inner circle entry (marked with ownerIndex)
                    collidables.push({ kind: 'circle', id: 'ent' + i + '_inner', ownerIndex: i, sprite: s, center: innerCenter, radius: innerRadius, mass: (s.mass || this.defaultEntityMass || 5), restitution: (s.restitution || 1.0) });

                    // also push polygon collider when available (for more precise contacts)
                    if (e.poly) {
                        collidables.push({ kind: 'poly', id: 'ent' + i, ownerIndex: i, sprite: s, poly: e.poly, innerCenter, innerRadius, mass: (s.mass || this.defaultEntityMass || 5), restitution: (s.restitution || 1.0) });
                    }
                }

                // resolve each unordered pair once using accumulation/averaging
                // to avoid sequential pair updates that can cause jitter.
                const ITERATIONS = 2;
                for (let it = 0; it < ITERATIONS; it++) {
                    const posAcc = new Map(); // sprite -> { sum: Vector, count: number }
                    const velAcc = new Map(); // sprite -> { sum: Vector, count: number }

                    const addPos = (spr, vec) => {
                        if (!posAcc.has(spr)) posAcc.set(spr, { sum: new Vector(0,0), count: 0 });
                        const entry = posAcc.get(spr); entry.sum.addS(vec); entry.count += 1;
                    };
                    const addVel = (spr, vec) => {
                        if (!velAcc.has(spr)) velAcc.set(spr, { sum: new Vector(0,0), count: 0 });
                        const entry = velAcc.get(spr); entry.sum.addS(vec); entry.count += 1;
                    };

                    for (let i = 0; i < collidables.length; i++) {
                        for (let j = i + 1; j < collidables.length; j++) {
                            const A = collidables[i];
                            const B = collidables[j];
                            // Universal cat-vs-entity ignore handling (works for circle/poly pairs)
                            try {
                                const isACat = (A.id === 'cat');
                                const isBCat = (B.id === 'cat');
                                let entIdx = -1;
                                if (isACat && typeof B.ownerIndex === 'number') entIdx = B.ownerIndex;
                                if (isBCat && typeof A.ownerIndex === 'number') entIdx = A.ownerIndex;
                                if (entIdx >= 0) {
                                    const ent = (this.entitiesRuntime && this.entitiesRuntime[entIdx]) ? this.entitiesRuntime[entIdx] : null;
                                    if (ent && ent._ignoreCat) {
                                        // If timer is still positive, skip collision pairs immediately
                                        if (typeof ent._ignoreCatTimer === 'number' && ent._ignoreCatTimer > 0) {
                                            continue;
                                        } else {
                                            // Timer expired: test whether they are still overlapping now.
                                            let stillColliding = false;
                                            try {
                                                const catCenter = (isACat && A.center && A.center.clone) ? A.center.clone() : (isBCat && B.center && B.center.clone) ? B.center.clone() : (this.cat ? this.cat.pos.add(this.cat.size.mult(0.5)) : null);
                                                const catRadius = (isACat && A.radius) ? A.radius : (isBCat && B.radius) ? B.radius : (this.cat ? (this.catRadius || Math.min(this.cat.size.x, this.cat.size.y) * 0.2) : 0);
                                                if (ent && ent.poly && catCenter) {
                                                    const h = ent.poly.collideCircle(catCenter, catRadius);
                                                    if (h && h.collides) stillColliding = true;
                                                } else if (catCenter && ent && ent.sprite) {
                                                    const cent = ent.sprite.pos.add(ent.sprite.size.mult(0.5));
                                                    const er = Math.min(ent.sprite.size.x, ent.sprite.size.y) * 0.35;
                                                    const d = cent.sub(catCenter).mag();
                                                    if (d < (er + catRadius)) stillColliding = true;
                                                }
                                            } catch (e) {}
                                            if (stillColliding) continue; // still overlapping -> keep ignoring
                                            else { try { delete ent._ignoreCat; delete ent._ignoreCatTimer; } catch (e) {} }
                                        }
                                    }
                                }
                            } catch (e) {}
                            try {
                                let hit = null; let n = null; let penetration = 0;
                                if (A.kind === 'poly' && B.kind === 'poly') {
                                    hit = A.poly.collidePolygon(B.poly);
                                    if (hit && hit.collides) { n = hit.normal; penetration = hit.penetration; }
                                } else if (A.kind === 'poly' && B.kind === 'circle') {
                                    hit = A.poly.collideCircle(B.center, B.radius);
                                    if (hit && hit.collides) { n = hit.normal.mult(-1); penetration = hit.penetration; }
                                } else if (A.kind === 'circle' && B.kind === 'poly') {
                                    hit = B.poly.collideCircle(A.center, A.radius);
                                    if (hit && hit.collides) { n = hit.normal; penetration = hit.penetration; }
                                } else if (A.kind === 'circle' && B.kind === 'circle') {
                                    // prefer explicit centers when available (inner circle entries provide them)
                                    const cA = (A.center && A.center.clone) ? A.center.clone() : (A.sprite ? A.sprite.pos.add(A.sprite.size.mult(0.5)) : new Vector(0,0));
                                    const cB = (B.center && B.center.clone) ? B.center.clone() : (B.sprite ? B.sprite.pos.add(B.sprite.size.mult(0.5)) : new Vector(0,0));
                                    const delta = cA.sub(cB);
                                    const dist = delta.mag();
                                    const totalR = (A.radius || 0) + (B.radius || 0);
                                    if (dist > 1e-6 && dist < totalR) { penetration = totalR - dist; n = delta.div(dist); }
                                }
                                // If one side is a polygon and the other is a circle, prefer the polygon's
                                // inner circle collision (if provided) — it's more stable than poly-edge tests.
                                else if (A.kind === 'poly' && B.kind === 'circle') {
                                    // If the polygon has an inner circle, test that first
                                    if (A.innerRadius && A.innerCenter) {
                                        const cA = A.innerCenter.clone();
                                        const cB = (B.center && B.center.clone) ? B.center.clone() : (B.sprite ? B.sprite.pos.add(B.sprite.size.mult(0.5)) : new Vector(0,0));
                                        const delta = cA.sub(cB);
                                        const dist = delta.mag();
                                        const totalR = (A.innerRadius || 0) + (B.radius || 0);
                                        if (dist > 1e-6 && dist < totalR) { penetration = totalR - dist; n = delta.div(dist); }
                                        else {
                                            const hit = A.poly.collideCircle(B.center, B.radius);
                                            if (hit && hit.collides) { n = hit.normal.mult(-1); penetration = hit.penetration; }
                                        }
                                    } else {
                                        const hit = A.poly.collideCircle(B.center, B.radius);
                                        if (hit && hit.collides) { n = hit.normal.mult(-1); penetration = hit.penetration; }
                                    }
                                } else if (A.kind === 'circle' && B.kind === 'poly') {
                                    // mirror of above: prefer B's inner circle
                                    if (B.innerRadius && B.innerCenter) {
                                        const cA = (A.center && A.center.clone) ? A.center.clone() : (A.sprite ? A.sprite.pos.add(A.sprite.size.mult(0.5)) : new Vector(0,0));
                                        const cB = B.innerCenter.clone();
                                        const delta = cA.sub(cB);
                                        const dist = delta.mag();
                                        const totalR = (A.radius || 0) + (B.innerRadius || 0);
                                        if (dist > 1e-6 && dist < totalR) { penetration = totalR - dist; n = delta.div(dist); }
                                        else {
                                            const hit = B.poly.collideCircle(A.center, A.radius);
                                            if (hit && hit.collides) { n = hit.normal; penetration = hit.penetration; }
                                        }
                                    } else {
                                        const hit = B.poly.collideCircle(A.center, A.radius);
                                        if (hit && hit.collides) { n = hit.normal; penetration = hit.penetration; }
                                    }
                                }
                                if (!n || penetration <= 0) continue;

                                const mA = A.mass || 1; const mB = B.mass || 1;
                                const invA = (mA > 0) ? 1 / mA : 0;
                                const invB = (mB > 0) ? 1 / mB : 0;
                                const invSum = invA + invB || 1;

                                // accumulate positional corrections (A += corrA, B -= corrB)
                                const corrA = n.mult(penetration * (invA / invSum));
                                const corrB = n.mult(penetration * (invB / invSum));
                                try { addPos(A.sprite, corrA); addPos(B.sprite, corrB.mult(-1)); } catch (e) {}

                                // compute velocity impulse based on current velocities
                                const vA = A.sprite.vlos ? A.sprite.vlos.clone() : new Vector(0,0);
                                const vB = B.sprite.vlos ? B.sprite.vlos.clone() : new Vector(0,0);
                                const rel = vA.sub(vB);
                                const relN = rel.dot(n);
                                if (relN < 0) {
                                    const eRest = Math.min(A.restitution || 1.0, B.restitution || 1.0);
                                    const j = -(1 + eRest) * relN / invSum;
                                    const impulse = n.mult(j);
                                    try { addVel(A.sprite, impulse.mult(invA)); addVel(B.sprite, impulse.mult(-invB)); } catch (e) {}
                                    // Coulomb friction: compute tangential relative velocity and apply
                                    try {
                                        // friction coefficients: prefer sprite-level, fall back to scene default
                                        const muA = (A.sprite && typeof A.sprite.friction === 'number') ? A.sprite.friction : (this.defaultFriction || 0.0);
                                        const muB = (B.sprite && typeof B.sprite.friction === 'number') ? B.sprite.friction : (this.defaultFriction || 0.0);
                                        // conservative combined mu (min) to avoid sticky behavior
                                        const mu = Math.min(muA, muB);
                                        // tangential relative velocity (remove normal component)
                                        const tang = rel.sub(n.mult(relN));
                                        const tangMag = tang.mag();
                                        if (tangMag > 1e-6) {
                                            const tDir = tang.div(tangMag); // unit tangent
                                            const relT = rel.dot(tDir);
                                            // friction impulse magnitude (uncapped)
                                            const jt = -relT / invSum;
                                            // clamp by Coulomb limit: |jt| <= mu * j
                                            const maxJt = Math.abs(mu * j);
                                            let jtC = jt;
                                            if (jtC > maxJt) jtC = maxJt;
                                            if (jtC < -maxJt) jtC = -maxJt;
                                            if (Math.abs(jtC) > 0) {
                                                const tangImpulse = tDir.mult(jtC);
                                                try { addVel(A.sprite, tangImpulse.mult(invA)); addVel(B.sprite, tangImpulse.mult(-invB)); } catch (e) {}
                                            }
                                        }
                                    } catch (e) {}
                                }
                            } catch (e) { /* ignore pair collision errors */ }
                        }
                    }

                    // Apply averaged positional corrections
                    for (const [spr, entry] of posAcc.entries()) {
                        try {
                            const avg = entry.sum.clone().divS(Math.max(1, entry.count));
                            spr.pos.addS(avg);
                        } catch (e) {}
                    }

                    // Update entity polygons positions after positional corrections
                    try {
                        for (const ent of this.entitiesRuntime) {
                            if (ent && ent.sprite && ent.poly && Array.isArray(ent.localVerts)) {
                                const worldVerts = ent.localVerts.map(v => v.add(ent.sprite.pos));
                                try { ent.poly.setVertices(worldVerts); } catch (e) {}
                            }
                        }
                    } catch (e) {}

                    // Apply averaged velocity impulses
                    for (const [spr, entry] of velAcc.entries()) {
                        try {
                            const avg = entry.sum.clone().divS(Math.max(1, entry.count));
                            if (spr.vlos) spr.vlos.addS(avg);
                        } catch (e) {}
                    }
                }
            } catch (e) { /* ignore pairwise collision errors */ }
        } catch (e) { /* ignore collision errors */ }
        
    }

    drawChunks(){
        if (!this.importedChunks) return;
        if (!this.importedChunks.length) return;
        // If imported chunk images exist, draw them at their world positions by layer order.
        const layerOrder = ['bg','base','overlay'];
        for (const layer of layerOrder) {
            const items = this.importedChunks.filter(c => c.layer === layer).sort((a,b)=> (a.y-b.y) || (a.x-b.x));
            for (const c of items) {
                // infer tilePixelSize from image width assuming 16x16 tiles per chunk
                const chunkSize = 16;
                const tilePx = c.image.width / chunkSize;
                const pxX = c.x * tilePx;
                const pxY = c.y * tilePx;
                this.Draw.image(c.image, (new Vector(pxX, pxY)).mult(4), new Vector(c.image.width, c.image.height).mult(4), null, 0, 1, false);
            }
        }
    }

    draw() {
        if (!this.isReady) return;
        // Background (use black when camera is locked to reduce debug clutter)
        const hideDebug = (this.camera && this.camera.locked);
        this.Draw.background(hideDebug ? '#000000' : '#202020');
        this.Draw.useCtx('base');

        // World transform container (so zoom/pan affects content)
        this.Draw.pushMatrix();
        this.Draw.scale(this.zoom);
        this.Draw.translate(this.offset);

        this.drawChunks()

        // draw buffered segment inside world transform so it respects pan/zoom
        if (this.editor && this.editor.polyObjects) {
            for (let i = 0; i < this.editor.polyObjects.length; i++) {
                const obj = this.editor.polyObjects[i];
                try {
                    const isSelected = (this.editor && this.editor.selected === i);
                    const color = isSelected ? '#4466FFCC' : '#66FFAA55';
                    if (!hideDebug) {
                        if (obj) obj.drawBuffer(this.Draw, color);
                        if (obj) obj.drawDebug(this.Draw);
                    }
                    // Draw a thin dark-blue outline for the selected polygon so it stands out
                    if (isSelected) {
                        try {
                            const verts = (obj && obj.vertices && Array.isArray(obj.vertices)) ? obj.vertices : (this.editor.polygons && this.editor.polygons[i] ? this.editor.polygons[i] : []);
                            if (verts && verts.length >= 2) {
                                const strokeCol = '#003366';
                                // keep outline visually thin in screen pixels regardless of zoom
                                const strokeW = 2 / (this.zoom.x || 1);
                                for (let vi = 1; vi < verts.length; vi++) {
                                    try { this.Draw.line(verts[vi-1], verts[vi], strokeCol, strokeW); } catch (e) {}
                                }
                                // close loop
                                try { this.Draw.line(verts[verts.length-1], verts[0], strokeCol, strokeW); } catch (e) {}
                            }
                        } catch (e) {}
                    }
                } catch (e) {}
            }
        }
        if (this.segment && !hideDebug) { this.segment.drawBuffer(this.Draw, '#44AAFF66'); this.segment.drawDebug(this.Draw); }

        // Draw current editing poly (thin lines and points)
        const cur = this.editor.current || [];
        for (let i=1;i<cur.length;i++) {
            this.Draw.line(cur[i-1], cur[i], '#FF66AA', 2);
        }
        for (const p of cur) this.Draw.circle(p, 4, '#FF66AA', true);

        // Live preview: if Shift is held and there's at least one point, show snapped
        // preview from last point to mouse position constrained to 8 directions.
        try {
            const shiftHeld = this.keys && (this.keys.held && this.keys.held('Shift'));
            if (shiftHeld && cur.length > 0 && this.mouse) {
                const last = cur[cur.length - 1];
                const mworld = this.getWorldPos(this.mouse.pos || new Vector(0,0));
                const delta = mworld.sub(last);
                const len = delta.mag();
                let preview = mworld;
                if (len > 1e-6) {
                    const step = Math.PI / 4; // 8 directions (45deg)
                    const ang = Math.atan2(delta.y, delta.x);
                    const snapped = Math.round(ang / step) * step;
                    const dir = new Vector(Math.cos(snapped), Math.sin(snapped));
                    const projLen = delta.x * dir.x + delta.y * dir.y;
                    preview = last.add(dir.mult(projLen));
                } else {
                    preview = last.clone();
                }
                // draw preview line and point
                this.Draw.line(last, preview, '#FF66AA', 2);
                this.Draw.circle(preview, 4, '#FF66AA', true);
            }
        } catch (e) { /* ignore preview errors */ }
        // draw cat and its collision debug only if loaded
        if (this.cat) {
            try {
                const center = this.cat.pos.add(this.cat.size.mult(0.5));
                const radius = this.catRadius || Math.min(this.cat.size.x, this.cat.size.y) * 0.2;
                if (!hideDebug) this.Draw.circle(center, radius, '#00FF00AA', false, 2);
            } catch (e) {}
            try { this.cat.draw(new Vector(0,0)); } catch (e) { console.warn('CollisionScene: error drawing cat', e); }
            // delegate ground-check visualization to Cat (position/size/drawing belong there)
            try { if (!hideDebug && typeof this.cat.drawGroundCheck === 'function') this.cat.drawGroundCheck(new Vector(0,0)); } catch (e) {}
        }

        // Draw vertex handles when a polygon is selected
        try {
            const sel = (this.editor && typeof this.editor.selected === 'number') ? this.editor.selected : -1;
            if (sel >= 0 && Array.isArray(this.editor.polygons) && this.editor.polygons[sel]) {
                // When a transform preview is active, prefer the polyObject vertices so handles follow preview.
                const usePreview = (this._grabState && this._grabState.active && typeof this._grabState.idx === 'number' && this._grabState.idx === sel && this.editor.polyObjects && this.editor.polyObjects[sel]);
                const polySource = usePreview ? (this.editor.polyObjects[sel] && this.editor.polyObjects[sel].vertices ? this.editor.polyObjects[sel].vertices : this.editor.polygons[sel]) : this.editor.polygons[sel];
                const handlePx = 8; // screen-pixel size
                const handleWorldR = handlePx / (this.zoom.x || 1);
                for (let vi = 0; vi < polySource.length; vi++) {
                    const v = polySource[vi];
                    const isSelected = (this.editor && typeof this.editor.selectedVertex === 'number' && this.editor.selectedVertex === vi);
                    const col = isSelected ? '#FFAA66' : '#FFFF66';
                    this.Draw.circle(v, handleWorldR, col, true);
                    // outline
                    this.Draw.circle(v, handleWorldR + (2 / (this.zoom.x || 1)), '#00000088', false);
                }
            }
        } catch (e) {}
        // Draw spawn/goal boxes (world)
        if (this.levelData.spawn && !hideDebug) {
            const p = new Vector(this.levelData.spawn.pos.x, this.levelData.spawn.pos.y);
            const sz = new Vector(this.levelData.spawn.size.x, this.levelData.spawn.size.y);
            // single call: fill + outline
            this.Draw.rect(p, sz, '#FFFF0088', true, true, 2, '#FFFF00FF');
        }
        if (this.levelData.goal && !hideDebug) {
            const p = new Vector(this.levelData.goal.pos.x, this.levelData.goal.pos.y);
            const sz = new Vector(this.levelData.goal.size.x, this.levelData.goal.size.y);
            // single call: fill + outline
            this.Draw.rect(p, sz, '#00FF0088', true, true, 2, '#00FF00FF');
        }
        // Draw entities in world (use sprites if available)
        if (Array.isArray(this.entitiesRuntime) && this.entitiesRuntime.length) {
            for (const r of this.entitiesRuntime) {
                if (!r || !r.sprite) continue;
                try {
                    // If held, position it relative to the holder (cat) instead of its own pos
                    if (r.held && r._heldBy) {
                        try { r.sprite.pos = r._heldBy.pos.clone().add(r._heldBy.holdOffset || new Vector(0,0)); } catch (e) {}
                    }
                    if (r.type === 'box' && r.sprite) r.sprite.draw(new Vector(0,0));
                } catch (e) {}
            }
        } else if (Array.isArray(this.levelData.entities)) {
            // Fallback if runtime not built yet
            for (const ent of this.levelData.entities) {
                if (ent.type === 'box' && ent.pos && ent.size) {
                    const p = new Vector(ent.pos.x, ent.pos.y);
                    const sz = new Vector(ent.size.x, ent.size.y);
                    this.Draw.rect(p, sz, '#00CCFFFF', true, true, 2, '#0066FFFF');
                }
            }
        }

        // Draw entity collision buffers (polygons) for debug/visualization (skip when hiding debug)
        if (!hideDebug && Array.isArray(this.entitiesRuntime) && this.entitiesRuntime.length) {
            for (const r of this.entitiesRuntime) {
                if (!r || !r.sprite) continue;
                try {
                    if (r.poly) {
                        try { r.poly.drawBuffer(this.Draw, '#FF6666AA55'); r.poly.drawDebug(this.Draw); } catch (e) {}
                    } else {
                        const sprite = r.sprite;
                        const center = sprite.pos.add(sprite.size.mult(0.5));
                        const radius = Math.min(sprite.size.x, sprite.size.y) * 0.4;
                        //this.Draw.circle(center, radius, '#FF6666AA', false, 2);
                    }
                } catch (e) {}
            }
        }

        this.Draw.popMatrix();

        // Optional UI label and Entities UI label
        if (this.UIDraw) {
            this.UIDraw.useCtx('UI');
            this.UIDraw.text('Collision Editor (WIP)', new Vector(32, 32), '#FFFFFFFF', 1, 20, { align: 'left', baseline: 'top' });
            const count = (this.importedChunks && this.importedChunks.length) ? this.importedChunks.length : (this.importedSheets && this.importedSheets.length) ? this.importedSheets.length : 0;
            if (count) this.UIDraw.text(`Images: ${count}`, new Vector(32, 56), '#FFFFFFFF', 1, 16, { align: 'left', baseline: 'top' });
            // Small HUD showing zoom level
            this.UIDraw.text(`zoom: ${this.zoom.x.toFixed(2)}x`, new Vector(32, 76), '#FFFFFFFF', 1, 16, { align: 'left', baseline: 'top' });
            // Gravity status
            this.UIDraw.text(`gravity: ${this.gravityEnabled ? 'on' : 'off'}`, new Vector(32, 96), '#FFFFFFFF', 1, 16, { align: 'left', baseline: 'top' });
            // Draw Entities UI components and labels at their positions
            if (this.entitiesUI && this.entitiesUI.menu) {
                const m = this.entitiesUI.menu;
                this.entitiesUI.menu.draw(this.UIDraw);
                // Title inside label area
                this.UIDraw.text('Entities', m.pos.add(new Vector(12, 10)), '#FFFFFFCC', 1, 14, { align: 'left', baseline: 'top' });
                // Button label: align with button local pos (8,34)
                this.UIDraw.text('Add Box', m.pos.add(new Vector(16, 40)), '#FFFFFF', 1, 13, { align: 'left', baseline: 'top' });
            }
        }

        
        
    }
}

// Export helpers
CollisionScene.prototype.exportLevelJSON = function(){
    try {
        const data = {
            spawn: this.levelData.spawn,
            goal: this.levelData.goal,
            entities: this.levelData.entities || [],
            // Export collision as array of objects so we can preserve per-polygon buffer radii
            collision: (this.editor.polygons || []).map((poly, idx) => {
                const verts = (poly || []).map(v => [v.x, v.y]);
                const base = (this.editor.polyObjects && this.editor.polyObjects[idx] && typeof this.editor.polyObjects[idx].baseRadius === 'number') ? this.editor.polyObjects[idx].baseRadius : this.editor.baseRadius;
                return { verts, baseRadius: base };
            })
        };
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'level.json';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { try { URL.revokeObjectURL(url); a.remove(); } catch(e){} }, 0);
    } catch (e) {
        console.warn('exportLevelJSON failed', e);
    }
}

// Export level + imported chunk images as a .tar (includes level.json)
CollisionScene.prototype.exportLevelTar = async function(filename = 'level.tar'){
    try {
        const entries = [];
        // include imported chunk images if present
        try {
            if (Array.isArray(this.importedChunks) && this.importedChunks.length) {
                for (const c of this.importedChunks) {
                    try {
                        const img = c.image;
                        if (!img) continue;
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width; canvas.height = img.height;
                        const ctx = canvas.getContext('2d'); ctx.drawImage(img,0,0);
                        const blob = await new Promise((res)=>canvas.toBlob(res,'image/png'));
                        const arrayBuf = await blob.arrayBuffer();
                        const name = `${c.layer}/${c.x}_${c.y}.png`;
                        entries.push({ name, data: new Uint8Array(arrayBuf) });
                    } catch (e) { console.warn('Failed to include chunk image', e); }
                }
            }
        } catch (e) {}

        // include level JSON
        try {
                const data = {
                spawn: this.levelData.spawn,
                goal: this.levelData.goal,
                entities: this.levelData.entities || [],
                collision: (this.editor.polygons || []).map((poly, idx) => {
                    const verts = (poly || []).map(v => [v.x, v.y]);
                    const base = (this.editor.polyObjects && this.editor.polyObjects[idx] && typeof this.editor.polyObjects[idx].baseRadius === 'number') ? this.editor.polyObjects[idx].baseRadius : this.editor.baseRadius;
                    return { verts, baseRadius: base };
                })
            };
            const json = JSON.stringify(data, null, 2);
            entries.push({ name: 'level.json', data: new TextEncoder().encode(json) });
        } catch (e) { console.warn('Failed to build level.json', e); }

        const tarBlob = await this.packageManager.createTarBlob(entries);

        // Save (File System Access API if available)
        try {
            if (window.showSaveFilePicker) {
                const opts = { suggestedName: filename, types: [{ description: 'TAR Archive', accept: { 'application/x-tar': ['.tar'] } }] };
                const handle = await window.showSaveFilePicker(opts);
                const writable = await handle.createWritable();
                await writable.write(tarBlob);
                await writable.close();
                console.log('Level tar saved to file:', handle.name);
                return true;
            }
        } catch (e) { console.warn('Save via FS API failed, falling back to download', e); }

        // Fallback: download
        try {
            const url = URL.createObjectURL(tarBlob);
            const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
            console.log('Level tar downloaded:', filename);
            return true;
        } catch (e) { console.warn('Fallback download failed', e); return false; }
    } catch (e) { console.warn('exportLevelTar failed', e); return false; }
}

// Load map/level payload (spawn, goal, entities, collision) into scene
CollisionScene.prototype.loadMapFromPayload = function(payload){
    try {
        if (!payload) return false;
        // apply spawn/goal/entities
        try { if (payload.spawn) this.levelData.spawn = payload.spawn; } catch (e) {}
        try { if (payload.goal) this.levelData.goal = payload.goal; } catch (e) {}
        try { this.levelData.entities = Array.isArray(payload.entities) ? payload.entities : (this.levelData.entities || []); } catch (e) {}
        // rebuild runtime entities from levelData.entities
        try {
            this.entitiesRuntime = [];
            for (const ent of this.levelData.entities || []) {
                if (ent.type === 'box' && ent.pos && ent.size) {
                    let BoxSheet = new SpriteSheet(this.assets.boxImage,16);
                    BoxSheet.addAnimation('base',0,8);
                    const sprite = new Sprite(this.Draw, new Vector(ent.pos.x, ent.pos.y), new Vector(ent.size.x, ent.size.y), BoxSheet);
                    try { sprite.mass = ent.mass || this.defaultEntityMass; } catch (e) {}
                    // Build polygon collider for this entity
                    const cornerRadius = Math.max(4, Math.min(ent.size.x, ent.size.y) * 0.12);
                    // Inset vertices by cornerRadius so the buffered capsule aligns
                    // with the sprite's visible edges (reduces collider by one radius)
                    const localVerts = [
                        new Vector(cornerRadius, cornerRadius),
                        new Vector(Math.max(cornerRadius, ent.size.x - cornerRadius), cornerRadius),
                        new Vector(Math.max(cornerRadius, ent.size.x - cornerRadius), Math.max(cornerRadius, ent.size.y - cornerRadius)),
                        new Vector(cornerRadius, Math.max(cornerRadius, ent.size.y - cornerRadius))
                    ];
                    const worldVerts = localVerts.map(v => v.add(sprite.pos));
                    let polyObj = null;
                    try { polyObj = new BufferedPolygon(worldVerts, cornerRadius, this.editor.coeffs, true); } catch (e) { polyObj = null; }
                    this.entitiesRuntime.push({ type: 'box', sprite, poly: polyObj, localVerts, cornerRadius });
                }
            }
        } catch (e) { console.warn('Failed to rebuild runtime entities', e); }

        // apply collision polygons if provided (supports old and new formats)
        try {
            if (payload.collision && Array.isArray(payload.collision)) {
                this.editor.polygons = [];
                this.editor.polyObjects = [];
                for (const item of payload.collision) {
                    try {
                        if (Array.isArray(item) && Array.isArray(item[0])) {
                            // old format: array of [x,y] points
                            const poly = item.map(p => new Vector(p[0], p[1]));
                            this.editor.polygons.push(poly);
                            try { this.editor.polyObjects.push(new BufferedPolygon(poly, this.editor.baseRadius, this.editor.coeffs)); } catch (e) { this.editor.polyObjects.push(null); }
                        } else if (item && Array.isArray(item.verts)) {
                            // new format: { verts: [[x,y],...], baseRadius: number }
                            const poly = (item.verts || []).map(p => new Vector(p[0], p[1]));
                            const base = (typeof item.baseRadius === 'number') ? item.baseRadius : this.editor.baseRadius;
                            this.editor.polygons.push(poly);
                            try { this.editor.polyObjects.push(new BufferedPolygon(poly, base, this.editor.coeffs)); } catch (e) { this.editor.polyObjects.push(null); }
                        } else {
                            // unexpected entry: skip
                        }
                    } catch (e) {}
                }
            }
        } catch (e) {}

        // position the cat at spawn center if available
        try {
            if (payload.spawn) {
                const sp = payload.spawn;
                const spawnPos = new Vector(sp.pos.x, sp.pos.y);
                const spawnSize = new Vector(sp.size.x, sp.size.y);
                // center cat in spawn region
                const target = spawnPos.add(spawnSize.mult(0.5)).sub(this.cat.size.mult(0.5));
                if(target) this.cat.pos = target;
            }
        } catch (e) {}

        return true;
    } catch (e) { console.warn('loadMapFromPayload failed', e); return false; }
}
