import Signal from "../Signal.js";
import Vector from "../Vector.js";
import Color from "../Color.js";
import Input from './Input.js';
import Timer from "../Timer.js";

/**
 * Cat sprite: drawing + animation logic extracted from TestSprite.
 * Usage matches TestSprite constructor so it can be swapped in easily.
 */
export default class Cat {
    constructor(keys, Draw, pos, size, spriteSheet){
        // basic state
        this.size = size;                   // Vector (dst draw size in pixels)
        this.pos = pos.clone();             // Vector (top-left in world/local coords)
        this.vlos = Vector.zero();          // keep velocity available for future physics use
        this.rotation = 0;
        this.Draw = Draw;
        this.destroy = new Signal();
        this.color = new Color(1,1,1,1);
        // physics
        this.mass = 3; // light creature
        this.restitution = 0.35; // less bouncy collisions
        // jumping state (set by scene ground checks)
        this.jumpAllowed = false;
        // ground-check configuration: explicit offset and size vectors
        // `groundCheckOffset` is the offset (in world pixels) from `this.pos` (top-left)
        // to the ground-check rect's top-left. `groundCheckSize` is the rect size.
        // Defaults are set using the sprite size for convenience but can be overridden.
        this.groundCheckOffset = new Vector(103, this.size.y/2+30);
        this.groundCheckSize = new Vector(48, 6);
        this.groundProbeRadius = 3; // probe radius in px (can be tuned)
        // Render-only adjustments (do not affect physics/collision center)
        this.renderScale = 1/2;                 // ~0.6667 shrink (divide by ~1.5)
        this.renderOffset = new Vector(0, -38); // raise sprite a bit so hitbox aligns visually

        // input (default for now so we can move freely in CollisionScene)
        this.keys = keys;
        this.input = new Input(keys, 'platformer');
        this.input.onJump.connect(()=>{ if (this.jumpAllowed) this.vlos.y = -7; })
        this.facing = 1; // 1 = right, -1 = left

        // animation state (copied from TestSprite)
        this.sheet = spriteSheet; // instance of SpriteSheet
        this.anim = 'sit';
        this.animFrame = 0;
        this.animTimer = 0;
        this.idleTime = 0;
        this.idleCooldown = 10;
        this.animFps = 8; // default fps
        this.animTimer = new Timer("loop", 1/this.animFps);
        this.animTimer.onLoop.connect(()=>{ this.animFrame += 1; });
        this.animTimer.start();

        // basic movement params
        this.speed = 90;      // acceleration magnitude (px/s^2)
        // friction is used as an exponential base: v.x *= friction ** delta
        // smaller values produce stronger damping; default tuned for snappy control
        this.friction = 0.0005; // exponential friction base (tuned stronger)
        // additional ground friction multiplier applied when grounded (0..1)
        this.groundFriction = 0.98;

        // Holding / throwing configuration (tweak these to change feel)
        // Visual position of a held box relative to the cat's top-left
        this.holdOffset = new Vector(100, 40);
        // Offset where the box will be spawned when throwing (relative to cat)
        this.throwOffset = new Vector(100, 40);
        // Offset where the box will be placed when dropping (relative to cat)
        this.dropOffset = new Vector(100, 50);
        // Amount to displace the cat when dropping/throwing (push the cat a bit)
        this.dropCatOffset = new Vector(0, -100);
        // Throwing impulse (added to box vlos when thrown). X is along facing (signed by scene)
        this.throwPower = new Vector(30, -10);
        // Offset to place a box when dropping while airborne (placed beneath the cat)
        this.airDropOffset = new Vector(100, 150);

        // Holding state
        this.heldEntity = null; // index into scene.entitiesRuntime or null when not holding
    }

    update(delta){
        // update input for facing + run/sit state and velocity
        const dir = this.input.update();
        // accelerate in input direction
        this.vlos.addS(dir.mult(delta).multS(this.speed));
        if(this.keys.held('Shift')) this.vlos.x *= 0.8;
        if (Math.sign(dir.x)) {
            this.facing = Math.sign(dir.x);
            this.idleTime = 0;
            // if currently in a constrained anim (e.g., jump/land) keep it, else run
            this.anim = (this.anim === 'jump') ? 'jump' : 'run';
        } else {
            this.idleTime += 1; // simple frame-based idle timer (matches TestSprite style)
        }
        // simple friction (exponential). Also apply extra ground friction when on ground.
        this.vlos.x *= this.friction ** delta;
        try {
            if (this.jumpAllowed) this.vlos.x *= this.groundFriction;
        } catch (e) {}

        // advance animation timer and wrap frames
        this.animTimer.update(delta);
        if (this.sheet && this.anim && this.sheet.animations) {
            const meta = this.sheet.animations.get(this.anim);
            if (meta && meta.frameCount) this.animFrame = this.animFrame % meta.frameCount;
        }

        // idle animation cycle (copied)
        const idleAnimations = [['sit',0],['lick',60],['lick2',120],['sleep',180]];
        for (let anim of idleAnimations){
            if (this.idleTime === 24 * anim[1] + 1) {
                this.anim = anim[0];
                this.animFrame = 0;
            } else if (this.sheet && this.sheet.animations) {
                const meta = this.sheet.animations.get(this.anim);
                if (meta && this.animFrame === meta.frameCount - 1 && this.anim === anim[0] && this.anim !== 'sleep'){
                    this.anim = 'sit';
                }
            }
        }

        // integrate velocity
        this.pos.addS(this.vlos.clone());
    }

    adios(){ this.destroy.emit(); }

    draw(levelOffset){
        if (this.sheet && this.anim) {
            const invert = this.facing < 0 ? { x: -1, y: 1 } : null;
            const s = this.renderScale || 1;
            const drawSize = this.size.mult(s);
            // center the scaled sprite within the original rect, then apply a render offset to raise
            const centerOffset = new Vector((this.size.x - drawSize.x) * 0.5, (this.size.y - drawSize.y) * 0.5);
            const drawPos = this.pos.add(levelOffset).add(centerOffset).add(this.renderOffset);
            this.Draw.sheet(this.sheet, drawPos, drawSize, this.anim, this.animFrame, invert, 1, false);
        }
    }

    /**
     * Return probe points (world coordinates) and radius for ground testing.
     * @returns {{points:Vector[], radius:number}}
     */
    getGroundProbePoints(){
        const rect = this.getGroundCheckRect();
        // choose small horizontal margins for left/right probes (use 10% of rect width or 4px)
        const margin = Math.max(4, Math.floor(rect.size.x * 0.1));
        const y = rect.pos.y + (rect.size.y * 0.5);
        const pts = [
            new Vector(rect.pos.x + margin, y),
            new Vector(rect.pos.x + rect.size.x * 0.5, y),
            new Vector(rect.pos.x + rect.size.x - margin, y)
        ];
        return { points: pts, radius: this.groundProbeRadius };
    }

    /**
     * Return the small rect used for ground-check visualization (world coords).
     * @returns {{pos:Vector, size:Vector}}
     */
    getGroundCheckRect(){
        const topLeft = this.pos.clone();
        const rectPos = topLeft.add(this.groundCheckOffset);
        const rectSize = this.groundCheckSize.clone();
        return { pos: rectPos, size: rectSize };
    }

    /**
     * Draw the ground-check rect using this.Draw. Pass an optional levelOffset
     * (same offset passed to draw()).
     */
    drawGroundCheck(levelOffset){
        try {
            if (!this.Draw) return;
            const off = levelOffset || new Vector(0,0);
            const r = this.getGroundCheckRect();
            const rectPos = r.pos.add(off);
            const rectSize = r.size;
            const fill = this.jumpAllowed ? '#00FF0044' : '#FF000044';
            const outline = this.jumpAllowed ? '#00FF00FF' : '#FF0000FF';
            this.Draw.rect(rectPos, rectSize, fill, true, true, 1, outline);
        } catch (e) {}
    }
}
