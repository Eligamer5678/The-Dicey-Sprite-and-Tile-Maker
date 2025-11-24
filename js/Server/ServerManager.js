import { ref, set, update, onValue, get } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";
import Signal from "../Signal.js";

export default class ServerManager {
    async clearAllRooms() {
        try {
            await set(ref(this.db, this.basePath), null);
            this.signals.sent.emit('clearAllRooms', null);
        } catch (e) {
            this.signals.error.emit(e);
        }
    }
    constructor(db, basePath = "rooms") {
        this.db = db;
        this.basePath = basePath;
        this.roomId = null;
        this.data = {};
        this.listeners = new Map();

        // help remove stale rooms
        this.tick = 0;
        this._tickInterval = null;
        this.sweepValue = 0;
        this.sweepId = null;

        this.signals = {
            connected: new Signal(),
            disconnected: new Signal(),
            updated: new Signal(),
            error: new Signal(),
            sent: new Signal(),
            fetched: new Signal(),
        };
    }

    async createRoom() {
        this.roomId = Math.random().toString(36).substring(2, 8);
        this.playerId = "p1";
        await set(ref(this.db, `rooms/${this.roomId}`), {
            players: { p1: { connected: true }, p2: { connected: false } },
            lastActive: Date.now(),
            tickCounter: 0
        });
        console.log(`[ServerManager] created room ${this.roomId}`);
        return this.roomId;
    }

    async joinRoom(roomId) {
        this.roomId = roomId;
        this.playerId = "p2";
        await update(ref(this.db, `rooms/${roomId}/players/p2`), { connected: true });
        try {
            await update(ref(this.db, `rooms/${roomId}`), { lastActive: Date.now(), tickCounter: 0 });
            console.log(`[ServerManager] joined room ${roomId}`);
        } catch (e) { this.signals.error.emit(e); }
    }

    setRoom(roomId) {
        this.roomId = roomId;
    }

    _ensureRoom(id=null) {
        // If an explicit id is provided, the caller intends to operate on that id
        // (for example sendDiff(customID) writes to another room). In that case
        // don't require this.roomId to be set. Otherwise require that this.roomId
        // is present before performing room-relative operations.
        if (id !== null) return true;
        if (!this.roomId) {
            const err = new Error("ServerManager: No active room set");
            this.signals.error.emit(err);
            return false;
        }
        return true;
    }

    _path(path = "") {
        if (!this._ensureRoom()) throw new Error("ServerManager: No active room set");
        return `${this.basePath}/${this.roomId}/${path}`;
    }

    _getPathObj(path, createMissing = false) {
        const keys = path.split("/");
        let obj = this.data;
        for (let i = 0; i < keys.length - 1; i++) {
            if (!obj[keys[i]]) {
                if (createMissing) obj[keys[i]] = {};
                else return undefined;
            }
            obj = obj[keys[i]];
        }
        return { obj, lastKey: keys[keys.length - 1] };
    }

    get(path, defaultValue = null) {
        if (!this._ensureRoom()) return defaultValue;
        const res = this._getPathObj(path, false);
        if (!res) return defaultValue;
        const { obj, lastKey } = res;
        return obj.hasOwnProperty(lastKey) ? obj[lastKey] : defaultValue;
    }

    set(path, value, syncNow = true) {
        if (!this._ensureRoom()) return;
        const { obj, lastKey } = this._getPathObj(path, true);
        obj[lastKey] = value;
        if (syncNow) this.syncSet(path, value);
    }

    update(path, valueObj) {
        if (!this._ensureRoom()) return;
        const { obj, lastKey } = this._getPathObj(path, true);
        obj[lastKey] = { ...(obj[lastKey] || {}), ...valueObj };
        this.syncUpdate(path, valueObj);
    }

    remove(path, syncNow = true) {
        if (!this._ensureRoom()) return;
        const res = this._getPathObj(path, false);
        if (!res) return;
        const { obj, lastKey } = res;
        delete obj[lastKey];
        if (syncNow) this.syncRemove(path);
    }

    async syncSet(path, value) {
        if (!this._ensureRoom()) return;
        try {
            await set(ref(this.db, this._path(path)), value);
            this.signals.sent.emit(path, value);
        } catch (e) {
            this.signals.error.emit(e);
        }
    }

    async syncUpdate(path, valueObj) {
        if (!this._ensureRoom()) return;
        try {
            await update(ref(this.db, this._path(path)), valueObj);
            this.signals.sent.emit(path, valueObj);
        } catch (e) {
            this.signals.error.emit(e);
        }
    }

    async syncRemove(path) {
        if (!this._ensureRoom()) return;
        try {
            await set(ref(this.db, this._path(path)), null);
            this.signals.sent.emit(path, null);
        } catch (e) {
            this.signals.error.emit(e);
        }
    }

    async fetch(path = "") {
        if (!this._ensureRoom()) return null;
        try {
            const snapshot = await get(ref(this.db, this._path(path)));
            if (snapshot.exists()) {
                const val = snapshot.val();
                if (path) this.set(path, val, false);
                else this.data = val;
                this.signals.fetched.emit(path, val);
                return val;
            }
            return null;
        } catch (e) {
            this.signals.error.emit(e);
            return null;
        }
    }

    on(path, callback) {
        if (!this._ensureRoom()) return;
        const fullPath = this._path(path);
        const dbRef = ref(this.db, fullPath);
        const listener = onValue(dbRef, (snapshot) => {
            const val = snapshot.val();
            this.set(path, val, false);
            callback(val);
            this.signals.updated.emit(path, val);
        });
        // onValue returns an unsubscribe function in modern SDKs; store whatever it returns
        this.listeners.set(fullPath, listener);
        this.signals.connected.emit(path);
    }

    off(path) {
        if (!this._ensureRoom()) return;
        const fullPath = this._path(path);
        const dbRef = ref(this.db, fullPath);
        off(dbRef);
        this.listeners.delete(fullPath);
        this.signals.disconnected.emit(path);
    }

    async sendDiff(diffObj,customID = null) {
        if(customID !== null){
            if (!this._ensureRoom(customID)) return;
            try {
                await update(ref(this.db,`${this.basePath}/${customID}`), diffObj);
            } catch (e) {
                this.signals.error.emit(e);
            }
        }else{
            if (!this._ensureRoom()) return;
            try {
                await update(ref(this.db, this._path("state")), diffObj);
                this.signals.sent.emit("state", diffObj);
            } catch (e) {
                this.signals.error.emit(e);
            }
        }
    }

    // start a simple tick incrementing every intervalMs (default 1s)
    startTick(intervalMs = 1000) {
        if (this._tickInterval) return;
        this._tickInterval = setInterval(() => {
            this.tick++;
            // If we have an active room, bump its lastActive and update the room tickCounter so sweepers can see activity
            if (this.roomId) {
                try {
                    // Always reset the room tickCounter to 0 from active clients (heartbeat)
                    update(ref(this.db, this._path('')), { lastActive: Date.now(), tickCounter: 0 }).catch(()=>{});
                    console.debug(`[ServerManager] heartbeat room=${this.roomId} tick=${this.tick}`);
                } catch (e) {
                    // ignore errors when no room set or update fails
                }
            }
        }, intervalMs);
    }

    stopTick() {
        if (this._tickInterval) {
            clearInterval(this._tickInterval);
            this._tickInterval = null;
        }
    }

    // delete a random room (debug helper). Returns the roomId removed or null.
    async deleteRandomRoom() {
        try {
            const rootRef = ref(this.db, this.basePath);
            const snapshot = await get(rootRef);
            if (!snapshot.exists()) return null;
            const rooms = snapshot.val();
            const ids = Object.keys(rooms || {});
            if (ids.length === 0) return null;
            // pick a random room but avoid deleting our own active room
            let roomId = null;
            const maxTries = Math.max(1, ids.length);
            for (let i = 0; i < maxTries; i++) {
                const idx = Math.floor(Math.random() * ids.length);
                const cand = ids[idx];
                if (cand === this.roomId) continue; // never delete our own room
                roomId = cand;
                break;
            }
            if (!roomId) return null;
            console.log(`[ServerManager] deleteRandomRoom -> removing ${roomId}`);
            await set(ref(this.db, `${this.basePath}/${roomId}`), null);
            this.signals.cleanup && this.signals.cleanup.emit && this.signals.cleanup.emit(roomId);
            return roomId;
        } catch (e) {
            this.signals.error.emit(e);
            return null;
        }
    }

    // Attempt a coordinated sweep on a randomly chosen stale room.
    // The algorithm:
    // - pick a candidate room that is older than maxAgeMs and has no connected players
    // - try to claim it by writing a sweeper object { owner, counter, lastTick }
    // - then, for requiredCount iterations, wait stepMs, verify the room's tickCounter is 0
    //   and the sweeper.owner still equals this.clientId and sweeper.counter matches expectation
    // - increment sweeper.counter each successful step
    // - if we reach requiredCount without interruption, delete the room
    // - on any abort (active client appears, owner changed, or counter skip), clear sweeper and return
    async coordinatedSweepAttempt({ maxAgeMs = 10 * 60 * 1000, requiredCount = 10, stepMs = 5000, takeoverMs = 10 * 1000 } = {}) {
        console.log(`[ServerManager] coordinatedSweepAttempt invoked (maxAgeMs=${maxAgeMs}, requiredCount=${requiredCount}, stepMs=${stepMs})`);
        try {
            const rootRef = ref(this.db, this.basePath);
            const snap = await get(rootRef);
            if (!snap.exists()) return null;
            const rooms = snap.val();
            const ids = Object.keys(rooms || {});
            if (ids.length === 0) return null;

            // If we are not working on a candidate, pick one
            if(this.sweepId === null){
                console.log('[ServerManager] Finding candidate...')

                // pick a random candidate that is not our own room and appears stale
                const now = Date.now();
                let candidateId = null;
                for (let i = 0; i < ids.length; i++) {
                    const cand = ids[Math.floor(Math.random() * ids.length)];
                    if (cand === this.roomId) continue;
                    const room = rooms[cand] || {};
                    const last = room.lastActive || 0;
                    if ((now - last) <= maxAgeMs) continue;
                    candidateId = cand;
                    break;
                }
                if (!candidateId) return null;
                console.log(`[ServerManager] Found valid candidate=${candidateId}`);
                this.sweepId = candidateId;
                this.sweepValue = 0;
                return null; // don't update yet; updating here could conflict with others
            }
            console.log('[ServerManager] Incrementing sweep step on candidate: ', this.sweepId)

            // If we have a candidate, proceed with sweep attempt
            const candidate = rooms[this.sweepId];  // Get candidate room object
            if(candidate.tickCounter !== this.sweepValue){
                // Clients conflicting; try again
                console.log('[ServerManager] Sweep aborted: conflicting clients detected');
                this.sweepValue = 0;
                this.sweepId = null;
                return null;
            }
            const roomPath = `${this.basePath}/${this.sweepId}`;

            try {
                await update(ref(this.db, roomPath), { tickCounter: candidate.tickCounter + 1 }); // Increment tickCounter to show deleting activity
                console.log(`[ServerManager] incremented tickCounter on ${this.sweepId} -> ${candidate.tickCounter + 1}`);
            } catch (err) {
                console.warn('[ServerManager] failed to increment tickCounter', err);
            }
            this.sweepValue += 1;

            if(this.sweepValue < requiredCount){
                console.log('[ServerManager] Sweep step incremented, not done yet');
                return null; // not done yet
            }
            // From here, we have proved that there are not conflicting clients; proceed to delete
            console.log(`[ServerManager] Sweep successful; deleting room ${this.sweepId}`);
            await set(ref(this.db, roomPath), null);
            this.sweepId = null;
            this.sweepValue = 0;

        } catch (e) {
            this.signals.error.emit(e);
            return null;
        } finally {
            this._coordinatedSweepRunning = false;
        }
    }
}

