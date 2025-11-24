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
import createHButton from './js/htmlElements/createHButton.js';
import createHDiv from './js/htmlElements/createHDiv.js';
import createHInput from './js/htmlElements/createHInput.js';
import createHLabel from './js/htmlElements/createHLabel.js';


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
        await this.loadScene('title');
        this.switchScene('title');
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

    // Create a small DOM-based UI for creating/joining multiplayer rooms.
    // The UI lives outside the canvas and forwards room actions to ServerManager.
    createMultiplayerUI() {
        this.saver.remove('instance');
        console.log('Creating multiplayer UI');

        // --- Container panel (bottom-right) ---
        const panelSize = new Vector(300, 130);
        const margin = 20; // margin from screen edge
        // Position relative to a 1920x1080 logical canvas: bottom-right origin
        const panelPos = new Vector(1920 - margin - panelSize.x, 1080 - margin - panelSize.y);
        const panel = createHDiv(
            null,
            panelPos,
            panelSize,
            '#00000033',
            {
                borderRadius: '8px',
                border: '1px solid #FFFFFF44',
                backdropFilter: 'blur(4px)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-around',
                alignItems: 'center',
                color: '#fff',
                padding: '8px',
                fontFamily: 'sans-serif'
            }
        );

        // Child elements keep the same offsets relative to the panel's top-left
        // Child positions are local offsets inside the panel (logical coordinates)
        const label = createHLabel(null, new Vector(10, 10), new Vector(80, 30), 'Room ID:', { color:'#fff', fontSize:14, textAlign:'center' }, panel);
        const input = createHInput(null, new Vector(100, 10), new Vector(200, 30), 'text', { background:'#222', color:'#fff', border:'1px solid #555', borderRadius:'4px', textAlign:'center' }, panel);
        const statusLabel = createHLabel(null, new Vector(10, 120), new Vector(300,20), 'Status: Idle', { color:'#ddd', fontSize:14, textAlign:'left' }, panel);

        const createBtn = createHButton(null, new Vector(10, 60), new Vector(130, 40), '#333', { color:'#fff', borderRadius:'6px', fontSize:14, border:'1px solid #777' }, panel);
            createBtn.textContent = 'Create';

        const joinBtn = createHButton(null, new Vector(170, 60), new Vector(130, 40), '#333', { color:'#fff', borderRadius:'6px', fontSize:14, border:'1px solid #777' }, panel);
        joinBtn.textContent = 'Join';

        const updateStatus = (state) => {
            if (!state) return;
            const p1Ready = state.p1x !== undefined && state.p1y !== undefined;
            const p2Ready = state.p2x !== undefined && state.p2y !== undefined;

            if (p1Ready && p2Ready) statusLabel.textContent = 'Status: Connected!';
            else if (p1Ready || p2Ready) statusLabel.textContent = 'Status: Waiting for other player...';
        };

        // --- Button logic ---
        createBtn.addEventListener('click', async () => {
            const roomId = await this.server.createRoom();
            input.value = roomId;
            statusLabel.textContent = 'Status: Room created! Waiting for player 2...';
            console.log('Room created:', roomId);
            this.enableMultiplayer.emit('p1');

            // Attach signal handler for this scene instance
            this.server.on('state', (state) => {
                this.remoteStateSignal.emit(state,'p1'); 
                this.playerCount = 2;
                updateStatus(state);
            });
        });

        joinBtn.addEventListener('click', async () => {
            const roomId = input.value.trim();
            if (!roomId) {
                statusLabel.textContent = 'Status: Enter room ID!';
                return;
            }

            await this.server.joinRoom(roomId);
            statusLabel.textContent = 'Status: Joined room. Waiting for sync...';
            console.log('Joined room:', roomId);
            this.enableMultiplayer.emit('p2');

            const snapshot = await this.server.fetch('state');
            if (snapshot) this.remoteStateSignal.emit(snapshot);

            this.server.on('state', (state) => {
                updateStatus(state);
                this.playerCount = 2;
                this.remoteStateSignal.emit(state,'p2'); // emit for this scene
            });
        });

        this.uiElements = { panel, label, input, createBtn, joinBtn, statusLabel };

        // Start coordinated sweeper attempts periodically (every 30s).
        // Each attempt will try to claim a stale room and perform required steps (5 steps of 5s each by default).
        try {
            if (this._coordinatedSweepInterval) clearInterval(this._coordinatedSweepInterval);
            this._coordinatedSweepInterval = setInterval(() => {
                // Indicate we're attempting a coordinated sweep (even if no candidate is found)
                console.log('[Script] coordinated sweeper tick - attempting sweep');
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
        if (this.currentScene) {
            this.currentScene.update(delta);
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
        this.mouse.update(delta);
        this.keys.update(delta);
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
