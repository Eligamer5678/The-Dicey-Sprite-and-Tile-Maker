export default function createHIFrame(id, pos, size, src, cssProps = {}, parentOrLayer, attrs = {}) {
    const uiCanvas = document.getElementById('UI');
    if (!uiCanvas) throw new Error('UI canvas not found');
    let parent = parentOrLayer;
    if (typeof parentOrLayer === 'string') {
        parent = document.getElementById(parentOrLayer + '-container') || document.getElementById(parentOrLayer) || null;
        if (parent && parent.tagName === 'CANVAS') parent = parent.parentNode;
    }

    const iframe = document.createElement('iframe');
    if (id) iframe.id = id;
    iframe.src = src || 'about:blank';
    iframe.style.border = 'none';

    if (attrs) {
        if (!id && attrs.id) iframe.id = attrs.id;
        if (attrs.className) iframe.className = attrs.className;
        if (Array.isArray(attrs.classes)) attrs.classes.forEach(c => iframe.classList.add(c));
        if (attrs.dataset && typeof attrs.dataset === 'object') {
            for (const k in attrs.dataset) iframe.dataset[k] = attrs.dataset[k];
        }
        if (attrs.attrs && typeof attrs.attrs === 'object') {
            for (const k in attrs.attrs) iframe.setAttribute(k, attrs.attrs[k]);
        }
    }
    if (!iframe.hasAttribute('data-ui')) iframe.setAttribute('data-ui', '1');
    iframe.style.pointerEvents = 'auto';

    function getScale() {
        const rect = uiCanvas.getBoundingClientRect();
        return { rect, scaleX: rect.width / 1920, scaleY: rect.height / 1080 };
    }

    function updatePosition() {
        const { rect, scaleX, scaleY } = getScale();
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
        iframe.style.position = 'absolute';
        iframe.style.left = left + 'px';
        iframe.style.top = top + 'px';
        iframe.style.width = width + 'px';
        iframe.style.height = height + 'px';
        for (const key in cssProps) {
            iframe.style[key] = cssProps[key];
        }
    }

    window.addEventListener('resize', () => requestAnimationFrame(updatePosition));
    updatePosition();

    if (!parent) parent = uiCanvas.parentNode;
    parent.appendChild(iframe);
    return iframe;
}
