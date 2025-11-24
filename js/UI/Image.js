import Vector from '../Vector.js';

export default class UIImage {
    constructor(image,pos,size,layer){
        this.pos = pos;
        this.size = size;
        this.image = image
        this.offset = new Vector(0,0);
        this.rot = 0
        this.invert = 1
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
        Draw.image(this.image,this.offset.add(this.pos),this.size,this.invert,this.rot);
    }
}