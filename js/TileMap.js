// TileMap: maps world tile coordinates to TileSheet references.
// Each cell stores a reference to a tilesheet id and a tile key/index within that sheet.
export default class TileMap {
    constructor() {
        // internal maps per layer: layerName -> Map(key -> { tilesheetId, tileKey, rotation, invert })
        // key format inside each map: `${x}|${y}`
        this.maps = new Map();

        // registered tilesheets: id -> tilesheet object
        // a tilesheet can be any object the renderer understands (Image + slicePx + tiles map, etc.)
        this.tileSheets = new Map();
    }

    _key(x, y) {
        return `${x}|${y}`;
    }

    // Register a tilesheet under an id so map entries can reference it.
    registerTileSheet(id, tileSheetObj) {
        if (!id) throw new Error('registerTileSheet: id required');
        this.tileSheets.set(id, tileSheetObj);
    }

    unregisterTileSheet(id) {
        this.tileSheets.delete(id);
    }

    getTileSheet(id) {
        return this.tileSheets.get(id);
    }

    // Set a tile at integer coordinates x,y. tileKey may be a string name or numeric index
    // tilesheetId refers to a previously registered tilesheet.
    // rotation: integer 0..3 representing 90deg steps (optional, default 0)
    // layer: optional string to place this tile on (e.g. 'bg','base','overlay') - defaults to 'base'
    setTile(x, y, tilesheetId, tileKey, rotation = 0, invert = 1, layer = 'base') {
        const k = this._key(x, y);
        const m = this._getMap(layer);
        m.set(k, { tilesheetId, tileKey, rotation: Number(rotation) || 0, invert: invert, layer: layer });
    }

    // Get the raw mapping entry for coords (or undefined)
    getTile(x, y, layer = 'base') {
        const m = this._getMap(layer);
        return m.get(this._key(x, y));
    }

    // Convenience: return the tilesheet object and tileKey for rendering
    getTileRenderInfo(x, y, layer = 'base') {
        const entry = this.getTile(x, y, layer);
        if (!entry) return null;
        const sheet = this.getTileSheet(entry.tilesheetId) || null;
        return { sheet, tileKey: entry.tileKey, tilesheetId: entry.tilesheetId, rotation: entry.rotation ?? 0, invert: entry.invert ?? 1, layer: layer };
    }

    removeTile(x, y, layer = 'base') {
        const m = this._getMap(layer);
        m.delete(this._key(x, y));
    }

    clear() {
        // clear all layer maps
        this.maps.clear();
    }

    // Iterate over all placed tiles. callback receives (x, y, entry)
    // Iterate over placed tiles. If `layer` is provided only that layer is iterated.
    // callback receives (x, y, entry, layerName)
    forEach(callback, layer = null) {
        if (layer) {
            const m = this._getMap(layer);
            for (const [k, v] of m.entries()) {
                const [xs, ys] = k.split('|');
                const x = parseInt(xs, 10);
                const y = parseInt(ys, 10);
                callback(x, y, v, layer);
            }
            return;
        }
        for (const [layerName, m] of this.maps.entries()) {
            for (const [k, v] of m.entries()) {
                const [xs, ys] = k.split('|');
                const x = parseInt(xs, 10);
                const y = parseInt(ys, 10);
                callback(x, y, v, layerName);
            }
        }
    }

    // Return a small serializable object representing the map state.
    // tilesheet objects are not serialized — only their ids. Caller must manage tilesheet registration.
    toJSON() {
        const layers = {};
        for (const [layerName, m] of this.maps.entries()) {
            layers[layerName] = Array.from(m.entries());
        }
        return {
            layers, // { layerName: [["x|y", {tilesheetId,...}], ...] }
            tileSheetIds: Array.from(this.tileSheets.keys())
        };
    }

    // Load map state from JSON produced by toJSON(). Note: does not restore tilesheet objects.
    fromJSON(obj) {
        if (!obj) return;
        // clear existing maps
        this.maps.clear();
        if (obj.layers && typeof obj.layers === 'object') {
            for (const layerName of Object.keys(obj.layers)) {
                const entries = obj.layers[layerName];
                const m = this._getMap(layerName);
                if (Array.isArray(entries)) {
                    for (const [k, v] of entries) {
                        m.set(k, v);
                    }
                }
            }
        }
    }

    // helper: return existing map for layer, creating if missing
    _getMap(layer) {
        const name = layer || 'base';
        if (!this.maps.has(name)) this.maps.set(name, new Map());
        return this.maps.get(name);
    }
}
