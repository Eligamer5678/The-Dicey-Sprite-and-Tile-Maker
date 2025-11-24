export default function setCss(element, cssProps = {}) {
    if (!element) return;
    for (const key in cssProps) {
        element.style[key] = cssProps[key];
    }
}
