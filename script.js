// Core runtime entry: Program + Game orchestrate layers, input, scenes and
// optional multiplayer. This file bootstraps the in-browser "engine" that
// composes smaller modules (Draw, Input, Saver, Scenes) into a coherent
// application loop. When migrating to a proper game engine we want this file
// focused on: initialization, scene management, layer/canvas handling, and
// exposing integration points for networking/UI.
//
// Contract (high-level):
// - Program: creates canvases/layers, handles resize and main loop.
// - Game: manages scenes, resource loading, multiplayer UI and top-level state.
// - Inputs: routes mouse/keys into the current scene.
// - Outputs: drawing to the Draw/UIDraw helpers and DOM-based UI elements.
import Vector from './js/Vector.js';
import Color from './js/Color.js';
import Mouse from './js/Mouse.js';
import Keys from './js/Keys.js';
import Draw from './js/Draw.js';
import Saver from './js/Saver.js';
import Signal from './js/Signal.js';
import { addEvent, getID } from './js/Support.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";
import ServerManager from './js/Server/ServerManager.js';
// firebaseConfig is loaded dynamically at runtime (may be gitignored on purpose)
import Menu from './js/UI/Menu.js';
import UIButton from './js/UI/Button.js';
import UITextInput from './js/UI/UITextInput.js';
import SoundManager from './js/SoundManager.js';
import { createSFX } from './js/SFX.js';


const mainWidth = 1920;
const mainheight = 1080;



class Game {
    // Top-level game container: owns scene manager, saves, UI helpers and
    // optional multiplayer glue. Scenes are dynamically imported and receive
    // Draw/UIDraw + input objects; Game is responsible for wiring them up.
    constructor(program) {
        this.program = program; 

        this.mouse = program.mouse;
        this.keys = program.keys;
        this.Draw = program.Draw;  
        this.UIDraw = program.UIDraw; 

        // Engine state
        this.runtime = 0;
        this.delta = 0;
        // Add game layers here!  false=default, true=UI version (has div container)
        this.program.addLayer('bg', false);
        this.program.addLayer('base', false);
        this.program.addLayer('overlay', false);
        this.program.addLayer('UI', true);
        this.program.addLayer('overlays', true);

        this.program.updateZ();
        this.Draw.registerCtx('base',this.program.getCtx('base'));
        this.Draw.registerCtx('bg',this.program.getCtx('bg'));
        this.Draw.registerCtx('overlay',this.program.getCtx('overlay'));
        this.UIDraw.registerCtx('overlays',this.program.getCtx('overlays'));
        this.UIDraw.registerCtx('UI',this.program.getCtx('UI'));


        // Save data
        
        this.saver = new Saver("Save");
        
        this.elements = [];

        // Scenes
        this.scenes = new Map();
        this.currentScene = null;
        this.sceneName = null;

        // Multiplayer
        this.remoteStateSignal = new Signal(); // Signal to apply remote state updates
        this.enableMultiplayer = new Signal(); // Signal to enable multiplayer features
        this.playerCount = 1; // Number of players in the current session

        // Audio (shared across all scenes)
        try {
            this.soundGuy = new SoundManager();
            this.sfx = createSFX(this.soundGuy, { baseUrl: './sounds', masterVolume: 0.9 });
            // Fire-and-forget preload; missing files are handled gracefully.
            try { this.sfx.preload(); } catch (e) { /* ignore */ }

            // Debug hooks + auto-resume on first user gesture.
            try {
                window.soundGuy = this.soundGuy;
                window.sfx = this.sfx;
                const resumeOnce = () => {
                    try { this.soundGuy && this.soundGuy.resume && this.soundGuy.resume(); } catch (e) {}
                    try { window.removeEventListener('pointerdown', resumeOnce, true); } catch (e) {}
                    try { window.removeEventListener('keydown', resumeOnce, true); } catch (e) {}
                };
                window.addEventListener('pointerdown', resumeOnce, true);
                window.addEventListener('keydown', resumeOnce, true);
            } catch (e) {
                /* ignore */
            }
        } catch (e) {
            console.warn('Audio init failed; SFX disabled', e);
            this.soundGuy = null;
            this.sfx = null;
        }

        (async () => {
            const cfgUrl = './js/Server/firebaseConfig.js';
            try {
                // Check that the config file actually exists and looks like JavaScript before
                // attempting a dynamic import. This avoids a noisy MIME-type module error in
                // the browser when the file is missing and the server returns HTML (404 page).
                const head = await fetch(cfgUrl, { method: 'HEAD' });
                if (!head.ok) throw new Error(`config not found: ${head.status}`);
                const ctype = head.headers.get('content-type') || '';
                if (!/javascript/.test(ctype)) throw new Error(`unexpected content-type: ${ctype}`);

                const mod = await import(cfgUrl);
                this.app = initializeApp(mod.firebaseConfig);
                this.db = getDatabase(this.app);
                this.server = new ServerManager(this.db);
                // start a local tick for coordination/heartbeat purposes
                try { this.server.startTick(1000); } catch (e) { /* ignore */ }

                // Register a debug console command 'testDelete' that deletes a random room.
                // The project's Debug implementation may be created later; poll for it briefly.
                const registerTestDelete = async () => {
                    const maxWait = 5000; // ms
                    const start = Date.now();
                    while (Date.now() - start < maxWait) {
                        if (window.Debug && typeof window.Debug.createSignal === 'function') break;
                        // wait a bit
                        // eslint-disable-next-line no-await-in-loop
                        await new Promise(r => setTimeout(r, 100));
                    }
                    if (window.Debug && typeof window.Debug.createSignal === 'function') {
                        try {
                            window.Debug.createSignal('testDelete', async () => {
                                const removed = await this.server.deleteRandomRoom();
                                console.log('Debug.testDelete removed:', removed);
                            });
                            console.log('Registered Debug signal: testDelete');
                        } catch (e) {
                            console.warn('Failed to register Debug.testDelete', e);
                        }
                    } else {
                        console.warn('Debug API not found; testDelete not registered');
                    }
                };
                registerTestDelete();
            } catch (e) {
                console.warn('Firebase config not found; multiplayer disabled', e);
                this.app = null;
                this.db = null;
                this.server = null;
            }
        })();

        this.init();
    }

    async init() {
        await this.loadScene('spriteScene');
        this.switchScene('spriteScene');
        this.createMultiplayerUI()
        // Only create the multiplayer UI if the server (firebase) was initialized.

        // De-comment to enable server-side features.
        //if (this.server) this.createMultiplayerUI();
    }

    // Loads a scene module by name (dynamic import). If `reload` is true the
    // previous scene instance is removed. Returns a Promise that resolves to
    // the scene instance after optional onPreload has completed.
    async loadScene(name, resources, reload = false) {
        if (this.scenes.has(name) && !reload) return Promise.resolve(this.scenes.get(name));
        if (this.scenes.has(name) && reload) {
            this.removeScene(name);
        }
        // Dynamic import based on scene name
        return import(`./Scenes/${name}.js?update=${Date.now()}`).then(module => {
            const SceneClass = module[Object.keys(module)[0]];
            const scene = new SceneClass(
                this.Draw,
                this.UIDraw,
                this.mouse,
                this.keys,
                this.saver,
                this.switchScene.bind(this),
                this.loadScene.bind(this),
                this.preloadScene.bind(this),
                this.removeScene.bind(this),
                this.remoteStateSignal,
                this.enableMultiplayer,
                this.server,
                this.playerCount
            );

            // Inject shared resources.
            try {
                scene.soundGuy = this.soundGuy;
                scene.sfx = this.sfx;
            } catch (e) {
                /* ignore */
            }
            if (scene.onPreload) return  scene.onPreload(resources).then(() => {
                this.scenes.set(name, scene);
                return scene;
            });
            this.scenes.set(name, scene);
            return scene;
        });
    }

    // Preloads a scene (calls onPreload if not already done)
    preloadScene(name, resources=null) {
        if (this.scenes.has(name)) return Promise.resolve();
        return this.loadScene(name, resources);
    }

    // Switches to a scene by name. Calls the lifecycle hooks in order:
    // prevScene.onSwitchTo() -> newScene.onSwitchFrom(prevResources) -> newScene.onReady()
    async switchScene(name) {
        await this.loadScene(name);
        if (!this.scenes.has(name)) {
            throw new Error(`Scene '${name}' not loaded. Call loadScene() first.`);
        }
        if (this.sceneName === name) return;
        let prevScene = this.currentScene;
        let prevResources = null;
        if (prevScene) {
            prevResources = prevScene.onSwitchTo();
        }
        let scene = this.scenes.get(name);
        if (scene.onSwitchFrom) {
            scene.onSwitchFrom(prevResources);
        }
        if (!scene.isReady && scene.onReady) {
            scene.onReady();
            scene.isReady = true;
        }
        this.currentScene = scene;
        this.sceneName = name;
    }

    _setMultiplayerStatus(text = 'Status: Idle') {
        if (!this.multiplayerUI) return;
        this.multiplayerUI.statusText = String(text || 'Status: Idle');
    }

    _bindRoomStateListener(handler) {
        try {
            if (!this.server || typeof this.server.on !== 'function') return;
            // Keep one canonical state listener callback from the multiplayer menu.
            this._roomStateListener = handler;
            this.server.on('state', (state) => {
                try {
                    if (this._roomStateListener) this._roomStateListener(state);
                } catch (e) {}
            });
        } catch (e) {}
    }

    _pointInRect(point, pos, size) {
        if (!point || !pos || !size) return false;
        return point.x >= pos.x
            && point.y >= pos.y
            && point.x <= pos.x + size.x
            && point.y <= pos.y + size.y;
    }

    _layoutMultiplayerUI() {
        if (!this.multiplayerUI) return;
        const ui = this.multiplayerUI;
        const openX = ui.openX;
        const closedX = ui.closedX;
        const y = ui.baseY;
        ui.menu.pos.x = ui.visible ? openX : closedX;
        ui.menu.pos.y = y;

        const tabW = ui.toggleBtn.size.x;
        const tabH = ui.toggleBtn.size.y;
        ui.toggleBtn.pos.x = ui.menu.pos.x - tabW;
        ui.toggleBtn.pos.y = ui.menu.pos.y + Math.floor((ui.menu.size.y - tabH) * 0.5);
    }

    _cursorColorForId(id) {
        const colors = ['#FF5555FF','#55FF55FF','#5555FFFF','#FFFF55FF','#FF55FFFF','#55FFFFFF','#FFA500FF','#FFFFFF88'];
        const hash = (String(id || '')).split('').reduce((s,c)=>s + c.charCodeAt(0),0) || 0;
        return colors[hash % colors.length] || '#FFFFFF88';
    }

    _getMultiplayerUsers() {
        const out = [];
        const scene = this.currentScene;
        if (!scene) return out;
        try {
            const selfId = scene.clientId || (scene.server && scene.server.playerId) || 'self';
            const selfName = scene.playerName || selfId;
            out.push({ id: selfId, name: selfName, color: this._cursorColorForId(selfId), self: true, entry: null });
            const map = scene._remoteCursors;
            if (map && typeof map.entries === 'function') {
                for (const [cid, entry] of map.entries()) {
                    if (!cid || cid === selfId) continue;
                    out.push({ id: cid, name: (entry && entry.name) ? entry.name : cid, color: this._cursorColorForId(cid), self: false, entry });
                }
            }
        } catch (e) {}
        return out;
    }

    _applyTrackedCursorCamera() {
        try {
            const ui = this.multiplayerUI;
            const scene = this.currentScene;
            if (!ui || !scene || !ui.trackedCursorId) return;
            if (ui.trackedCursorId === scene.clientId) return;
            const entry = scene._remoteCursors && scene._remoteCursors.get(ui.trackedCursorId);
            if (!entry) return;
            if (!Number.isFinite(entry.zx) || !Number.isFinite(entry.zy) || !Number.isFinite(entry.ox) || !Number.isFinite(entry.oy)) return;
            scene.zoom.x = Number(entry.zx);
            scene.zoom.y = Number(entry.zy);
            scene.offset.x = Number(entry.ox);
            scene.offset.y = Number(entry.oy);
        } catch (e) {}
    }

    setMultiplayerUIVisible(visible = true) {
        if (!this.multiplayerUI) return false;
        const next = !!visible;
        this.multiplayerUI.visible = next;
        this.multiplayerUI.menu.visible = next;
        this._layoutMultiplayerUI();
        try {
            if (this.server && typeof this.server.unpause === 'function' && next) this.server.unpause();
            if (this.server && typeof this.server.pause === 'function' && !next) this.server.pause();
        } catch (e) {}
        return true;
    }

    // Create an in-canvas UI for creating/joining multiplayer rooms.
    // Uses engine UI elements so it stays in the same interaction system as the editor.
    createMultiplayerUI() {
        this.saver.remove('instance');
        console.log('Creating multiplayer UI');

        // --- Container panel (bottom-right) ---
        const panelSize = new Vector(360, 330);
        const margin = 20; // margin from screen edge
        const panelPos = new Vector(1920 - margin - panelSize.x, 1080 - margin - panelSize.y);
        const panelLayer = 50;
        const menu = new Menu(this.mouse, this.keys, panelPos, panelSize, panelLayer, '#000000CC');
        const toggleBtn = new UIButton(this.mouse, this.keys, new Vector(0, 0), new Vector(20, 64), panelLayer + 1, null, '#2A2A2AEE', '#4A4A4AFF', '#1F1F1FFF');

        const nameInput = new UITextInput(this.mouse, this.keys, new Vector(95, 10), new Vector(250, 28), panelLayer, '', 'username');
        const input = new UITextInput(this.mouse, this.keys, new Vector(95, 44), new Vector(250, 30), panelLayer, '', 'room-id');
        const createBtn = new UIButton(this.mouse, this.keys, new Vector(10, 82), new Vector(165, 40), panelLayer, null, '#333333', '#555555', '#222222');
        const joinBtn = new UIButton(this.mouse, this.keys, new Vector(185, 82), new Vector(160, 40), panelLayer, null, '#333333', '#555555', '#222222');
        menu.addElement('nameInput', nameInput);
        menu.addElement('input', input);
        menu.addElement('createBtn', createBtn);
        menu.addElement('joinBtn', joinBtn);

        try {
            const scene = this.currentScene;
            const initial = (scene && scene.playerName) ? scene.playerName : '';
            nameInput.text = String(initial || '');
            const applyName = (val) => {
                try {
                    const next = String(val || '').trim().slice(0, 64);
                    if (this.currentScene) this.currentScene.playerName = next;
                } catch (e) {}
            };
            nameInput.onSubmit.connect(applyName);
            nameInput.onChange.connect(applyName);
        } catch (e) {}

        const updateStatus = (state) => {
            if (!state) return;
            const p1Ready = state.p1x !== undefined && state.p1y !== undefined;
            const p2Ready = state.p2x !== undefined && state.p2y !== undefined;

            if (p1Ready && p2Ready) this._setMultiplayerStatus('Status: Connected!');
            else if (p1Ready || p2Ready) this._setMultiplayerStatus('Status: Waiting for other player...');
        };

        // --- Button logic ---
        createBtn.onPressed.left.connect(async () => {
            const roomId = await this.server.createRoom();
            input.text = roomId;
            this._setMultiplayerStatus('Status: Room created! Waiting for player 2...');
            console.log('Room created:', roomId);
            this.enableMultiplayer.emit('p1');

            try { if (this.server && typeof this.server.unpause === 'function') this.server.unpause(); } catch (e) {}

            // Attach signal handler for this scene instance
            this._bindRoomStateListener((state) => {
                this.remoteStateSignal.emit(state,'p1'); 
                this.playerCount = 2;
                updateStatus(state);
            });
        });

        joinBtn.onPressed.left.connect(async () => {
            const roomId = String(input.text || '').trim();
            if (!roomId) {
                this._setMultiplayerStatus('Status: Enter room ID!');
                return;
            }

            await this.server.joinRoom(roomId);
            this._setMultiplayerStatus('Status: Joined room. Waiting for sync...');
            console.log('Joined room:', roomId);
            this.enableMultiplayer.emit('p2');

            try { if (this.server && typeof this.server.unpause === 'function') this.server.unpause(); } catch (e) {}

            // Request an initial full-sync snapshot from the host and pause edits until it arrives
            try {
                const syncId = 'sync_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,6);
                const diff = {
                    'sync/requestId': syncId,
                    'sync/requester': (this.server && this.server.playerId) ? this.server.playerId : 'p2',
                    'sync/status': 'pending',
                    'sync/paused': true,
                    'sync/snapshot': null,
                    'sync/acks': null,
                    'sync/message': 'initial-join'
                };
                this.server.sendDiff(diff);
                this._setMultiplayerStatus('Status: Syncing...');
            } catch (e) {
                console.warn('Failed to request sync snapshot', e);
            }

            const snapshot = await this.server.fetch('state');
            if (snapshot) this.remoteStateSignal.emit(snapshot);

            this._bindRoomStateListener((state) => {
                updateStatus(state);
                this.playerCount = 2;
                this.remoteStateSignal.emit(state,'p2'); // emit for this scene
            });
        });

        this.multiplayerUI = {
            menu,
            nameInput,
            input,
            createBtn,
            joinBtn,
            toggleBtn,
            statusText: 'Status: Idle',
            visible: false,
            consumeInputFrames: 0,
            trackedCursorId: null,
            openX: panelPos.x,
            closedX: 1920 - 6,
            baseY: panelPos.y
        };
        this.multiplayerUI.menu.visible = false;
        this._layoutMultiplayerUI();

        toggleBtn.onPressed.left.connect(() => {
            // Latch mouse blocking to prevent click-through during the same-frame layout swap.
            this.multiplayerUI.consumeInputFrames = Math.max(2, Number(this.multiplayerUI.consumeInputFrames || 0));
            try { if (this.mouse && typeof this.mouse.pause === 'function') this.mouse.pause(0.2); } catch (e) {}
            this.setMultiplayerUIVisible(!this.multiplayerUI.visible);
            try { if (this.mouse && typeof this.mouse.addMask === 'function') this.mouse.addMask(1); } catch (e) {}
        });

        // Back-compat hooks used by debug commands.
        try {
            window.showMultiplayerMenu = () => this.setMultiplayerUIVisible(true);
            window.hideMultiplayerMenu = () => this.setMultiplayerUIVisible(false);
        } catch (e) {}

        // If multiplayer UI is hidden by default, pause server activity to save resources
        try {
            if (this.server && typeof this.server.pause === 'function') this.server.pause();
        } catch (e) {}

        // Start coordinated sweeper attempts periodically (every 30s).
        // Each attempt will try to claim a stale room and perform required steps (5 steps of 5s each by default).
        try {
            if (this._coordinatedSweepInterval) clearInterval(this._coordinatedSweepInterval);
            this._coordinatedSweepInterval = setInterval(() => {
                // Indicate we're attempting a coordinated sweep (even if no candidate is found)
                //console.log('[Script] coordinated sweeper tick - attempting sweep');
                // run the coordinated sweep in background; using test params: requiredCount=5, stepMs=5000
                this.server.coordinatedSweepAttempt({ maxAgeMs: 10 * 1000, requiredCount: 5, stepMs: 5000 })
                    .then(removed => {
                        if (removed) console.log('Coordinated sweeper removed room:', removed);
                    }).catch(e => console.warn('Coordinated sweep error', e));
            }, 5 * 1000); // run every 5 seconds for testing
        } catch (e) {
            console.warn('Failed to start coordinated sweeper interval', e);
        }
    }

    _drawMultiplayerUI() {
        if (!this.multiplayerUI) return;
        const ui = this.multiplayerUI;
        this._layoutMultiplayerUI();

        if (ui.visible) {
            const base = ui.menu.pos;
            ui.menu.draw(this.UIDraw);

            // border
            this.UIDraw.rect(base, ui.menu.size, '#00000000', false, true, 2, '#FFFFFF66');

            // labels
            this.UIDraw.text('Name:', new Vector(base.x + 12, base.y + 27), '#FFFFFF', 0, 18, { align: 'left', baseline: 'middle', font: 'monospace' });
            this.UIDraw.text('Room ID:', new Vector(base.x + 12, base.y + 62), '#FFFFFF', 0, 18, { align: 'left', baseline: 'middle', font: 'monospace' });
            this.UIDraw.text('Create', new Vector(base.x + 10 + 82, base.y + 82 + 26), '#FFFFFF', 0, 18, { align: 'center', baseline: 'middle', font: 'monospace' });
            this.UIDraw.text('Join', new Vector(base.x + 185 + 80, base.y + 82 + 26), '#FFFFFF', 0, 18, { align: 'center', baseline: 'middle', font: 'monospace' });
            this.UIDraw.text(ui.statusText || 'Status: Idle', new Vector(base.x + 12, base.y + 138), '#DDDDDD', 0, 16, { align: 'left', baseline: 'middle', font: 'monospace' });

            this.UIDraw.text('Track Cursor:', new Vector(base.x + 12, base.y + 162), '#FFFFFF', 0, 16, { align: 'left', baseline: 'middle', font: 'monospace' });
            const users = this._getMultiplayerUsers();
            for (let i = 0; i < users.length; i++) {
                const u = users[i];
                const rowY = base.y + 176 + i * 24;
                const swatchPos = new Vector(base.x + 12, rowY);
                this.UIDraw.rect(swatchPos, new Vector(12, 12), u.color, true);
                this.UIDraw.rect(swatchPos, new Vector(12, 12), '#00000000', false, true, 1, '#FFFFFFFF');
                const name = u.self ? `${u.name} (you)` : u.name;
                this.UIDraw.text(name, new Vector(base.x + 30, rowY + 8), '#FFFFFF', 0, 15, { align: 'left', baseline: 'middle', font: 'monospace' });

                const tx = base.x + ui.menu.size.x - 74;
                const tpos = new Vector(tx, rowY - 3);
                const tsize = new Vector(62, 18);
                const active = (ui.trackedCursorId === u.id);
                this.UIDraw.rect(tpos, tsize, active ? '#2F7A2FFF' : '#444444FF', true);
                this.UIDraw.rect(tpos, tsize, '#00000000', false, true, 1, '#FFFFFFAA');
                this.UIDraw.text(active ? 'TRACK' : 'Track', new Vector(tpos.x + tsize.x / 2, tpos.y + 12), '#FFFFFF', 0, 14, { align: 'center', baseline: 'middle', font: 'monospace' });
            }
        }

        // side tab toggle (always visible)
        ui.toggleBtn.draw(this.UIDraw);
        const tPos = ui.toggleBtn.pos;
        const tSize = ui.toggleBtn.size;
        const arrow = ui.visible ? '▶' : '◀';
        this.UIDraw.text(arrow, new Vector(tPos.x + tSize.x / 2, tPos.y + tSize.y / 2 + 5), '#FFFFFF', 0, 16, { align: 'center', baseline: 'middle', font: 'monospace' });
    }



    // Removes a scene from the map
    removeScene(name) {
        if (this.scenes.has(name)) {
            if (this.sceneName === name) {
                this.currentScene = null;
                this.sceneName = null;
            }
            this.scenes.delete(name);
        }
    }

    update(delta) {
        this.runtime += delta;
        this.delta = delta;
        let shouldBlockSceneInput = false;

        // Let overlay UI process input first (more stable hit behavior for this menu).
        if (this.mouse) this.mouse.uiBlockedByOverlay = false;

        if (this.multiplayerUI) {
            this._layoutMultiplayerUI();
            if (this.multiplayerUI.toggleBtn) this.multiplayerUI.toggleBtn.update(delta);
            if (this.multiplayerUI.visible && this.multiplayerUI.menu) this.multiplayerUI.menu.update(delta);
            // Handle track-toggle clicks for current user list.
            try {
                const ui = this.multiplayerUI;
                if (ui.visible && this.mouse && this.mouse.pressed && this.mouse.pressed('left')) {
                    const users = this._getMultiplayerUsers();
                    const base = ui.menu.pos;
                    for (let i = 0; i < users.length; i++) {
                        const u = users[i];
                        const rowY = base.y + 176 + i * 24;
                        const tx = base.x + ui.menu.size.x - 74;
                        const tpos = new Vector(tx, rowY - 3);
                        const tsize = new Vector(62, 18);
                        if (this._pointInRect(this.mouse.pos, tpos, tsize)) {
                            ui.trackedCursorId = (ui.trackedCursorId === u.id) ? null : u.id;
                            try { this.mouse.pause(0.12); } catch (e) {}
                            break;
                        }
                    }
                }
            } catch (e) {}
        }

        // Precompute overlay blocking before scene update so scene tools don't receive
        // clicks that are meant for the multiplayer UI.
        if (this.multiplayerUI) {
            try {
                const ui = this.multiplayerUI;
                const overPanel = ui.visible && this._pointInRect(this.mouse.pos, ui.menu.pos, ui.menu.size);
                const overToggle = this._pointInRect(this.mouse.pos, ui.toggleBtn.pos, ui.toggleBtn.size);
                const typing = !!((ui.input && ui.input.focused) || (ui.nameInput && ui.nameInput.focused));
                const latched = Number(ui.consumeInputFrames || 0) > 0;
                shouldBlockSceneInput = !!(overPanel || overToggle || typing || latched);
            } catch (e) {
                shouldBlockSceneInput = false;
            }
        }

        if (this.mouse) this.mouse.uiBlockedByOverlay = shouldBlockSceneInput;

        if (this.currentScene) {
            this.currentScene.update(delta);
        }

        // If tracking is enabled, follow the selected remote camera.
        this._applyTrackedCursorCamera();

        // Reset block after scene update.
        if (this.mouse) this.mouse.uiBlockedByOverlay = false;

        // Decrement overlay input latch after scene update so current-frame clicks are consumed.
        if (this.multiplayerUI && Number(this.multiplayerUI.consumeInputFrames || 0) > 0) {
            this.multiplayerUI.consumeInputFrames = Math.max(0, Number(this.multiplayerUI.consumeInputFrames || 0) - 1);
        }
    }

    draw() {
        let ctx = this.program.getCtx('base');
        let ctx2 = this.program.getCtx('UI');
        this.Draw.useCtx(ctx);
        this.UIDraw.useCtx(ctx2);
        if (this.currentScene && this.currentScene.draw) {
            this.currentScene.draw();
        }
        this._drawMultiplayerUI();
    }
}

class Program {
    constructor(aspectRatio = 16 / 9) {
        // === Base DOM Refs ===
        this.layerContainer = getID("layers");
        this.uiContainer = getID("ui");

        // === Timing ===
        this.lastTime = 0;
        this.aspectRatio = aspectRatio;

        // === Input ===
        // Pass container rect (full-screen); we will set offset so mouse coords map to canvas.
        this.mouse = new Mouse(this.uiContainer.getBoundingClientRect());
        this.size = new Vector(window.innerWidth, window.innerHeight);
        this.keys = new Keys();

        // === Layers ===
        this.layers = new Map();    // main layers
        this.uiLayers = new Map();  // UI layers

        // === Draw Helpers ===
        this.Draw = new Draw(() => this.getCtx("main")); // default draw target
        this.UIDraw = new Draw(() => this.getCtx("ui")); // separate draw for UI
        this.Draw.designSize = new Vector(mainWidth, mainheight);
        this.UIDraw.designSize = new Vector(mainWidth, mainheight);
        this.UIDraw.textScaleMode = 'output';

        // === Game/Application Logic ===
        this.game = new Game(this);

        this.attachEvents();
        this.loop(0);
    }

    // === Layers z-ordering ===
    updateZ() {
        let z = 0;
        this.layers.forEach(layer => {
            layer.canvas.style.zIndex = z++;
        });
        let uiZ = 100;
        this.uiLayers.forEach(layer => {
            if (layer.container) {
                layer.container.style.zIndex = uiZ++;
            } else if (layer.canvas) {
                layer.canvas.style.zIndex = uiZ++;
            }
        });
    }

    // Create and register a canvas layer. UI layers are interactive (pointer
    // events enabled) while non-UI layers have pointerEvents disabled.
    addLayer(name, isUI = false) {
        if (this.layers.has(name) || this.uiLayers.has(name)) return null;
        // For UI layers we create a positioned container <div> which holds a
        // canvas plus any HTML children. Non-UI layers remain a bare canvas.
        let ctx = null;
        if (isUI) {
            const container = document.createElement('div');
            container.id = name + '-container';
            container.classList.add('layer-container');
            container.style.position = 'absolute';
            container.style.overflow = 'visible';
            container.style.pointerEvents = 'none';

            const canvas = document.createElement('canvas');
            canvas.id = name;
            canvas.classList.add('layer');
            canvas.addEventListener('contextmenu', e => e.preventDefault());
            // initial size (will be updated on resize)
            canvas.width = this.size.x;
            canvas.height = this.size.y;
            canvas.style.position = 'absolute';
            // keep canvas non-interactive by default so HTML children receive pointer events
            canvas.style.pointerEvents = 'none';
            // UI text should use browser text AA, not nearest-neighbor pixel scaling.
            canvas.style.imageRendering = 'auto';

            container.appendChild(canvas);
            this.uiContainer.appendChild(container);

            ctx = canvas.getContext('2d', { willReadFrequently: true });
            const layerData = { canvas, ctx, container, visible: true };
            this.uiLayers.set(name, layerData);
        } else {
            const container = this.layerContainer;
            const canvas = document.createElement('canvas');
            canvas.id = name;
            canvas.classList.add('layer');
            canvas.addEventListener('contextmenu', e => e.preventDefault());

            // Set initial pixel size to current program size (will be updated on resize)
            canvas.width = this.size.x;
            canvas.height = this.size.y;

            canvas.style.position = 'absolute';
            canvas.style.pointerEvents = 'none';

            container.appendChild(canvas);

            ctx = canvas.getContext('2d', { willReadFrequently: true });
            const layerData = { canvas, ctx, visible: true };
            this.layers.set(name, layerData);
        }
        this.updateZ();
        return ctx;
    }

    removeLayer(name) {
        const layer = this.layers.get(name) || this.uiLayers.get(name);
        if (!layer) return;
        // If UI layer has a container, remove the whole container; otherwise remove the canvas
        if (layer.container && layer.container.parentElement) {
            layer.container.parentElement.removeChild(layer.container);
        } else if (layer.canvas && layer.canvas.parentElement) {
            layer.canvas.parentElement.removeChild(layer.canvas);
        }
        this.layers.delete(name);
        this.uiLayers.delete(name);
        this.updateZ();
    }

    getCtx(name) {
        if (this.layers.has(name)) return this.layers.get(name).ctx;
        if (this.uiLayers.has(name)) return this.uiLayers.get(name).ctx;
        return null;
    }

    attachEvents() {
        this.resizeCanvas();

        // Prevent context menu inside #screen
        const screen = getID("screen");
        screen.addEventListener(
            "contextmenu",
            e => {
                e.preventDefault();
                e.stopPropagation();
            },
            { capture: true }
        );

        // Prevent mobile page scroll when touching the canvas area
        [this.layerContainer, this.uiContainer].forEach(container => {
            container.addEventListener("touchmove", e => {
                // if you want certain UI elements to allow scrolling, guard here
                e.preventDefault();
            }, { passive: false });
        });

        // For any new canvases added dynamically
        const observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                mutation.addedNodes.forEach(node => {
                    if (!node || !node.tagName) return;
                    const tag = node.tagName.toUpperCase();
                    if (tag === 'CANVAS') {
                        node.addEventListener('contextmenu', e => e.preventDefault());
                        node.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
                    } else if (tag === 'DIV') {
                        // if a container div was added, wire up any canvases it contains
                        const canvases = node.getElementsByTagName && node.getElementsByTagName('canvas');
                        if (canvases && canvases.length) {
                            Array.from(canvases).forEach(c => {
                                c.addEventListener('contextmenu', e => e.preventDefault());
                                c.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
                            });
                        }
                    }
                });
            }
        });
        observer.observe(this.layerContainer, { childList: true });
        observer.observe(this.uiContainer, { childList: true });

        addEvent("window", null, "resize", () => this.resizeCanvas());
        addEvent("window", null, "orientationchange", () => this.resizeCanvas());
    }

    // Recompute logical canvas size while preserving aspect ratio. This
    // updates each canvas pixel size and CSS positioning so drawing scales
    // cleanly across different window sizes.
    resizeCanvas() {
        const targetWidth = window.innerWidth;
        const targetHeight = window.innerHeight;

        // Lock aspect ratio
        let width = targetWidth;
        let height = Math.floor(width / this.aspectRatio);
        if (height > targetHeight) {
            height = targetHeight;
            width = Math.floor(height * this.aspectRatio);
        }

        // logical / pixel size of the game area
        this.size = new Vector(width, height);

        // keep whatever scaling system you had (mainWidth/mainheight globals)
        this.mouse.canvasScale.y = height / mainheight;
        this.mouse.canvasScale.x = width / mainWidth;
        this.Draw.Scale.y = height / mainheight;
        this.Draw.Scale.x = width / mainWidth;
        this.UIDraw.Scale.y = height / mainheight;
        this.UIDraw.Scale.x = width / mainWidth;

        // compute the top-left position (in CSS pixels) where the canvas will sit
        const canvasLeft = Math.round((targetWidth - width) / 2);
        const canvasTop = Math.round((targetHeight - height) / 2);

        // Resize and position every canvas (pixel size + CSS size + left/top)
        this.layers.forEach(layer => {
            layer.canvas.width = width;
            layer.canvas.height = height;
            layer.canvas.style.width = width + "px";   // CSS pixels -> ensures 1:1 mapping
            layer.canvas.style.height = height + "px";
            layer.canvas.style.left = canvasLeft + "px";
            layer.canvas.style.top = canvasTop + "px";
        });

        this.uiLayers.forEach(layer => {
            if (layer.canvas) {
                layer.canvas.width = width;
                layer.canvas.height = height;
                layer.canvas.style.width = width + "px";
                layer.canvas.style.height = height + "px";
                // position canvas inside the container at 0,0 and position the container in the page
                layer.canvas.style.left = '0px';
                layer.canvas.style.top = '0px';
            }
            if (layer.container) {
                layer.container.style.width = width + 'px';
                layer.container.style.height = height + 'px';
                layer.container.style.left = canvasLeft + 'px';
                layer.container.style.top = canvasTop + 'px';
            }
        });

        // Keep containers full-screen so they can catch events / be used for rect lookups
        if (this.uiContainer) {
            this.uiContainer.style.width = targetWidth + "px";
            this.uiContainer.style.height = targetHeight + "px";
        }
        if (this.layerContainer) {
            this.layerContainer.style.width = targetWidth + "px";
            this.layerContainer.style.height = targetHeight + "px";
        }

        this.mouse.setOffset(new Vector(-canvasLeft, -canvasTop));
        this.mouse.updateRect(this.uiContainer.getBoundingClientRect());
    }

    // === Main Loop ===
    // Central requestAnimationFrame loop that updates input, advances
    // simulation (variable-step) and renders. Keeps delta clamped to avoid
    // large jumps on tab-switch or slow frames.
    loop(time) {
        let delta = (time - this.lastTime) / 1000;
        if (delta > 0.1) delta = 0.1;
        this.lastTime = time;
        this.update(delta);
        this.draw();

        requestAnimationFrame(this.loop.bind(this));
    }

    update(delta) {
        this.game.update(delta);
    }

    draw() {
        this.game.draw(this.Draw, this.UIDraw);
    }
}

new Program();
