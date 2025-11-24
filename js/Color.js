export default class Color {
    constructor(a, b, c, d = 1, type = 'hsv') {
        this.a = a; // R or H
        this.b = b; // G or S
        this.c = c; // B or V
        this.d = d; // Alpha
        this.type = type; // 'rgb' or 'hsv'
    }

    toRgb(mutate = false) {
        if (this.type === 'rgb') return this;

        if (this.type === 'hsv') {
            let h = this.a; // 0-1
            let s = this.b; // 0-1
            let v = this.c; // 0-1

            let r, g, b;
            const i = Math.floor(h * 6);
            const f = h * 6 - i;
            const p = v * (1 - s);
            const q = v * (1 - f * s);
            const t = v * (1 - (1 - f) * s);

            switch (i % 6) {
                case 0: r = v; g = t; b = p; break;
                case 1: r = q; g = v; b = p; break;
                case 2: r = p; g = v; b = t; break;
                case 3: r = p; g = q; b = v; break;
                case 4: r = t; g = p; b = v; break;
                case 5: r = v; g = p; b = q; break;
            }

            if (mutate) {
                this.a = r * 255;
                this.b = g * 255;
                this.c = b * 255;
                this.type = 'rgb';
                return this;
            }

            return new Color(r * 255, g * 255, b * 255, this.d, 'rgb');
        }
    }

    toHsv(mutate = false) {
        if (this.type === 'hsv') return this;

        if (this.type === 'rgb') {
            const r = this.a / 255;
            const g = this.b / 255;
            const b = this.c / 255;

            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const delta = max - min;

            let h = 0;
            const s = max === 0 ? 0 : delta / max;
            const v = max;

            if (delta !== 0) {
                if (max === r) h = ((g - b) / delta) % 6;
                else if (max === g) h = ((b - r) / delta) + 2;
                else h = ((r - g) / delta) + 4;
            }

            h /= 6; // scale hue to 0-1
            if (h < 0) h += 1;

            if (mutate) {
                this.a = h;
                this.b = s;
                this.c = v;
                this.type = 'hsv';
                return this;
            }

            return new Color(h, s, v, this.d, 'hsv');
        }
    }

    toHex(alpha = this.d) {
        const rgb = this.type === 'rgb' ? this : this.toRgb();

        const toHex = (c) => {
            const hex = Math.round(c).toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        };

        // Multiply alpha (0-1) by 255
        const a = Math.round(alpha * 255);

        return `#${toHex(rgb.a)}${toHex(rgb.b)}${toHex(rgb.c)}${toHex(a)}`;
    }


    static fromHex(hex) {
        hex = hex.replace(/^#/, '');

        // Handle shorthand #rgb or #rgba
        if (hex.length === 3 || hex.length === 4) {
            hex = hex.split('').map(c => c + c).join('');
        }

        let a = 255;
        if (hex.length === 8) {
            a = parseInt(hex.slice(6, 8), 16);
            hex = hex.slice(0, 6);
        }

        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);

        return new Color(r, g, b, a / 255, 'rgb');
    }
    /**
     * Converts a color input (Color instance, hex string, rgb()/rgba() string) to a Color instance.
     * @param {Color|string|object} input
     * @returns {Color}
     */
    static convertColor(input) {
        if (input instanceof Color) return input;
        if (typeof input === 'string') {
            // Hex string
            if (input.startsWith('#')) {
                return Color.fromHex(input);
            }
            // rgb() or rgba()
            const rgbRegex = /^rgba?\(([^)]+)\)$/i;
            const match = input.match(rgbRegex);
            if (match) {
                const parts = match[1].split(',').map(s => s.trim());
                const r = parseFloat(parts[0]);
                const g = parseFloat(parts[1]);
                const b = parseFloat(parts[2]);
                let a = 1;
                if (parts.length === 4) a = parseFloat(parts[3]);
                return new Color(r, g, b, a, 'rgb');
            }
        }
        // Already a Color-like object
        if (input && typeof input === 'object' && 'a' in input && 'b' in input && 'c' in input) {
            // Accepts Color-like objects (duck typing)
            return new Color(input.a, input.b, input.c, input.d ?? 1, input.type ?? 'rgb');
        }
        throw new Error('Cannot convert to Color: ' + input);
    }
}