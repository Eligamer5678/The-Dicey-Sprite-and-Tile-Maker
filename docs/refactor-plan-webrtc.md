# Sprite Editor Refactor Plan (WebRTC-ready)

## Completed in this pass

- Extracted `SpriteScene` initialization state into:
  - `Scenes/spriteScene/stateDefaults.js`
- Added compatibility state bindings so legacy properties read/write from state:
  - `Scenes/spriteScene/stateBindings.js`
- Extracted multiplayer bootstrap/hook wrapping into:
  - `Scenes/spriteScene/multiplayerBootstrap.js`
- Added transport abstraction for collaboration diffs:
  - `Scenes/spriteScene/collabTransport.js`
- Updated `SpriteScene` to use:
  - `initializeSpriteSceneState()`
  - `installSpriteSceneStateBindings()`
  - `setupSpriteSceneMultiplayerHooks()`
  - `this._sendCollabDiff()` helper (transport-aware)
- Added tilemap collaboration bridge in `SpriteScene`:
  - `_serializeTilemapState()`
  - `_applyTilemapState()`
  - `_scheduleTilemapSync()`
  - `sendState()` now sends tilemap state deltas
  - `applyRemoteState()` now consumes `tilemapState`
- Added centralized editor mutation API:
  - `Scenes/spriteScene/stateController.js`
  - `SpriteScene` now routes key sceneTick/editor mutations through controller methods
- Expanded state wiring coverage:
  - `currentTool` now bound to `state.editor.activeTool`
  - `selectionPoints` now bound to `state.selection.points`
  - Eyedropper/color mutation paths now write through state-backed pen color controller method
- Added selection lifecycle controller methods and started using them in selection-heavy flows:
  - `setSelectionPoints`, `clearSelectionPoints`
  - `setSelectionRegion`, `clearSelectionRegion`
  - `setCurrentTool`, `clearCurrentTool`, `clearPixelSelection`
  - Applied in flood-select, polygon select/commit, grow/shrink, and cut/clear selection branches
- Hardened collaboration transport layer and send gating:
  - fixed `collabTransport.js` syntax regression
  - added `isAvailable()` to transport for backend-agnostic readiness checks
  - added `SpriteScene._canSendCollab()` and switched `sendState`, cursor, prune, and sync-ack gating to transport checks
  - updated multiplayer struct-op hooks to use transport availability instead of direct server checks
- Added WebRTC handshake-only scaffolding:
  - transport now separates data-channel availability vs signaling-channel availability
  - `allowFirebaseData` policy allows disabling Firebase data writes when mode is `webrtc`
  - scene helpers added: `configureCollabTransport`, `bindWebRTCCollab`, `setCollabHandshakeOnly`, `_sendHandshakeSignal`
  - debug signals added for testing migration stages: `collabMode`, `collabHandshakeOnly`, `collabSignal`
- Added initial WebRTC peer controller:
  - `Scenes/spriteScene/webrtcCollab.js`
  - handles offer/answer/ICE signaling via Firebase signaling payloads (`webrtcSignals/*`)
  - binds RTC data channel to scene diff pipeline with `bindWebRTCCollab(...)`
  - once RTC channel opens, transport remains `webrtc` with `handshakeOnly=true` (Firebase no longer carries editor data)
  - debug controls: `webrtcStart`, `webrtcStop`, `webrtcEnable`
- Fixed Firebase over-sync in WebRTC migration path:
  - removed `SpriteScene.sendState()` fallback to `Scene.sendState()` when no collab data channel is available
  - this prevents per-tick `p1/p2` scene writes to Firebase while waiting for RTC and keeps Firebase in signaling-only mode

## Current quick test flow (manual)

1. Open two clients and join same room (`p1` host, `p2` joiner).
2. In both clients, run `enableColab()` if menu is hidden.
3. In both clients, run `webrtcEnable()`.
4. Verify data channel opens (no errors in console) and edits continue syncing.
5. Validate handshake-only policy by checking Firebase room `state` no longer receives new live edit payloads while RTC is active.

## Target modular architecture

### 1) Scene state modules

Split state ownership by domain:

- `state/canvasState.js`
- `state/selectionState.js`
- `state/brushState.js`
- `state/tileState.js`
- `state/cameraState.js`
- `state/collabState.js`

Each module should expose:

- `createInitialState()`
- `validateState(state)`
- `migrateState(state, version)`

### 2) Tool system

Move tool logic out of `SpriteScene` into isolated classes/functions:

- `tools/penTool.js`
- `tools/selectionTool.js`
- `tools/fillTool.js`
- `tools/shapeTool.js`
- `tools/tilePaintTool.js`

Use a common tool contract:

- `begin(context)`
- `update(context)`
- `end(context)`

### 3) Collaboration system

Decouple runtime collaboration from Firebase details:

- `collab/CollabController.js`
- `collab/transports/FirebaseTransport.js`
- `collab/transports/WebRTCTransport.js`
- `collab/protocol/ops.js`
- `collab/protocol/snapshot.js`

The scene should depend only on:

- `collab.send(op)`
- `collab.requestSnapshot()`
- `collab.onRemoteOp(cb)`

### 4) Protocol normalization

Use explicit op schema with versioning:

```text
{
  v: 1,
  opId,
  clientId,
  ts,
  type,
  payload
}
```

Keep adapter for legacy `diff` keys during migration.

### 5) Persistence separation

Create `storage/SpriteStorage.js` to isolate save/load/autosave and metadata migration.

### 6) UI separation

Move debug signals and import/export prompt flows into dedicated UI services:

- `ui/debugSignals.js`
- `ui/importExportController.js`

## Suggested migration order

1. Extract tool handlers (`penTool`, `selectionTool`) first.
2. Introduce `CollabController` with current Firebase transport.
3. Switch scene networking calls to controller API only.
4. Implement WebRTC transport behind same interface.
5. Add state versioning + migration utilities.
6. Remove legacy direct Firebase coupling from scene.

## WebRTC readiness checklist

- [ ] No direct `server.sendDiff()` usage in scene/tool code.
- [ ] All network emits pass through transport/controller.
- [ ] Snapshot + op replay work transport-agnostically.
- [ ] Presence/cursor/chat messages are protocol-based, not backend-specific.
- [ ] Reconnect and re-sync logic decoupled from backend service.
