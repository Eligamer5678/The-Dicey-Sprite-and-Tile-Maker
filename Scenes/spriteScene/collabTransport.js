export class SpriteCollabTransport {
    constructor(scene) {
        this.scene = scene;
        this.mode = 'firebase-diff';
        this.webrtcSender = null;
        this.signalSender = null;
        this.allowFirebaseData = true;
        this._dataQueue = [];
        this._maxQueue = 1024; // max queued diffs to avoid unbounded memory
        this._flushIntervalMs = 1000; // attempt flush every second when queued
        this._flushTimer = null;
    }

    setMode(mode, options = {}) {
        this.mode = mode || 'firebase-diff';

        if (this.mode !== 'webrtc') {
            this.webrtcSender = null;
        } else if (Object.prototype.hasOwnProperty.call(options, 'sendDiff')) {
            // Use setWebRTCSender so any queued diffs are flushed immediately
            if (typeof options.sendDiff === 'function') this.setWebRTCSender(options.sendDiff);
            else this.webrtcSender = null;
        }

        if (Object.prototype.hasOwnProperty.call(options, 'sendSignal')) {
            this.signalSender = (typeof options.sendSignal === 'function') ? options.sendSignal : null;
        }

        if (typeof options.allowFirebaseData === 'boolean') {
            this.allowFirebaseData = options.allowFirebaseData;
        }
        // collabTransport debug suppressed
    }

    setWebRTCSender(sendDiff) {
        if (typeof sendDiff === 'function') {
            this.webrtcSender = sendDiff;
            this.mode = 'webrtc';
            // Immediately attempt to flush any queued diffs when a sender appears
            try { this._flushQueue(); } catch (e) {}
            this._ensureFlushTimer();
            // collabTransport debug suppressed
            return true;
        }
        return false;
    }

    setSignalSender(sendSignal) {
        if (typeof sendSignal === 'function') {
            this.signalSender = sendSignal;
            return true;
        }
        return false;
    }

    isAvailable(kind = 'data') {
        if (kind === 'signal') {
            if (typeof this.signalSender === 'function') return true;
            const server = this.scene && this.scene.server;
            return !!(server && typeof server.sendDiff === 'function');
        }
        // For data transport, only report available when WebRTC data channel is present.
        // We deliberately DO NOT consider the server (Firebase) a data transport to avoid
        // routing real-time diffs through the server (costly). Server may still be used
        // for signaling via `sendSignal()` but not for data sync.
        if (this.mode === 'webrtc' && typeof this.webrtcSender === 'function') return true;
        return false;
    }

    sendSignal(signalPayload) {
        if (!signalPayload || typeof signalPayload !== 'object') return false;

        try {
            if (typeof this.signalSender === 'function') {
                this.signalSender(signalPayload);
                return true;
            }

            const server = this.scene && this.scene.server;
            if (server && typeof server.sendDiff === 'function') {
                server.sendDiff(signalPayload);
                return true;
            }
        } catch (e) {
            return false;
        }
        return false;
    }

    sendDiff(diff) {
        if (!diff || typeof diff !== 'object') return false;

        try {
            // Prefer WebRTC when available
            if (this.mode === 'webrtc' && typeof this.webrtcSender === 'function') {
                try { this.webrtcSender(diff); } catch (e) { /* still enqueue below if send fails */ }
                return true;
            }

            // WebRTC not available: enqueue the diff for later delivery via WebRTC.
            // IMPORTANT: we do NOT send diffs through the server to avoid server-side
            // data routing and billing. The queued diffs will be flushed when the
            // WebRTC data channel becomes available again.
            // However, do not start queuing diffs when there is no active room
            // (e.g. user not joined to any room) — that causes unbounded caching
            // of local edits that will later be replayed incorrectly when joining.
            const hasRoom = !!(this.scene && this.scene.server && this.scene.server.roomId);
            if (!hasRoom) {
                // drop the diff when not in a room instead of enqueueing it
                return false;
            }
            try { this._enqueueDiff(diff); } catch (e) { /* ignore enqueue errors */ }
            return false;
        } catch (e) {
            return false;
        }
        return false;
    }

    _enqueueDiff(diff) {
        try {
            if (!this._dataQueue) this._dataQueue = [];
            this._dataQueue.push(diff);
            // cap queue size
            if (this._dataQueue.length > this._maxQueue) this._dataQueue.splice(0, this._dataQueue.length - this._maxQueue);
            this._ensureFlushTimer();
        } catch (e) { /* ignore */ }
    }

    _ensureFlushTimer() {
        try {
            if (this._flushTimer) return;
            this._flushTimer = setInterval(() => {
                try { this._flushQueue(); } catch (e) {}
            }, Math.max(200, this._flushIntervalMs));
        } catch (e) {}
    }

    _flushQueue() {
        try {
            if (!this._dataQueue || this._dataQueue.length === 0) {
                if (this._flushTimer) { clearInterval(this._flushTimer); this._flushTimer = null; }
                return;
            }
            if (typeof this.webrtcSender !== 'function') return; // wait until available

            // Send in small batches to avoid monopolizing the data channel
            const batchSize = 16;
            const batch = this._dataQueue.splice(0, batchSize);
            for (const d of batch) {
                try {
                    this.webrtcSender(d);
                } catch (e) {
                    // send failed: requeue remaining and abort
                    this._dataQueue.unshift(d);
                    try { this._flushFailures = (this._flushFailures || 0) + 1; } catch (er) {}
                    if ((this._flushFailures || 0) > 3) {
                        try { console.warn && console.warn('[collabTransport] repeated flush failures, triggering scene recovery'); } catch (er) {}
                        try { if (this.scene && typeof this.scene._recoverCollabState === 'function') this.scene._recoverCollabState('transportFlushFailures'); } catch (er) {}
                        this._flushFailures = 0;
                    }
                    break;
                }
            }
            if (!this._dataQueue || this._dataQueue.length === 0) {
                if (this._flushTimer) { clearInterval(this._flushTimer); this._flushTimer = null; }
            }
        } catch (e) { /* ignore flush errors */ }
    }
}

export function createSpriteCollabTransport(scene) {
    return new SpriteCollabTransport(scene);
}
