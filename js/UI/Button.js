import Vector from '../Vector.js';
import Signal from '../Signal.js';
import Geometry from '../Geometry.js';

export default class UIButton {
    constructor(mouse, keys,pos,size,layer,keybind=null,baseColor='#444',hoverColor='#555',pressedColor='#222'){
        this.pos = pos;
        this.size = size;
        this.baseColor = baseColor ? baseColor : '#444';
        this.hoverColor = hoverColor ? hoverColor : '#555';
        this.pressedColor = pressedColor ? pressedColor : '#222';
        this.color = this.baseColor;
        this.keybind = keybind;
        this.layer = layer;
        this.mouse = mouse;
        this.trigger = false;
        this.triggered = false;
        this.keys = keys;
        this.offset = new Vector(0,0)
        this.visible = true;

        this.pressed = {
            'left':false,
            'middle':false,
            'right':false,
        }
        this.held = {
            'left':false,
            'middle':false,
            'right':false,
        }
        this.onPressed = {
            'left':new Signal(),
            'middle':new Signal(),
            'right':new Signal(),
        }
        /** Signal 
         * @param {number} [time] 
         * */
        this.onHeld = {
            'left':new Signal(),
            'middle':new Signal(),
            'right':new Signal(),
        }
        /** Signal 
         * @param {number} [time] 
         * */
        this.onHover = new Signal();
        this.onHoverOut = new Signal();
        this.onHoverIn = new Signal();
        this.onRelease = new Signal();
        this.onTrigger = new Signal();
        this.released = false

        this.justHovered = false;
        this.heldTime = 0
        this.hoverTime = 0
        this.onPressed['left'].connect(()=>{
            if(this.trigger && this.triggered){
                this.triggered = false;
                this.onTrigger.emit(this.triggered)
            }else if(this.trigger && !this.triggered){
                this.triggered = true;
                this.onTrigger.emit(this.triggered)
            }
        })
    }
    addOffset(offset){
        this.offset = offset
    }
    update(delta){ 
        if(!this.visible){
            return;
        }
        this.heldTime += delta;
        this.color = this.baseColor;
        this.mouse.setPower(this.layer)
        // Use current mouse position for hit detection so clicks/releases are handled where the cursor actually is
        if (Geometry.pointInRect(this.mouse.pos,this.pos.add(this.offset),this.size)){
            if(this.layer > this.mouse.mask){
                this.mouse.setMask(this.layer);
            }
            this.color = this.hoverColor;
            this.hoverTime += delta;
            this.onHover.emit(this.hoverTime);
            this.release = this.mouse.released('left');
            this.pressed = {
                'left':this.mouse.pressed('left'),
                'middle':this.mouse.pressed('middle'),
                'right':this.mouse.pressed('right'),
            }
            this.held = {
                'left':this.mouse.held('left',true),
                'middle':this.mouse.held('middle',true),
                'right':this.mouse.held('right',true),
            }
            
            for (let value in this.held){
                if (this.held[value]>0){
                    this.onHeld[value].emit(this.held[value])
                }
            }
            if(!this.justHovered){
                this.onHoverIn.emit();
            }
            this.justHovered = true;
            
        }else{
            if(this.justHovered){
                this.onHoverOut.emit()
            }
            this.pressed = {
                'left':false,
                'middle':false,
                'right':false,
            }
            this.held = {
                'left':0,
                'middle':0,
                'right':0,
            }
        }
        if(this.held['left']+this.held['right']+this.held['middle'] > 0||this.trigger&&this.triggered){
            this.color = this.pressedColor;
        }
        if(this.keybind !== null){
            if(this.keys.pressed(this.keybind)){
                this.pressed.left = true;
            }
        }
        for (let value in this.pressed){
            if (this.pressed[value]){
                this.onPressed[value].emit()
            }
        }
    }
    draw(Draw){
        if(!this.visible){
            return;
        }
        Draw.rect(this.offset.add(this.pos),this.size,this.color);
    }
}