export function setupSpriteSceneMultiplayerHooks(scene, sheet) {
    try {
        scene._opBuffer = [];
        scene._seenOpIds = new Set();
        scene._sendScheduledId = null;
        scene._sendIntervalMs = 120;
        scene.clientId = scene.playerId || ('c' + Math.random().toString(36).slice(2, 8));
        scene._lastModified = new Map();
        scene._suppressOutgoing = false;
        scene._remoteEdits = new Map();
        scene._pruneIntervalMs = 10000;
        scene._pruneThresholdMs = 30000;
        scene._pruneIntervalId = null;
        scene._seenMsgIds = new Set();

        try {
            scene.playerName = (scene.saver && typeof scene.saver.get === 'function') ? scene.saver.get('player_name') : null;
        } catch (e) {
            scene.playerName = null;
        }

        if (sheet) {
            if (typeof sheet.modifyFrame === 'function') {
                const originalModifyFrame = sheet.modifyFrame.bind(sheet);
                sheet.modifyFrame = (animation, index, changes) => {
                    try { scene._recordUndoPixels(animation, index, changes); } catch (e) {}
                    const result = originalModifyFrame(animation, index, changes);
                    try {
                        const pixels = [];
                        if (Array.isArray(changes)) {
                            for (const c of changes) {
                                if (!c) continue;
                                if (c.x === undefined || c.y === undefined) continue;
                                pixels.push({ x: Number(c.x), y: Number(c.y), color: (c.color || c.col || c.c || '#000000') });
                            }
                        } else if (changes && typeof changes.x === 'number') {
                            pixels.push({ x: Number(changes.x), y: Number(changes.y), color: (changes.color || '#000000') });
                        }
                        if (pixels.length) {
                            try {
                                const now = Date.now();
                                for (const p of pixels) {
                                    try { scene._markPixelModified(animation, Number(index), Number(p.x), Number(p.y), now); } catch (e) {}
                                }
                            } catch (e) {}
                            if (!scene._suppressOutgoing) {
                                scene._opBuffer.push({ type: 'draw', anim: animation, frame: Number(index), pixels, client: scene.clientId, time: Date.now() });
                                scene._scheduleSend && scene._scheduleSend();
                            }
                        }
                    } catch (e) {}
                    return result;
                };
            }

            if (typeof sheet.setPixel === 'function') {
                const originalSetPixel = sheet.setPixel.bind(sheet);
                sheet.setPixel = (animation, index, x, y, color, blendType) => {
                    try { scene._recordUndoPixels(animation, index, { x, y, color, blendType }); } catch (e) {}
                    const result = originalSetPixel(animation, index, x, y, color, blendType);
                    try {
                        const now = Date.now();
                        try { scene._markPixelModified(animation, Number(index), Number(x), Number(y), now); } catch (e) {}
                        if (!scene._suppressOutgoing) {
                            scene._opBuffer.push({ type: 'draw', anim: animation, frame: Number(index), pixels: [{ x: Number(x), y: Number(y), color: (color || '#000000') }], client: scene.clientId, time: now });
                            scene._scheduleSend && scene._scheduleSend();
                        }
                    } catch (e) {}
                    return result;
                };
            }

            if (typeof sheet.insertFrame === 'function') {
                const originalInsertFrame = sheet.insertFrame.bind(sheet);
                sheet.insertFrame = (animation, index) => {
                    const result = originalInsertFrame(animation, index);
                    try {
                        const arr = sheet._frames.get(animation) || [];
                        let logical = 0;
                        for (let i = 0; i < arr.length; i++) {
                            const e = arr[i];
                            if (!e) continue;
                            if (e.__groupStart || e.__groupEnd) continue;
                            logical++;
                        }
                        if (!scene._suppressOutgoing && scene._canSendCollab && scene._canSendCollab()) {
                            const diff = {};
                            diff['meta/animations/' + encodeURIComponent(animation)] = logical;
                            const opIndex = (typeof index === 'number' && index >= 0) ? Number(index) : Math.max(0, logical - 1);
                            const id = (Date.now()) + '_' + Math.random().toString(36).slice(2, 6);
                            diff['edits/' + id] = { type: 'struct', action: 'insertFrame', anim: animation, index: opIndex, client: scene.clientId, time: Date.now() };
                            try { scene._sendCollabDiff(diff); } catch (e) {}
                        }
                    } catch (e) {}
                    return result;
                };
            }

            if (typeof sheet.popFrame === 'function') {
                const originalPopFrame = sheet.popFrame.bind(sheet);
                sheet.popFrame = (animation, index) => {
                    let removedCanvas = null;
                    try {
                        const logicalIdx = (typeof index === 'number' && index >= 0) ? Number(index) : 0;
                        removedCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(animation, logicalIdx) : null;
                    } catch (e) {}

                    let preLogical = 0;
                    try {
                        const preArr = sheet._frames.get(animation) || [];
                        for (let i = 0; i < preArr.length; i++) {
                            const e = preArr[i];
                            if (!e) continue;
                            if (e.__groupStart || e.__groupEnd) continue;
                            preLogical++;
                        }
                    } catch (e) {}

                    const result = originalPopFrame(animation, index);
                    try {
                        const arr = sheet._frames.get(animation) || [];
                        let logical = 0;
                        for (let i = 0; i < arr.length; i++) {
                            const e = arr[i];
                            if (!e) continue;
                            if (e.__groupStart || e.__groupEnd) continue;
                            logical++;
                        }
                        if (!scene._suppressOutgoing && scene._canSendCollab && scene._canSendCollab()) {
                            const diff = {};
                            diff['meta/animations/' + encodeURIComponent(animation)] = logical;
                            const opIndex = (typeof index === 'number' && index >= 0) ? Number(index) : Math.max(0, preLogical - 1);
                            const id = (Date.now()) + '_' + Math.random().toString(36).slice(2, 6);
                            diff['edits/' + id] = { type: 'struct', action: 'deleteFrame', anim: animation, index: opIndex, client: scene.clientId, time: Date.now() };
                            try {
                                const dataUrl = removedCanvas && removedCanvas.toDataURL ? removedCanvas.toDataURL('image/png') : null;
                                scene._pushUndo({ type: 'delete-frame', anim: animation, index: opIndex, dataUrl, size: sheet.slicePx || 16, time: Date.now() });
                            } catch (e) {}
                            try { scene._sendCollabDiff(diff); } catch (e) {}
                        }
                    } catch (e) {}
                    return result;
                };
            }

            if (typeof sheet.addAnimation === 'function') {
                const originalAddAnimation = sheet.addAnimation.bind(sheet);
                sheet.addAnimation = (name, row, frameCount) => {
                    const result = originalAddAnimation(name, row, frameCount);
                    try {
                        if (!scene._suppressOutgoing && scene._canSendCollab && scene._canSendCollab()) {
                            const diff = {};
                            diff['meta/animations/' + encodeURIComponent(name)] = Number(frameCount) || 0;
                            try { scene._sendCollabDiff(diff); } catch (e) {}
                        }
                    } catch (e) {}
                    return result;
                };
            }

            if (typeof sheet.removeAnimation === 'function') {
                const originalRemoveAnimation = sheet.removeAnimation.bind(sheet);
                sheet.removeAnimation = (name) => {
                    const result = originalRemoveAnimation(name);
                    try {
                        if (!scene._suppressOutgoing && scene._canSendCollab && scene._canSendCollab()) {
                            const diff = {};
                            diff['meta/animations/' + encodeURIComponent(name)] = 0;
                            try { scene._sendCollabDiff(diff); } catch (e) {}
                        }
                    } catch (e) {}
                    return result;
                };
            }
        }

        try {
            scene._pruneIntervalId = setInterval(() => { try { scene._pruneOldEdits(); } catch (e) {} }, scene._pruneIntervalMs || 10000);
        } catch (e) {}

        try {
            scene._cursorSendIntervalMs = 100;
            scene._cursorThrottleId = null;
            scene._lastCursorPos = null;
            scene._remoteCursors = new Map();
            scene._cursorTTLms = 5000;
            scene._cursorCleanupId = setInterval(() => { try { scene._cleanupCursors(); } catch (e) {} }, 2000);
        } catch (e) {}
    } catch (e) {
        console.warn('multiplayer hooks setup failed', e);
    }
}
