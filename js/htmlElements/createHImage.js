export default function createHImage(id, pos, size, src, cssProps = {}, parentOrLayer, attrs = {}) {
    const uiCanvas = document.getElementById('UI');
    if (!uiCanvas) throw new Error('UI canvas not found');
    let parent = parentOrLayer;
    if (typeof parentOrLayer === 'string') {
        parent = document.getElementById(parentOrLayer + '-container') || document.getElementById(parentOrLayer) || null;
        if (parent && parent.tagName === 'CANVAS') parent = parent.parentNode;
    }

    const img = document.createElement('img');
    if (id) img.id = id;
    img.src = src || '';
    img.style.objectFit = 'cover';

    if (attrs) {
        if (!id && attrs.id) img.id = attrs.id;
        if (attrs.className) img.className = attrs.className;
        if (Array.isArray(attrs.classes)) attrs.classes.forEach(c => img.classList.add(c));
        if (attrs.dataset && typeof attrs.dataset === 'object') {
            for (const k in attrs.dataset) img.dataset[k] = attrs.dataset[k];
        }
        if (attrs.attrs && typeof attrs.attrs === 'object') {
            for (const k in attrs.attrs) img.setAttribute(k, attrs.attrs[k]);
        }
    }
    if (!img.hasAttribute('data-ui')) img.setAttribute('data-ui', '1');
    img.style.pointerEvents = 'auto';

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
        img.style.position = 'absolute';
        img.style.left = left + 'px';
        img.style.top = top + 'px';
        img.style.width = width + 'px';
        img.style.height = height + 'px';
        for (const key in cssProps) {
            img.style[key] = cssProps[key];
        }
    }

    window.addEventListener('resize', () => requestAnimationFrame(updatePosition));
    updatePosition();

    if (!parent) parent = uiCanvas.parentNode;
    parent.appendChild(img);
    return img;
}
