import { ref, set, update, onValue, get } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

export class RoomManager {
    constructor(db) {
        this.db = db;
        this.roomId = null;
        this.playerId = null;
        this.lastSentState = {};
    }

    // Create a new room as player 1
    async createRoom() {
        this.roomId = Math.random().toString(36).substring(2, 8);
        this.playerId = "p1";
        await set(ref(this.db, `rooms/${this.roomId}`), {
            players: { p1: { connected: true }, p2: { connected: false } }
        });
        return this.roomId;
    }

    // Join an existing room as player 2
    async joinRoom(roomId) {
        this.roomId = roomId;
        this.playerId = "p2";
        await update(ref(this.db, `rooms/${roomId}/players/p2`), { connected: true });
    }

    // Listen for real-time state updates
    listenForUpdates(callback) {
        if (!this.roomId) throw new Error('No roomId set');
        onValue(ref(this.db, `rooms/${this.roomId}/state`), (snapshot) => {
            const state = snapshot.val();
            if (state) callback(state);
        });
    }

    // Send state, only updating keys that are defined to avoid overwriting
    sendState(data) {
        if (!this.roomId) return;
        const safeData = {};
        for (const key in data) {
            if (data[key] !== undefined && data[key] !== null) {
                safeData[key] = data[key];
            }
        }
        if (Object.keys(safeData).length > 0) {
            update(ref(this.db, `rooms/${this.roomId}/state`), safeData);
            this.lastSentState = safeData;
        }
    }

    // Fetch current state once (for joining players)
    async getCurrentState() {
        if (!this.roomId) return null;
        const snapshot = await get(ref(this.db, `rooms/${this.roomId}/state`));
        return snapshot.val();
    }
}
