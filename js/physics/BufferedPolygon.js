import Vector from '../Vector.js';
import BufferedSegment from './BufferedSegment.js';

/**
 * BufferedPolygon: edge-only collision using a sequence of BufferedSegments.
 * By default this is an open polyline (edges between consecutive vertices only).
 * If `closed` is true the polygon will connect the last vertex back to the first
 * so edge-capsules form a closed loop (useful for boxes/entities).
 */
export default class BufferedPolygon {
    /**
     * @param {Vector[]} vertices - ordered vertices; last will connect to first
     * @param {number} baseRadius - max buffer radius for each edge
     * @param {{kv?:number, ka?:number, min?:number, minRadius?:number}} [coeffs]
     */
    constructor(vertices = [], baseRadius = 12, coeffs = {}, closed = false){
        this.vertices = (vertices || []).map(v => v.clone());
        this.baseRadius = baseRadius;
        this.coeffs = coeffs || {};
        this.closed = !!closed;
        this.edges = [];
        this._buildEdges();
    }

    setVertices(vertices){
        this.vertices = (vertices || []).map(v => v.clone());
        this._buildEdges();
    }

    _buildEdges(){
        this.edges = [];
        const n = this.vertices.length;
        if (n < 2) return;
        // Create edges between consecutive vertices. If closed, also connect last->first.
        const lastIndex = this.closed ? n : n - 1;
        for (let i = 0; i < lastIndex; i++) {
            const a = this.vertices[i];
            const b = this.vertices[(i+1) % n];
            this.edges.push(new BufferedSegment(a, b, this.baseRadius, this.coeffs));
        }
    }

    updateBuffer(velMag = 0, accelMag = 0){
        for (const e of this.edges) e.updateBuffer(velMag, accelMag);
    }

    drawBuffer(Draw, color = '#44AAFF66'){
        for (const e of this.edges) e.drawBuffer(Draw, color);
    }

    drawDebug(Draw){
        // outline
        try {
            for (const e of this.edges) e.drawDebug(Draw);
        } catch (e) {}
    }

    /**
     * Collide this polygon (edge-capsules) against another polygon.
     * Returns the deepest edge-edge penetration found.
     */
    collidePolygon(other){
        try {
            if (!other || !other.edges || !this.edges) return { collides: false };
            let best = null; let bestPen = 0; let bestA = -1; let bestB = -1;
            for (let i=0;i<this.edges.length;i++){
                for (let j=0;j<other.edges.length;j++){
                    const hit = this.edges[i].collideSegment(other.edges[j]);
                    if (hit && hit.collides && hit.penetration > bestPen) {
                        best = hit; bestPen = hit.penetration; bestA = i; bestB = j;
                    }
                }
            }
            if (best) return { ...best, edgeA: bestA, edgeB: bestB };
            return { collides: false };
        } catch (e) { return { collides: false }; }
    }

    /**
     * Collide a circle against all edge capsules; returns the deepest hit.
     * @returns {{collides:boolean, penetration:number, normal:Vector, closestPoint:Vector, edgeIdx:number}|{collides:false}}
     */
    collideCircle(center, radius){
        let best = null; let bestPen = 0; let bestIdx = -1;
        for (let i=0;i<this.edges.length;i++){
            const hit = this.edges[i].collideCircle(center, radius);
            if (hit && hit.collides && hit.penetration > bestPen) {
                best = hit; bestPen = hit.penetration; bestIdx = i;
            }
        }
        if (best) return { ...best, edgeIdx: bestIdx };
        return { collides: false };
    }
}
