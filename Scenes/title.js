import Scene from './Scene.js';
import Vector from '../js/Vector.js';
import SoundManager from '../js/SoundManager.js'
import MusicManager from '../js/MusicManager.js'
import Color from '../js/Color.js';
import Geometry from '../js/Geometry.js';
import LoadingOverlay from '../js/UI/LoadingOverlay.js';
import createHButton from '../js/htmlElements/createHButton.js';
import createHDiv from '../js/htmlElements/createHDiv.js';
import { TestSprite } from '../js/sprites/sprites.js';
import SpriteSheet from '../js/Spritesheet.js';
import TileSheet from '../js/Tilesheet.js';
import TileMap from '../js/TileMap.js';
import PackageManager from '../js/PackageManager.js';
import Palette from '../js/UI/Palette.js';
import UIButton from '../js/UI/Button.js';

export class TitleScene extends Scene {
    constructor(...args) {
        super('title', ...args);
        this.loaded = 0;
        // default draw layer for placement: 'base' | 'bg' | 'overlay'
        this.drawLayer = 'base';
        // Number of players expected in session (1 by default). Used by
        // multiplayer logic to decide whether to send/receive state.
        this.playerCount = 1;
        this.defaultSaveData = {
            'settings':{
                'volume': {

                },
                'colors':{

                },
                'particles':0.1
            },
            'game':{

            }
        }
        this.settings = this.defaultSaveData.settings;
        this.elements = new Map()
        
    }
    onSwitchTo(){
        super.onSwitchTo()
        
    }
    /**
     * Preload necesary resources. Called BEFORE onReady()
     */
    async onPreload(resources=null) {
        this.soundGuy = new SoundManager()
        this.musician = new SoundManager()
        this.conductor = new MusicManager(this.musician)
        // Ensure skipLoads flag exists (default false) and register a shortcut signal
        window.Debug.addFlag('skipLoads', false);
        window.Debug.createSignal('skip', ()=>{ window.Debug.addFlag('skipLoads', true); });

        // Create and show loading overlay
        try {
            this._loadingOverlay = document.querySelector('loading-overlay') || new LoadingOverlay();
            if (!document.body.contains(this._loadingOverlay)) document.body.appendChild(this._loadingOverlay);
            this._loadingOverlay.setTitle('Dragons Don\'t Like Tetris');
            this._loadingOverlay.setMessage('Starting...');
            this._loadingOverlay.setProgress(0);
            this._loadingOverlay.show();
        } catch (e) {
            console.warn('Could not create loading overlay:', e);
        }
        await this.loadImages()
        this._loadingOverlay && this._loadingOverlay.setProgress(0.25);
        this._loadingOverlay && this._loadingOverlay.setMessage('Loading sounds...');
        await this.loadSounds()
        this._loadingOverlay && this._loadingOverlay.setProgress(0.5);
        if(window.Debug.getFlag('skipLoads')===false){
            await this.loadMusic()
        }else{  
            this.loaded+=2;
        }
        if(this.loaded>=3){
            console.log('Finished loading')
        }
        try {
            // Only start the conductor if music was loaded or if the user hasn't skipped loads
            if (!window.Debug || !window.Debug.skipLoads) {
                this.conductor.start(0.5);
            } else {
                console.log('Skipping conductor.start because skipLoads is enabled');
            }
        } catch (e) {
            console.warn('Conductor start failed:', e);
        }
        this.EM.connect('2Player', (id) => {
            this.enableTwoPlayer(id);
        });
    }

    /**
     * Load images
     */
    async loadImages(){
        // Set up image paths, map them to Image objects after.
        // Examples:
        this.BackgroundImageLinks = {
            'house': 'Assets/Tilemaps/House-tilemap.png'
        }

        this.BackgroundImages = {
            'house': new Image()
        }

        this.SpriteImageLinks = {
            'cat':'Assets/Sprites/cat.png'
        }

        this.SpriteImages = {
            'cat': new Image()
        }



        for(let file in this.BackgroundImages){
            this.BackgroundImages[file].src = this.BackgroundImageLinks[file];
            if (this._loadingOverlay) {
                // rough incremental progress while images load
                const idx = Object.keys(this.BackgroundImages).indexOf(file);
                const total = Object.keys(this.BackgroundImages).length + Object.keys(this.SpriteImages).length;
                const progress = Math.min(0.2, ((idx + 1) / total) * 0.2);
                this._loadingOverlay.setProgress(progress);
            }
        }
        for(let file in this.SpriteImages){
            this.SpriteImages[file].src = this.SpriteImageLinks[file];
            if (this._loadingOverlay) {
                const idx = Object.keys(this.SpriteImages).indexOf(file) + Object.keys(this.BackgroundImages).length;
                const total = Object.keys(this.BackgroundImages).length + Object.keys(this.SpriteImages).length;
                const progress = Math.min(0.25, ((idx + 1) / total) * 0.25);
                this._loadingOverlay.setProgress(progress);
            }
        }
        // Images loaded
        this.loaded += 1;
        this._loadingOverlay && this._loadingOverlay.setProgress(0.25);
    }

    /**
     * Load music
     */
    async loadMusic(){
        // Get music files
        const musicFiles = [
            //['intro', "Assets/sounds/music_intro.wav"],
            //['part1', "Assets/sounds/music_part1.wav"],
            //['part2', "Assets/sounds/music_part2.wav"],
            //['segue', "Assets/sounds/music_segue.wav"],
            //['part3', "Assets/sounds/music_part3.wav"]
        ];
        // Load music files
        let musicSkipped = false;
        for (const [key, path] of musicFiles) {
            // If the debug flag was toggled to skip during loading, stop further loads
            if (window.Debug && typeof window.Debug.getFlag === 'function' && window.Debug.getFlag('skipLoads')) {
                console.log('Skipping remaining music loads (user requested skip)');
                musicSkipped = true;
                break;
            }
            await this.musician.loadSound(key, path);
            if (this._loadingOverlay) {
                // progress between 50% and 90% during music load
                const idx = musicFiles.findIndex(m => m[0] === key);
                const progress = 0.5 + (idx + 1) / musicFiles.length * 0.4;
                this._loadingOverlay.setProgress(progress);
                this._loadingOverlay.setMessage(`Loading music: ${key}`);
            }
        }
        // Music loaded
        if (musicSkipped) {
            this.loaded += 1;
            this._loadingOverlay && this._loadingOverlay.setMessage('Music skipped');
            return;
        }

        // Set up conductor sections and conditions for music transitions
        this.conductor.setSections([
            { name: "intro", loop: false },
            { name: "part1", loop: true },
            { name: "part2", loop: true },
            { name: "part3", loop: true },
            { name: "part4", loop: true },
            { name: "segue", loop: false },
            { name: "part5", loop: false }
        ]);

        // conditions correspond to section indexes 1..4
        const conditions = [
            () => 1+1==11, //example condition
        ];
        conditions.forEach((cond, i) => this.conductor.setCondition(i + 1, cond));

        // Start playback
        this.loaded += 1;
        this._loadingOverlay && this._loadingOverlay.setProgress(0.9);
    }

    /**
     * Load sounds
     */
    async loadSounds(){
        // Loading sound effects

        // Just some example sound effects
        const sfx = [
            //['crash', 'Assets/sounds/crash.wav'],
            //['break', 'Assets/sounds/break.wav'],
            //['place', 'Assets/sounds/place.wav'],
            //['rotate', 'Assets/sounds/rotate.wav'],
        ];

        for (const [key, path] of sfx) {
            await this.soundGuy.loadSound(key, path);
            if (this._loadingOverlay) {
                const idx = sfx.findIndex(s => s[0] === key);
                const progress = 0.25 + (idx + 1) / sfx.length * 0.25;
                this._loadingOverlay.setProgress(progress);
                this._loadingOverlay.setMessage(`Loading SFX: ${key}`);
            }
        }
        // Sound effects loaded
        this.loaded += 1;
        this._loadingOverlay && this._loadingOverlay.setProgress(0.5);
    }


    /**
     * Get data from server and apply to local game state.
     * Data looks like: state[remoteId + 'key']
     * 
     * Use sendState to send data.
     * 
     * This is called automatically when new data is received from the server.
     * 
     * @param {*} state The data sent from the server
     * @returns 
     */
    applyRemoteState = (state) => {
        if (!state) return;
        // Default handling deferred to base Scene.applyRemoteState
        if (typeof super.applyRemoteState === 'function') return super.applyRemoteState(state);
    }

    /** 
     * Advance local tick count to match remote player's tick count. 
     * */
    applyTick(remoteId, state){
        const tickKey = remoteId + 'tick'; 
        if (!(tickKey in state)) return; 
        while (state[tickKey] > this.tickCount) this.tick();
        
    } 

    /** 
     * Called when the scene is ready. 
     * Declare variables here, NOT in the constructor.
     */
    onReady() {
        this.twoPlayer = false;
        this.isReady = true;
        this.createUI()
        // Hide loading overlay now

        try {
            this._loadingOverlay && this._loadingOverlay.hide();
        } catch (e) { /* ignore */ }
        this.saver.set('twoPlayer',false)
        this.playerId = null;
        // Store a bound handler so we can safely disconnect it later.
        this._rssHandler = (state) => { this.applyRemoteState(state); };
        if (this.RSS && typeof this.RSS.connect === 'function') this.RSS.connect(this._rssHandler);

        const img = this.SpriteImages['cat'];
        const sheet = new SpriteSheet(img, 32);
        // animations: sit:4,sit2:4,lick:4,lick2:4,walk:8,run:8,sleep:4,play:6,pounce:7,stretch:8
        const animList = ['sit','sit2','lick','lick2','walk','run','sleep','play','jump','stretch'];
        const frameCounts = [4,4,4,4,8,8,4,6,7,8];
        for (let i = 0; i < animList.length; i++) {
            sheet.addAnimation(animList[i], i, frameCounts[i]);
        }
        sheet.addAnimation('land', 8, 7);

        this.loadTilemap()

        // create package manager for import/export (needs tilemap)
        this.drawSheet = 'house';
        this.packageManager = null; // initialized after tilemap
        // UI click debounce flag (prevents multiple triggers per press)
        this._uiHandled = false;

        // Ensure drawLayer exists (can be toggled by UI buttons)
        this.drawLayer = this.drawLayer || 'base';

        // Level editor
        this.levelOffset = new Vector(50,0)
        this.tileSize = 120
        this.cursor = new Vector(0,0)
        // smooth panning velocity (used for wheel and drag smoothing)
        this.panVelocity = new Vector(0,0);
        this.panDamping = 32; // higher -> faster stop
        this.panImpulse = 10; // multiplier when applying wheel/shift impulses
        // create test sprite (after tilemap, tileSize and levelOffset are initialized)
        this.testSprite = new TestSprite(this.keys, this.Draw, new Vector(128,128), new Vector(256,256), sheet)
        // assign tile-related references externally so TestSprite keeps the scene's live references
        this.testSprite.tilemap = this._tilemap;
        this.testSprite.tileSize = this.tileSize;
        this.testSprite.levelOffset = this.levelOffset;
        this.startOffset = null
        this.drawType = 'floor'
        this.drawRot = 0
        this.drawInvert = 1
        this.rotDelay = 0.2
        this.rotSetDelay = 0.1
        // Build a grid-based palette from the registered tilesheet (row,col entries)
        this.uiMenu = {
            margin: 10,
            menuWidth: 48*5,
            itemSize: 48,
            spacing: 8
        }
        // tileTypes will be filled after tilesheet is available
        this.tileTypes = []
        // temporary tile positions for tools (array of {x,y} or Vector)
        this.tempTiles = [];
        // Tool state: null | 'line' | 'box' | 'circle'
        this.toolMode = null;
        this.toolActive = false;
        this.toolStart = null; // {x,y}
        // Undo stack: array of batches, each batch is [{x,y,prev,next}, ...]
        this.undoStack = [];
        this.maxUndo = 200;
        this._suppressUndo = false;
        // zoom state
        this.zoom = 1.0
        this.zoomStep = 0.1
        this.minZoom = 0.1
        this.maxZoom = 10.0
        this.zoomOrigin = null
        // selection state for editor (selected placed tile)
        this.selectedTile = null; // { x, y, info }
        this.selectionColor = '#FF0000FF';
        // edit mode (false = normal, true = editing a selected tile)
        this.editmode = false;
            this.editMenuWidth = 300;
        // quick color picker for edit panel (array of Color instances)
        this.editPaletteColors = ['#000000FF','#FFFFFFFF','#FF0000FF','#00FF00FF','#0000FFFF','#FFFF00FF','#FF00FFFF','#808080FF','#C08040FF'].map(c=>Color.convertColor(c));
        this.editColor = Color.convertColor('#FFFFFFFF');
        // eyedropper / color input state
        this.eyedropActive = false;
        // brush size for pixel-editing (1..n pixels)
        this.editBrushSize = 1;
        // Camera follow state (lock when arrow keys pressed, unlock on mouse movement)
        this.camera = {
            locked: false,
            // damping rate (larger -> faster following)
            smooth: 2,
            // fraction of viewport width to bias ahead of movement direction
            bias: 0.25,
            // track last mouse pos to detect movement for unlock
            lastMousePos: (this.mouse && this.mouse.pos) ? this.mouse.pos.clone() : new Vector(0,0),
            // movement (px) threshold to consider mouse moved
            unlockDistance: 4
        };
        this.undoTimer = 0
        
    }

    /**
     * Create simple UI buttons to switch draw layer (bg, base, overlay)
     */
    createUI() {
        try {
            // small container (attached to UI layer). Give it a stable id so other
            // scenes can reuse the same DOM container for persistent buttons.
            const panel = createHDiv('layer-panel', new Vector(8, 8), new Vector(540, 44), '#00000033', {
                borderRadius: '6px', border: '1px solid #FFFFFF22', padding: '6px', display: 'flex', alignItems: 'center', gap: '6px'
            }, 'UI');

            // Scene swap buttons (HTML buttons that persist between scenes). We place
            // them in the same panel so they remain visible when switching scenes.
            const sceneBtnSize = new Vector(80, 28);
            const tilesSceneBtn = createHButton('tiles-scene-btn', new Vector(6, 8), sceneBtnSize, '#333', { color: '#fff', borderRadius: '4px', fontSize: 13, border: '1px solid #777' }, panel);
            tilesSceneBtn.textContent = 'Tiles';
            const spritesSceneBtn = createHButton('sprites-scene-btn', new Vector(92, 8), sceneBtnSize, '#333', { color: '#fff', borderRadius: '4px', fontSize: 13, border: '1px solid #777' }, panel);
            spritesSceneBtn.textContent = 'Sprites';
            const collisionSceneBtn = createHButton('collision-scene-btn', new Vector(178, 8), sceneBtnSize, '#333', { color: '#fff', borderRadius: '4px', fontSize: 13, border: '1px solid #777' }, panel);
            collisionSceneBtn.textContent = 'Collision';

            // Bind scene switching. `this.switchScene` is bound to the Game.switchScene
            // when the scene instance is constructed, so calling it will switch scenes.
            tilesSceneBtn.addEventListener('click', () => { try { this.switchScene && this.switchScene('title'); } catch(e){} });
            spritesSceneBtn.addEventListener('click', () => { try { this.switchScene && this.switchScene('spriteScene'); } catch(e){} });
            collisionSceneBtn.addEventListener('click', () => { try { this.switchScene && this.switchScene('collision'); } catch(e){} });

            const btnSize = new Vector(88, 32);
            const bgBtn = createHButton(null, new Vector(266, 8), btnSize, '#333', { color: '#fff', borderRadius: '4px', fontSize: 14, border: '1px solid #777' }, panel);
            bgBtn.textContent = 'BG';
            const baseBtn = createHButton(null, new Vector(364, 8), btnSize, '#333', { color: '#fff', borderRadius: '4px', fontSize: 14, border: '1px solid #777' }, panel);
            baseBtn.textContent = 'Base';
            const ovBtn = createHButton(null, new Vector(462, 8), btnSize, '#333', { color: '#fff', borderRadius: '4px', fontSize: 14, border: '1px solid #777' }, panel);
            ovBtn.textContent = 'Overlay';

            const setActive = (name) => {
                this.drawLayer = name;
                bgBtn.style.background = (name === 'bg') ? '#555' : '#333';
                baseBtn.style.background = (name === 'base') ? '#555' : '#333';
                ovBtn.style.background = (name === 'overlay') ? '#555' : '#333';
            };

            bgBtn.addEventListener('click', () => setActive('bg'));
            baseBtn.addEventListener('click', () => setActive('base'));
            ovBtn.addEventListener('click', () => setActive('overlay'));

            // store references so other UI code can query
            this.layerUI = { panel, bgBtn, baseBtn, ovBtn, tilesSceneBtn, spritesSceneBtn, collisionSceneBtn };
            // reflect current
            setActive(this.drawLayer || 'base');

            // mark the current scene button active (we are in the Tiles scene)
            try {
                tilesSceneBtn.style.background = '#555';
                spritesSceneBtn.style.background = '#333';
                collisionSceneBtn.style.background = '#333';
            } catch(e){}
        } catch (e) {
            console.warn('createUI failed:', e);
        }
    }

    loadTilemap(){
        const bg = this.BackgroundImages['house'];
        // create a tilesheet and register it with a TileMap
        const ts = new TileSheet(bg, 16);
        ts.addTile('sample', 0, 0);
        this._tilemap = new TileMap();
        this._tilemap.registerTileSheet('house', ts);
        // place the sample tile at map coordinate (0,0)
        // place a 4x4 box starting at map coordinate (0,0)
        // tilesheet layout (col,row): [0,0]=floor, [1,0]=wall, [2,0]=roof
        ts.addTile('floor', 0, 0);
        ts.addTile('wall', 0, 1);
        ts.addTile('roof', 0, 2);

        this._tilemap.setTile(0,5,'house','wall',2, undefined, 'base')
        this._tilemap.setTile(0,6,'house','wall',2, undefined, 'base')
        this._tilemap.setTile(0,7,'house','wall',2, undefined, 'base')
        this._tilemap.setTile(0,8,'house','wall',2, undefined, 'base')
        this._tilemap.setTile(1,8,'house','floor',0, undefined, 'base')
        this._tilemap.setTile(2,8,'house','floor',0, undefined, 'base')
        this._tilemap.setTile(3,8,'house','floor',0, undefined, 'base')

        // populate tileTypes from all registered sheets (sheetId,row,col entries)
        this.tileTypes = [];
        for (const [id, sheetObj] of this._tilemap.tileSheets.entries()) {
            try {
                const img = sheetObj.sheet;
                const cols = Math.max(1, Math.floor(img.width / sheetObj.slicePx));
                const rows = Math.max(1, Math.floor(img.height / sheetObj.slicePx));
                for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                        this.tileTypes.push({ sheetId: id, row: r, col: c });
                    }
                }
            } catch (e) { /* ignore */ }
        }
    }

    // Prepare an offscreen edit canvas for the currently selected tile.
    prepareEditTile(){
        try {
            if (!this.selectedTile || !this.selectedTile.info) return false;
            const info = this.selectedTile.info;
        const ts = info.sheet; // TileSheet object
            const slice = ts.slicePx || 16;

            // determine row/col of the tileKey
            let row = 0, col = 0;
            const tk = info.tileKey;
            if (Array.isArray(tk)) {
                row = tk[0]; col = tk[1];
            } else if (typeof tk === 'string' && typeof ts.getTile === 'function') {
                const meta = ts.getTile(tk);
                if (meta) { row = meta.row; col = meta.col; }
            }

            // ensure the master tilesheet is a canvas so we can write back pixels
            if (!(ts.sheet instanceof HTMLCanvasElement)) {
                const orig = ts.sheet;
                const cv = document.createElement('canvas');
                cv.width = orig.width || (col + 1) * slice;
                cv.height = orig.height || (row + 1) * slice;
                const ctx = cv.getContext('2d');
                try { ctx.drawImage(orig, 0, 0); } catch (e) { console.warn('prepareEditTile drawImage failed', e); }
                ts.sheet = cv;
            }

            // create edit canvas sized to the tile pixel dimensions
            const edit = document.createElement('canvas');
            edit.width = slice;
            edit.height = slice;
            const ectx = edit.getContext('2d');
            // copy the tile pixels from the master tilesheet into edit canvas
            try {
                ectx.clearRect(0,0,edit.width, edit.height);
                ectx.drawImage(ts.sheet, col * slice, row * slice, slice, slice, 0, 0, slice, slice);
            } catch (e) { console.warn('prepareEditTile draw failed', e); }

            this.editTileCanvas = edit;
            this.editTilesheet = ts;
            this.editTileRow = row;
            this.editTileCol = col;
            // zoom for editor view (scale up for comfortable editing)
            this.editTileZoom = Math.max(4, Math.floor((this.editMenuWidth - 40) / slice));
            this.editColor = this.editColor || '#FFFFFFFF';
            return true;
        } catch (e) {
            console.warn('prepareEditTile failed', e);
            return false;
        }
    }

    // Create a new standalone tilesheet (1 tile) and open it for editing
    createNewTile(){
        try {
            // Use the slice size from the current edit tilesheet if available, else default to 16
            const baseTs = this.editTilesheet || (this.selectedTile && this.selectedTile.info && this.selectedTile.info.sheet) || null;
            const slice = (baseTs && baseTs.slicePx) ? baseTs.slicePx : 16;

            // create a small canvas for a single tile and fill with current edit color
            const cv = document.createElement('canvas');
            cv.width = slice;
            cv.height = slice;
            const ctx = cv.getContext('2d');
            try {
                // If we're currently editing a tile, copy that tile's pixels into the new tile
                if (this.editTileCanvas && this.editTileCanvas.width && this.editTileCanvas.height) {
                    try {
                        // draw/edit canvas into the new canvas, scaling if necessary
                        if (this.editTileCanvas.width === slice && this.editTileCanvas.height === slice) {
                            ctx.clearRect(0,0,slice,slice);
                            ctx.drawImage(this.editTileCanvas, 0, 0);
                        } else {
                            ctx.clearRect(0,0,slice,slice);
                            ctx.drawImage(this.editTileCanvas, 0, 0, this.editTileCanvas.width, this.editTileCanvas.height, 0, 0, slice, slice);
                        }
                    } catch (e) {
                        // fallback to fill with selected color if drawImage fails
                        const col = Color.convertColor(this.editColor || '#FFFFFFFF').toRgb();
                        const r = Math.round(col.a || 0);
                        const g = Math.round(col.b || 0);
                        const b = Math.round(col.c || 0);
                        const a = Math.round((col.d || 1) * 255);
                        ctx.fillStyle = `rgba(${r},${g},${b},${a/255})`;
                        ctx.fillRect(0,0,slice,slice);
                    }
                } else {
                    // use Color helper to produce rgb bytes
                    const col = Color.convertColor(this.editColor || '#FFFFFFFF').toRgb();
                    const r = Math.round(col.a || 0);
                    const g = Math.round(col.b || 0);
                    const b = Math.round(col.c || 0);
                    const a = Math.round((col.d || 1) * 255);
                    ctx.fillStyle = `rgba(${r},${g},${b},${a/255})`;
                    ctx.fillRect(0,0,slice,slice);
                }
            } catch (e) { /* ignore */ }

            const ts = new TileSheet(cv, slice);
            const tileName = `tile_0_0`;
            try { ts.addTile(tileName, 0, 0); } catch (e) { /* ignore */ }

            // register as a new tilesheet id
            this._newSheetCounter = (this._newSheetCounter || 0) + 1;
            const sheetId = `customsheet_${Date.now().toString(36)}_${this._newSheetCounter}`;
            this._tilemap.registerTileSheet(sheetId, ts);

            // rebuild palette entries so UI shows the new tile
            this.tileTypes = [];
            for (const [id, tss] of this._tilemap.tileSheets.entries()) {
                try {
                    const img = tss.sheet;
                    const cols = Math.max(1, Math.floor(img.width / tss.slicePx));
                    const rows = Math.max(1, Math.floor(img.height / tss.slicePx));
                    for (let r = 0; r < rows; r++) {
                        for (let c = 0; c < cols; c++) {
                            this.tileTypes.push({ sheetId: id, row: r, col: c });
                        }
                    }
                } catch (e) { /* ignore */ }
            }
 
            // open the new tile in the editor
            this.editTilesheet = ts;
            this.editTileRow = 0;
            this.editTileCol = 0;
            // If a placed tile is currently selected, replace it with the new tile
            if (this.selectedTile && typeof this.selectedTile.x === 'number' && typeof this.selectedTile.y === 'number') {
                try {
                    // place the new tile at the selected coordinates (use array [row,col])
                    const placeLayer = (this.selectedTile.info && this.selectedTile.info.layer) ? this.selectedTile.info.layer : this.drawLayer || 'base';
                    this._tilemap.setTile(this.selectedTile.x, this.selectedTile.y, sheetId, [0,0], 0, undefined, placeLayer);
                    // update selectedTile.info so editor shows the new tile
                    this.selectedTile.info = { sheet: ts, tileKey: [0,0], tilesheetId: sheetId, rotation: 0, layer: placeLayer };
                } catch (e) { /* ignore placement errors */ }
            } else {
                // set palette drawing to the new tile so user can place it
                this.drawSheet = sheetId;
                this.drawType = [0,0];
            }

            // prepare the edit canvas using selectedTile.info (or direct tilesheet info)
            this.prepareEditTile();
            // open the editor for the newly created tile
            this.editmode = true;
            try { if (this.mouse && typeof this.mouse._setButton === 'function') this.mouse._setButton(0,0); } catch (e) {}
            this.rotDelay = this.rotSetDelay;
            return true;
        } catch (e) {
            console.warn('createNewTile failed', e);
            return false;
        }
    }

    // Apply the contents of editTileCanvas back into the registered tilesheet image
    applyEditTileToTilesheet(){
        try {
            if (!this.editTileCanvas || !this.editTilesheet) return false;
            const slice = this.editTileCanvas.width;
            const sx = this.editTileCol * slice;
            const sy = this.editTileRow * slice;
            const ctx = this.editTilesheet.sheet.getContext('2d');
            ctx.clearRect(sx, sy, slice, slice);
            ctx.drawImage(this.editTileCanvas, 0, 0, slice, slice, sx, sy, slice, slice);
            return true;
        } catch (e) {
            console.warn('applyEditTileToTilesheet failed', e);
            return false;
        }
    }

    exitEditMode(){
        try {
            // apply any remaining changes
            this.applyEditTileToTilesheet();
    } catch (e) { console.warn('tempTiles preview block failed', e); }
        this.editmode = false;
        // keep edit canvas in memory if needed, but could cleanup
    }

    // Start an animated zoom that focuses the view on the currently selected tile.
    _startEditZoom(duration = 0.45) {
        if (!this.selectedTile) return;
        const drawCtx = this.Draw.ctx;
        if (!drawCtx || !drawCtx.canvas) return;

        const uiW = drawCtx.canvas.width / this.Draw.Scale.x;
        const uiH = drawCtx.canvas.height / this.Draw.Scale.y;
        const center = new Vector(uiW / 2, uiH / 2);

        // choose a target zoom so the tile occupies a large portion of the view
        const approx = Math.floor((Math.min(uiW, uiH) * 0.6) / this.tileSize);
        const targetZoom = Math.max(1.25, Math.min(this.maxZoom || 10, approx || 3));

        // compute world position of the tile (top-left)
        const tileWorld = new Vector(this.selectedTile.x * this.tileSize, this.selectedTile.y * this.tileSize);

        // compute new levelOffset so tileWorld maps to screen center under targetZoom
        // formula derived from: S = newZoom * (W + levelOffset) + (1 - newZoom) * origin
        // => levelOffset = (S + (newZoom - 1) * origin) / newZoom - W
    const newZoom = targetZoom;
    const origin = center;
    const S = center;
    // Compute levelOffset so that the tile's center maps to screen center.
    const tileCenter = tileWorld.addS(new Vector(this.tileSize / 2, this.tileSize / 2));
    const newLevelOffset = center.sub(tileCenter);

        // store animation state
        this._editZooming = true;
        this._editZoomTime = 0;
        this._editZoomDuration = duration;
        this._editZoomFrom = this.zoom;
        this._editZoomTo = newZoom;
        this._editZoomFromOffset = this.levelOffset.clone ? this.levelOffset.clone() : new Vector(this.levelOffset.x, this.levelOffset.y);
        this._editZoomToOffset = newLevelOffset;
        // set zoom origin so transforms center on screen during animation
        this.zoomOrigin = center;
    }

    // Convert hex color '#RRGGBBAA' or '#RRGGBB' into [r,g,b,a]
    _hexToRGBA(hex){
        if (!hex) return [0,0,0,255];
        let h = hex.replace('#','');
        if (h.length === 6) h += 'FF';
        if (h.length !== 8) return [0,0,0,255];
        const r = parseInt(h.substr(0,2),16);
        const g = parseInt(h.substr(2,2),16);
        const b = parseInt(h.substr(4,2),16);
        const a = parseInt(h.substr(6,2),16);
        return [r,g,b,a];
    }

    // Save the current tilemap and editor state to the Saver under maps/<name>
    saveMap(name = 'default'){
        try {
            const payload = {
                map: (this._tilemap && typeof this._tilemap.toJSON === 'function') ? this._tilemap.toJSON() : null,
                levelOffset: Vector.encode(this.levelOffset),
                tileSize: this.tileSize,
                drawType: this.drawType,
                drawRot: this.drawRot,
                drawInvert: this.drawInvert,
                zoom: this.zoom
            };
            this.saver.set('maps/' + name, payload);
            console.log('Map saved:', name);
        } catch (e) {
            console.warn('Save failed:', e);
        }
    }

    // Load a saved tilemap/editor state from Saver (maps/<name>)
    loadMap(name = 'default'){
        try {
            const payload = this.saver.get('maps/' + name);
            if (!payload) {
                console.warn('No saved map found for', name);
                return false;
            }
            if (this._tilemap && typeof this._tilemap.fromJSON === 'function' && payload.map) this._tilemap.fromJSON(payload.map);
            try { this.levelOffset = Vector.decode(payload.levelOffset); } catch (e) { /* ignore */ }
            this.tileSize = payload.tileSize || this.tileSize;
            this.drawType = payload.drawType || this.drawType;
            this.drawRot = payload.drawRot || this.drawRot;
            this.drawInvert = payload.drawInvert || this.drawInvert;
            this.zoom = payload.zoom || this.zoom;
            console.log('Map loaded:', name);
            return true;
        } catch (e) {
            console.warn('Load failed:', e);
            return false;
        }
    }

    // Load map data from a plain payload object (useful for import)
    loadMapFromPayload(payload){
        try {
            if (!payload) return false;
            if (this._tilemap && typeof this._tilemap.fromJSON === 'function' && payload.map) this._tilemap.fromJSON(payload.map);
            try { this.levelOffset = Vector.decode(payload.levelOffset); } catch (e) { /* ignore */ }
            this.tileSize = payload.tileSize || this.tileSize;
            this.drawType = payload.drawType || this.drawType;
            this.drawRot = payload.drawRot || this.drawRot;
            this.drawInvert = payload.drawInvert || this.drawInvert;
            this.zoom = payload.zoom || this.zoom;
            console.log('Map payload applied');
            return true;
        } catch (e) {
            console.warn('Applying map payload failed:', e);
            return false;
        }
    }

    // Export current map/editor state to a downloadable JSON file
    saveMapToFile(filename = 'map.json'){
        try {
            const payload = {
                map: (this._tilemap && typeof this._tilemap.toJSON === 'function') ? this._tilemap.toJSON() : null,
                levelOffset: Vector.encode(this.levelOffset),
                tileSize: this.tileSize,
                drawType: this.drawType,
                drawRot: this.drawRot,
                drawInvert: this.drawInvert,
                zoom: this.zoom
            };
            const json = JSON.stringify(payload, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            console.log('Map exported to file:', filename);
        } catch (e) {
            console.warn('Export failed:', e);
        }
    }

    // Export currently registered tilesheets including image data (dataURLs)
    // Create a tar archive Blob from entries: [{name, uint8Array}]
    async createTarBlob(entries){
        // helper to create header
        function writeString(buf, offset, str, length){
            for (let i=0;i<length;i++) buf[offset+i]=0;
            const bytes = new TextEncoder().encode(str);
            buf.set(bytes.subarray(0, Math.min(bytes.length, length)), offset);
        }

        const parts = [];
        for (const ent of entries){
            const name = ent.name;
            const data = ent.data instanceof Uint8Array ? ent.data : (ent.data instanceof ArrayBuffer ? new Uint8Array(ent.data) : new Uint8Array(ent.data));
            const size = data.length;

            const header = new Uint8Array(512);
            writeString(header, 0, name, 100);
            writeString(header, 100, '0000777', 8);
            writeString(header, 108, '0000000', 8);
            writeString(header, 116, '0000000', 8);
            // size field as octal
            const sizeOct = size.toString(8).padStart(11,'0') + '\0';
            writeString(header, 124, sizeOct, 12);
            const mtimeOct = Math.floor(Date.now()/1000).toString(8).padStart(11,'0') + '\0';
            writeString(header, 136, mtimeOct, 12);
            // checksum: fill with spaces for now
            for (let i=148;i<156;i++) header[i]=32;
            header[156]=48; // typeflag '0'
            writeString(header, 257, 'ustar\0', 6);
            writeString(header, 263, '00', 2);
            // compute checksum
            let sum = 0;
            for (let i=0;i<512;i++) sum += header[i];
            const chks = sum.toString(8).padStart(6,'0') + '\0 ';
            writeString(header, 148, chks, 8);

            parts.push(header);
            parts.push(data);
            // pad to 512
            const pad = (512 - (size % 512)) % 512;
            if (pad>0) parts.push(new Uint8Array(pad));
        }
        // two 512-byte zero blocks
        parts.push(new Uint8Array(512));
        parts.push(new Uint8Array(512));

        return new Blob(parts, { type: 'application/x-tar' });
    }

    // Export currently registered tilesheets as a tar archive including JSON and image files
    async exportTileSheetsAsTarFile(filename = 'tilesheets.tar'){
        console.log('exporting')
        try {
            const sheets = [];
            const entries = [];
            for (const [id, ts] of this._tilemap.tileSheets.entries()) {
                // gather tiles map
                let tilesObj = {};
                try {
                    if (ts.tiles instanceof Map) {
                        for (const [k, v] of ts.tiles.entries()) tilesObj[k] = v;
                    } else if (ts.tiles) {
                        tilesObj = ts.tiles;
                    }
                } catch (e) { tilesObj = {}; }

                // convert image to blob if possible
                try {
                    const img = ts.sheet;
                    if (img && img.width && img.height) {
                        // draw to canvas and get PNG blob
                        const c = document.createElement('canvas');
                        c.width = img.width;
                        c.height = img.height;
                        const ctx = c.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
                        const arrayBuf = await blob.arrayBuffer();
                        entries.push({ name: `images/${id}.png`, data: new Uint8Array(arrayBuf) });
                        sheets.push({ id, slicePx: ts.slicePx, tiles: tilesObj, imageFile: `images/${id}.png` });
                    } else if (img && img.src) {
                        // fallback: include src as text file
                        entries.push({ name: `images/${id}.txt`, data: new TextEncoder().encode(img.src) });
                        sheets.push({ id, slicePx: ts.slicePx, tiles: tilesObj, imageFile: `images/${id}.txt` });
                    }
                } catch (e) {
                    console.warn('Could not include image for', id, e);
                    sheets.push({ id, slicePx: ts.slicePx, tiles: tilesObj, imageFile: null });
                }
            }

            const payload = { sheets };
            const json = JSON.stringify(payload, null, 2);
            entries.push({ name: 'tilesheets.json', data: new TextEncoder().encode(json) });

            // include current map/editor state as map.json
            try {
                const mapPayload = {
                    map: (this._tilemap && typeof this._tilemap.toJSON === 'function') ? this._tilemap.toJSON() : null,
                    levelOffset: (this.levelOffset && typeof this.levelOffset.encode === 'function') ? this.levelOffset.encode ? this.levelOffset.encode() : Vector.encode(this.levelOffset) : Vector.encode(this.levelOffset),
                    tileSize: this.tileSize,
                    drawType: this.drawType,
                    drawRot: this.drawRot,
                    drawInvert: this.drawInvert,
                    zoom: this.zoom
                };
                const mapJson = JSON.stringify(mapPayload, null, 2);
                entries.push({ name: 'map.json', data: new TextEncoder().encode(mapJson) });
            } catch (e) { /* ignore map export errors */ }

            const tarBlob = await this.createTarBlob(entries);

            // Try to use the File System Access API so user can pick a filename and overwrite existing files.
            // Fallback to a regular download (with a prompt for filename) when unavailable.
            try {
                if (window.showSaveFilePicker) {
                    const opts = {
                        suggestedName: filename,
                        types: [
                            {
                                description: 'TAR Archive',
                                accept: { 'application/x-tar': ['.tar'] }
                            }
                        ]
                    };
                    let handle;
                    try {
                        handle = await window.showSaveFilePicker(opts);
                    } catch (pickerErr) {
                        // If the user cancelled the picker, abort the export (don't fall back)
                        if (pickerErr && (pickerErr.name === 'AbortError' || pickerErr.name === 'NotAllowedError')) {
                            console.log('Save cancelled by user. Export aborted.');
                            return;
                        }
                        // otherwise rethrow to outer catch
                        throw pickerErr;
                    }
                    // createWritable will overwrite the file if it already exists
                    const writable = await handle.createWritable();
                    // write the Blob directly
                    await writable.write(tarBlob);
                    await writable.close();
                    console.log('Tilesheets saved to file:', handle.name);
                    return;
                }
            } catch (fsErr) {
                // If File System Access fails for any reason, continue to fallback
                console.warn('File System Access API save failed, falling back to download:', fsErr);
            }

            // Fallback: prompt user for a filename (so they can change it) then download via anchor
            try {
                // Prompt for filename; if the user cancels (null), abort instead of downloading
                let userFileName = filename;
                if (typeof window.prompt === 'function') {
                    const res = window.prompt('Enter filename to save', filename);
                    if (res === null) {
                        console.log('User cancelled filename prompt. Export aborted.');
                        return;
                    }
                    userFileName = (res && res.trim()) ? res.trim() : filename;
                }
                const url = URL.createObjectURL(tarBlob);
                const a = document.createElement('a');
                a.href = url;
                a.download = userFileName;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
                console.log('Tilesheets exported to tar file (download):', userFileName);
            } catch (dlErr) {
                console.warn('Fallback download failed:', dlErr);
            }
        } catch (e) {
            console.warn('Export tilesheets tar failed:', e);
        }
    }

    // Prompt user to pick a JSON file and import tilesheets
    loadTileSheetsFromFile(){
        return new Promise((resolve) => {
            try {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json,application/json';
                input.style.display = 'none';
                input.onchange = async (e) => {
                    const file = e.target.files && e.target.files[0];
                    if (!file) { resolve(false); return; }
                    const reader = new FileReader();
                    reader.onload = async (ev) => {
                        try {
                            const payload = JSON.parse(ev.target.result);
                            const ok = await this.loadTileSheetsFromPayload(payload);
                            resolve(ok);
                        } catch (err) {
                            console.warn('Failed to parse tilesheet file:', err);
                            resolve(false);
                        }
                    };
                    reader.onerror = (err) => { console.warn('File read error', err); resolve(false); };
                    reader.readAsText(file);
                };
                document.body.appendChild(input);
                input.click();
                setTimeout(() => { try { input.remove(); } catch (e){} }, 3000);
            } catch (e) { console.warn('Load file failed:', e); resolve(false); }
        });
    }

    // Prompt user to pick image files (PNG/JPG) or a JSON payload and import accordingly
    promptImportFiles(){
        return new Promise((resolve) => {
            try {
                const input = document.createElement('input');
                input.type = 'file';
                // allow JSON, images, and tar archives
                input.accept = '.json,application/json,image/*,.tar,application/x-tar,application/tar';
                input.multiple = true;
                input.style.display = 'none';
                input.onchange = async (e) => {
                    const files = Array.from(e.target.files || []);
                    if (!files.length) { resolve(false); return; }

                    // Separate images vs json vs tar
                    const imageFiles = files.filter(f => f.type && f.type.startsWith('image'));
                    const jsonFiles = files.filter(f => f.type && (f.type === 'application/json' || f.name.toLowerCase().endsWith('.json')));
                    const tarFiles = files.filter(f => f.name.toLowerCase().endsWith('.tar') || f.type === 'application/x-tar');

                    let anyOk = false;

                    // Handle image files: create tilesheets
                    for (const f of imageFiles) {
                        try {
                            const dataUrl = await new Promise((res, rej) => {
                                const r = new FileReader();
                                r.onload = () => res(r.result);
                                r.onerror = () => rej(new Error('readFailed'));
                                r.readAsDataURL(f);
                            });
                            const img = new Image();
                            const p = new Promise((res, rej) => { img.onload = () => res(true); img.onerror = () => res(false); });
                            img.src = dataUrl;
                            await p;
                            // ask for slice size (try to infer default from filename or use 16)
                            let defaultSlice = 16;
                            try {
                                // try to infer: if name contains numbers like 32,64
                                const m = f.name.match(/(\d{2,3})/);
                                if (m) defaultSlice = parseInt(m[1], 10);
                            } catch (e) {}
                            const sliceStr = window.prompt(`Enter tile slice size (px) for ${f.name}:`, String(defaultSlice));
                            const slicePx = Math.max(1, Number(sliceStr) || defaultSlice);
                            const id = f.name.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, '_');
                            const ts = new TileSheet(img, slicePx);
                            // auto-add tile entries by grid positions as numeric keys
                            try {
                                const cols = Math.max(1, Math.floor(img.width / slicePx));
                                const rows = Math.max(1, Math.floor(img.height / slicePx));
                                for (let r = 0; r < rows; r++) {
                                    for (let c = 0; c < cols; c++) {
                                        // name them by r_c for convenience
                                        ts.addTile(`${r}_${c}`, r, c);
                                    }
                                }
                            } catch (e) { /* ignore */ }
                            this._tilemap.registerTileSheet(id, ts);
                            anyOk = true;
                        } catch (e) {
                            console.warn('Failed to import image file as tilesheet', f.name, e);
                        }
                    }

                    // Handle JSON files: attempt to parse and apply payloads
                    for (const f of jsonFiles) {
                        try {
                            const text = await new Promise((res, rej) => {
                                const r = new FileReader();
                                r.onload = () => res(r.result);
                                r.onerror = () => rej(new Error('readFailed'));
                                r.readAsText(f);
                            });
                            const payload = JSON.parse(text);
                            const ok = await this.loadTileSheetsFromPayload(payload);
                            anyOk = anyOk || ok;
                        } catch (e) {
                            console.warn('Failed to import JSON tilesheet file', f.name, e);
                        }
                    }

                    // Handle tar files: parse tar and extract tilesheets.json + images
                    for (const f of tarFiles) {
                        try {
                            const arrayBuf = await new Promise((res, rej) => {
                                const r = new FileReader();
                                r.onload = () => res(r.result);
                                r.onerror = () => rej(new Error('readFailed'));
                                r.readAsArrayBuffer(f);
                            });
                            const parsed = await this.loadTileSheetsFromTarBuffer(arrayBuf);
                            if (parsed && parsed.sheetsPayload) {
                                const ok = await this.loadTileSheetsFromPayload(parsed.sheetsPayload);
                                anyOk = anyOk || ok;
                                // if there is a map payload, apply it after sheets are registered
                                if (parsed.mapPayload) {
                                    const mapOk = this.loadMapFromPayload(parsed.mapPayload);
                                    anyOk = anyOk || mapOk;
                                }
                            }
                        } catch (e) {
                            console.warn('Failed to import tar tilesheet file', f.name, e);
                        }
                    }

                    // refresh palette entries now that new sheets may be registered
                    this.tileTypes = [];
                    for (const [id, ts] of this._tilemap.tileSheets.entries()) {
                        try {
                            const img = ts.sheet;
                            const cols = Math.max(1, Math.floor(img.width / ts.slicePx));
                            const rows = Math.max(1, Math.floor(img.height / ts.slicePx));
                            for (let r = 0; r < rows; r++) {
                                for (let c = 0; c < cols; c++) {
                                    this.tileTypes.push({ sheetId: id, row: r, col: c });
                                }
                            }
                        } catch (e) { /* ignore */ }
                    }

                    try { if (input && input.parentNode) document.body.removeChild(input); } catch (e) { /* ignore if already removed */ }
                    resolve(anyOk);
                };
                document.body.appendChild(input);
                input.click();
                setTimeout(() => { try { input.remove(); } catch (e){} }, 3000);
            } catch (e) { console.warn('Import files failed:', e); resolve(false); }
        });
    }

    // Parse a tar archive ArrayBuffer and return payload object similar to exported tilesheets.json
    async loadTileSheetsFromTarBuffer(arrayBuffer){
        try {
            const u = new Uint8Array(arrayBuffer);
            const entries = {};
            let offset = 0;
            while (offset + 512 <= u.length) {
                // read header
                const nameBytes = u.subarray(offset, offset+100);
                const name = new TextDecoder().decode(nameBytes).replace(/\0.*$/,'');
                if (!name) break;
                const sizeBytes = u.subarray(offset+124, offset+136);
                const sizeStr = new TextDecoder().decode(sizeBytes).replace(/\0.*$/,'').trim();
                const size = sizeStr ? parseInt(sizeStr, 8) : 0;
                offset += 512;
                const data = u.subarray(offset, offset + size);
                entries[name] = data.slice();
                const skip = (512 - (size % 512)) % 512;
                offset += size + skip;
            }

            // find tilesheets.json (allow for path prefixes)
            const keys = Object.keys(entries);
            const tsKey = keys.find(k => k.toLowerCase().endsWith('tilesheets.json'));
            if (!tsKey) {
                console.warn('Tar archive missing tilesheets.json');
                return null;
            }
            const jsonText = new TextDecoder().decode(entries[tsKey]);
            const payload = JSON.parse(jsonText);
            // convert image entries to object URLs and set imageFile -> imageData
            for (const s of payload.sheets) {
                if (s.imageFile) {
                    const imgKey = keys.find(k => k.toLowerCase().endsWith(s.imageFile.toLowerCase()));
                    if (imgKey && entries[imgKey]) {
                        const arr = entries[imgKey];
                        const blob = new Blob([arr], { type: 'image/png' });
                        const url = URL.createObjectURL(blob);
                        s.imageData = url;
                    }
                }
            }

            // also look for map.json (allow path prefixes)
            const mapKey = keys.find(k => k.toLowerCase().endsWith('map.json'));
            let mapPayload = null;
            if (mapKey && entries[mapKey]) {
                try {
                    const mapText = new TextDecoder().decode(entries[mapKey]);
                    mapPayload = JSON.parse(mapText);
                } catch (e) { console.warn('Failed to parse map.json from tar', e); }
            }

            return { sheetsPayload: payload, mapPayload };
        } catch (e) {
            console.warn('Failed to parse tar buffer', e);
            return null;
        }
    }

    // Apply payload containing tilesheets: { sheets: [{id, slicePx, tiles, imageData}] }
    async loadTileSheetsFromPayload(payload){
        try {
            if (!payload || !Array.isArray(payload.sheets)) return false;
            for (const s of payload.sheets) {
                try {
                    const img = new Image();
                    // ensure we wait for load
                    const p = new Promise((res, rej) => { img.onload = () => res(true); img.onerror = () => res(false); });
                    img.src = s.imageData || s.url || '';
                    await p;
                    const ts = new TileSheet(img, s.slicePx || 16);
                    // restore tiles
                    if (s.tiles) {
                        if (Array.isArray(s.tiles)) {
                            for (const [k, v] of s.tiles) ts.addTile(k, v.row, v.col);
                        } else {
                            for (const k of Object.keys(s.tiles)) {
                                const v = s.tiles[k];
                                if (v && typeof v.row !== 'undefined') ts.addTile(k, v.row, v.col);
                            }
                        }
                    }
                    // register under given id (or generate if missing)
                    const id = s.id || ('sheet_' + Math.random().toString(36).slice(2,9));
                    this._tilemap.registerTileSheet(id, ts);
                } catch (e) {
                    console.warn('Failed to apply tilesheet', s && s.id, e);
                }
            }
            // refresh palette types so UI includes newly loaded sheets
            this.tileTypes = [];
            // populate tileTypes now from all registered sheets
            for (const [id, ts] of this._tilemap.tileSheets.entries()) {
                try {
                    const img = ts.sheet;
                    const cols = Math.max(1, Math.floor(img.width / ts.slicePx));
                    const rows = Math.max(1, Math.floor(img.height / ts.slicePx));
                    for (let r = 0; r < rows; r++) {
                        for (let c = 0; c < cols; c++) {
                            this.tileTypes.push({ sheetId: id, row: r, col: c });
                        }
                    }
                } catch (e) { /* ignore */ }
            }
            console.log('Tilesheets loaded from payload');
            return true;
        } catch (e) {
            console.warn('Applying tilesheet payload failed:', e);
            return false;
        }
    }

    // Prompt user to pick a JSON file and import it as a map
    loadMapFromFile(){
        return new Promise((resolve) => {
            try {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json,application/json';
                input.style.display = 'none';
                input.onchange = (e) => {
                    const file = e.target.files && e.target.files[0];
                    if (!file) { resolve(false); return; }
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        try {
                            const payload = JSON.parse(ev.target.result);
                            const ok = this.loadMapFromPayload(payload);
                            resolve(ok);
                        } catch (err) {
                            console.warn('Failed to parse map file:', err);
                            resolve(false);
                        }
                    };
                    reader.onerror = (err) => { console.warn('File read error', err); resolve(false); };
                    reader.readAsText(file);
                };
                document.body.appendChild(input);
                input.click();
                // cleanup after short delay when picker closed
                setTimeout(() => { try { input.remove(); } catch (e){} }, 3000);
            } catch (e) { console.warn('Load file failed:', e); resolve(false); }
        });
    }

    /**
     * Set up player ID
     */
    enableTwoPlayer(id) {
        this.playerId = id;
        const isP1 = this.playerId === 'p1';
        this.twoPlayer = true;
    }

    updateRightBounds(tickDelta){
        let pointerOverUI = false;
        // If camera is locked, don't treat the right-side palette as UI (hide it and allow placement)
        if (!(this.camera && this.camera.locked) && this.mouse.pos.x > 1920-48*5) {
            try {
                const uiCtx = this.UIDraw.getCtx('UI');
                if (uiCtx) {
                    const uiW = uiCtx.canvas.width / this.UIDraw.Scale.x;
                    const uiH = uiCtx.canvas.height / this.UIDraw.Scale.y;
                    const m = this.uiMenu;
                    const menuX = uiW - m.menuWidth - m.margin;
                    const menuY = m.margin;
                    const menuH = uiH - m.margin * 2;
                    const mp = this.mouse.pos;

                    // ensure tileTypes is populated from the tilesheet (do once)
                    if (this.tileTypes.length === 0) {
                        try {
                            // populate from all registered sheets
                            for (const [id, ts] of this._tilemap.tileSheets.entries()) {
                                const img = ts && ts.sheet;
                                if (ts && img && img.width && ts.slicePx) {
                                    const cols = Math.max(1, Math.floor(img.width / ts.slicePx));
                                    const rows = Math.max(1, Math.floor(img.height / ts.slicePx));
                                    for (let r = 0; r < rows; r++) {
                                        for (let c = 0; c < cols; c++) {
                                            this.tileTypes.push({ sheetId: id, row: r, col: c });
                                        }
                                    }
                                }
                            }
                        } catch (e) { /* ignore */ }
                    }

                    // compute grid columns
                    const cols = Math.max(1, Math.floor((m.menuWidth - 16 + m.spacing) / (m.itemSize + m.spacing)));
                    const totalH = Math.ceil(this.tileTypes.length / cols) * (m.itemSize + m.spacing) - m.spacing;
                    const menuBoxH = Math.min(menuH, totalH + 16);

                    // Consider full vertical menu area for buttons below the grid as well
                    if (mp.x >= menuX && mp.x <= menuX + m.menuWidth && mp.y >= menuY && mp.y <= menuY + menuH) {
                        pointerOverUI = true;
                        // compute grid columns and full used rows
                        const cols = Math.max(1, Math.floor((m.menuWidth - 16 + m.spacing) / (m.itemSize + m.spacing)));
                        const rowsUsed = Math.ceil(this.tileTypes.length / cols);
                        const gridH = rowsUsed * (m.itemSize + m.spacing) - m.spacing;

                        // positions for buttons below the grid
                        const btnX = menuX + 8;
                        const btnW = m.menuWidth - 16;
                        const btnH = 28;
                        const btnYStart = menuY + 8 + gridH + m.spacing;

                        if (this.mouse.pressed('left') && !this._uiHandled) {
                            // if click within grid
                            if (mp.y >= menuY + 8 && mp.y <= menuY + 8 + gridH) {
                                const relX = mp.x - (menuX + 8);
                                const relY = mp.y - (menuY + 8);
                                const col = Math.floor(relX / (m.itemSize + m.spacing));
                                const row = Math.floor(relY / (m.itemSize + m.spacing));
                                const idx = row * cols + col;
                                if (idx >= 0 && idx < this.tileTypes.length) {
                                    const t = this.tileTypes[idx];
                                    // store tile key and current sheet for placement
                                    this.drawType = [t.row, t.col];
                                    this.drawSheet = t.sheetId;
                                    this._uiHandled = true;
                                }
                            }
                        }
                    }
                }
            } catch (e) { /* ignore UI hit test errors */ }
        }

        // If edit mode is open, treat the left-side edit menu area as UI so clicks there
        // don't paint the map. This ensures the left panel blocks placement while open.
        if (this.editmode) {
            const leftW = this.editMenuWidth || 300;
            if (this.mouse.pos.x <= leftW) pointerOverUI = true;
        }
        return pointerOverUI;
    }
    handleKeys(){
        // Toggle edit mode with e
        let toggleEdit = ()=>{
            if (!(this.keys.held('e') && this.selectedTile)) return; 
            if (!this.selectedTile.info) { this.createNewTile(); return; } 
            if (!this.editmode) {
                this.editmode = true;
                this.prepareEditTile();
                try { this._startEditZoom(); } catch (e) { /* ignore */ }
                return;
            }
            
        }
        toggleEdit()

        // Undo shortcut: Ctrl+Z (support holding Control and pressing z)
        try {
            if (this.keys) {
                if ((this.keys.held('Control') || this.keys.held('ControlLeft') || this.keys.held('ControlRight')) && this.keys.held('z') && this.undoTimer<0) {
                    try { this.undo(); } catch (e) { console.warn('undo failed', e); }
                    this.undoTimer = 0.2
                }
            }
        } catch (e) {}

        // Tool activation keys: l=line, b=box, o=circle
        try {
            if (this.keys.pressed('l')) {
                // start line tool: require selectedTile or use cursor
                const start = this.selectedTile && typeof this.selectedTile.x === 'number' ? { x: this.selectedTile.x, y: this.selectedTile.y } : this.cursor;
                if (start) {
                    this.toolMode = 'line'; this.toolActive = true; this.toolStart = { x: Math.floor(start.x), y: Math.floor(start.y) };
                    this.tempTiles = [];
                }
            }
            if (this.keys.pressed('b')) {
                const start = this.selectedTile && typeof this.selectedTile.x === 'number' ? { x: this.selectedTile.x, y: this.selectedTile.y } : this.cursor;
                if (start) {
                    this.toolMode = 'box'; this.toolActive = true; this.toolStart = { x: Math.floor(start.x), y: Math.floor(start.y) };
                    this.tempTiles = [];
                }
            }
            if (this.keys.pressed('o')) {
                const start = this.selectedTile && typeof this.selectedTile.x === 'number' ? { x: this.selectedTile.x, y: this.selectedTile.y } : this.cursor;
                if (start) {
                    this.toolMode = 'circle'; this.toolActive = true; this.toolStart = { x: Math.floor(start.x), y: Math.floor(start.y) };
                    this.tempTiles = [];
                }
            }
        } catch (e) {}
        // close edit mode with Escape
        if (this.keys.pressed('Escape') && this.editmode) this.exitEditMode();
        
        // rotation/invert controls
        if(this.rotDelay > -0.1) return;
        if(this.keys.held('f')){
            this.drawInvert *= -1
            this.rotDelay = this.rotSetDelay
        }
        if(this.keys.held('r')){
            this.drawRot = (this.drawRot+1)%4
            this.rotDelay = this.rotSetDelay
        }
    }
    zoomWorld(tickDelta){
        // Zoom controls: '-' to zoom out, '=' to zoom in (single press)
        const prevZoom = this.zoom;
        const drawCtx = this.Draw.ctx;
        const uiW = drawCtx ? drawCtx.canvas.width / this.Draw.Scale.x : 0;
        const uiH = drawCtx ? drawCtx.canvas.height / this.Draw.Scale.y : 0;
        const center = new Vector(uiW / 2, uiH / 2);
        const prevOrigin = this.zoomOrigin ? this.zoomOrigin : center;

        // helper to compute world point under screen position S using previous transform
        // invert: S = prevZoom * W + (1 - prevZoom) * prevOrigin
        // => W = (S + (prevZoom - 1) * prevOrigin) / prevZoom
        const worldUnderScreen = (S) => {
            return S.add(prevOrigin.mult(prevZoom - 1)).div(prevZoom);
        };

        // helper to compute new levelOffset so world W maps to screen S under newZoom and newOrigin
        // derive: newLevelOffset = (S + (newZoom - 1)*newOrigin)/newZoom - W + oldLevelOffset
        const computeLevelFor = (W, S, newZoom, newOrigin) => {
            return S.add(newOrigin.mult(newZoom - 1)).div(newZoom).sub(W).add(this.levelOffset);
        };

        // Keyboard zoom (- / =)
        if (this.keys.pressed('-') || this.keys.pressed('=')) {
            const step = this.keys.pressed('=') ? this.zoomStep : -this.zoomStep;
            const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom + step));
            const S = this.mouse.pos.clone();
            const W = worldUnderScreen(S);
            const newOrigin = S; // zoom toward mouse
            this.zoom = newZoom;
            this.levelOffset = computeLevelFor(W, S, this.zoom, newOrigin);
            this.zoomOrigin = newOrigin;
        }

        // ctrl+wheel zoom
        const wheelDelta = this.mouse.wheel(null, false, true);
        if (wheelDelta !== 0) {
            const factor = Math.exp(-wheelDelta * 0.001);
            const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
            const S = this.mouse.pos.clone();
            const W = worldUnderScreen(S);
            const newOrigin = S;
            this.zoom = newZoom;
            this.levelOffset = computeLevelFor(W, S, this.zoom, newOrigin);
            this.zoomOrigin = newOrigin;
        }

    }
    panWorld(tickDelta){
        if(this.mouse.pos.x>1700) return;
        if (!this.mouse.held('left')&& !this.keys.held('Control')) {
            const dx = this.mouse.wheelX(null, false, false) || 0;
            const dy = this.mouse.wheel(null, false, false) || 0;
            if (dx !== 0 || dy !== 0) {
                const pan = new Vector(-dx, -dy).div(this.zoom || 1);
                // apply as velocity impulse for smooth panning
                this.panVelocity = this.panVelocity.add(pan.mult(this.panImpulse || 20));
                // reset rotDelay so accidental tiny scrolls don't trigger rotation elsewhere
                this.rotDelay = this.rotSetDelay;
            }
        }

        if(this.startOffset !== null){
            // mouse.getGrabDelta is in screen space; convert to world-space by dividing by zoom
            const desiredOffset = this.startOffset.add(this.mouse.getGrabDelta().div(this.zoom));
            const desiredDelta = desiredOffset.sub(this.levelOffset);
            // set velocity toward desired offset so panning is smooth and follows the pointer
            this.panVelocity = this.panVelocity.add(desiredDelta.mult(10));
        }


        if (!this.panVelocity) return;
        // apply velocity (units: pixels per second), scaled by tickDelta
        this.levelOffset = this.levelOffset.add(this.panVelocity.mult(tickDelta));
        // exponential damping
        const damp = Math.exp(-(this.panDamping || 8) * tickDelta);
        this.panVelocity = this.panVelocity.mult(damp);
        // tiny cutoff
        if (Math.abs(this.panVelocity.x) < 0.01 && Math.abs(this.panVelocity.y) < 0.01) {
            this.panVelocity = new Vector(0,0);
        }
        
    }
    getCursor(pos){
        // If a custom screen position is provided, use it; otherwise use the mouse position.
        const screenPos = pos ? pos.clone() : this.mouse.pos.clone();
        const ctx = this.Draw.ctx;
        const uiW = ctx.canvas.width / this.Draw.Scale.x;
        const uiH = ctx.canvas.height / this.Draw.Scale.y;
        const center = new Vector(uiW / 2, uiH / 2);
        const origin = this.zoomOrigin ? this.zoomOrigin : center;
        // convert screen pos to world pos by undoing the translate/scale/translate applied in draw()
        const worldPos = screenPos.sub(origin).div(this.zoom).add(origin);
        // cursor index = floor((worldPos - levelOffset) / tileSize)
        const cursor = worldPos.sub(this.levelOffset).div(this.tileSize).floorS();
        // if caller asked for default (no pos) update this.cursor as before
        if (!pos) this.cursor = cursor;
        return cursor;
    }

    eyedropper(draw){
        
            const ctx = draw.getCtx(this.drawLayer);
            if (!ctx || !ctx.canvas) return null;

            // fix draw.scale
            const scaleX = (draw && draw.Scale && typeof draw.Scale.x === 'number') ? draw.Scale.x : 1;
            const scaleY = (draw && draw.Scale && typeof draw.Scale.y === 'number') ? draw.Scale.y : scaleX;

            const cx = Math.floor(this.mouse.pos.x * scaleX);
            const cy = Math.floor(this.mouse.pos.y * scaleY);

            // clamp to canvas bounds
            const cw = ctx.canvas.width;
            const ch = ctx.canvas.height;
            if (cx < 0 || cy < 0 || cx >= cw || cy >= ch) return null;

            // getImageData returns an ImageData object with .data array
            let imgData;
            try {
                imgData = ctx.getImageData(cx, cy, 1, 1);
            } catch (e) {
                console.warn('Eyedropper getImageData failed:', e);
                return null;
            }
            const d = imgData && imgData.data;
            if (!d || d.length < 4) return null;

            const choice = new Color(d[0], d[1], d[2], d[3], 'rgb').toHex();
            return choice;

    }
    
    /**
     * Scene-specific tick handler. Called from base Scene.tick().
     */
    handleEdit(tickDelta, pointerOverUI){
        if(pointerOverUI) return;
        if(!this.editmode) return;
        // Eyedropper tool
        if(this.keys.held('Control')){
            this.editColor = this.eyedropper(this.Draw)
            return;
        }
       
        // Ensure data exists & we're drawing.
        if(!this.selectedTile) return;
        if(!this.mouse.held('left') && !this.mouse.held('right')) return;
        
        // Ensire sheet info exists
        const sel = this.selectedTile;
        const info = sel.info;
        if (!info) return;
        if (!info.sheet) return;
        const drawCtx = this.Draw.ctx;
        if(!drawCtx) return;
            
        const ts = info.sheet;
        const slice = ts.slicePx || 16;

        // Determine row/col in tilesheet
        let row = 0, col = 0;
        const tk = info.tileKey;
        if (Array.isArray(tk)) { row = tk[0]; col = tk[1]; }
        else if (typeof tk === 'string' && typeof ts.getTile === 'function') {
            const meta = ts.getTile(tk);
            if (meta) { row = meta.row; col = meta.col; }
        }

        // Compute pixel coords
        let origin = new Vector(0,0);
        const uiW = drawCtx.canvas.width / this.Draw.Scale.x;
        const uiH = drawCtx.canvas.height / this.Draw.Scale.y;
        const center = new Vector(uiW/2, uiH/2);
        origin = this.zoomOrigin ? this.zoomOrigin : center;
        
        const worldPos = this.mouse.pos.sub(origin).div(this.zoom).add(origin);
        const local = worldPos.sub(this.levelOffset);
        const withinTileX = local.x - (sel.x * this.tileSize);
        const withinTileY = local.y - (sel.y * this.tileSize);
        const px = Math.floor((withinTileX / this.tileSize) * slice);
        const py = Math.floor((withinTileY / this.tileSize) * slice);

        if (px >= 0 && py >= 0 && px < slice && py < slice) {
            // ensure master tilesheet is a canvas we can write to
            if (!(ts.sheet instanceof HTMLCanvasElement)) {
                const orig = ts.sheet;
                const cv = document.createElement('canvas');
                cv.width = orig.width || (col + 1) * slice;
                cv.height = orig.height || (row + 1) * slice;
                const ctx = cv.getContext('2d');
                try { ctx.drawImage(orig, 0, 0); } catch (e) {}
                ts.sheet = cv;
            }
            const ctx = ts.sheet.getContext('2d');
            const im = ctx.getImageData(col * slice, row * slice, slice, slice);
            // brush: apply a square of pixels of size this.editBrushSize centered on (px,py)
            const bsize = Math.max(1, Math.floor(this.editBrushSize || 1));
            const half = Math.floor(bsize / 2);
            const startX = Math.max(0, px - half);
            const startY = Math.max(0, py - half);
            const endX = Math.min(slice - 1, startX + bsize - 1);
            const endY = Math.min(slice - 1, startY + bsize - 1);
            const doErase = this.mouse.held('right');
            const colc = doErase ? null : Color.convertColor(this.editColor || '#FFFFFFFF').toRgb();
            // account for tile rotation/invert so clicking on a rotated/flipped tile
            // correctly maps display pixel coords to the tilesheet source pixels
            const rot = (info.rotation !== undefined) ? (Number(info.rotation) || 0) : 0;
            const invX = (info.invert !== undefined) ? (Number(info.invert) || 1) : 1;
            const invY = 1; // we only support horizontal invert currently (legacy)
            const rnorm = ((rot % 4) + 4) % 4;
            for (let yy = startY; yy <= endY; yy++) {
                for (let xx = startX; xx <= endX; xx++) {
                    // display-space normalized coords (0..1) for the pixel center
                    const u_disp = (xx + 0.5) / slice;
                    const v_disp = (yy + 0.5) / slice;
                    // center-origin coords (-0.5 .. 0.5)
                    let cx = u_disp - 0.5;
                    let cy = v_disp - 0.5;
                    // inverse of invert (scale) applied during draw
                    if (invX < 0) cx = -cx;
                    if (invY < 0) cy = -cy;
                    // inverse rotate by -rot*90deg
                    let sxn = 0, syn = 0;
                    switch (rnorm) {
                        case 0: sxn = cx; syn = cy; break;
                        case 1: sxn = cy; syn = -cx; break;
                        case 2: sxn = -cx; syn = -cy; break;
                        case 3: sxn = -cy; syn = cx; break;
                    }
                    // convert back to 0..1 normalized source coords
                    const u_src = Math.min(1, Math.max(0, sxn + 0.5));
                    const v_src = Math.min(1, Math.max(0, syn + 0.5));
                    const srcX = Math.min(slice - 1, Math.max(0, Math.floor(u_src * slice)));
                    const srcY = Math.min(slice - 1, Math.max(0, Math.floor(v_src * slice)));
                    const idx = (srcY * slice + srcX) * 4;
                    if (doErase) {
                        im.data[idx+0] = 0; im.data[idx+1] = 0; im.data[idx+2] = 0; im.data[idx+3] = 0;
                    } else {
                        im.data[idx+0] = Math.round(colc.a || 0);
                        im.data[idx+1] = Math.round(colc.b || 0);
                        im.data[idx+2] = Math.round(colc.c || 0);
                        im.data[idx+3] = Math.round((colc.d || 1) * 255);
                    }
                }
            }
            try { ctx.putImageData(im, col * slice, row * slice); } catch (e) { console.warn('putImageData failed in handleEdit', e); }
            // update the edit canvas view if present
            try {
                if (this.editTileCanvas) {
                    const edctx = this.editTileCanvas.getContext('2d');
                    edctx.clearRect(0,0,this.editTileCanvas.width,this.editTileCanvas.height);
                    edctx.drawImage(ts.sheet, col * slice, row * slice, slice, slice, 0, 0, slice, slice);
                }
            } catch (e) {}
        }
        return true;

    }
    handleLeft(tickDelta,pointerOverUI){
        if(this.handleEdit(tickDelta,pointerOverUI)){
            return;
        }
        

        if(this.mouse.held('right') && !this.editmode){
            // right-click: if a tool is active, cancel it; otherwise remove tile
            if (this.toolActive) {
                this.toolActive = false; this.toolMode = null; this.toolStart = null; this.clearTempTiles();
            } else {
                // record previous tile so we can undo deletion (operate on active layer)
                try {
                    const layer = this.drawLayer || 'base';
                    const prev = this._tilemap.getTile(this.cursor.x, this.cursor.y, layer) || null;
                    if (prev) {
                        this._tilemap.removeTile(this.cursor.x, this.cursor.y, layer);
                        const prevWithLayer = Object.assign({}, prev, { layer });
                        this._pushUndo([{ x: this.cursor.x, y: this.cursor.y, prev: prevWithLayer, next: null }]);
                    }
                } catch (e) {
                    try { this._tilemap.removeTile(this.cursor.x,this.cursor.y, this.drawLayer || 'base') } catch (ex) {}
                }
            }
        }

        if(!this.mouse.held('left')) return;
        if(pointerOverUI) return;
        


        // Select tiles
        if (this.keys.held('Shift')) {
            const info = this._tilemap.getTileRenderInfo(this.cursor.x, this.cursor.y, this.drawLayer || 'base');
            if (info)  this.selectedTile = { x: this.cursor.x, y: this.cursor.y, info };
            else  this.selectedTile = { x: this.cursor.x, y: this.cursor.y, info: null};
            return;
        }

        // Copy tiles
        if (this.keys.held('Control')){
            const info = this._tilemap.getTileRenderInfo(this.cursor.x, this.cursor.y, this.drawLayer || 'base');
            if (info) {
                this.drawType = info.tileKey;
                this.drawSheet = info.tilesheetId || info.tilesheet || this.drawSheet;
                this.drawRot = info.rotation ?? 0;
                this.drawInvert = info.invert ?? this.drawInvert;
                return;
            }
        }
        
        // Paint tiles
        // If a tool is active and user clicked left, apply tool at click
        if (this.toolActive && this.mouse.pressed('left')) {
            // apply tempTiles (they are already previewed) to tilemap
            const applied = this.applyTempTiles();
            this.toolActive = false; this.toolMode = null; this.toolStart = null;
            this._uiHandled = true;
            return;
        }
        if(this.mouse.pos.y < 100) return;
        const sheetId = this.drawSheet || 'house';
        // push undo for single-tile placement
        try {
            const layer = this.drawLayer || 'base';
            const prev = this._tilemap.getTile(this.cursor.x, this.cursor.y, layer) || null;
            const prevWithLayer = prev ? Object.assign({}, prev, { layer }) : null;
            const next = { tilesheetId: sheetId, tileKey: this.drawType, rotation: this.drawRot, invert: this.drawInvert, layer };
            this._tilemap.setTile(this.cursor.x, this.cursor.y, sheetId, this.drawType, this.drawRot, this.drawInvert, layer);
            this._pushUndo([{ x: this.cursor.x, y: this.cursor.y, prev: prevWithLayer, next: next }]);
        } catch (e) { console.warn('set tile failed', e); }
    }
    sceneTick(tickDelta){
        this.zoomWorld(tickDelta)
        this.panWorld(tickDelta)
        this.getCursor()
        this.undoTimer-=tickDelta;
        // Animate edit-mode zoom when requested (_startEditZoom sets the targets)
        try {
            if (this._editZooming) {
                this._editZoomTime = (this._editZoomTime || 0) + tickDelta;
                const dur = this._editZoomDuration || 0.45;
                const t = Math.min(1, this._editZoomTime / dur);
                // easeOutCubic
                const ease = 1 - Math.pow(1 - t, 3);
                // interpolate zoom
                this.zoom = (this._editZoomFrom || this.zoom) + ((this._editZoomTo || this.zoom) - (this._editZoomFrom || this.zoom)) * ease;
                // interpolate levelOffset
                if (this._editZoomFromOffset && this._editZoomToOffset) {
                    const from = this._editZoomFromOffset;
                    const to = this._editZoomToOffset;
                    try {
                        this.levelOffset = from.add(to.sub(from).mult(ease));
                    } catch (e) {
                        // fallback: lerp components
                        const lx = from.x + (to.x - from.x) * ease;
                        const ly = from.y + (to.y - from.y) * ease;
                        this.levelOffset = new Vector(lx, ly);
                    }
                }
                if (t >= 1) {
                    this._editZooming = false;
                }
            }
        } catch (e) { console.warn('edit zoom animation failed', e); }
        if(this.keys.held('c')){
            this.testSprite.pos.x = this.cursor.x*this.tileSize - this.testSprite.size.x/2.7 
            this.testSprite.pos.y = this.cursor.y*this.tileSize-this.testSprite.size.y/1.9
            this.testSprite.vlos.mult(0)
            this.camera.locked = false;
        }

        this.testSprite.update(tickDelta);
        // Camera lock/follow: when arrow keys are pressed, lock camera onto the cat (testSprite)
        // uses smooth damp and a horizontal bias so the direction you're moving in has more visual space
        try {
            if (!this.camera) this.camera = { locked: false, smooth: 8, bias: 0.25, lastMousePos: this.mouse ? this.mouse.pos.clone() : new Vector(0,0), unlockDistance: 4 };
            const left = this.keys.held('ArrowLeft') || this.keys.held('Left');
            const right = this.keys.held('ArrowRight') || this.keys.held('Right');
            const up = this.keys.held('ArrowUp') || this.keys.held('Up');
            const down = this.keys.held('ArrowDown') || this.keys.held('Down');
            const arrowPressed = left || right || up || down;
            // engage lock when any arrow pressed
            if (arrowPressed) this.camera.locked = true;

            // detect mouse movement to unlock camera
            if (this.camera.locked && this.mouse && this.mouse.pos) {
                const md = this.mouse.pos.sub(this.camera.lastMousePos || this.mouse.pos);
                if (Math.abs(md.x) > (this.camera.unlockDistance || 4) || Math.abs(md.y) > (this.camera.unlockDistance || 4)) {
                    this.camera.locked = false;
                }
                // update last mouse pos
                this.camera.lastMousePos = this.mouse.pos.clone();
            } else if (this.mouse && this.mouse.pos) {
                this.camera.lastMousePos = this.mouse.pos.clone();
            }

            // if locked, compute desired levelOffset so the testSprite appears offset from center
            if (this.camera.locked && this.testSprite && this.testSprite.pos) {
                this.zoom = 1
                const drawCtx = this.UIDraw.ctx;
                if (drawCtx && drawCtx.canvas) {
                    const uiW = drawCtx.canvas.width / this.UIDraw.Scale.x;
                    const uiH = drawCtx.canvas.height / this.UIDraw.Scale.y;
                    const center = new Vector(uiW / 2, uiH / 2);
                    const origin = this.zoomOrigin ? this.zoomOrigin : center;

                    // horizontal bias: position player slightly opposite movement so there's more view ahead
                    // Use sprite horizontal velocity to scale the bias. Faster movement -> more look-ahead.
                    let vx = 0;
                    let vy = 0;
                    if (this.testSprite && this.testSprite.vlos) {
                        vx = this.testSprite.vlos.x;
                        vy = this.testSprite.vlos.y;
                    }
                    // normalize by expected max speed (use sprite.speed if available or 100)
                    const maxSpeed = 300;
                    const norm = Math.max(-1, Math.min(1, vx / maxSpeed));
                    const biasPixels = (this.camera.bias || 0.25) * uiW * norm * 30;

                    const normY = Math.max(-1, Math.min(1, vy / maxSpeed));
                    const biasPixelsY = (this.camera.bias || 0.25) * uiH * normY * 30-150;
                    // when moving right (positive vx), Sx < center so player appears left-of-center => look-ahead to right
                    // compute Sx so the sprite's CENTER is offset by biasPixels from screen center
                    // sprite.pos is top-left, so subtract half the sprite width to convert center -> top-left
                    const Sx = center.x - biasPixels - (this.testSprite.size.x / 2);
                    const Sy = center.y - biasPixelsY - (this.testSprite.size.y); // keep vertical centered for now
                    const Sdes = new Vector(Sx, Sy);

                    // desiredLevelOffset such that (testSprite.pos + levelOffset) maps to screen Sdes
                    // formula: S = zoom * W + (1 - zoom) * origin  =>  W = (S + (zoom - 1) * origin) / zoom
                    // we want W = testSprite.pos + levelOffset  => levelOffset = W - testSprite.pos
                    const W = Sdes.add(origin.mult(this.zoom - 1)).div(this.zoom);
                    const desiredLevel = W.sub(this.testSprite.pos);

                    // smooth damp toward desiredLevel
                    const smooth = this.camera.smooth || 8;
                    const t = 1 - Math.exp(-smooth * tickDelta);
                    this.levelOffset = this.levelOffset.add(desiredLevel.sub(this.levelOffset).mult(t));
                }
            }
        } catch (e) { /* ignore camera update errors */ }
  
        
        // Order: UI interaction, pan/zoom, copy & select, paint

        // UI interaction: compute UI bounds and whether pointer is over menu (grid-based)
        let pointerOverUI = this.updateRightBounds(tickDelta);
        this.handleLeft(tickDelta,pointerOverUI)
        

        // Handle clicks inside the edit panel for close/create buttons
        if (this.editmode && this.mouse.pressed('left') && this.mouse.pos) {
            const mp = this.mouse.pos;
            const leftW = this.editMenuWidth || 300;
            const panelX = 8;
            const panelY = 8;
            const panelW = leftW;
            const panelH = (this.UIDraw.getCtx('UI') ? (this.UIDraw.getCtx('UI').canvas.height / this.UIDraw.Scale.y) : 800) - 16;
            // color swatches layout (small palette near top of panel)
            const swatchSize = 20;
            const swatchSpacing = 8;
            const swatchCols = 10;
            const swStartX = panelX + 12;
            // shift swatches down to avoid overlapping the edit canvas
            const swStartY = panelY + 36 + 300;
            // handle clicks on color swatches
            // color input and eyedropper buttons
            const colorDisplayX = panelX + 12;
            // move action buttons down to avoid overlapping the edit canvas
            const colorDisplayY = panelY + 36 + 350;
            const colorDisplayW = 28;
            const colorDisplayH = 28;
            const chooseX = colorDisplayX + colorDisplayW + 8;
            const chooseY = colorDisplayY;
            const chooseW = 100;
            const chooseH = 28;
            const dropX = chooseX + chooseW + 8;
            const dropY = chooseY;
            const dropW = 90;
            const dropH = 28;
            // Choose Color button: opens native color picker
            if (mp.x >= chooseX && mp.x <= chooseX + chooseW && mp.y >= chooseY && mp.y <= chooseY + chooseH) {
                try { if (this.mouse && typeof this.mouse._setButton === 'function') this.mouse._setButton(0,0); } catch (e) {}
                // create a temporary input[type=color]
                try {
                    const inp = document.createElement('input');
                    inp.type = 'color';
                    // use current editColor hex (drop alpha)
                    try { inp.value = (this.editColor && typeof this.editColor.toHex === 'function') ? this.editColor.toHex().slice(0,7) : '#ffffff'; } catch (e) { inp.value = '#ffffff'; }
                    inp.style.position = 'fixed'; inp.style.left = '-100px'; inp.style.top = '-100px';
                    inp.addEventListener('input', (ev) => {
                        try {
                            const v = ev.target.value; // #rrggbb
                            let c = Color.fromHex(v);
                            // preserve previous alpha
                            if (this.editColor && typeof this.editColor.d !== 'undefined') c.d = this.editColor.d;
                            this.editColor = c;
                        } catch (e) { /* ignore */ }
                    });
                    inp.addEventListener('change', ()=>{ try { inp.remove(); } catch(e){} });
                    document.body.appendChild(inp);
                    inp.click();
                } catch (e) { console.warn('Color input failed', e); }
                this.rotDelay = this.rotSetDelay; this._uiHandled = true;
            }
            // Eyedropper toggle
            if (mp.x >= dropX && mp.x <= dropX + dropW && mp.y >= dropY && mp.y <= dropY + dropH) {
                try { if (this.mouse && typeof this.mouse._setButton === 'function') this.mouse._setButton(0,0); } catch (e) {}
                this.eyedropActive = !this.eyedropActive;
                this.rotDelay = this.rotSetDelay; this._uiHandled = true;
            }

            if (this.mouse.pressed('left') && Array.isArray(this.editPaletteColors)) {
                for (let si = 0; si < this.editPaletteColors.length; si++) {
                    const scol = si % swatchCols;
                    const srow = Math.floor(si / swatchCols);
                    const sx = swStartX + scol * (swatchSize + swatchSpacing);
                    const sy = swStartY + srow * (swatchSize + swatchSpacing);
                    if (mp.x >= sx && mp.x <= sx + swatchSize && mp.y >= sy && mp.y <= sy + swatchSize) {
                        // select this color (store Color instance)
                        this.editColor = this.editPaletteColors[si];
                        try { if (this.mouse && typeof this.mouse._setButton === 'function') this.mouse._setButton(0,0); } catch (e) {}
                        this.rotDelay = this.rotSetDelay;
                        this._uiHandled = true;
                        break;
                    }
                }
            }
            // close button region
            const bx = panelX + panelW - 28;
            const by = panelY + 8;
            const bw = 20;
            const bh = 20;
            if (mp.x >= bx && mp.x <= bx + bw && mp.y >= by && mp.y <= by + bh) {
                try { if (this.mouse && typeof this.mouse._setButton === 'function') this.mouse._setButton(0,0); } catch (e) {}
                this.exitEditMode();
                this._uiHandled = true;
            }
            // create new tile button
            const btnX = panelX + 12;
            const btnY = panelY + panelH - 56;
            const btnW = panelW - 24;
            const btnH = 36;
            if (mp.x >= btnX && mp.x <= btnX + btnW && mp.y >= btnY && mp.y <= btnY + btnH) {
                try { if (this.mouse && typeof this.mouse._setButton === 'function') this.mouse._setButton(0,0); } catch (e) {}
                if(this.rotDelay<-1){
                    this.createNewTile();
                    this.rotDelay = 1
                }
                this._uiHandled = true;
            }
            // if eyedropper was active and we clicked inside the edit canvas area, handle sampling here
            if (this.eyedropActive) {
                // we will sample inside the pixel-edit block below (on press inside canvas)
                // but clear UI handled so sampling can occur
                this._uiHandled = false;
            }
        }

        
        // Rotation delay update (keyboard rotation still allowed via 'r' / 'f')
        this.rotDelay -= tickDelta
        this.handleKeys()

        // Quick brush size shortcuts when in edit mode: 1..4
        try {
            if (this.editmode) {
                if (this.keys.pressed('1')) { this.editBrushSize = 1; console.log('Brush size -> 1'); }
                else if (this.keys.pressed('2')) { this.editBrushSize = 2; console.log('Brush size -> 2'); }
                else if (this.keys.pressed('3')) { this.editBrushSize = 3; console.log('Brush size -> 3'); }
                else if (this.keys.pressed('4')) { this.editBrushSize = 4; console.log('Brush size -> 4'); }
            }
        } catch (e) { /* ignore input read errors */ }

        // If a tool is active, update preview based on current cursor
        try {
            if (this.toolActive && this.toolStart) {
                const sx = this.toolStart.x;
                const sy = this.toolStart.y;
                const ex = Math.floor(this.cursor.x);
                const ey = Math.floor(this.cursor.y);
                let preview = [];
                if (this.toolMode === 'line') preview = this._bresenhamLine(sx, sy, ex, ey);
                else if (this.toolMode === 'box') {
                    // if Alt held, fill the box
                    if (this.keys && this.keys.held && this.keys.held('Alt')) {
                        preview = this._rectFill(sx, sy, ex, ey);
                    } else {
                        preview = this._rectOutline(sx, sy, ex, ey);
                    }
                } else if (this.toolMode === 'circle') {
                    const dx = ex - sx; const dy = ey - sy;
                    const r = Math.max(0, Math.round(Math.sqrt(dx*dx + dy*dy)));
                    // if Alt held, fill the circle
                    if (this.keys && this.keys.held && this.keys.held('Alt')) {
                        preview = this._circleFill(sx, sy, r);
                    } else {
                        preview = this._circleOutline(sx, sy, r);
                    }
                }
                this.tempTiles = preview;
            }
        } catch (e) {}

        if(this.mouse.pressed('middle')){
            this.mouse.grab(this.mouse.pos)
            this.startOffset = this.levelOffset.clone()
        }
        if(this.mouse.released('middle')){
            this.mouse.releaseGrab(this.mouse.pos)
            this.startOffset = this.levelOffset.clone()
        }

        // Edit-mode pixel editing: when editmode active, handle clicks inside the left edit panel
        if (this.editmode && this.editTileCanvas) {
            const mp = this.mouse.pos;
            const panelX = 8;
            const panelY = 8;
            const padX = 12;
            const padY = 48;
            const slice = this.editTileCanvas.width;
            const zoom = this.editTileZoom || 8;
            const imgX = panelX + padX;
            const imgY = panelY + padY;
            const imgW = slice * zoom;
            const imgH = slice * zoom;

            const inside = (mp.x >= imgX && mp.x <= imgX + imgW && mp.y >= imgY && mp.y <= imgY + imgH);
                    if (inside && (this.mouse.pressed('left') || this.mouse.held('left') || this.mouse.pressed('right') || this.mouse.held('right'))) {
                // compute pixel coords in edit canvas
                const rx = Math.floor((mp.x - imgX) / zoom);
                const ry = Math.floor((mp.y - imgY) / zoom);
                if (rx >= 0 && rx < slice && ry >= 0 && ry < slice) {
                    // allow eyedropper sampling to take precedence over painting
                    let skipApply = false;
                    if (this.eyedropActive && (this.mouse.pressed('left') || this.mouse.held('left'))) {
                        try {
                            const ctxSample = this.editTileCanvas.getContext('2d');
                            const pixel = ctxSample.getImageData(rx, ry, 1, 1).data;
                            const picked = new Color(pixel[0], pixel[1], pixel[2], (pixel[3] || 255) / 255, 'rgb');
                            this.editColor = picked;
                            this.eyedropActive = false;
                            try { if (this.mouse && typeof this.mouse._setButton === 'function') this.mouse._setButton(0,0); } catch (e) {}
                            this.rotDelay = this.rotSetDelay;
                            this._uiHandled = true;
                            skipApply = true;
                        } catch (e) { console.warn('Eyedrop sample failed', e); }
                    }
                    const ctx = this.editTileCanvas.getContext('2d');
                    const im = ctx.getImageData(0,0,slice,slice);
                    const idx = (ry * slice + rx) * 4;
                            if (this.mouse.held('right') || this.mouse.pressed('right')) {
                                // erase -> set alpha 0
                                im.data[idx+0] = 0;
                                im.data[idx+1] = 0;
                                im.data[idx+2] = 0;
                                im.data[idx+3] = 0;
                            } else {
                                // use Color helper to get rgb bytes
                                try {
                                    const col = Color.convertColor(this.editColor || '#FFFFFFFF').toRgb();
                                    im.data[idx+0] = Math.round(col.a || 0);
                                    im.data[idx+1] = Math.round(col.b || 0);
                                    im.data[idx+2] = Math.round(col.c || 0);
                                    im.data[idx+3] = Math.round((col.d || 1) * 255);
                                } catch (e) {
                                    const rgba = this._hexToRGBA(this.editColor || '#FFFFFFFF');
                                    im.data[idx+0] = rgba[0];
                                    im.data[idx+1] = rgba[1];
                                    im.data[idx+2] = rgba[2];
                                    im.data[idx+3] = rgba[3];
                                }
                            }
                    if (!skipApply) {
                        ctx.putImageData(im,0,0);
                        // immediately apply to tilesheet so world view updates
                        try { this.applyEditTileToTilesheet(); } catch (e) { console.warn('applyEditTileToTilesheet failed', e); }
                    }
                }
            }
        }

        

        // Reset UI handled flag when left button released so next click works
        if (this.mouse.released('left')) this._uiHandled = false;
    }

    drawTilemap(layerName){
        // Draw tiles that belong to `layerName`. The Draw context should already be
        // set to the matching canvas and transforms applied.
        const layer = layerName || 'base';
        this._tilemap.forEach((tx, ty, entry, lname) => {
            // entry is the raw stored mapping { tilesheetId, tileKey, rotation, invert }
            if (!entry) return;
            const sheet = this._tilemap.getTileSheet(entry.tilesheetId);
            if (!sheet) {
                console.warn('Missing TileSheet for tile at', { tilesheetId: entry.tilesheetId, x: tx, y: ty, layer });
                return;
            }
            const px = tx * this.tileSize;
            const py = ty * this.tileSize;
            const rot = entry.rotation ?? 0;
            const invert = entry.invert ?? 0;
            try {
                this.Draw.tile(sheet, (new Vector(px, py)).addS(this.levelOffset), new Vector(this.tileSize, this.tileSize), entry.tileKey, rot, new Vector(invert,1), 1);
                if(!this.camera.locked){
                    if(layer === 'overlay' && this.drawLayer !== 'overlay' || layer === 'base' && this.drawLayer === 'bg'){
                        this.Draw.rect(new Vector(px, py).addS(this.levelOffset).subS(new Vector(1,1)), new Vector(this.tileSize, this.tileSize).addS(new Vector(2,2)),'#FFFFFF33')
                    }
                    if(layer === 'bg' && this.drawLayer !== 'bg' || layer === 'base' && this.drawLayer === 'overlay'){
                        this.Draw.rect(new Vector(px, py).addS(this.levelOffset).subS(new Vector(1,1)), new Vector(this.tileSize, this.tileSize).addS(new Vector(2,2)),'#000000AA')
                    }
                }
            } catch (e) { console.warn('Draw.tile failed at', { layer, x: tx, y: ty, entry }, e); }
        }, layer);
    }

    // Temp tiles helpers -------------------------------------------------
    // Normalize input into {x,y} or null
    _normalizePos(posOrX, maybeY) {
        if (typeof posOrX === 'number' && typeof maybeY === 'number') return { x: Math.floor(posOrX), y: Math.floor(maybeY) };
        const p = posOrX;
        if (!p) return null;
        if (Array.isArray(p) && p.length >= 2) return { x: Math.floor(p[0]), y: Math.floor(p[1]) };
        if (typeof p.x === 'number' && typeof p.y === 'number') return { x: Math.floor(p.x), y: Math.floor(p.y) };
        return null;
    }

    addTempTile(posOrX, maybeY) {
        try {
            const p = this._normalizePos(posOrX, maybeY);
            if (!p) return false;
            // avoid duplicate
            for (let i = 0; i < this.tempTiles.length; i++) {
                const e = this.tempTiles[i];
                const np = (e && typeof e.x === 'number') ? e : (Array.isArray(e) ? { x: e[0], y: e[1] } : null);
                if (np && np.x === p.x && np.y === p.y) return false;
            }
            this.tempTiles.push({ x: p.x, y: p.y });
            return true;
        } catch (e) { console.warn('addTempTile failed', e); return false; }
    }

    // Undo helpers
    _pushUndo(batch) {
        if (this._suppressUndo) return;
        if (!Array.isArray(batch) || batch.length === 0) return;
        this.undoStack.push(batch);
        if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
    }

    undo() {
        if (!this.undoStack || this.undoStack.length === 0) return false;
        const batch = this.undoStack.pop();
        if (!Array.isArray(batch)) return false;
        try {
            this._suppressUndo = true;
            // apply in reverse order for per-tile undo batches
            for (let i = batch.length - 1; i >= 0; i--) {
                const op = batch[i];
                try {
                    if (!op || typeof op.x !== 'number' || typeof op.y !== 'number') continue;
                    if (!op.prev) {
                        // previous was empty -> remove from the layer stored in next (or default)
                        const layerToRemove = (op.next && op.next.layer) ? op.next.layer : (this.drawLayer || 'base');
                        this._tilemap.removeTile(op.x, op.y, layerToRemove);
                    } else {
                        const p = op.prev;
                        const layerToSet = p.layer || (this.drawLayer || 'base');
                        this._tilemap.setTile(op.x, op.y, p.tilesheetId, p.tileKey, p.rotation ?? 0, p.invert ?? 1, layerToSet);
                    }
                } catch (e) { console.warn('undo op failed', e); }
            }
        } finally { this._suppressUndo = false; }
        return true;
    }

    removeTempTile(posOrX, maybeY) {
        try {
            const p = this._normalizePos(posOrX, maybeY);
            if (!p) return false;
            let removed = false;
            this.tempTiles = this.tempTiles.filter((e) => {
                const np = (e && typeof e.x === 'number') ? e : (Array.isArray(e) ? { x: e[0], y: e[1] } : null);
                if (np && np.x === p.x && np.y === p.y) {
                    removed = true;
                    return false;
                }
                return true;
            });
            return removed;
        } catch (e) { console.warn('removeTempTile failed', e); return false; }
    }

    clearTempTiles(){
        try { this.tempTiles = []; return true; } catch (e) { console.warn('clearTempTiles failed', e); return false; }
    }

    // Apply temp tiles to the tilemap using current draw settings and then clear them
    applyTempTiles(){
        try {
            if (!this._tilemap || !Array.isArray(this.tempTiles) || this.tempTiles.length === 0) return 0;
            let applied = 0;
            const batch = [];
            // If the operation affects many tiles, creating a full snapshot and restoring
            // it on undo is usually much faster than thousands of individual set/delete ops.
            // snapshot optimization removed (simpler per-tile updates across layers)
            for (let i = 0; i < this.tempTiles.length; i++) {
                const e = this.tempTiles[i];
                const p = (e && typeof e.x === 'number') ? e : (Array.isArray(e) ? { x: e[0], y: e[1] } : null);
                if (!p) continue;
                try {
                    const sheetId = this.drawSheet || 'house';
                    const layer = this.drawLayer || 'base';
                    const prev = this._tilemap.getTile(p.x, p.y, layer) || null;
                    const prevWithLayer = prev ? Object.assign({}, prev, { layer }) : null;
                    const next = { tilesheetId: sheetId, tileKey: this.drawType, rotation: this.drawRot, invert: this.drawInvert, layer };
                    this._tilemap.setTile(p.x, p.y, sheetId, this.drawType, this.drawRot, this.drawInvert, layer);
                    batch.push({ x: p.x, y: p.y, prev: prevWithLayer, next: next });
                    applied++;
                } catch (ex) { console.warn('applyTempTiles setTile failed for', p, ex); }
            }
            if (batch.length > 0) {
                this._pushUndo(batch);
            }
            this.tempTiles = [];
            return applied;
        } catch (e) { console.warn('applyTempTiles failed', e); return 0; }
    }

    // Tool geometry helpers ----------------------------------------------
    _bresenhamLine(x0, y0, x1, y1) {
        const pts = [];
        let dx = Math.abs(x1 - x0);
        let sx = x0 < x1 ? 1 : -1;
        let dy = -Math.abs(y1 - y0);
        let sy = y0 < y1 ? 1 : -1;
        let err = dx + dy;
        while (true) {
            pts.push({ x: x0, y: y0 });
            if (x0 === x1 && y0 === y1) break;
            let e2 = 2 * err;
            if (e2 >= dy) { err += dy; x0 += sx; }
            if (e2 <= dx) { err += dx; y0 += sy; }
        }
        return pts;
    }

    _rectOutline(x0, y0, x1, y1) {
        const pts = [];
        const minx = Math.min(x0, x1); const maxx = Math.max(x0, x1);
        const miny = Math.min(y0, y1); const maxy = Math.max(y0, y1);
        for (let x = minx; x <= maxx; x++) { pts.push({ x: x, y: miny }); if (maxy !== miny) pts.push({ x: x, y: maxy }); }
        for (let y = miny + 1; y <= maxy - 1; y++) { pts.push({ x: minx, y: y }); if (maxx !== minx) pts.push({ x: maxx, y: y }); }
        // dedupe
        const seen = new Set(); const out = [];
        for (const p of pts) {
            const k = p.x + ',' + p.y; if (!seen.has(k)) { seen.add(k); out.push(p); }
        }
        return out;
    }

    _circleOutline(cx, cy, r) {
        const pts = [];
        if (r <= 0) return [{ x: cx, y: cy }];
        // approximate outline by sampling dx and computing dy
        const seen = new Set();
        for (let dx = -r; dx <= r; dx++) {
            const dyf = Math.sqrt(Math.max(0, r * r - dx * dx));
            const dy = Math.round(dyf);
            const candidates = [ { x: cx + dx, y: cy + dy }, { x: cx + dx, y: cy - dy } ];
            for (const c of candidates) {
                const k = c.x + ',' + c.y; if (!seen.has(k)) { seen.add(k); pts.push(c); }
            }
        }
        // also sample by dy to reduce gaps
        for (let dy = -r; dy <= r; dy++) {
            const dxf = Math.sqrt(Math.max(0, r * r - dy * dy));
            const dx = Math.round(dxf);
            const candidates = [ { x: cx + dx, y: cy + dy }, { x: cx - dx, y: cy + dy } ];
            for (const c of candidates) {
                const k = c.x + ',' + c.y; if (!seen.has(k)) { seen.add(k); pts.push(c); }
            }
        }
        return pts;
    }

    _rectFill(x0, y0, x1, y1) {
        const pts = [];
        const minx = Math.min(x0, x1); const maxx = Math.max(x0, x1);
        const miny = Math.min(y0, y1); const maxy = Math.max(y0, y1);
        for (let x = minx; x <= maxx; x++) {
            for (let y = miny; y <= maxy; y++) pts.push({ x: x, y: y });
        }
        return pts;
    }

    _circleFill(cx, cy, r) {
        const pts = [];
        if (r < 0) return pts;
        for (let dy = -r; dy <= r; dy++) {
            const dx = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)));
            for (let x = cx - dx; x <= cx + dx; x++) pts.push({ x: x, y: cy + dy });
        }
        // dedupe
        const seen = new Set(); const out = [];
        for (const p of pts) {
            const k = p.x + ',' + p.y; if (!seen.has(k)) { seen.add(k); out.push(p); }
        }
        return out;
    }

    /** 
     * Draws the game. Use the Draw class to draw elements. 
     * */
    draw() {
        if(!this.isReady) return;
        // Clear all world layers explicitly (Draw.clear only clears the active ctx).
        // This ensures 'bg' and 'overlay' are cleared even when current ctx is 'base'.
        const worldLayers = ['bg', 'base', 'overlay'];
        for (const ln of worldLayers) {
            try {
                this.Draw.useCtx(ln);
                this.Draw.popMatrix(false,true)
                this.Draw.clear();
            } catch (e) { console.warn('Could not clear world layer', ln, e); }
        }
        try {
            this.Draw.useCtx('bg')
        } catch(e){
            console.error("couldn't swap to ctx")
        }
        // Draw a special edit-mode background when editing. Use direct rect/gradient
        // on the bg context so transforms (push/pop matrix) don't affect it.
        try {
            // Use Draw.rect which has built-in gradient support. Compute two
            // animated colors and pass them as an array with fill='gradient'.
            this._editBgPhase = (this._editBgPhase || 0) + 0.02;
            const phase = (Math.sin(this._editBgPhase) + 1) / 2; // 0..1
            // small color shift for a subtle animated effect
            const r1 = Math.floor(10 + phase * 20);
            const g1 = Math.floor(20 + phase * 30);
            const b1 = Math.floor(50 + phase * 40);
            const r2 = Math.floor(30 + (1 - phase) * 20);
            const g2 = Math.floor(40 + (1 - phase) * 30);
            const b2 = Math.floor(60 + (1 - phase) * 30);
            const c1 = `rgba(${r1},${g1},${b1},1)`;
            const c2 = `rgba(${r2},${g2},${b2},1)`;

            if (this.editmode) {
                // rect expects Draw-space coords; background() uses canvas.width/Scale.x
                const ctx = this.Draw.ctx;
                const w = ctx ? (ctx.canvas.width / this.Draw.Scale.x) : 1920;
                const h = ctx ? (ctx.canvas.height / this.Draw.Scale.y) : 1080;
                this.Draw.rect(new Vector(0, 0), new Vector(w, h), [c1, c2], 'gradient');
            } else {
                this.Draw.background('#000000FF');
            }
        } catch (e) { console.warn('bg draw failed', e); }
        // Clear UI layers explicitly as well (both UI and overlays)
        try { this.UIDraw.useCtx('UI'); this.UIDraw.clear(); } catch (e) { console.warn('Could not clear UIDraw UI ctx', e); }
        try { this.UIDraw.useCtx('overlays'); this.UIDraw.clear(); } catch (e) { console.warn('Could not clear UIDraw overlays ctx', e); }
        // Apply zoom transform around screen center for world drawing
        const drawCtx = this.Draw.ctx;
        const uiW = drawCtx.canvas.width / this.Draw.Scale.x;
        const uiH = drawCtx.canvas.height / this.Draw.Scale.y;
        const center = new Vector(uiW / 2, uiH / 2);
        const origin = this.zoomOrigin ? this.zoomOrigin : center;
        // draw per logical layer so tiles end up on the correct canvas
        const layers = ['bg','base','overlay'];
        for (const layerName of layers) {
            try {
                this.Draw.useCtx(layerName);
            } catch (e) {
                // skip layers without a registered ctx
                continue;
            }

            // apply zoom/translate transforms for this ctx
            this.Draw.pushMatrix()
            this.Draw.translate(origin);
            this.Draw.scale(this.zoom);
            this.Draw.translate(new Vector(-origin.x, -origin.y));

            // draw tiles assigned to this layer
            this.drawTilemap(layerName);

            // draw test sprite only on base layer
            if (layerName === 'base') {
                this.testSprite.draw(this.levelOffset);
            }

            // restore transforms for this ctx
            try { this.Draw.popMatrix(); } catch (e) { console.warn('Draw.popMatrix failed for layer', layerName, e); }
        }

        // apply zoom/translate transforms for this ctx
        this.Draw.pushMatrix()
        this.Draw.translate(origin);
        this.Draw.scale(this.zoom);
        this.Draw.translate(new Vector(-origin.x, -origin.y));
        // draw preview of the tile under the cursor on the currently-selected layer
        if (this.mouse.pos.x < 1920 - this.uiMenu.menuWidth) {
            const previewSheet = this._tilemap.getTileSheet(this.drawSheet || 'house');
            try {
                //this.Draw.useCtx(this.drawLayer || 'base');
                if (!this.editmode) {
                    if (!this.keys.held('Shift')) {
                        this.Draw.tile(previewSheet, (new Vector(this.cursor.x * this.tileSize, this.cursor.y * this.tileSize)).addS(this.levelOffset), new Vector(this.tileSize, this.tileSize), this.drawType, this.drawRot, new Vector(this.drawInvert, 1), 1);
                    }
                    this.Draw.rect(this.cursor.mult(this.tileSize).add(this.levelOffset), new Vector(this.tileSize, this.tileSize), '#FFFFFF44');
                }
                this.Draw.rect(this.cursor.mult(this.tileSize).add(this.levelOffset), new Vector(this.tileSize, this.tileSize), '#907f7f44', false, true, 2, '#ffffff88');
            } catch (e) { console.warn('preview draw failed (layer=' + (this.drawLayer || 'base') + ')', e); }
        }

        // Draw any temporary tiles (tools) on the selected layer
        try {
            if (Array.isArray(this.tempTiles) && this.tempTiles.length > 0) {
                const previewSheet = this._tilemap.getTileSheet(this.drawSheet || 'house');
                for (let ti = 0; ti < this.tempTiles.length; ti++) {
                    let p = this.tempTiles[ti];
                    // accept Vector or plain {x,y}
                    let tx = (p && typeof p.x === 'number') ? p.x : (Array.isArray(p) ? p[0] : null);
                    let ty = (p && typeof p.y === 'number') ? p.y : (Array.isArray(p) ? p[1] : null);
                    if (tx === null || ty === null) continue;
                    try {
                        // draw preview tile (don't draw if editmode blocks placement in some cases)
                        this.Draw.tile(previewSheet, (new Vector(tx * this.tileSize, ty * this.tileSize)).addS(this.levelOffset), new Vector(this.tileSize, this.tileSize), this.drawType, this.drawRot, new Vector(this.drawInvert, 1), 1);
                    } catch (e) { console.warn('tempTiles Draw.tile failed for', { x: tx, y: ty, p }, e); }
                    try {
                        this.Draw.rect(new Vector(tx * this.tileSize, ty * this.tileSize).addS(this.levelOffset), new Vector(this.tileSize, this.tileSize), '#FFFFFF22');
                        this.Draw.rect(new Vector(tx * this.tileSize, ty * this.tileSize).addS(this.levelOffset), new Vector(this.tileSize, this.tileSize), '#00000000', false, true, 2, '#88FF88');
                    } catch (e) { console.warn('tempTiles rect draw failed for', { x: tx, y: ty, p }, e); }
                }
            }
        } catch (e) {}

        // draw selection rectangle for any selected placed tile
        try {
            if (this.selectedTile) {
                const sx = this.selectedTile.x * this.tileSize;
                const sy = this.selectedTile.y * this.tileSize;
                this.Draw.rect(new Vector(sx, sy).addS(this.levelOffset), new Vector(this.tileSize, this.tileSize), '#00000000', false, true, 3, this.selectionColor);
            }
        } catch (e) { console.warn('selection draw failed', e); }
        this.Draw.popMatrix();

        // (mini pixel cursor removed from world-layer draw; drawn later into UIDraw overlays so it isn't affected by zoom)
        
        // UI drawing: overlays layer is cleared and used for UI elements
        this.UIDraw.useCtx('overlays')
        this.UIDraw.clear()
        // draw mini pixel cursor in screen space (UIDraw overlays) so it isn't affected by world zoom
        try {
            if (this.editmode && this.selectedTile) {
                const info = this.selectedTile.info;
                if (info && info.sheet) {
                    const ts = info.sheet;
                    const slice = ts.slicePx || 16;

                    // compute world pixel coordinates for the selected pixel (same as before)
                    const drawCtx = this.Draw.ctx;
                    const uiW = drawCtx.canvas.width / this.Draw.Scale.x;
                    const uiH = drawCtx.canvas.height / this.Draw.Scale.y;
                    const center = new Vector(uiW/2, uiH/2);
                    const origin = this.zoomOrigin ? this.zoomOrigin : center;

                    const worldPos = this.mouse.pos.sub(origin).div(this.zoom).add(origin);
                    const local = worldPos.sub(this.levelOffset);
                    const withinTileX = local.x - (this.selectedTile.x * this.tileSize);
                    const withinTileY = local.y - (this.selectedTile.y * this.tileSize);

                    const px = Math.floor((withinTileX / this.tileSize) * slice);
                    const py = Math.floor((withinTileY / this.tileSize) * slice);

                    if (px >= 0 && py >= 0 && px < slice && py < slice) {
                        // Draw brush-sized cursor preview (square)
                        const bsize = Math.max(1, Math.floor(this.editBrushSize || 1));
                        const half = Math.floor(bsize / 2);
                        const startX = Math.max(0, px - half);
                        const startY = Math.max(0, py - half);
                        const drawW = Math.min(slice - startX, bsize);
                        const drawH = Math.min(slice - startY, bsize);

                        const pixelWorldSize = this.tileSize / slice;
                        const pxWorld = this.selectedTile.x * this.tileSize + startX * pixelWorldSize;
                        const pyWorld = this.selectedTile.y * this.tileSize + startY * pixelWorldSize;
                        // convert world position to screen-space using the same transform used for world drawing
                        const screenPos = new Vector(
                            pxWorld * this.zoom + origin.x * (1 - this.zoom),
                            pyWorld * this.zoom + origin.y * (1 - this.zoom)
                        );
                        const screenSizeX = pixelWorldSize * this.zoom * drawW;
                        const screenSizeY = pixelWorldSize * this.zoom * drawH;
                        // draw highlighted rectangle for the brush area in overlay space
                        
                        this.UIDraw.rect(screenPos.addS(this.levelOffset.mult(this.zoom)), new Vector(screenSizeX, screenSizeY), this.editColor,this.mouse.held('right') ? false : true, true, 0.5, '#ffcc00ff');
                    }
                }
            }
        } catch (e) { console.warn('cursor draw failed', e); }
        // Draw left-side edit menu when edit mode is active (blank panel for now)
        try {
            if (this.editmode) {
                const ovCtx = this.UIDraw.getCtx('overlays');
                if (ovCtx) {
                    const uiW = ovCtx.canvas.width / this.UIDraw.Scale.x;
                    const uiH = ovCtx.canvas.height / this.UIDraw.Scale.y;
                    const w = this.editMenuWidth || 300;
                    const x = 8;
                    const y = 8;
                    // background panel
                    this.UIDraw.rect(new Vector(x, y), new Vector(w, uiH - 16), '#000000EE');
                    // header
                    this.UIDraw.text('Edit Mode', new Vector(x + 12, y + 22), '#FFFFFFFF', 0, 16, { align: 'left' });
                    // close button (simple X)
                    const bx = x + w - 28;
                    const by = y + 8;
                    const bw = 20;
                    const bh = 20;
                    this.UIDraw.rect(new Vector(bx, by), new Vector(bw, bh), '#FFFFFF11');
                    this.UIDraw.text('X', new Vector(bx + bw/2, by + bh/2 + 6), '#FFFFFFFF', 0, 14, { align: 'center' });
                    // color picker label
                    this.UIDraw.text('Color:', new Vector(x + 12, y + 40), '#FFFFFFFF', 0, 12, { align: 'left' });
                    // current color display + controls
                    try {
                        const dispX = x + 12;
                        // move action buttons down to avoid overlapping the edit canvas
                        const dispY = y + 36 + 350;
                        const dispW = 28;
                        const dispH = 28;
                        // current color swatch
                        try {
                            this.UIDraw.rect(new Vector(dispX, dispY), new Vector(dispW, dispH), this.editColor || '#FFFFFFFF');
                        } catch (e) {
                            this.UIDraw.rect(new Vector(dispX, dispY), new Vector(dispW, dispH), (this.editColor && this.editColor.toHex) ? this.editColor.toHex().slice(0,7) : '#FFFFFF');
                        }
                        // Choose Color button
                        const chooseX = dispX + dispW + 8;
                        const chooseY = dispY;
                        const chooseW = 100;
                        const chooseH = 28;
                        this.UIDraw.rect(new Vector(chooseX, chooseY), new Vector(chooseW, chooseH), '#FFFFFF11');
                        this.UIDraw.text('Choose Color', new Vector(chooseX + chooseW/2, chooseY + chooseH/2 + 6), '#FFFFFFFF', 0, 12, { align: 'center' });
                        // Eyedropper button
                        const dropX = chooseX + chooseW + 8;
                        const dropY = chooseY;
                        const dropW = 90;
                        const dropH = 28;
                        const dropCol = this.eyedropActive ? '#FFAA00FF' : '#FFFFFF11';
                        this.UIDraw.rect(new Vector(dropX, dropY), new Vector(dropW, dropH), dropCol);
                        this.UIDraw.text('Eyedropper', new Vector(dropX + dropW/2, dropY + dropH/2 + 6), '#FFFFFFFF', 0, 12, { align: 'center' });
                    } catch (e) { /* ignore control draw errors */ }
                    // draw color swatches
                    try {
                        const swatchSize = 20;
                        const swatchSpacing = 8;
                        const swatchCols = 10;
                        const swStartX = x + 12;
                        // shift swatches down to avoid overlapping the edit canvas
                        const swStartY = y + 36 + 300;
                        const colors = Array.isArray(this.editPaletteColors) ? this.editPaletteColors : [this.editColor || Color.convertColor('#FFFFFFFF')];
                        for (let i = 0; i < colors.length; i++) {
                            const col = i % swatchCols;
                            const row = Math.floor(i / swatchCols);
                            const sx = swStartX + col * (swatchSize + swatchSpacing);
                            const sy = swStartY + row * (swatchSize + swatchSpacing);
                            // UIDraw supports Color instances directly
                            try {
                                this.UIDraw.rect(new Vector(sx, sy), new Vector(swatchSize, swatchSize), colors[i]);
                            } catch (e) {
                                // fallback to hex string
                                this.UIDraw.rect(new Vector(sx, sy), new Vector(swatchSize, swatchSize), (colors[i] && typeof colors[i].toHex === 'function') ? colors[i].toHex() : (colors[i] || '#FFFFFFFF'));
                            }
                            // highlight selected color by comparing hex representation
                            try {
                                const isSel = this.editColor && (this.editColor.toHex() === (colors[i] && colors[i].toHex && colors[i].toHex()));
                                if (isSel) {
                                    this.UIDraw.rect(new Vector(sx, sy), new Vector(swatchSize, swatchSize), '#00000000', false, true, 2, '#FFFFFFFF');
                                } else {
                                    this.UIDraw.rect(new Vector(sx, sy), new Vector(swatchSize, swatchSize), '#00000000', false, true, 1, '#FFFFFF33');
                                }
                            } catch (e) {
                                this.UIDraw.rect(new Vector(sx, sy), new Vector(swatchSize, swatchSize), '#00000000', false, true, 1, '#FFFFFF33');
                            }
                        }
                    } catch (e) { /* ignore swatch draw errors */ }
                    // create-new-tile button near bottom of panel
                    const btnW = w - 24;
                    const btnH = 36;
                    const btnX = x + 12;
                    const btnY = y + uiH - 56;
                    this.UIDraw.rect(new Vector(btnX, btnY), new Vector(btnW, btnH), '#FFFFFF11');
                    this.UIDraw.text('Create New Tile', new Vector(btnX + btnW/2, btnY + btnH/2 + 6), '#FFFFFFFF', 0, 16, { align: 'center' });
                    // draw the editable tile canvas scaled up
                    try {
                        if (this.editTileCanvas) {
                            const slice = this.editTileCanvas.width;
                            const zoom = this.editTileZoom || Math.max(4, Math.floor((w - 40) / slice));
                            const imgX = x + 12;
                            const imgY = y + 48;
                            const size = new Vector(slice * zoom, slice * zoom);
                            this.UIDraw.image(this.editTileCanvas, new Vector(imgX, imgY), size, null, 0, 1, false);
                            // draw pixel grid lines
                            for (let gx = 0; gx <= slice; gx++) {
                                const px = imgX + gx * zoom;
                                this.UIDraw.line(new Vector(px, imgY), new Vector(px, imgY + slice * zoom), '#FFFFFF22', 1);
                            }
                            for (let gy = 0; gy <= slice; gy++) {
                                const py = imgY + gy * zoom;
                                this.UIDraw.line(new Vector(imgX, py), new Vector(imgX + slice * zoom, py), '#FFFFFF22', 1);
                            }
                        }
                    } catch (e) { /* ignore edit-canvas draw errors */ }
                }
            }
        } catch (e) { console.warn('overlay draw failed', e); }
        // Draw a right-side tile palette using the modular Palette UI
        try {
            const uiCtx = this.UIDraw.getCtx('UI');
            // hide right-side palette when camera is locked
            if (uiCtx && !(this.camera && this.camera.locked)) {
                const uiW = uiCtx.canvas.width / this.UIDraw.Scale.x;
                const uiH = uiCtx.canvas.height / this.UIDraw.Scale.y;
                // create palette on first use
                if (!this.palette) {
                    this.palette = new Palette(this, this.mouse, this.keys, this.UIDraw);
                }
                // layout, update and draw
                try { this.palette.layout(uiW, uiH); } catch (e) {}
                try { this.palette.update(0); } catch (e) {}
                try { this.palette.draw(this.UIDraw); } catch (e) {}

                // Create and draw fixed Export / Import UIButtons anchored to the
                // bottom of the screen next to the right-side sidebar (they do not scroll).
                try {
                    const m = this.palette;
                    const menuX = m.menu.pos.x;
                    const menuW = m.menu.size.x;
                    const uiCtx = this.UIDraw.getCtx('UI');
                    const uiW = uiCtx.canvas.width / this.UIDraw.Scale.x;
                    const uiH = uiCtx.canvas.height / this.UIDraw.Scale.y;

                    // button sizing and spacing
                    const gap = 16;
                    const btnH = 64;
                    const btnW = Math.max(120, Math.min(220, Math.floor(menuW * 0.75)));

                    // position the buttons to the LEFT of the sidebar (so they're visible next to it)
                    const rightEdge = menuX - gap; // left edge where buttons should sit against
                    const x = rightEdge - btnW;
                    const bottomY = 1080 - gap/2;

                    // Create buttons once
                    // Export as image chunks button (above the normal export button)
                    if (!this.fixedExportImagesBtn) {
                        this.fixedExportImagesBtn = new UIButton(this.mouse, this.keys, new Vector(x, bottomY - (btnH * 3 + gap*1.5)), new Vector(btnW, btnH), 200);
                        this.fixedExportImagesBtn.onPressed['left'].connect(async () => {
                            try {
                                if (!this.packageManager) this.packageManager = new (await import('../js/PackageManager.js')).default(this._tilemap, this);
                                if (this.packageManager && typeof this.packageManager.exportAsImageChunks === 'function') {
                                    // default chunk size 16 tiles, export tile pixels at 16px by default
                                    await this.packageManager.exportAsImageChunks(this._tilemap, { chunkSize: 16, tilePixelSize: 16, filename: 'map_chunks.tar' });
                                }
                            } catch (e) { console.warn('Export images button failed', e); }
                        });
                    }

                    if (!this.fixedExportBtn) {
                        this.fixedExportBtn = new UIButton(this.mouse, this.keys, new Vector(x, bottomY - (btnH * 2 + gap)), new Vector(btnW, btnH), 200);
                        this.fixedExportBtn.onPressed['left'].connect(async () => {
                            try {
                                if (!this.packageManager) this.packageManager = new (await import('../js/PackageManager.js')).default(this._tilemap, this);
                                const mapPayload = {
                                    map: (this._tilemap && typeof this._tilemap.toJSON === 'function') ? this._tilemap.toJSON() : null,
                                    levelOffset: Vector.encode(this.levelOffset),
                                    tileSize: this.tileSize,
                                    drawType: this.drawType,
                                    drawRot: this.drawRot,
                                    drawInvert: this.drawInvert,
                                    zoom: this.zoom
                                };
                                if (this.packageManager && typeof this.packageManager.exportAsTarFile === 'function') {
                                    this.packageManager.exportAsTarFile('tilesheets.tar', mapPayload);
                                }
                            } catch (e) { console.warn('Export button failed', e); }
                        });
                    }

                    if (!this.fixedImportBtn) {
                        this.fixedImportBtn = new UIButton(this.mouse, this.keys, new Vector(x, 1080-64-16), new Vector(btnW, btnH), 200);
                        this.fixedImportBtn.onPressed['left'].connect(async () => {
                            try {
                                if (this && typeof this.promptImportFiles === 'function') await this.promptImportFiles();
                            } catch (e) { console.warn('Import button failed', e); }
                        });
                    }

                    // Update and draw the buttons each frame (absolute screen coordinates)
                    try {
                        // export images button (top), export button (middle) and import (bottom)
                        if (this.fixedExportImagesBtn) {
                            this.fixedExportImagesBtn.pos = new Vector(x, bottomY - (btnH * 3 + gap*1.5));
                            this.fixedExportImagesBtn.size = new Vector(btnW, btnH);
                            this.fixedExportImagesBtn.addOffset(new Vector(0,0));
                            this.fixedExportImagesBtn.update(0);
                            this.fixedExportImagesBtn.draw(this.UIDraw);
                            this.UIDraw.text('Export images', new Vector(x + btnW / 2, bottomY - (btnH * 2.5 + gap*1.5)), '#FFFFFFFF', 0, 18, { align: 'center', baseline: 'middle' });
                        }

                        this.fixedExportBtn.pos = new Vector(x, bottomY - (btnH * 2 + gap));
                        this.fixedExportBtn.size = new Vector(btnW, btnH);
                        this.fixedExportBtn.addOffset(new Vector(0,0));
                        this.fixedExportBtn.update(0);
                        this.fixedExportBtn.draw(this.UIDraw);
                        this.UIDraw.text('Export', new Vector(x + btnW / 2, bottomY - (btnH * 1.5 + gap)), '#FFFFFFFF', 0, 20, { align: 'center', baseline: 'middle' });
                    } catch (e) {}

                    try {
                        this.fixedImportBtn.pos = new Vector(x, 1080-btnH-8);
                        this.fixedImportBtn.size = new Vector(btnW, btnH);
                        this.fixedImportBtn.addOffset(new Vector(0,0));
                        this.fixedImportBtn.update(0);
                        this.fixedImportBtn.draw(this.UIDraw);
                        this.UIDraw.text('Import', new Vector(x + btnW / 2, bottomY - (btnH * 0.5)), '#FFFFFFFF', 0, 20, { align: 'center', baseline: 'middle' });
                    } catch (e) {}
                } catch (e) {}
            }
        } catch (e) {
            // ignore UI draw errors
        }
        // restore world transforms
        try { this.Draw.popMatrix(); } catch (e) { console.warn('popMatrix restore failed', e); }
            this.UIDraw.useCtx('UI')
    }
}
