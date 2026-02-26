import Vector from '../Vector.js';
import UIButton from './Button.js';
import Geometry from '../Geometry.js';

export default class TileConnPicker {
    constructor(mouse, keys, pos, size, layer, opts = {}){
        this.mouse = mouse;
        this.keys = keys;
        this.pos = pos;
        this.size = size;
        this.layer = layer;
        this.offset = new Vector(0,0);
        this.visible = true;

        const baseCell = opts.cellSize || 32;
        // previously doubled; now increase by 50% more (2.0 * 1.5 = 3x base)
        this.cell = Math.round(baseCell * 2 * 1.5);
        this.gap = opts.gap || 4;
        this.cols = opts.cols || 2; // force two columns by default
        this.sheetPath = opts.sheetPath || 'Assets/tiles.png';
        this.jsonPath = opts.jsonPath || 'tiles.json';
        this.slice = opts.slice || 16;

        this.image = new Image();
        this.image.src = this.sheetPath;

        this.mapping = {}; // binary -> index
        this.entries = []; // [{key,index}]

        this.buttons = [];
        this.selected = null;

        this.onSelect = opts.onSelect || function(){};

        // async load mapping json
        try {
            fetch(this.jsonPath).then(r=>r.json()).then(obj=>{
                this.mapping = obj || {};
                this.entries = Object.keys(this.mapping).map(k=>({ key: k, index: this.mapping[k]}));
                // sort for consistency
                this.entries.sort((a,b)=> parseInt(a.key,2) - parseInt(b.key,2));
                this._buildButtons();
            }).catch(()=>{
                // ignore
            });
        } catch(e){}
    }

    addOffset(offset){
        this.offset = offset;
        for (const b of this.buttons) b.addOffset(this.offset);
    }

    _buildButtons(){
        this.buttons = [];
        const cols = Math.max(1, this.cols);
        for (let i = 0; i < this.entries.length; i++){
            const btn = new UIButton(this.mouse, this.keys, new Vector(0, 0), new Vector(this.cell, this.cell), this.layer, null, '#00000000', '#FFFFFF22', '#FFFFFF44');
            // store index so we can compute position when drawing/updating
            btn.__gridIndex = i;
            btn.onPressed['left'].connect(((entry, self)=>{
                return ()=>{
                    self.selected = entry.key;
                    try{ self.onSelect(entry.key, entry.index); }catch(e){}
                };
            })(this.entries[i], this));
            btn.__entry = this.entries[i];
            this.buttons.push(btn);
        }
        // compute content height for scrolling
        const rows = Math.ceil(this.entries.length / cols);
        this._contentHeight = this.gap + rows * (this.cell + this.gap);
        this.scrollPos = this.scrollPos || 0;
        this._maxScroll = Math.max(0, this._contentHeight - (this.size.y - this.gap*2));
    }

    update(delta){
        if (!this.visible) return;
        // handle wheel when pointer inside picker
        try{
            if (Geometry.pointInRect(this.mouse.pos, this.pos, this.size)){
                const w = this.mouse.wheel();
                if (w) {
                    this.scrollPos = (this.scrollPos || 0) - w;
                    if (this.scrollPos < -this._maxScroll) this.scrollPos = -this._maxScroll;
                    if (this.scrollPos > 0) this.scrollPos = 0;
                }
            }
        }catch(e){}

        // layout buttons based on scroll
        const cols = Math.max(1, this.cols);
        for (const b of this.buttons){
            const i = b.__gridIndex;
            const r = Math.floor(i / cols);
            const c = i % cols;
            const px = this.pos.x + this.gap + c * (this.cell + this.gap);
            const py = this.pos.y + this.gap + r * (this.cell + this.gap) + (this.scrollPos || 0);
            b.pos = new Vector(px, py);
            // mark visible if intersects picker rect
            const visible = !(py + this.cell < this.pos.y || py > this.pos.y + this.size.y);
            b.visible = visible;
            if (visible) b.update(delta);
        }
    }

    draw(Draw){
        if (!this.visible) return;
        // background
        Draw.rect(this.pos, this.size, '#00000066');
        if (!this.image || !this.entries || this.entries.length === 0) return;
        // clip to picker area
        Draw.maskRect(this.pos, this.size);
        for (let i = 0; i < this.buttons.length; i++){
            const b = this.buttons[i];
            if (!b.visible) continue;
            const e = b.__entry;
            const pos = b.pos.add(this.offset);
            // draw tile from sheet using Draw.tile API: supply sheet-like object
            try{
                Draw.tile({ sheet: this.image, slicePx: this.slice }, pos, new Vector(this.cell, this.cell), Number(e.index), 0, null, 1, false);
            } catch(e){}
            // highlight selection: cyan outline (00FFFF), 4px
            if (this.selected === e.key){
                Draw.rect(pos, new Vector(this.cell, this.cell), '#00000000', false, true, 4, '#00FFFF');
            }
            // let button draw hover/pressed overlay
            b.draw(Draw);
        }
        Draw.clearMask();
    }
}
