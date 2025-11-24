export default function createHButton(id, pos, size, bg, cssProps = {}, parentOrLayer, attrs = {}) {
    const uiCanvas = document.getElementById('UI');
    if (!uiCanvas) throw new Error('UI canvas not found');
    let parent = parentOrLayer;
    if (typeof parentOrLayer === 'string') {
        parent = document.getElementById(parentOrLayer + '-container') || document.getElementById(parentOrLayer) || null;
        if (parent && parent.tagName === 'CANVAS') parent = parent.parentNode;
    }
    const btn = document.createElement('button');
    // id parameter wins over attrs.id; if id provided, force it
    if (id) btn.id = id;
    // apply optional attributes (id, classes, dataset, other attrs)
    if (attrs) {
        if (!id && attrs.id) btn.id = attrs.id;
        if (attrs.className) btn.className = attrs.className;
        if (Array.isArray(attrs.classes)) attrs.classes.forEach(c => btn.classList.add(c));
        if (attrs.dataset && typeof attrs.dataset === 'object') {
            for (const k in attrs.dataset) btn.dataset[k] = attrs.dataset[k];
        }
        if (attrs.attrs && typeof attrs.attrs === 'object') {
            for (const k in attrs.attrs) btn.setAttribute(k, attrs.attrs[k]);
        }
    }
    // mark as UI element to allow CSS selection
    if (!btn.hasAttribute('data-ui')) btn.setAttribute('data-ui', '1');
    function updateBtnPosition() {
        const rect = uiCanvas.getBoundingClientRect();
        const scaleX = rect.width / 1920;
        const scaleY = rect.height / 1080;
        let left, top, width, height;
        if (parent && parent.getBoundingClientRect) {
            // Position relative to the parent element's content box. Use the UI canvas
            // scale so logical 1920x1080 coordinates remain consistent.
            left = pos.x * scaleX;
            top = pos.y * scaleY;
        } else {
            // No parent provided: place relative to the UI canvas viewport position
            left = rect.left + pos.x * scaleX;
            top = rect.top + pos.y * scaleY;
        }
        width = size.x * scaleX;
        height = size.y * scaleY;
        btn.style.position = 'absolute';
        btn.style.left = left + 'px';
        btn.style.top = top + 'px';
        btn.style.width = width + 'px';
        btn.style.height = height + 'px';
        btn.style.background = bg;
        btn.style.pointerEvents = 'auto'
        btn.style.border = 'none';
        btn.style.cursor = 'pointer';
        btn.style.fontFamily = 'inherit';
        btn.style.zIndex = 1000;
        // Scale font size (default 16px)
        let baseFontSize = 16;
        if (cssProps.fontSize) {
            if (typeof cssProps.fontSize === 'number') baseFontSize = cssProps.fontSize;
            else if (typeof cssProps.fontSize === 'string' && cssProps.fontSize.endsWith('px')) baseFontSize = parseFloat(cssProps.fontSize);
        }
        btn.style.fontSize = (baseFontSize * scaleY) + 'px';
        for (const key in cssProps) {
            if (key !== 'fontSize') btn.style[key] = cssProps[key];
        }
    }
    window.addEventListener('resize', updateBtnPosition);
    updateBtnPosition();
    if (!parent) parent = uiCanvas.parentNode;
    parent.appendChild(btn);
    return btn;
}
