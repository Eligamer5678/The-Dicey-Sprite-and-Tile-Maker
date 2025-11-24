export default function createHLabel(id, pos, size, text, cssProps = {}, parentOrLayer, attrs = {}) {
    const uiCanvas = document.getElementById('UI');
    if (!uiCanvas) throw new Error('UI canvas not found');
    let parent = parentOrLayer;
    if (typeof parentOrLayer === 'string') {
        parent = document.getElementById(parentOrLayer + '-container') || document.getElementById(parentOrLayer) || null;
        if (parent && parent.tagName === 'CANVAS') parent = parent.parentNode;
    }
    const label = document.createElement('label');
    if (id) label.id = id;
    label.textContent = text;
    // apply optional attributes (id, classes, dataset, other attrs)
    if (attrs) {
        if (!id && attrs.id) label.id = attrs.id;
        if (attrs.className) label.className = attrs.className;
        if (Array.isArray(attrs.classes)) attrs.classes.forEach(c => label.classList.add(c));
        if (attrs.dataset && typeof attrs.dataset === 'object') {
            for (const k in attrs.dataset) label.dataset[k] = attrs.dataset[k];
        }
        if (attrs.attrs && typeof attrs.attrs === 'object') {
            for (const k in attrs.attrs) label.setAttribute(k, attrs.attrs[k]);
        }
    }
    if (!label.hasAttribute('data-ui')) label.setAttribute('data-ui', '1');
    function updateLabelPosition() {
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
        label.style.position = 'absolute';
        label.style.left = left + 'px';
        label.style.top = top + 'px';
        label.style.width = width + 'px';
        label.style.height = height + 'px';
        label.style.display = 'flex';
        label.style.alignItems = 'center';
        label.style.justifyContent = 'center';
        label.style.zIndex = 1000;
        label.style.pointerEvents = 'auto'
        let baseFontSize = 16;
        if (cssProps.fontSize) {
            if (typeof cssProps.fontSize === 'number') baseFontSize = cssProps.fontSize;
            else if (typeof cssProps.fontSize === 'string' && cssProps.fontSize.endsWith('px')) baseFontSize = parseFloat(cssProps.fontSize);
        }
        label.style.fontSize = (baseFontSize * scaleY) + 'px';
        for (const key in cssProps) {
            if (key !== 'fontSize') label.style[key] = cssProps[key];
        }
    }
    window.addEventListener('resize', updateLabelPosition);
    updateLabelPosition();
    if (!parent) parent = uiCanvas.parentNode;
    parent.appendChild(label);
    return label;
}
