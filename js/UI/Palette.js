import Vector from '../Vector.js';
import Menu from './Menu.js';
import UIImage from './Image.js';
import UIButton from './Button.js';
import UIRect from './Rect.js';

// Small UI element that draws a single tile from a TileSheet using Draw.tile
class UITile {
    constructor(sheetObj, tileKey, pos, size, layer) {
        this.sheetObj = sheetObj;
        this.tileKey = tileKey;
        this.pos = pos;
        this.size = size;
        this.layer = layer;
        this.offset = new Vector(0,0);
        this.visible = true;
    }
    addOffset(offset){ this.offset = offset; }
    update(delta){}
    draw(Draw){
        if(!this.visible) return;
        try{
            if (this.sheetObj) {
                Draw.tile(this.sheetObj, this.offset.add(this.pos), this.size, this.tileKey, 0, new Vector(1,1), 1, false);
            } else if (this.tileKey && this.tileKey.image) {
                // fallback: draw image if provided
                Draw.image(this.tileKey.image, this.offset.add(this.pos), this.size, 1, 0, 1, false);
            }
        } catch(e){}
    }
}

export default class Palette {
    constructor(scene, mouse, keys, UIDraw, layer = 50) {
        this.scene = scene;
        this.mouse = mouse;
        this.keys = keys;
        this.UIDraw = UIDraw;
        this.layer = layer;

        // visual config
        this.margin = 10;
        // make tiles 2x bigger and use 2 columns
        this.itemSize = 48 * 2;
        this.cols = 2;
        this.spacing = 8;
        this.menuWidth = this.cols * (this.itemSize + this.spacing) + 16;

        // Menu container
        this.menu = new Menu(this.mouse, this.keys, new Vector(0, 0), new Vector(this.menuWidth, 200), this.layer, '#FFFFFF22');
        // keep a map of created elements so we can reposition for scrolling
        this._entries = [];
        this.scrollY = 0;
        this.contentHeight = 0;
    }

    // Rebuild palette entries from scene.tileTypes (array of {sheetId,row,col})
    rebuild() {
        // clear existing
        this.menu.elements.clear();
        this._entries = [];

        const types = Array.isArray(this.scene.tileTypes) ? this.scene.tileTypes : [];
        const colsGrid = this.cols || Math.max(1, Math.floor((this.menuWidth - 16 + this.spacing) / (this.itemSize + this.spacing)));

        for (let i = 0; i < types.length; i++) {
            const t = types[i];
            const c = i % colsGrid;
            const r = Math.floor(i / colsGrid);
            const pos = new Vector(8 + c * (this.itemSize + this.spacing), 8 + r * (this.itemSize + this.spacing));
            // create tile element (draw a specific tile from a TileSheet)
            let sheetObj = null;
            try { sheetObj = (t.sheetId && this.scene._tilemap) ? this.scene._tilemap.getTileSheet(t.sheetId) : null; } catch (e) {}
            const imageEl = new UITile(sheetObj, (typeof t.row !== 'undefined' && typeof t.col !== 'undefined') ? [t.row, t.col] : (t.tileKey || null), pos, new Vector(this.itemSize, this.itemSize), this.layer + 1);
            // button overlay for clicks
            const rectBg = new UIRect(pos, new Vector(this.itemSize, this.itemSize), this.layer + 0,'#333333FF');
            const btn = new UIButton(this.mouse, this.keys, pos, new Vector(this.itemSize, this.itemSize), this.layer + 3,null,'#FFFFFF00','#FFFFFF33','#00000055');
            // store metadata
            btn._tileMeta = t;
            // connect press
            btn.onPressed['left'].connect(() => {
                try {
                    // set scene draw sheet/type
                    this.scene.drawSheet = t.sheetId || this.scene.drawSheet;
                    this.scene.drawType = (typeof t.row !== 'undefined' && typeof t.col !== 'undefined') ? [t.row, t.col] : t.tileKey || this.scene.drawType;
                } catch (e) { console.warn('Palette selection failed', e); }
            });
            this.menu.addElement('rect_' + i, rectBg);
            this.menu.addElement('img_' + i, imageEl);
            this.menu.addElement('btn_' + i, btn);
            this._entries.push({ bg: rectBg, imageEl: imageEl, btn: btn });
        }

        // add save/load buttons at bottom (local positions)
        const cols = colsGrid;
        const rowsUsed = Math.ceil(types.length / cols);
        const gridH = rowsUsed * (this.itemSize + this.spacing) - this.spacing;
        const btnX = 8;
        const btnW = this.menuWidth - 16;
        const btnH = 28;
        const btnYStart = 8 + gridH + this.spacing;
        // Export button
        const exportBtnPos = new Vector(btnX, btnYStart);
        const exportBtn = new UIButton(this.mouse, this.keys, exportBtnPos, new Vector(btnW, btnH), this.layer + 2);
        exportBtn.onPressed['left'].connect(async () => {
            try {
                if (!this.scene.packageManager) this.scene.packageManager = new (await import('../PackageManager.js')).default(this.scene._tilemap, this.scene);
                const mapPayload = {
                    map: (this.scene._tilemap && typeof this.scene._tilemap.toJSON === 'function') ? this.scene._tilemap.toJSON() : null,
                    levelOffset: Vector.encode(this.scene.levelOffset),
                    tileSize: this.scene.tileSize,
                    drawType: this.scene.drawType,
                    drawRot: this.scene.drawRot,
                    drawInvert: this.scene.drawInvert,
                    zoom: this.scene.zoom
                };
                // prefer exportAsTarFile if available
                if (this.scene.packageManager && typeof this.scene.packageManager.exportAsTarFile === 'function') {
                    this.scene.packageManager.exportAsTarFile('tilesheets.tar', mapPayload);
                }
            } catch (e) { console.warn('Export button failed', e); }
        });

        // Import button
        const importBtnPos = new Vector(btnX, btnYStart + btnH + this.spacing);
        const importBtn = new UIButton(this.mouse, this.keys, importBtnPos, new Vector(btnW, btnH), this.layer + 2);
        importBtn.onPressed['left'].connect(async () => {
            try {
                if (this.scene && typeof this.scene.promptImportFiles === 'function') {
                    await this.scene.promptImportFiles();
                }
            } catch (e) { console.warn('Import button failed', e); }
        });

        // Keep export/import buttons fixed to the bottom of the sidebar (not part of the scrolling content)
        this.exportBtn = exportBtn;
        this.importBtn = importBtn;

        // adjust menu height if needed
        const menuH = Math.max(this.menu.size ? this.menu.size.y : 200, btnYStart + btnH + this.spacing + 16);
        this.menu.size = new Vector(this.menuWidth, menuH);

        // record full content height (used for scrolling)
        this.contentHeight = btnYStart + btnH + this.spacing + 16;

        return true;
    }

    // Layout based on UIDraw canvas size
    layout(uiW, uiH) {
        // recompute menu width from cols and tile size
        this.menuWidth = this.cols * (this.itemSize + this.spacing) + 16;
        const menuX = uiW - this.menuWidth - this.margin;
        const menuY = this.margin;
        const menuH = uiH - this.margin * 2;
        this.menu.pos = new Vector(menuX, menuY);
        this.menu.size = new Vector(this.menuWidth, menuH);
        // rebuild positions relative to menu (so local positions remain)
        this.rebuild();
    }

    update(delta) {
        // handle mouse wheel for vertical scroll (uses same API as title scene)
        let wheelDelta = 0;
        try { if (this.mouse && typeof this.mouse.wheel === 'function') wheelDelta = this.mouse.wheel(); } catch (e) {}
        if (wheelDelta && wheelDelta !== 0 && this.mouse.pos.x>1700) {
            // increment scrollY (invert if needed)
            this.scrollY += wheelDelta;
        }

        // clamp scrollY
        // recompute contentHeight from current entries to ensure it reflects all rows
        const totalRows = Math.ceil((this._entries.length || 0) / (this.cols || 1));
        const gridH = totalRows > 0 ? totalRows * (this.itemSize + this.spacing) - this.spacing : 0;
        const btnArea = 28 + this.spacing + 16; // button height + spacing + bottom padding
        this.contentHeight = 8 + gridH + btnArea; // top padding + grid + buttons

        // compute visible area inside the menu (subtract some padding so content can scroll fully)
        const visibleHeight = (this.menu.size && typeof this.menu.size.y === 'number') ? Math.max(0, this.menu.size.y - 16) : (window.innerHeight - 32);
        const maxScroll = Math.max(0, this.contentHeight - 1080);
        if (this.scrollY < 0) this.scrollY = 0;
        if (this.scrollY > maxScroll) this.scrollY = maxScroll;

        // update element offsets to include menu position and scroll
        const base = this.menu.pos ? this.menu.pos.clone() : new Vector(0,0);
        for (let i = 0; i < this._entries.length; i++) {
            const e = this._entries[i];
            const colsG = this.cols || 1;
            const c = i % colsG;
            const r = Math.floor(i / colsG);
            const local = new Vector(8 + c * (this.itemSize + this.spacing), 8 + r * (this.itemSize + this.spacing) - this.scrollY);
            try { e.bg.addOffset(base); e.bg.pos = local; } catch (ex) {}
            try { e.imageEl.addOffset(base); e.imageEl.pos = local; } catch (ex) {}
            try { e.btn.addOffset(base); e.btn.pos = local; } catch (ex) {}
        }

        // update menu (handles mouse masking for elements)
        try { this.menu.update(delta); } catch (e) {}
    }

    draw(Draw) {
        // draw the menu and its children
        try { this.menu.draw(Draw); } catch (e) {}

        // draw selection outline(s) after menu draw so outlines appear above tiles
        try {
            const selSheet = this.scene.drawSheet;
            const selType = this.scene.drawType;
            for (let i = 0; i < this._entries.length; i++) {
                const e = this._entries[i];
                const meta = e.btn && e.btn._tileMeta ? e.btn._tileMeta : null;
                if (!meta) continue;
                let selected = false;
                try {
                    if (meta.sheetId && selSheet && meta.sheetId === selSheet) {
                        if (Array.isArray(selType) && typeof meta.row !== 'undefined' && typeof meta.col !== 'undefined') {
                            selected = (selType[0] === meta.row && selType[1] === meta.col);
                        }
                    }
                } catch (ex) {}
                if (selected) {
                    try {
                        const pos = e.bg.offset.add(e.bg.pos);
                        const size = e.bg.size;
                        Draw.rect(pos, size, '#00000000', false, true, 3, '#FFFFFF88');
                    } catch (ex) {}
                }
            }
        } catch (e) {}
    }
}
