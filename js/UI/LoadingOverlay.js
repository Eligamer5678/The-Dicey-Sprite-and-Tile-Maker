class LoadingOverlay extends HTMLElement {
    constructor() {
        super();
        this._shadow = this.attachShadow({ mode: 'closed' });
        const style = document.createElement('style');
        style.textContent = `
            :host {
                position: fixed;
                inset: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                background: rgba(0,0,0,0.6);
                z-index: 100000;
                transition: opacity 200ms ease-in-out;
                opacity: 1;
            }
            .panel {
                width: 640px;
                max-width: calc(100% - 40px);
                background: linear-gradient(180deg, #111 0%, #0b0b0b 100%);
                border: 1px solid rgba(255,255,255,0.06);
                padding: 24px;
                box-sizing: border-box;
                border-radius: 10px;
                box-shadow: 0 10px 40px rgba(0,0,0,0.6);
                color: white;
                font-family: monospace;
            }
            .title { font-size: 20px; margin-bottom: 12px; }
            .message { font-size: 14px; color: #ccc; margin-bottom: 18px; }
            .bar { width: 100%; height: 14px; background: rgba(255,255,255,0.06); border-radius: 8px; overflow: hidden; }
            .fill { height: 100%; width: 0%; background: linear-gradient(90deg,#66f,#aaf); transition: width 160ms linear; }
            .spinner { width: 42px; height: 42px; border-radius: 50%; border: 4px solid rgba(255,255,255,0.08); border-top-color: #6fb3ff; animation: spin 1s linear infinite; margin-right: 18px; }
            .row { display:flex; align-items:center; }
            @keyframes spin { to { transform: rotate(360deg); } }
            .hidden { opacity: 0; pointer-events: none; }
        `;
        this._container = document.createElement('div');
        this._container.className = 'panel';
        this._title = document.createElement('div'); this._title.className = 'title'; this._title.textContent = 'Loading...';
        this._message = document.createElement('div'); this._message.className = 'message'; this._message.textContent = '';
        this._bar = document.createElement('div'); this._bar.className = 'bar';
        this._fill = document.createElement('div'); this._fill.className = 'fill';
        this._bar.appendChild(this._fill);
        this._row = document.createElement('div'); this._row.className = 'row';
        this._spinner = document.createElement('div'); this._spinner.className = 'spinner';
        this._row.appendChild(this._spinner);
        const col = document.createElement('div');
        col.style.flex = '1';
        col.appendChild(this._title);
        col.appendChild(this._message);
        col.appendChild(this._bar);
        this._row.appendChild(col);
        this._container.appendChild(this._row);
        this._shadow.appendChild(style);
        this._shadow.appendChild(this._container);
        this._visible = true;
    }

    connectedCallback() {}

    show() {
        this.style.display = 'flex';
        requestAnimationFrame(() => { this.style.opacity = '1'; });
        this._visible = true;
    }
    hide() {
        this.style.opacity = '0';
        setTimeout(() => { this.style.display = 'none'; }, 220);
        this._visible = false;
    }

    setProgress(p) {
        p = Math.max(0, Math.min(1, p));
        this._fill.style.width = (p * 100) + '%';
    }
    setMessage(msg) {
        this._message.textContent = msg;
    }
    setTitle(t) { this._title.textContent = t; }
}

customElements.define('loading-overlay', LoadingOverlay);
export default LoadingOverlay;
