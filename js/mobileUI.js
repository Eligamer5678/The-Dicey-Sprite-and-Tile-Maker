// Mobile UI helper: creates left and right control panels and maps buttons
// to synthetic input events (keyboard and pointer) so the existing app logic works.

const createEl = (tag, cls, txt) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (txt) el.textContent = txt;
    return el;
};

const simulateKey = (key, opts = {}) => {
    const { ctrl=false, down=false, up=false } = opts;
    const kd = new KeyboardEvent('keydown', { key, ctrlKey: ctrl, bubbles: true, cancelable: true });
    const ku = new KeyboardEvent('keyup', { key, ctrlKey: ctrl, bubbles: true, cancelable: true });
    if (down) window.dispatchEvent(kd);
    else if (up) window.dispatchEvent(ku);
    else {
        window.dispatchEvent(kd);
        setTimeout(() => window.dispatchEvent(ku), 10);
    }
};

const dispatchPointer = (type, x, y, button = 0) => {
    // button: 0=left,1=middle,2=right
    let ev;
    try {
        ev = new PointerEvent(type, { clientX: x, clientY: y, button, pointerType: 'mouse', bubbles: true });
    } catch (e) {
        // older browsers
        ev = document.createEvent('MouseEvent');
        ev.initMouseEvent(type, true, true, window, 0, 0, 0, x, y, false, false, false, false, button, null);
    }
    window.dispatchEvent(ev);
};

// Find a reasonable target canvas for pointer coords
const getCanvasForPoint = () => document.querySelector('#layers canvas') || document.querySelector('canvas');

// track last pointer position for eyedropper targeting
let lastPointer = { x: 0, y: 0 };
window.addEventListener('pointerdown', e => { lastPointer.x = e.clientX; lastPointer.y = e.clientY; }, { passive: true });

let pasteArmed = false;
let pasteAutoReleaseTimer = null;
// Toggle mode: when true, Control is held (eyedropper mode)
let ctrlMode = false;

// Shift toggle state for Select button
let shiftMode = false;

const armPaste = () => {
    if (pasteArmed) return;
    pasteArmed = true;
    simulateKey('v', { down: true }); // keydown only, hold until second press
    // block drawing/pen while paste is armed
    try { if (window.program && window.program.mouse) window.program.mouse.uiBlockedByOverlay = true; } catch (e) {}
    // auto-release after 8s to avoid stuck state
    pasteAutoReleaseTimer = setTimeout(() => {
        if (pasteArmed) {
            releasePaste();
            pasteArmed = false;
        }
    }, 8000);
};

const releasePaste = () => {
    if (!pasteArmed) return;
    pasteArmed = false;
    clearTimeout(pasteAutoReleaseTimer);
    // keyup to trigger paste behavior
    const ku = new KeyboardEvent('keyup', { key: 'v', bubbles: true, cancelable: true });
    window.dispatchEvent(ku);
    // restore drawing state
    try { if (window.program && window.program.mouse) window.program.mouse.uiBlockedByOverlay = false; } catch (e) {}
};

const makeButton = (label, onClick, extraCls='') => {
    const b = createEl('button', 'mobile-btn ' + extraCls, label);
    b.addEventListener('touchstart', e => { e.preventDefault(); onClick(e); }, { passive: false });
    b.addEventListener('mousedown', e => { e.preventDefault(); onClick(e); });
    return b;
};

const buildUI = () => {
    const uiRoot = document.querySelector('#ui') || document.body;
        // ensure global toggle table exists for Keys to read
        window.mobileKeyToggles = window.mobileKeyToggles || {};

    // Left panel (will be positioned adjacent to canvas)
    const left = createEl('div', 'mobile-left-panel');
    // Big Select
    const btnSelect = makeButton('Select', () => {
        shiftMode = !shiftMode;
        btnSelect.textContent = shiftMode ? 'Select (Shift ✓)' : 'Select';
            if (shiftMode) simulateKey('Shift', { down: true }); else simulateKey('Shift', { up: true });
            try { window.mobileKeyToggles['Shift'] = !!shiftMode; } catch (e) {}
    }, 'big');
    left.appendChild(btnSelect);
    // H/K container occupying one quarter: contains two buttons stacked
    const hkContainer = createEl('div', 'hk-container');
    const btnH = makeButton('H', () => simulateKey('h'));
    const btnK = makeButton('K', () => simulateKey('k'));
    hkContainer.appendChild(btnH);
    hkContainer.appendChild(btnK);
    hkContainer.classList.add('big');
    left.appendChild(hkContainer);
    // Eyedropper (toggle Control held state)
    const btnEyedrop = makeButton('Eyedrop', () => {
        ctrlMode = !ctrlMode;
        btnEyedrop.textContent = ctrlMode ? 'Eyedrop ✓' : 'Eyedrop';
            if (ctrlMode) simulateKey('Control', { down: true }); else simulateKey('Control', { up: true });
            try { window.mobileKeyToggles['Control'] = !!ctrlMode; } catch (e) {}
    }, 'big');
    left.appendChild(btnEyedrop);
    // Right-click toggle (maps left taps to right-click)
    let rightClickMode = false;
    const btnRightClick = makeButton('Right', () => {
        rightClickMode = !rightClickMode;
        btnRightClick.textContent = rightClickMode ? 'Right ✓' : 'Right';
        // inform Mouse instance if present
        try { if (window.program && window.program.mouse) window.program.mouse.setEmulateRight(rightClickMode); } catch (e) {}
    }, 'big');
    left.appendChild(btnRightClick);
    uiRoot.appendChild(left);

    // Right panel (scrollable)
    const right = createEl('div', 'mobile-right-panel');
    const sc = createEl('div', 'mobile-scroll');
    // Copy
    sc.appendChild(makeButton('Copy', () => simulateKey('c')));
    // Cut
    sc.appendChild(makeButton('Cut', () => simulateKey('x')));
    // Paste (two-press behavior)
    sc.appendChild(makeButton('Paste', () => {
        if (!pasteArmed) armPaste(); else releasePaste();
    }));
    // Remove frame: directly invoke FrameSelect removal when possible, fallback to Backspace key
    sc.appendChild(makeButton('Remove Frame', () => {
        try {
            const prog = window.program;
            const scene = prog && prog.game && prog.game.currentScene ? prog.game.currentScene : (prog && prog.currentScene) ? prog.currentScene : null;
            if (scene && scene.FrameSelect && scene.currentSprite) {
                const fs = scene.FrameSelect;
                const anim = scene.selectedAnimation;
                const sel = scene.selectedFrame;
                const arr = (scene.currentSprite && scene.currentSprite._frames && anim) ? (scene.currentSprite._frames.get(anim) || []) : [];
                if (anim && sel !== null && arr.length > 0 && sel >= 0 && sel < arr.length) {
                    const beforeRefs = (typeof fs._snapshotLogicalFrameRefs === 'function') ? fs._snapshotLogicalFrameRefs(anim) : [];
                    try { scene.currentSprite.popFrame(anim, sel); } catch (e) { /* ignore */ }
                    try { if (typeof fs._syncFrameReferenceRemap === 'function') fs._syncFrameReferenceRemap(anim, beforeRefs); } catch (e) {}
                    const newLen = (scene.currentSprite._frames.get(anim) || []).length;
                    if (newLen === 0) scene.selectedFrame = 0; else scene.selectedFrame = Math.max(0, Math.min(sel, newLen - 1));
                    try { scene && scene.sfx && scene.sfx.play && scene.sfx.play('frame.delete'); } catch (e) {}
                    try { if (scene.mouse && typeof scene.mouse.addMask === 'function') scene.mouse.addMask(1); } catch (e) {}
                    return;
                }
            }
        } catch (e) {}
        // fallback: simulate Backspace
        simulateKey('Backspace');
    }));
    // Ctrl+A (select all)
    // Replace Ctrl+A with F (toggle)
    let fMode = false;
    const btnF = makeButton('F', () => {
        fMode = !fMode;
        btnF.textContent = fMode ? 'F ✓' : 'F';
        if (fMode) simulateKey('f', { down: true }); else simulateKey('f', { up: true });
            try { window.mobileKeyToggles['f'] = !!fMode; } catch (e) {}
    });
    sc.appendChild(btnF);
    // a key
    sc.appendChild(makeButton('A', () => simulateKey('a')));
    // Tile mode (t)
    sc.appendChild(makeButton('Tile', () => simulateKey('t')));
    // Brush size toggle 1-5 (cycles single button)
    let brushSize = 1;
    const btnBrush = makeButton('Brush:1', () => {
        brushSize = brushSize % 5 + 1;
        btnBrush.textContent = 'Brush:' + brushSize;
        simulateKey(String(brushSize));
    });
    sc.appendChild(btnBrush);
    // Resize canvas (` key)
    sc.appendChild(makeButton('Resize `', () => simulateKey('`')));
    // +/- and color steps
    sc.appendChild(makeButton('+', () => simulateKey('+')));
    sc.appendChild(makeButton('-', () => simulateKey('-')));
    // Move color-step toggle here (cycles 6..9)
    let colorStep = 6;
    const btnColorStepRight = makeButton('Step:6', () => {
        colorStep = (colorStep - 5) % 4 + 6;
        btnColorStepRight.textContent = 'Step:' + colorStep;
        simulateKey(String(colorStep));
    });
    sc.appendChild(btnColorStepRight);

    right.appendChild(sc);
    uiRoot.appendChild(right);

    // Implement pointer-based drag-to-scroll for the right panel to support
    // touch drag scrolling without triggering button clicks.
    try {
        sc.style.touchAction = 'none';
        let isDragging = false;
        let dragStartY = undefined;
        let scrollStart = 0;
        let lastDragTime = 0;

        sc.addEventListener('pointerdown', (ev) => {
            // only capture touch/pen pointers; let mouse behave normally on desktop
            if (ev.pointerType === 'mouse' && !navigator.maxTouchPoints) return;
            sc.setPointerCapture && sc.setPointerCapture(ev.pointerId);
            isDragging = false;
            dragStartY = ev.clientY;
            scrollStart = sc.scrollTop;
        }, { passive: true });

        sc.addEventListener('pointermove', (ev) => {
            if (typeof dragStartY === 'undefined') return;
            const dy = ev.clientY - dragStartY;
            if (Math.abs(dy) > 6) {
                isDragging = true;
                sc.scrollTop = scrollStart - dy;
            }
        }, { passive: true });

        const finishDrag = (ev) => {
            if (isDragging) lastDragTime = Date.now();
            try { if (ev && ev.pointerId && sc.releasePointerCapture) sc.releasePointerCapture(ev.pointerId); } catch (e) {}
            isDragging = false; dragStartY = undefined; scrollStart = 0;
        };
        sc.addEventListener('pointerup', finishDrag);
        sc.addEventListener('pointercancel', finishDrag);
        sc.addEventListener('lostpointercapture', finishDrag);

        // Prevent accidental clicks on buttons immediately after a drag
        const btns = sc.querySelectorAll('button');
        btns.forEach(b => {
            b.addEventListener('click', (ev) => {
                if (Date.now() - lastDragTime < 350) {
                    ev.stopImmediatePropagation(); ev.preventDefault();
                }
            }, true);
        });
    } catch (e) { /* non-critical */ }

    // show mobile UI only when touch capable
    const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
    if (!isTouch) {
        left.style.display = 'none';
        right.style.display = 'none';
    } else {
        document.body.classList.add('mobile-enabled');
    }

    // request fullscreen on first user gesture (mobile)
    const tryFullscreen = async () => {
        try {
            const el = document.getElementById('screen') || document.documentElement;
            if (el && !document.fullscreenElement) {
                if (el.requestFullscreen) await el.requestFullscreen();
                else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
            }
        } catch (e) { /* ignore */ }
    };
    if (isTouch) {
        window.addEventListener('pointerdown', () => {
            if (!document.fullscreenElement) tryFullscreen();
        });
    }

    // remove any prior arming listeners; eyedropper now toggles Control directly via the button

    // Position panels using 10% of the full screen width on each side
    const positionPanels = () => {
        const c = getCanvasForPoint();
        if (!c) return;
        const r = c.getBoundingClientRect();
        const screenW = window.innerWidth;
        // panel width is 10% of full screen width (clamped to a reasonable min/max)
        const rawPanel = Math.round(screenW * 0.10);
        const panelWidth = Math.max(48, Math.min(rawPanel, Math.round(screenW * 0.20)));
        // left panel anchors to the left edge (0 .. 10% area)
        left.style.position = 'absolute';
        left.style.left = '0px';
        left.style.top = r.top + 'px';
        left.style.height = r.height + 'px';
        left.style.width = panelWidth + 'px';
        // right panel anchors to the right edge (screenWidth - 10%)
        right.style.position = 'absolute';
        right.style.left = (screenW - panelWidth) + 'px';
        right.style.top = r.top + 'px';
        right.style.height = r.height + 'px';
        right.style.width = panelWidth + 'px';

        // size big elements to 1/4 of panel height
        const bigEls = left.querySelectorAll('.big');
        const h = r.height / 4;
        bigEls.forEach(el => { el.style.height = h + 'px'; el.style.display = 'flex'; el.style.alignItems = 'center'; el.style.justifyContent = 'center'; el.style.fontSize = Math.max(12, Math.round(h/6)) + 'px'; });
        // ensure hk-container children fill half
        if (hkContainer) {
            const kids = hkContainer.children;
            if (kids && kids.length === 2) {
                kids[0].style.flex = '1'; kids[1].style.flex = '1';
                kids[0].style.display = kids[1].style.display = 'flex';
                kids[0].style.alignItems = kids[1].style.alignItems = 'center';
                kids[0].style.justifyContent = kids[1].style.justifyContent = 'center';
            }
        }
    };
    window.addEventListener('resize', positionPanels);
    setTimeout(positionPanels, 200);
};

// Build on next tick so #ui exists
setTimeout(() => {
    try { buildUI(); } catch (e) { console.warn('mobileUI init failed', e); }
}, 100);

export default {};
