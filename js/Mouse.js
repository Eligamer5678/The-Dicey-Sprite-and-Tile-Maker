import Vector from './Vector.js';

export default class Mouse {
    constructor(rect, offset = new Vector(0, 0), scale = 1) {
        this.rect = rect;
        this.scale = scale;
        this.pos = new Vector();
        // Tap detection variables
        this._tapStart = 0;
        this._tapStartX = 0;
        this._tapStartY = 0;
        this._TAP_THRESHOLD = 200; // ms
        this._MOVE_THRESHOLD = 10; // px
        this.prevPos = new Vector();
        this.grabPos = null;
        this.scrollDelta = 0;
        this._lastScroll = 0;
        this.pauseTime = 0;
        this.prevDelta = 0;
        this.offset = offset;
        this.canvasScale = new Vector(1,1);

        // === Power system ===
        this.power = 0;  // current input context power
        this.mask = 0;   // max power allowed

        this.buttons = {
            left: this._makeButton(),
            middle: this._makeButton(),
            right: this._makeButton()
        };

        // Use Pointer Events (covers mouse, touch, pen)
        window.addEventListener("pointermove", e => this._onMove(e));
        // Prevent browser navigation from extra mouse buttons (X1/X2). Some browsers
        // map the back/forward buttons to button values 3 and 4. Intercept pointerdown
        // and auxclick to call preventDefault so the browser doesn't navigate.
        window.addEventListener("pointerdown", e => {
            try {
                if (typeof e.button === 'number' && (e.button === 3 || e.button === 4)) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                }
            } catch (ex) {}
            this._setButton(e.button, 1);
        });
        window.addEventListener("pointerup", e => this._setButton(e.button, 0));
        // auxclick is fired for non-primary buttons in some browsers; block back/forward here as well
        window.addEventListener('auxclick', e => {
            try {
                if (typeof e.button === 'number' && (e.button === 3 || e.button === 4)) {
                    console.log('blocked back nav')
                    e.preventDefault();
                    e.stopImmediatePropagation();
                }
            } catch (ex) {}
        });
        // capture wheel events; we may want to override ctrl+wheel for zooming
        this._lastWheelDelta = 0;
        this._lastWheelCtrl = false;
        this._lastWheel = 0; // value exposed to update() consumers
        this._lastWheelDeltaX = 0; // horizontal wheel (touchpad two-finger) accumulator
        this._lastWheelX = 0;
        window.addEventListener("wheel", e => {
            // if ctrl is held, prevent default browser zoom so our app can handle it
            // inside your wheel listener in Mouse.js (handler has access to `this` and `this.rect`)
        try {
            // If user is doing ctrl+wheel (pinch/zoom), prevent default so browser doesn't zoom
            if (e.ctrlKey) {
                e.preventDefault();
            }

            // Detect large horizontal two-finger swipes (likely trackpad back/forward)
            const absX = Math.abs(e.deltaX || 0);
            const absY = Math.abs(e.deltaY || 0);

            // Sensitivity thresholds: tune these to taste.
            const HORIZONTAL_THRESHOLD = 30;      // minimum deltaX to treat as swipe
            const HORIZONTAL_DOMINANCE = 1.5;     // require deltaX > HORIZONTAL_DOMINANCE * deltaY

            // Only prevent when the pointer is over our canvas/UI area to avoid globally blocking horizontal scrolling.
            const rect = this.rect || { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
            const insideApp =
                e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom;

            if (insideApp && absX > HORIZONTAL_THRESHOLD && absX > absY * HORIZONTAL_DOMINANCE) {
                // This is likely a two-finger horizontal swipe — prevent browser back/forward
                e.preventDefault();
                e.stopImmediatePropagation();
            }
        } catch (err) {
            /* ignore */
        }                               
            this.scrollDelta += e.deltaY;
            this._lastWheelDelta += e.deltaY;
            this._lastWheelDeltaX += e.deltaX;
            this._lastWheelCtrl = !!e.ctrlKey;
        }, { passive: false });
        window.addEventListener("touchstart", e => {
            const touch = e.changedTouches[0];
            this._tapStart = e.timeStamp;
            this._tapStartX = touch.clientX;
            this._tapStartY = touch.clientY;
            this._setButton('left', 1);
            this.pos.x = this._tapStartX
            this.pos.y = this._tapStartY
            
        });
        window.addEventListener("touchend", e => {
            const touch = e.changedTouches[0];
            const tapDuration = e.timeStamp - this._tapStart;
            const moveX = Math.abs(touch.clientX - this._tapStartX);
            const moveY = Math.abs(touch.clientY - this._tapStartY);
            if (tapDuration < this._TAP_THRESHOLD && moveX < this._MOVE_THRESHOLD && moveY < this._MOVE_THRESHOLD) {
                setTimeout(() => this._setButton(0, 0), 10); // Release after short delay
                this._setButton('left', 0);
            }
        });
    }

    _onMove(e) {
        this.prevPos = this.pos.clone();
        this.pos = new Vector(
            (e.clientX - this.rect.left + this.offset.x) * this.scale/this.canvasScale.x,
            (e.clientY - this.rect.top + this.offset.y) * this.scale/this.canvasScale.y
        );
    }

    updateRect(rect) {
        this.prevPos = new Vector(
            (this.prevPos.x * (rect.left / this.rect.left)),
            (this.prevPos.y * (rect.top / this.rect.top))
        );
        this.rect = rect;
        this.pos = new Vector(
            (this.pos.x * (rect.left / this.rect.left)),
            (this.pos.y * (rect.top / this.rect.top))
        );
    }

    // === Power Control ===
    setPower(level) { this.power = level; }
    setOffset(offset) { this.offset = offset; }
    setMask(level) { this.mask = level; }
    addMask(amount) { this.mask += amount; }
    addPower(amount) { this.power += amount; }
    _allowed() { return this.power >= this.mask; }
    pause(duration = 0.1) { this.pauseTime = duration; }
    setScale(scale) { this.scale = scale; }

    _makeButton() {
        return { state: 0, time: 0, prev: 0, justReleased: 0 };
    }

    _setButton(code, val) {
        // Chromebook/Touch: treat button -1 or undefined as left click
        if (code === 0 || code === -1 || code === undefined) this.buttons.left.state = val;
        if (code === 1) this.buttons.middle.state = val;
        if (code === 2) this.buttons.right.state = val;
    }

    update(delta) {
        if (this.pauseTime > 0) {
            this.pauseTime -= delta;
            if (this.pauseTime < 0) this.pauseTime = 0;
        }
        for (const b of Object.values(this.buttons)) {
            b.time = b.state ? b.time + delta : 0;
            b.justReleased = b.prev && !b.state;
            b.prev = b.state;
        }
        this.prevDelta = delta;
        this._lastScroll = this.scrollDelta;
        this.scrollDelta = 0;
        // expose last wheel delta and ctrl flag to consumers, then reset
        this._lastWheel = this._lastWheelDelta;
        this._lastWheelDelta = 0;
        this._lastWheelCtrlFlag = this._lastWheelCtrl;
        this._lastWheelCtrl = false;
    // expose horizontal wheel delta as well
    this._lastWheelX = this._lastWheelDeltaX;
    this._lastWheelDeltaX = 0;
        this.delta = this.prevPos.sub(this.pos);
    }

    pressed(button = null) {
        if (button === null || button === 'any') {
            return this.pressed("left") || this.pressed("middle") || this.pressed("right");
        }
        if (this.buttons[button].time > this.prevDelta + 0.001) return false;
        if (this.pauseTime > 0) return false;
        if (!this._allowed()) return false;
        return !!this.buttons[button].state;
    }

    held(button, returnTime = false) {
        if (this.pauseTime > 0) return returnTime ? 0 : false;
        if (!this._allowed()) return returnTime ? 0 : false;
        const b = this.buttons[button];
        return returnTime ? b.time : !!b.state;
    }

    released(button) {
        if (this.pauseTime > 0) return false;
        if (!this._allowed()) return false;
        return !!this.buttons[button].justReleased;
    }

    grab(pos) { this.grabPos = pos.clone(); }
    releaseGrab() { this.grabPos = null; }

    getGrabDelta() {
        if (!this.grabPos) return new Vector(0, 0);
        return this.pos.sub(this.grabPos);
    }

    scroll(mode = null, returnBool = false) {
        if (!this._allowed()) return returnBool ? false : 0;
        let delta = this._lastScroll;
        if (mode === "up" && delta >= 0) delta = 0;
        if (mode === "down" && delta <= 0) delta = 0;
        if (returnBool) return delta !== 0;
        return delta;
    }

    /**
     * Get last wheel delta. If requireCtrl=true, only return value when wheel event had ctrl pressed.
     * mode: 'up'|'down' filters by direction like scroll().
     */
    wheel(mode = null, returnBool = false, requireCtrl = false) {
        if (!this._allowed()) return returnBool ? false : 0;
        let delta = this._lastWheel || 0;
        if (requireCtrl && !this._lastWheelCtrlFlag) delta = 0;
        if (mode === 'up' && delta >= 0) delta = 0;
        if (mode === 'down' && delta <= 0) delta = 0;
        if (returnBool) return delta !== 0;
        return delta;
    }

    /**
     * Horizontal wheel (deltaX) accessor. Mirrors `wheel()` but returns horizontal delta.
     * If requireCtrl=true, only returns value when wheel event had ctrl pressed.
     */
    wheelX(mode = null, returnBool = false, requireCtrl = false) {
        if (!this._allowed()) return returnBool ? false : 0;
        let delta = this._lastWheelX || 0;
        if (requireCtrl && !this._lastWheelCtrlFlag) delta = 0;
        if (mode === 'up' && delta >= 0) delta = 0;
        if (mode === 'down' && delta <= 0) delta = 0;
        if (returnBool) return delta !== 0;
        return delta;
    }
}