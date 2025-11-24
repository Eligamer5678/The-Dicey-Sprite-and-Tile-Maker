import Timer from '../js/Timer.js';

export default class Scene {
    constructor(name, Draw, UIDraw, mouse, keys, saver, switchScene, loadScene, preloadScene, removeScene, RSS, EM, server, playerCount=1) { // RSS: remoteStateSignal, EM: enableMultiplayer (signal)
        this.name = name;
        this.isReady = false;
        this.isPreloaded = false;
        this.Draw = Draw;
        this.UIDraw = UIDraw;
        this.saver = saver;
        this.mouse = mouse;
        this.playerCount = playerCount;
        this.keys = keys;
        this.switchScene = switchScene;
        this.loadScene = loadScene;
        this.preloadScene = preloadScene;
        this.removeScene = removeScene;
        this.RSS = RSS; // remote state signal
        this.EM = EM; // enable multiplayer signal
        this.server = server; // ServerManager instance
        this.elements = new Map()

        // Tick / multiplayer defaults
        this.tickRate = 1000 / 60; // ms per tick (default 60hz)
        this.tickCount = 0;
        this.tickAccumulator = 0;
        this.lastStateSend = 0;
        this.paused = false;
        this.frameCount = 0;
    }

    /**
     * Called once, asynchronously, to preload assets (images, music, etc). 
     * Return a Promise.
     */
    async onPreload(resources=null) {

    }

    /**
     * Called once when swapped to for the first time, to set up scene variables.
     */
    onReady() {

    }

    /**
     * Called every time this scene is switched to (after onReady).
     * Returns a Map of resources to keep cached (key: resource name, value: resource type).
     */
    onSwitchTo() {
        // Default behaviour: disconnect any RSS handler, clear draw layers and return packaged resources.
        if (this.RSS && this._rssHandler && typeof this.RSS.disconnect === 'function') {
            try { this.RSS.disconnect(this._rssHandler); } catch (e) { /* ignore */ }
        }
        // allow scenes to cleanup debug signals
        if (typeof this.disconnectDebug === 'function') this.disconnectDebug();
        if (this.Draw && typeof this.Draw.clear === 'function') this.Draw.clear();
        if (this.UIDraw && typeof this.UIDraw.clear === 'function') this.UIDraw.clear();
        return this.packResources ? this.packResources() : null;
    }

    /**
     * Called every time this scene is switched away from.
     */
    onSwitchFrom(resources) {
        // Default: try to unpack resources and reconnect RSS
        if (this.unpackResources) this.unpackResources(resources);
        if (this.RSS && typeof this.RSS.connect === 'function') {
            this._rssHandler = (state) => { if (this.applyRemoteState) this.applyRemoteState(state); };
            this.RSS.connect(this._rssHandler);
        }
    }

    
    /**
     * Packs local resources into a Map to be transferred between scenes.
     * Child scenes can override to add scene-specific resources.
     */
    packResources() {
        const resources = new Map();
        if (this.settings) resources.set('settings', this.settings);
        if (this.BackgroundImages) resources.set('backgrounds', this.BackgroundImages);
        if (this.SpriteImages) resources.set('sprites', this.SpriteImages);
        if (this.soundGuy) resources.set('soundguy', this.soundGuy);
        if (this.musician) resources.set('musician', this.musician);
        if (this.conductor) resources.set('conductor', this.conductor);
        if (this.narrator) resources.set('narrator', this.narrator);
        if (this.playerId) resources.set('id', this.playerId);
        return resources;
    }

    /**
     * Unpack resources provided from previous scene. Safe to call with null.
     */
    unpackResources(resources){
        if (!resources) return false;
        if (!(resources instanceof Map)) return false;
        for (const [key, value] of resources.entries()) {
            switch (key) {
                case 'settings': this.settings = value; break;
                case 'backgrounds': this.BackgroundImages = value; break;
                case 'sprites': this.SpriteImages = value; break;
                case 'soundguy': this.soundGuy = value; break;
                case 'musician': this.musician = value; break;
                case 'conductor': this.conductor = value; break;
                case 'narrator': this.narrator = value; break;
                case 'id': this.playerId = value; break;
                default: console.warn(`Unknown resource key: ${key}`);
            }
        }
        return true;
    }

    /**
     * Sends local player state to the server (throttled by tickRate). Child scenes should populate diff.
     */
    sendState(){
        if (this.server) {
            if (!this.lastStateSend) this.lastStateSend = 0;
            const now = performance.now();
            if (now - this.lastStateSend >= this.tickRate) {
                const diff = {};
                // Scenes should add custom state into diff before default fields are added.

                if (this.playerId) diff[this.playerId + 'paused'] = this.paused;
                diff[this.playerId + 'scene'] = { scene: this.name, time: now };

                if (Object.keys(diff).length > 0) {
                    try { this.server.sendDiff(diff); } catch (e) { console.warn('sendState failed', e); }
                }

                this.lastStateSend = now;
            }
        }
    }

    /**
     * Attach debug console commands to manipulate game state.
     * 
     * For example: window.Debug.createSignal('Hello',()=>{console.log(`Hello!`);});
     * Typing "Hello()" in the debug console will trigger the callback, in this case 'Hello!'.
     * 
     * Warning: commands do not persist across scene switches.
     * 
     * Ensure to disconnect signals that require local data (i.e. this.variable) with this.disconnectDebug(), and reconnect with this.connectDebug().
     */
    connectDebug(){
        // Add custom debug signals here



        // Clear server rooms
        window.Debug.createSignal('clearserver',()=>{this.server.clearAllRooms()})
        
        // Log memory usage over 50 frames
        window.Debug.createSignal('memory',()=>{
            let count = 0;
            function logMemory() {
                if (window.performance && window.performance.memory) {
                    const mem = window.performance.memory;
                    const usedMB = mem.usedJSHeapSize / 1048576;
                    const totalMB = mem.totalJSHeapSize / 1048576;
                    console.log(`Frame ${count+1}: Memory used: ${usedMB.toFixed(2)} MB / ${totalMB.toFixed(2)} MB`);
                } else {
                    console.log('performance.memory API not available in this browser.');
                }
                count++;
                if (count < 50) {
                    requestAnimationFrame(logMemory);
                }
            }
            logMemory();
        });
    }

    /** 
     * Disconnect debug console commands 
     * */
    disconnectDebug(){

    }

    /**
     * Apply incoming remote state; default will advance ticks to match remote.
     */
    applyRemoteState(state){
        if (!state) return;
        const remoteId = this.playerId === 'p1' ? 'p2' : 'p1';
        this.applyTick(remoteId, state);
        if (state[remoteId + 'scene']) {
            if (state[remoteId + 'scene'].scene !== this.name && this.playerId !== 'p1') {
                this.switchScene(state[remoteId + 'scene'].scene);
            }
        }
    }

    applyTick(remoteId, state){
        const tickKey = remoteId + 'tick';
        if (!(tickKey in state)) return;
        while (state[tickKey] > this.tickCount) this.tick();
    }


    /**
     * Default music condition hook.
     */
    setConditions(){
        // override in scenes
    }

    /**
     * Create timers used by the scene.
     */
    createTimers(){
        this.sessionTimer = new Timer('stopwatch');
        this.sessionTimer.start();
    }

    updateTimers(delta){
        if (this.paused) return;
        if (this.sessionTimer && typeof this.sessionTimer.update === 'function') this.sessionTimer.update(delta);
    }

    /**
     * Default tick handler. Calls `sceneTick` if defined by the scene.
     */
    tick(){
        this.tickCount++;
        const tickDelta = this.tickRate / 1000;
        this.updateTimers(tickDelta);
        if (typeof this.sceneTick === 'function') this.sceneTick(tickDelta);
    }

    pause(){ this.paused = true; if (this.sessionTimer) this.sessionTimer.pause(); }
    unpause(){ this.paused = false; if (this.sessionTimer) this.sessionTimer.unpause(); }
    draw() {
        if(!this.isReady) return;
        this.Draw.background('#FFFFFF')

    }

    /** 
     * Creates the game's UI elements 
     */
    createUI(){
        // just a reminder on doing this for my future self or others
        // try {
        //     const panelSize = new Vector(300, 130);
        //     const margin = 20;
        //     const panelPos = new Vector(1920 - margin - panelSize.x, 1080 - margin - panelSize.y);
        //     const panel = createHDiv(
        //         null,
        //         panelPos,
        //         panelSize,
        //         '#00000033',
        //         {
        //             borderRadius: '8px',
        //             border: '1px solid #FFFFFF44',
        //             backdropFilter: 'blur(4px)',
        //             display: 'flex',
        //             flexDirection: 'column',
        //             justifyContent: 'space-around',
        //             alignItems: 'center',
        //             color: '#fff',
        //             padding: '8px',
        //             fontFamily: 'sans-serif'
        //         },
        //         'UI' // attach to UI layer container
        //     );

        //     const createBtn = createHButton(null, new Vector(10, 60), new Vector(130, 40), '#333', { color: '#fff', borderRadius: '6px', fontSize: 14, border: '1px solid #777' }, panel);
        //     createBtn.textContent = 'Create';
        //     createBtn.addEventListener('click', () => {
        //         console.log('[Title] Create button clicked');
        //     });

        //     const joinBtn = createHButton(null, new Vector(170, 60), new Vector(130, 40), '#333', { color: '#fff', borderRadius: '6px', fontSize: 14, border: '1px solid #777' }, panel);
        //     joinBtn.textContent = 'Join';
        //     joinBtn.addEventListener('click', () => {
        //         console.log('[Title] Join button clicked');
        //     });

        //     this.uiPanel = { panel, createBtn, joinBtn };
        // } catch (e) {
        //     console.warn('createUI failed:', e);
        // }
    }
    
    /** 
     * Used to run ticks.
     * Don't put update logic here, implement `sceneTick(delta)` instead.
     * (aside from UI updates)
     */
    update(delta) {
        if (!this.isReady) return;
        this.tickAccumulator += delta * 1000; // convert to ms
        // Mouse mask reset (corrects layered UI input issues)
        this.mouse.setMask(0);
        // Update UI elements
        let sortedElements = [...this.elements.values()].sort((a, b) => b.layer - a.layer);
        for (const elm of sortedElements) {
            elm.update(delta);
        }
        while (this.tickAccumulator >= this.tickRate) {
            if(!this.paused){
                this.tick();
            }
            this.tickAccumulator -= this.tickRate;
        }
        this.frameCount+=1;
    }
}