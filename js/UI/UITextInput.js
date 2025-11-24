import Vector from '../Vector.js';
import UIButton from './Button.js';
import Signal from '../Signal.js';

export default class UITextInput extends UIButton {
    constructor(mouse, keys, pos, size, layer, text = '', placeholder = ''){
        super(mouse, keys, pos, size, layer, null, '#222', '#333', '#111');
        this.text = String(text || '');
        this.placeholder = String(placeholder || '');
        this.focused = false;
        this.onChange = new Signal();
        this.onSubmit = new Signal();
        this._blink = 0;
        this._caretVisible = true;
        this._maxLength = 64;
        this._lastKeyTime = {}; // per-key stall timestamps (ms)
        this._stallMs = 120; // 120ms stall to avoid repeated presses
    }

    focus(){
        this.focused = true;
        try{ if (this.mouse && typeof this.mouse.addMask === 'function') this.mouse.addMask(this.layer); } catch(e){}
    }
    blur(){
        this.focused = false;
    }

    update(delta){
        // basic hover/pressed handling from UIButton
        super.update(delta);
        if(!this.visible) return;
        this._blink += delta;
        if (this._blink > 0.5) { this._blink = 0; this._caretVisible = !this._caretVisible; }

        // click to focus
        if (this.mouse && this.mouse.released && this.mouse.released('left')){
            // clicked inside?
            const rectPos = this.pos.add(this.offset);
            const p = this.mouse.pos;
            if (p.x >= rectPos.x && p.y >= rectPos.y && p.x <= rectPos.x + this.size.x && p.y <= rectPos.y + this.size.y){
                this.focus();
            } else {
                // click outside blurs
                this.blur();
            }
        }

        if (!this.focused) return;

        // helper to consume a key press with stall
        const now = Date.now();
        const consumeKey = (k)=>{
            try{
                if (!this.keys.pressed(k)) return false;
            } catch(e){ return false; }
            const last = this._lastKeyTime[k] || 0;
            if (now - last < this._stallMs) return false;
            this._lastKeyTime[k] = now;
            return true;
        };

        // backspace / enter / escape
        try{
            if (consumeKey('Backspace')){
                if (this.text.length > 0){
                    this.text = this.text.slice(0, -1);
                    this.onChange.emit(this.text);
                }
            }
            if (consumeKey('Enter')){
                this.onSubmit.emit(this.text);
                this.blur();
            }
            if (consumeKey('Escape')){
                this.blur();
            }
        } catch(e){}

        // handle printable characters: letters, numbers, space and common punctuation
        const allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_=[]{};:'\\\",.<>/?`~!@#$%^&*()+=\\|";
        for (let i = 0; i < allowed.length; i++){
            const ch = allowed[i];
            try{
                if (consumeKey(ch)){
                    if (this.text.length < this._maxLength){
                        this.text += ch;
                        this.onChange.emit(this.text);
                    }
                }
            } catch(e){}
        }
    }

    draw(UIDraw){
        if(!this.visible) return;
        // background
        UIDraw.rect(this.pos.add(this.offset), this.size, this.color);
        // border
        UIDraw.rect(this.pos.add(this.offset), this.size, '#00000000', false, true, 2, '#888888');
        // text
    const txt = (this.text.length > 0) ? this.text : this.placeholder;
    const color = (this.text.length > 0) ? '#FFFFFF' : '#AAAAAA';
    const textPos = this.pos.clone().add(this.offset).add(new Vector(8, this.size.y/2 + 6));
    // use monospace font when available
    UIDraw.text(txt, textPos, color, 0, 14, { align: 'left', baseline: 'middle', font: 'monospace' });

        // caret
        if (this.focused && this._caretVisible){
            // simple caret at end of text
            // approximate caret x pos by measuring characters width as 8px each (monospace assumption)
            // approximate caret x pos using monospace approx (8px per char)
            const approxX = this.pos.x + this.offset.x + 8 + Math.min(this.text.length * 8, this.size.x - 16);
            const carety1 = this.pos.y + this.offset.y + 8;
            const carety2 = this.pos.y + this.offset.y + this.size.y - 8;
            UIDraw.rect(new Vector(approxX, carety1), new Vector(2, carety2 - carety1), '#FFFFFF');
        }
    }
}
