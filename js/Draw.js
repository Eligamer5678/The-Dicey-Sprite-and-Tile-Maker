import Color from './Color.js';
import Vector from './Vector.js';

export default class Draw {
    constructor() {
        this.ctx = null;
        this.ctxMap = new Map(); // Store multiple contexts by name
        this.currentCtxName = null;
        this.Scale = new Vector(1, 1); // scaling for coordinates
        // Stack depths (save/restore counts)
        this._matrixDepth = 0;
        this._maskDepth = 0;
        // track transforms as an array of {type, data} entries for easier inspection
        this._transforms = [];
        // Caches (for SVG, if you use them later)
        this.clipPaths = new Map();
        this.svgCache = new Map();
        this.parsedSvgCache = new Map();
        this.loading = new Map();
    }

    px(num) { return num * this.Scale.x; }
    py(num) { return num * this.Scale.y; }
    ps(num) { return num * this.Scale.x; }
    pv(vec) { return new Vector(this.px(vec.x), this.py(vec.y)); }

    /**
     * Register a context with a name for fast swapping.
     */
    registerCtx(name, ctx) {
        this.ctxMap.set(name, ctx);
    }

    /**
     * Use a context by name or direct ctx object.
     */
    useCtx(ctxOrName) {
        if (typeof ctxOrName === 'string') {
            const ctx = this.ctxMap.get(ctxOrName);
            if (!ctx) throw new Error(`Draw.useCtx: context '${ctxOrName}' not found.`);
            this.ctx = ctx;
            this.currentCtxName = ctxOrName;
        } else {
            this.ctx = ctxOrName;
            // Optionally, you could search for the name in ctxMap and set currentCtxName
        }
        return this;
    }

    /**
     * Get a context by name.
     */
    getCtx(name) {
        return this.ctxMap.get(name);
    }

    // =========================
    // Context management
    // =========================
    _assertCtx(where) {
        if (!this.ctx) throw new Error(`Draw.${where}: no active context. Call useCtx(ctx) first.`);
        return this.ctx;
    }

    /**
     * transformType: 'offset' | 'rotate' | 'scale'
     * - offset: data = {x,y}
     * - rotate: data = number (radians) OR { angle, origin?: {x,y} }
     * - scale : data = number | {x,y}
     */
    // Convenience wrapper: call one of the dedicated transform helpers.
    // transformType: 'offset'|'translate'|'rotate'|'scale'
    pushMatrix(data=new Vector(0,0), transformType = 'offset') {
        switch (transformType) {
            case 'offset':
            case 'translate':
                return this.translate(data);
            case 'rotate':
                return this.rotate(data);
            case 'scale':
                return this.scale(data);
            default:
                console.warn(`pushMatrix: unknown transformType "${transformType}"`);
                return this;
        }
    }

    // Apply a translation and push it to the transform stack
    translate(data) {
        const ctx = this._assertCtx('translate');
        ctx.save();
        const v = _asVec(data);
        ctx.translate(this.px(v.x), this.py(v.y));
        // Group transforms: add into the last group array or create a new group
        const t = { type: 'translate', data: { x: v.x, y: v.y } };
        if (!this._transforms.length || !Array.isArray(this._transforms[this._transforms.length - 1])) {
            this._transforms.push([t]);
        } else {
            this._transforms[this._transforms.length - 1].push(t);
        }
        this._matrixDepth++;
        return this;
    }

    // Apply rotation. Accepts either a number (radians) or { angle, origin }
    rotate(data) {
        const ctx = this._assertCtx('rotate');
        ctx.save();
        let rotEntry;
        if (typeof data === 'number') {
            ctx.rotate(data);
            rotEntry = { type: 'rotate', data: { angle: data } };
        } else {
            const angle = data.angle ?? 0;
            const origin = data.origin ? _asVec(data.origin) : null;
            if (origin) {
                ctx.translate(this.px(origin.x), this.py(origin.y));
                ctx.rotate(angle);
                ctx.translate(this.px(-origin.x), this.py(-origin.y));
                rotEntry = { type: 'rotate', data: { angle, origin: { x: origin.x, y: origin.y } } };
            } else {
                ctx.rotate(angle);
                rotEntry = { type: 'rotate', data: { angle } };
            }
        }
        if (!this._transforms.length || !Array.isArray(this._transforms[this._transforms.length - 1])) {
            this._transforms.push([rotEntry]);
        } else {
            this._transforms[this._transforms.length - 1].push(rotEntry);
        }
        this._matrixDepth++;
        return this;
    }

    // Apply scaling. Accepts a number or {x,y}.
    scale(data) {
        const ctx = this._assertCtx('scale');
        ctx.save();
        let scaleEntry;
        if (typeof data === 'number') {
            ctx.scale(data, data);
            scaleEntry = { type: 'scale', data: { x: data, y: data } };
        } else {
            const s = _asVec(data);
            ctx.scale(s.x, s.y);
            scaleEntry = { type: 'scale', data: { x: s.x, y: s.y } };
        }
        if (!this._transforms.length || !Array.isArray(this._transforms[this._transforms.length - 1])) {
            this._transforms.push([scaleEntry]);
        } else {
            this._transforms[this._transforms.length - 1].push(scaleEntry);
        }
        this._matrixDepth++;
        return this;
    }

    // Pop transforms. Signature: popMatrix(single = true, deep = false)
    // - single=true : pop a single transform
    // - single=false, deep=true : clear all transforms
    popMatrix(single = true, deep = false) {
        const ctx = this._assertCtx('popMatrix');

        // Helper to safely restore once
        const safeRestore = () => {
            if (this._matrixDepth > 0) {
                ctx.restore();
                this._matrixDepth--;
                return true;
            }
            return false;
        };

        if (deep && single === false) {
            // clear everything
            while (this._matrixDepth > 0) {
                ctx.restore();
                this._matrixDepth--;
            }
            this._transforms = [];
            return this;
        }

        // Ensure we have at least one group
        if (!this._transforms.length) return this;

        const lastGroup = this._transforms[this._transforms.length - 1];

        if (single === true && deep === true) {
            // pop a single transform from the last group
            if (Array.isArray(lastGroup)) {
                if (lastGroup.length > 0) {
                    safeRestore();
                    lastGroup.pop();
                    if (lastGroup.length === 0) this._transforms.pop();
                }
            } else {
                // legacy single-entry - remove it
                safeRestore();
                this._transforms.pop();
            }
            return this;
        }

        // At this point: either (single===false && deep===false) OR (single===true && deep===true)
        // Both behaviours should delete the last group entirely.
        if (Array.isArray(lastGroup)) {
            // restore for each transform in the group
            for (let i = 0; i < lastGroup.length; i++) {
                safeRestore();
            }
            this._transforms.pop();
        } else {
            // single entry
            safeRestore();
            this._transforms.pop();
        }

        return this;
    }

    arc(pos, size, startAngle, endAngle, color = '#000000FF', fill = true, stroke = false, width = 1, strokeColor = null, erase = false) {
        pos = this.pv(pos.clone ? pos.clone() : new Vector(pos[0] ?? 0, pos[1] ?? 0));
        size = this.pv(size.clone ? size.clone() : new Vector(size[0] ?? 0, size[1] ?? 0));
        width = this.ps(width);
        const ctx = this._assertCtx('arc');
        const { x, y } = _asVec(pos);
        const { x: w, y: h } = _asVec(size);
        const rx = w / 2;
        const ry = h / 2;

        if (erase && color === null) {
            ctx.clearRect(x - rx, y - ry, w, h);
            return;
        }

        ctx.save();
        ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';

        // Build path: move to center then draw arc (ellipse segment)
        ctx.beginPath();
        // Move to center so closing path will create a "pie" when filled
        ctx.moveTo(x, y);

        // For elliptical arcs, use ctx.ellipse with start/end angles
        ctx.ellipse(x, y, rx, ry, 0, startAngle, endAngle);

        // Close to center to form sector; if you only want open arc, set fill=false and stroke=true
        ctx.closePath();

        const col = Color.convertColor(erase ? '#000000FF' : color);
        if (fill) {
            ctx.globalAlpha = col.d;
            ctx.fillStyle = col.toHex();
            ctx.fill();
        }

        // stroke handling: if stroke === true (or for backwards compatibility)
        const strokeProvided = arguments.length >= 7;
        const doStroke = strokeProvided ? !!stroke : (fill === false);
        if (doStroke) {
            const strokeColRaw = (arguments.length >= 9 && strokeColor != null) ? strokeColor : color;
            const sc = Color.convertColor(erase ? '#000000FF' : strokeColRaw);
            ctx.strokeStyle = sc.toHex();
            ctx.lineWidth = width;
            ctx.stroke();
        }

        ctx.restore();
    }

    clear() {
        const ctx = this._assertCtx('clear');
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
    /**
     * Rectangular mask. If invert=true, everything OUTSIDE the rect is kept (even-odd rule).
     * Affects subsequent drawing until clearMask().
     */
    maskRect(pos, size, invert = false) {
        pos = this.pv(pos.clone())
        size = this.pv(size.clone())
        const ctx = this._assertCtx('maskRect');
        const { x, y } = _asVec(pos);
        const { x: w, y: h } = _asVec(size);

        ctx.save();
        ctx.beginPath();

        if (invert) {
            // Even-odd: draw big rect + inner rect
            ctx.rect(0, 0, ctx.canvas.width, ctx.canvas.height);
            ctx.rect(x, y, w, h);
            ctx.clip('evenodd');
        } else {
            ctx.rect(x, y, w, h);
            ctx.clip();
        }

        this._maskDepth++;
    }

    /**
     * Polygon mask (points >= 3). If invert=true, keeps outside of polygon via even-odd rule.
     */
    polyMask(points, invert = false) {
        const ctx = this._assertCtx('polyMask');
        if (!points || points.length < 3) return;

        const p0 = _asVec(points[0]);

        ctx.save();
        ctx.beginPath();

        if (invert) {
            // Big rect first for even-odd inversion
            ctx.rect(0, 0, ctx.canvas.width, ctx.canvas.height);
        }

        ctx.moveTo(this.px(p0.x), this.py(p0.y));
        for (let i = 1; i < points.length; i++) {
            const p = _asVec(points[i]);
            ctx.lineTo(this.px(p.x), this.py(p.y));
        }
        ctx.closePath();

        ctx.clip(invert ? 'evenodd' : 'nonzero');
        this._maskDepth++;
    }

    /**
     * Remove masks. deep=true clears all active masks; false pops one.
     */
    clearMask(deep = true) {
        const ctx = this._assertCtx('clearMask');
        if (deep) {
            while (this._maskDepth > 0) {
                ctx.restore();
                this._maskDepth--;
            }
        } else if (this._maskDepth > 0) {
            ctx.restore();
            this._maskDepth--;
        }
    }
    circle(pos, r, color = '#000000FF', fill = true, width = 1, erase = false) {
        pos = this.pv(pos.clone());
        r = this.ps(r);
        width = this.ps(width);
        const ctx = this._assertCtx('circle');
        const { x, y } = _asVec(pos);
        const col = Color.convertColor(color);
        ctx.save();
        ctx.globalAlpha = col.d;
        ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        if (fill) {
            ctx.fillStyle = col.toHex();
            ctx.fill();
        } else {
            ctx.strokeStyle = col.toHex();
            ctx.lineWidth = width;
            ctx.stroke();
        }
        ctx.restore();
    }


    line(start, end, color = '#000000FF', width = 1, erase = false, cap = 'butt') {
        start = this.pv(start.clone());
        end = this.pv(end.clone());
        width = this.ps(width);
        const ctx = this._assertCtx('line');
        const col = Color.convertColor(color);
        ctx.save();
        ctx.globalAlpha = col.d;
        if (erase) {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.strokeStyle = '#000';
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = col.toHex();
        }
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.lineWidth = width;
        ctx.lineCap = cap;
        ctx.stroke();
        ctx.restore();
    }

    /** Note, If fill is set to gradient then use an array of colors */
    rect(pos, size, color = '#000000FF', fill = true, stroke = false, width = 1, strokeColor = null, erase = false) {
        pos = this.pv(pos.clone());
        size = this.pv(size.clone());
        width = this.ps(width);
        const ctx = this._assertCtx('rect');
        const { x, y } = _asVec(pos);
        const { x: w, y: h } = _asVec(size);

        // Special erase case: black & full alpha
        if (erase && color === null) {
            ctx.clearRect(x, y, w, h);
            return;
        }

        ctx.save();
        ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';

        // Determine stroke behaviour while preserving backwards compatibility:
        // - if caller provided `stroke` argument, use it
        // - otherwise, if fill === false, behave like before and stroke
        const strokeProvided = arguments.length >= 7; // stroke is 7th param

        // --- FILLED SOLID ---
        if (fill === true) {
            const col = Color.convertColor(erase ? '#000000FF' : color);
            ctx.fillStyle = col.toHex();
            ctx.fillRect(x, y, w, h);
        // --- GRADIENT FILL ---
        } else if (fill === 'gradient') {
            if (!Array.isArray(color)) {
                debug.log("Gradient fill requires an array of at least 2 colors");
                ctx.restore();
                return;
            }
            const grad = ctx.createLinearGradient(x, y, x + w, y); // horizontal gradient
            const stops = color.length;
            color.forEach((c, i) => {
                const col = Color.convertColor(c);
                grad.addColorStop(i / (stops - 1), col.toHex());
            });
            ctx.fillStyle = grad;
            ctx.fillRect(x, y, w, h);
        }

        // handle stroke if requested (either explicitly or for backwards compat)
        if (stroke) {
            const sc = Color.convertColor(strokeColor);
            ctx.strokeStyle = sc.toHex();
            ctx.lineWidth = width;
            ctx.strokeRect(x, y, w, h);
        }

        ctx.restore();
    }
    
    background(color = '#000000FF') {
        const ctx = this._assertCtx('background');
        this.rect(new Vector(0, 0), new Vector(ctx.canvas.width / this.Scale.x, ctx.canvas.height / this.Scale.y), color, true);
    }

    /**
     * Draw an ellipse. `pos` is center, `size` is [width, height] (in same units as rect).
     * Options: color, fill (true|'gradient'|false), stroke(boolean), strokeColor, width, erase
     */
    ellipse(pos, size, color = '#000000FF', fill = true, stroke = false, width = 1, strokeColor = null, erase = false) {
        pos = this.pv(pos.clone());
        size = this.pv(size.clone());
        width = this.ps(width);
        const ctx = this._assertCtx('ellipse');
        const { x, y } = _asVec(pos);
        const { x: w, y: h } = _asVec(size);
        const rx = w / 2;
        const ry = h / 2;

        // If erase and color === null, clear bounding box
        if (erase && color === null) {
            ctx.clearRect(x - rx, y - ry, w, h);
            return;
        }

        ctx.save();
        ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';

        // gradient fill support (simple horizontal gradient)
        if (fill === 'gradient') {
            if (!Array.isArray(color)) {
                debug.log("Gradient fill requires an array of at least 2 colors");
                ctx.restore();
                return;
            }
            const grad = ctx.createLinearGradient(x - rx, y, x + rx, y);
            const stops = color.length;
            color.forEach((c, i) => {
                const col = Color.convertColor(c);
                grad.addColorStop(i / (stops - 1), col.toHex());
            });
            ctx.beginPath();
            ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
            ctx.fillStyle = grad;
            ctx.fill();
        } else {
            const col = Color.convertColor(erase ? '#000000FF' : color);
            ctx.beginPath();
            ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
            if (fill) {
                ctx.globalAlpha = col.d;
                ctx.fillStyle = col.toHex();
                ctx.fill();
            }
            // stroke handling: if stroke === true or fill === false (backwards compat), stroke
            const strokeProvided = arguments.length >= 5; // stroke is 5th param
            const doStroke = strokeProvided ? !!stroke : (fill === false);
            if (doStroke) {
                const strokeColRaw = (arguments.length >= 6 && strokeColor != null) ? strokeColor : color;
                const sc = Color.convertColor(erase ? '#000000FF' : strokeColRaw);
                ctx.strokeStyle = sc.toHex();
                ctx.lineWidth = width;
                ctx.stroke();
            }
        }

        ctx.restore();
    }
        


    polygon(points, color = '#000000FF', fill = true, stroke = false, width = 1, strokeColor = null, erase = false) {
        // Match rect/ellipse signature: polygon(points, color, fill, stroke, width, strokeColor, erase)
        width = this.ps(width);
        const ctx = this._assertCtx('polygon');
        if (!points || points.length < 2) return;
        // Normalize points into pixel coords and compute bbox for gradient creation
        const coords = [];
        for (let i = 0; i < points.length; i++) {
            const p = _asVec(points[i]);
            coords.push({ x: this.px(p.x), y: this.py(p.y) });
        }
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const c of coords) {
            if (c.x < minX) minX = c.x;
            if (c.x > maxX) maxX = c.x;
            if (c.y < minY) minY = c.y;
            if (c.y > maxY) maxY = c.y;
        }

        ctx.save();
        ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';

        // Determine if stroke was explicitly provided (positional) to preserve backwards compat
        const strokeProvided = arguments.length >= 4; // points + color + fill + stroke => 4th arg is stroke

        ctx.beginPath();
        ctx.moveTo(coords[0].x, coords[0].y);
        for (let i = 1; i < coords.length; i++) {
            ctx.lineTo(coords[i].x, coords[i].y);
        }
        ctx.closePath();

        // --- FILL HANDLING ---
        if (fill === true) {
            // solid fill
            const col = Color.convertColor(erase ? '#000000FF' : color);
            ctx.fillStyle = col.toHex();
            ctx.fill();
        } else if (fill === 'gradient') {
            if (!Array.isArray(color)) {
                console.warn('polygon: gradient fill requires an array of colors');
            } else if (minX === Infinity || maxX === -Infinity) {
                const c0 = Color.convertColor(color[0]);
                ctx.fillStyle = c0.toHex();
                ctx.fill();
            } else {
                const grad = ctx.createLinearGradient(minX, (minY + maxY) / 2, maxX, (minY + maxY) / 2);
                const stops = color.length;
                color.forEach((c, i) => {
                    const cc = Color.convertColor(c);
                    grad.addColorStop(i / (stops - 1), cc.toHex());
                });
                ctx.fillStyle = grad;
                ctx.fill();
            }
        } else if (fill === 'gradient-vertical') {
            if (!Array.isArray(color)) {
                console.warn('polygon: gradient-vertical fill requires an array of colors');
            } else if (minY === Infinity || maxY === -Infinity) {
                const c0 = Color.convertColor(color[0]);
                ctx.fillStyle = c0.toHex();
                ctx.fill();
            } else {
                const grad = ctx.createLinearGradient((minX + maxX) / 2, minY, (minX + maxX) / 2, maxY);
                const stops = color.length;
                color.forEach((c, i) => {
                    const cc = Color.convertColor(c);
                    grad.addColorStop(i / (stops - 1), cc.toHex());
                });
                ctx.fillStyle = grad;
                ctx.fill();
            }
        }

        // --- STROKE HANDLING ---
        const doStroke = strokeProvided ? !!stroke : (fill === false);
        if (doStroke) {
            const strokeColRaw = strokeColor != null ? strokeColor : color;
            const sc = Color.convertColor(erase ? '#000000FF' : strokeColRaw);
            ctx.strokeStyle = sc.toHex();
            ctx.lineWidth = width;
            ctx.stroke();
        }

        ctx.restore();
    }

    text(txt, pos, color = '#000000FF', width = 1, fontSize = 20, options = {}, erase = false) {
        pos = this.pv(pos.clone());
        fontSize = this.ps(fontSize);
        width = this.ps(width);
        const ctx = this._assertCtx('text');
        const {
            font = `${fontSize}px Arial`,
            align = 'start',
            baseline = 'alphabetic',
            fill = true,
            strokeWidth = width, // pass down our width param
            italics = false,
            // box: optional Vector or [w,h] or {x,y} specifying bounding box for wrapping/clipping
            box = null,
            // wrap: 'word' (default) or 'char' - controls how long lines are broken
            wrap = 'word',
        } = options;
        ctx.save();
        ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
        const col = Color.convertColor(erase ? '#000000FF' : color);
    // Build font string. If caller passed a font family/name without size
    // (for example 'monospace'), prepend the computed fontSize so scaling works.
    // Respect italics option by placing 'italic' before the size/family.
    const baseFont = font;
    const hasSize = (typeof baseFont === 'string') && (/\b\d+px\b/.test(baseFont));
    let fontStr = (italics ? 'italic ' : '') + (hasSize ? baseFont : `${fontSize}px ${baseFont}`);
    ctx.font = fontStr;
        ctx.textAlign = align;
        // Determine if we're drawing into a bounded box (wrap + clip)
        let boxWidth = null;
        let boxHeight = null;
        if (box) {
            const b = _asVec(box);
            boxWidth = this.px(b.x);
            boxHeight = this.py(b.y);
        }

        // If a box is provided and baseline wasn't explicitly set, use 'top' to make layout predictable
        const usedBaseline = (options && options.baseline) ? baseline : (box ? 'top' : baseline);
        ctx.textBaseline = usedBaseline;

        if (boxWidth != null && !isNaN(boxWidth) && boxWidth > 0) {
            // Wrap text into lines that fit boxWidth
            const lines = [];
            const paragraphs = String(txt).split('\n');
            for (let p = 0; p < paragraphs.length; p++) {
                if (wrap === 'char') {
                    // Character-level wrapping: build lines by adding chars until width exceeded
                    const paragraph = paragraphs[p];
                    let cur = '';
                    for (let ci = 0; ci < paragraph.length; ci++) {
                        const ch = paragraph[ci];
                        const test = cur + ch;
                        const testWidth = ctx.measureText(test).width;
                        if (testWidth <= boxWidth || cur.length === 0) {
                            cur = test;
                        } else {
                            lines.push(cur);
                            cur = ch;
                        }
                    }
                    if (cur.length > 0) lines.push(cur);
                } else {
                    // Word-level wrapping (default)
                    const words = paragraphs[p].split(/\s+/);
                    let line = '';
                    for (let i = 0; i < words.length; i++) {
                        const word = words[i];
                        const test = line.length ? line + ' ' + word : word;
                        const testWidth = ctx.measureText(test).width;
                        if (testWidth <= boxWidth || line.length === 0) {
                            // fits (or line is empty) -> accept
                            line = test;
                        } else {
                            // doesn't fit. If the single word itself is wider than box, break the word
                            const wordWidth = ctx.measureText(word).width;
                            if (wordWidth > boxWidth) {
                                // break the word into chunks that fit
                                let chunkStart = 0;
                                while (chunkStart < word.length) {
                                    let chunk = '';
                                    for (let ci = chunkStart; ci < word.length; ci++) {
                                        const testChunk = chunk + word[ci];
                                        if (ctx.measureText(testChunk).width <= boxWidth) {
                                            chunk = testChunk;
                                        } else {
                                            break;
                                        }
                                    }
                                    // if nothing fits (very narrow box), force one char
                                    if (chunk.length === 0) chunk = word[chunkStart];
                                    // if current line has content, push it first
                                    if (line.length > 0) {
                                        lines.push(line);
                                        line = '';
                                    }
                                    lines.push(chunk);
                                    chunkStart += chunk.length;
                                }
                            } else {
                                // word fits by itself but not when appended -> push current line and start new
                                lines.push(line);
                                line = word;
                            }
                        }
                    }
                    if (line.length > 0) lines.push(line);
                }
            }

            // Compute line height (approximate using fontSize)
            const lineHeight = fontSize * (options.lineHeight || 1.2);

            // Optionally clip to boxHeight
            let maxLines = lines.length;
            if (boxHeight != null && !isNaN(boxHeight) && boxHeight > 0) {
                maxLines = Math.floor(boxHeight / lineHeight);
                if (maxLines < 0) maxLines = 0;
            }

            ctx.save();
            if (boxHeight != null) {
                // clip to bounding box
                ctx.beginPath();
                ctx.rect(pos.x, pos.y, boxWidth, boxHeight);
                ctx.clip();
            }

            if (fill) {
                ctx.fillStyle = col.toHex();
                for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
                    ctx.fillText(lines[i], pos.x, pos.y + i * lineHeight);
                }
            } else {
                ctx.strokeStyle = col.toHex();
                ctx.lineWidth = strokeWidth;
                for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
                    ctx.strokeText(lines[i], pos.x, pos.y + i * lineHeight);
                }
            }

            ctx.restore();
        } else {
            ctx.textBaseline = usedBaseline;
            if (fill) {
                ctx.fillStyle = col.toHex();
                ctx.fillText(txt, pos.x, pos.y);
            } else {
                ctx.strokeStyle = col.toHex();
                ctx.lineWidth = strokeWidth;
                ctx.strokeText(txt, pos.x, pos.y);
            }
        }
        ctx.restore();
    }

    image(img, pos, size = null, invert = null, rad = 0, opacity = 1, smoothing = true) {
        pos = this.pv(pos.clone())
        size = this.pv(size.clone())
        const ctx = this._assertCtx('image');
        const { x, y } = _asVec(pos);
        const w = size?.x ?? img.width;
        const h = size?.y ?? img.height;

        ctx.save();
        // control image smoothing (anti-aliasing) per-draw
        try {
            if (smoothing === false) {
                ctx.imageSmoothingEnabled = false;
                if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'low';
            } else if (smoothing === true) {
                if ('imageSmoothingEnabled' in ctx) ctx.imageSmoothingEnabled = true;
                if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
            }
        } catch (e) {
            // ignore if context doesn't support these properties
        }

        ctx.globalAlpha *= opacity;

        // Move to the image position
        ctx.translate(x + w / 2, y + h / 2);

        // Apply rotation
        if (rad) ctx.rotate(rad);

        // Apply invert scaling
        if (invert) {
            const { x: ix, y: iy } = _asVec(invert);
            ctx.scale(ix < 0 ? -1 : 1, iy < 0 ? -1 : 1);
        }

        // Draw image centered at origin
        ctx.drawImage(img, -w / 2, -h / 2, w, h);

        ctx.restore();
    }

    /**
     * Draw a frame from a SpriteSheet-like object.
     * sheet: object with properties `sheet` (Image), `slicePx` (frame size in pixels),
     *        and `animations` (Map or plain object) mapping name -> { row, frameCount } (or { row, frames }).
     * pos, size: Vector (top-left) or size null to use slice size.
     * animation: name of registered animation in sheet.animations
     * frame: frame index (0-based)
     * invert: optional flip vector like {x:-1,y:1}
     * opacity: optional opacity multiplier
     */
    sheet(sheet, pos, size = null, animation = null, frame = 0, invert = null, opacity = 1, smoothing = false) {
        const ctx = this._assertCtx('sheet');
        if (!sheet || !sheet.sheet || !sheet.slicePx) {
            console.warn('Draw.sheet: invalid sheet provided');
            return;
        }

        // resolve animation metadata (support Map or plain object)
        let meta = null;
        if (animation) {
            if (sheet.animations instanceof Map) meta = sheet.animations.get(animation);
            else if (sheet.animations && sheet.animations[animation]) meta = sheet.animations[animation];
        }
        // if no meta found, fall back to row 0 and compute frameCount from image width
        const slice = sheet.slicePx;
        const img = sheet.sheet;
        const sw = slice;
        const sh = slice;
        const row = meta && (meta.row !== undefined) ? meta.row : 0;
        const frameCount = meta ? (meta.frameCount ?? meta.frames ?? Math.floor(img.width / slice)) : Math.floor(img.width / slice);

        // clamp frame
        let fi = Math.floor(Number(frame) || 0);
        if (fi < 0) fi = 0;
        if (frameCount > 0) fi = Math.min(fi, frameCount - 1);

        // source coords
        const sx = fi * sw;
        const sy = row * sh;

        // destination size
        let dstW, dstH;
        if (size) {
            const s = _asVec(size);
            dstW = s.x; dstH = s.y;
        } else {
            dstW = sw; dstH = sh;
        }

        const pPos = this.pv(pos.clone());
        const px = pPos.x + this.px(dstW) / 2;
        const py = pPos.y + this.py(dstH) / 2;

        ctx.save();
        ctx.translate(px, py);
        // control image smoothing (anti-aliasing) per-draw
        try {
            if (smoothing === false) {
                ctx.imageSmoothingEnabled = false;
                if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'low';
            } else if (smoothing === true) {
                if ('imageSmoothingEnabled' in ctx) ctx.imageSmoothingEnabled = true;
                if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
            }
        } catch (e) {
            // ignore if context doesn't support these properties
        }
        if (invert) {
            const inv = _asVec(invert);
            const fx = inv.x < 0 ? -1 : 1;
            const fy = inv.y < 0 ? -1 : 1;
            ctx.scale(fx, fy);
        }
        ctx.globalAlpha *= (opacity !== undefined ? opacity : 1);

        try {
            // Prefer drawing a per-frame canvas or lazy descriptor directly when available.
            let drawn = false;
            try {
                if (sheet && sheet._frames && animation) {
                    const arr = sheet._frames.get(animation);
                    if (arr && arr.length > 0) {
                        const entry = arr[fi];
                        if (entry) {
                            if (entry.__lazy === true && entry.src) {
                                // draw directly from the source image/bitmap using the descriptor
                                ctx.drawImage(entry.src, entry.sx || 0, entry.sy || 0, entry.w || sw, entry.h || sh, -this.px(dstW) / 2, -this.py(dstH) / 2, this.px(dstW), this.py(dstH));
                                drawn = true;
                            } else if (entry instanceof HTMLCanvasElement || entry instanceof ImageBitmap) {
                                ctx.drawImage(entry, -this.px(dstW) / 2, -this.py(dstH) / 2, this.px(dstW), this.py(dstH));
                                drawn = true;
                            }
                        }
                    }
                }
            } catch (inner) {
                // swallow and fallback to packed sheet draw
            }
            if (!drawn) {
                ctx.drawImage(img, sx, sy, sw, sh, -this.px(dstW) / 2, -this.py(dstH) / 2, this.px(dstW), this.py(dstH));
            }
        } catch (e) {
            console.warn('Draw.sheet: drawImage failed', e);
        }

        ctx.restore();
    }

    // Draw a single tile from a tilesheet/spritesheet. Supports rotation (integer 0..3) in 90deg steps.
    tile(sheet, pos, size = null, tile = null, rotation = 0, invert = null, opacity = 1, smoothing = false) {
        const ctx = this._assertCtx('tile');
        if (!sheet || !sheet.sheet || !sheet.slicePx) {
            console.warn('Draw.tile: invalid sheet provided');
            return;
        }

        // resolve tile metadata
        // Support passing:
        // - a tile key/name (looked up in sheet.tiles)
        // - a numeric frame index (interpreted as column on row 0)
        // - an array [row, col] or object {row, col} to directly specify tile coordinates
        let meta = null;
        if (tile) {
            // direct coordinate object/array
            if (Array.isArray(tile) || (typeof tile === 'object' && (tile.row !== undefined || tile[0] !== undefined))) {
                if (Array.isArray(tile)) meta = { row: Number(tile[0]) || 0, col: Number(tile[1]) || 0 };
                else meta = { row: Number(tile.row) || 0, col: Number(tile.col) || 0 };
            } else {
                if (sheet.tiles instanceof Map) meta = sheet.tiles.get(tile);
                else if (sheet.tiles && sheet.tiles[tile]) meta = sheet.tiles[tile];
            }
        }

        const slice = sheet.slicePx;
        const img = sheet.sheet;
        const sw = slice;
        const sh = slice;

        // compute source coords; if meta undefined, treat `tile` as frame index in row 0
        let sx = 0, sy = 0;
        if (meta && (meta.col !== undefined || meta.frame !== undefined)) {
            const col = meta.col ?? meta.frame ?? 0;
            sx = col * sw;
            sy = (meta.row !== undefined) ? meta.row * sh : 0;
        } else if (!isNaN(Number(tile))) {
            const fi = Math.max(0, Math.floor(Number(tile)));
            sx = fi * sw;
            sy = 0;
        }

        // destination size
        let dstW, dstH;
        if (size) {
            const s = _asVec(size);
            dstW = s.x; dstH = s.y;
        } else {
            dstW = sw; dstH = sh;
        }

        const pPos = this.pv(pos.clone());
        const px = pPos.x + this.px(dstW) / 2;
        const py = pPos.y + this.py(dstH) / 2;

        ctx.save();
        ctx.translate(px, py);
        // control image smoothing (anti-aliasing) per-draw
        try {
            if (smoothing === false) {
                ctx.imageSmoothingEnabled = false;
                if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'low';
            } else if (smoothing === true) {
                if ('imageSmoothingEnabled' in ctx) ctx.imageSmoothingEnabled = true;
                if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
            }
        } catch (e) {
            // ignore if context doesn't support these properties
        }

        // apply integer rotation steps (0,1,2,3) -> multiples of 90deg
        try {
            let rot = Number(rotation) || 0;
            rot = ((rot % 4) + 4) % 4;
            if (rot !== 0) ctx.rotate(rot * Math.PI / 2);
        } catch (e) {
            // ignore rotation errors
        }

        if (invert) {
            const inv = _asVec(invert);
            const fx = inv.x < 0 ? -1 : 1;
            const fy = inv.y < 0 ? -1 : 1;
            ctx.scale(fx, fy);
        }
        ctx.globalAlpha *= (opacity !== undefined ? opacity : 1);

        try {
            ctx.drawImage(img, sx, sy, sw, sh, -this.px(dstW) / 2, -this.py(dstH) / 2, this.px(dstW), this.py(dstH));
        } catch (e) {
            console.warn('Draw.tile: drawImage failed', e);
        }

        ctx.restore();
    }

    // =========================
    // (Optional) SVG helpers if needed later
    // =========================

    async _fetchSvg(url) {
        if (this.svgCache.has(url)) return this.svgCache.get(url);
        if (this.loading.has(url)) return this.loading.get(url);

        const promise = fetch(url).then(res => {
            if (!res.ok) throw new Error(`Failed to fetch SVG: ${res.statusText}`);
            return res.text();
        });
        this.loading.set(url, promise);
        const text = await promise;
        this.svgCache.set(url, text);
        this.loading.delete(url);
        return text;
    }

    _parseClipPaths(doc) {
        this.clipPaths.clear();
        doc.querySelectorAll('clipPath').forEach(clip => {
            const id = clip.getAttribute('id');
            const child = clip.firstElementChild;
            if (!id || !child) return;

            let path;
            const tag = child.tagName.toLowerCase();

            if (tag === 'path') {
                const d = child.getAttribute('d');
                if (d) path = new Path2D(d);
            } else if (tag === 'rect') {
                const x = parseFloat(child.getAttribute('x') ?? 0);
                const y = parseFloat(child.getAttribute('y') ?? 0);
                const w = parseFloat(child.getAttribute('width') ?? 0);
                const h = parseFloat(child.getAttribute('height') ?? 0);
                path = new Path2D();
                path.rect(x, y, w, h);
            }

            if (path) this.clipPaths.set(id, path);
        });
    }

    _renderSvgElement(ctx, el) {
        const tag = el.tagName?.toLowerCase();
        if (!tag) return;

        let appliedClip = false;
        const clipAttr = el.getAttribute('clip-path');

        if (clipAttr) {
            const match = clipAttr.match(/url\(#(.+?)\)/);
            if (match) {
                const clipId = match[1];
                const clipPath = this.clipPaths.get(clipId);
                if (clipPath) {
                    ctx.save();
                    ctx.clip(clipPath);
                    appliedClip = true;
                }
            }
        }

        // 🔑 pull out opacity
        const opacity = parseFloat(el.getAttribute('opacity') ?? '1');
        const fillOpacity = parseFloat(el.getAttribute('fill-opacity') ?? '1');
        const effectiveOpacity = Math.max(0, Math.min(1, opacity * fillOpacity));

        switch (tag) {
            case 'svg':
            case 'g':
                for (const child of el.children) this._renderSvgElement(ctx, child);
                break;

            case 'path': {
                const d = el.getAttribute('d');
                const fill = el.getAttribute('fill');
                if (!d) break;
                const path = new Path2D(d);
                if (fill && fill !== 'none') {
                    ctx.save();
                    ctx.globalAlpha *= effectiveOpacity;   // ✅ respect opacity
                    ctx.fillStyle = fill;
                    ctx.fill(path);
                    ctx.restore();
                }
                break;
            }

            case 'rect': {
                const x = parseFloat(el.getAttribute('x') ?? 0);
                const y = parseFloat(el.getAttribute('y') ?? 0);
                const w = parseFloat(el.getAttribute('width') ?? 0);
                const h = parseFloat(el.getAttribute('height') ?? 0);
                const fill = el.getAttribute('fill');
                if (fill && fill !== 'none') {
                    ctx.save();
                    ctx.globalAlpha *= effectiveOpacity;   // ✅ respect opacity
                    ctx.fillStyle = fill;
                    ctx.fillRect(x, y, w, h);
                    ctx.restore();
                }
                break;
            }
        }

        if (appliedClip) ctx.restore();
    }


    async svg(url, pos, size = null, rotation = 0, origin = null, lockRatio = true) {
        pos = this.pv(pos.clone())
        size = this.pv(size.clone())
        const ctx = this._assertCtx('svg');
        if (!this.parsedSvgCache.has(url)) {
            if (!this.loading.has(url)) {
                this.loading.set(this._fetchSvg(url).then(svgText => {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(svgText, 'image/svg+xml');
                    this._parseClipPaths(doc);
                    this.parsedSvgCache.set(url, doc.documentElement);
                    this.loading.delete(url);
                }).catch(e => {
                    console.error('SVG load failed', e);
                    this.loading.delete(url);
                }));
            }
            return; // not ready yet
        }

        const svgRoot = this.parsedSvgCache.get(url);

        ctx.save();

        const ox = origin?.x ?? pos.x;
        const oy = origin?.y ?? pos.y;

        let intrinsicWidth = parseFloat(svgRoot.getAttribute('width')) || 0;
        let intrinsicHeight = parseFloat(svgRoot.getAttribute('height')) || 0;

        if ((!intrinsicWidth || !intrinsicHeight) && svgRoot.hasAttribute('viewBox')) {
            const parts = svgRoot.getAttribute('viewBox').trim().split(/\s+/);
            if (parts.length === 4) {
                const vbWidth = parseFloat(parts[2]);
                const vbHeight = parseFloat(parts[3]);
                if (!isNaN(vbWidth) && !isNaN(vbHeight)) {
                    intrinsicWidth = vbWidth;
                    intrinsicHeight = vbHeight;
                }
            }
        }

        let scaleX = 1, scaleY = 1;
        if (size !== null) {
            if (typeof size === 'number') {
                if (intrinsicWidth && intrinsicHeight) {
                    const maxDim = Math.max(intrinsicWidth, intrinsicHeight);
                    scaleX = scaleY = size / maxDim;
                } else {
                    scaleX = scaleY = size;
                }
            } else {
                const s = _asVec(size);
                if (intrinsicWidth && intrinsicHeight) {
                    if (lockRatio) {
                        const ratio = Math.min(s.x / intrinsicWidth, s.y / intrinsicHeight);
                        scaleX = scaleY = ratio;
                    } else {
                        scaleX = s.x / intrinsicWidth;
                        scaleY = s.y / intrinsicHeight;
                    }
                } else {
                    scaleX = s.x; scaleY = s.y;
                }
            }
        }

        // Apply transforms (external to primitives)
        ctx.translate(pos.x, pos.y);
        ctx.translate(ox - pos.x, oy - pos.y);
        ctx.scale(scaleX, scaleY);
        ctx.translate(-(ox - pos.x), -(oy - pos.y));

        this._renderSvgElement(ctx, svgRoot);

        ctx.restore();
    }
}

function _asVec(v) {
    if (v && typeof v.x === 'number' && typeof v.y === 'number') return v;
    if (Array.isArray(v) && v.length >= 2) return { x: v[0], y: v[1] };
    // scalar -> uniform
    const n = Number(v ?? 0);
    return { x: n, y: n };
}