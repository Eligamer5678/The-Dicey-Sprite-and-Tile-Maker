import Signal from "./Signal.js";

export default class Timer {
    /**
     * @param {'stopwatch'|'loop'|'countdown'|'countup'} [type] 
     * stopwatch: Starts at 0, counts up to infinity.
     * loop: resets to 0 when reaching endTime.  
     * countdown: starts at end time, stops at 0.  
     * countup: starts at 0, stops at endtime.  
     * @param {number} [endTime]
     */
    constructor(type = 'stopwatch', endTime = 0) {
        this.type = type;
        this.endTime = endTime;
        this.time = 0;
        this.running = false;
        this._lastUpdate = null;
        // Signals
        this.onStart = new Signal();
        this.onStop = new Signal();
        this.onReset = new Signal();
        this.onFinish = new Signal();
        this.onTick = new Signal();
        this.onLoop = new Signal();
        this.onPause = new Signal();
        this.onUnpause = new Signal();
    }

    pause() {
        if (this.running) {
            this.running = false;
            this.onPause.emit(this.time);
            // Keep _lastUpdate so we can resume accurately
        }
    }

    unpause() {
        if (!this.running) {
            this.running = true;
            this._lastUpdate = performance.now();
            this.onUnpause.emit(this.time);
        }
    }

    start() {
        if (!this.running) {
            this.running = true;
            this._lastUpdate = performance.now();
            this.onStart.emit(this.time);
        }
    }

    stop() {
        if (this.running) {
            this.running = false;
            this._lastUpdate = null;
            this.onStop.emit(this.time);
        }
    }

    reset() {
        this.time = (this.type === 'countdown') ? this.endTime : 0;
        this._lastUpdate = this.running ? performance.now() : null;
        this.onReset.emit(this.time);
    }

    /**
     * @param {number} delta - Time since last update in seconds
     */
    update(delta) {
        if (!this.running) return;
        let finished = false;
        if (this.type === 'stopwatch') {
            this.time += delta;
        } else if (this.type === 'countdown') {
            this.time -= delta;
            if (this.time <= 0) {
                this.time = 0;
                this.running = false;
                finished = true;
            }
        } else if (this.type === 'countup') {
            this.time += delta;
            if (this.time >= this.endTime) {
                this.time = this.endTime;
                this.running = false;
                finished = true;
            }
        } else if (this.type === 'loop') {
            this.time += delta;
            if (this.time >= this.endTime) {
                this.onLoop.emit(this.time);
                this.time = 0;
            }
        }
        this.onTick.emit(this.time);
        if (finished) {
            this.onFinish.emit(this.time);
        }
    }
    isFinished() {
        if (this.type === 'stopwatch') return false;
        if (this.type === 'countdown') return this.time <= 0;
        if (this.type === 'countup') return this.time >= this.endTime;
        if (this.type === 'loop') return false;
        return false;
    }

    getTime() {
        return this.time;
    }

    setTime(t) {
        this.time = t;
    }
}
