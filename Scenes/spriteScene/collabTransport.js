export class SpriteCollabTransport {
    constructor(scene) {
        this.scene = scene;
        this.mode = 'firebase-diff';
        this.webrtcSender = null;
        this.signalSender = null;
        this.allowFirebaseData = true;
    }

    setMode(mode, options = {}) {
        this.mode = mode || 'firebase-diff';

        if (this.mode !== 'webrtc') {
            this.webrtcSender = null;
        } else if (Object.prototype.hasOwnProperty.call(options, 'sendDiff')) {
            this.webrtcSender = (typeof options.sendDiff === 'function') ? options.sendDiff : null;
        }

        if (Object.prototype.hasOwnProperty.call(options, 'sendSignal')) {
            this.signalSender = (typeof options.sendSignal === 'function') ? options.sendSignal : null;
        }

        if (typeof options.allowFirebaseData === 'boolean') {
            this.allowFirebaseData = options.allowFirebaseData;
        }
    }

    setWebRTCSender(sendDiff) {
        if (typeof sendDiff === 'function') {
            this.webrtcSender = sendDiff;
            this.mode = 'webrtc';
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

        if (!this.allowFirebaseData && typeof this.webrtcSender !== 'function') return false;

        if (this.mode === 'webrtc' && typeof this.webrtcSender === 'function') return true;
        if (this.mode === 'webrtc' && !this.allowFirebaseData) return false;

        const server = this.scene && this.scene.server;
        return !!(server && typeof server.sendDiff === 'function');
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
            if (!this.allowFirebaseData && typeof this.webrtcSender !== 'function') return false;

            if (this.mode === 'webrtc' && typeof this.webrtcSender === 'function') {
                this.webrtcSender(diff);
                return true;
            }

            if (this.mode === 'webrtc' && !this.allowFirebaseData) return false;

            const server = this.scene && this.scene.server;
            if (server && typeof server.sendDiff === 'function') {
                server.sendDiff(diff);
                return true;
            }
        } catch (e) {
            return false;
        }
        return false;
    }
}

export function createSpriteCollabTransport(scene) {
    return new SpriteCollabTransport(scene);
}
