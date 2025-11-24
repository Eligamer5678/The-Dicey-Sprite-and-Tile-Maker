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
        this._lastDeleted = null; // store last deleted frame for simple undo
        this._animTimer = 0;
        this._animIndex = 0;
        this._animFps = 8;
        this._previewSize = 256;
        this._previewBuffer = 16;
        this._animName = null;
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
        if (oldName === 'idle') return false;
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
        if (name === 'idle') return false;
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
            if (!sliceStr) { URL.revokeObjectURL(url); return; }
            let slice = parseInt(sliceStr, 10);
            if (isNaN(slice) || slice <= 0) slice = defaultSlice;
            const srcW = bitmap ? bitmap.width : img.width;
            const srcH = bitmap ? bitmap.height : img.height;
            const cols = Math.max(1, Math.floor(srcW / slice));
            const rows = Math.max(1, Math.floor(srcH / slice));
            console.log('Importing spritesheet:', file.name, 'img', srcW + 'x' + srcH, 'slice', slice, 'cols', cols, 'rows', rows);
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
                const firstAnim = Array.from(ss._frames.keys())[0] || 'idle';
                this.scene.selectedAnimation = firstAnim;
                // materialize frames for the first animation so preview shows up
                try { if (typeof ss._materializeAnimation === 'function') ss._materializeAnimation(firstAnim); } catch(e) {}
                this.scene.selectedFrame = 0;
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
            const defaultName = (this.scene && this.scene.currentSprite && this.scene.currentSprite.name) ? this.scene.currentSprite.name : 'spritesheet';
            const filename = window.prompt('Export filename', defaultName + '.png') || (defaultName + '.png');
            // toBlob
            // ensure packed sheet is available (may have been deferred for performance)
            try { if (this.sprite && typeof this.sprite.ensurePackedSheet === 'function') this.sprite.ensurePackedSheet(); } catch(e) {}
            const blob = await new Promise((res)=> sheet.toBlob((b)=>res(b), 'image/png'));
            // Use File System Access API when available
            if (window.showSaveFilePicker){
                try{
                    const handle = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'PNG Image', accept: { 'image/png': ['.png'] } }] });
                    const writable = await handle.createWritable();
                    await writable.write(blob);
                    await writable.close();
                    return;
                } catch (e) {
                    // fall through to anchor fallback
                    console.warn('showSaveFilePicker failed or canceled', e);
                }
            }
            // fallback: anchor download
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(()=>{ URL.revokeObjectURL(url); try{ a.remove(); }catch(e){} }, 1500);
        } catch (e) { console.warn('export failed', e); }
    }

    // Create import/export UI: hidden file input and two buttons placed near top-right
    _createImportExportUI(){
        try{
            const uiCanvas = document.getElementById('UI');
            if (!uiCanvas || !uiCanvas.parentNode) return;
            // Button positions: ~300px left from right edge (1920 - 300 = 1620)
            const importPos = new Vector(1620, this._previewBuffer + 4);
            const btnSize = new Vector(140, 28);
            this._importBtn = createHButton('import-spritesheet-btn', importPos, btnSize, '#334455', { color: '#fff', borderRadius: '4px', fontSize: 14 }, uiCanvas.parentNode);
            this._importBtn.textContent = 'Import Spritesheet';

            const exportPos = new Vector(1620, this._previewBuffer + 4 + btnSize.y + 6);
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
        if(this._animFps === 0) this._animIndex = this.selectedFrame
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
            // reset when animation changes
            if (anim !== this._animName) {
                this._animName = anim;
                this._animIndex = 0;
                this._animTimer = 0;
            }
            if (framesArr.length > 0 && this._animFps > 0) {
                this._animTimer += dt;
                const frameTime = 1 / (this._animFps || 8);
                while (this._animTimer >= frameTime) {
                    this._animTimer -= frameTime;
                    this._animIndex = (this._animIndex + 1) % framesArr.length;
                }
            } else {
                this._animIndex = 0;
                this._animTimer = 0;
            }
        } catch (e) {
            // ignore
        }

        // handle click selection: if left button was released over a frame slot

        if (this.mouse && this.mouse.released && this.mouse.released('left')) {
            const anim = (this.scene && this.scene.selectedAnimation) ? this.scene.selectedAnimation : null;
            const framesArr = (this.sprite && this.sprite._frames && anim) ? (this.sprite._frames.get(anim) || []) : [];
            const slotCount = framesArr.length + 1;
            for (let i = 0; i < slotCount; i++) {
                const pos = new Vector(5, 100 + (180 + 20) * i + this.scrollPos);
                const size = new Vector(190, 190);
                if (Geometry.pointInRect(this.mouse.pos, pos, size)) {
                    // clicked an existing frame
                    if (!anim) break;
                    if (i < framesArr.length) {
                        if (this.scene) this.scene.selectedFrame = i;
                    } else {
                        // add new frame and select it
                        if (typeof this.sprite.insertFrame === 'function') {
                            this.sprite.insertFrame(anim);
                            if (this.scene) this.scene.selectedFrame = framesArr.length; // previous length -> new index
                        }
                    }
                    // prevent input "leak" to underlying UI by masking this layer (use addMask to avoid region conflicts)
                    try { if (this.mouse && typeof this.mouse.addMask === 'function') this.mouse.addMask(1); } catch (e) {}
                    break; // stop after first hit
                }
            }
        }
        // handle backspace: remove selected frame when hovering over the menu
        try {
            if (this.keys && this.keys.pressed && this.keys.released && this.keys.released('Backspace')) {
                // only if mouse is over our menu area
                if (this.mouse && Geometry.pointInRect(this.mouse.pos, this.menu.pos, this.menu.size)) {
                    const anim = (this.scene && this.scene.selectedAnimation) ? this.scene.selectedAnimation : null;
                    const sel = (this.scene && typeof this.scene.selectedFrame === 'number') ? this.scene.selectedFrame : null;
                    const arr = (this.sprite && this.sprite._frames && anim) ? (this.sprite._frames.get(anim) || []) : [];
                    if (anim && sel !== null && arr.length > 0 && sel >= 0 && sel < arr.length) {
                        if (typeof this.sprite.popFrame === 'function') {
                            // capture removed frame for undo
                            const removed = this.sprite.popFrame(anim, sel);
                            if (removed) {
                                this._lastDeleted = { anim: anim, index: sel, canvas: removed };
                            }
                            // clamp selectedFrame to new range
                            const newLen = (this.sprite._frames.get(anim) || []).length;
                            if (this.scene) {
                                if (newLen === 0) this.scene.selectedFrame = 0;
                                else this.scene.selectedFrame = Math.max(0, Math.min(sel, newLen - 1));
                            }
                            // mask input so other UI doesn't receive the same key/mouse (use addMask for click context)
                            try { if (this.mouse && typeof this.mouse.addMask === 'function') this.mouse.addMask(1); } catch (e) {}
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('FrameSelect delete handling failed', e);
        }

        // undo delete (Ctrl+Z or Meta+Z)
        try {
            if (this.keys && typeof this.keys.comboPressed === 'function') {
                if (this.keys.comboPressed(['Control','z']) || this.keys.comboPressed(['Meta','z'])) {
                    if (this._lastDeleted && this.sprite) {
                        const info = this._lastDeleted;
                        try {
                            if (!this.sprite._frames.has(info.anim)) this.sprite._frames.set(info.anim, []);
                            const arr = this.sprite._frames.get(info.anim);
                            // insert the canvas back at original index
                            arr.splice(info.index, 0, info.canvas);
                            if (typeof this.sprite._rebuildSheetCanvas === 'function') this.sprite._rebuildSheetCanvas();
                            // restore selection to restored frame
                            if (this.scene) this.scene.selectedFrame = info.index;
                            // clear saved undo
                            this._lastDeleted = null;
                            // mask input (use addMask to avoid interfering with overlapping UI regions)
                            try { if (this.mouse && typeof this.mouse.addMask === 'function') this.mouse.addMask(1); } catch (e) {}
                        } catch (e) { console.warn('FrameSelect undo failed', e); }
                    }
                }
            }
        } catch (e) {
            console.warn('FrameSelect undo handling failed', e);
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
                            if (name !== 'idle') this._spawnTextInputFor(name);
                        } else if (Geometry.pointInRect(this.mouse.pos, removeRect, removeSize)){
                            if (name !== 'idle') this.removeAnimation(name);
                        } else {
                            // select animation
                            if (this.scene) this.scene.selectedAnimation = name;
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
            // draw current frame if available
            const anim = (this.scene && this.scene.selectedAnimation) ? this.scene.selectedAnimation : null;
            const framesArr = (this.sprite && this.sprite._frames && anim) ? (this.sprite._frames.get(anim) || []) : [];
            if (framesArr.length > 0 && anim) {
                const fi = Math.max(0, Math.min(this._animIndex, framesArr.length - 1));
                this.UIDraw.sheet(this.sprite, contentPos, contentSize, anim, fi);
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
                const disabled = (name === 'idle');
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
        const slotCount = framesArr.length + 1; // extra slot for "add new frame"
        for (let i = 0; i < slotCount; i++){
            this.UIDraw.rect(new Vector(5,100 + (180+20) * i + this.scrollPos),new Vector(190,190),'#333030ff')
            // only draw an existing frame; the final slot is the "add" placeholder
            if (i < framesArr.length && anim) {
                this.UIDraw.sheet(this.sprite, new Vector(10,100 + (180+20) * i + this.scrollPos), new Vector(180,180), anim, i)
            }
            // draw a plus icon in the add-new slot (simple two-rect plus)
            if (i === framesArr.length) {
                try {
                    const innerPos = new Vector(10,100 + (180+20) * i + this.scrollPos);
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
            // draw selected outline if this is the selected frame
            try {
                if (this.scene && typeof this.scene.selectedFrame !== 'undefined' && this.scene.selectedFrame === i) {
                    const selPos = new Vector(5,100 + (180+20) * i + this.scrollPos);
                    const selSize = new Vector(190,190);
                    // stroke only, no fill: pass fill=false, stroke=true
                    this.UIDraw.rect(selPos, selSize, '#00000000', false, true, 4, '#FFFF00FF');
                }
            } catch (e) {
                // ignore drawing errors
            }
        }
        this.UIDraw.text(this._animFps,new Vector(1875,40),'#FFFFFF')

    }
}