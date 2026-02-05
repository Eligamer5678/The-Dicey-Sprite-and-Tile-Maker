import Vector from '../Vector.js';
import Menu from './Menu.js';
import UIImage from './Image.js';
import UIButton from './Button.js';
import UIRect from './Rect.js';
import UISlider from './Slider.js';
import Geometry from '../Geometry.js';
import UITextInput from './UITextInput.js';
import SpriteSheet from '../Spritesheet.js';
import createHButton from '../htmlElements/createHButton.js';
import createHInput from '../htmlElements/createHInput.js';

export default class FrameSelect {
    constructor(scene,sprite, mouse, keys, UIDraw, layer = 1) {
        this.scene = scene
        this.sprite = sprite;
        this.mouse = mouse;
        this.keys = keys;
        this.UIDraw = UIDraw;
        this.layer = layer;
        this.scrollPos = 0
        this._animTimer = 0;
        this._animIndex = 0;
        this._animFps = 8;
        this._previewSize = 256;
        this._previewBuffer = 16;
        this._animName = null;
        // multi-frame selection (store indices)
        this._multiSelected = new Set();
        // id of the last-clicked group (for toggling layered state)
        this._activeGroup = null;
        // Create a fps slider
        const sliderPos = new Vector(1920 - this._previewBuffer * 3 - this._previewSize, this._previewBuffer + (this._previewSize + this._previewBuffer * 2) + 8);
        const sliderSize = new Vector(this._previewSize+this._previewBuffer*2, 20);
        let fpsSlider = new UISlider(this.mouse, this.keys, sliderPos, sliderSize, this.layer, 'scalar', this._animFps, 0, 24, '#888888', '#444444', '#222222', '#FFFF00',null);
        fpsSlider.onChange.connect((v) => { 
            this._animFps = Math.max(0, Math.round(v)); 
            if(this._animFps === 0) this._animIndex = this.selectedFrame
        });
        this.menu = new Menu(this.mouse, this.keys, new Vector(0, 0), new Vector(200, 1080), this.layer, '#FFFFFF22');
        this.menu.addElement('fpsSlider', fpsSlider)

        // inline text input for renaming/adding animations
        this._textInput = null;
        this._animEditTarget = null; // animation name being edited
        // import/export UI elements (created in constructor)
        this._importInput = null;
        this._importBtn = null;
        this._exportBtn = null;
        this._createImportExportUI();
    }

    // Rebuild palette entries from scene.tileTypes (array of {sheetId,row,col})
    rebuild() {
        // clear existing
        this.menu.elements.clear();
        this._entries = [];

        

        return true;
    }

    // --- animation list helpers ---
    _getAnimationNames(){
        if (!this.sprite || !this.sprite._frames) return [];
        try { return Array.from(this.sprite._frames.keys()); } catch(e) { return []; }
    }

    _uniqueAnimName(base='anim'){
        const names = new Set(this._getAnimationNames());
        if (!names.has(base)) return base;
        let i = 1;
        while(names.has(base + i)) i++;
        return base + i;
    }

    // --- frame group helpers (groups are stored per-animation on the sprite)
    _getFrameGroups(anim){
        if (!this.sprite) return [];
        if (!this.sprite._frameGroups) this.sprite._frameGroups = new Map();
        const arr = this.sprite._frameGroups.get(anim);
        return Array.isArray(arr) ? arr : [];
    }

    // Copy all non-transparent pixels from a source canvas into the given
    // logical frame index on the sprite using modifyFrame/setPixel so that
    // multiplayer edit buffering sees the changes.
    _copyCanvasToFrame(anim, frameIndex, srcCanvas){
        try {
            if (!this.sprite || !srcCanvas) return false;
            if (typeof frameIndex !== 'number' || frameIndex < 0) return false;
            const w = srcCanvas.width | 0;
            const h = srcCanvas.height | 0;
            if (!w || !h) return false;
            const sctx = srcCanvas.getContext('2d');
            if (!sctx) return false;
            let img;
            try { img = sctx.getImageData(0, 0, w, h); } catch (e) { return false; }
            const data = img.data;
            const pixels = [];
            const toHex = (c) => {
                const v = Math.max(0, Math.min(255, c|0));
                const s = v.toString(16);
                return s.length === 1 ? '0' + s : s;
            };
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const off = (y * w + x) * 4;
                    const a = data[off+3];
                    if (a === 0) continue;
                    const r = data[off];
                    const g = data[off+1];
                    const b = data[off+2];
                    const hex = '#' + toHex(r) + toHex(g) + toHex(b) + toHex(a);
                    pixels.push({ x, y, color: hex, blendType: 'replace' });
                }
            }
            if (pixels.length === 0) return true;
            if (typeof this.sprite.modifyFrame === 'function') {
                this.sprite.modifyFrame(anim, frameIndex, pixels);
            } else if (typeof this.sprite.setPixel === 'function') {
                for (const p of pixels) {
                    try { this.sprite.setPixel(anim, frameIndex, p.x, p.y, p.color, 'replace'); } catch (e) {}
                }
            }
            return true;
        } catch (e) {
            console.warn('FrameSelect _copyCanvasToFrame failed', e);
            return false;
        }
    }

    _addFrameGroup(anim, indices){
        if (!this.sprite) return null;
        if (!this.sprite._frameGroups) this.sprite._frameGroups = new Map();
        let groups = this.sprite._frameGroups.get(anim) || [];
        // avoid overlapping membership: don't allow grouping indices already in any group
        for (const g of groups){
            for (const idx of g.indices) if (indices.includes(idx)) return null;
        }
        const id = 'g' + (Date.now().toString(36) + Math.random().toString(36).slice(2,6));
        const sorted = Array.from(new Set(indices)).map(Number).sort((a,b)=>a-b);
        const group = { id: id, indices: sorted, collapsed: false, layered: false };
        groups.push(group);
        this.sprite._frameGroups.set(anim, groups);
        return group;
    }

    _removeFrameGroup(anim, id){
        if (!this.sprite || !this.sprite._frameGroups) return false;
        const groups = this.sprite._frameGroups.get(anim) || [];
        const idx = groups.findIndex(g => g.id === id);
        if (idx === -1) return false;
        groups.splice(idx,1);
        this.sprite._frameGroups.set(anim, groups);
        return true;
    }

    _toggleGroupCollapsed(anim, id){
        const groups = this._getFrameGroups(anim);
        const g = groups.find(x=>x.id===id);
        if (!g) return false;
        g.collapsed = !g.collapsed;
        if (!this.sprite._frameGroups) this.sprite._frameGroups = new Map();
        this.sprite._frameGroups.set(anim, groups);
        return true;
    }

    addAnimation(){
        if (!this.sprite) return;
        if (!this.sprite._frames) this.sprite._frames = new Map();
        const newName = this._uniqueAnimName('anim');
        this.sprite._frames.set(newName, []);
        if (typeof this.sprite._rebuildSheetCanvas === 'function') this.sprite._rebuildSheetCanvas();
        if (this.scene) this.scene.selectedAnimation = newName;
        // spawn text input to rename immediately
        this._spawnTextInputFor(newName);
    }

    renameAnimation(oldName, newName){
        if (!this.sprite || !this.sprite._frames) return false;
        if (!oldName || !newName) return false;
        newName = String(newName).trim();
        if (newName.length === 0) return false;
        if (this.sprite._frames.has(newName)) return false; // avoid collision
        const arr = this.sprite._frames.get(oldName);
        this.sprite._frames.set(newName, arr);
        this.sprite._frames.delete(oldName);
        if (typeof this.sprite._rebuildSheetCanvas === 'function') this.sprite._rebuildSheetCanvas();
        if (this.scene && this.scene.selectedAnimation === oldName) this.scene.selectedAnimation = newName;
        return true;
    }

    removeAnimation(name){
        if (!this.sprite || !this.sprite._frames) return false;
        if (!this.sprite._frames.has(name)) return false;
        this.sprite._frames.delete(name);
        if (typeof this.sprite._rebuildSheetCanvas === 'function') this.sprite._rebuildSheetCanvas();
        // adjust selection
        const names = this._getAnimationNames();
        if (this.scene){
            if (names.length > 0) this.scene.selectedAnimation = names[0];
            else this.scene.selectedAnimation = 'idle';
        }
        return true;
    }

    _spawnTextInputFor(animName){
        // place input roughly under preview area (draw uses same calc)
        const outerPos = new Vector(1920-this._previewBuffer*3-this._previewSize, this._previewBuffer);
        const contentPos = outerPos.clone().add(new Vector(this._previewBuffer, this._previewBuffer));
        const contentSize = new Vector(this._previewSize, this._previewSize);
        const listX = contentPos.x;
        const listY = contentPos.y + contentSize.y + 8 + 50; // drop list down 50px to avoid overlap
        const names = this._getAnimationNames();
        const idx = names.indexOf(animName);
        const rowH = 28;
        const rowY = listY + idx * rowH;
        const pos = new Vector(listX + 4, rowY + 4);
        const size = new Vector(contentSize.x - 8 - 80, rowH - 8);
        this._textInput = new UITextInput(this.mouse, this.keys, pos, size, this.layer+1, animName, 'name');
        this._animEditTarget = animName;
        // wire submit
        this._textInput.onSubmit.connect((val)=>{
            if (val && String(val).trim().length>0){
                const ok = this.renameAnimation(this._animEditTarget, val);
                // if rename failed (collision/idle), leave old name
            }
            this._textInput = null;
            this._animEditTarget = null;
        });
        this._textInput.focus();
    }

    async _handleImportFile(ev){
        try{
            const files = ev.target.files || [];
            if (!files || files.length === 0) return;
            const file = files[0];
            // Ask whether this file should be treated as a spritesheet (default) or tilesheet
            let importMode = 'spritesheet';
            try {
                const choice = window.prompt('Import as? 1 = spritesheet, 2 = tilesheet', '1');
                if (choice !== null) {
                    const v = String(choice).trim();
                    if (v === '2') importMode = 'tilesheet';
                    else importMode = 'spritesheet';
                }
            } catch (e) { /* ignore and fall back to spritesheet */ }
            // Prefer createImageBitmap for reliable decoding. Fallback to Image if unavailable.
            let bitmap = null;
            try {
                if (window.createImageBitmap) {
                    bitmap = await createImageBitmap(file);
                }
            } catch (e) {
                console.warn('createImageBitmap failed, falling back to Image()', e);
                bitmap = null;
            }
            let img = null;
            if (!bitmap) {
                const url = URL.createObjectURL(file);
                img = new Image();
                img.src = url;
                await new Promise((res, rej)=>{ img.onload = res; img.onerror = rej; });
            }
            // Prompt for slice size
            const defaultSlice = (this.sprite && this.sprite.slicePx) ? this.sprite.slicePx : 16;
            let sliceStr = window.prompt('Enter slice size (px) for frames (one tile size)', String(defaultSlice));
            if (!sliceStr) { try { if (img && img.src && img.src.startsWith('blob:')) URL.revokeObjectURL(img.src); } catch(e){} return; }
            let slice = parseInt(sliceStr, 10);
            if (isNaN(slice) || slice <= 0) slice = defaultSlice;
            const srcW = bitmap ? bitmap.width : img.width;
            const srcH = bitmap ? bitmap.height : img.height;
            const cols = Math.max(1, Math.floor(srcW / slice));
            const rows = Math.max(1, Math.floor(srcH / slice));
            console.log('Importing spritesheet:', file.name, 'img', srcW + 'x' + srcH, 'slice', slice, 'cols', cols, 'rows', rows, 'mode', importMode);
            // Build SpriteSheet
            const ss = new SpriteSheet(img, slice);
            ss._frames = new Map();
            let counter = 0;
            for (let r = 0; r < rows; r++){
                const frames = [];
                for (let c = 0; c < cols; c++){
                    // create a lazy descriptor pointing to the source image/bitmap
                    const desc = {
                        __lazy: true,
                        src: bitmap || img,
                        sx: c * slice,
                        sy: r * slice,
                        w: slice,
                        h: slice
                    };
                    frames.push(desc);
                }
                // generate a simple name (anim0, anim1, ...)
                let name = 'anim' + counter;
                while (ss._frames.has(name)) { counter++; name = 'anim' + counter; }
                counter++;
                ss._frames.set(name, frames);
            }
            ss._rebuildSheetCanvas();
            // Some browsers may delay bitmap availability in the rendering pipeline; force a short refresh
            setTimeout(()=>{
                try{
                    if (ss && typeof ss._rebuildSheetCanvas === 'function') ss._rebuildSheetCanvas();
                    if (this.scene && this.scene.currentSprite === ss) {
                        // nudge the scene to rebind the sprite (forces any dependent caches to update)
                        this.scene.currentSprite = ss;
                        this.scene.selectedAnimation = Array.from(ss._frames.keys())[0] || 'idle';
                        this.scene.selectedFrame = 0;
                    }
                }catch(e){console.warn('post-import refresh failed',e)}
            }, 50);
            // apply to scene
            if (this.scene){
                this.scene.currentSprite = ss;
                const animNames = Array.from(ss._frames.keys());
                const firstAnim = animNames[0] || 'idle';
                this.scene.selectedAnimation = firstAnim;
                // materialize frames for the first animation so preview shows up
                try { if (typeof ss._materializeAnimation === 'function') ss._materializeAnimation(firstAnim); } catch(e) {}
                this.scene.selectedFrame = 0;

                // If importing as a tilesheet, enable tilemode and mirror the grid.
                if (importMode === 'tilesheet') {
                    try {
                        const scene = this.scene;
                        scene.tileCols = cols;
                        scene.tileRows = rows;
                        scene.tilemode = true;
                        // reset any existing bindings/transforms
                        scene._areaBindings = [];
                        scene._areaTransforms = [];
                        // Map each grid row to its own animation, each column to a frame in that animation.
                        const names = animNames && animNames.length ? animNames : Array.from(ss._frames.keys());
                        for (let r = 0; r < rows; r++){
                            const animName = names[r] || names[0] || firstAnim;
                            for (let c = 0; c < cols; c++){
                                const areaIndex = r * cols + c;
                                scene._areaBindings[areaIndex] = { anim: animName, index: c };
                                scene._areaTransforms[areaIndex] = { rot: 0, flipH: false };
                            }
                        }
                    } catch (e) { console.warn('tilesheet import tilemode setup failed', e); }
                }
            }
            this.sprite = ss;
            // cleanup URL object if we used Image fallback
            try{ if (img && img.src && img.src.startsWith('blob:')) URL.revokeObjectURL(img.src); } catch(e){}
            console.log('Import completed: animations=', Array.from(ss._frames.keys()).length);
            // clear input value so same file can be re-picked later
            try{ ev.target.value = ''; } catch(e){}
        } catch (e) { console.warn('import failed', e); }
    }

    async _handleExport(){
        try{
            const sheet = this.sprite && this.sprite.sheet ? this.sprite.sheet : null;
            if (!sheet) { alert('No sprite sheet to export'); return; }
            // Ask whether to export as spritesheet (packed) or tilesheet (current tile-mode view)
            let exportMode = 'spritesheet';
            try {
                const choice = window.prompt('Export as? 1 = spritesheet, 2 = tilesheet', '1');
                if (choice !== null) {
                    const v = String(choice).trim();
                    if (v === '2') exportMode = 'tilesheet';
                    else exportMode = 'spritesheet';
                }
            } catch (e) { /* ignore and keep spritesheet */ }
            const defaultName = (this.scene && this.scene.currentSprite && this.scene.currentSprite.name) ? this.scene.currentSprite.name : 'spritesheet';
            const filenamePrompt = window.prompt('Export filename', defaultName + '.png');
            // If the user cancelled the prompt (null), abort export and do not download.
            if (filenamePrompt === null) return;
            const filename = filenamePrompt || (defaultName + '.png');
            // Prompt whether to also download metadata JSON. If confirmed, ask for a metadata filename.
            let wantMeta = false;
            let chosenMetaFilename = null;
            try {
                const wantMetaConfirm = window.confirm('Also download metadata JSON alongside the PNG?');
                if (wantMetaConfirm) {
                    const suggestedMeta = (filename && filename.toLowerCase().endsWith('.png')) ? filename.replace(/\.png$/i, '.json') : (filename + '.json');
                    const metaPrompt = window.prompt('Metadata filename (Cancel to skip)', suggestedMeta);
                    if (metaPrompt !== null) {
                        chosenMetaFilename = metaPrompt || suggestedMeta;
                        wantMeta = true;
                    } else {
                        wantMeta = false;
                    }
                }
            } catch (e) { /* ignore prompt failures */ }
            // toBlob
            // ensure packed sheet is available (may have been deferred for performance)
            try { if (this.sprite && typeof this.sprite.ensurePackedSheet === 'function') this.sprite.ensurePackedSheet(); } catch(e) {}

            // Build an export canvas depending on mode
            let exportCanvas = null;
            if (exportMode === 'tilesheet' && this.scene && this.scene.currentSprite) {
                try {
                    const scene = this.scene;
                    const slice = scene.currentSprite.slicePx || (this.sprite && this.sprite.slicePx) || 16;
                    const cols = Math.max(1, (scene.tileCols|0) || 3);
                    const rows = Math.max(1, (scene.tileRows|0) || 3);
                    const areaCount = cols * rows;
                    // Prepare canvas sized to the tile grid
                    exportCanvas = document.createElement('canvas');
                    exportCanvas.width = cols * slice;
                    exportCanvas.height = rows * slice;
                    const ectx = exportCanvas.getContext('2d');
                    try { ectx.imageSmoothingEnabled = false; } catch (e) {}
                    // For each area, determine bound frame (or selected frame) and draw into grid
                    for (let idx = 0; idx < areaCount; idx++) {
                        const r = Math.floor(idx / cols);
                        const c = idx % cols;
                        const binding = (Array.isArray(scene._areaBindings) && scene._areaBindings[idx]) ? scene._areaBindings[idx] : null;
                        const anim = binding && binding.anim ? binding.anim : scene.selectedAnimation;
                        const frameIndex = binding && typeof binding.index === 'number' ? binding.index : scene.selectedFrame;
                        const frameCanvas = (anim && typeof scene.currentSprite.getFrame === 'function') ? scene.currentSprite.getFrame(anim, frameIndex) : null;
                        if (!frameCanvas) continue;
                        const transform = (Array.isArray(scene._areaTransforms) && scene._areaTransforms[idx]) ? scene._areaTransforms[idx] : null;
                        const hasTransform = !!(transform && ((transform.rot || 0) !== 0 || transform.flipH));
                        const dx = c * slice;
                        const dy = r * slice;
                        if (!hasTransform) {
                            try {
                                ectx.drawImage(frameCanvas, 0, 0, frameCanvas.width, frameCanvas.height, dx, dy, slice, slice);
                            } catch (e) { /* ignore */ }
                        } else {
                            try {
                                ectx.save();
                                ectx.translate(dx + slice / 2, dy + slice / 2);
                                if (transform.flipH) ectx.scale(-1, 1);
                                ectx.rotate((transform.rot || 0) * Math.PI / 180);
                                ectx.drawImage(frameCanvas, -slice / 2, -slice / 2, slice, slice);
                                ectx.restore();
                            } catch (e) { /* ignore */ }
                        }
                    }
                } catch (err) { console.warn('tilesheet export build failed', err); }
            } else {
                // Original spritesheet export: optionally merge layered groups for the current animation
                try {
                    const anim = (this.scene && this.scene.selectedAnimation) ? this.scene.selectedAnimation : null;
                    const framesArr = (this.sprite && this.sprite._frames && anim) ? (this.sprite._frames.get(anim) || []) : [];
                    const groups = this._getFrameGroups(anim);
                    const hasLayered = Array.isArray(groups) && groups.some(g => !!g.layered);
                    if (anim && framesArr.length > 0 && hasLayered) {
                        // Build logical sequence collapsing layered groups
                        const seq = [];
                        for (let i = 0; i < framesArr.length; i++){
                            const grp = groups.find(g => Math.min.apply(null, g.indices) === i);
                            if (grp && grp.layered) {
                                seq.push({ type: 'group', group: grp });
                                i = Math.max.apply(null, grp.indices);
                                continue;
                            }
                            seq.push({ type: 'frame', index: i });
                        }
                        // create per-logical-frame canvases (slicePx x slicePx)
                        const slice = (this.sprite && this.sprite.slicePx) ? this.sprite.slicePx : 16;
                        const framesCanv = [];
                        for (const e of seq){
                            const fc = document.createElement('canvas');
                            fc.width = slice; fc.height = slice;
                            const fctx = fc.getContext('2d');
                            if (e.type === 'frame'){
                                try {
                                    const src = (typeof this.sprite.getFrame === 'function') ? this.sprite.getFrame(anim, e.index) : null;
                                    if (src && src.getContext) fctx.drawImage(src, 0, 0);
                                } catch (err) { /* ignore */ }
                            } else if (e.type === 'group'){
                                // composite each member frame in order
                                const idxs = Array.isArray(e.group.indices) ? e.group.indices.slice().sort((a,b)=>a-b) : [];
                                for (const fi of idxs){
                                    try {
                                        const src = (typeof this.sprite.getFrame === 'function') ? this.sprite.getFrame(anim, fi) : null;
                                        if (src && src.getContext) fctx.drawImage(src, 0, 0);
                                    } catch (err) { /* ignore */ }
                                }
                            }
                            framesCanv.push(fc);
                        }
                        // tile into a grid (max 8 columns)
                        const n = framesCanv.length;
                        const cols = Math.min(8, Math.max(1, n));
                        const rows = Math.ceil(n / cols);
                        exportCanvas = document.createElement('canvas');
                        exportCanvas.width = cols * slice;
                        exportCanvas.height = rows * slice;
                        const ectx = exportCanvas.getContext('2d');
                        for (let i = 0; i < n; i++){
                            const r = Math.floor(i / cols);
                            const c = i % cols;
                            ectx.drawImage(framesCanv[i], c * slice, r * slice);
                        }
                    }
                } catch (err) { console.warn('build merged export canvas failed', err); }
            }

            const blob = await new Promise((res)=> {
                if (exportCanvas && exportCanvas.toBlob) return exportCanvas.toBlob((b)=>res(b), 'image/png');
                if (sheet && sheet.toBlob) return sheet.toBlob((b)=>res(b), 'image/png');
                // fallback: try to use sprite.sheet canvas if available
                try { if (this.sprite && this.sprite.sheet && this.sprite.sheet.toBlob) return this.sprite.sheet.toBlob((b)=>res(b), 'image/png'); } catch(e){}
                // ultimate fallback: create an empty 1x1 png
                const c = document.createElement('canvas'); c.width = 1; c.height = 1; c.toBlob((b)=>res(b), 'image/png');
            });
            // Build metadata JSON containing groups and basic animation info
            const buildMetadata = () => {
                const meta = {};
                try {
                    meta.name = (this.scene && this.scene.currentSprite && this.scene.currentSprite.name) ? this.scene.currentSprite.name : (this.sprite && this.sprite.name) || null;
                    meta.slicePx = this.sprite && this.sprite.slicePx ? this.sprite.slicePx : null;
                    // animations: name -> frameCount
                    meta.animations = {};
                    if (this.sprite && this.sprite._frames) {
                        for (const [k, v] of this.sprite._frames.entries()){
                            try { meta.animations[k] = Array.isArray(v) ? v.length : (typeof v.length === 'number' ? v.length : null); } catch(e){ meta.animations[k] = null; }
                        }
                    }
                    // frameGroups: convert Map -> plain object
                    meta.frameGroups = {};
                    if (this.sprite && this.sprite._frameGroups) {
                        try {
                            for (const [anim, groups] of this.sprite._frameGroups.entries()){
                                meta.frameGroups[anim] = Array.isArray(groups) ? groups.map(g => ({ id: g.id, indices: Array.isArray(g.indices)? g.indices.slice() : [], collapsed: !!g.collapsed, layered: !!g.layered })) : [];
                            }
                        } catch(e) { /* ignore */ }
                    }
                } catch (e) { /* ignore */ }
                return meta;
            };

            const metaObj = buildMetadata();
            const metaStr = JSON.stringify(metaObj, null, 2);
            const metaBlob = new Blob([metaStr], { type: 'application/json' });
            const metaFilename = chosenMetaFilename || ((filename && filename.toLowerCase().endsWith('.png')) ? filename.replace(/\.png$/i, '.json') : (filename + '.json'));

            // Use File System Access API when available to save PNG and optionally metadata
            if (window.showSaveFilePicker){
                try{
                    // Save PNG
                    const handle = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'PNG Image', accept: { 'image/png': ['.png'] } }] });
                    const writable = await handle.createWritable();
                    await writable.write(blob);
                    await writable.close();
                    // Attempt to save metadata (user can cancel) only if requested
                    if (wantMeta) {
                        try {
                            const mhandle = await window.showSaveFilePicker({ suggestedName: metaFilename, types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }] });
                            const mw = await mhandle.createWritable();
                            await mw.write(metaBlob);
                            await mw.close();
                        } catch (e) {
                            // ignore metadata save errors/cancel
                        }
                    }
                    return;
                } catch (e) {
                    // fall through to anchor fallback
                    console.warn('showSaveFilePicker failed or canceled', e);
                }
            }

            // fallback: anchor download for PNG then metadata JSON
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(()=>{ URL.revokeObjectURL(url); try{ a.remove(); }catch(e){} }, 1500);

            // trigger metadata download as a second file if requested
            try{
                if (wantMeta) {
                    const murl = URL.createObjectURL(metaBlob);
                    const ma = document.createElement('a');
                    ma.href = murl;
                    ma.download = metaFilename;
                    document.body.appendChild(ma);
                    // small delay to ensure browser registers separate clicks in sequence
                    setTimeout(()=>{ ma.click(); setTimeout(()=>{ URL.revokeObjectURL(murl); try{ ma.remove(); }catch(e){} }, 1500); }, 250);
                }
            } catch (e) { /* ignore metadata fallback errors */ }
        } catch (e) { console.warn('export failed', e); }
    }

    // Create import/export UI: hidden file input and two buttons placed near top-right
    _createImportExportUI(){
        try{
            const uiCanvas = document.getElementById('UI');
            if (!uiCanvas || !uiCanvas.parentNode) return;
            // Button positions: ~300px left from right edge (1920 - 300 = 1620)
            const importPos = new Vector(1480, this._previewBuffer + 4);
            const btnSize = new Vector(140, 28);
            this._importBtn = createHButton('import-spritesheet-btn', importPos, btnSize, '#334455', { color: '#fff', borderRadius: '4px', fontSize: 14 }, uiCanvas.parentNode);
            this._importBtn.textContent = 'Import Spritesheet';

            const exportPos = new Vector(1480, this._previewBuffer + 4 + btnSize.y + 6);
            this._exportBtn = createHButton('export-spritesheet-btn', exportPos, btnSize, '#225522', { color: '#fff', borderRadius: '4px', fontSize: 14 }, uiCanvas.parentNode);
            this._exportBtn.textContent = 'Export Spritesheet';

            // Hidden file input for import
            const inputPos = new Vector(-3000, -3000);
            this._importInput = createHInput('import-spritesheet-input', inputPos, new Vector(10,10), 'file', {}, uiCanvas.parentNode);
            this._importInput.accept = 'image/*';
            this._importInput.style.display = 'none';

            this._importBtn.addEventListener('click', ()=>{ this._importInput.click(); });
            this._importInput.addEventListener('change', (ev)=>{ this._handleImportFile(ev); });
            this._exportBtn.addEventListener('click', ()=>{ this._handleExport(); });
        } catch (e) { console.warn('createImportExportUI failed', e); }
    }

    // Dispose UI-created DOM elements to allow GC when this component is destroyed
    dispose(){
        try {
            if (this._importBtn && this._importBtn.parentNode) { try { this._importBtn.remove(); } catch(e){} }
            if (this._exportBtn && this._exportBtn.parentNode) { try { this._exportBtn.remove(); } catch(e){} }
            if (this._importInput && this._importInput.parentNode) { try { this._importInput.remove(); } catch(e){} }
        } catch (e) { console.warn('FrameSelect.dispose failed', e); }
        this._importBtn = null; this._exportBtn = null; this._importInput = null;
    }

    update(delta) {
        this.menu.update(delta);
        // active group (id of last-clicked group slot)
        if (typeof this._activeGroup === 'undefined') this._activeGroup = null;
        if(this.mouse.pos.x <= 200){
            let scrollDelta = this.mouse.wheel()
            this.scrollPos -= scrollDelta
            if(this.scrollPos > 0) this.scrollPos = 0
        }
        // Advance preview animation timer
        try {
            const dt = (typeof delta === 'number' && delta > 0) ? delta : (1 / 60);
            const anim = (this.scene && this.scene.selectedAnimation) ? this.scene.selectedAnimation : null;
            const framesArr = (this.sprite && this.sprite._frames && anim) ? (this.sprite._frames.get(anim) || []) : [];
            // Build a logical frames sequence that collapses layered groups into single frames
            const groups = this._getFrameGroups(anim);
            for (const g of groups){ g.firstIndex = Math.min.apply(null, g.indices); }
            const framesSeq = [];
            for (let i = 0; i < framesArr.length; i++){
                const grp = groups.find(g => g.firstIndex === i);
                if (grp){
                    if (grp.layered) {
                        framesSeq.push({ type: 'group', group: grp });
                        // skip all indices in group
                        i = Math.max.apply(null, grp.indices);
                        continue;
                    }
                    // if not layered, we still want individual frames to appear
                }
                framesSeq.push({ type: 'frame', index: i });
            }
            // reset when animation changes
            if (anim !== this._animName) {
                this._animName = anim;
                this._animIndex = 0;
                this._animTimer = 0;
            }
            // if fps is 0 (paused), map the scene.selectedFrame into the logical sequence index
            try {
                if (this._animFps === 0) {
                    const selFrame = (this.scene && typeof this.scene.selectedFrame === 'number') ? this.scene.selectedFrame : null;
                    if (selFrame !== null && selFrame !== undefined) {
                        let found = -1;
                        for (let si = 0; si < framesSeq.length; si++){
                            const e = framesSeq[si];
                            if (e.type === 'frame' && e.index === selFrame) { found = si; break; }
                            if (e.type === 'group' && Array.isArray(e.group.indices) && e.group.indices.indexOf(selFrame) !== -1) { found = si; break; }
                        }
                        if (found !== -1) this._animIndex = found;
                    }
                }
            } catch (e) {}
            if (framesSeq.length > 0 && this._animFps > 0) {
                this._animTimer += dt;
                const frameTime = 1 / (this._animFps || 8);
                while (this._animTimer >= frameTime) {
                    this._animTimer -= frameTime;
                    this._animIndex = (this._animIndex + 1) % framesSeq.length;
                }
            } else {
                this._animIndex = 0;
                this._animTimer = 0;
            }
        } catch (e) {
            // ignore
        }

        // handle click selection: if left button was released over a frame slot (frames + groups)

        if (this.mouse.released('left') || this.mouse.pressed('right')) {
            const anim = (this.scene && this.scene.selectedAnimation) ? this.scene.selectedAnimation : null;
            const framesArr = (this.sprite && this.sprite._frames && anim) ? (this.sprite._frames.get(anim) || []) : [];
            // compute slots combining groups and frames
            const slots = [];
            const groups = this._getFrameGroups(anim);
            for (const g of groups){ g.firstIndex = Math.min.apply(null, g.indices); }
            for (let i = 0; i < framesArr.length; i++){
                const groupAtFirst = groups.find(g => g.firstIndex === i);
                if (groupAtFirst){
                    slots.push({ type: 'group', group: groupAtFirst, posIndex: i });
                    if (groupAtFirst.collapsed){
                        // skip to last index in group
                        i = Math.max.apply(null, groupAtFirst.indices);
                        continue;
                    }
                    // when expanded, still render the frame after the group slot
                }
                slots.push({ type: 'frame', index: i, posIndex: i });
            }
            // add slot for new frame at end
            slots.push({ type: 'add', posIndex: framesArr.length });

            for (let s = 0; s < slots.length; s++){
                const item = slots[s];
                const pos = new Vector(5, 100 + (180 + 20) * s + this.scrollPos);
                const size = new Vector(190, 190);
                if (Geometry.pointInRect(this.mouse.pos, pos, size)){
                    if (!anim) break;
                    if (item.type === 'frame'){
                        try {
                            const i = item.index;
                            if (this.keys.held('Shift')&& !this.mouse.held('right')) {
                                if (this._multiSelected.has(i)) this._multiSelected.delete(i);
                                else this._multiSelected.add(i);
                            } else {
                                if (this._multiSelected && this._multiSelected.size > 0 && !this.mouse.held('right')) this._multiSelected.clear();
                                if (this.scene) this.scene.selectedFrame = i;
                            }
                        } catch (e) { if (this.scene) this.scene.selectedFrame = item.index; }
                    } else if (item.type === 'group'){
                        // Entire group slot toggles collapse. Hold Shift while clicking to select all frames instead.
                        try {
                            if (this._multiSelected && this._multiSelected.size > 0) this._multiSelected.clear();
                            for (const idx of item.group.indices) this._multiSelected.add(idx);
                            // set active group
                            this._activeGroup = item.group.id;
                            this._toggleGroupCollapsed(anim, item.group.id);

                        } catch (e) { console.warn('Group click failed', e); }
                    } else if (item.type === 'add'){
                        if (typeof this.sprite.insertFrame === 'function') {
                            this.sprite.insertFrame(anim);
                            if (this.scene) this.scene.selectedFrame = framesArr.length;
                            if (this._multiSelected && this._multiSelected.size > 0) this._multiSelected.clear();
                        }
                    }
                    this.mouse.addMask(1); 
                    break;
                }
            }
        }

        // Handle merge key: press 'm' to merge multiple selected frames into one new frame (keep originals).
        // If there is an active pixel/region selection in the SpriteScene, treat it as a mask so only
        // pixels inside the selection are merged; pixels outside keep the base frame.
        try {
            if (this.keys.released('m')) {
                if (this._multiSelected.size >= 2) {
                    const anim = this.scene && this.scene.selectedAnimation;
                    if (!anim || !this.sprite || !this.sprite._frames || !this.sprite._frames.has(anim)) return;
                    const arr = this.sprite._frames.get(anim);
                    // compute indices in ascending order
                    const idxs = Array.from(this._multiSelected)
                        .filter(i => typeof i === 'number' && i >= 0 && i < arr.length)
                        .sort((a,b)=>a-b);
                    if (idxs.length < 2) return;
                    try {
                        const px = this.sprite.slicePx || 16;
                        const out = document.createElement('canvas'); out.width = px; out.height = px;
                        const ctx = out.getContext('2d');
                        ctx.clearRect(0,0,px,px);

                        // Build a pixel mask from the scene's selection (points or rectangular region).
                        let hasMask = false;
                        const mask = new Set(); // keys "x,y"
                        try {
                            const scene = this.scene;
                            if (scene) {
                                const selPts = Array.isArray(scene.selectionPoints) ? scene.selectionPoints : [];
                                const selReg = scene.selectionRegion;

                                if (selPts.length > 0) {
                                    for (const p of selPts) {
                                        if (!p) continue;
                                        const mx = Math.max(0, Math.min(px-1, p.x|0));
                                        const my = Math.max(0, Math.min(px-1, p.y|0));
                                        mask.add(mx + ',' + my);
                                    }
                                    if (mask.size > 0) hasMask = true;
                                } else if (selReg && selReg.start && selReg.end) {
                                    const minX = Math.max(0, Math.min(selReg.start.x, selReg.end.x));
                                    const minY = Math.max(0, Math.min(selReg.start.y, selReg.end.y));
                                    const maxX = Math.min(px-1, Math.max(selReg.start.x, selReg.end.x));
                                    const maxY = Math.min(px-1, Math.max(selReg.start.y, selReg.end.y));
                                    for (let y = minY; y <= maxY; y++) {
                                        for (let x = minX; x <= maxX; x++) {
                                            mask.add(x + ',' + y);
                                        }
                                    }
                                    if (mask.size > 0) hasMask = true;
                                }
                            }
                        } catch (e) { /* ignore selection mask errors */ }

                        // If no selection mask, fall back to original full-frame merge behaviour.
                        if (!hasMask) {
                            for (const idx of idxs) {
                                const src = this.sprite.getFrame(anim, idx);
                                if (src) ctx.drawImage(src, 0, 0);
                            }
                        } else {
                            // With a mask: start from the base frame (first selected), then for each
                            // additional frame copy only pixels OUTSIDE the mask into the output.
                            // Pixels inside the selection mask are "protected" and keep the base frame.
                            const baseIdx = idxs[0];
                            const base = this.sprite.getFrame(anim, baseIdx);
                            if (base) ctx.drawImage(base, 0, 0);

                            const dstImage = ctx.getImageData(0, 0, px, px);
                            const dstData = dstImage.data;

                            for (let k = 1; k < idxs.length; k++) {
                                const idx = idxs[k];
                                const src = this.sprite.getFrame(anim, idx);
                                if (!src) continue;
                                let sctx = null;
                                try { sctx = src.getContext('2d'); } catch (e) { sctx = null; }
                                if (!sctx) continue;
                                let srcImage;
                                try { srcImage = sctx.getImageData(0, 0, px, px); } catch (e) { srcImage = null; }
                                if (!srcImage) continue;
                                const srcData = srcImage.data;

                                // Apply masked copy: only pixels OUTSIDE the mask and non-transparent overwrite dst.
                                for (let y = 0; y < px; y++) {
                                    for (let x = 0; x < px; x++) {
                                        const key = x + ',' + y;
                                        if (mask.has(key)) continue; // skip selected pixels
                                        const off = (y * px + x) * 4;
                                        const a = srcData[off+3];
                                        if (a === 0) continue; // keep existing pixel when fully transparent
                                        dstData[off]   = srcData[off];
                                        dstData[off+1] = srcData[off+1];
                                        dstData[off+2] = srcData[off+2];
                                        dstData[off+3] = a;
                                    }
                                }
                            }

                            ctx.putImageData(dstImage, 0, 0);
                        }

                        // append merged frame via SpriteSheet API so multiplayer metadata stays in sync
                        let newLogicalIndex = null;
                        try {
                            if (typeof this.sprite.insertFrame === 'function') {
                                // insertFrame without index appends a new logical frame
                                this.sprite.insertFrame(anim);
                                // compute logical index of the last frame (newly appended)
                                const arrNow = (this.sprite._frames && this.sprite._frames.get(anim)) || [];
                                let logicalCount = 0;
                                for (let i = 0; i < arrNow.length; i++) {
                                    const e = arrNow[i];
                                    if (!e) continue;
                                    if (e.__groupStart || e.__groupEnd) continue;
                                    logicalCount++;
                                }
                                newLogicalIndex = Math.max(0, logicalCount - 1);
                            } else {
                                // fallback: push directly if insertFrame is unavailable
                                arr.push(out);
                                newLogicalIndex = Math.max(0, arr.length - 1);
                            }

                            // copy merged pixels into the new frame canvas using modifyFrame so
                            // multiplayer edit buffering picks up the changes.
                            try {
                                if (newLogicalIndex !== null) this._copyCanvasToFrame(anim, newLogicalIndex, out);
                            } catch (e) { console.warn('FrameSelect merge copy failed', e); }

                            if (typeof this.sprite._rebuildSheetCanvas === 'function') this.sprite._rebuildSheetCanvas();
                            if (this.scene && newLogicalIndex !== null) this.scene.selectedFrame = newLogicalIndex;
                            // clear multi selection after merge
                            if (this._multiSelected) this._multiSelected.clear();
                            try { if (this.mouse && typeof this.mouse.addMask === 'function') this.mouse.addMask(1); } catch (e) {}
                        } catch (e) { console.warn('FrameSelect merge append failed', e); }
                    } catch (e) { console.warn('FrameSelect merge failed', e); }
                }
            }
        } catch (e) { console.warn('FrameSelect merge key handling failed', e); }
        // handle grouping: press 'g' to group selected frames or ungroup when matching a group
        try {
            if (this.keys && typeof this.keys.released === 'function' && this.keys.released('g')) {
                const anim = (this.scene && this.scene.selectedAnimation) ? this.scene.selectedAnimation : null;
                if (!anim || !this.sprite || !this.sprite._frames || !this.sprite._frames.has(anim)) return;
                const groups = this._getFrameGroups(anim);
                const sel = Array.from(this._multiSelected).filter(i=>typeof i === 'number').map(Number).sort((a,b)=>a-b);
                if (sel.length === 0) return;
                // check if selection exactly matches an existing group -> ungroup
                const matching = groups.find(g => {
                    if (!g || !Array.isArray(g.indices)) return false;
                    if (g.indices.length !== sel.length) return false;
                    for (let i = 0; i < sel.length; i++) if (g.indices[i] !== sel[i]) return false;
                    return true;
                });
                if (matching) {
                    this._removeFrameGroup(anim, matching.id);
                    // clear selection
                    if (this._multiSelected) this._multiSelected.clear();
                    return;
                }
                // otherwise create a group if >=2
                if (sel.length >= 2) {
                    const created = this._addFrameGroup(anim, sel);
                    if (!created) {
                        console.warn('Could not create group; indices may overlap existing groups');
                    } else {
                        if (this._multiSelected) this._multiSelected.clear();
                        for (const idx of created.indices) this._multiSelected.add(idx);
                        // mark active group to allow 'l' toggling
                        this._activeGroup = created.id;
                    }
                }
            }
        } catch (e) { console.warn('FrameSelect group handling failed', e); }
        // toggle layered rendering for active group (press 'l')
        try {
            if (this.keys && typeof this.keys.released === 'function' && this.keys.released('l')){
                const anim = (this.scene && this.scene.selectedAnimation) ? this.scene.selectedAnimation : null;
                if (!anim || !this.sprite) return;
                const groups = this._getFrameGroups(anim);
                const g = groups.find(x=>x.id === this._activeGroup);
                if (!g) return;
                g.layered = !g.layered;
                // write back
                if (!this.sprite._frameGroups) this.sprite._frameGroups = new Map();
                this.sprite._frameGroups.set(anim, groups);
            }
        } catch (e) { console.warn('FrameSelect layered toggle failed', e); }
        // handle backspace: remove selected frame when hovering over the menu
        try {
            if (this.keys.released('Backspace')) {
                // only if mouse is over our menu area
                if (Geometry.pointInRect(this.mouse.pos, this.menu.pos, this.menu.size)) {
                    const anim = this.scene.selectedAnimation;
                    const sel = this.scene.selectedFrame;
                    const arr = (this.sprite && this.sprite._frames && anim) ? (this.sprite._frames.get(anim) || []) : [];
                    if (anim && sel !== null && arr.length > 0 && sel >= 0 && sel < arr.length) {
                        this.sprite.popFrame(anim, sel);
                        // clamp selectedFrame to new range
                        const newLen = (this.sprite._frames.get(anim) || []).length;
                        if (newLen === 0) this.scene.selectedFrame = 0;
                        else this.scene.selectedFrame = Math.max(0, Math.min(sel, newLen - 1));
                        // mask input so other UI doesn't receive the same key/mouse (use addMask for click context)
                        this.mouse.addMask(1);
                    }
                }
            }
        } catch (e) {
            console.warn('FrameSelect delete handling failed', e);
        }

        // Duplicate selected frame with '/', and move frames with ArrowUp/ArrowDown
        try {
            if (this.keys && this.keys.released) {
                const anim = (this.scene && this.scene.selectedAnimation) ? this.scene.selectedAnimation : null;
                const sel = (this.scene && typeof this.scene.selectedFrame === 'number') ? this.scene.selectedFrame : null;
                const arr = (this.sprite && this.sprite._frames && anim) ? (this.sprite._frames.get(anim) || []) : [];

                // Duplicate (press '/') -> duplicate all multi-selected frames, or duplicate single selected frame
                if (this.keys.released('/') || this.keys.released('|')) {
                    try {
                        const anim = (this.scene && this.scene.selectedAnimation) ? this.scene.selectedAnimation : null;
                        if (!anim || !this.sprite || !this.sprite._frames || !this.sprite._frames.has(anim)) { /* nothing */ }
                        else {
                            const arr = this.sprite._frames.get(anim);
                            // gather multi-selection indices (valid)
                            const selIdxs = Array.from(this._multiSelected || []).filter(i=>typeof i === 'number' && i>=0 && i < arr.length).map(Number).sort((a,b)=>a-b);
                            if (selIdxs.length >= 1) {
                                // duplicate all selected frames in order, appending new frames at the END so
                                // that structural changes play nicely with multiplayer metadata.
                                const newLogicalIndices = [];
                                for (const idx of selIdxs) {
                                    try {
                                        const src = (typeof this.sprite.getFrame === 'function') ? this.sprite.getFrame(anim, idx) : null;
                                        if (!src) continue;
                                        if (typeof this.sprite.insertFrame === 'function') {
                                            this.sprite.insertFrame(anim); // append new blank frame
                                            // compute logical index of new last frame
                                            const arrNow = (this.sprite._frames && this.sprite._frames.get(anim)) || [];
                                            let logicalCount = 0;
                                            for (let i = 0; i < arrNow.length; i++) {
                                                const e = arrNow[i];
                                                if (!e) continue;
                                                if (e.__groupStart || e.__groupEnd) continue;
                                                logicalCount++;
                                            }
                                            const newLogical = Math.max(0, logicalCount - 1);
                                            try {
                                                const dest = (typeof this.sprite.getFrame === 'function')
                                                    ? this.sprite.getFrame(anim, newLogical)
                                                    : null;
                                                if (dest && dest.getContext) {
                                                    // Prefer modifyFrame-based copy so edits are synced.
                                                    this._copyCanvasToFrame(anim, newLogical, src);
                                                }
                                            } catch (e) { console.warn('FrameSelect duplicate copy failed', e); }
                                            newLogicalIndices.push(newLogical);
                                        } else {
                                            // fallback: no insertFrame, just clone and push
                                            const clone = document.createElement('canvas');
                                            clone.width = this.sprite.slicePx || src.width || 16;
                                            clone.height = this.sprite.slicePx || src.height || 16;
                                            const ctx = clone.getContext('2d');
                                            ctx.drawImage(src, 0, 0);
                                            arr.push(clone);
                                            newLogicalIndices.push(Math.max(0, arr.length - 1));
                                        }
                                    } catch (e) { console.warn('FrameSelect duplicate per-frame failed', e); }
                                }
                                // if selection exactly matches a group, duplicate the group metadata as well
                                try {
                                    const groups = this._getFrameGroups(anim);
                                    const matching = groups.find(g => Array.isArray(g.indices) && g.indices.length === selIdxs.length && g.indices.every((v,i)=>v === selIdxs[i]));
                                    if (matching && newLogicalIndices.length === selIdxs.length) {
                                        const newGroup = { id: 'g' + (Date.now().toString(36) + Math.random().toString(36).slice(2,6)), indices: newLogicalIndices.slice(), collapsed: matching.collapsed, layered: matching.layered };
                                        groups.push(newGroup);
                                        if (!this.sprite._frameGroups) this.sprite._frameGroups = new Map();
                                        this.sprite._frameGroups.set(anim, groups);
                                        // update active group to the new group
                                        this._activeGroup = newGroup.id;
                                    }
                                } catch (e) { console.warn('FrameSelect duplicate group metadata failed', e); }
                                if (typeof this.sprite._rebuildSheetCanvas === 'function') this.sprite._rebuildSheetCanvas();
                                // select newly appended frames
                                if (this._multiSelected) this._multiSelected.clear();
                                for (const ni of newLogicalIndices) this._multiSelected.add(ni);
                                if (this.scene && newLogicalIndices.length > 0) this.scene.selectedFrame = newLogicalIndices[0];
                                try { if (this.mouse && typeof this.mouse.addMask === 'function') this.mouse.addMask(1); } catch(e){}
                            } else {
                                // fallback: duplicate single selected frame (existing behavior)
                                const sel = (this.scene && typeof this.scene.selectedFrame === 'number') ? this.scene.selectedFrame : null;
                                if (sel !== null && sel !== undefined && sel >= 0 && sel < arr.length) {
                                    try {
                                        const src = this.sprite.getFrame(anim, sel);
                                        if (src && typeof this.sprite.insertFrame === 'function') {
                                            this.sprite.insertFrame(anim); // append new blank frame
                                            // compute logical index of new last frame
                                            const arrNow = (this.sprite._frames && this.sprite._frames.get(anim)) || [];
                                            let logicalCount = 0;
                                            for (let i = 0; i < arrNow.length; i++) {
                                                const e = arrNow[i];
                                                if (!e) continue;
                                                if (e.__groupStart || e.__groupEnd) continue;
                                                logicalCount++;
                                            }
                                            const newLogical = Math.max(0, logicalCount - 1);
                                            try {
                                                const dest = (typeof this.sprite.getFrame === 'function')
                                                    ? this.sprite.getFrame(anim, newLogical)
                                                    : null;
                                                if (dest && dest.getContext) {
                                                    // Prefer modifyFrame-based copy so edits are synced.
                                                    this._copyCanvasToFrame(anim, newLogical, src);
                                                }
                                            } catch (e) { console.warn('FrameSelect single duplicate copy failed', e); }
                                            if (typeof this.sprite._rebuildSheetCanvas === 'function') this.sprite._rebuildSheetCanvas();
                                            if (this.scene) this.scene.selectedFrame = newLogical;
                                        } else if (src) {
                                            const clone = document.createElement('canvas');
                                            clone.width = this.sprite.slicePx || (src ? src.width : 16);
                                            clone.height = this.sprite.slicePx || (src ? src.height : 16);
                                            const ctx = clone.getContext('2d');
                                            ctx.drawImage(src, 0, 0);
                                            arr.splice(sel + 1, 0, clone);
                                            if (typeof this.sprite._rebuildSheetCanvas === 'function') this.sprite._rebuildSheetCanvas();
                                            if (this.scene) this.scene.selectedFrame = sel + 1;
                                        }
                                        try { if (this.mouse && typeof this.mouse.addMask === 'function') this.mouse.addMask(1); } catch(e){}
                                    } catch (e) { console.warn('FrameSelect duplicate failed', e); }
                                }
                            }
                        }
                    } catch (e) { console.warn('FrameSelect duplicate block failed', e); }
                }

                // Move frame earlier (ArrowUp)
                if (this.keys.released('ArrowUp')) {
                    try {
                        if (!anim || !arr) { /* nothing */ }
                        else {
                            const groups = this._getFrameGroups(anim);
                            const selIdxs = Array.from(this._multiSelected || []).filter(i=>typeof i === 'number' && i>=0 && i < arr.length).map(Number).sort((a,b)=>a-b);
                            if (selIdxs.length === 0) {
                                // single selected frame fallback
                                if (sel !== null && sel !== undefined && sel > 0 && sel < arr.length) {
                                    const prev = arr[sel - 1];
                                    const cur = arr[sel];
                                    arr[sel - 1] = cur;
                                    arr[sel] = prev;
                                    if (typeof this.sprite._rebuildSheetCanvas === 'function') this.sprite._rebuildSheetCanvas();
                                    if (this.scene) this.scene.selectedFrame = sel - 1;
                                    try { if (this.mouse && typeof this.mouse.addMask === 'function') this.mouse.addMask(1); } catch(e){}
                                }
                            } else {
                                // try match a group exactly
                                const matching = groups.find(g => Array.isArray(g.indices) && g.indices.length === selIdxs.length && g.indices.every((v,i)=>v === selIdxs[i]));
                                if (matching) {
                                    const first = Math.min.apply(null, matching.indices);
                                    const len = matching.indices.length;
                                    if (first > 0) {
                                        // capture element references for every group so we can recompute numeric indices after reorder
                                        const groupElems = groups.map(g => ({ g: g, elems: g.indices.map(i => arr[i]) }));
                                        // choose a safe insert point: move above previous group's start if present
                                        const prevGroups = groups.filter(g => Math.max.apply(null, g.indices) < first).sort((a,b)=>Math.max.apply(null,b.indices) - Math.max.apply(null,a.indices));
                                        const block = arr.splice(first, len);
                                        if (prevGroups.length > 0) {
                                            const prev = prevGroups[0];
                                            // anchor on prev group's first element via captured refs
                                            const prevGe = groupElems.find(x => x.g === prev);
                                            const anchorElem = (prevGe && prevGe.elems && prevGe.elems.length) ? prevGe.elems[0] : null;
                                            const idx = (anchorElem !== null) ? arr.indexOf(anchorElem) : Math.max(0, first - 1);
                                            const insertPos = (idx === -1) ? 0 : Math.max(0, idx);
                                            arr.splice(insertPos, 0, ...block);
                                        } else {
                                            // no previous group, move up by one
                                            arr.splice(first - 1, 0, ...block);
                                        }
                                        // recompute indices for all groups from element references
                                        for (const ge of groupElems) {
                                            try { ge.g.indices = ge.elems.map(e => arr.indexOf(e)).filter(i => i !== -1).sort((a,b)=>a-b); } catch(e){}
                                        }
                                        if (!this.sprite._frameGroups) this.sprite._frameGroups = new Map();
                                        this.sprite._frameGroups.set(anim, groups);
                                        // update selection to moved group's new indices
                                        const newIndices = matching.indices.slice(0);
                                        if (this._multiSelected) this._multiSelected.clear();
                                        for (const ni of newIndices) this._multiSelected.add(ni);
                                        if (this.scene) this.scene.selectedFrame = newIndices[0];
                                        if (typeof this.sprite._rebuildSheetCanvas === 'function') this.sprite._rebuildSheetCanvas();
                                        try { if (this.mouse && typeof this.mouse.addMask === 'function') this.mouse.addMask(1); } catch(e){}
                                    }
                                } else {
                                    // handle contiguous blocks within selection (ascending order)
                                    const blocks = [];
                                    let start = selIdxs[0];
                                    let prev = selIdxs[0];
                                    for (let i = 1; i < selIdxs.length; i++){
                                        if (selIdxs[i] === prev + 1) {
                                            prev = selIdxs[i];
                                            continue;
                                        }
                                        blocks.push([start, prev]);
                                        start = selIdxs[i];
                                        prev = selIdxs[i];
                                    }
                                    blocks.push([start, prev]);
                                    // store original canvases to re-select later
                                    const originals = selIdxs.map(i=>arr[i]);
                                    // capture group elements so we can recompute indices after multiple moves
                                    const groupElems = groups.map(g => ({ g: g, elems: g.indices.map(i => arr[i]) }));
                                    for (const b of blocks) {
                                        const bStart = b[0];
                                        const bEnd = b[1];
                                        const bLen = bEnd - bStart + 1;
                                        if (bStart > 0 && selIdxs.indexOf(bStart - 1) === -1) {
                                            const block = arr.splice(bStart, bLen);
                                            arr.splice(bStart - 1, 0, ...block);
                                        }
                                    }
                                    if (typeof this.sprite._rebuildSheetCanvas === 'function') this.sprite._rebuildSheetCanvas();
                                    // recompute all group indices from element refs
                                    for (const ge of groupElems) {
                                        try { ge.g.indices = ge.elems.map(e => arr.indexOf(e)).filter(i => i !== -1).sort((a,b)=>a-b); } catch(e){}
                                    }
                                    if (!this.sprite._frameGroups) this.sprite._frameGroups = new Map();
                                    this.sprite._frameGroups.set(anim, groups);
                                    // recompute selection indices
                                    if (this._multiSelected) this._multiSelected.clear();
                                    for (const orig of originals) {
                                        const ni = arr.indexOf(orig);
                                        if (ni !== -1) this._multiSelected.add(ni);
                                    }
                                    if (this.scene) this.scene.selectedFrame = Math.min(...Array.from(this._multiSelected));
                                    try { if (this.mouse && typeof this.mouse.addMask === 'function') this.mouse.addMask(1); } catch(e){}
                                }
                            }
                        }
                    } catch (e) { console.warn('FrameSelect move up failed', e); }
                }

                // Move frame later (ArrowDown)
                if (this.keys.released('ArrowDown')) {
                    try {
                        if (!anim || !arr) { /* nothing */ }
                        else {
                            const groups = this._getFrameGroups(anim);
                            const selIdxs = Array.from(this._multiSelected || []).filter(i=>typeof i === 'number' && i>=0 && i < arr.length).map(Number).sort((a,b)=>a-b);
                            if (selIdxs.length === 0) {
                                // single selected frame fallback
                                if (sel !== null && sel !== undefined && sel >= 0 && sel < arr.length - 1) {
                                    const next = arr[sel + 1];
                                    const cur = arr[sel];
                                    arr[sel + 1] = cur;
                                    arr[sel] = next;
                                    if (typeof this.sprite._rebuildSheetCanvas === 'function') this.sprite._rebuildSheetCanvas();
                                    if (this.scene) this.scene.selectedFrame = sel + 1;
                                    try { if (this.mouse && typeof this.mouse.addMask === 'function') this.mouse.addMask(1); } catch(e){}
                                }
                            } else {
                                // try match group exactly
                                const matching = groups.find(g => Array.isArray(g.indices) && g.indices.length === selIdxs.length && g.indices.every((v,i)=>v === selIdxs[i]));
                                if (matching) {
                                    const first = Math.min.apply(null, matching.indices);
                                    const len = matching.indices.length;
                                    const last = first + len - 1;
                                    if (last < arr.length - 1) {
                                        // capture element references for groups so we can recompute indices after reorder
                                        const groupElems = groups.map(g => ({ g: g, elems: g.indices.map(i => arr[i]) }));
                                        // prefer to insert after the next group's end if present
                                        const nextGroups = groups.filter(g => Math.min.apply(null, g.indices) > last).sort((a,b)=>Math.min.apply(null,a.indices) - Math.min.apply(null,b.indices));
                                        const block = arr.splice(first, len);
                                        if (nextGroups.length > 0) {
                                            const next = nextGroups[0];
                                            // anchor on next group's last element via captured refs
                                            const nextGe = groupElems.find(x => x.g === next);
                                            const anchorElem = (nextGe && nextGe.elems && nextGe.elems.length) ? nextGe.elems[nextGe.elems.length - 1] : null;
                                            const idx = (anchorElem !== null) ? arr.indexOf(anchorElem) : Math.min(arr.length, first + 1);
                                            const insertPos = (idx === -1) ? arr.length : Math.min(arr.length, idx + 1);
                                            arr.splice(insertPos, 0, ...block);
                                        } else {
                                            // default: insert after original end
                                            arr.splice(first + 1, 0, ...block);
                                        }
                                        // recompute all group indices
                                        for (const ge of groupElems) {
                                            try { ge.g.indices = ge.elems.map(e => arr.indexOf(e)).filter(i => i !== -1).sort((a,b)=>a-b); } catch(e){}
                                        }
                                        if (!this.sprite._frameGroups) this.sprite._frameGroups = new Map();
                                        this.sprite._frameGroups.set(anim, groups);
                                        if (this._multiSelected) this._multiSelected.clear();
                                        // select moved group's new indices
                                        const newIndices = matching.indices.slice(0);
                                        for (const ni of newIndices) this._multiSelected.add(ni);
                                        if (this.scene) this.scene.selectedFrame = newIndices[0];
                                        if (typeof this.sprite._rebuildSheetCanvas === 'function') this.sprite._rebuildSheetCanvas();
                                        try { if (this.mouse && typeof this.mouse.addMask === 'function') this.mouse.addMask(1); } catch(e){}
                                    }
                                } else {
                                    // move contiguous blocks down; process blocks in reverse order
                                    const blocks = [];
                                    let start = selIdxs[0];
                                    let prev = selIdxs[0];
                                    for (let i = 1; i < selIdxs.length; i++){
                                        if (selIdxs[i] === prev + 1) { prev = selIdxs[i]; continue; }
                                        blocks.push([start, prev]);
                                        start = selIdxs[i]; prev = selIdxs[i];
                                    }
                                    blocks.push([start, prev]);
                                    const originals = selIdxs.map(i=>arr[i]);
                                    // capture group element refs prior to reordering
                                    const groupElems = groups.map(g => ({ g: g, elems: g.indices.map(i => arr[i]) }));
                                    for (let bi = blocks.length - 1; bi >= 0; bi--) {
                                        const b = blocks[bi];
                                        const bStart = b[0];
                                        const bEnd = b[1];
                                        const bLen = bEnd - bStart + 1;
                                        if (bEnd < arr.length - 1 && selIdxs.indexOf(bEnd + 1) === -1) {
                                            const block = arr.splice(bStart, bLen);
                                            arr.splice(bStart + 1, 0, ...block);
                                        }
                                    }
                                    if (typeof this.sprite._rebuildSheetCanvas === 'function') this.sprite._rebuildSheetCanvas();
                                    // recompute all group indices from element refs
                                    for (const ge of groupElems) {
                                        try { ge.g.indices = ge.elems.map(e => arr.indexOf(e)).filter(i => i !== -1).sort((a,b)=>a-b); } catch(e){}
                                    }
                                    if (!this.sprite._frameGroups) this.sprite._frameGroups = new Map();
                                    this.sprite._frameGroups.set(anim, groups);
                                    if (this._multiSelected) this._multiSelected.clear();
                                    for (const orig of selOriginals) {
                                        const ni = arr.indexOf(orig);
                                        if (ni !== -1) this._multiSelected.add(ni);
                                    }
                                    if (this.scene) this.scene.selectedFrame = Math.min(...Array.from(this._multiSelected));
                                    try { if (this.mouse && typeof this.mouse.addMask === 'function') this.mouse.addMask(1); } catch(e){}
                                }
                            }
                        }
                    } catch (e) { console.warn('FrameSelect move down failed', e); }
                }
            }
        } catch (e) {
            console.warn('FrameSelect key handlers failed', e);
        }

        
        // update text input if open
        try{
            if (this._textInput && typeof this._textInput.update === 'function') this._textInput.update(delta);
        } catch(e){}

        // animation list interactions (click/select/rename/remove/add)
        try{
            // compute list position same as draw
            const outerPos = new Vector(1920-this._previewBuffer*3-this._previewSize, this._previewBuffer);
            const contentPos = outerPos.clone().add(new Vector(this._previewBuffer, this._previewBuffer));
            const contentSize = new Vector(this._previewSize, this._previewSize);
            const listX = contentPos.x;
            const listY = contentPos.y + contentSize.y + 8 + 50; // same 50px drop as draw
            const rowH = 28;
            const names = this._getAnimationNames();
            if (this.mouse && this.mouse.released && this.mouse.released('left')){
                // iterate rows
                for (let i = 0; i < names.length; i++){
                    const name = names[i];
                    const ry = listY + i * rowH;
                    const rpos = new Vector(listX, ry);
                    const rsize = new Vector(contentSize.x, rowH - 2);
                    if (Geometry.pointInRect(this.mouse.pos, rpos, rsize)){
                        // determine button hit areas (right side)
                        const renameRect = new Vector(rpos.x + rsize.x - 80, rpos.y + 4);
                        const renameSize = new Vector(36, rsize.y - 8);
                        const removeRect = new Vector(rpos.x + rsize.x - 40, rpos.y + 4);
                        const removeSize = new Vector(36, rsize.y - 8);
                        if (Geometry.pointInRect(this.mouse.pos, renameRect, renameSize)){
                            this._spawnTextInputFor(name);
                        } else if (Geometry.pointInRect(this.mouse.pos, removeRect, removeSize)){
                            this.removeAnimation(name);
                        } else {
                            // select animation
                            if (this.scene) this.scene.selectedAnimation = name;
                            // clear any multi-frame selection when switching animations
                            if (this._multiSelected && this._multiSelected.size > 0) this._multiSelected.clear();
                            // materialize frames for the selected animation (lazy-load)
                            try { if (this.sprite && typeof this.sprite._materializeAnimation === 'function') this.sprite._materializeAnimation(name); } catch(e) {}
                        }
                        try { if (this.mouse && typeof this.mouse.addMask === 'function') this.mouse.addMask(1); } catch (e) {}
                        break;
                    }
                }
                // add button below
                const addY = listY + names.length * rowH + 6;
                const addPos = new Vector(listX, addY);
                const addSize = new Vector(contentSize.x, 28);
                if (Geometry.pointInRect(this.mouse.pos, addPos, addSize)){
                    this.addAnimation();
                    try { if (this.mouse && typeof this.mouse.addMask === 'function') this.mouse.addMask(1); } catch (e) {}
                }
            }
        } catch(e){}
    } 

    draw() {
        // draw preview animation in top-left
        try {
            const outerPos = new Vector(1920-this._previewBuffer*3-this._previewSize, this._previewBuffer);
            const outerSize = new Vector(this._previewSize + this._previewBuffer * 2, this._previewSize + this._previewBuffer * 2);
            // background container
            this.UIDraw.rect(outerPos, outerSize, '#111111CC');
            const contentPos = outerPos.clone().add(new Vector(this._previewBuffer, this._previewBuffer));
            const contentSize = new Vector(this._previewSize, this._previewSize);
            // draw current frame if available (or merged preview when multi-selected)
            const anim = (this.scene && this.scene.selectedAnimation) ? this.scene.selectedAnimation : null;
            const framesArr = (this.sprite && this.sprite._frames && anim) ? (this.sprite._frames.get(anim) || []) : [];
            if (framesArr.length > 0 && anim) {
                // If multiple frames are selected, show a merged preview (composited)
                const idxs = Array.from(this._multiSelected).filter(i => typeof i === 'number' && i >= 0 && i < framesArr.length).sort((a,b)=>a-b);
                if (idxs.length >= 1) {
                    try {
                        const px = (this.sprite && this.sprite.slicePx) ? this.sprite.slicePx : 16;
                        const tmp = document.createElement('canvas'); tmp.width = px; tmp.height = px;
                        const tctx = tmp.getContext('2d'); tctx.clearRect(0,0,px,px);
                        for (const idx of idxs) {
                            try {
                                const src = (typeof this.sprite.getFrame === 'function') ? this.sprite.getFrame(anim, idx) : null;
                                if (src) tctx.drawImage(src, 0, 0);
                            } catch (e) { /* ignore per-frame draw error */ }
                        }
                        this.UIDraw.image(tmp, contentPos, contentSize, null, 0, 1, false);
                        // small label indicating merged preview
                        this.UIDraw.text('Merged Preview', new Vector(contentPos.x + 8, contentPos.y + 18), '#FFFFFF', 0, 12, { align: 'left', font: 'monospace' });
                    } catch (e) {
                        // fallback to sequence-based draw on error
                        // fallthrough to sequence draw below
                    }
                } else {
                    // build frames sequence like update() to honor layered groups
                    const groups = this._getFrameGroups(anim);
                    for (const g of groups){ g.firstIndex = Math.min.apply(null, g.indices); }
                    const framesSeq = [];
                    for (let i = 0; i < framesArr.length; i++){
                        const grp = groups.find(g => g.firstIndex === i);
                        if (grp){
                            if (grp.layered) {
                                framesSeq.push({ type: 'group', group: grp });
                                i = Math.max.apply(null, grp.indices);
                                continue;
                            }
                        }
                        framesSeq.push({ type: 'frame', index: i });
                    }
                    const seqLen = framesSeq.length;
                    if (seqLen === 0) {
                        this.UIDraw.rect(contentPos, contentSize, '#00000000', false, true, 2, '#444444AA');
                    } else {
                        // When preview is paused (0 fps) and nothing is multi-selected,
                        // prefer showing the explicitly selected frame from the scene.
                        if (this._animFps === 0 && (!this._multiSelected || this._multiSelected.size === 0) && typeof this.scene !== 'undefined' && typeof this.scene.selectedFrame === 'number') {
                            try {
                                const sel = this.scene.selectedFrame;
                                // If selected frame belongs to a layered group, draw the composited group instead
                                const groupForSel = groups.find(g => Array.isArray(g.indices) && g.indices.indexOf(sel) !== -1 && g.layered);
                                if (groupForSel) {
                                    try {
                                        const px = (this.sprite && this.sprite.slicePx) ? this.sprite.slicePx : 16;
                                        const tmp = document.createElement('canvas'); tmp.width = px; tmp.height = px;
                                        const tctx = tmp.getContext('2d'); tctx.clearRect(0,0,px,px);
                                        for (const idx of (groupForSel.indices || [])) {
                                            try {
                                                const src = (typeof this.sprite.getFrame === 'function') ? this.sprite.getFrame(anim, idx) : null;
                                                if (src) tctx.drawImage(src, 0, 0);
                                            } catch (e) {}
                                        }
                                        this.UIDraw.image(tmp, contentPos, contentSize, null, 0, 1, false);
                                    } catch (e) {
                                        // fallback to drawing the selected frame
                                        this.UIDraw.sheet(this.sprite, contentPos, contentSize, anim, sel);
                                    }
                                } else {
                                    // simple case: draw the selected frame directly
                                    this.UIDraw.sheet(this.sprite, contentPos, contentSize, anim, sel);
                                }
                            } catch (e) {
                                // if anything goes wrong, fall back to the normal sequence logic below
                                const seqIndex = Math.max(0, Math.min(this._animIndex, seqLen - 1));
                                const entry = framesSeq[seqIndex];
                                if (entry.type === 'frame') {
                                    this.UIDraw.sheet(this.sprite, contentPos, contentSize, anim, entry.index);
                                } else if (entry.type === 'group') {
                                    try {
                                        const px = (this.sprite && this.sprite.slicePx) ? this.sprite.slicePx : 16;
                                        const tmp = document.createElement('canvas'); tmp.width = px; tmp.height = px;
                                        const tctx = tmp.getContext('2d'); tctx.clearRect(0,0,px,px);
                                        for (const idx of entry.group.indices) {
                                            try {
                                                const src = (typeof this.sprite.getFrame === 'function') ? this.sprite.getFrame(anim, idx) : null;
                                                if (src) tctx.drawImage(src, 0, 0);
                                            } catch (e) {}
                                        }
                                        this.UIDraw.image(tmp, contentPos, contentSize, null, 0, 1, false);
                                    } catch (e) {
                                        const fi = Math.max(0, Math.min(entry.group.indices[0] || 0, framesArr.length - 1));
                                        this.UIDraw.sheet(this.sprite, contentPos, contentSize, anim, fi);
                                    }
                                }
                            }
                        } else {
                            const seqIndex = Math.max(0, Math.min(this._animIndex, seqLen - 1));
                            const entry = framesSeq[seqIndex];
                            if (entry.type === 'frame') {
                                this.UIDraw.sheet(this.sprite, contentPos, contentSize, anim, entry.index);
                            } else if (entry.type === 'group') {
                                // draw composited layered preview
                                try {
                                    const px = (this.sprite && this.sprite.slicePx) ? this.sprite.slicePx : 16;
                                    const tmp = document.createElement('canvas'); tmp.width = px; tmp.height = px;
                                    const tctx = tmp.getContext('2d'); tctx.clearRect(0,0,px,px);
                                    for (const idx of entry.group.indices) {
                                        try {
                                            const src = (typeof this.sprite.getFrame === 'function') ? this.sprite.getFrame(anim, idx) : null;
                                            if (src) tctx.drawImage(src, 0, 0);
                                        } catch (e) {}
                                    }
                                    this.UIDraw.image(tmp, contentPos, contentSize, null, 0, 1, false);
                                } catch (e) {
                                    // fallback to first frame
                                    const fi = Math.max(0, Math.min(entry.group.indices[0] || 0, framesArr.length - 1));
                                    this.UIDraw.sheet(this.sprite, contentPos, contentSize, anim, fi);
                                }
                            }
                        }
                    }
                }
            } else {
                // empty area (checker or placeholder)
                this.UIDraw.rect(contentPos, contentSize, '#00000000', false, true, 2, '#444444AA');
            }
        } catch (e) {
            // ignore preview draw errors
        }

        // draw the menu and its children
        this.menu.draw(this.UIDraw);
        // draw animation list under preview
        try{
            const outerPos = new Vector(1920-this._previewBuffer*3-this._previewSize, this._previewBuffer);
            const contentPos = outerPos.clone().add(new Vector(this._previewBuffer, this._previewBuffer));
            const contentSize = new Vector(this._previewSize, this._previewSize);
            const listX = contentPos.x;
            const listY = contentPos.y + contentSize.y + 8 + 50; // shifted down 50px
            const rowH = 28;
            const names = this._getAnimationNames();
            for (let i = 0; i < names.length; i++){
                const name = names[i];
                const ry = listY + i * rowH;
                const rpos = new Vector(listX, ry);
                const rsize = new Vector(contentSize.x, rowH - 2);
                // background
                const isSel = (this.scene && this.scene.selectedAnimation === name);
                this.UIDraw.rect(rpos, rsize, isSel ? '#333344' : '#222222');
                // name text
                this.UIDraw.text(String(name), new Vector(rpos.x + 8, rpos.y + rsize.y/2 + 6), '#FFFFFF', 0, 14, { align: 'left', baseline: 'middle', font: 'monospace' });
                // rename button
                const renamePos = new Vector(rpos.x + rsize.x - 80, rpos.y + 4);
                const renameSize = new Vector(36, rsize.y - 8);
                const removePos = new Vector(rpos.x + rsize.x - 40, rpos.y + 4);
                const removeSize = new Vector(36, rsize.y - 8);
                const disabled = false;
                this.UIDraw.rect(renamePos, renameSize, disabled ? '#444444' : '#666666');
                this.UIDraw.text('R', new Vector(renamePos.x + renameSize.x/2, renamePos.y + renameSize.y/2 + 6), '#FFFFFF', 0, 12, { align: 'center', font: 'monospace' });
                this.UIDraw.rect(removePos, removeSize, disabled ? '#444444' : '#AA4444');
                this.UIDraw.text('X', new Vector(removePos.x + removeSize.x/2, removePos.y + removeSize.y/2 + 6), '#FFFFFF', 0, 12, { align: 'center', font: 'monospace' });
            }
            // add button
            const addY = listY + names.length * rowH + 6;
            const addPos = new Vector(listX, addY);
            const addSize = new Vector(contentSize.x, 28);
            this.UIDraw.rect(addPos, addSize, '#225522');
            this.UIDraw.text('Add Animation', new Vector(addPos.x + addSize.x/2, addPos.y + addSize.y/2 + 6), '#FFFFFF', 0, 14, { align: 'center', font: 'monospace' });
        } catch(e){}

        // draw inline text input if active
        try{
            if (this._textInput && typeof this._textInput.draw === 'function') this._textInput.draw(this.UIDraw);
        } catch(e){}
        // determine which animation to show (use scene selection as source of truth)
        const anim = (this.scene && this.scene.selectedAnimation) ? this.scene.selectedAnimation : null;
        const framesArr = (this.sprite && this.sprite._frames && anim) ? (this.sprite._frames.get(anim) || []) : [];
        // build slots including groups
        try {
            const groups = this._getFrameGroups(anim);
            for (const g of groups){ g.firstIndex = Math.min.apply(null, g.indices); }
            const slots = [];
            for (let i = 0; i < framesArr.length; i++){
                const groupAtFirst = groups.find(g => g.firstIndex === i);
                if (groupAtFirst){
                    slots.push({ type: 'group', group: groupAtFirst });
                    if (groupAtFirst.collapsed){
                        i = Math.max.apply(null, groupAtFirst.indices);
                        continue;
                    }
                }
                slots.push({ type: 'frame', index: i });
            }
            // add slot for new frame
            slots.push({ type: 'add' });

            for (let s = 0; s < slots.length; s++){
                const item = slots[s];
                const slotPos = new Vector(5,100 + (180+20) * s + this.scrollPos);
                const slotSize = new Vector(190,190);
                this.UIDraw.rect(slotPos, slotSize, '#333030ff');

                if (item.type === 'frame'){
                    const i = item.index;
                    if (anim) this.UIDraw.sheet(this.sprite, new Vector(slotPos.x + 5, slotPos.y + 5), new Vector(180,180), anim, i);
                } else if (item.type === 'group'){
                    // group pseudo-frame: show a composited preview when layered, otherwise center a label
                    const gp = item.group;
                    if (gp && gp.layered) {
                        try {
                            const px = (this.sprite && this.sprite.slicePx) ? this.sprite.slicePx : 16;
                            const tmp = document.createElement('canvas'); tmp.width = px; tmp.height = px;
                            const tctx = tmp.getContext('2d'); tctx.clearRect(0,0,px,px);
                            for (const idx of (gp.indices || [])){
                                try {
                                    const src = (typeof this.sprite.getFrame === 'function') ? this.sprite.getFrame(anim, idx) : null;
                                    if (src) tctx.drawImage(src, 0, 0);
                                } catch (e) {}
                            }
                            // draw composited thumbnail into the slot inner area
                            this.UIDraw.image(tmp, new Vector(slotPos.x + 5, slotPos.y + 5), new Vector(180,180), null, 0, 1, false);
                            // small layered indicator at bottom
                            this.UIDraw.text('Layered', new Vector(slotPos.x + slotSize.x/2, slotPos.y + slotSize.y - 16), '#FFFFFF', 0, 12, { align: 'center', font: 'monospace' });
                        } catch (e) { /* fallback to label below on error */ }
                    } else {
                        const center = slotPos.clone().add(new Vector(slotSize.x/2, slotSize.y/2));
                        const label = 'Group (' + (gp.indices ? gp.indices.length : 0) + ')';
                        this.UIDraw.text(label, new Vector(center.x, center.y + 6), '#FFFFFF', 0, 16, { align: 'center', font: 'monospace' });
                    }
                } else if (item.type === 'add'){
                    try {
                        const innerPos = new Vector(slotPos.x + 5, slotPos.y + 5);
                        const innerSize = new Vector(180,180);
                        const center = innerPos.clone().add(new Vector(innerSize.x/2, innerSize.y/2));
                        const barW = 6;
                        const barL = 64;
                        const vPos = new Vector(center.x - barW/2, center.y - barL/2);
                        const vSize = new Vector(barW, barL);
                        const hPos = new Vector(center.x - barL/2, center.y - barW/2);
                        const hSize = new Vector(barL, barW);
                        this.UIDraw.rect(vPos, vSize, '#FFFFFFFF', true);
                        this.UIDraw.rect(hPos, hSize, '#FFFFFFFF', true);
                    } catch (e) {}
                }

                // draw selected outline for frame indices (primary or multi)
                try {
                    if (item.type === 'frame'){
                        const i = item.index;
                        const isPrimary = (this.scene && typeof this.scene.selectedFrame !== 'undefined' && this.scene.selectedFrame === i);
                        const isMulti = this._multiSelected && this._multiSelected.has(i);
                        // outline frames that belong to any expanded (not collapsed) group in blue
                        try {
                            const inOpenGroup = groups && Array.isArray(groups) && groups.some(g => !g.collapsed && Array.isArray(g.indices) && g.indices.indexOf(i) !== -1);
                            if (inOpenGroup) this.UIDraw.rect(slotPos, slotSize, '#00000000', false, true, 3, '#0084ffff');
                        } catch (e) {}
                        if (isPrimary) this.UIDraw.rect(slotPos, slotSize, '#00000000', false, true, 4, '#FFFF00FF');
                        if (isMulti) this.UIDraw.rect(slotPos, slotSize, '#00000000', false, true, 4, '#00FF00FF');
                    } else if (item.type === 'group'){
                        // if all indices in group are selected, draw group multi outline
                        const gp2 = item.group;
                        const allSelected = gp2.indices.every(idx => this._multiSelected && this._multiSelected.has(idx));
                        if (allSelected) this.UIDraw.rect(slotPos, slotSize, '#00000000', false, true, 4, '#00FF00FF');
                    }
                } catch (e) {}
            }
        } catch(e){}
        this.UIDraw.text(this._animFps,new Vector(1875,40),'#FFFFFF')

    }
}