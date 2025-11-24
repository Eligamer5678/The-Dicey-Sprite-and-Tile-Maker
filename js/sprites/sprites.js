import Signal from "../Signal.js";
import Vector from "../Vector.js";
import Geometry from "../Geometry.js";
import Color from "../Color.js";
import Input from './Input.js';
import Timer from "../Timer.js";

export class TestSprite {
    constructor(keys,Draw,pos,size,spriteSheet){
        this.size = size;
        this.pos = pos.clone();
        this.vlos = Vector.zero()
        this.speed = 100
        this.rotation = Math.random()*2*Math.PI;
        this.Draw = Draw;
        this.destroy = new Signal()
        this.color = new Color(0.5,1,1,1)
        this.keys = keys
        this.input = new Input(keys,'platformer');

        // Animation Logic
        this.sheet = spriteSheet; // set externally: instance of SpriteSheet
        this.anim = 'sit';
        this.animFrame = 0;
        this.animTimer = 0;
        this.idleTime = 0
        this.idleCooldown = 10
        this.animFps = 8; // default fps for animations
        this.animTimer = new Timer("loop",1/this.animFps)
        this.animTimer.onLoop.connect(()=>{this.animFrame+=1})
        this.animTimer.start()
        this.facing = 1; // 1 = right, -1 = left

    // Physics
        this.onGround = false;
        this.coyoteTime = 0.1;
        this.jumpTime = 0
        this.gravity = 20;
        this.jumpPower = 9.5;
        this.groundY = 1080;
        this.input.onJump.connect(() => {
            this.animFrame = 0
            if(this.jumpTime >= 0) this.vlos.y = -this.jumpPower;
        });
        this.input.onFall.connect(() => {
            this.idleTime = 500
            this.anim = 'sleep'
        })
        // optional references for tile collisions (set externally by scene)
        this.tilemap = null;
        this.tileSize = null;
        this.levelOffset = null;
        // debug visualization
        this.debug = false;
        this._debugTiles = [];
    }

    update(delta){
        // Basic input
        if(this.keys.held('0')){
            this.pos = new Vector(0,0)
            this.vlos = new Vector(0,0)
        }
        const dir = this.input.update();
        this.vlos.addS(dir.mult(delta).multS(this.speed));
        if(Math.sign(dir.x)){
            this.facing = Math.sign(dir.x)
            this.idleTime = 0
            this.anim = this.anim === 'jump' ? 'jump' : 'run'
        }else{
            this.idleTime+=1 // frame based for simplicity
        }

        // Physics
        this.vlos.x *= 0.001 ** delta // Friction
        this.vlos.y += this.gravity * delta; // Gravity
        this.jumpTime -= delta
        
        
        
        
        // Apply movement with tile collisions if a tilemap is available
        if (this.tilemap && this.tileSize) {
            // compute search bounds in tile coordinates (±5 tiles around current sprite)
            const margin = 5;
            const lvlOff = this.levelOffset || new Vector(0,0);
            let left, right, top, bottom;
            if (this._cursorTL && this._cursorBR) {
                left = Math.min(this._cursorTL.x, this._cursorBR.x) - margin;
                right = Math.max(this._cursorTL.x, this._cursorBR.x) + margin;
                top = Math.min(this._cursorTL.y, this._cursorBR.y) - margin;
                bottom = Math.max(this._cursorTL.y, this._cursorBR.y) + margin;
            } else {
                // convert to local coordinates (subtract level offset)
                const localPos = this.pos.clone().sub(lvlOff);
                left = Math.floor((localPos.x) / this.tileSize) - margin;
                right = Math.floor((localPos.x + this.size.x) / this.tileSize) + margin;
                top = Math.floor((localPos.y) / this.tileSize) - margin;
                bottom = Math.floor((localPos.y + this.size.y) / this.tileSize) + margin;
            }

            // this.pos is already in tilemap-local coordinates (draw adds levelOffset when rendering),
            // so use it directly for collision math.
            let curPosLocal = this.pos.clone();
            let curVlosLocal = this.vlos.clone();
            const tileLocalSize = new Vector(this.tileSize, this.tileSize);
            // collect debug info per-tile if requested
            this._debugTiles.length = 0;
            // compute hitbox slightly less than half the draw size, bottom-centered
            const hb = this.size.clone().mult(0.45); // hitbox size (45% of draw size)
            const hbOffset = new Vector((this.size.x - hb.x) / 2, this.size.y - hb.y); // offset from sprite top-left to hitbox top-left
            for (let tx = left; tx <= right; tx++) {
                for (let ty = top; ty <= bottom; ty++) {
                    try {
                        const info = this.tilemap.getTileRenderInfo(tx, ty);
                        if (!info) continue;
                        // tile position in local coords (no levelOffset)
                        const tileLocalPos = new Vector(tx * this.tileSize, ty * this.tileSize);
                        // test using the hitbox centered at bottom-center of the sprite
                        const res = Geometry.spriteToTile(curPosLocal.add(hbOffset), curVlosLocal, hb.clone(), tileLocalPos, tileLocalSize);
                        const collided = !!res;
                        // record debug entry
                        this._debugTiles.push({ tx, ty, tileLocalPos, collided });
                        if (res) {
                            // res.pos is the corrected position for the hitbox top-left; convert back to sprite top-left
                            curPosLocal = res.pos.sub(hbOffset);
                            curVlosLocal = res.vlos;
                            if(res.collided.bottom){
                                this.onGround = true;
                            }
                        }
                    } catch (e) { /* ignore per-tile errors */ }
                }
            }
            // assign resolved local position/velocity back to sprite (pos is local coordinates)
            this.pos = curPosLocal;
            this.vlos = curVlosLocal;
        }
        if(this.onGround){
            this.jumpTime = this.coyoteTime
            if (this.anim === 'jump' || this.anim === 'land') this.anim = 'sit'
        }
        
        // Animation logic
        this.animTimer.update(delta)
        const meta = this.sheet.animations.get(this.anim)
        this.animFrame = this.animFrame % meta.frameCount
        
        // Jump animation
        if(this.jumpTime > 0 && this.jumpTime !== this.coyoteTime && Math.abs(this.vlos.y)>1) this.anim = 'jump';
        if(this.anim === 'jump' && this.animFrame >= 3) this.animFrame = 3;
        if(this.anim === 'land' && this.animFrame <= 4) this.animFrame = 4; // same animation as jump but split include landing

        // Idle animations
        const idleAnimations = [['sit',0],['lick',60],['lick2',120],['sleep',180]]
        for (let anim of idleAnimations){
            if(this.idleTime === 24 * anim[1]+1){ 
                this.anim = anim[0]
                this.animFrame = 0
            }
            else if (this.animFrame === meta.frameCount-1 && this.anim === anim[0] && this.anim !== 'sleep'){
                this.anim = 'sit'
            }
        }

        
         this.pos.addS(this.vlos)
    }

    
    adiós(){
        this.destroy.emit();
    }

    draw(levelOffset){
        if (this.sheet && this.anim) {
            // Draw using Draw.sheet (sheet, pos, size, animation, frame, invert, opacity)
            const invert = this.facing < 0 ? { x: -1, y: 1 } : null;
            this.Draw.sheet(this.sheet, this.pos.add(levelOffset), this.size, this.anim, this.animFrame, invert, 1, false);
        }
        // debug draw: visualize tiles checked and collisions
        if (this.debug && this._debugTiles && this._debugTiles.length && this.Draw) {
            try {
                const drawCtx = (this.Draw && this.Draw.ctx) ? this.Draw.ctx : null;
                const uiW = drawCtx ? drawCtx.canvas.width / (this.Draw && this.Draw.Scale ? this.Draw.Scale.x : 1) : 0;
                const uiH = drawCtx ? drawCtx.canvas.height / (this.Draw && this.Draw.Scale ? this.Draw.Scale.y : 1) : 0;
                const center = new Vector(uiW / 2, uiH / 2);
                const origin = (typeof this.zoomOrigin !== 'undefined' && this.zoomOrigin) ? this.zoomOrigin : center;
                const zoom = (typeof this.zoom === 'number' && this.zoom > 0) ? this.zoom : 1;
                const lvlOff = levelOffset || new Vector(0,0);

                for (const t of this._debugTiles) {
                    const worldTilePos = t.tileLocalPos.add(lvlOff);
                    // draw in world-space and let Draw's current transform handle zoom
                    const worldSize = new Vector(this.tileSize, this.tileSize);
                    if (t.collided) {
                        this.Draw.rect(worldTilePos, worldSize, '#FF000044');
                    } else {
                        this.Draw.rect(worldTilePos, worldSize, '#00000000', false, true, 1, '#00FF00AA');
                    }
                }

                // draw sprite bbox in world-space in magenta
                try {
                    this.Draw.rect(this.pos.clone().add(levelOffset), this.size.clone(), '#00000000', false, true, 2, '#FF00FFAA');
                } catch (e) {}
            } catch (e) { /* ignore debug draw errors */ }
        }
    }
}

