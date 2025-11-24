export default class MusicManager {
    constructor(soundManager) {
        this.soundManager = soundManager;
        this.sections = [];
        this.currentIndex = -1;
        this.currentSource = null;
        this.currentGain = null;
        this.isTransitioning = false;
        this.conditions = new Map(); // index → condition callback
        this.defaultVolume = 1;
    }

    /**
     * song sections
     * @param {Array} sectionConfig Array of { name, loop }
     */
    setSections(sectionConfig) {
        this.sections = sectionConfig;
        this.currentIndex = -1;
    }

    /**
     * conditions
     * @param {number} index index
     * @param {Function} callback return true when it's time to advance
     */
    setCondition(index, callback) {
        this.conditions.set(index, callback);
    }

    /**
     * Start the song from beginning
     * @param {number} volume Global music volume (0.0–1.0)
     */
    start(volume = 1) {
        this.reset(); 
        this.defaultVolume = volume;
        this._playNext();
        console.log('Starting music...')
    }

    /**
     * Reset
     */
    reset() {
        if (this.currentSource) {
            try {
                this.currentSource.stop();
            } catch (e) {
                console.warn("Error stopping source:", e);
            }
            this.currentSource = null;
            this.currentGain = null;
        }
        this.currentIndex = -1;
        this.isTransitioning = false;
    }

    /**
     * Change global music volume (optionally with fade)
     * @param {number} volume Target volume (0.0–1.0)
     * @param {number} fadeTime Seconds to fade, 0 = instant
     */
    setVolume(volume, fadeTime = 0) {
        this.defaultVolume = volume;
        if (this.currentGain) {
            const ctx = this.soundManager.audioCtx;
            this.currentGain.gain.cancelScheduledValues(ctx.currentTime);

            if (fadeTime > 0) {
                this.currentGain.gain.setValueAtTime(this.currentGain.gain.value, ctx.currentTime);
                this.currentGain.gain.linearRampToValueAtTime(volume, ctx.currentTime + fadeTime);
            } else {
                this.currentGain.gain.setValueAtTime(volume, ctx.currentTime);
            }
        }
    }

    /**
     * plays the next section in sequence
     */
    _playNext() {
        this.currentIndex++;
        if (this.currentIndex >= this.sections.length) {
            console.log("Music sequence finished.");
            return;
        }

        const section = this.sections[this.currentIndex];
        this._playSection(section);
    }

    /**
     * Play one section
     */
    _playSection(section) {
        this.isTransitioning = false;

        // Create custom gain node for global volume control
        const source = this.soundManager.audioCtx.createBufferSource();
        source.buffer = this.soundManager.sounds[section.name];
        source.loop = section.loop;

        const gainNode = this.soundManager.audioCtx.createGain();
        gainNode.gain.value = this.defaultVolume;

        source.connect(gainNode);
        gainNode.connect(this.soundManager.audioCtx.destination);
        source.start(0);

        this.currentSource = source;
        this.currentGain = gainNode;

        if (!section.loop) {
            source.onended = () => this._playNext();
        } else {
            const check = () => {
                if (this.conditions.has(this.currentIndex) &&
                    this.conditions.get(this.currentIndex)()) {
                    // Condition met → stop loop *after this iteration ends*
                    source.onended = () => this._playNext();
                    source.loop = false;
                } else {
                    setTimeout(check, 500); // recheck every 0.5s
                }
            };
            check();
        }
    }
}