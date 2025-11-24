export default class TileSheet {
    /**
     * tilemap wraps a sprite sheet image where each tile is a fixed square slicePx.
     * tiles: Map or plain object mapping name -> { row, col }
     */
    constructor(sheet, slicePx, tiles = null) {
        this.sheet = sheet; // HTMLImageElement or similar
        this.slicePx = slicePx;
        if (tiles) this.tiles = tiles;
        else this.tiles = new Map();
    }

    // name -> {row, col}
    addTile(name, row, col) {
        this.tiles.set(name, { row: row, col: col });
    }

    removeTile(name) {
        this.tiles.delete(name);
    }

    // returns the raw tile meta ({row, col}) or undefined
    getTile(name) {
        if (!name) return undefined;
        if (this.tiles instanceof Map) return this.tiles.get(name);
        return this.tiles ? this.tiles[name] : undefined;
    }
}
