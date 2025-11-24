import Vector from "../Vector.js";
import Signal from "../Signal.js";
import Timer from "../Timer.js";

// Simple static sprite for editor/runtime entities with a single image
export default class Sprite {
    constructor(Draw, pos, size, spriteSheet){
        // basic state
        this.size = size;                   // Vector (dst draw size in pixels)
        this.pos = pos.clone();             // Vector (top-left in world/local coords)
        this.vlos = Vector.zero();          // keep velocity available for future physics use
        this.rotation = 0;
        this.Draw = Draw;
        this.destroy = new Signal();

    // physics
    this.mass = 5; // default box is heavier than cat
    this.restitution = 1.0; // elastic collisions

        // Render-only adjustments (do not affect physics/collision center)
        this.renderScale = 1/2;                 // ~0.6667 shrink (divide by ~1.5)
        this.renderOffset = new Vector(0, -38); // raise sprite a bit so hitbox aligns visually

        // animation state (copied from TestSprite)
        this.sheet = spriteSheet; // instance of SpriteSheet
        this.anim = 'base';
        this.animFrame = 0;
        this.animTimer = 0;
        this.animFps = 8; // default fps
        this.animTimer = new Timer("loop", 1/this.animFps);
        this.animTimer.onLoop.connect(()=>{ this.animFrame += 1; });
        this.animTimer.start();

        // basic movement params
        this.invert = 1
        this.speed = 100;      // acceleration magnitude (px/s^2)
        this.friction = 0.001; // exponential friction base
    }

    update(delta){
        // If this sprite has an input controller (player-controlled), apply it.
        // Otherwise treat this as a passive entity and don't call input.
        if (this.input && typeof this.input.update === 'function') {
            const dir = this.input.update();
            // accelerate in input direction
            this.vlos.addS(dir.mult(delta).multS(this.speed));
        }

        // simple friction
        this.vlos.x *= this.friction ** delta;
        this.vlos.y *= this.friction ** delta;

        // advance animation timer and wrap frames
        this.animTimer.update(delta);
        if (this.sheet && this.anim && this.sheet.animations) {
            const meta = this.sheet.animations.get(this.anim);
            if (meta && meta.frameCount) this.animFrame = this.animFrame % meta.frameCount;
        }


        // integrate velocity
        this.pos.addS(this.vlos.clone());
    }

    adios(){ this.destroy.emit(); }

    draw(levelOffset){
        if (this.sheet && this.anim) {
            const drawPos = this.pos.add(levelOffset);
            this.Draw.sheet(this.sheet, drawPos, this.size, this.anim, this.animFrame, this.invert, 1, false);
        }
    }
}

