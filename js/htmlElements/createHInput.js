export default function createHInput(id, pos, size, type = 'text', cssProps = {}, parentOrLayer, attrs = {}) {
    const uiCanvas = document.getElementById('UI');
    if (!uiCanvas) throw new Error('UI canvas not found');
    let parent = parentOrLayer;
    if (typeof parentOrLayer === 'string') {
        parent = document.getElementById(parentOrLayer + '-container') || document.getElementById(parentOrLayer) || null;
        if (parent && parent.tagName === 'CANVAS') parent = parent.parentNode;
    }
    const input = document.createElement('input');
    // id param wins
    if (id) input.id = id;
    input.type = type;
    // apply optional attributes (id, classes, dataset, other attrs)
    if (attrs) {
        if (!id && attrs.id) input.id = attrs.id;
        if (attrs.className) input.className = attrs.className;
        if (Array.isArray(attrs.classes)) attrs.classes.forEach(c => input.classList.add(c));
        if (attrs.dataset && typeof attrs.dataset === 'object') {
            for (const k in attrs.dataset) input.dataset[k] = attrs.dataset[k];
        }
        if (attrs.attrs && typeof attrs.attrs === 'object') {
            for (const k in attrs.attrs) input.setAttribute(k, attrs.attrs[k]);
        }
    }
    if (!input.hasAttribute('data-ui')) input.setAttribute('data-ui', '1');
    function updateInputPosition() {
        const rect = uiCanvas.getBoundingClientRect();
        const scaleX = rect.width / 1920;
        const scaleY = rect.height / 1080;
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
        input.style.position = 'absolute';
        input.style.left = left + 'px';
        input.style.top = top + 'px';
        input.style.width = width + 'px';
        input.style.pointerEvents = 'auto'
        input.style.height = height + 'px';
        input.style.zIndex = 1000;
        // Scale font size (default 16px)
        let baseFontSize = 16;
        if (cssProps.fontSize) {
            if (typeof cssProps.fontSize === 'number') baseFontSize = cssProps.fontSize;
            else if (typeof cssProps.fontSize === 'string' && cssProps.fontSize.endsWith('px')) baseFontSize = parseFloat(cssProps.fontSize);
        }
        input.style.fontSize = (baseFontSize * scaleY) + 'px';
        for (const key in cssProps) {
            if (key !== 'fontSize') input.style[key] = cssProps[key];
        }
    }
    window.addEventListener('resize', updateInputPosition);
    updateInputPosition();
    if (!parent) parent = uiCanvas.parentNode;
    parent.appendChild(input);
    return input;
}
