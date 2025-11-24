export default class Keys { // Key input
    constructor() {
        this.keys = {};
        this.firstFrame = {};
        this.releasedFrame = {};

        window.addEventListener("keydown", e => {
            // prevent browser interfering with shortcuts
            if (e.key === " " || (e.altKey)) {
                e.preventDefault();
            }

            if (!this.keys[e.key]?.state) {
                this.keys[e.key] = { state: true, time: 0 };
                this.firstFrame[e.key] = true;
            }
        });

        window.addEventListener("keyup", e => {
            if ((e.altKey)) {
                e.preventDefault();
            }
            this.keys[e.key] = { state: false, time: 0 };
            this.firstFrame[e.key] = false;
            this.releasedFrame[e.key] = true; // mark released
        });
    }

    update(delta) {
        this.lastDelta = delta;
        for (const k in this.keys) {
            const key = this.keys[k];
            key.time = key.state ? key.time + delta : 0;
        }
    }

    pressed(key) {
        const delta = this.lastDelta || 0;
        if (key === 'any') {
            for (const k in this.keys) {
                if (this.keys[k] && this.keys[k].state && Math.abs(this.keys[k].time - delta) < 1e-6) {
                    return true;
                }
            }
            return false;
        }
        const k = this.keys[key];
        return (k && k.state && Math.abs(k.time - delta) < 1e-6);
    }

    released(key) {
        if (key === 'any') {
            for (const k in this.releasedFrame) {
                if (this.releasedFrame[k]) {
                    this.releasedFrame[k] = false;
                    return true;
                }
            }
            return false;
        }
        if (this.releasedFrame[key]) {
            this.releasedFrame[key] = false;
            return true;
        }
        return false;
    }

    held(key, returnTime = false) {
        if (key === 'any') {
            for (const k in this.keys) {
                if (this.keys[k] && this.keys[k].state) {
                    return returnTime ? this.keys[k].time : true;
                }
            }
            return returnTime ? 0 : false;
        }
        const k = this.keys[key];
        return (k && k.state) ? (returnTime ? k.time : true) : (returnTime ? 0 : false);
    }

    comboPressed(keysArray) {
        const all = keysArray.every(k => this.firstFrame[k]);
        if (all) keysArray.forEach(k => (this.firstFrame[k] = false));
        return all;
    }

    comboHeld(keysArray, returnTime = false) {
        if (!keysArray.every(k => this.keys[k]?.state)) return returnTime ? 0 : false;
        return returnTime ? Math.min(...keysArray.map(k => this.keys[k].time)) : true;
    }
}