import Vector from '../Vector.js';
import Menu from './Menu.js';
import UIButton from './Button.js';
import UISlider from './Slider.js';
import Geometry from '../Geometry.js';

export default class AnimationPreviewMenu {
    constructor(mouse, keys, UIDraw, scene, sprite, layer = 1000) {
        this.mouse = mouse;
        this.keys = keys;
        this.UIDraw = UIDraw;
        this.scene = scene;
        this.sprite = sprite;
        this.layer = layer;
        this.visible = true;

        // Fullscreen translucent backdrop menu (captures input via Menu.setMask)
        this.menu = new Menu(this.mouse, this.keys, new Vector(0, 0), new Vector(1920, 1080), this.layer, '#00000088');

        // Center panel size - mobile friendly larger controls
        const w = Math.min(1400, 1600);
        const h = Math.min(900, 980);
        this.panelPos = new Vector(Math.floor((1920 - w) / 2), Math.floor((1080 - h) / 2));
        this.panelSize = new Vector(w, h);

        // create small internal menu used for mask handling and element offsets
        this.panel = new Menu(this.mouse, this.keys, this.panelPos, this.panelSize, this.layer + 1, '#222222FF');

        // controls
        const btnSize = new Vector(180, 56);
        this.onionBtn = new UIButton(this.mouse, this.keys, new Vector(32, 48), btnSize, this.layer + 2, null, '#004488', '#0066AA', '#003355');
        this.onionBtn.onPressed.left.connect(()=>{
            try {
                console.log('AnimationPreviewMenu: onionBtn pressed');
                // Mirror spriteScene 'u' key behavior: prefer stateController, else toggle scene.onionSkin
                try {
                    if (this.scene && this.scene.stateController) {
                        this.scene.stateController.toggleOnionSkin();
                    } else if (this.scene) {
                        this.scene.onionSkin = !(typeof this.scene.onionSkin === 'boolean' ? this.scene.onionSkin : false);
                        // mirror debug log
                        try { console.log('onionSkin toggled to', this.scene.onionSkin); } catch (e) {}
                        // keep scene.state in sync for UIs that read it
                        try { if (!this.scene.state) this.scene.state = {}; if (!this.scene.state.editor) this.scene.state.editor = {}; this.scene.state.editor.onionSkin = !!this.scene.onionSkin; } catch (e) {}
                    }
                } catch (e) {}
                try { if (this.scene && typeof this.scene._playSfx === 'function') this.scene._playSfx('toggle.onionSkin'); } catch (e) {}
            } catch (e) {}
        });

        // layout constants for labeled sliders
        const labelW = 140; const valueW = 84; const leftPad = 32; const rightPad = 32; const gap = 12;
        const sliderH = 40;
        const sliderW = w - (labelW + valueW + leftPad + rightPad + gap * 2);
        const fpsPos = new Vector(leftPad + labelW + gap, 48);
        const fpsSize = new Vector(sliderW, sliderH);
        this.fpsSlider = new UISlider(this.mouse, this.keys, fpsPos, fpsSize, this.layer + 2, 'scalar', (this.scene && typeof this.scene._getSpriteAnimationFps === 'function' && this.scene.selectedAnimation) ? this.scene._getSpriteAnimationFps(this.scene.selectedAnimation, 8) : 8, 0, 32, '#444', '#666', '#333', '#FFFF00', null, { step: 1, ticks: 5, orientation: 'horizontal' });
        this.fpsSlider.onChange.connect((v)=>{
            try {
                const fps = Math.max(0, Math.round(v));
                // snap slider to integer value
                try { this.fpsSlider.value = fps; } catch (e) {}
                console.log('AnimationPreviewMenu: fpsSlider changed ->', fps);
                // update scene state/profile where appropriate (do not assume _setSpriteAnimationProfile exists)
                try {
                    const anim = (this.scene && this.scene.selectedAnimation) ? this.scene.selectedAnimation : null;
                    if (anim) {
                        if (this.scene && this.scene.state && this.scene.state.spriteLayer && this.scene.state.spriteLayer.animationProfiles && this.scene.state.spriteLayer.animationProfiles[anim]) {
                            this.scene.state.spriteLayer.animationProfiles[anim].fps = fps;
                        }
                        if (this.scene && typeof this.scene._setSpriteAnimationProfile === 'function') {
                            this.scene._setSpriteAnimationProfile(anim, { fps: fps }, true);
                        }
                    }
                } catch (e) {}
            } catch (e) {}
        });

        // ensure fpsSlider gets panel offset so pos is relative to panel
        try { this.fpsSlider.addOffset(this.panelPos); } catch (e) {}

        // onion range sliders (before/after)
        const rangeY = 48 + sliderH + 24;
        // Onion sliders: range -5..5 and will be positioned vertically in left column
        // vertical onion sliders: narrow width, tall height
        const vertW = 40;
        const vertH = Math.min(280, this.panelSize.y - 220);
        const leftColX = 24;
        const initStartY = 48 + this.onionBtn.size.y + 12;
        // determine initial onion range values from scene.state (editor) or spriteSheet fallback
        let initBefore = 1, initAfter = 1;
        try {
            if (this.scene && this.scene.state && this.scene.state.editor && typeof this.scene.state.editor.onionRange === 'object') {
                const b = this.scene.state.editor.onionRange.before;
                const a = this.scene.state.editor.onionRange.after;
                if (b !== undefined && b !== null && !Number.isNaN(Number(b))) initBefore = Number(b);
                if (a !== undefined && a !== null && !Number.isNaN(Number(a))) initAfter = Number(a);
            } else if (this.scene && this.scene.state && this.scene.state.spriteSheet && this.scene.state.spriteSheet.onionSkin && Array.isArray(this.scene.state.spriteSheet.onionSkin.distance)) {
                const d = this.scene.state.spriteSheet.onionSkin.distance;
                if (Array.isArray(d)) {
                    if (d[0] !== undefined && d[0] !== null && !Number.isNaN(Number(d[0]))) initBefore = Number(d[0]);
                    if (d[1] !== undefined && d[1] !== null && !Number.isNaN(Number(d[1]))) initAfter = Number(d[1]);
                }
            }
        } catch (e) {}

        // create vertical sliders with correct initial positions and values
        // Use 0..5 ranges for before/after distances (positive distances)
        this.beforeSlider = new UISlider(this.mouse, this.keys, new Vector(leftColX, initStartY), new Vector(vertW, vertH), this.layer + 2, 'scalar', initBefore, 0, 5, '#444', '#666', '#333', '#00FFAA', null, { orientation: 'vertical', step: 1, ticks: 6 });
        this.afterSlider = new UISlider(this.mouse, this.keys, new Vector(leftColX + vertW + 12, initStartY), new Vector(vertW, vertH), this.layer + 2, 'scalar', initAfter, 0, 5, '#444', '#666', '#333', '#00FFAA', null, { orientation: 'vertical', step: 1, ticks: 6 });
        // ensure slider update receives panel offset so mouse masking works
        try { this.beforeSlider.addOffset(this.panelPos); this.afterSlider.addOffset(this.panelPos); } catch (e) {}
        this.beforeSlider.onChange.connect((v)=>{
            try {
                const val = Math.round(v);
                this.beforeSlider.value = val;
                console.log('AnimationPreviewMenu: beforeSlider ->', val);
                if (this.scene && this.scene.state) {
                    try {
                        if (!this.scene.state.editor) this.scene.state.editor = {};
                        if (!this.scene.state.editor.onionRange) this.scene.state.editor.onionRange = { before: 1, after: 1 };
                        this.scene.state.editor.onionRange.before = val;
                    } catch (e) {}
                }
                if (this.scene && this.scene.stateController) this.scene.stateController.setOnionRange(val, (this.scene.state && this.scene.state.editor && this.scene.state.editor.onionRange) ? (this.scene.state.editor.onionRange.after || 0) : 0);
            } catch (e) {}
        });
        this.afterSlider.onChange.connect((v)=>{
            try {
                const val = Math.round(v);
                this.afterSlider.value = val;
                console.log('AnimationPreviewMenu: afterSlider ->', val);
                if (this.scene && this.scene.state) {
                    try {
                        if (!this.scene.state.editor) this.scene.state.editor = {};
                        if (!this.scene.state.editor.onionRange) this.scene.state.editor.onionRange = { before: 1, after: 1 };
                        this.scene.state.editor.onionRange.after = val;
                    } catch (e) {}
                }
                if (this.scene && this.scene.stateController) this.scene.stateController.setOnionRange((this.scene.state && this.scene.state.editor && this.scene.state.editor.onionRange) ? (this.scene.state.editor.onionRange.before || 0) : 0, val);
            } catch (e) {}
        });

        // assemble panel elements (we'll position onion sliders manually in draw)
        this.panel.addElement('onionBtn', this.onionBtn);
        this.panel.addElement('fpsSlider', this.fpsSlider);

        this._open = true;
        this._animTimer = 0;
        this._animIndex = 0;
        this._syncedInitialIndex = false;
        this._previewPhysicalFrame = (this.scene && typeof this.scene.selectedFrame === 'number') ? this.scene.selectedFrame : 0;
        try { if (this.mouse && typeof this.mouse.addMask === 'function') this.mouse.addMask(1); } catch (e) {}
        try { this.mouse.pause && this.mouse.pause(); } catch (e) {}
    }

    close(){
        this._open = false;
        this.visible = false;
        try { if (this.mouse && typeof this.mouse.setMask === 'function') this.mouse.setMask(0); } catch (e) {}
        try { this.mouse.pause && this.mouse.pause(0.05); } catch (e) {}
    }

    update(delta){
        if (!this._open) return;
        // update onion button color to reflect current state before element updates
        try {
            let on = false;
            try {
                if (this.scene && this.scene.state && this.scene.state.editor && typeof this.scene.state.editor.onionSkin !== 'undefined') {
                    on = !!this.scene.state.editor.onionSkin;
                } else if (this.scene && this.scene.state && this.scene.state.spriteSheet && this.scene.state.spriteSheet.onionSkin && typeof this.scene.state.spriteSheet.onionSkin.enabled !== 'undefined') {
                    on = !!this.scene.state.spriteSheet.onionSkin.enabled;
                } else if (this.scene && typeof this.scene.onionSkin !== 'undefined') {
                    on = !!this.scene.onionSkin;
                }
            } catch (e) {}
            this.onionBtn.baseColor = on ? '#66CC66' : '#FF7777';
            this.onionBtn.hoverColor = on ? '#88EE88' : '#FF9999';
            this.onionBtn.pressedColor = on ? '#559955' : '#CC6666';
        } catch (e) {}

        this.menu.update(delta);
        this.panel.update(delta);

        // animation playback: advance scene.selectedFrame according to fps slider
        try {
            const dt = (typeof delta === 'number' && isFinite(delta)) ? delta : (1/60);
            const anim = (this.scene && this.scene.selectedAnimation) ? this.scene.selectedAnimation : null;
            const framesArr = (this.sprite && this.sprite._frames && anim) ? (this.sprite._frames.get(anim) || []) : [];
            // build logical->physical index map (skip group markers)
            const seqIndices = [];
            for (let i = 0; i < framesArr.length; i++){
                const e = framesArr[i];
                if (!e || e.__groupStart || e.__groupEnd) continue;
                seqIndices.push(i);
            }
            const seqLength = seqIndices.length || 0;
            const fps = Math.max(0, Math.round(this.fpsSlider.value || 0));

            // sync initial logical index from scene.selectedFrame once
            if (!this._syncedInitialIndex) {
                try {
                    const selFrame = (this.scene && typeof this.scene.selectedFrame === 'number') ? Number(this.scene.selectedFrame) : null;
                    if (selFrame !== null && seqLength > 0) {
                        const found = seqIndices.indexOf(selFrame);
                        if (found !== -1) this._animIndex = found;
                    }
                } catch (e) {}
                this._syncedInitialIndex = true;
            }

            if (seqLength > 0 && fps > 0) {
                this._animTimer += dt;
                const frameTime = 1 / (fps || 8);
                while (this._animTimer >= frameTime) {
                    this._animTimer -= frameTime;
                    this._animIndex = (this._animIndex + 1) % seqLength;
                }
                // set local preview physical frame (do NOT modify scene.selectedFrame)
                try { this._previewPhysicalFrame = seqIndices[this._animIndex] || 0; } catch (e) { this._previewPhysicalFrame = 0; }
            } else {
                this._animTimer = 0;
                // when paused, preview follows the scene.selectedFrame
                try { this._previewPhysicalFrame = (typeof this.scene.selectedFrame === 'number') ? this.scene.selectedFrame : 0; } catch (e) { this._previewPhysicalFrame = 0; }
            }
        } catch (e) {}

        // position and update left-column onion sliders (stacked vertically)
        try {
            const leftColX = 24; // relative to panel
            const innerX = leftColX;
            const startY = 48 + this.onionBtn.size.y + 12; // relative to panel
            // place before/after sliders within panel coordinates (x is relative to panel)
            this.beforeSlider.pos = new Vector(innerX, startY);
            this.afterSlider.pos = new Vector(innerX + this.beforeSlider.size.x + 12, startY);
            // ensure slider update receives panel offset so mouse masking works
            try { this.beforeSlider.addOffset(this.panelPos); this.afterSlider.addOffset(this.panelPos); } catch (e) {}
            try { this.beforeSlider.update(delta); this.afterSlider.update(delta); } catch (e) {}
        } catch (e) {}

        // If user clicks outside the panel, close
        if (this.mouse && this.mouse.pressed && this.mouse.pressed('left')){
            const mp = this.mouse.pos;
            if (!Geometry.pointInRect(mp, this.panelPos, this.panelSize)){
                this.close();
            }
        }
    }

    draw(){
        if (!this._open) return;
        // draw backdrop (menu.draw handles it)
        this.menu.draw(this.UIDraw);

        // draw center panel background
        this.UIDraw.rect(this.panelPos, this.panelSize, '#111111');

        // draw preview area in center of panel
        const previewSize = Math.min(this.panelSize.x - 200, this.panelSize.y - 220);
        const previewPos = this.panelPos.clone().add(new Vector(Math.floor((this.panelSize.x - previewSize) / 2), 140));
        const previewDim = new Vector(previewSize, previewSize);

        // draw frame (composited if possible)
        try {
            let canvas = null;
            const frameToUse = (typeof this._previewPhysicalFrame === 'number') ? this._previewPhysicalFrame : ((this.scene && typeof this.scene.selectedFrame === 'number') ? this.scene.selectedFrame : 0);
            if (this.scene && typeof this.scene._getCompositedPixelFrame === 'function' && this.scene.selectedAnimation) {
                try { canvas = this.scene._getCompositedPixelFrame(this.scene.selectedAnimation, frameToUse); } catch (e) { canvas = null; }
            }
            if (!canvas && this.sprite && typeof this.sprite.getFrame === 'function' && this.scene && this.scene.selectedAnimation) {
                try { canvas = this.sprite.getFrame(this.scene.selectedAnimation, frameToUse); } catch (e) { canvas = null; }
            }
            if (canvas) {
                this.UIDraw.image(canvas, previewPos, previewDim, null, 0, 1, false);
                // outline to ensure visibility above any backgrounds
                this.UIDraw.rect(previewPos, previewDim, '#FFFFFFAA', false, true, 4, '#FFFFFFAA');
            } else {
                this.UIDraw.text('No preview', previewPos.clone().add(new Vector(8, 20)), '#FFFFFF', 0, 20, { align: 'left' });
                this.UIDraw.rect(previewPos, previewDim, '#FFFFFFAA', false, true, 4, '#FFFFFFAA');
            }
        } catch (e) { /* ignore preview draw errors */ }

        // move FPS slider under preview and match its width
        try {
            const fpsPosUnder = previewPos.clone().add(new Vector(0, previewDim.y + 12));
            this.fpsSlider.pos = fpsPosUnder.sub(this.panelPos); // pos is relative to panel when addOffset(panelPos) used
            this.fpsSlider.size = new Vector(previewDim.x, this.fpsSlider.size.y);
        } catch (e) {}

        // sync fps slider value from scene state when not grabbed
        try {
            const anim = (this.scene && this.scene.selectedAnimation) ? this.scene.selectedAnimation : null;
            let sceneFps = null;
            try {
                if (this.scene && typeof this.scene._getSpriteAnimationFps === 'function' && anim) sceneFps = this.scene._getSpriteAnimationFps(anim, null);
            } catch (e) {}
            try {
                if ((sceneFps === null || sceneFps === undefined) && this.scene && this.scene.state && this.scene.state.spriteLayer && this.scene.state.spriteLayer.animationProfiles && anim) {
                    sceneFps = (this.scene.state.spriteLayer.animationProfiles[anim] && this.scene.state.spriteLayer.animationProfiles[anim].fps) || sceneFps;
                }
            } catch (e) {}
            sceneFps = (sceneFps === null || sceneFps === undefined) ? (this.fpsSlider.value || 8) : Math.max(0, Math.round(Number(sceneFps) || 0));
            if (!this.fpsSlider.grabbed) this.fpsSlider.value = sceneFps;
        } catch (e) {}

        // draw controls (base elements) — draw individual elements so preview stays on top
        try {
            this.onionBtn.draw(this.UIDraw);
            this.fpsSlider.draw(this.UIDraw);
        } catch (e) {}

        // draw onion sliders (they're positioned relative to panel in update())
        try {
            this.beforeSlider.draw(this.UIDraw);
            this.afterSlider.draw(this.UIDraw);
        } catch (e) {}

        // overlay labels, ticks and numeric values for sliders and button
        try {
            const w = this.panelSize.x;
            const leftPad = 32, rightPad = 32, gap = 12, labelW = 140, valueW = 84;
            // FPS label

            // ticks are rendered by the slider itself (configured with ticks option)
            // fps value to right
            const fpsValPos = this.panelPos.clone().add(new Vector(this.panelSize.x - rightPad - valueW + 8, 48 + 8));
            const fpsVal = Math.round(this.fpsSlider.value || 0);
            this.UIDraw.text(String(fpsVal), fpsValPos, '#FFFFFF', 0, 16, { align: 'left' });

            // Onion button text
            const btnCenter = this.panelPos.clone().add(this.onionBtn.pos).add(new Vector(this.onionBtn.size.x/2, this.onionBtn.size.y/2));
            let onState = false;
            try {
                if (this.scene && this.scene.state && this.scene.state.editor && typeof this.scene.state.editor.onionSkin !== 'undefined') onState = !!this.scene.state.editor.onionSkin;
                else if (this.scene && this.scene.state && this.scene.state.spriteSheet && this.scene.state.spriteSheet.onionSkin && typeof this.scene.state.spriteSheet.onionSkin.enabled !== 'undefined') onState = !!this.scene.state.spriteSheet.onionSkin.enabled;
                else if (this.scene && typeof this.scene.onionSkin !== 'undefined') onState = !!this.scene.onionSkin;
            } catch (e) {}
            const btnText = 'Onion: ' + (onState ? 'On' : 'Off');
            this.UIDraw.text(btnText, btnCenter.add(new Vector(0,6)), '#111111', 0, 16, { align: 'center' });

            // Onion sliders render their ticks themselves (vertical orientation)

        } catch (e) {}
    }
}
