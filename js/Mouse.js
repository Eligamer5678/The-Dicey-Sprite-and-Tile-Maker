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
        this.logicalBounds = new Vector(1920,1080);
        this.offCanvas = false;

        // === Power system ===
        this.power = 0;  // current input context power
        this.mask = 0;   // max power allowed

        this.buttons = {
            left: this._makeButton(),
            middle: this._makeButton(),
            right: this._makeButton()
        };

        // Use Pointer Events (covers mouse, touch, pen)
        // Track multiple pointers so touch multi-finger interactions don't confuse state.
        this.pointers = new Map(); // pointerId => {x,y,button,pointerType}
        this._primaryPointerId = null;
        this.gestureActive = false;
        this._gesturePrevDist = null;
        this._gesturePrevCenter = null;
        window.addEventListener("pointermove", e => this._onPointerMove(e));
        // Prevent browser navigation from extra mouse buttons (X1/X2). Some browsers
        // map the back/forward buttons to button values 3 and 4. Intercept pointerdown
        // and auxclick to call preventDefault so the browser doesn't navigate.
        window.addEventListener("pointerdown", e => this._onPointerDown(e));
        window.addEventListener("pointerup", e => this._onPointerUp(e));
        window.addEventListener("pointercancel", e => this._onPointerUp(e));
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
        // Prevent browser context menu / behavior for shift+right-click inside the app
        window.addEventListener('contextmenu', e => {
            try {
                if (e.shiftKey) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                }
            } catch (err) {}
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
        // Note: older touch listeners removed — pointer events handle touch reliably.
    }

    _eventInCentral16x9(e) {
        try {
            const w = window.innerWidth || 0;
            const h = window.innerHeight || 0;
            if (!w || !h) return true;
            const cx = w / 2;
            const cy = h / 2;
            let regionW, regionH;
            const targetAspect = 16/9;
            if (w / h >= targetAspect) {
                // height bounds region
                regionH = h;
                regionW = regionH * targetAspect;
            } else {
                // width bounds region
                regionW = w;
                regionH = regionW / targetAspect;
            }
            const left = cx - regionW/2;
            const right = cx + regionW/2;
            const top = cy - regionH/2;
            const bottom = cy + regionH/2;
            const x = (e && typeof e.clientX === 'number') ? e.clientX : (e && typeof e.x === 'number' ? e.x : null);
            const y = (e && typeof e.clientY === 'number') ? e.clientY : (e && typeof e.y === 'number' ? e.y : null);
            if (x === null || y === null) return true;
            return (x >= left && x <= right && y >= top && y <= bottom);
        } catch (err) {
            return true;
        }
    }

    _onPointerDown(e) {
        try {
            if (typeof e.button === 'number' && (e.button === 3 || e.button === 4)) {
                e.preventDefault();
                e.stopImmediatePropagation();
            }
            if (typeof e.button === 'number' && e.button === 2 && e.shiftKey) {
                e.preventDefault();
                e.stopImmediatePropagation();
            }
        } catch (ex) {}
        // track pointer
        const x = e.clientX; const y = e.clientY;
        this.pointers.set(e.pointerId, { x, y, button: e.button, pointerType: e.pointerType });
        if (this._primaryPointerId === null) this._primaryPointerId = e.pointerId;
        // update pos from primary only if the event is inside central 16:9 region
        if (this._primaryPointerId === e.pointerId) {
            if (this._eventInCentral16x9(e)) this._onMove(e);
        }
        // For touch, prevent default to avoid scrolling
        try { if (e.pointerType === 'touch') e.preventDefault(); } catch (err) {}
        // Update button states only if the event is inside the central 16:9 region
        try {
            if (this._eventInCentral16x9(e)) {
                if (e.button === 1) this._setButton(1, 1);
                if (e.button === 2) this._setButton(2, 1);
                // left mouse/touch
                if (typeof e.button !== 'number' || e.button === 0) {
                    this._setButton(0, 1);
                }
            }
        } catch (err) {}
    }

    _onPointerMove(e) {
        // update tracked pointer
        if (this.pointers.has(e.pointerId)) {
            this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, pointerType: e.pointerType });
        }
        if (this._primaryPointerId === null) this._primaryPointerId = e.pointerId;
        // If there are two or more pointers, handle pinch/drag gesture
        if (this.pointers.size >= 2) {
            const pts = Array.from(this.pointers.values());
            const a = pts[0], b = pts[1];
            const cx = (a.x + b.x) / 2;
            const cy = (a.y + b.y) / 2;
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            if (!this.gestureActive) {
                this.gestureActive = true;
                this._gesturePrevDist = dist;
                this._gesturePrevCenter = { x: cx, y: cy };
                // block drawing/UI interactions while gesturing
                this.uiBlockedByOverlay = true;
                // release left button state to avoid stray drawing
                this._setButton(0, 0);
            } else {
                // compute zoom delta
                // compute zoom delta and ignore tiny jitter to avoid accidental zoom while panning
                const delta = dist - (this._gesturePrevDist || dist);
                const PINCH_JITTER_THRESHOLD = 2; // pixels
                const ZOOM_SENSITIVITY = 2;
                if (Math.abs(delta) > PINCH_JITTER_THRESHOLD) {
                    this._lastWheelDelta += -delta * ZOOM_SENSITIVITY;
                    this._lastWheelCtrl = true; // mark as a ctrl-like zoom so consumers can opt-in
                    this._gesturePrevDist = dist;
                }

                // compute pan delta from gesture center movement
                const pdx = cx - this._gesturePrevCenter.x;
                const pdy = cy - this._gesturePrevCenter.y;
                const PAN_SENSITIVITY = 20.0;
                // horizontal pan -> wheelX
                this._lastWheelDeltaX += -pdx * PAN_SENSITIVITY;
                // vertical pan -> scrollDelta
                this.scrollDelta += -pdy * PAN_SENSITIVITY;

                this._gesturePrevCenter = { x: cx, y: cy };
            }
            // while gesturing, update mouse position to the gesture center so zoom anchors correctly
            try {
                this.prevPos = this.pos.clone();
                this.pos = new Vector(
                    (cx - this.rect.left + this.offset.x) * this.scale/this.canvasScale.x,
                    (cy - this.rect.top + this.offset.y) * this.scale/this.canvasScale.y
                );
                this._updateOffCanvasState();
            } catch (e) {}
            return; // don't call primary pointer move while gesturing
        }

        if (this._primaryPointerId === e.pointerId) {
            if (this._eventInCentral16x9(e)) this._onMove(e);
        }
    }

    _onPointerUp(e) {
        // remove pointer from map
        try { this.pointers.delete(e.pointerId); } catch (ex) {}
        // if primary was removed, pick another
        if (this._primaryPointerId === e.pointerId) {
            const it = this.pointers.keys();
            const next = it.next();
            this._primaryPointerId = next.done ? null : next.value;
            if (this._primaryPointerId !== null) {
                const p = this.pointers.get(this._primaryPointerId);
                if (p) {
                    // synthesize a simple event-like object for _onMove
                    this._onMove({ clientX: p.x, clientY: p.y });
                }
            }
        }
        // update buttons: middle/right cleared if their event matched, left cleared only if no pointers remain
        if (e.button === 1) this._setButton(1, 0);
        if (e.button === 2) this._setButton(2, 0);
        if (this.pointers.size === 0) this._setButton(0, 0);

        // if gesture ended (now fewer than 2 pointers), clear gesture state and re-enable UI
        if (this.gestureActive && this.pointers.size < 2) {
            this.gestureActive = false;
            this._gesturePrevDist = null;
            this._gesturePrevCenter = null;
            // small pause to avoid immediate drawing
            this.uiBlockedByOverlay = false;
            this.pause(0.05);
        }
    }

    _onMove(e) {
        // Ignore moves that are outside the central 16:9 region to avoid UI taps
        // moving the canvas cursor. Use screen coordinates to avoid scaling issues.
        if (!this._eventInCentral16x9(e)) return;
        this.prevPos = this.pos.clone();
        this.pos = new Vector(
            (e.clientX - this.rect.left + this.offset.x) * this.scale/this.canvasScale.x,
            (e.clientY - this.rect.top + this.offset.y) * this.scale/this.canvasScale.y
        );
        this._updateOffCanvasState();
    }

    _updateOffCanvasState(){
        try {
            const w = Number(this.logicalBounds && this.logicalBounds.x) || 1920;
            const h = Number(this.logicalBounds && this.logicalBounds.y) || 1080;
            const outside = !(this.pos.x >= 0 && this.pos.y >= 0 && this.pos.x <= w && this.pos.y <= h);
            this.offCanvas = outside;
            if (outside) this.pause(0.2);
        } catch (e) {
            this.offCanvas = false;
        }
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
        // If emulateRight is enabled, map left-button to right-button instead.
        if (code === 0 || code === -1 || code === undefined) {
            if (this.emulateRight) this.buttons.right.state = val;
            else this.buttons.left.state = val;
        }
        if (code === 1) this.buttons.middle.state = val;
        if (code === 2) this.buttons.right.state = val;
    }

    // Toggle mapping of left inputs to right inputs (used by mobile UI)
    setEmulateRight(v) {
        const want = !!v;
        if (this.emulateRight === want) return;
        // Transfer current button state so toggling doesn't leave inputs stuck
        try {
            if (want) {
                // map any existing left state to right and clear left
                this.buttons.right.state = this.buttons.left.state;
                this.buttons.right.time = this.buttons.left.time;
                this.buttons.right.prev = this.buttons.left.prev;
                this.buttons.right.justReleased = this.buttons.left.justReleased;
                this.buttons.left.state = 0;
                this.buttons.left.time = 0;
                this.buttons.left.prev = 0;
                this.buttons.left.justReleased = 0;
            } else {
                // map any existing right state back to left and clear right
                this.buttons.left.state = this.buttons.right.state;
                this.buttons.left.time = this.buttons.right.time;
                this.buttons.left.prev = this.buttons.right.prev;
                this.buttons.left.justReleased = this.buttons.right.justReleased;
                this.buttons.right.state = 0;
                this.buttons.right.time = 0;
                this.buttons.right.prev = 0;
                this.buttons.right.justReleased = 0;
            }
        } catch (e) { /* ignore mapping errors */ }
        this.emulateRight = want;
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
        if (this.offCanvas) return false;
        if (this.uiBlockedByOverlay) return false;
        try { if (window.mobileUIPasteArmed) return false; } catch (e) {}
        if (button === null || button === 'any') {
            return this.pressed("left") || this.pressed("middle") || this.pressed("right");
        }
        if (this.buttons[button].time > this.prevDelta + 0.001) return false;
        if (this.pauseTime > 0) return false;
        if (!this._allowed()) return false;
        return !!this.buttons[button].state;
    }

    held(button, returnTime = false) {
        if (this.offCanvas) return returnTime ? 0 : false;
        if (this.uiBlockedByOverlay) return returnTime ? 0 : false;
        try { if (window.mobileUIPasteArmed) return returnTime ? 0 : false; } catch (e) {}
        if (this.pauseTime > 0) return returnTime ? 0 : false;
        if (!this._allowed()) return returnTime ? 0 : false;
        const b = this.buttons[button];
        return returnTime ? b.time : !!b.state;
    }

    released(button) {
        if (this.offCanvas) return false;
        if (this.uiBlockedByOverlay) return false;
        try { if (window.mobileUIPasteArmed) return false; } catch (e) {}
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
        if (this.uiBlockedByOverlay) return returnBool ? false : 0;
        try { if (window.mobileUIPasteArmed) return returnBool ? false : 0; } catch (e) {}
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
        if (this.uiBlockedByOverlay) return returnBool ? false : 0;
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
        if (this.uiBlockedByOverlay) return returnBool ? false : 0;
        if (!this._allowed()) return returnBool ? false : 0;
        let delta = this._lastWheelX || 0;
        if (requireCtrl && !this._lastWheelCtrlFlag) delta = 0;
        if (mode === 'up' && delta >= 0) delta = 0;
        if (mode === 'down' && delta <= 0) delta = 0;
        if (returnBool) return delta !== 0;
        return delta;
    }
}