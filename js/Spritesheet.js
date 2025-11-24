import Color from './Color.js';

export default class SpriteSheet{
    constructor(sheet,slicePx,animations = null){
        // `sheet` may be an Image or a Canvas. Internally we maintain per-animation
        // frame canvases in `_frames` and keep `this.sheet` as a packed canvas
        // produced by `_rebuildSheetCanvas()` so Draw.sheet can still be used.
        this.sheet = sheet;
        this.slicePx = slicePx;
        this._frames = new Map(); // animationName -> [canvas, ...]
    // materialization queue for incremental lazy-loading to avoid blocking
    // weak CPUs. Each entry: {animation, index}
    this._materializeQueue = [];
    this._materializeScheduled = false;
    // choose batch size based on hardwareConcurrency when available
    try { this._materializeBatch = Math.max(1, (navigator.hardwareConcurrency ? Math.max(1, Math.floor(navigator.hardwareConcurrency/2)) : 2)); } catch(e){ this._materializeBatch = 2; }
        if(animations){
            this.animations = animations;
        } else {
            this.animations = new Map();
        }
    }
    addAnimation(name,row,frameCount){
        // Only record the animation metadata (name/row/frameCount).
        // Do not create or modify any frame image data here; frame arrays
        // are managed separately by the importer/editor and by insert/pop.
        this.animations.set(name, { row: row, frameCount: frameCount });
    }
    removeAnimation(name){
        // Remove animation metadata and free any stored frame image data
        // to allow garbage collection. Editors that need to retain frames
        // should materialize/copy them first.
        try {
            this.disposeAnimation(name);
        } catch (e) {
            // fallback: at least remove metadata
            try { this.animations.delete(name); } catch (er) {}
        }
    }

    // Free resources for a specific animation (clear canvases/descriptors)
    disposeAnimation(name){
        try {
            // remove metadata
            try { this.animations.delete(name); } catch(e) {}
            if (!this._frames || !this._frames.has(name)) return true;
            const arr = this._frames.get(name) || [];
            for (let i = 0; i < arr.length; i++){
                const entry = arr[i];
                if (!entry) continue;
                if (entry.__lazy === true) {
                    // drop reference to source image/bitmap
                    try { entry.src = null; } catch(e) {}
                } else if (entry instanceof HTMLCanvasElement) {
                    try {
                        // clear canvas pixels and release memory where possible
                        entry.getContext('2d').clearRect(0,0,entry.width, entry.height);
                        // setting width/height to 0 helps some engines free backing store
                        entry.width = 0; entry.height = 0;
                    } catch(e) {}
                }
                // null out array slot to remove references
                arr[i] = null;
            }
            // remove the frames mapping
            try { this._frames.delete(name); } catch(e) {}
            // remove any queued materialization jobs for this animation
            try {
                if (this._materializeQueue && this._materializeQueue.length>0) {
                    this._materializeQueue = this._materializeQueue.filter(j => j.animation !== name);
                }
            } catch(e) {}
            // rebuild packed sheet (safe) to remove any stale visuals
            try { this._rebuildSheetCanvas(); } catch(e) {}
            return true;
        } catch (e) {
            console.warn('disposeAnimation failed', e);
            return false;
        }
    }

    // Dispose all animations/frames and clear the packed sheet
    disposeAll(){
        try {
            if (this._frames) {
                for (const name of Array.from(this._frames.keys())){
                    try { this.disposeAnimation(name); } catch(e) {}
                }
                try { this._frames.clear(); } catch(e) {}
            }
            try { this.animations.clear(); } catch(e) {}
            // replace sheet with a tiny cleared canvas
            const c = document.createElement('canvas');
            c.width = this.slicePx || 1; c.height = this.slicePx || 1;
            const ctx = c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height);
            this.sheet = c;
            // clear any pending materialization work
            try { this._materializeQueue = []; this._materializeScheduled = false; } catch(e) {}
        } catch (e) {
            console.warn('disposeAll failed', e);
        }
    }

    // Helper: rebuild the packed `this.sheet` canvas from `_frames` map and
    // update `this.animations` row/frameCount metadata.
    _rebuildSheetCanvas(force = false){
        try {
            const MAX_SHEET_WIDTH = 4096; // avoid creating extremely wide canvases that OOM on weak machines
            const animNames = Array.from(this._frames.keys());
            if (animNames.length === 0) {
                // no frames: create a minimal canvas
                const c = document.createElement('canvas');
                c.width = this.slicePx; c.height = this.slicePx;
                const ctx = c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height);
                this.sheet = c;
                return;
            }

            // compute max frames in any animation (use ragged arrays allowed)
            let maxFrames = 0;
            for (const name of animNames) {
                const arr = this._frames.get(name) || [];
                if (arr.length > maxFrames) maxFrames = arr.length;
            }

            const rows = animNames.length;
            const outW = Math.max(1, maxFrames) * this.slicePx;
            const outH = Math.max(1, rows) * this.slicePx;
            // If the computed width would exceed a safe maximum, avoid allocating a huge canvas.
            if (outW > MAX_SHEET_WIDTH && !force) {
                // mark packed sheet as dirty and set a small placeholder canvas.
                const c = document.createElement('canvas');
                c.width = Math.min(this.slicePx, MAX_SHEET_WIDTH);
                c.height = Math.min(this.slicePx, Math.max(1, rows) * this.slicePx);
                const ctx = c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height);
                this.sheet = c;
                this._packedDirty = true;
                console.warn('_rebuildSheetCanvas: skipped full pack due to excessive width', outW, 'px; set _packedDirty=true');
                return;
            }
            const out = document.createElement('canvas');
            out.width = outW; out.height = outH;
            const outCtx = out.getContext('2d');
            outCtx.clearRect(0,0,outW,outH);

            // draw each frame canvas into the appropriate cell
            for (let r = 0; r < animNames.length; r++) {
                const name = animNames[r];
                const arr = this._frames.get(name) || [];
                for (let f = 0; f < arr.length; f++) {
                    const src = arr[f];
                    if (!src) continue;
                    // if frame is a lazy descriptor, draw directly from its source
                    if (src.__lazy === true && src.src) {
                        try {
                            outCtx.drawImage(src.src, src.sx, src.sy, src.w, src.h, f * this.slicePx, r * this.slicePx, this.slicePx, this.slicePx);
                        } catch (e) {
                            // if drawImage with descriptor fails, skip (leave blank)
                        }
                    } else {
                        // assume it's a canvas-like object
                        outCtx.drawImage(src, f * this.slicePx, r * this.slicePx, this.slicePx, this.slicePx);
                    }
                }
                // update animations metadata
                if (!this.animations.has(name)) this.animations.set(name, { row: r, frameCount: arr.length });
                else {
                    const meta = this.animations.get(name) || {};
                    meta.row = r; meta.frameCount = arr.length; this.animations.set(name, meta);
                }
            }

            this.sheet = out;
            this._packedDirty = false;
        } catch (e) {
            console.warn('_rebuildSheetCanvas failed', e);
        }
    }

    // Ensure the packed sheet is available (force rebuild even if previously skipped)
    ensurePackedSheet(){
        try {
            // If we flagged packedDirty, rebuild again but allow larger canvases.
            if (this._packedDirty) {
                // attempt the full rebuild (force allow large canvas); if it still fails, leave packedDirty true
                try { this._packedDirty = false; this._rebuildSheetCanvas(true); } catch(e) { this._packedDirty = true; }
            }
        } catch (e) { console.warn('ensurePackedSheet failed', e); }
    }

    // Incrementally update a single frame in the packed `this.sheet` canvas
    // This avoids redrawing all frames when only one frame's pixels changed.
    _updatePackedFrame(animation, index){
        try {
            // if we don't have a packed canvas to update, fall back to full rebuild
            if (!this.sheet || !(this.sheet instanceof HTMLCanvasElement)) {
                this._rebuildSheetCanvas();
                return;
            }
            const animNames = Array.from(this._frames.keys());
            const row = animNames.indexOf(animation);
            if (row === -1) { this._rebuildSheetCanvas(); return; }

            const colsInSheet = Math.max(1, Math.floor(this.sheet.width / this.slicePx));
            // if the sheet layout doesn't have enough columns to place this index,
            // a full rebuild is required (frame counts changed)
            if (index >= colsInSheet) { this._rebuildSheetCanvas(); return; }

            const frameCanvas = this.getFrame(animation, index);
            if (!frameCanvas) return;

            const ctx = this.sheet.getContext('2d');
            const dstX = index * this.slicePx;
            const dstY = row * this.slicePx;
            // clear region and redraw the single frame
            ctx.clearRect(dstX, dstY, this.slicePx, this.slicePx);
            ctx.drawImage(frameCanvas, dstX, dstY, this.slicePx, this.slicePx);
            // metadata (row/frameCount) remains valid for modify-only operations
        } catch (e) {
            console.warn('_updatePackedFrame failed', e);
            // fallback to safe full rebuild
            try { this._rebuildSheetCanvas(); } catch (er) {}
        }
    }

    // Materialize a single frame entry (descriptor -> canvas) and return the canvas
    _materializeFrame(animation, index){
        try {
            if (!this._frames.has(animation)) return null;
            const arr = this._frames.get(animation);
            if (index < 0 || index >= arr.length) return null;
            const entry = arr[index];
            if (!entry) return null;
            if (entry.__lazy !== true) return entry; // already a canvas

            // create canvas and draw from the source descriptor
            const c = document.createElement('canvas');
            c.width = Math.max(1, Math.floor(entry.w || this.slicePx));
            c.height = Math.max(1, Math.floor(entry.h || this.slicePx));
            const ctx = c.getContext('2d');
            try {
                ctx.drawImage(entry.src, entry.sx || 0, entry.sy || 0, entry.w || this.slicePx, entry.h || this.slicePx, 0, 0, c.width, c.height);
            } catch (e) {
                // if draw fails, leave blank canvas
                console.warn('_materializeFrame draw failed', e);
            }
            // replace descriptor with actual canvas
            arr[index] = c;
            // update packed sheet cell for this frame
            try { this._updatePackedFrame(animation, index); } catch(e) {}
            return c;
        } catch (e) {
            console.warn('_materializeFrame failed', e);
            return null;
        }
    }

    // Materialize all frames for a given animation (useful when an animation is selected)
    _materializeAnimation(animation){
        try {
            if (!this._frames.has(animation)) return false;
            const arr = this._frames.get(animation);
            if (!arr || arr.length === 0) return false;
            // Materialize the first frame synchronously so preview can show immediately.
            for (let i = 0; i < arr.length; i++) {
                const entry = arr[i];
                if (!entry) continue;
                if (entry.__lazy === true) {
                    // materialize first available frame synchronously, then queue the rest
                    this._materializeFrame(animation, i);
                    // enqueue remaining frames (if any) for incremental processing
                    for (let j = i+1; j < arr.length; j++) {
                        const e2 = arr[j];
                        if (e2 && e2.__lazy === true) this._enqueueMaterialize(animation, j);
                    }
                    return true;
                }
            }
            return true;
        } catch (e) {
            console.warn('_materializeAnimation failed', e);
            return false;
        }
    }

    // Enqueue a materialization job and schedule processing if not already scheduled
    _enqueueMaterialize(animation, index){
        try {
            this._materializeQueue.push({ animation: animation, index: index });
            if (!this._materializeScheduled) {
                this._materializeScheduled = true;
                // use requestAnimationFrame to spread work across frames
                const process = () => { this._processMaterializeQueue(); };
                try { requestAnimationFrame(process); } catch(e){ setTimeout(process, 16); }
            }
        } catch (e) { console.warn('_enqueueMaterialize failed', e); }
    }

    // Process up to _materializeBatch queued materializations per RAF tick
    _processMaterializeQueue(){
        try {
            this._materializeScheduled = false;
            if (!this._materializeQueue || this._materializeQueue.length === 0) return;
            const batch = Math.max(1, this._materializeBatch || 2);
            let count = 0;
            while (count < batch && this._materializeQueue.length > 0) {
                const job = this._materializeQueue.shift();
                if (!job) continue;
                // skip if animation gone
                if (!this._frames || !this._frames.has(job.animation)) continue;
                const arr = this._frames.get(job.animation);
                if (!arr || job.index < 0 || job.index >= arr.length) continue;
                const entry = arr[job.index];
                if (entry && entry.__lazy === true) {
                    try { this._materializeFrame(job.animation, job.index); } catch(e) { /* ignore */ }
                }
                count++;
            }
            // schedule next batch if queue not empty
            if (this._materializeQueue.length > 0) {
                this._materializeScheduled = true;
                const process = () => { this._processMaterializeQueue(); };
                try { requestAnimationFrame(process); } catch(e){ setTimeout(process, 16); }
            }
        } catch (e) { console.warn('_processMaterializeQueue failed', e); this._materializeScheduled = false; }
    }

    // Static factory: create an editable SpriteSheet with one blank frame and
    // a default animation name.
    static createNew(px, defaultAnimation = 'idle'){
        const c = document.createElement('canvas');
        c.width = px; c.height = px;
        const ctx = c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height);
        const ss = new SpriteSheet(c, px, new Map());
        ss._frames = new Map();
        const arr = [document.createElement('canvas')];
        arr[0].width = px; arr[0].height = px;
        const aCtx = arr[0].getContext('2d'); aCtx.clearRect(0,0,px,px);
        ss._frames.set(defaultAnimation, arr);
        ss._rebuildSheetCanvas();
        return ss;
    }

    // Insert an empty frame into an animation at index (or push if undefined)
    insertFrame(animation, index = undefined) {
        if (!this._frames.has(animation)) {
            // create animation if missing
            this._frames.set(animation, []);
        }
        const arr = this._frames.get(animation);
        const frameCanvas = document.createElement('canvas');
        frameCanvas.width = this.slicePx; frameCanvas.height = this.slicePx;
        const ctx = frameCanvas.getContext('2d'); ctx.clearRect(0,0,frameCanvas.width, frameCanvas.height);
        if (typeof index === 'number' && index >= 0 && index <= arr.length) arr.splice(index, 0, frameCanvas);
        else arr.push(frameCanvas);
        this._rebuildSheetCanvas();
        return true;
    }

    // Remove a frame from an animation at index (or pop last if undefined)
    popFrame(animation, index = undefined) {
        if (!this._frames.has(animation)) return false;
        const arr = this._frames.get(animation);
        if (arr.length === 0) return false;
        let removed;
        if (typeof index === 'number' && index >= 0 && index < arr.length) removed = arr.splice(index,1);
        else removed = [arr.pop()];
        this._rebuildSheetCanvas();
        return removed[0] || null;
    }

    // Return the frame canvas (or null)
    getFrame(animation, index = 0) {
        const arr = this._frames.get(animation);
        if (!arr || arr.length === 0) return null;
        const idx = Math.max(0, Math.min(arr.length - 1, index));
        const entry = arr[idx];
        // If this entry is a lazy descriptor, materialize it now
        if (entry && entry.__lazy === true) {
            return this._materializeFrame(animation, idx);
        }
        return entry;
    }

    // Modify a frame by applying an array of changes: {x,y,color,blendType}
    // color: hex '#RRGGBB' or '#RRGGBBAA' or {r,g,b,a}
    // blendType: 'replace' (default) or 'alpha'
    modifyFrame(animation, index, changes) {
        try {
            const frame = this.getFrame(animation, index);
            if (!frame) return false;
            const ctx = frame.getContext('2d');
            const img = ctx.getImageData(0,0,frame.width, frame.height);
            const data = img.data;

            const applyChange = (chg) => {
                if (!chg) return;
                const x = Math.floor(chg.x || 0);
                const y = Math.floor(chg.y || 0);
                if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return;
                const idx = (y * frame.width + x) * 4;
                // Use centralized Color helper to convert inputs to RGB(A)
                let rgba;
                try {
                    const colObj = Color.convertColor(chg.color || '#000000');
                    const rgb = colObj.toRgb();
                    const ra = Math.round(rgb.a || 0);
                    const ga = Math.round(rgb.b || 0);
                    const ba = Math.round(rgb.c || 0);
                    const aa = Math.round((rgb.d === undefined ? 1 : rgb.d) * 255);
                    rgba = [ra, ga, ba, aa];
                } catch (e) {
                    rgba = [0,0,0,0];
                }
                const blend = chg.blendType || 'replace';
                if (blend === 'alpha') {
                    const srcA = rgba[3] / 255;
                    const dstA = data[idx+3] / 255;
                    // alpha composite: out = src + dst*(1-srcA)
                    const outA = srcA + dstA * (1 - srcA);
                    if (outA <= 0) {
                        data[idx] = data[idx+1] = data[idx+2] = data[idx+3] = 0;
                    } else {
                        data[idx] = Math.round((rgba[0] * srcA + data[idx] * dstA * (1 - srcA)) / outA);
                        data[idx+1] = Math.round((rgba[1] * srcA + data[idx+1] * dstA * (1 - srcA)) / outA);
                        data[idx+2] = Math.round((rgba[2] * srcA + data[idx+2] * dstA * (1 - srcA)) / outA);
                        data[idx+3] = Math.round(outA * 255);
                    }
                } else {
                    // replace
                    data[idx] = rgba[0]; data[idx+1] = rgba[1]; data[idx+2] = rgba[2]; data[idx+3] = rgba[3];
                }
            };

            if (Array.isArray(changes)) {
                for (const c of changes) applyChange(c);
            } else {
                applyChange(changes);
            }

            ctx.putImageData(img, 0, 0);
            // After modifying a single frame's pixels, try to update only the
            // corresponding cell in the packed sheet instead of rebuilding
            // the entire packed canvas (much faster for per-pixel edits).
            try {
                this._updatePackedFrame(animation, index);
            } catch (e) {
                // if incremental update fails for any reason, fall back to full rebuild
                try { this._rebuildSheetCanvas(); } catch (er) { /* ignore */ }
            }
            return true;
        } catch (e) {
            console.warn('modifyFrame failed', e);
            return false;
        }
    }

    // Convenience: set a single pixel on a frame
    setPixel(animation, index, x, y, color, blendType = 'replace') {
        return this.modifyFrame(animation, index, { x: x, y: y, color: color, blendType: blendType });
    }

    // Convenience: fill a rectangle area on a frame with a color
    // x,y: top-left relative to frame. w,h inclusive of pixels.
    fillRect(animation, index, x, y, w, h, color, blendType = 'replace') {
        const changes = [];
        const ix = Math.floor(x || 0);
        const iy = Math.floor(y || 0);
        const iw = Math.max(0, Math.floor(w || 0));
        const ih = Math.max(0, Math.floor(h || 0));
        for (let yy = 0; yy < ih; yy++) {
            for (let xx = 0; xx < iw; xx++) {
                changes.push({ x: ix + xx, y: iy + yy, color: color, blendType: blendType });
            }
        }
        return this.modifyFrame(animation, index, changes);
    }

    // Convenience: apply an array of pixel changes quickly
    // pixels: [{x,y,color,blendType}, ...]
    drawPixels(animation, index, pixels) {
        if (!Array.isArray(pixels)) return false;
        return this.modifyFrame(animation, index, pixels);
    }
}