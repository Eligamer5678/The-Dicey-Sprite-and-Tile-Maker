import Vector from './Vector.js';
import Polygon from './Polygon.js';

export default class Geometry { 
    /** Returns true if a point is in a rect */
    static pointInRect(point, rectPos, rectSize) {
        return (
            point.x >= rectPos.x &&
            point.x <= rectPos.x + rectSize.x &&
            point.y >= rectPos.y &&
            point.y <= rectPos.y + rectSize.y
        );
    }
    /** Returns true if 2 rects overlap */
    static rectCollide(posA, sizeA, posB, sizeB) {
        return !(
            posA.x + sizeA.x < posB.x || // A is left of B
            posA.x > posB.x + sizeB.x || // A is right of B
            posA.y + sizeA.y < posB.y || // A is above B
            posA.y > posB.y + sizeB.y    // A is below B
        );
    }
    /** Converts a rect to a polygon */
    static rectToPoly(pos,size,rot = 0,origin='center'){
        if (origin === 'center'){
            let half = size.clone().mult(0.5);
            let pos1 = half.clone();
            let pos2 = new Vector(half.x, -half.y);
            let pos3 = half.clone().mult(-1);
            let pos4 = new Vector(-half.x, half.y);
            
            return new Polygon([pos1,pos2,pos3,pos4],pos.clone(),Vector.one(),rot)
        }
    }

    /** Project polygon onto axis and return [min,max] scalar values */
    static projectPolygon(axis, points) {
        let min = axis.dot(points[0]);
        let max = min;
        for (let i = 1; i < points.length; i++) {
            let p = axis.dot(points[i]);
            if (p < min) min = p;
            if (p > max) max = p;
        }
        return {min, max};
    }

    /** Check polygon vs polygon using SAT */
    static polyCollide(polyA, polyB) {
        const ptsA = polyA.getTransform();
        const ptsB = polyB.getTransform();

        // Check axes from both polygons
        const polygons = [ptsA, ptsB];
        for (let pts of polygons) {
            for (let i = 0; i < pts.length; i++) {
                const p1 = pts[i];
                const p2 = pts[(i + 1) % pts.length];

                // Edge vector
                const edge = p2.sub(p1);
                // Normal axis (perpendicular)
                const axis = new Vector(-edge.y, edge.x).normalize();

                // Project both polys
                const projA = this.projectPolygon(axis, ptsA);
                const projB = this.projectPolygon(axis, ptsB);

                // Check overlap
                if (projA.max < projB.min || projB.max < projA.min) {
                    return false; // Separating axis found
                }
            }
        }
        return true; // No separating axis → collision
    }

    /** Polygon AABB check */
    static polyRectCollide(poly, rectPos, rectSize, rectRot = 0) {
        const rectPoly = this.rectToPoly(rectPos, rectSize, rectRot);
        return this.polyCollide(poly, rectPoly);
    }

    /** Point-in-polygon test*/
    static pointInPoly(point, poly) {
        const pts = poly.getTransform();
        let inside = false;

        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const xi = pts[i].x, yi = pts[i].y;
            const xj = pts[j].x, yj = pts[j].y;

            const intersect = ((yi > point.y) !== (yj > point.y)) &&
                              (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }

        return inside;
    }

    // Sprite & Tile collision 
    static spriteToTile(pos, vlos, size, tilePos, tileSize, buffer=2) {
        const collided = { top: false, bottom: false, left: false, right: false };

        const newPos = pos.clone();
        const newVlos = vlos.clone();

        let anyCollision = false;

        // Right side
        if (newPos.x + newVlos.x + size.x >= tilePos.x &&
            newPos.x <= tilePos.x &&
            newPos.y + size.y - buffer > tilePos.y &&
            newPos.y + buffer < tilePos.y + tileSize.y
        ) {
            newPos.x = tilePos.x - size.x;
            newVlos.x *= 0.0001;
            collided.right = true;
            anyCollision = true;
        }

        // Left side
        if (newPos.x + newVlos.x <= tilePos.x + tileSize.x &&
            newPos.x + size.x >= tilePos.x + tileSize.x &&
            newPos.y + size.y - buffer > tilePos.y &&
            newPos.y + buffer < tilePos.y + tileSize.y
        ) {
            newPos.x = tilePos.x + tileSize.x;
            newVlos.x *= 0.0001;
            collided.left = true;
            anyCollision = true;
        }

        // Bottom (floor)
        if (newPos.y + newVlos.y + size.y >= tilePos.y &&
            newPos.y <= tilePos.y &&
            newPos.x + size.x - buffer > tilePos.x &&
            newPos.x + buffer < tilePos.x + tileSize.x
        ) {
            newPos.y = tilePos.y - size.y;
            newVlos.y *= -0.2;
            collided.bottom = true;
            anyCollision = true;
        }

        // Top (ceiling)
        if (newPos.y + newVlos.y <= tilePos.y + tileSize.y &&
            newPos.y + size.y >= tilePos.y + tileSize.y &&
            newPos.x + size.x - buffer > tilePos.x &&
            newPos.x + buffer < tilePos.x + tileSize.x
        ) {
            newPos.y = tilePos.y + tileSize.y;
            newVlos.y *= -0.2;
            collided.top = true;
            anyCollision = true;
        }

        // Return false if nothing happened
        if (!anyCollision) {
            return false;
        }

        return { pos: newPos, vlos: newVlos, collided };
    }
    
    static spriteToSprite(posA, vlosA, sizeA, massA, posB, vlosB, sizeB, massB, restitution = 0.8) {
        const collided = { top: false, bottom: false, left: false, right: false };

        const newPosA = posA.clone();
        const newVlosA = vlosA.clone();
        const newPosB = posB.clone();
        const newVlosB = vlosB.clone();

        let anyCollision = false;

        // Axis-Aligned Bounding Box overlap check
        const overlapX = (newPosA.x < newPosB.x + sizeB.x) && (newPosA.x + sizeA.x > newPosB.x);
        const overlapY = (newPosA.y < newPosB.y + sizeB.y) && (newPosA.y + sizeA.y > newPosB.y);

        if (overlapX && overlapY) {
            anyCollision = true;

            // Find penetration depths
            const dx = (newPosA.x + sizeA.x / 2) - (newPosB.x + sizeB.x / 2);
            const dy = (newPosA.y + sizeA.y / 2) - (newPosB.y + sizeB.y / 2);
            const overlapWidth = (sizeA.x + sizeB.x) / 2 - Math.abs(dx);
            const overlapHeight = (sizeA.y + sizeB.y) / 2 - Math.abs(dy);

            if (overlapWidth < overlapHeight) {
                // Resolve X collision
                if (dx > 0) {
                    newPosA.x += overlapWidth / 2;
                    newPosB.x -= overlapWidth / 2;
                    collided.left = true;
                } else {
                    newPosA.x -= overlapWidth / 2;
                    newPosB.x += overlapWidth / 2;
                    collided.right = true;
                }

                // 1D momentum exchange along X
                const vA = newVlosA.x;
                const vB = newVlosB.x;
                newVlosA.x = ( (massA - massB) * vA + 2 * massB * vB ) / (massA + massB) * restitution;
                newVlosB.x = ( (massB - massA) * vB + 2 * massA * vA ) / (massA + massB) * restitution;

            } else {
                // Resolve Y collision
                if (dy > 0) {
                    newPosA.y += overlapHeight / 2;
                    newPosB.y -= overlapHeight / 2;
                    collided.top = true;
                } else {
                    newPosA.y -= overlapHeight / 2;
                    newPosB.y += overlapHeight / 2;
                    collided.bottom = true;
                }

                // 1D momentum exchange along Y
                const vA = newVlosA.y;
                const vB = newVlosB.y;
                newVlosA.y = ( (massA - massB) * vA + 2 * massB * vB ) / (massA + massB) * restitution;
                newVlosB.y = ( (massB - massA) * vB + 2 * massA * vA ) / (massA + massB) * restitution;
            }
        }

        if (!anyCollision) {
            return false;
        }

        return { posA: newPosA, vlosA: newVlosA, posB: newPosB, vlosB: newVlosB, collided };
    }
}