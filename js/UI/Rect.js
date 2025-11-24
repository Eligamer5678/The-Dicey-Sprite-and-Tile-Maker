import Vector from '../Vector.js';

export default class UIRect {
    constructor(pos,size,layer,color){
        this.pos = pos;
        this.size = size;
        this.color = color;
        this.offset = new Vector(0,0);
        this.visible = true;
        this.layer = layer;
        
    }
    addOffset(offset){
        this.offset = offset
    }
    update(delta){

    }
    draw(Draw){
        if(!this.visible){
            return;
        }
        Draw.rect(this.offset.add(this.pos),this.size,this.color);
    }
}