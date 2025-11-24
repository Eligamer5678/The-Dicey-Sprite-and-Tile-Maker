export const getID = document.getElementById.bind(document);

export function addEvent(target, item, event, func) {
    if (target === "item" && item instanceof HTMLElement) {
        item.addEventListener(event, func);
    } else if (target === "window") {
        window.addEventListener(event, func);
    } else if (typeof item === "string") {
        const el = document.getElementById(item);
        if (el) el.addEventListener(event, func);
        else console.warn(`Element with id "${item}" not found.`);
    } else {
        console.warn("Invalid target/item provided to addEvent.");
    }
}
/*Tetration*/
export function TET(a, n) {
  if (n === 0) return 1; // by convention
  if (n === 1) return a;

  // If n is an integer >= 1, do the normal tower
  if (Number.isInteger(n) && n > 1) {
    let result = a;
    for (let i = 1; i < n; i++) {
      result = Math.pow(a, result); // right-assoc
      if (!Number.isFinite(result)) return result; // Infinity or NaN
    }
    return result;
  }

  // If n is fractional/negative: approximate using continuous iteration
  // Simple method: interpolate between heights using fixed-point iteration
  const k = Math.floor(n);              // integer part
  const frac = n - k;                   // fractional part
  let tower = TET(a, k);          // build integer tower
  if (frac === 0) return tower;

  // crude fractional step: weighted geometric mean between
  // tower at height k and k+1
  const nextTower = TET(a, k + 1);
  return Math.pow(tower, 1 - frac) * Math.pow(nextTower, frac);
}
export function copyToClipboard(text) {
    navigator.clipboard.writeText(text)
    .then(() => {
        console.log('Copied to clipboard:', text);
    })
    .catch(err => {
        console.error('Failed to copy: ', err);
    });
}

