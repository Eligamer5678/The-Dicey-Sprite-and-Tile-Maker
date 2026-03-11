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
        this._animFps = (scene && typeof scene._getSpriteAnimationFps === 'function' && scene.selectedAnimation)
            ? scene._getSpriteAnimationFps(scene.selectedAnimation, 8)
            : 8;
        this._previewSize = 256;
        this._previewBuffer = 16;
        this._listYOffset = 86;
        this._rightListMode = 'animations'; // 'animations' | 'layers'
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
            try {
                const anim = this.scene && this.scene.selectedAnimation ? this.scene.selectedAnimation : null;
                if (anim && this.scene && typeof this.scene._setSpriteAnimationProfile === 'function') {
                    this.scene._setSpriteAnimationProfile(anim, { fps: this._animFps }, true);
                }
            } catch (e) {}
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
        this._jsZipCtor = null;
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

    _ensureAnimationListed(animName){
        try {
            const name = (typeof animName === 'string') ? animName.trim() : '';
            if (!name || !this.sprite) return false;
            if (!this.sprite._frames) this.sprite._frames = new Map();
            if (this.sprite._frames.has(name)) return true;
            this.sprite._frames.set(name, []);
            if (this.sprite.animations && typeof this.sprite.animations.set === 'function' && !this.sprite.animations.has(name)) {
                const row = Math.max(0, this._getAnimationNames().indexOf(name));
                this.sprite.animations.set(name, { row, frameCount: 0 });
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    _normalizeOpenConnKey(key){
        let bits = String(key || '00000000').replace(/[^01]/g, '');
        while (bits.length < 8) bits += '0';
        bits = bits.slice(0, 8);
        const arr = bits.split('');
        const edgeTop = arr[0] === '1';
        const edgeRight = arr[1] === '1';
        const edgeBottom = arr[2] === '1';
        const edgeLeft = arr[3] === '1';

        if (edgeTop) { arr[4] = '1'; arr[5] = '1'; }
        if (edgeRight) { arr[5] = '1'; arr[6] = '1'; }
        if (edgeBottom) { arr[6] = '1'; arr[7] = '1'; }
        if (edgeLeft) { arr[4] = '1'; arr[7] = '1'; }
        return arr.join('');
    }

    _getFrameConnKey(anim, frame){
        try {
            if (!this.scene) return '00000000';
            if (!this.scene._tileConnMap) this.scene._tileConnMap = {};
            const k = String(anim || '') + '::' + Number(frame || 0);
            return this._normalizeOpenConnKey(this.scene._tileConnMap[k] || '00000000');
        } catch (e) {
            return '00000000';
        }
    }

    _setFrameConnKey(anim, frame, key){
        try {
            if (!this.scene) return;
            if (!this.scene._tileConnMap) this.scene._tileConnMap = {};
            const k = String(anim || '') + '::' + Number(frame || 0);
            this.scene._tileConnMap[k] = this._normalizeOpenConnKey(key);
        } catch (e) {}
    }

    _getFrameConnHitRects(slotPos){
        const frame = {
            x: slotPos.x,
            y: slotPos.y,
            w: 190,
            h: 190
        };
        const edge = Math.round(frame.w / 8); // ~1/8th of frame
        const corner = edge;
        const outside = 6; // extend hit area outside frame for easier clicking
        const cornerOutside = 12; // extra generosity for corner hitboxes
        return [
            { index: 0, x: frame.x + corner, y: frame.y - outside, w: frame.w - corner * 2, h: edge + outside }, // top
            { index: 1, x: frame.x + frame.w - edge, y: frame.y + corner, w: edge + outside, h: frame.h - corner * 2 }, // right
            { index: 2, x: frame.x + corner, y: frame.y + frame.h - edge, w: frame.w - corner * 2, h: edge + outside }, // bottom
            { index: 3, x: frame.x - outside, y: frame.y + corner, w: edge + outside, h: frame.h - corner * 2 }, // left
            { index: 4, x: frame.x - cornerOutside, y: frame.y - cornerOutside, w: corner + cornerOutside, h: corner + cornerOutside }, // top-left
            { index: 5, x: frame.x + frame.w - corner, y: frame.y - cornerOutside, w: corner + cornerOutside, h: corner + cornerOutside }, // top-right
            { index: 6, x: frame.x + frame.w - corner, y: frame.y + frame.h - corner, w: corner + cornerOutside, h: corner + cornerOutside }, // bottom-right
            { index: 7, x: frame.x - cornerOutside, y: frame.y + frame.h - corner, w: corner + cornerOutside, h: corner + cornerOutside } // bottom-left
        ];
    }

    _hitFrameConnection(slotPos, point){
        const rects = this._getFrameConnHitRects(slotPos);
        for (const r of rects){
            if (point.x >= r.x && point.y >= r.y && point.x <= r.x + r.w && point.y <= r.y + r.h) return r.index;
        }
        return -1;
    }

    _toggleFrameConnection(anim, frame, partIndex){
        const current = this._getFrameConnKey(anim, frame).split('');
        if (partIndex < 0 || partIndex > 7) return;
        current[partIndex] = (current[partIndex] === '1') ? '0' : '1';
        this._setFrameConnKey(anim, frame, current.join(''));
    }

    _drawFrameConnectionOverlay(slotPos, openConnKey){
        const bits = this._normalizeOpenConnKey(openConnKey).split('');
        const t = 4; // match selected-frame yellow outline thickness
        const x = slotPos.x+2;
        const y = slotPos.y+2;
        const w = 186;
        const h = 186;
        const c = 24; // corner segment length
        const color = '#00FFFF';

        // edges (top, right, bottom, left)
        if (bits[0] === '1') this.UIDraw.rect(new Vector(x + c, y), new Vector(w - c * 2, t), color, true);
        if (bits[1] === '1') this.UIDraw.rect(new Vector(x + w - t, y + c), new Vector(t, h - c * 2), color, true);
        if (bits[2] === '1') this.UIDraw.rect(new Vector(x + c, y + h - t), new Vector(w - c * 2, t), color, true);
        if (bits[3] === '1') this.UIDraw.rect(new Vector(x, y + c), new Vector(t, h - c * 2), color, true);

        // corners (tl, tr, br, bl)
        if (bits[4] === '1') {
            this.UIDraw.rect(new Vector(x, y), new Vector(c, t), color, true);
            this.UIDraw.rect(new Vector(x, y), new Vector(t, c), color, true);
        }
        if (bits[5] === '1') {
            this.UIDraw.rect(new Vector(x + w - c, y), new Vector(c, t), color, true);
            this.UIDraw.rect(new Vector(x + w - t, y), new Vector(t, c), color, true);
        }
        if (bits[6] === '1') {
            this.UIDraw.rect(new Vector(x + w - c, y + h - t), new Vector(c, t), color, true);
            this.UIDraw.rect(new Vector(x + w - t, y + h - c), new Vector(t, c), color, true);
        }
        if (bits[7] === '1') {
            this.UIDraw.rect(new Vector(x, y + h - t), new Vector(c, t), color, true);
            this.UIDraw.rect(new Vector(x, y + h - c), new Vector(t, c), color, true);
        }
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
        if (typeof this.sprite.addAnimation === 'function') {
            // Register animation metadata first so collaborative sync sees creation.
            const row = this._getAnimationNames().length;
            this.sprite.addAnimation(newName, row, 0);
        }
        // Ensure the sidebar list has the animation immediately.
        this._ensureAnimationListed(newName);
        // Push one starter frame so remote peers receive a structural frame op and stay in sync.
        if (typeof this.sprite.insertFrame === 'function') this.sprite.insertFrame(newName, 0);
        else this.sprite._frames.set(newName, [document.createElement('canvas')]);
        if (this.scene) {
            this.scene.selectedAnimation = newName;
            this.scene.selectedFrame = 0;
            try { if (typeof this.scene._onAnimationAdded === 'function') this.scene._onAnimationAdded(newName); } catch (e) {}
        }
        // spawn text input to rename immediately
        this._spawnTextInputFor(newName);
    }

    renameAnimation(oldName, newName){
        if (!this.sprite || !this.sprite._frames) return false;
        if (!oldName || !newName) return false;
        newName = String(newName).trim();
        if (newName.length === 0) return false;
        let ok = false;
        if (typeof this.sprite.renameAnimation === 'function') {
            ok = !!this.sprite.renameAnimation(oldName, newName);
        } else {
            if (this.sprite._frames.has(newName)) return false; // avoid collision
            const arr = this.sprite._frames.get(oldName);
            this.sprite._frames.set(newName, arr);
            this.sprite._frames.delete(oldName);
            if (typeof this.sprite._rebuildSheetCanvas === 'function') this.sprite._rebuildSheetCanvas();
            ok = true;
        }
        if (!ok) return false;
        try {
            if (this.scene && typeof this.scene._remapAnimationReferences === 'function') {
                this.scene._remapAnimationReferences(oldName, newName);
                if (typeof this.scene._onAnimationRenamed === 'function') this.scene._onAnimationRenamed(oldName, newName);
            } else if (this.scene && this.scene.selectedAnimation === oldName) {
                this.scene.selectedAnimation = newName;
            }
        } catch (e) {}
        return true;
    }

    removeAnimation(name){
        if (!this.sprite || !this.sprite._frames) return false;
        if (!this.sprite._frames.has(name)) return false;
        if (typeof this.sprite.removeAnimation === 'function') this.sprite.removeAnimation(name);
        else {
            this.sprite._frames.delete(name);
            if (typeof this.sprite._rebuildSheetCanvas === 'function') this.sprite._rebuildSheetCanvas();
        }
        try {
            if (this.sprite._frameGroups && typeof this.sprite._frameGroups.delete === 'function') this.sprite._frameGroups.delete(name);
        } catch (e) {}
        try { if (this.scene && typeof this.scene._onAnimationRemoved === 'function') this.scene._onAnimationRemoved(name); } catch (e) {}
        // adjust selection
        const names = this._getAnimationNames();
        if (this.scene){
            if (names.length > 0) this.scene.selectedAnimation = names[0];
            else this.scene.selectedAnimation = 'idle';
            this.scene.selectedFrame = 0;
        }
        return true;
    }

    _spawnTextInputFor(animName){
        // place input roughly under preview area (draw uses same calc)
        const outerPos = new Vector(1920-this._previewBuffer*3-this._previewSize, this._previewBuffer);
        const contentPos = outerPos.clone().add(new Vector(this._previewBuffer, this._previewBuffer));
        const contentSize = new Vector(this._previewSize, this._previewSize);
        const listX = contentPos.x;
        const listY = contentPos.y + contentSize.y + 8 + this._listYOffset;
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

    _resolveLayerListType() {
        try {
            if (!this.scene) return 'pixel';
            const pos = (typeof this.scene.getPos === 'function' && this.mouse) ? this.scene.getPos(this.mouse.pos) : null;
            if (this.scene.tilemode) {
                // In tilemode, use tile layers only while in render-only (zoomed-out) view.
                // When zoomed in (normal world/pixel editing), show pixel layers instead.
                return (pos && pos.renderOnly) ? 'tile' : 'pixel';
            }
            return 'pixel';
        } catch (e) {
            return 'pixel';
        }
    }

    _getPreviewFrameCanvas(anim, frameIdx){
        try {
            if (this.scene && typeof this.scene._getCompositedPixelFrame === 'function') {
                const c = this.scene._getCompositedPixelFrame(anim, frameIdx);
                if (c) return c;
            }
        } catch (e) {}
        try {
            if (this.sprite && typeof this.sprite.getFrame === 'function') return this.sprite.getFrame(anim, frameIdx);
        } catch (e) {}
        return null;
    }

    _basenameFromPath(pathLike){
        try {
            const p = String(pathLike || '');
            const parts = p.split(/[\\/]/g).filter(Boolean);
            return parts.length ? parts[parts.length - 1] : p;
        } catch (e) {
            return String(pathLike || '');
        }
    }

    _stripExtension(name){
        const n = String(name || '');
        const i = n.lastIndexOf('.');
        if (i <= 0) return n;
        return n.slice(0, i);
    }

    _xmlEscape(v){
        return String(v ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    _getAllValidOpenConnKeys(){
        const out = [];
        for (let mask = 0; mask < 256; mask++) {
            const bits = mask.toString(2).padStart(8, '0');
            if (this._normalizeOpenConnKey(bits) === bits) out.push(bits);
        }
        return out;
    }

    _getBase47ConnectionOrder(){
        try {
            const sceneMap = (this.scene && this.scene._availableTileConn && typeof this.scene._availableTileConn === 'object')
                ? this.scene._availableTileConn
                : null;
            const ordered = [];
            if (sceneMap) {
                const byIndex = [];
                for (const key of Object.keys(sceneMap)) {
                    const idx = Number(sceneMap[key]);
                    if (!Number.isFinite(idx)) continue;
                    byIndex.push({ key: this._normalizeOpenConnKey(key), idx: idx | 0 });
                }
                byIndex.sort((a, b) => a.idx - b.idx);
                for (const e of byIndex) {
                    if (!ordered.includes(e.key)) ordered.push(e.key);
                }
            }

            const all = this._getAllValidOpenConnKeys();
            const missing = all.filter(k => !ordered.includes(k)).sort((a, b) => parseInt(a, 2) - parseInt(b, 2));
            const full = ordered.concat(missing);
            return full.slice(0, 47);
        } catch (e) {
            return this._getAllValidOpenConnKeys().sort((a, b) => parseInt(a, 2) - parseInt(b, 2)).slice(0, 47);
        }
    }

    _base47SlotFromOrderIndex(orderIndex){
        if (!Number.isFinite(orderIndex)) return -1;
        const i = orderIndex | 0;
        if (i < 0 || i >= 47) return -1;
        return i < 42 ? i : (i + 2); // 7x7 grid with bottom-left two slots reserved blank
    }

    _isImageCellFullyTransparent(imgSource, slice, col, row){
        try {
            const s = Math.max(1, Number(slice) | 0);
            const c = document.createElement('canvas');
            c.width = s;
            c.height = s;
            const ctx = c.getContext('2d');
            if (!ctx) return false;
            ctx.clearRect(0, 0, s, s);
            ctx.drawImage(imgSource, (col | 0) * s, (row | 0) * s, s, s, 0, 0, s, s);
            const data = ctx.getImageData(0, 0, s, s).data;
            for (let i = 3; i < data.length; i += 4) {
                if (data[i] !== 0) return false;
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    _detectBase47Layout(imgSource, slice, cols, rows){
        try {
            if ((cols | 0) !== 7 || (rows | 0) !== 7) return false;
            const blankA = this._isImageCellFullyTransparent(imgSource, slice, 0, 6);
            const blankB = this._isImageCellFullyTransparent(imgSource, slice, 1, 6);
            return !!(blankA && blankB);
        } catch (e) {
            return false;
        }
    }

    _buildBase47ExportCanvas(anim){
        try {
            const scene = this.scene;
            const sprite = this.sprite;
            if (!scene || !sprite || typeof sprite.getFrame !== 'function') return null;
            const animName = String(anim || scene.selectedAnimation || 'idle');
            const slice = Math.max(1, Number(sprite.slicePx) || 16);
            const canvas = document.createElement('canvas');
            canvas.width = 7 * slice;
            canvas.height = 7 * slice;
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;
            try { ctx.imageSmoothingEnabled = false; } catch (e) {}
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const order = this._getBase47ConnectionOrder();
            const keyToFrame = new Map();
            const frameCount = (scene && typeof scene._getAnimationLogicalFrameCount === 'function')
                ? Math.max(0, Number(scene._getAnimationLogicalFrameCount(animName)) | 0)
                : Math.max(0, ((sprite._frames && sprite._frames.get(animName)) || []).length | 0);
            for (let i = 0; i < frameCount; i++) {
                const k = String(animName) + '::' + i;
                const raw = scene && scene._tileConnMap ? scene._tileConnMap[k] : null;
                if (typeof raw !== 'string') continue;
                const norm = this._normalizeOpenConnKey(raw);
                if (!keyToFrame.has(norm)) keyToFrame.set(norm, i);
            }

            for (let i = 0; i < order.length; i++) {
                const key = order[i];
                const slot = this._base47SlotFromOrderIndex(i);
                if (slot < 0) continue;
                const frameIdx = keyToFrame.has(key) ? keyToFrame.get(key) : null;
                if (!Number.isFinite(frameIdx)) continue;
                const fr = sprite.getFrame(animName, frameIdx);
                if (!fr) continue;
                const col = slot % 7;
                const row = Math.floor(slot / 7);
                ctx.drawImage(fr, 0, 0, fr.width, fr.height, col * slice, row * slice, slice, slice);
            }
            return canvas;
        } catch (e) {
            return null;
        }
    }

    _buildBase47SpriteSheetFromImage(imgSource, slice){
        const s = Math.max(1, Number(slice) | 0);
        const ss = new SpriteSheet(imgSource, s);
        ss._frames = new Map();
        const anim = 'anim0';
        const order = this._getBase47ConnectionOrder();
        const frames = [];
        for (let i = 0; i < order.length; i++) {
            const slot = this._base47SlotFromOrderIndex(i);
            if (slot < 0) continue;
            const col = slot % 7;
            const row = Math.floor(slot / 7);
            frames.push({ __lazy: true, src: imgSource, sx: col * s, sy: row * s, w: s, h: s });
        }
        ss._frames.set(anim, frames);
        try { ss._rebuildSheetCanvas(); } catch (e) {}
        const connByIndex = {};
        for (let i = 0; i < order.length; i++) connByIndex[i] = order[i];
        return { ss, anim, connByIndex };
    }

    async _getJsZipCtor(){
        if (this._jsZipCtor) return this._jsZipCtor;
        if (typeof window !== 'undefined' && window.JSZip) {
            this._jsZipCtor = window.JSZip;
            return this._jsZipCtor;
        }
        try {
            const mod = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
            this._jsZipCtor = mod && mod.default ? mod.default : mod;
            return this._jsZipCtor;
        } catch (e) {
            throw new Error('ZIP support is unavailable in this browser session.');
        }
    }

    _mimeTypeForFilename(name){
        const lower = String(name || '').toLowerCase();
        if (lower.endsWith('.tmx') || lower.endsWith('.tsx') || lower.endsWith('.xml')) return 'application/xml';
        if (lower.endsWith('.png')) return 'image/png';
        if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
        if (lower.endsWith('.gif')) return 'image/gif';
        if (lower.endsWith('.json')) return 'application/json';
        if (lower.endsWith('.zip')) return 'application/zip';
        return 'application/octet-stream';
    }

    async _extractTiledFilesFromZip(zipFile){
        const JSZip = await this._getJsZipCtor();
        const archive = await JSZip.loadAsync(zipFile);
        const files = [];
        const names = Object.keys(archive.files || {});
        for (const name of names) {
            const entry = archive.files[name];
            if (!entry || entry.dir) continue;
            const baseName = this._basenameFromPath(name);
            if (!baseName) continue;
            const blob = await entry.async('blob');
            const mime = this._mimeTypeForFilename(baseName);
            let asFile = null;
            try {
                asFile = new File([blob], baseName, { type: mime });
            } catch (e) {
                asFile = blob;
                try { Object.defineProperty(asFile, 'name', { value: baseName, configurable: true }); } catch (ignore) {}
            }
            files.push(asFile);
        }
        if (files.length === 0) throw new Error('ZIP archive is empty.');

        const pickByExt = (ext) => files.find((f) => String((f && f.name) || '').toLowerCase().endsWith(ext));
        const primaryFile = pickByExt('.tmx') || pickByExt('.tsx') || pickByExt('.xml');
        if (!primaryFile) throw new Error('ZIP does not contain a TMX/TSX/XML file.');
        return { files, primaryFile };
    }

    _parseXmlText(text){
        try {
            const doc = new DOMParser().parseFromString(String(text || ''), 'application/xml');
            if (!doc) return null;
            const err = doc.querySelector('parsererror');
            if (err) return null;
            return doc;
        } catch (e) {
            return null;
        }
    }

    async _decodeImageFile(file){
        if (!file) return null;
        try {
            if (window.createImageBitmap) {
                return await createImageBitmap(file);
            }
        } catch (e) {}
        const url = URL.createObjectURL(file);
        try {
            const img = new Image();
            img.src = url;
            await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
            return img;
        } finally {
            try { URL.revokeObjectURL(url); } catch (e) {}
        }
    }

    _readTmxDataToGids(dataEl, width, height){
        const count = Math.max(0, Number(width || 0) * Number(height || 0));
        const out = new Array(count).fill(0);
        if (!dataEl) return out;
        const encoding = String(dataEl.getAttribute('encoding') || '').trim().toLowerCase();
        if (encoding === 'csv') {
            const raw = String(dataEl.textContent || '');
            const nums = raw.split(',').map(s => Number(String(s || '').trim())).filter(n => Number.isFinite(n));
            for (let i = 0; i < Math.min(count, nums.length); i++) out[i] = nums[i] >>> 0;
            return out;
        }
        if (!encoding) {
            const tiles = dataEl.querySelectorAll('tile');
            let i = 0;
            for (const t of tiles) {
                if (i >= count) break;
                out[i++] = (Number(t.getAttribute('gid') || 0) >>> 0);
            }
            return out;
        }
        throw new Error('Unsupported TMX data encoding: ' + encoding + ' (supported: csv or tile elements)');
    }

    _extractTsxInfo(tsxDoc){
        const tilesetEl = tsxDoc ? (tsxDoc.querySelector('tileset') || tsxDoc.documentElement) : null;
        if (!tilesetEl || tilesetEl.nodeName !== 'tileset') throw new Error('Invalid TSX: missing <tileset>');
        const tilewidth = Math.max(1, Number(tilesetEl.getAttribute('tilewidth') || 16) | 0);
        const tileheight = Math.max(1, Number(tilesetEl.getAttribute('tileheight') || tilewidth) | 0);
        const columns = Math.max(1, Number(tilesetEl.getAttribute('columns') || 1) | 0);
        const tilecountAttr = Number(tilesetEl.getAttribute('tilecount') || 0);
        const imageEl = tilesetEl.querySelector('image');
        if (!imageEl) throw new Error('Invalid TSX: missing <image>');
        const imageSource = String(imageEl.getAttribute('source') || '').trim();
        const imageWidth = Math.max(1, Number(imageEl.getAttribute('width') || 0) | 0);
        const imageHeight = Math.max(1, Number(imageEl.getAttribute('height') || 0) | 0);
        const tilecount = Math.max(1, (Number.isFinite(tilecountAttr) && tilecountAttr > 0) ? (tilecountAttr | 0) : (Math.floor((imageWidth || 1) / tilewidth) * Math.floor((imageHeight || 1) / tileheight)));

        const perTile = new Map();
        const tileEls = tilesetEl.querySelectorAll('tile');
        for (const t of tileEls) {
            const id = Number(t.getAttribute('id'));
            if (!Number.isFinite(id)) continue;
            const props = {};
            const propEls = t.querySelectorAll('properties > property');
            for (const p of propEls) {
                const n = String(p.getAttribute('name') || '').trim();
                if (!n) continue;
                let val = p.getAttribute('value');
                if (val === null) val = p.textContent || '';
                props[n] = val;
            }
            perTile.set(id | 0, props);
        }
        return { tilewidth, tileheight, columns, tilecount, imageSource, imageWidth, imageHeight, perTile };
    }

    async _handleTiledImport(files, primaryFile){
        const fileList = Array.from(files || []);
        const byBase = new Map();
        for (const f of fileList) byBase.set(this._basenameFromPath(f.name).toLowerCase(), f);
        const primaryName = this._basenameFromPath(primaryFile && primaryFile.name ? primaryFile.name : '').toLowerCase();
        const isTmx = primaryName.endsWith('.tmx') || primaryName.endsWith('.xml');
        const isTsx = primaryName.endsWith('.tsx');
        if (!isTmx && !isTsx) throw new Error('Not a TMX/TSX file');

        const primaryText = await primaryFile.text();
        const primaryDoc = this._parseXmlText(primaryText);
        if (!primaryDoc) throw new Error('Unable to parse XML file: ' + primaryFile.name);

        let mapWidth = 0, mapHeight = 0;
        let gids = [];
        let spriteObjects = [];
        let tsxInfo = null;
        let mapBaseName = this._stripExtension(this._basenameFromPath(primaryFile && primaryFile.name ? primaryFile.name : ''));

        if (isTmx) {
            const mapEl = primaryDoc.querySelector('map');
            if (!mapEl) throw new Error('Invalid TMX: missing <map>');
            mapWidth = Math.max(1, Number(mapEl.getAttribute('width') || 1) | 0);
            mapHeight = Math.max(1, Number(mapEl.getAttribute('height') || 1) | 0);

            const tilesetRef = mapEl.querySelector('tileset');
            if (!tilesetRef) throw new Error('Invalid TMX: missing <tileset>');
            const source = String(tilesetRef.getAttribute('source') || '').trim();
            if (source) {
                const tsxFile = byBase.get(this._basenameFromPath(source).toLowerCase());
                if (!tsxFile) throw new Error('Referenced TSX not found in selection: ' + source);
                const tsxDoc = this._parseXmlText(await tsxFile.text());
                if (!tsxDoc) throw new Error('Failed to parse TSX: ' + tsxFile.name);
                tsxInfo = this._extractTsxInfo(tsxDoc);
                mapBaseName = this._stripExtension(this._basenameFromPath(tsxFile.name || mapBaseName || '')) || mapBaseName;
            } else {
                const tsxDoc = this._parseXmlText(tilesetRef.outerHTML);
                if (!tsxDoc) throw new Error('Failed to parse inline tileset from TMX');
                tsxInfo = this._extractTsxInfo(tsxDoc);
            }

            const layerEl = mapEl.querySelector('layer');
            if (!layerEl) throw new Error('Invalid TMX: missing <layer>');
            gids = this._readTmxDataToGids(layerEl.querySelector('data'), mapWidth, mapHeight);

            const objLayers = mapEl.querySelectorAll('objectgroup');
            spriteObjects = [];
            for (const g of objLayers) {
                const objs = g.querySelectorAll('object');
                for (const o of objs) {
                    const x = Number(o.getAttribute('x') || 0);
                    const y = Number(o.getAttribute('y') || 0);
                    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
                    const p = {};
                    const propEls = o.querySelectorAll('properties > property');
                    for (const pe of propEls) {
                        const pn = String(pe.getAttribute('name') || '').trim();
                        if (!pn) continue;
                        let pv = pe.getAttribute('value');
                        if (pv === null) pv = pe.textContent || '';
                        p[pn] = pv;
                    }
                    const nm = String(o.getAttribute('name') || '').trim();
                    const ty = String(o.getAttribute('type') || '').trim();
                    spriteObjects.push({ x, y, name: nm, type: ty, props: p });
                }
            }
        } else {
            tsxInfo = this._extractTsxInfo(primaryDoc);
            mapWidth = Math.max(1, Number(tsxInfo.columns) || 1);
            mapHeight = Math.max(1, Math.ceil((Number(tsxInfo.tilecount) || 1) / mapWidth));
            gids = new Array(mapWidth * mapHeight).fill(0).map((_, i) => (i + 1));
            spriteObjects = [];
            mapBaseName = this._stripExtension(this._basenameFromPath(primaryFile && primaryFile.name ? primaryFile.name : '')) || mapBaseName;
        }

        const imageRefName = this._basenameFromPath(tsxInfo.imageSource || '').toLowerCase();
        const imageFile = byBase.get(imageRefName);
        if (!imageFile) throw new Error('Referenced tileset image not found in selection: ' + tsxInfo.imageSource);
        const imgSource = await this._decodeImageFile(imageFile);
        if (!imgSource) throw new Error('Failed to decode tileset image: ' + imageFile.name);

        const slice = Math.max(1, Number(tsxInfo.tilewidth) || 16);
        const cols = Math.max(1, Number(tsxInfo.columns) || Math.floor((Number(tsxInfo.imageWidth) || slice) / slice) || 1);
        const rows = Math.max(1, Math.ceil((Number(tsxInfo.tilecount) || 1) / cols));

        const ss = new SpriteSheet(imgSource, slice);
        ss._frames = new Map();
        const tilecount = Math.max(1, Number(tsxInfo.tilecount) || (rows * cols));
        const hasSourceAnimMeta = (() => {
            try {
                for (const props of tsxInfo.perTile.values()) {
                    if (props && String(props.source_anim || '').trim()) return true;
                }
            } catch (e) {}
            return false;
        })();

        if (hasSourceAnimMeta) {
            const byAnim = new Map();
            for (const [tidRaw, props] of tsxInfo.perTile.entries()) {
                const tid = Number(tidRaw) | 0;
                if (!Number.isFinite(tid) || tid < 0 || tid >= tilecount) continue;
                const anim = String((props && props.source_anim) || '').trim();
                if (!anim) continue;
                const sx = (tid % cols) * slice;
                const sy = Math.floor(tid / cols) * slice;
                const index = Number.isFinite(Number(props.source_index)) ? (Number(props.source_index) | 0) : 0;
                if (index < 0) continue;
                if (!byAnim.has(anim)) byAnim.set(anim, new Map());
                const frameMap = byAnim.get(anim);
                if (!frameMap.has(index)) {
                    frameMap.set(index, { __lazy: true, src: imgSource, sx, sy, w: slice, h: slice });
                }
            }

            for (const [anim, frameMap] of byAnim.entries()) {
                const maxIndex = Math.max(0, ...Array.from(frameMap.keys()));
                const frames = new Array(maxIndex + 1).fill(null);
                for (const [idx, frame] of frameMap.entries()) frames[idx] = frame;
                for (let i = 0; i < frames.length; i++) {
                    if (frames[i]) continue;
                    frames[i] = document.createElement('canvas');
                    frames[i].width = slice;
                    frames[i].height = slice;
                }
                ss._frames.set(anim, frames);
            }
            if (ss._frames.size === 0) ss._frames.set('anim0', []);
        } else {
            for (let r = 0; r < rows; r++) {
                const frames = [];
                for (let c = 0; c < cols; c++) {
                    const tid = r * cols + c;
                    if (tid >= tilecount) break;
                    frames.push({ __lazy: true, src: imgSource, sx: c * slice, sy: r * slice, w: slice, h: slice });
                }
                ss._frames.set('anim' + r, frames);
            }
        }

        // Optional: restore sprite-only animations packed alongside TMX/TSX in zip exports.
        try {
            let manifestFile = null;
            const preferred = (String(mapBaseName || '').trim() + '.sprites.json').toLowerCase();
            if (preferred) manifestFile = byBase.get(preferred) || null;
            if (!manifestFile) {
                for (const f of fileList) {
                    const n = String((f && f.name) || '').toLowerCase();
                    if (n.endsWith('.sprites.json')) { manifestFile = f; break; }
                }
            }
            if (manifestFile) {
                const raw = await manifestFile.text();
                const parsed = JSON.parse(String(raw || '{}'));
                const animEntries = Array.isArray(parsed && parsed.animations) ? parsed.animations : [];
                for (const entry of animEntries) {
                    if (!entry) continue;
                    const animName = String(entry.name || '').trim();
                    if (!animName) continue;
                    const frameNames = Array.isArray(entry.frames) ? entry.frames : [];
                    const frames = [];
                    for (const fn of frameNames) {
                        const key = this._basenameFromPath(String(fn || '')).toLowerCase();
                        const frameFile = byBase.get(key);
                        if (!frameFile) continue;
                        const source = await this._decodeImageFile(frameFile);
                        if (!source) continue;
                        const c = document.createElement('canvas');
                        c.width = slice;
                        c.height = slice;
                        const ctx = c.getContext('2d');
                        try { ctx.imageSmoothingEnabled = false; } catch (e) {}
                        try { ctx.drawImage(source, 0, 0, slice, slice); } catch (e) {}
                        frames.push(c);
                    }
                    if (frames.length > 0) {
                        ss._frames.set(animName, frames);
                    }
                }
            }
        } catch (e) {
            console.warn('Failed to import sprite animation manifest', e);
        }
        try { ss._rebuildSheetCanvas(); } catch (e) {}

        if (this.scene) {
            this.scene.currentSprite = ss;
            this.sprite = ss;
            const animNames = Array.from(ss._frames.keys());
            this.scene.selectedAnimation = animNames[0] || 'anim0';
            this.scene.selectedFrame = 0;
            this.scene.tilemode = true;
            this.scene.tileCols = mapWidth;
            this.scene.tileRows = mapHeight;
            this.scene._tileActive = new Set();
            this.scene._tileCoordToIndex = new Map();
            this.scene._tileIndexToCoord = [];
            this.scene._areaBindings = [];
            this.scene._areaTransforms = [];

            const midC = Math.floor(mapWidth / 2);
            const midR = Math.floor(mapHeight / 2);
            const H_FLIP = 0x80000000;
            const V_FLIP = 0x40000000;
            const D_FLIP = 0x20000000;
            const MASK = 0x1FFFFFFF;
            const defaultAnimForTileFallback = (animNames && animNames.length > 0) ? String(animNames[0]) : 'anim0';

            for (let r = 0; r < mapHeight; r++) {
                for (let c = 0; c < mapWidth; c++) {
                    const idx1d = r * mapWidth + c;
                    const raw = (gids[idx1d] >>> 0) || 0;
                    if (!raw) continue;
                    const gid = raw & MASK;
                    if (!gid) continue;
                    const tileId = Math.max(0, gid - 1);
                    const col = c - midC;
                    const row = r - midR;
                    this.scene._activateTile(col, row);
                    const areaIndex = this.scene._getAreaIndexForCoord(col, row);
                    if (!Number.isFinite(areaIndex)) continue;

                    const tileProps = tsxInfo.perTile.get(tileId) || {};
                    const fallbackAnim = hasSourceAnimMeta ? defaultAnimForTileFallback : ('anim' + Math.floor(tileId / cols));
                    const fallbackFrame = hasSourceAnimMeta ? 0 : (tileId % cols);
                    const anim = String(tileProps.source_anim || fallbackAnim);
                    const frameIndex = Number.isFinite(Number(tileProps.source_index)) ? (Number(tileProps.source_index) | 0) : fallbackFrame;
                    let multiFrames = null;
                    if (tileProps.source_multiFrames) {
                        try {
                            const parsed = JSON.parse(String(tileProps.source_multiFrames));
                            if (Array.isArray(parsed) && parsed.length > 0) multiFrames = parsed.filter(n => Number.isFinite(Number(n))).map(n => Number(n) | 0);
                        } catch (e) {}
                    }
                    this.scene._setAreaBindingAtIndex(areaIndex, { anim, index: frameIndex, multiFrames: (multiFrames && multiFrames.length > 0) ? multiFrames : null }, false);

                    const hasH = !!(raw & H_FLIP);
                    const hasV = !!(raw & V_FLIP);
                    const hasD = !!(raw & D_FLIP);
                    const propRot = Number(tileProps.source_rot || 0);
                    const propFlipH = String(tileProps.source_flipH || '').toLowerCase() === 'true';
                    if (hasH || hasV || hasD || propRot || propFlipH) {
                        this.scene._setAreaTransformAtIndex(areaIndex, { rot: propRot || 0, flipH: !!(propFlipH || hasH) }, false);
                    }
                }
            }

            try {
                const layer = this.scene._normalizeSpriteLayerState();
                if (layer) {
                    layer.entities = {};
                    layer.order = [];
                    layer.selectedEntityId = null;
                }
            } catch (e) {}

            try {
                if (Array.isArray(spriteObjects) && spriteObjects.length > 0) {
                    for (const s of spriteObjects) {
                        const col = Math.round((Number(s.x) || 0) / slice) - midC;
                        const row = Math.round(((Number(s.y) || 0) - slice) / slice) - midR;
                        let anim = String((s.props && s.props.anim) || '').trim();
                        if (!anim) {
                            const nameHint = String((s && s.name) || '').trim();
                            const typeHint = String((s && s.type) || '').trim();
                            const candidate = nameHint || typeHint;
                            if (candidate && candidate !== 'sprite') anim = candidate;
                        }
                        if (!anim) anim = String(this.scene.selectedSpriteAnimation || this.scene.selectedAnimation || 'anim0');
                        if (anim && this.scene.currentSprite && this.scene.currentSprite._frames && !this.scene.currentSprite._frames.has(anim)) {
                            const parent = anim.includes('-') ? String(anim.split('-')[0] || '').trim() : '';
                            if (parent && this.scene.currentSprite._frames.has(parent)) {
                                const parentFrames = this.scene.currentSprite._frames.get(parent) || [];
                                this.scene.currentSprite._frames.set(anim, parentFrames.slice());
                            }
                        }
                        const created = this.scene._addSpriteEntityAt(col, row, anim, false);
                        if (created && s.props && Object.prototype.hasOwnProperty.call(s.props, 'fps')) {
                            const n = Number(s.props.fps);
                            if (Number.isFinite(n)) this.scene._updateSpriteEntity(created.id, { fps: n }, false);
                        }
                    }
                }
            } catch (e) {}

            try { if (typeof ss._materializeAnimation === 'function') ss._materializeAnimation(this.scene.selectedAnimation); } catch (e) {}
        }
    }

    async _handleImportFile(ev){
        try{
            const files = ev.target.files || [];
            if (!files || files.length === 0) return;
            const file = files[0];
            const lowerName = String(file.name || '').toLowerCase();
            if (lowerName.endsWith('.zip')) {
                const unpacked = await this._extractTiledFilesFromZip(file);
                await this._handleTiledImport(unpacked.files, unpacked.primaryFile);
                try{ ev.target.value = ''; } catch(e){}
                return;
            }
            if (lowerName.endsWith('.tmx') || lowerName.endsWith('.tsx') || lowerName.endsWith('.xml')) {
                await this._handleTiledImport(files, file);
                try{ ev.target.value = ''; } catch(e){}
                return;
            }
            // Ask whether this file should be treated as a spritesheet (default) or tilesheet
            let importMode = 'spritesheet';
            try {
                try { if (this.keys && typeof this.keys.pause === 'function') this.keys.pause(); if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause(); } catch(e){}
                const choice = window.prompt('Import as? 1 = spritesheet, 2 = tilesheet, 3 = base47 (aseprite png)', '1');
                if (choice !== null) {
                    const v = String(choice).trim();
                    if (v === '2') importMode = 'tilesheet';
                    else if (v === '3') importMode = 'base47';
                    else importMode = 'spritesheet';
                }
            } catch (e) { /* ignore and fall back to spritesheet */ }
            // Ask whether to replace the current sprite or append animations
            let appendMode = false;
            try {
                try { if (this.keys && typeof this.keys.pause === 'function') this.keys.pause(); if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause(); } catch(e){}
                const appendChoice = window.prompt('Import behavior? 1 = replace (clear), 2 = append', '1');
                if (appendChoice !== null) {
                    const v = String(appendChoice).trim();
                    appendMode = (v === '2');
                }
            } catch (e) { /* default stays replace */ }
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
            try { if (this.keys && typeof this.keys.pause === 'function') this.keys.pause(); if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause(); } catch(e){}
            let sliceStr = window.prompt('Enter slice size (px) for frames (one tile size)', String(defaultSlice));
            if (!sliceStr) { try { if (img && img.src && img.src.startsWith('blob:')) URL.revokeObjectURL(img.src); } catch(e){} return; }
            let slice = parseInt(sliceStr, 10);
            if (isNaN(slice) || slice <= 0) slice = defaultSlice;
            const srcW = bitmap ? bitmap.width : img.width;
            const srcH = bitmap ? bitmap.height : img.height;
            const cols = Math.max(1, Math.floor(srcW / slice));
            const rows = Math.max(1, Math.floor(srcH / slice));

            const autoDetectedBase47 = this._detectBase47Layout(bitmap || img, slice, cols, rows);
            const useBase47 = (importMode === 'base47') || (importMode === 'tilesheet' && autoDetectedBase47);
            let base47Meta = null;
            console.log('Importing spritesheet:', file.name, 'img', srcW + 'x' + srcH, 'slice', slice, 'cols', cols, 'rows', rows, 'mode', importMode);
            // Build SpriteSheet
            let ss = null;
            if (useBase47) {
                const built = this._buildBase47SpriteSheetFromImage(bitmap || img, slice);
                ss = built && built.ss ? built.ss : null;
                base47Meta = built || null;
                if (!ss) throw new Error('Failed to build base47 sprite sheet from image.');
            } else {
                ss = new SpriteSheet(img, slice);
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
            // apply to scene (append or replace)
            const targetScene = this.scene || null;
            let applied = false;
            if (appendMode && targetScene && targetScene.currentSprite) {
                const existing = targetScene.currentSprite;
                if (existing.slicePx !== ss.slicePx) {
                    try { window.alert(`Cannot append: slice size mismatch (current ${existing.slicePx}, new ${ss.slicePx}). Falling back to replace.`); } catch (e) {}
                } else {
                    try {
                        const existingNames = new Set(existing._frames ? existing._frames.keys() : []);
                        const addedNames = [];
                        const animNameRemap = new Map();
                        for (const [name, frames] of ss._frames.entries()){
                            let newName = name;
                            let suffix = 1;
                            while (existingNames.has(newName)) {
                                newName = `${name}_import${suffix++}`;
                            }
                            existingNames.add(newName);
                            const clonedFrames = Array.isArray(frames) ? frames.map(f => (f && f.__lazy === true ? { ...f } : f)) : [];
                            existing._frames.set(newName, clonedFrames);
                            addedNames.push(newName);
                            animNameRemap.set(name, newName);
                        }
                        if (useBase47 && base47Meta && targetScene) {
                            if (!targetScene._tileConnMap || typeof targetScene._tileConnMap !== 'object') targetScene._tileConnMap = {};
                            const srcAnim = String(base47Meta.anim || 'anim0');
                            const dstAnim = String(animNameRemap.get(srcAnim) || addedNames[0] || srcAnim);
                            const connByIndex = base47Meta.connByIndex || {};
                            for (const idxRaw of Object.keys(connByIndex)) {
                                const idx = Number(idxRaw) | 0;
                                const key = this._normalizeOpenConnKey(connByIndex[idxRaw]);
                                targetScene._tileConnMap[dstAnim + '::' + idx] = key;
                            }
                        }
                        if (typeof existing._rebuildSheetCanvas === 'function') existing._rebuildSheetCanvas();
                        this.sprite = existing;
                        targetScene.currentSprite = existing;
                        const firstNew = addedNames[0] || targetScene.selectedAnimation || 'idle';
                        targetScene.selectedAnimation = firstNew;
                        targetScene.selectedFrame = 0;
                        applied = true;
                        console.log('Import appended: animations added =', addedNames.length);
                    } catch (e) {
                        console.warn('append import failed, falling back to replace', e);
                    }
                }
            }

            if (!applied) {
                if (this.scene){
                    this.scene.currentSprite = ss;
                    const animNames = Array.from(ss._frames.keys());
                    const firstAnim = animNames[0] || 'idle';
                    this.scene.selectedAnimation = firstAnim;
                    // materialize frames for the first animation so preview shows up
                    try { if (typeof ss._materializeAnimation === 'function') ss._materializeAnimation(firstAnim); } catch(e) {}
                    this.scene.selectedFrame = 0;

                    // If importing as a tilesheet, enable tilemode and mirror the grid.
                    if (importMode === 'tilesheet' && !useBase47) {
                        try {
                            const scene = this.scene;
                            scene.tileCols = cols;
                            scene.tileRows = rows;
                            scene.tilemode = true;
                            // reset infinite-tile bookkeeping so newly imported grid shows immediately
                            try {
                                scene._tileActive = new Set();
                                scene._tileCoordToIndex = new Map();
                                scene._tileIndexToCoord = [];
                                if (typeof scene._seedTileActives === 'function') scene._seedTileActives(cols, rows);
                            } catch (e) { /* ignore tile reset errors */ }
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

                    if (useBase47) {
                        try {
                            if (!this.scene._tileConnMap || typeof this.scene._tileConnMap !== 'object') this.scene._tileConnMap = {};
                            const anim = String((base47Meta && base47Meta.anim) || firstAnim || 'anim0');
                            const connByIndex = (base47Meta && base47Meta.connByIndex) ? base47Meta.connByIndex : {};
                            for (const idxRaw of Object.keys(connByIndex)) {
                                const idx = Number(idxRaw) | 0;
                                const key = this._normalizeOpenConnKey(connByIndex[idxRaw]);
                                this.scene._tileConnMap[anim + '::' + idx] = key;
                            }
                            this.scene.selectedAnimation = anim;
                            this.scene.selectedFrame = 0;
                        } catch (e) { console.warn('base47 connection assignment failed', e); }
                    }
                }
                this.sprite = ss;
            }
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
            // Ask whether to export as spritesheet, tilesheet, Tiled map package, or base47 tilesheet PNG.
            let exportMode = 'spritesheet';
            try {
                try { if (this.keys && typeof this.keys.pause === 'function') this.keys.pause(); if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause(); } catch(e){}
                const choice = window.prompt('Export as? 1 = spritesheet, 2 = tilesheet, 3 = tiled (.zip package), 4 = base47 tilesheet (aseprite png)', '1');
                if (choice !== null) {
                    const v = String(choice).trim();
                    if (v === '2') exportMode = 'tilesheet';
                    else if (v === '3') exportMode = 'tiled';
                    else if (v === '4') exportMode = 'base47';
                    else exportMode = 'spritesheet';
                }
            } catch (e) { /* ignore and keep spritesheet */ }

            let exportFormat = 'png';
            if (exportMode === 'base47') {
                exportFormat = 'png';
            } else if (exportMode !== 'tiled') {
                try {
                    try { if (this.keys && typeof this.keys.pause === 'function') this.keys.pause(); if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause(); } catch(e){}
                    const fmtChoice = window.prompt('Image format? 1 = PNG, 2 = JPEG, 3 = GIF', '1');
                    const v = String(fmtChoice || '1').trim();
                    if (v === '2') exportFormat = 'jpeg';
                    else if (v === '3') exportFormat = 'gif';
                    else exportFormat = 'png';
                } catch (e) { /* default png */ }
            }

            let upscaleMultiplier = 1;
            if (exportMode !== 'tiled' && exportMode !== 'base47' && (exportFormat === 'png' || exportFormat === 'gif')) {
                try {
                    try { if (this.keys && typeof this.keys.pause === 'function') this.keys.pause(); if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause(); } catch(e){}
                    const up = window.prompt('Upscale multiplier (PNG/GIF, integer >= 1)', '1');
                    if (up !== null) {
                        const n = Math.floor(Number(up));
                        if (Number.isFinite(n) && n >= 1) upscaleMultiplier = n;
                    }
                } catch (e) { /* keep default */ }
            }

            let gifAnimationName = null;
            if (exportMode === 'spritesheet' && exportFormat === 'gif') {
                try {
                    const animNames = (this.sprite && this.sprite._frames) ? Array.from(this.sprite._frames.keys()) : [];
                    if (animNames.length > 0) {
                        const defaultAnim = (this.scene && this.scene.selectedAnimation && animNames.includes(this.scene.selectedAnimation))
                            ? this.scene.selectedAnimation
                            : animNames[0];
                        const defaultIndex = Math.max(1, animNames.indexOf(defaultAnim) + 1);
                        try { if (this.keys && typeof this.keys.pause === 'function') this.keys.pause(); if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause(); } catch(e){}
                        const input = window.prompt(
                            `GIF animation to export (name or 1-${animNames.length})`,
                            String(defaultAnim || defaultIndex)
                        );
                        if (input === null) return;
                        const raw = String(input || '').trim();
                        let resolved = defaultAnim;
                        const maybeIndex = Number(raw);
                        if (raw && Number.isFinite(maybeIndex)) {
                            const idx = Math.floor(maybeIndex) - 1;
                            if (idx >= 0 && idx < animNames.length) resolved = animNames[idx];
                        } else if (raw && animNames.includes(raw)) {
                            resolved = raw;
                        }
                        if (!resolved || !animNames.includes(resolved)) {
                            alert('Invalid animation selection for GIF export.');
                            return;
                        }
                        gifAnimationName = resolved;
                    }
                } catch (e) { /* ignore, fallback to selected animation logic */ }
            }

            const extensionForFormat = (fmt) => {
                if (fmt === 'jpeg') return '.jpg';
                if (fmt === 'gif') return '.gif';
                return '.png';
            };

            const defaultName = (this.scene && this.scene.currentSprite && this.scene.currentSprite.name) ? this.scene.currentSprite.name : 'spritesheet';
            try { if (this.keys && typeof this.keys.pause === 'function') this.keys.pause(); if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause(); } catch(e){}
            const filenamePrompt = window.prompt('Export filename', defaultName + (exportMode === 'tiled' ? '.zip' : extensionForFormat(exportFormat)));
            // If the user cancelled the prompt (null), abort export and do not download.
            if (filenamePrompt === null) return;
            const filename = filenamePrompt || (defaultName + (exportMode === 'tiled' ? '.zip' : extensionForFormat(exportFormat)));
            // Prompt whether to also download metadata JSON. If confirmed, ask for a metadata filename.
            let wantMeta = false;
            let chosenMetaFilename = null;
            if (exportMode !== 'tiled') {
                try {
                        try { if (this.keys && typeof this.keys.pause === 'function') this.keys.pause(); if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause(); } catch(e){}
                        const wantMetaConfirm = window.confirm('Also download metadata JSON alongside the exported image?');
                    if (wantMetaConfirm) {
                        const ext = extensionForFormat(exportFormat).replace('.', '\\.');
                        const suggestedMeta = (filename && new RegExp(ext + '$', 'i').test(filename)) ? filename.replace(new RegExp(ext + '$', 'i'), '.json') : (filename + '.json');
                        try { if (this.keys && typeof this.keys.pause === 'function') this.keys.pause(); if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause(); } catch(e){}
                        const metaPrompt = window.prompt('Metadata filename (Cancel to skip)', suggestedMeta);
                        if (metaPrompt !== null) {
                            chosenMetaFilename = metaPrompt || suggestedMeta;
                            wantMeta = true;
                        } else {
                            wantMeta = false;
                        }
                    }
                } catch (e) { /* ignore prompt failures */ }
            }

            const canvasToBlobByFormat = async (canvas, format) => {
                if (!canvas) return null;
                if (format === 'jpeg') {
                    return await new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', 0.92));
                }
                if (format === 'gif') {
                    try {
                        const dataUrl = canvas.toDataURL('image/gif');
                        if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/gif')) {
                            const resp = await fetch(dataUrl);
                            return await resp.blob();
                        }
                    } catch (e) {}
                    return null;
                }
                return await new Promise((res) => canvas.toBlob((b) => res(b), 'image/png'));
            };
            // toBlob
            // ensure packed sheet is available (may have been deferred for performance)
            try { if (this.sprite && typeof this.sprite.ensurePackedSheet === 'function') this.sprite.ensurePackedSheet(); } catch(e) {}

            // Build an export canvas depending on mode
            let exportCanvas = null;
            if (exportMode === 'base47') {
                try {
                    const anim = (this.scene && this.scene.selectedAnimation) ? this.scene.selectedAnimation : null;
                    exportCanvas = this._buildBase47ExportCanvas(anim);
                    if (!exportCanvas) {
                        alert('Unable to build base47 tilesheet from current animation. Make sure connection keys are assigned.');
                        return;
                    }
                } catch (e) {
                    console.warn('base47 export build failed', e);
                    alert('Failed to build base47 tilesheet PNG.');
                    return;
                }
            } else if ((exportMode === 'tilesheet' || exportMode === 'tiled') && this.scene && this.scene.currentSprite) {
                try {
                    const scene = this.scene;
                    const slice = scene.currentSprite.slicePx || (this.sprite && this.sprite.slicePx) || 16;
                    const parseTileKey = (key) => {
                        if (typeof key !== 'string') return null;
                        const parts = key.split(',');
                        if (parts.length !== 2) return null;
                        const c = Number(parts[0]);
                        const r = Number(parts[1]);
                        if (!Number.isFinite(c) || !Number.isFinite(r)) return null;
                        return { col: c|0, row: r|0 };
                    };

                    // Collect active tiles; if none, fall back to current grid bounds
                    const activeTiles = [];
                    if (scene._tileActive && scene._tileActive.size > 0) {
                        for (const k of scene._tileActive.values()) {
                            const c = parseTileKey(k);
                            if (c) activeTiles.push(c);
                        }
                    }
                    if (activeTiles.length === 0) {
                        const cols = Math.max(1, (scene.tileCols|0) || 3);
                        const rows = Math.max(1, (scene.tileRows|0) || cols);
                        const midC = Math.floor(cols / 2);
                        const midR = Math.floor(rows / 2);
                        for (let r = 0; r < rows; r++) {
                            for (let c = 0; c < cols; c++) {
                                activeTiles.push({ col: c - midC, row: r - midR });
                            }
                        }
                    }

                    // Compute bounding box of active tiles
                    let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
                    for (const t of activeTiles) {
                        minC = Math.min(minC, t.col); maxC = Math.max(maxC, t.col);
                        minR = Math.min(minR, t.row); maxR = Math.max(maxR, t.row);
                    }
                    const spanCols = (maxC - minC + 1);
                    const spanRows = (maxR - minR + 1);

                    // Prepare canvas sized to bounding box of active tiles
                    exportCanvas = document.createElement('canvas');
                    exportCanvas.width = spanCols * slice;
                    exportCanvas.height = spanRows * slice;
                    const ectx = exportCanvas.getContext('2d');
                    try { ectx.imageSmoothingEnabled = false; } catch (e) {}

                    // Helper: fetch area index for coord
                    const coordKey = (c,r) => `${c},${r}`;
                    const getAreaIndex = (c,r) => {
                        const key = coordKey(c,r);
                        if (scene._tileCoordToIndex && scene._tileCoordToIndex.has(key)) return scene._tileCoordToIndex.get(key);
                        // fallback: search mapping array
                        if (Array.isArray(scene._tileIndexToCoord)) {
                            for (let i = 0; i < scene._tileIndexToCoord.length; i++) {
                                const entry = scene._tileIndexToCoord[i];
                                if (entry && entry.col === c && entry.row === r) return i;
                            }
                        }
                        return null;
                    };

                    // Helper: composite multi-frame stacks
                    const buildFrame = (anim, idx, multi) => {
                        const tmp = document.createElement('canvas');
                        tmp.width = slice; tmp.height = slice;
                        const tctx = tmp.getContext('2d');
                        try { tctx.imageSmoothingEnabled = false; } catch (e) {}
                        const list = (Array.isArray(multi) && multi.length > 0) ? multi : [idx];
                        for (const fi of list) {
                            try {
                                const src = (anim && typeof scene.currentSprite.getFrame === 'function') ? scene.currentSprite.getFrame(anim, fi) : null;
                                if (src) tctx.drawImage(src, 0, 0);
                            } catch (e) { /* ignore per-frame */ }
                        }
                        return tmp;
                    };

                    for (const t of activeTiles) {
                        const idx = getAreaIndex(t.col, t.row);
                        const binding = (Number.isFinite(idx) && Array.isArray(scene._areaBindings)) ? scene._areaBindings[idx] : null;
                        const anim = (binding && binding.anim) ? binding.anim : scene.selectedAnimation;
                        const frameIndex = (binding && typeof binding.index === 'number') ? binding.index : scene.selectedFrame;
                        const multiFrames = (binding && Array.isArray(binding.multiFrames)) ? binding.multiFrames : null;
                        const frameCanvas = (anim !== null) ? buildFrame(anim, frameIndex, multiFrames) : null;
                        if (!frameCanvas) continue;
                        const transform = (Number.isFinite(idx) && Array.isArray(scene._areaTransforms)) ? scene._areaTransforms[idx] : null;
                        const hasTransform = !!(transform && ((transform.rot || 0) !== 0 || transform.flipH));
                        const dx = (t.col - minC) * slice;
                        const dy = (t.row - minR) * slice;
                        if (!hasTransform) {
                            try { ectx.drawImage(frameCanvas, 0, 0, frameCanvas.width, frameCanvas.height, dx, dy, slice, slice); } catch (e) { /* ignore */ }
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

                    // Build extra metadata for tilesheet export
                    exportCanvas._tilesheetMeta = {
                        slice,
                        minCol: minC,
                        minRow: minR,
                        cols: spanCols,
                        rows: spanRows,
                        activeTiles: activeTiles.map(t => ({ col: t.col, row: t.row })),
                        bindings: (() => {
                            const arr = [];
                            for (const t of activeTiles) {
                                const idx = getAreaIndex(t.col, t.row);
                                const binding = (Number.isFinite(idx) && Array.isArray(scene._areaBindings)) ? scene._areaBindings[idx] : null;
                                const fallbackAnim = String(scene.selectedAnimation || 'anim0');
                                const fallbackIndex = Number.isFinite(Number(scene.selectedFrame)) ? (Number(scene.selectedFrame) | 0) : 0;
                                const anim = (binding && binding.anim !== undefined) ? String(binding.anim) : fallbackAnim;
                                const index = (binding && binding.index !== undefined && Number.isFinite(Number(binding.index))) ? (Number(binding.index) | 0) : fallbackIndex;
                                const entry = { col: t.col, row: t.row, anim, index };
                                if (Array.isArray(binding.multiFrames) && binding.multiFrames.length > 0) entry.multiFrames = binding.multiFrames.slice();
                                const transform = (Number.isFinite(idx) && Array.isArray(scene._areaTransforms)) ? scene._areaTransforms[idx] : null;
                                if (transform && ((transform.rot||0)!==0 || transform.flipH)) entry.transform = { rot: transform.rot||0, flipH: !!transform.flipH };
                                arr.push(entry);
                            }
                            return arr;
                        })()
                    };
                } catch (err) { console.warn('tilesheet export build failed', err); }
            } else {
                // Original spritesheet export: optionally merge layered groups for the current animation
                try {
                    if (exportFormat === 'gif' && gifAnimationName && this.sprite && this.sprite._frames && this.sprite._frames.has(gifAnimationName)) {
                        const slice = (this.sprite && this.sprite.slicePx) ? this.sprite.slicePx : 16;
                        const arr = this.sprite._frames.get(gifAnimationName) || [];
                        let logicalCount = 0;
                        for (let i = 0; i < arr.length; i++) {
                            const e = arr[i];
                            if (!e || e.__groupStart || e.__groupEnd) continue;
                            logicalCount++;
                        }
                        logicalCount = Math.max(1, logicalCount);
                        exportCanvas = document.createElement('canvas');
                        exportCanvas.width = logicalCount * slice;
                        exportCanvas.height = slice;
                        const ectx = exportCanvas.getContext('2d');
                        try { ectx.imageSmoothingEnabled = false; } catch (e) {}
                        for (let li = 0; li < logicalCount; li++) {
                            try {
                                const src = (typeof this.sprite.getFrame === 'function') ? this.sprite.getFrame(gifAnimationName, li) : null;
                                if (src) ectx.drawImage(src, li * slice, 0, slice, slice);
                            } catch (e) { /* ignore frame draw */ }
                        }
                    }

                    const anim = (this.scene && this.scene.selectedAnimation) ? this.scene.selectedAnimation : null;
                    const framesArr = (this.sprite && this.sprite._frames && anim) ? (this.sprite._frames.get(anim) || []) : [];
                    const groups = this._getFrameGroups(anim);
                    const hasLayered = Array.isArray(groups) && groups.some(g => !!g.layered);
                    if (!exportCanvas && anim && framesArr.length > 0 && hasLayered) {
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

            if (exportMode === 'tiled') {
                const tiles = exportCanvas && exportCanvas._tilesheetMeta ? exportCanvas._tilesheetMeta : null;
                if (!tiles || !exportCanvas) {
                    alert('Unable to build tiled export data from current map.');
                    return;
                }

                const baseInput = this._basenameFromPath(filename);
                const baseName = this._stripExtension(baseInput) || defaultName || 'map';
                const mapFileName = baseName + '.tmx';
                const tilesetFileName = baseName + '.tsx';
                const imageFileName = baseName + '.png';
                const zipFileName = baseName + '.zip';

                const pngBlob = await new Promise((res) => exportCanvas.toBlob((b) => res(b), 'image/png'));
                if (!pngBlob) {
                    alert('Failed to create tileset PNG for TMX export.');
                    return;
                }

                const width = tiles.cols | 0;
                const height = tiles.rows | 0;
                const slice = tiles.slice | 0;
                const gidGrid = new Array(Math.max(1, width * height)).fill(0);
                const bindByLocal = new Map();
                for (const b of (Array.isArray(tiles.bindings) ? tiles.bindings : [])) {
                    if (!b) continue;
                    const lc = (Number(b.col) | 0) - (tiles.minCol | 0);
                    const lr = (Number(b.row) | 0) - (tiles.minRow | 0);
                    if (lc < 0 || lr < 0 || lc >= width || lr >= height) continue;
                    const localId = lr * width + lc;
                    bindByLocal.set(localId, b);
                }
                for (const t of (Array.isArray(tiles.activeTiles) ? tiles.activeTiles : [])) {
                    if (!t) continue;
                    const lc = (Number(t.col) | 0) - (tiles.minCol | 0);
                    const lr = (Number(t.row) | 0) - (tiles.minRow | 0);
                    if (lc < 0 || lr < 0 || lc >= width || lr >= height) continue;
                    const localId = lr * width + lc;
                    gidGrid[localId] = localId + 1;
                }

                const tileEntries = Array.from(bindByLocal.entries()).sort((a, b) => a[0] - b[0]);
                const tsxTileLines = tileEntries.map(([id, b]) => {
                    const props = [];
                    props.push(`<property name="source_anim" value="${this._xmlEscape(b.anim || '')}"/>`);
                    props.push(`<property name="source_index" type="int" value="${Number.isFinite(Number(b.index)) ? (Number(b.index) | 0) : 0}"/>`);
                    if (Array.isArray(b.multiFrames) && b.multiFrames.length > 0) {
                        props.push(`<property name="source_multiFrames" value="${this._xmlEscape(JSON.stringify(b.multiFrames.map(n => Number(n) | 0)))}"/>`);
                    }
                    if (b.transform && (b.transform.rot || b.transform.flipH)) {
                        props.push(`<property name="source_rot" type="int" value="${Number(b.transform.rot || 0) | 0}"/>`);
                        props.push(`<property name="source_flipH" type="bool" value="${b.transform.flipH ? 'true' : 'false'}"/>`);
                    }
                    return `  <tile id="${id}">\n    <properties>\n      ${props.join('\n      ')}\n    </properties>\n  </tile>`;
                }).join('\n');

                const tsx = [
                    '<?xml version="1.0" encoding="UTF-8"?>',
                    `<tileset version="1.10" tiledversion="1.11.0" name="${this._xmlEscape(baseName)}" tilewidth="${slice}" tileheight="${slice}" tilecount="${width * height}" columns="${width}">`,
                    `  <image source="${this._xmlEscape(imageFileName)}" width="${width * slice}" height="${height * slice}"/>`,
                    tsxTileLines,
                    '</tileset>'
                ].filter(Boolean).join('\n');

                const csvRows = [];
                for (let r = 0; r < height; r++) {
                    const row = [];
                    for (let c = 0; c < width; c++) row.push(gidGrid[r * width + c] || 0);
                    csvRows.push(row.join(','));
                }
                const csvData = '\n' + csvRows.join(',\n') + '\n';

                const spriteLayer = this.scene && typeof this.scene._normalizeSpriteLayerState === 'function'
                    ? this.scene._normalizeSpriteLayerState()
                    : null;
                const spriteEntities = [];
                if (spriteLayer && spriteLayer.entities) {
                    const order = Array.isArray(spriteLayer.order) ? spriteLayer.order.slice() : Object.keys(spriteLayer.entities);
                    for (const id of order) {
                        const e = spriteLayer.entities[id];
                        if (!e) continue;
                        const col = Number(e.col);
                        const row = Number(e.row);
                        if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
                        spriteEntities.push({ id, col: col | 0, row: row | 0, anim: e.anim || '', fps: e.fps, parentAnim: e.parentAnim || '' });
                    }
                }
                let objectId = 1;
                const objLines = spriteEntities.map((s) => {
                    const x = (s.col - (tiles.minCol | 0)) * slice;
                    const y = (s.row - (tiles.minRow | 0) + 1) * slice;
                    const propParts = [
                        `<property name="anim" value="${this._xmlEscape(s.anim)}"/>`,
                        Number.isFinite(Number(s.fps)) ? `<property name="fps" type="float" value="${Number(s.fps)}"/>` : '',
                        s.parentAnim ? `<property name="parentAnim" value="${this._xmlEscape(s.parentAnim)}"/>` : ''
                    ].filter(Boolean).join('\n        ');
                    return `    <object id="${objectId++}" name="sprite" type="sprite" x="${x}" y="${y}" width="${slice}" height="${slice}">\n      <properties>\n        ${propParts}\n      </properties>\n    </object>`;
                }).join('\n');

                const tmx = [
                    '<?xml version="1.0" encoding="UTF-8"?>',
                    `<map version="1.10" tiledversion="1.11.0" orientation="orthogonal" renderorder="right-down" width="${width}" height="${height}" tilewidth="${slice}" tileheight="${slice}" infinite="0" nextlayerid="3" nextobjectid="${Math.max(1, objectId)}">`,
                    `  <tileset firstgid="1" source="${this._xmlEscape(tilesetFileName)}"/>`,
                    `  <layer id="1" name="Tile Layer 1" width="${width}" height="${height}">`,
                    `    <data encoding="csv">${csvData}    </data>`,
                    '  </layer>',
                    objLines ? `  <objectgroup id="2" name="Sprites">\n${objLines}\n  </objectgroup>` : '',
                    '</map>'
                ].filter(Boolean).join('\n');

                let zipBlob = null;
                try {
                    const JSZip = await this._getJsZipCtor();
                    const archive = new JSZip();
                    archive.file(mapFileName, tmx);
                    archive.file(tilesetFileName, tsx);
                    archive.file(imageFileName, pngBlob);

                    // Include sprite-only animations referenced by sprite entities so they round-trip.
                    const spriteManifest = { version: 1, slice, animations: [] };
                    const spriteAnimNames = Array.from(new Set(spriteEntities
                        .map((s) => String((s && s.anim) || '').trim())
                        .filter(Boolean)));
                    for (const animName of spriteAnimNames) {
                        const getCount = () => {
                            if (this.scene && typeof this.scene._getAnimationLogicalFrameCount === 'function') {
                                try { return Math.max(0, Number(this.scene._getAnimationLogicalFrameCount(animName)) | 0); } catch (e) {}
                            }
                            const arr = (this.sprite && this.sprite._frames) ? (this.sprite._frames.get(animName) || []) : [];
                            return Math.max(0, arr.length | 0);
                        };
                        const frameCount = getCount();
                        if (frameCount <= 0) continue;
                        const frameFiles = [];
                        for (let i = 0; i < frameCount; i++) {
                            const src = (this.sprite && typeof this.sprite.getFrame === 'function') ? this.sprite.getFrame(animName, i) : null;
                            if (!src) continue;
                            const fc = document.createElement('canvas');
                            fc.width = slice;
                            fc.height = slice;
                            const fctx = fc.getContext('2d');
                            try { fctx.imageSmoothingEnabled = false; } catch (e) {}
                            try { fctx.drawImage(src, 0, 0, slice, slice); } catch (e) {}
                            const fb = await new Promise((res) => fc.toBlob((b) => res(b), 'image/png'));
                            if (!fb) continue;
                            const safeAnim = encodeURIComponent(animName);
                            const fn = `${baseName}__sprite__${safeAnim}__${i}.png`;
                            archive.file(fn, fb);
                            frameFiles.push(fn);
                        }
                        if (frameFiles.length > 0) {
                            const profile = (spriteLayer && spriteLayer.animationProfiles && spriteLayer.animationProfiles[animName]) ? spriteLayer.animationProfiles[animName] : null;
                            spriteManifest.animations.push({
                                name: animName,
                                fps: Number.isFinite(Number(profile && profile.fps)) ? Number(profile.fps) : null,
                                parentAnim: profile && profile.parent ? String(profile.parent) : '',
                                frames: frameFiles
                            });
                        }
                    }
                    if (spriteManifest.animations.length > 0) {
                        archive.file(baseName + '.sprites.json', JSON.stringify(spriteManifest, null, 2));
                    }

                    zipBlob = await archive.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
                } catch (e) {
                    console.warn('Failed to build tiled ZIP package', e);
                    alert('Failed to build ZIP package for Tiled export.');
                    return;
                }

                if (window.showSaveFilePicker) {
                    try {
                        const zipHandle = await window.showSaveFilePicker({ suggestedName: zipFileName, types: [{ description: 'ZIP Archive', accept: { 'application/zip': ['.zip'] } }] });
                        const zipWritable = await zipHandle.createWritable();
                        await zipWritable.write(zipBlob);
                        await zipWritable.close();
                        return;
                    } catch (e) {
                        console.warn('tiled export save picker canceled/failed', e);
                    }
                }

                const zipUrl = URL.createObjectURL(zipBlob);
                const zipAnchor = document.createElement('a');
                zipAnchor.href = zipUrl;
                zipAnchor.download = zipFileName;
                document.body.appendChild(zipAnchor);
                zipAnchor.click();
                setTimeout(() => {
                    try { URL.revokeObjectURL(zipUrl); } catch (e) {}
                    try { zipAnchor.remove(); } catch (e) {}
                }, 1600);
                return;
            }

            const sourceCanvas = exportCanvas || sheet || (this.sprite && this.sprite.sheet ? this.sprite.sheet : null);
            let encodeCanvas = sourceCanvas;
            if (encodeCanvas && upscaleMultiplier > 1 && exportMode !== 'tiled' && (exportFormat === 'png' || exportFormat === 'gif')) {
                const up = document.createElement('canvas');
                up.width = Math.max(1, (encodeCanvas.width | 0) * upscaleMultiplier);
                up.height = Math.max(1, (encodeCanvas.height | 0) * upscaleMultiplier);
                const uctx = up.getContext('2d');
                try { uctx.imageSmoothingEnabled = false; } catch (e) {}
                try { uctx.drawImage(encodeCanvas, 0, 0, up.width, up.height); } catch (e) {}
                encodeCanvas = up;
            }

            let blob = await canvasToBlobByFormat(encodeCanvas, exportFormat);
            if (!blob && exportFormat === 'gif') {
                alert('GIF encoding is not supported in this browser. Please use PNG or JPEG.');
                return;
            }
            if (!blob) {
                const c = document.createElement('canvas');
                c.width = 1; c.height = 1;
                blob = await canvasToBlobByFormat(c, 'png');
            }
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
                    // tile layout metadata when exporting tilesheet
                    const tiles = exportCanvas && exportCanvas._tilesheetMeta ? exportCanvas._tilesheetMeta : null;
                    if (tiles) {
                        meta.tileLayout = {
                            tilemode: true,
                            slicePx: tiles.slice,
                            minCol: tiles.minCol,
                            minRow: tiles.minRow,
                            cols: tiles.cols,
                            rows: tiles.rows,
                            activeTiles: Array.isArray(tiles.activeTiles) ? tiles.activeTiles.map(t => ({ col: t.col, row: t.row })) : [],
                            bindings: Array.isArray(tiles.bindings) ? tiles.bindings.map(b => ({
                                col: b.col,
                                row: b.row,
                                anim: b.anim,
                                index: b.index,
                                multiFrames: Array.isArray(b.multiFrames) ? b.multiFrames.slice() : undefined,
                                transform: b.transform ? { rot: b.transform.rot||0, flipH: !!b.transform.flipH } : undefined
                            })) : []
                        };
                    }
                } catch (e) { /* ignore */ }
                return meta;
            };

            const metaObj = buildMetadata();
            const metaStr = JSON.stringify(metaObj, null, 2);
            const metaBlob = new Blob([metaStr], { type: 'application/json' });
            const imageExt = extensionForFormat(exportFormat).replace('.', '\\.');
            const metaFilename = chosenMetaFilename || ((filename && new RegExp(imageExt + '$', 'i').test(filename)) ? filename.replace(new RegExp(imageExt + '$', 'i'), '.json') : (filename + '.json'));

            // Use File System Access API when available to save PNG and optionally metadata
            if (window.showSaveFilePicker){
                try{
                    const saveMime = exportFormat === 'jpeg' ? 'image/jpeg' : (exportFormat === 'gif' ? 'image/gif' : 'image/png');
                    const saveExt = exportFormat === 'jpeg' ? '.jpg' : (exportFormat === 'gif' ? '.gif' : '.png');
                    const saveDesc = exportFormat === 'jpeg' ? 'JPEG Image' : (exportFormat === 'gif' ? 'GIF Image' : 'PNG Image');
                    const handle = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: saveDesc, accept: { [saveMime]: [saveExt] } }] });
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

            // fallback: anchor download for image then metadata JSON
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
            this._importInput.accept = 'image/*,.zip,.tmx,.tsx,.xml,text/xml,application/xml,application/zip';
            this._importInput.multiple = true;
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

        // Absorb input when cursor is over FrameSelect UI so map/tile tools don't also process click/drag.
        try {
            const p = this.mouse && this.mouse.pos ? this.mouse.pos : null;
            if (p) {
                const overLeftMenu = Geometry.pointInRect(p, this.menu.pos, this.menu.size);
                const outerPos = new Vector(1920-this._previewBuffer*3-this._previewSize, this._previewBuffer);
                const rightPanelSize = new Vector(this._previewSize + this._previewBuffer * 2, 1080 - this._previewBuffer);
                const overRightPanel = Geometry.pointInRect(p, outerPos, rightPanelSize);
                const interacting = this.mouse.pressed('left') || this.mouse.held('left') || this.mouse.pressed('right') || this.mouse.held('right');
                if ((overLeftMenu || overRightPanel) && interacting) {
                    this.mouse.addMask(1);
                }
            }
        } catch (e) {}

        // active group (id of last-clicked group slot)
        if (typeof this._activeGroup === 'undefined') this._activeGroup = null;

        // clamp sidebar frame-slot scrolling to content bounds
        const animForScroll = (this.scene && this.scene.selectedAnimation) ? this.scene.selectedAnimation : null;
        const framesForScroll = (this.sprite && this.sprite._frames && animForScroll) ? (this.sprite._frames.get(animForScroll) || []) : [];
        let slotCount = 1; // keep at least the trailing "add" slot
        try {
            const groupsForScroll = this._getFrameGroups(animForScroll);
            for (const g of groupsForScroll){ g.firstIndex = Math.min.apply(null, g.indices); }
            slotCount = 0;
            for (let i = 0; i < framesForScroll.length; i++){
                const groupAtFirst = groupsForScroll.find(g => g.firstIndex === i);
                if (groupAtFirst){
                    slotCount++; // group slot row
                    if (groupAtFirst.collapsed){
                        i = Math.max.apply(null, groupAtFirst.indices);
                        continue;
                    }
                }
                slotCount++; // frame slot row
            }
            slotCount++; // add slot row
        } catch (e) {
            slotCount = Math.max(1, (framesForScroll.length || 0) + 1);
        }

        const slotStartY = 100;
        const slotStepY = 200; // 180 + 20
        const slotHeight = 190;
        const viewportTop = (this.menu && this.menu.pos) ? this.menu.pos.y : 0;
        const viewportBottom = viewportTop + ((this.menu && this.menu.size) ? this.menu.size.y : 1080);
        const contentBottom = slotStartY + Math.max(0, slotCount - 1) * slotStepY + slotHeight;
        const minScroll = Math.min(0, viewportBottom - contentBottom);

        if(this.mouse.pos.x <= 200){
            let scrollDelta = this.mouse.wheel()
            this.scrollPos -= scrollDelta
        }
        if(this.scrollPos > 0) this.scrollPos = 0
        if(this.scrollPos < minScroll) this.scrollPos = minScroll
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
                try {
                    if (this.scene && typeof this.scene._getSpriteAnimationFps === 'function') {
                        this._animFps = this.scene._getSpriteAnimationFps(anim, this._animFps || 8);
                        if (this.menu && this.menu.elements && this.menu.elements.get('fpsSlider')) {
                            this.menu.elements.get('fpsSlider').value = this._animFps;
                        }
                    }
                } catch (e) {}
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
                            let handledConnectionToggle = false;
                            const currentSel = (this.scene && typeof this.scene.selectedFrame === 'number') ? this.scene.selectedFrame : null;

                            // When switching to a different frame with a normal left click,
                            // pause mouse input so this same press doesn't also toggle connections.
                            if (this.mouse.released('left') && !this.keys.held('Shift') && !this.mouse.held('right') && currentSel !== i) {
                                if (this._multiSelected && this._multiSelected.size > 0) this._multiSelected.clear();
                                if (this.scene) this.scene.selectedFrame = i;
                                try { this.scene && this.scene.sfx && this.scene.sfx.play('frame.select'); } catch (e) {}
                                try { if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause(); } catch (e) {}
                                handledConnectionToggle = true;
                            }

                            if (!handledConnectionToggle && this.mouse.released('left')) {
                                const part = this._hitFrameConnection(pos, this.mouse.pos);
                                if (part !== -1) {
                                    this._toggleFrameConnection(anim, i, part);
                                    if (this.scene) this.scene.selectedFrame = i;
                                    try { this.scene && this.scene.sfx && this.scene.sfx.play('frame.select'); } catch (e) {}
                                    handledConnectionToggle = true;
                                }
                            }
                            if (!handledConnectionToggle) {
                                if (this.keys.held('Shift')&& !this.mouse.held('right')) {
                                    if (this._multiSelected.has(i)) this._multiSelected.delete(i);
                                    else this._multiSelected.add(i);
                                } else {
                                    if (this._multiSelected && this._multiSelected.size > 0 && !this.mouse.held('right')) this._multiSelected.clear();
                                    if (this.scene) this.scene.selectedFrame = i;
                                    try { this.scene && this.scene.sfx && this.scene.sfx.play('frame.select'); } catch (e) {}
                                }
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
                            this._ensureAnimationListed(anim);
                            this.sprite.insertFrame(anim);
                            if (this.scene) this.scene.selectedFrame = framesArr.length;
                            try { this.scene && this.scene.sfx && this.scene.sfx.play('frame.select'); } catch (e) {}
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
                                this._ensureAnimationListed(anim);
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
                            try { this.scene && this.scene.sfx && this.scene.sfx.play('frame.merge'); } catch (e) {}
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
                        try { this.scene && this.scene.sfx && this.scene.sfx.play('frame.delete'); } catch (e) {}
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
                                            this._ensureAnimationListed(anim);
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
                                try { this.scene && this.scene.sfx && this.scene.sfx.play('frame.duplicate'); } catch (e) {}
                                try { if (this.mouse && typeof this.mouse.addMask === 'function') this.mouse.addMask(1); } catch(e){}
                            } else {
                                // fallback: duplicate single selected frame (existing behavior)
                                const sel = (this.scene && typeof this.scene.selectedFrame === 'number') ? this.scene.selectedFrame : null;
                                if (sel !== null && sel !== undefined && sel >= 0 && sel < arr.length) {
                                    try {
                                        const src = this.sprite.getFrame(anim, sel);
                                        if (src && typeof this.sprite.insertFrame === 'function') {
                                            this._ensureAnimationListed(anim);
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
                                            try { this.scene && this.scene.sfx && this.scene.sfx.play('frame.duplicate'); } catch (e) {}
                                        } else if (src) {
                                            const clone = document.createElement('canvas');
                                            clone.width = this.sprite.slicePx || (src ? src.width : 16);
                                            clone.height = this.sprite.slicePx || (src ? src.height : 16);
                                            const ctx = clone.getContext('2d');
                                            ctx.drawImage(src, 0, 0);
                                            arr.splice(sel + 1, 0, clone);
                                            if (typeof this.sprite._rebuildSheetCanvas === 'function') this.sprite._rebuildSheetCanvas();
                                            if (this.scene) this.scene.selectedFrame = sel + 1;
                                            try { this.scene && this.scene.sfx && this.scene.sfx.play('frame.duplicate'); } catch (e) {}
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
                                    try { this.scene && this.scene.sfx && this.scene.sfx.play('frame.move'); } catch (e) {}
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
                                        try { this.scene && this.scene.sfx && this.scene.sfx.play('frame.move'); } catch (e) {}
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
                                    try { this.scene && this.scene.sfx && this.scene.sfx.play('frame.move'); } catch (e) {}
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
                                    try { this.scene && this.scene.sfx && this.scene.sfx.play('frame.move'); } catch (e) {}
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
                                        try { this.scene && this.scene.sfx && this.scene.sfx.play('frame.move'); } catch (e) {}
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
                                    for (const orig of originals) {
                                        const ni = arr.indexOf(orig);
                                        if (ni !== -1) this._multiSelected.add(ni);
                                    }
                                    if (this.scene) this.scene.selectedFrame = Math.min(...Array.from(this._multiSelected));
                                    try { this.scene && this.scene.sfx && this.scene.sfx.play('frame.move'); } catch (e) {}
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
            const listY = contentPos.y + contentSize.y + 8 + this._listYOffset;
            const rowH = 28;
            const names = (this._rightListMode === 'layers')
                ? ((this.scene && typeof this.scene.getLayerNames === 'function') ? this.scene.getLayerNames(this._resolveLayerListType()) : [])
                : this._getAnimationNames();
            if (this.mouse && this.mouse.released && this.mouse.released('left')){
                const btnY = listY - 34;
                const btnGap = 6;
                const btnW = Math.floor((contentSize.x - btnGap) / 2);
                const btnH = 24;
                const animBtnPos = new Vector(listX, btnY);
                const layerBtnPos = new Vector(listX + btnW + btnGap, btnY);
                const btnSize = new Vector(btnW, btnH);

                if (Geometry.pointInRect(this.mouse.pos, animBtnPos, btnSize)) {
                    this._rightListMode = 'animations';
                    try { if (this.mouse && typeof this.mouse.addMask === 'function') this.mouse.addMask(1); } catch (e) {}
                    return;
                }
                if (Geometry.pointInRect(this.mouse.pos, layerBtnPos, btnSize)) {
                    this._rightListMode = 'layers';
                    try { if (this.mouse && typeof this.mouse.addMask === 'function') this.mouse.addMask(1); } catch (e) {}
                    return;
                }

                // iterate rows
                for (let i = 0; i < names.length; i++){
                    const name = names[i];
                    const ry = listY + i * rowH;
                    const rpos = new Vector(listX, ry);
                    const rsize = new Vector(contentSize.x, rowH - 2);
                    if (Geometry.pointInRect(this.mouse.pos, rpos, rsize)){
                        // determine button hit areas (right side)
                        const visRect = new Vector(rpos.x + rsize.x - 120, rpos.y + 4);
                        const visSize = new Vector(36, rsize.y - 8);
                        const renameRect = new Vector(rpos.x + rsize.x - 80, rpos.y + 4);
                        const renameSize = new Vector(36, rsize.y - 8);
                        const removeRect = new Vector(rpos.x + rsize.x - 40, rpos.y + 4);
                        const removeSize = new Vector(36, rsize.y - 8);
                        if (this._rightListMode === 'layers' && Geometry.pointInRect(this.mouse.pos, visRect, visSize)) {
                            try {
                                const layerType = this._resolveLayerListType();
                                if (this.scene && typeof this.scene.cycleLayerVisibility === 'function') {
                                    this.scene.cycleLayerVisibility(layerType, i);
                                }
                            } catch (e) {}
                        } else if (Geometry.pointInRect(this.mouse.pos, renameRect, renameSize)){
                            if (this._rightListMode === 'layers') {
                                try {
                                    const layerType = this._resolveLayerListType();
                                    const nextName = window.prompt('Rename layer', String(name || ''));
                                    if (nextName !== null && this.scene && typeof this.scene.renameLayer === 'function') {
                                        this.scene.renameLayer(layerType, i, nextName);
                                    }
                                } catch (e) {}
                            } else {
                                this._spawnTextInputFor(name);
                            }
                        } else if (Geometry.pointInRect(this.mouse.pos, removeRect, removeSize)){
                            if (this._rightListMode === 'layers') {
                                try {
                                    const layerType = this._resolveLayerListType();
                                    if (this.scene && typeof this.scene.removeLayer === 'function') {
                                        this.scene.removeLayer(layerType, i);
                                    }
                                } catch (e) {}
                            } else {
                                this.removeAnimation(name);
                            }
                        } else {
                            if (this._rightListMode === 'layers') {
                                try {
                                    const layerType = this._resolveLayerListType();
                                    if (this.scene && typeof this.scene.setActiveLayerIndex === 'function') {
                                        this.scene.setActiveLayerIndex(layerType, i);
                                    }
                                } catch (e) {}
                            } else {
                                const shiftHeld = !!(this.keys && this.keys.held && this.keys.held('Shift'));
                                if (shiftHeld) {
                                    if (this.scene && typeof this.scene._setSpritePlacementAnimation === 'function') this.scene._setSpritePlacementAnimation(name);
                                    else if (this.scene) this.scene.selectedSpriteAnimation = name;
                                } else {
                                    // select animation
                                    if (this.scene) this.scene.selectedAnimation = name;
                                    // clear any multi-frame selection when switching animations
                                    if (this._multiSelected && this._multiSelected.size > 0) this._multiSelected.clear();
                                    // materialize frames for the selected animation (lazy-load)
                                    try { if (this.sprite && typeof this.sprite._materializeAnimation === 'function') this.sprite._materializeAnimation(name); } catch(e) {}
                                }
                            }
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
                    if (this._rightListMode === 'layers') {
                        try {
                            const layerType = this._resolveLayerListType();
                            if (this.scene && typeof this.scene.addLayer === 'function') this.scene.addLayer(layerType);
                        } catch (e) {}
                    } else {
                        this.addAnimation();
                    }
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
                                const src = this._getPreviewFrameCanvas(anim, idx);
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
                                                const src = this._getPreviewFrameCanvas(anim, idx);
                                                if (src) tctx.drawImage(src, 0, 0);
                                            } catch (e) {}
                                        }
                                        this.UIDraw.image(tmp, contentPos, contentSize, null, 0, 1, false);
                                    } catch (e) {
                                        // fallback to drawing the selected frame
                                        const fr = this._getPreviewFrameCanvas(anim, sel);
                                        if (fr) this.UIDraw.image(fr, contentPos, contentSize, null, 0, 1, false);
                                        else this.UIDraw.sheet(this.sprite, contentPos, contentSize, anim, sel);
                                    }
                                } else {
                                    // simple case: draw the selected frame directly
                                    const fr = this._getPreviewFrameCanvas(anim, sel);
                                    if (fr) this.UIDraw.image(fr, contentPos, contentSize, null, 0, 1, false);
                                    else this.UIDraw.sheet(this.sprite, contentPos, contentSize, anim, sel);
                                }
                            } catch (e) {
                                // if anything goes wrong, fall back to the normal sequence logic below
                                const seqIndex = Math.max(0, Math.min(this._animIndex, seqLen - 1));
                                const entry = framesSeq[seqIndex];
                                if (entry.type === 'frame') {
                                    const fr = this._getPreviewFrameCanvas(anim, entry.index);
                                    if (fr) this.UIDraw.image(fr, contentPos, contentSize, null, 0, 1, false);
                                    else this.UIDraw.sheet(this.sprite, contentPos, contentSize, anim, entry.index);
                                } else if (entry.type === 'group') {
                                    try {
                                        const px = (this.sprite && this.sprite.slicePx) ? this.sprite.slicePx : 16;
                                        const tmp = document.createElement('canvas'); tmp.width = px; tmp.height = px;
                                        const tctx = tmp.getContext('2d'); tctx.clearRect(0,0,px,px);
                                        for (const idx of entry.group.indices) {
                                            try {
                                                const src = this._getPreviewFrameCanvas(anim, idx);
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
                                const fr = this._getPreviewFrameCanvas(anim, entry.index);
                                if (fr) this.UIDraw.image(fr, contentPos, contentSize, null, 0, 1, false);
                                else this.UIDraw.sheet(this.sprite, contentPos, contentSize, anim, entry.index);
                            } else if (entry.type === 'group') {
                                // draw composited layered preview
                                try {
                                    const px = (this.sprite && this.sprite.slicePx) ? this.sprite.slicePx : 16;
                                    const tmp = document.createElement('canvas'); tmp.width = px; tmp.height = px;
                                    const tctx = tmp.getContext('2d'); tctx.clearRect(0,0,px,px);
                                    for (const idx of entry.group.indices) {
                                        try {
                                            const src = this._getPreviewFrameCanvas(anim, idx);
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
            const listY = contentPos.y + contentSize.y + 8 + this._listYOffset;
            const rowH = 28;
            const listLayerType = this._resolveLayerListType();
            const names = (this._rightListMode === 'layers')
                ? ((this.scene && typeof this.scene.getLayerNames === 'function') ? this.scene.getLayerNames(listLayerType) : [])
                : this._getAnimationNames();

            const btnY = listY - 34;
            const btnGap = 6;
            const btnW = Math.floor((contentSize.x - btnGap) / 2);
            const btnH = 24;
            const animBtnPos = new Vector(listX, btnY);
            const layerBtnPos = new Vector(listX + btnW + btnGap, btnY);
            const btnSize = new Vector(btnW, btnH);
            const animActive = this._rightListMode === 'animations';
            const layerActive = this._rightListMode === 'layers';
            this.UIDraw.rect(animBtnPos, btnSize, animActive ? '#4477AA' : '#2B2B2B');
            this.UIDraw.text('Animations', new Vector(animBtnPos.x + btnSize.x / 2, animBtnPos.y + btnSize.y / 2 + 5), '#FFFFFF', 0, 12, { align: 'center', font: 'monospace' });
            this.UIDraw.rect(layerBtnPos, btnSize, layerActive ? '#4477AA' : '#2B2B2B');
            this.UIDraw.text('Layers', new Vector(layerBtnPos.x + btnSize.x / 2, layerBtnPos.y + btnSize.y / 2 + 5), '#FFFFFF', 0, 12, { align: 'center', font: 'monospace' });

            for (let i = 0; i < names.length; i++){
                const name = names[i];
                const ry = listY + i * rowH;
                const rpos = new Vector(listX, ry);
                const rsize = new Vector(contentSize.x, rowH - 2);
                // background
                const isSel = (this._rightListMode === 'layers')
                    ? ((this.scene && typeof this.scene.getActiveLayerIndex === 'function') ? (this.scene.getActiveLayerIndex(listLayerType) === i) : false)
                    : (this.scene && this.scene.selectedAnimation === name);
                this.UIDraw.rect(rpos, rsize, isSel ? '#333344' : '#222222');
                const isSpriteSel = !!(this.scene && this.scene.selectedSpriteAnimation === name);
                if (this._rightListMode !== 'layers' && isSpriteSel) this.UIDraw.rect(rpos, rsize, '#00AA6633');
                // name text
                this.UIDraw.text(String(name), new Vector(rpos.x + 8, rpos.y + rsize.y/2 + 6), '#FFFFFF', 0, 14, { align: 'left', baseline: 'middle', font: 'monospace' });
                // layer visibility button (layers mode only)
                const visPos = new Vector(rpos.x + rsize.x - 120, rpos.y + 4);
                const visSize = new Vector(36, rsize.y - 8);
                if (this._rightListMode === 'layers') {
                    let vis = 0;
                    try {
                        if (this.scene && typeof this.scene.getLayerVisibilityState === 'function') {
                            vis = this.scene.getLayerVisibilityState(listLayerType, i) | 0;
                        }
                    } catch (e) { vis = 0; }
                    const label = vis === 2 ? 'Off' : (vis === 1 ? 'On' : 'Dim');
                    const color = vis === 2 ? '#444444' : (vis === 1 ? '#4B8B4B' : '#6D6D6D');
                    this.UIDraw.rect(visPos, visSize, color);
                    this.UIDraw.text(label, new Vector(visPos.x + visSize.x/2, visPos.y + visSize.y/2 + 6), '#FFFFFF', 0, 12, { align: 'center', font: 'monospace' });
                }
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
            this.UIDraw.text(this._rightListMode === 'layers' ? 'Add Layer' : 'Add Animation', new Vector(addPos.x + addSize.x/2, addPos.y + addSize.y/2 + 6), '#FFFFFF', 0, 14, { align: 'center', font: 'monospace' });
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
                    if (anim) {
                        const fr = this._getPreviewFrameCanvas(anim, i);
                        if (fr) this.UIDraw.image(fr, new Vector(slotPos.x + 5, slotPos.y + 5), new Vector(180,180), null, 0, 1, false);
                        else this.UIDraw.sheet(this.sprite, new Vector(slotPos.x + 5, slotPos.y + 5), new Vector(180,180), anim, i);
                    }
                    const connKey = this._getFrameConnKey(anim, i);
                    this._drawFrameConnectionOverlay(slotPos, connKey);
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
                                    const src = this._getPreviewFrameCanvas(anim, idx);
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