export default function createHDiv(id, pos, size, bg, cssProps = {}, parentOrLayer, attrs = {}) {
    const uiCanvas = document.getElementById('UI');
    if (!uiCanvas) throw new Error('UI canvas not found');
    // Resolve parent: may be a DOM element, a layer name string, or undefined
    let parent = parentOrLayer;
    if (typeof parentOrLayer === 'string') {
        // prefer container id if present
    parent = document.getElementById(parentOrLayer + '-container') || document.getElementById(parentOrLayer) || null;
        if (parent && parent.tagName === 'CANVAS') parent = parent.parentNode;
    }
    const div = document.createElement('div');
    if (id) div.id = id;
    // apply optional attributes (id, classes, dataset, other attrs)
    if (attrs) {
        if (!id && attrs.id) div.id = attrs.id;
        if (attrs.className) div.className = attrs.className;
        if (Array.isArray(attrs.classes)) attrs.classes.forEach(c => div.classList.add(c));
        if (attrs.dataset && typeof attrs.dataset === 'object') {
            for (const k in attrs.dataset) div.dataset[k] = attrs.dataset[k];
        }
        if (attrs.attrs && typeof attrs.attrs === 'object') {
            for (const k in attrs.attrs) div.setAttribute(k, attrs.attrs[k]);
        }
    }
    if (!div.hasAttribute('data-ui')) div.setAttribute('data-ui', '1');

    // internal helper to compute scale relative to the UI canvas
    function getScale() {
        const rect = uiCanvas.getBoundingClientRect();
        return { rect, scaleX: rect.width / 1920, scaleY: rect.height / 1080 };
    }

    function updateDivPosition() {
        const { rect, scaleX, scaleY } = getScale();
        // If a parent DOM element is provided, position relative to its content box.
        // Otherwise position in viewport aligned with the UI canvas rect.
        let left, top;
        if (parent && parent.getBoundingClientRect) {
            left = pos.x * scaleX;
            top = pos.y * scaleY;
        } else {
            left = rect.left + pos.x * scaleX;
            top = rect.top + pos.y * scaleY;
        }
        const width = size.x * scaleX;
        const height = size.y * scaleY;
        div.style.position = 'absolute';
        div.style.left = left + 'px';
        div.style.top = top + 'px';
        div.style.pointerEvents = 'auto';
        div.style.width = width + 'px';
        div.style.height = height + 'px';
        div.style.background = bg;
        div.style.zIndex = 1000;
        // Scale font size (default 16px)
        let baseFontSize = 16;
        if (cssProps.fontSize) {
            if (typeof cssProps.fontSize === 'number') baseFontSize = cssProps.fontSize;
            else if (typeof cssProps.fontSize === 'string' && cssProps.fontSize.endsWith('px')) baseFontSize = parseFloat(cssProps.fontSize);
        }
        div.style.fontSize = (baseFontSize * scaleY) + 'px';
        for (const key in cssProps) {
            if (key !== 'fontSize') div.style[key] = cssProps[key];
        }
    }

    // Make the div draggable. Drag updates the logical `pos` so resize keeps the new placement.
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let origLeft = 0;
    let origTop = 0;

    function onPointerDown(e) {
        // Prevent dragging when interacting with obvious interactive elements
        const interactive = e.target.closest && e.target.closest('input, button, textarea, select, [contenteditable="true"]');
        if (interactive) return;
        // Left button or touch only
        if (e.button !== undefined && e.button !== 0) return;
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        origLeft = parseFloat(div.style.left) || 0;
        origTop = parseFloat(div.style.top) || 0;
        div.style.transition = 'none';
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        e.preventDefault();
    }

    function onPointerMove(e) {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        div.style.left = (origLeft + dx) + 'px';
        div.style.top = (origTop + dy) + 'px';
    }

    function onPointerUp(e) {
        if (!dragging) return;
        dragging = false;
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        // Recompute logical pos based on final pixel position so future resize keeps it
        const { rect, scaleX, scaleY } = getScale();
        const finalLeft = parseFloat(div.style.left) || 0;
        const finalTop = parseFloat(div.style.top) || 0;
        // convert back to logical coordinates (1920x1080 space)
        if (parent && parent.getBoundingClientRect) {
            // positions are relative to parent content box
            pos.x = finalLeft / scaleX;
            pos.y = finalTop / scaleY;
        } else {
            pos.x = (finalLeft - rect.left) / scaleX;
            pos.y = (finalTop - rect.top) / scaleY;
        }
        // restore styled position according to logical pos & scale
        updateDivPosition();
    }

    div.addEventListener('pointerdown', onPointerDown);

    window.addEventListener('resize', () => requestAnimationFrame(updateDivPosition));
    updateDivPosition();

    if (!parent) parent = uiCanvas.parentNode;
    parent.appendChild(div);
    return div;
}
