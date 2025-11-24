export default function createHSVG(id, pos, size, svgContent, cssProps = {}, parentOrLayer, attrs = {}) {
    const uiCanvas = document.getElementById('UI');
    if (!uiCanvas) throw new Error('UI canvas not found');
    let parent = parentOrLayer;
    if (typeof parentOrLayer === 'string') {
        parent = document.getElementById(parentOrLayer + '-container') || document.getElementById(parentOrLayer) || null;
        if (parent && parent.tagName === 'CANVAS') parent = parent.parentNode;
    }

    const wrapper = document.createElement('div');
    if (id) wrapper.id = id;
    wrapper.innerHTML = svgContent || '';

    if (attrs) {
        if (!id && attrs.id) wrapper.id = attrs.id;
        if (attrs.className) wrapper.className = attrs.className;
        if (Array.isArray(attrs.classes)) attrs.classes.forEach(c => wrapper.classList.add(c));
        if (attrs.dataset && typeof attrs.dataset === 'object') {
            for (const k in attrs.dataset) wrapper.dataset[k] = attrs.dataset[k];
        }
        if (attrs.attrs && typeof attrs.attrs === 'object') {
            for (const k in attrs.attrs) wrapper.setAttribute(k, attrs.attrs[k]);
        }
    }
    if (!wrapper.hasAttribute('data-ui')) wrapper.setAttribute('data-ui', '1');
    wrapper.style.pointerEvents = 'auto';

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
        wrapper.style.position = 'absolute';
        wrapper.style.left = left + 'px';
        wrapper.style.top = top + 'px';
        wrapper.style.width = width + 'px';
        wrapper.style.height = height + 'px';
        for (const key in cssProps) {
            wrapper.style[key] = cssProps[key];
        }
    }

    window.addEventListener('resize', () => requestAnimationFrame(updatePosition));
    updatePosition();

    if (!parent) parent = uiCanvas.parentNode;
    parent.appendChild(wrapper);
    return wrapper;
}
