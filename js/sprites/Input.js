import Vector from '../Vector.js';
import Signal from '../Signal.js';

/**
 * Input
 * Normalizes multiple input sources (keyboard, on-screen, etc.) into a single direction vector.
 *
 * Usage:
 * const input = new Input(keys);
 * input.update(); // call each frame (or when input may have changed)
 * const dir = input.dir; // Vector (normalized)
 * input.changed.connect((d) => { ... })
 *
 * The class also exposes `setFromVector(v)` for external controllers (touch joystick) to feed directions.
 */
export default class Input {
    /**
     * constructor(keys, type='default', options = {})
     * Backwards compatible: if second arg is an object, treats it as options.
     */
    constructor(keys, type = 'default', options = {}) {
        // Backwards compat: allow constructor(keys, options)
        if (typeof type === 'object' && options === undefined) {
            options = type;
            type = 'default';
        }
        if (typeof type === 'object' && Object.keys(type).length > 0 && typeof options === 'object') {
            // called as (keys, options) where developer passed options in second arg
            options = type;
            type = options.type || 'default';
        }

        this.keys = keys;
        this.type = type || 'default';
        this.options = options || {};
        
        this.dir = new Vector(0, 0);
        this._prev = new Vector(0, 0);
        this.onChange = new Signal(); // emits the new Vector when it changes

        // Key mappings (arrays of key strings compatible with Keys.held/pressed)
        this.map = {
            up: options.up || ['w', 'W', 'ArrowUp'],
            down: options.down || ['s', 'S', 'ArrowDown'],
            left: options.left || ['a', 'A', 'ArrowLeft'],
            right: options.right || ['d', 'D', 'ArrowRight']
        };

        // whether to normalize diagonal movement to unit length
        this.normalizeDiagonal = options.normalizeDiagonal !== undefined ? options.normalizeDiagonal : true;

        // deadzone threshold for treating small vectors as zero
        this.deadzone = options.deadzone || 1e-3;

        // optional external vector override (e.g., virtual joystick). When set, it will be used instead of keys.
        this.external = null;

        // Platformer-specific signals
        this.onJump = new Signal(); // emits when jump is pressed (pressed, not held)
        this.onFall = new Signal();
        this.jumpKeys = this.options.jumpKeys || ['w', 'W', 'ArrowUp', ' '];
        this.fallKeys = this.options.fallKeys || ['s','S','ArrowDown']
        this.jumpCooldown = 0;
        this.jumpCooldownMax = 5;
    }

    // Read the Keys instance and compute direction. Call this each frame (or when input changes).
    update() {
        let x = 0, y = 0;
        this.jumpCooldown-=1

        if (this.external) {
            x = this.external.x || 0;
            y = this.external.y || 0;
        } else {
            // horizontal
            if (this._anyHeld(this.map.right)) x += 1;
            if (this._anyHeld(this.map.left)) x -= 1;
            // vertical (up is -1 to match game conventions where down is positive)
            if (this._anyHeld(this.map.down)) y += 1;
            if (this._anyHeld(this.map.up)) y -= 1;
        }

        // For platformer type we only provide horizontal axis in dir (y = 0)
        if (this.type === 'platformer') {
            y = 0;
        }

        let v = new Vector(x, y);
        if (this.normalizeDiagonal && v.mag() > 0) v = v.normalize();
        if (v.mag() <= this.deadzone) v = new Vector(0, 0);

        // only emit on change
        if (!this.dir.equals(v)) {
            this.dir = v;
            this.onChange.emit(this.dir);
        }

        this._prev = this.dir.clone();

        // Platformer: detect jump press events (use Keys.pressed)
        for (const k of this.jumpKeys) {
            if (this.keys.held(k,true)<0.3 && this.jumpCooldown < 0 && this.keys.held(k)) {
                this.onJump.emit(k)
                this.jumpCooldown = this.jumpCooldownMax
            }
        }
        
        for (const f of this.fallKeys) {
            if (this.keys.released(f)) {
                this.onFall.emit(f)
            }
        }
        
        return this.dir;
    }

    // Helper to test any key in an array is currently held
    _anyHeld(arr) {
        if (!Array.isArray(arr)) return false;
        for (const k of arr) if (this.keys.held(k)) return true;
        return false;
    }

    // Allow external inputs (remote joystick, touch) to set direction vector (not normalized automatically)
    setFromVector(v, { normalize = true } = {}) {
        if (!v) {
            this.external = null;
        } else {
            const vec = new Vector(v.x || 0, v.y || 0);
            this.external = normalize ? vec.normalize() : vec;
        }
        // update once immediately
        this.update();
    }



    clear() {
        this.onChange.clear();
    }
}
