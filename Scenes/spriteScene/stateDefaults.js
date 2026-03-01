import { v } from '../../js/Vector.js';
import Color from '../../js/Color.js';

export function initializeSpriteSceneState(scene, currentSprite) {
    scene.diffs = {};
    scene.state = {
        session: {
            user: Math.random().toString(),
            tick: 0,
            schemaVersion: 2
        },
        spriteSheet: {
            core: currentSprite,
            frames: {
                idle: {
                    rowIndex: 0,
                    layers: ''
                }
            },
            onionSkin: {
                enabled: false,
                distance: [-5, 5],
                alpha: 0.2
            }
        },
        editor: {
            activeAnimation: 'idle',
            activeFrame: 0,
            activeTool: null,
            brushSize: 1,
            mirror: { h: false, v: false },
            adjustAmount: 0.05,
            paletteStepMax: 3,
            onionSkin: false,
            onionAlpha: 0.3,
            layerAlpha: 1,
            onionRange: { before: 1, after: 1 },
            pixelPerfect: false,
            autotile: false
        },
        selection: {
            global: {
                idle: {
                    main: 0,
                    multi: []
                }
            },
            pixels: {
                idle: {
                    0: []
                }
            },
            points: [],
            tiles: [],
            region: null,
            clipboard: null
        },
        brush: {
            mode: 'pixel',
            use_custom: false,
            size: 1,
            mousePos: [0, 0],
            toolsActive: {
                rect: false,
                circle: false,
                line: false,
                fillShape: false,
                paste: false
            },
            pixelBrush: {
                color: new Color(0, 0, 0, 1, 'hsv'),
                area: { anim: 'idle', layer: 'layer0', frame: 0 },
                pixelPerfect: false,
                customData: {
                    data: [],
                    origin: v(0, 0)
                },
                reflect: {
                    x: false,
                    y: false,
                    diag1: false,
                    diag2: false
                },
                channel: 'v',
                adjustAmount: { h: 0.01, s: 0.05, v: 0.05, a: 0.05 },
                colorHex: '#000000'
            },
            tileBrush: {
                binding: [
                    { area: { anim: 'idle', layers: ['layer0'], frame: 0 } }
                ],
                customData: {
                    data: [],
                    origin: v(0, 0)
                },
                rotation: 0,
                flip: 0,
                autoTile: false
            }
        },
        tilemap: {
            enabled: false,
            cols: 3,
            rows: 3,
            activeTiles: [],
            bindings: [],
            transforms: []
        },
        fps: {
            'anim/idle/0/layer0': 8
        }
    };

    scene.localState = {
        undoMax: 256,
        undoCombineMs: 100,
        camera: {
            zoom: v(1, 1),
            zoomPos: v(0, 0),
            zoomVlos: v(0, 0),
            zoomSmooth: 8,
            zoomImpulse: 12,
            zoomStep: -0.001,
            minZoom: 0.05,
            maxZoom: 16,
            offset: v(0, 0),
            pan: v(0, 0),
            panVlos: v(0, 0),
            panSmooth: 8,
            panImpulse: 1
        },
        hoverColor: new Color(0, 0, 0, 1, 'hsv'),
        collab: {
            transportMode: 'webrtc',
            handshakeOnly: true,
            webrtcReady: false
        }
    };

    scene._syncPaused = false;
    scene._syncOverlay = null;
    scene._syncOverlayLabel = null;
    scene._lastSyncRequestId = null;
    scene._lastSyncSnapshotId = null;
    scene._syncApplyInFlight = null;
    scene._syncBuildInFlight = null;

    scene._undoStack = [];
    scene._redoStack = [];
    scene._undoMax = 200;
    scene._undoTimeWindowMs = 30000;
    scene._ignoreUndoCapture = false;
    scene._undoMergeMs = 100;
    scene._bypassMirrorWrap = false;

    scene.selectionPoints = [];
    scene.currentTool = null;
    scene._selectionKeyframeStart = null;
    scene._selectionKeyframeTrack = null;
    scene._selectionKeyframePrompt = null;
    scene._selectionKeyframeLastFrame = null;
    scene._selectionKeyframeLastAnim = null;
    scene._selectionKeyframeLastAppliedFrame = null;
    scene._frameKeyframeStart = null;
    scene._frameKeyframePrompt = null;

    scene._pixelPerfectStrokeActive = false;
    scene._pixelPerfectHistory = [];
    scene._pixelPerfectOriginals = new Map();

    scene._tileClipboard = null;
    scene._tileSelection = new Set();
    scene._clipboardBrushActive = false;
    scene._clipboardBrushFired = false;
    scene._clipboardBrushBlinkPhase = 0;
    scene._justPasted = false;

    scene._tileActive = new Set();
    scene._tileCoordToIndex = new Map();
    scene._tileIndexToCoord = [];
    if (typeof scene._seedTileActives === 'function') scene._seedTileActives();

    scene._drawAreas = [];
    scene._areaBindings = [];
    scene._areaTransforms = [];
}
