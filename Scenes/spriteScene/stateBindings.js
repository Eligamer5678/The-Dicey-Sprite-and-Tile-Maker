function getAtPath(obj, path) {
    let cur = obj;
    for (const key of path) {
        if (cur == null) return undefined;
        cur = cur[key];
    }
    return cur;
}

function setAtPath(obj, path, value) {
    if (!obj || !Array.isArray(path) || path.length === 0) return;
    let cur = obj;
    for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        if (cur[key] == null || typeof cur[key] !== 'object') cur[key] = {};
        cur = cur[key];
    }
    cur[path[path.length - 1]] = value;
}

function bindProp(scene, propName, rootName, path) {
    Object.defineProperty(scene, propName, {
        configurable: true,
        enumerable: true,
        get() {
            const root = this[rootName];
            return getAtPath(root, path);
        },
        set(value) {
            const root = this[rootName];
            setAtPath(root, path, value);
        }
    });
}

export function installSpriteSceneStateBindings(scene) {
    if (!scene || scene.__stateBindingsInstalled) return;

    // Editor-facing values (single source of truth = scene.state)
    bindProp(scene, 'selectedAnimation', 'state', ['editor', 'activeAnimation']);
    bindProp(scene, 'selectedFrame', 'state', ['editor', 'activeFrame']);
    bindProp(scene, 'currentTool', 'state', ['editor', 'activeTool']);
    bindProp(scene, 'brushSize', 'state', ['editor', 'brushSize']);
    bindProp(scene, 'penMirrorH', 'state', ['editor', 'mirror', 'h']);
    bindProp(scene, 'penMirrorV', 'state', ['editor', 'mirror', 'v']);
    bindProp(scene, 'adjustAmount', 'state', ['editor', 'adjustAmount']);
    bindProp(scene, 'paletteStepMax', 'state', ['editor', 'paletteStepMax']);
    bindProp(scene, 'onionSkin', 'state', ['editor', 'onionSkin']);
    bindProp(scene, 'onionAlpha', 'state', ['editor', 'onionAlpha']);
    bindProp(scene, 'layerAlpha', 'state', ['editor', 'layerAlpha']);
    bindProp(scene, 'onionRange', 'state', ['editor', 'onionRange']);
    bindProp(scene, 'pixelPerfect', 'state', ['editor', 'pixelPerfect']);
    bindProp(scene, 'autotile', 'state', ['editor', 'autotile']);
    bindProp(scene, 'tilemode', 'state', ['tilemap', 'enabled']);
    bindProp(scene, 'tileCols', 'state', ['tilemap', 'cols']);
    bindProp(scene, 'tileRows', 'state', ['tilemap', 'rows']);
    bindProp(scene, 'selectionRegion', 'state', ['selection', 'region']);
    bindProp(scene, 'selectionPoints', 'state', ['selection', 'points']);
    bindProp(scene, 'clipboard', 'state', ['selection', 'clipboard']);
    bindProp(scene, 'penColor', 'state', ['brush', 'pixelBrush', 'colorHex']);

    // Camera/runtime values (single source of truth = scene.localState)
    bindProp(scene, 'zoom', 'localState', ['camera', 'zoom']);
    bindProp(scene, 'pan', 'localState', ['camera', 'pan']);
    bindProp(scene, 'offset', 'localState', ['camera', 'offset']);
    bindProp(scene, 'zoomPos', 'localState', ['camera', 'zoomPos']);
    bindProp(scene, 'panVlos', 'localState', ['camera', 'panVlos']);
    bindProp(scene, 'zoomVlos', 'localState', ['camera', 'zoomVlos']);
    bindProp(scene, 'minZoom', 'localState', ['camera', 'minZoom']);
    bindProp(scene, 'maxZoom', 'localState', ['camera', 'maxZoom']);
    bindProp(scene, 'zoomSmooth', 'localState', ['camera', 'zoomSmooth']);
    bindProp(scene, 'zoomImpulse', 'localState', ['camera', 'zoomImpulse']);
    bindProp(scene, 'zoomStep', 'localState', ['camera', 'zoomStep']);
    bindProp(scene, 'panSmooth', 'localState', ['camera', 'panSmooth']);

    // Large tile arrays are also kept in state for sync purposes.
    bindProp(scene, '_areaBindings', 'state', ['tilemap', 'bindings']);
    bindProp(scene, '_areaTransforms', 'state', ['tilemap', 'transforms']);

    scene.__stateBindingsInstalled = true;
}
