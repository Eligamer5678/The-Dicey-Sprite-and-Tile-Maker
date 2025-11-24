import Vector from './Vector.js';

export default class Polygon {
    constructor(points, pos = Vector.zero(), scale=Vector.one(), rot=0){
        this.points = points
        this.pos = pos
        this.scale = scale
        this.rot = rot
    }
    getRot(){
        return this.points.map(point => point.rotate(this.rot))
    }
    getScale(){
        return this.points.map(point => point.scale(this.scale))
    }
    getTransform(){
        return this.points.map(point => point.rotate(this.rot).scale(this.scale).add(this.pos))
    }
}