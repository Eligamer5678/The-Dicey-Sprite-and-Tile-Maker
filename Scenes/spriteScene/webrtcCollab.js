function nowTs() {
    return Date.now();
}

function randomId(prefix = 'id') {
    return `${prefix}_${nowTs().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function expandDiffMap(diffMap) {
    const out = {};
    if (!diffMap || typeof diffMap !== 'object') return out;

    const setDeep = (obj, path, value) => {
        const parts = String(path).split('/').filter(Boolean);
        if (!parts.length) return;
        let cur = obj;
        for (let i = 0; i < parts.length - 1; i++) {
            const k = parts[i];
            if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {};
            cur = cur[k];
        }
        cur[parts[parts.length - 1]] = value;
    };

    for (const [k, v] of Object.entries(diffMap)) {
        if (k.includes('/')) setDeep(out, k, v);
        else out[k] = v;
    }
    return out;
}

export class SpriteWebRTCCollabController {
    constructor(scene) {
        this.scene = scene;
        this.pc = null;
        this.channel = null;
        this.started = false;
        this.signalSeen = new Set();
        this.sentSignalIds = new Set();
        this._lastSignalPrune = 0;
        this._signalTtlMs = 2 * 60 * 1000;
        this._creatingOffer = false;
    }

    _getMyPeerId() {
        try {
            return (this.scene && this.scene.server && this.scene.server.playerId)
                || (this.scene && this.scene.playerId)
                || (this.scene && this.scene.clientId)
                || 'client';
        } catch (e) {
            return 'client';
        }
    }

    _getOtherPeerId() {
        const me = this._getMyPeerId();
        if (me === 'p1') return 'p2';
        if (me === 'p2') return 'p1';
        return null;
    }

    _isHost() {
        return this._getMyPeerId() === 'p1';
    }

    _canUseWebRTC() {
        return (typeof window !== 'undefined' && typeof window.RTCPeerConnection === 'function');
    }

    async start({ offer = null } = {}) {
        if (!this._canUseWebRTC()) return false;

        const shouldOffer = (typeof offer === 'boolean') ? offer : this._isHost();
        this.started = true;

        try {
            if (this.scene && typeof this.scene.configureCollabTransport === 'function') {
                // Handshake can flow via Firebase signals, but all data should go through WebRTC.
                this.scene.configureCollabTransport({ mode: 'webrtc', handshakeOnly: true });
            }
        } catch (e) { /* ignore */ }

        await this._ensurePeer(shouldOffer);
        if (shouldOffer) await this._createAndSendOffer();
        return true;
    }

    stop() {
        this.started = false;
        try {
            if (this.channel) {
                try { this.channel.close(); } catch (e) { /* ignore */ }
            }
        } catch (e) { /* ignore */ }
        try {
            if (this.pc) {
                try { this.pc.close(); } catch (e) { /* ignore */ }
            }
        } catch (e) { /* ignore */ }
        this.channel = null;
        this.pc = null;
        try {
            if (this.scene && typeof this.scene.configureCollabTransport === 'function') {
                this.scene.configureCollabTransport({ mode: 'firebase-diff', handshakeOnly: false });
            }
        } catch (e) { /* ignore */ }
    }

    async _ensurePeer(isOfferer = false) {
        if (this.pc) return this.pc;
        if (!this._canUseWebRTC()) return null;

        const pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });

        pc.onicecandidate = (event) => {
            try {
                if (!event || !event.candidate) return;
                this._sendSignal({ kind: 'ice', candidate: event.candidate });
            } catch (e) { /* ignore */ }
        };

        pc.onconnectionstatechange = () => {
            try {
                const st = pc.connectionState;
                if (st === 'failed' || st === 'disconnected' || st === 'closed') {
                    if (this.scene && this.scene.localState && this.scene.localState.collab) {
                        this.scene.localState.collab.webrtcReady = false;
                    }
                }
            } catch (e) { /* ignore */ }
        };

        if (isOfferer) {
            const ch = pc.createDataChannel('sprite-collab', { ordered: true });
            this._bindDataChannel(ch);
        } else {
            pc.ondatachannel = (event) => {
                if (event && event.channel) this._bindDataChannel(event.channel);
            };
        }

        this.pc = pc;
        return pc;
    }

    _bindDataChannel(channel) {
        this.channel = channel;
        this.channel.onopen = () => {
            try {
                if (this.scene && typeof this.scene.bindWebRTCCollab === 'function') {
                    // Data channel is open — enable full WebRTC transport (not handshake-only)
                    this.scene.bindWebRTCCollab((diff) => {
                        try {
                            if (!this.channel || this.channel.readyState !== 'open') return;
                            this.channel.send(JSON.stringify({ kind: 'diff', diff }));
                        } catch (e) { /* ignore */ }
                    }, { handshakeOnly: false });
                    try { console.debug && console.debug('[webrtcCollab] data channel open -> bindWebRTCCollab called'); } catch (e) {}
                }
                if (this.scene && this.scene.localState && this.scene.localState.collab) {
                    this.scene.localState.collab.webrtcReady = true;
                    this.scene.localState.collab.transportMode = 'webrtc';
                    // mark handshakeOnly=false so scene knows to send live diffs
                    this.scene.localState.collab.handshakeOnly = false;
                    try { console.debug && console.debug('[webrtcCollab] localState.collab updated', this.scene.localState.collab); } catch (e) {}
                }
                try {
                    // Provide the raw data channel to the scene so it can send chunked
                    // large payloads without going through the JSON-diff path.
                    if (this.scene && typeof this.scene._setWebRTCChannel === 'function') {
                        this.scene._setWebRTCChannel(this.channel);
                        try { console.debug && console.debug('[webrtcCollab] raw channel passed to scene'); } catch (e) {}
                    }
                } catch (e) {}
            } catch (e) { /* ignore */ }
        };

        this.channel.onerror = (ev) => {
            try {
                try { console.warn && console.warn('[webrtcCollab] data channel error', ev); } catch (e) {}
                if (this.scene && typeof this.scene._recoverCollabState === 'function') {
                    try { this.scene._recoverCollabState('dataChannelError'); } catch (e) {}
                }
            } catch (e) {}
        };

        this.channel.onclose = () => {
            try {
                if (this.scene && this.scene.localState && this.scene.localState.collab) {
                    this.scene.localState.collab.webrtcReady = false;
                }
                try {
                    if (this.scene && typeof this.scene._clearWebRTCChannel === 'function') {
                        this.scene._clearWebRTCChannel();
                    }
                    if (this.scene && typeof this.scene._recoverCollabState === 'function') {
                        try { this.scene._recoverCollabState('dataChannelClosed'); } catch (e) {}
                    }
                } catch (e) {}
            } catch (e) { /* ignore */ }
        };

        this.channel.onmessage = (event) => {
            try {
                if (!event || typeof event.data !== 'string') return;
                const msg = JSON.parse(event.data);
                if (!msg || typeof msg !== 'object') return;
                // Support both diff messages and chunked frame transfers.
                if (msg.kind === 'diff' && msg.diff) {
                    const expanded = expandDiffMap(msg.diff);
                    if (this.scene && typeof this.scene.applyRemoteState === 'function') {
                        this.scene.applyRemoteState(expanded);
                    }
                    return;
                }

                // Chunked frame transfer messages:
                // { kind: 'frameStart', id, anim, index, chunkCount, client, time }
                // { kind: 'frameChunk', id, seq, data }
                if (msg.kind === 'frameStart' && msg.id) {
                    try {
                        if (!this._incomingFrames) this._incomingFrames = {};
                        this._incomingFrames[msg.id] = { anim: msg.anim, index: msg.index, chunkCount: Number(msg.chunkCount) || 0, client: msg.client, time: msg.time, parts: [], received: 0 };
                    } catch (e) {}
                    return;
                }
                if (msg.kind === 'frameChunk' && msg.id) {
                    try {
                        if (!this._incomingFrames) return;
                        const buf = this._incomingFrames[msg.id];
                        if (!buf) return;
                        buf.parts[msg.seq | 0] = String(msg.data || '');
                        buf.received = (buf.received || 0) + 1;
                        // If we've received all chunks, assemble and apply
                        if (buf.received >= (buf.chunkCount || 0)) {
                            try {
                                const base64 = buf.parts.join('');
                                const dataUrl = 'data:image/png;base64,' + base64;
                                const id = msg.id;
                                const payload = { type: 'frameData', anim: String(buf.anim), index: Number.isFinite(Number(buf.index)) ? Number(buf.index) : null, dataUrl, client: buf.client, time: buf.time };
                                const expanded = expandDiffMap({ ['edits/' + id]: payload });
                                if (this.scene && typeof this.scene.applyRemoteState === 'function') {
                                    this.scene.applyRemoteState(expanded);
                                }
                            } catch (e) {}
                            delete this._incomingFrames[msg.id];
                        }
                    } catch (e) {}
                    return;
                }
            } catch (e) { /* ignore malformed data */ }
        };
    }

    async _createAndSendOffer() {
        if (!this.pc || this._creatingOffer) return;
        this._creatingOffer = true;
        try {
            const offer = await this.pc.createOffer();
            await this.pc.setLocalDescription(offer);
            this._sendSignal({ kind: 'offer', sdp: offer.sdp, sdpType: offer.type });
        } catch (e) {
            /* ignore */
        } finally {
            this._creatingOffer = false;
        }
    }

    _sendSignal({ kind, sdp = null, sdpType = null, candidate = null } = {}) {
        try {
            if (!this.scene || typeof this.scene._sendHandshakeSignal !== 'function') return false;
            if (!this.scene._canSendSignal || !this.scene._canSendSignal()) return false;

            const id = randomId('rtc');
            const payload = {
                id,
                kind,
                from: this._getMyPeerId(),
                to: this._getOtherPeerId(),
                time: nowTs(),
                session: (this.scene && this.scene.server && this.scene.server.roomId) || null,
                sdp,
                sdpType,
                candidate
            };

            const diff = {};
            diff[`webrtcSignals/${id}`] = payload;
            const ok = this.scene._sendHandshakeSignal(diff);
            if (ok) this.sentSignalIds.add(id);
            return !!ok;
        } catch (e) {
            return false;
        }
    }

    async handleRemoteState(state) {
        try {
            if (!this.started || !state || typeof state !== 'object') return;
            const signalMap = state.webrtcSignals;
            if (!signalMap || typeof signalMap !== 'object') return;

            const entries = Object.entries(signalMap);
            entries.sort((a, b) => (Number(a?.[1]?.time || 0) - Number(b?.[1]?.time || 0)));

            for (const [id, signal] of entries) {
                if (!id || !signal || typeof signal !== 'object') continue;
                if (this.signalSeen.has(id)) continue;
                if (this.sentSignalIds.has(id)) { this.signalSeen.add(id); continue; }

                const to = signal.to;
                const me = this._getMyPeerId();
                if (to && to !== me) continue;

                this.signalSeen.add(id);
                await this._consumeSignal(signal);
            }

            this._pruneSeen();
        } catch (e) {
            /* ignore */
        }
    }

    async _consumeSignal(signal) {
        if (!signal || !signal.kind) return;
        await this._ensurePeer(false);
        if (!this.pc) return;

        if (signal.kind === 'offer') {
            const desc = new RTCSessionDescription({ type: signal.sdpType || 'offer', sdp: signal.sdp });
            await this.pc.setRemoteDescription(desc);
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            this._sendSignal({ kind: 'answer', sdp: answer.sdp, sdpType: answer.type });
            return;
        }

        if (signal.kind === 'answer') {
            const desc = new RTCSessionDescription({ type: signal.sdpType || 'answer', sdp: signal.sdp });
            await this.pc.setRemoteDescription(desc);
            return;
        }

        if (signal.kind === 'ice') {
            if (!signal.candidate) return;
            try {
                await this.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
            } catch (e) {
                // Ignore transient ICE ordering races.
            }
        }
    }

    _pruneSeen() {
        const now = nowTs();
        if ((now - this._lastSignalPrune) < 15000) return;
        this._lastSignalPrune = now;

        if (this.signalSeen.size > 2000) {
            // Bounded set: keep memory safe in long sessions.
            this.signalSeen = new Set(Array.from(this.signalSeen).slice(-1000));
        }
        if (this.sentSignalIds.size > 1000) {
            this.sentSignalIds = new Set(Array.from(this.sentSignalIds).slice(-500));
        }
    }
}

export function createSpriteWebRTCCollabController(scene) {
    return new SpriteWebRTCCollabController(scene);
}
