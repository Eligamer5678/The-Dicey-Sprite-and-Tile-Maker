export default class Saver {
    constructor(storageKey = "gameData") {
        this.storageKey = storageKey;
        this.savedata = {};
        this.load();
    }

    // Load saved data from localStorage
    load() {
        const data = localStorage.getItem(this.storageKey);
        if (data) {
            try {
                this.savedata = JSON.parse(data);
            } catch (e) {
                console.error("Failed to parse saved data:", e);
                this.savedata = {};
            }
        } else {
        this.savedata = {};
        }
    }

    // Save current savedata to localStorage
    save() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.savedata));
        } catch (e) {
            console.error("Failed to save data:", e);
        }
    }

    _getPathObj(path, createMissing = false) {
        const keys = path.split("/");
        let obj = this.savedata;
        for (let i = 0; i < keys.length - 1; i++) {
            if (!obj[keys[i]]) {
                if (createMissing) obj[keys[i]] = {};
                else return undefined;
            }
            obj = obj[keys[i]];
        }
        return { obj, lastKey: keys[keys.length - 1] };
    }

    // Set value using path
    set(path, value, autoSave = true) {
        const { obj, lastKey } = this._getPathObj(path, true);
        obj[lastKey] = value;
        if (autoSave) this.save();
    }

    // Convenience: store image data (dataURL string) at a path. Accepts either
    // a dataURL string or a canvas element which will be converted using toDataURL.
    setImage(path, canvasOrDataUrl, autoSave = true) {
        try {
            let dataUrl = null;
            if (!canvasOrDataUrl) return false;
            if (typeof canvasOrDataUrl === 'string') {
                dataUrl = canvasOrDataUrl;
            } else if (canvasOrDataUrl instanceof HTMLCanvasElement && typeof canvasOrDataUrl.toDataURL === 'function') {
                dataUrl = canvasOrDataUrl.toDataURL('image/png');
            } else if (canvasOrDataUrl && typeof canvasOrDataUrl.toDataURL === 'function') {
                dataUrl = canvasOrDataUrl.toDataURL('image/png');
            } else {
                console.warn('Saver.setImage: unsupported input for image conversion');
                return false;
            }
            this.set(path, dataUrl, autoSave);
            return true;
        } catch (e) {
            console.error('Saver.setImage failed', e);
            return false;
        }
    }

    // Convenience: retrieve image dataURL saved at path (or null if missing)
    getImage(path, defaultValue = null) {
        try {
            const v = this.get(path, defaultValue);
            return v === undefined ? defaultValue : v;
        } catch (e) {
            return defaultValue;
        }
    }

    // Get value using path
    get(path, defaultValue = null) {
        const res = this._getPathObj(path, false);
        if (!res) return defaultValue;
        const { obj, lastKey } = res;
        return obj.hasOwnProperty(lastKey) ? obj[lastKey] : defaultValue;
    }

    // Get value or add default if it doesn't exist
    getOrAdd(path, defaultValue) {
        const res = this._getPathObj(path, true);
        const { obj, lastKey } = res;
        if (!obj.hasOwnProperty(lastKey)) {
            obj[lastKey] = defaultValue;
            this.save();
        }
        return obj[lastKey];
    }

    // Remove value using path
    remove(path, autoSave = true) {
        const res = this._getPathObj(path, false);
        if (!res) return;
        const { obj, lastKey } = res;
        delete obj[lastKey];
        if (autoSave) this.save();
    }

    // Clear all data
    clear(autoSave = true) {
        this.savedata = {};
        if (autoSave) this.save();
    }
}
