import Vector from '../Vector.js';
import Signal from '../Signal.js';
import Geometry from '../Geometry.js';
import Color from '../Color.js';

export default class UISlider {
    /**
     * 
     * @param {Vector} pos - top-left position
     * @param {Vector} size - slider size
     * @param {number} layer - UI layer
     * @param {string} type - 'scalar' | 'color' | 'vector'
     * @param {any} value - initial value (number, Color, Vector)
     * @param {number} min - min for scalar/vector
     * @param {number} max - max for scalar/vector
     * @param {string} baseColor - background color
     * @param {string} hoverColor - background on hover
     * @param {string} pressedColor - background when dragging
     * @param {string} knobColor - slider knob / handle color
     * @param {any} keybind - optional keybind
     */
    constructor(
        mouse,keys, pos, size, layer = 0, type = 'scalar', value = 0, min = 0, max = 1,
        baseColor = '#444', hoverColor = '#555', pressedColor = '#222', knobColor = '#aaa', keybind = null
    ) {
        this.mouse = mouse;
        this.keys = keys;

        this.pos = pos;
        this.size = size;
        this.layer = layer;
        this.offset = new Vector(0, 0);
        this.visible = true;
        this.keybind = keybind;

        this.type = type;
        this.value = value;
        this.min = min;
        this.colorMode = 'a';
        this.max = max;

        // Colors
        this.baseColor = baseColor;
        this.hoverColor = hoverColor;
        this.pressedColor = pressedColor;
        this.knobColor = knobColor;
        this.currentColor = this.baseColor;

        // State
        this.grabbed = false;

        // Signals
        this.onChange = new Signal();
        this.onGrab = new Signal();
        this.onRelease = new Signal();
    }

    addOffset(offset) { this.offset = offset; }

    update(delta) {
        if (!this.visible) return;

        const mousePos = this.mouse.pos;
        const pos = this.pos.add(this.offset);
        const hovering = Geometry.pointInRect(mousePos, pos, this.size);

        // Hover color
        this.currentColor = hovering ? this.hoverColor : this.baseColor;

        // Grab start
        if (hovering && this.mouse.pressed('left')) {
            if (!this.grabbed) {
                this.grabbed = true;
                this.onGrab.emit();
            }
        }

        // Grab release
        if (this.grabbed && this.mouse.released('left')) {
            this.grabbed = false;
            this.onRelease.emit();
        }

        // Update value if grabbed
        if (this.grabbed) {
            this.currentColor = this.pressedColor;

            if (this.type === 'color') {
                // --- Dynamically switch colorMode based on modifiers ---
                if (this.keys.held('Control')) this.colorMode = 'c'; // Hue
                else if (this.keys.held('Shift')) this.colorMode = 'b'; // Saturation
                else if (this.keys.held('Alt')) this.colorMode = 'd'; // Value
                else if (this.keys.held('z')) this.colorMode = 'a'; // Value
                else this.colorMode = 'a'; // Alpha / default

                const relX = Math.min(Math.max(mousePos.x - pos.x, 0), this.size.x) / this.size.x;
                if (this.value.toRgb) this.value[this.colorMode] = relX;
            } else if (this.type === 'scalar') {
                const relX = Math.min(Math.max(mousePos.x - pos.x, 0), this.size.x);
                this.value = this.min + (relX / this.size.x) * (this.max - this.min);
            } else if (this.type === 'vector') {
                const rel = new Vector(
                    Math.min(Math.max(mousePos.x - pos.x, 0), this.size.x) / this.size.x,
                    Math.min(Math.max(mousePos.y - pos.y, 0), this.size.y) / this.size.y
                );
                this.value.x = this.min + rel.x * (this.max - this.min);
                this.value.y = this.min + rel.y * (this.max - this.min);
            }

            this.onChange.emit(this.value);
        }

        // Keybind support
        if (this.keybind !== null && this.keys.pressed(this.keybind)) {
            this.grabbed = true;
        }
    }

    draw(Draw) {
        if (!this.visible) return;

        const pos = this.pos.add(this.offset);

        // Slider background
        Draw.rect(pos, this.size, this.currentColor);

        // Draw fill / knob
        if (this.type === 'scalar') {
            const width = ((this.value - this.min) / (this.max - this.min)) * this.size.x;
            Draw.rect(pos, new Vector(width, this.size.y), this.knobColor);
        } else if (this.type === 'vector') {
            const dotPos = new Vector(
                pos.x + ((this.value.x - this.min) / (this.max - this.min)) * this.size.x - 5,
                pos.y + ((this.value.y - this.min) / (this.max - this.min)) * this.size.y - 5
            );
            Draw.rect(dotPos, new Vector(10, 10), this.knobColor);
        } else if (this.type === 'color') {
            const steps = 20;
            let gradientColors = [];

            // Build gradient across the active channel
            for (let i = 0; i <= steps; i++) {
                let color = new Color(this.value.a, this.value.b, this.value.c, this.value.d, 'hsv');
                const t = i / steps;

                if      (this.colorMode === 'a') color.a = t; // Hue
                else if (this.colorMode === 'b') color.b = t; // Saturation
                else if (this.colorMode === 'c') color.c = t; // Value
                else if (this.colorMode === 'd') color.d = t; // Alpha

                gradientColors.push(color.toHex());
            }

            // Draw full gradient background
            Draw.rect(pos, this.size, gradientColors, 'gradient');

            // Draw filled portion up to current value
            const fillWidth = this.value[this.colorMode] * this.size.x;
            if (fillWidth > 0) {
                Draw.rect(pos, new Vector(fillWidth, this.size.y), '#00000055');
            }

            // Draw knob
            const knobPos = new Vector(pos.x + fillWidth - 5, pos.y);
            Draw.rect(knobPos, new Vector(10, this.size.y), this.knobColor);
        }

        // Border
        Draw.rect(pos, this.size, '#222222', false, true, 5,'#222222');
    }
}