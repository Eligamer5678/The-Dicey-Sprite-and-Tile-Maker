    
import Signal from '../js/Signal.js';

export default class SoundManager {
    constructor() {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        this.sounds = {};             // Stores AudioBuffers
        this.playingSounds = new Map(); // key: sound name, value: array of {source, gainNode}
        this.lastVolumes = new Map(); // key: sound name, value: last used volume
    }

    async loadSound(name, url) {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
        this.sounds[name] = audioBuffer;
    }
    resume() {
        if (this.audioCtx && this.audioCtx.state !== 'running') {
            return this.audioCtx.resume();
        }
        return Promise.resolve();
    }
    play(name, volume = null, loop = false) {
        if (!this.sounds[name]) return null;

        // Use last volume if no volume is specified
        if (volume === null) {
            volume = this.lastVolumes.get(name) ?? 1;
        } else {
            this.lastVolumes.set(name, volume);
        }

        const source = this.audioCtx.createBufferSource();
        source.buffer = this.sounds[name];

        const gainNode = this.audioCtx.createGain();
        gainNode.gain.value = volume;

        source.connect(gainNode);
        gainNode.connect(this.audioCtx.destination);

        source.loop = loop;
        source.start(0);

        const soundData = { source, gainNode };

        // Add to the list of playing instances for this sound
        if (!this.playingSounds.has(name)) {
            this.playingSounds.set(name, []);
        }
        this.playingSounds.get(name).push(soundData);

        // Remove from playingSounds when finished
        source.onended = () => {
            const list = this.playingSounds.get(name);
            if (list) {
                this.playingSounds.set(name, list.filter(s => s.source !== source));
            }
        };

        return source;
    }

    setVolume(name, volume) {
        this.lastVolumes.set(name, volume); // Remember for next play
        const list = this.playingSounds.get(name);
        if (list) {
            list.forEach(({ gainNode }) => {
                gainNode.gain.value = volume;
            });
        }
    }

    stop(name) {
        const list = this.playingSounds.get(name);
        if (list) {
            list.forEach(({ source }) => source.stop());
            this.playingSounds.delete(name);
        }
    }

    async playSequence(names, volumes = [], loops = []) {
        for (let i = 0; i < names.length; i++) {
            const name = names[i];
            if (!this.sounds[name]) continue;

            const volume = volumes[i] ?? null;
            const loop = loops[i] ?? false;

            const source = this.play(name, volume, loop);

            // Wait until this sound finishes before moving to the next
            await new Promise(resolve => {
                source.onended = resolve;
            });
        }
    }
}