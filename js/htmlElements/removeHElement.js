export default function removeHElement(element) {
    if (element && element.parentNode) {
        element.parentNode.removeChild(element);
    }
}
