*Note: This web app is designed for chromebooks & laptop touchpads*
#### Game URL: https://eligamer5678.github.io/The-Dicey-Sprite-and-Tile-Maker/

### Welcome to the Dicey pixel art maker!
- This is a web based powerful pixel art tool, designed to speed up asset creation for games, or just have a bit of fun with. 
- There is a lot of hidden functionality via the keyboard - take it slow, you don't need to memorize everything in a day; You ussually only use 20% of a progrmas features to get 95% of the same effect.
- To start of with, left click = draw, right click = erase, shift to select. Click export to export your sprite.
- For tilemaps, hit 't' on your keybaord to enter tilemode, click y to mirror frames to the map, and space to add tiles. When your art is complete, click export, and type 2 in the prompt so it exports as a tilesheet. 


# Controls
#### Spritesheet maker
- Click the '+' to add a frame.
- Color picker in the bottom left.
- Hold ctrl to select color (or middleclick)
- Shift click to select, right click/two finger press to cancel selection
- When one pixel is selected, press b for box, or l for line.
- When 2 pixels are selected, press b to select that region.
- Press c to copy, x to cut. The origin is at the cursor when copying, so be sure to place the cusor where you want the origin
- Hold 'v' to paste, you can left click & drag to change origin
- While holding v, you can use r to rotate & f to flip the selection
- Backspace to delete current frame
- Exports as 1 animation per row, having empty space to the side of the rightmost frames.
- Press 'n' to add a bit of noise to the image 
- Shift click multiple frames to layer them in the preview, click m to fully merge.
- Useful for stuff like layering or onion skin
- Or click 'g' to group them
- Clicking l will convert the group into a layered frame
- Click g on a group to ungroup
- 1-5 keys change brush size
- Pressing a comination like 3 +4 will use the sum as the brush size (pressing 3 & 4 = size 7)
- Shift+1-5 = selection becomes brush
- s to select by color (hold shift to adjust buffer amount)
- alt+s to draw selected
- h & k to modify color (if nothing selected, modifies draw color)
- 6-9 keys to select property to modify, 6=hue,7=saturation,8=value,9=alpha
- u to toggle onion skin; Shift+U to set onion alpha (or layer alpha when multi-selected)
- Shift+Alt+U to set onion range (before,after frames)
- j to grab the average color
- up/down keys to move the frame
- '/' to duplicate frame
- f to fill region
- [ for vertical mirror, and ] for horizontal mirroring
- shift+f to select region
- a to toggle pixel perfect drawing when the pen size is 1 (i.e. cornercutting)
- ctrl + z = Undo
- ` to resize canvas (instead of 16x16)

- Press the upper left corner to access the console

- *Console commands* (text box on the bottom of the screen), type exactly to use.
- "clear" - *clears logs*
- "resize(sliceSize,resizeContent=true)" - *resizes the canvas*
- "copy(hex)" - *copys pen color*
- "select(hex,buffer)" - *selects all pixels of this color* 
- "replace(hex1,hex2,include=[frame|animation|all],buffer=1)"
- "grayscale()" - grayscales the frame
- "toggleOnion" - toggles onion skinning
- "layerAlpha" - multi-select layer & onion skin visibility
- "drawSelected" - draws the selected points
- "save" - save the program (autosaves every 30seconds by default)
- "clearSave" - wipes all save data (WARNING: CANNOT BE UNDONE)
- "enableColab" - Enables realtime online colab with Firebase, so you can edit sprites with freinds!
- "name(username)" - Show a username above your cursor
- "msg(text)" - Message others (shows in the console for other users)

- **Tile mode**
- Press t to enter.
- Press shift+t to choose grid size.
- r to rotate, shift-r to actually rotate the frame data
- alt+f to flip, alt+shift+f to actully flip the frame data
- Press 'y' to mirror the selected frame(s). Toggles between locked-on-frame & selected
- Press space to toggle tile placement

- **Online colab**
- Type enableColab() into the built in console.
- Click create/join/the text box. Clicking anywhere else will make the menu disapear.
- You can type name(Username) to make your cursor show your username.
- msg() to message players.

- **Latest update** - as of 2/9/26
- Updated tile mode: You can now add grid cells with space, mirror multi-selected frames
- Brush size can now go MUCH higher. 
- Custom brush tool: Press a number between 1 & 5 & hold shift at the same time to make selection become the brush shape
- Fixed tile mode laying bug
- Updated line tool to now also be a general polygon tool
- All tools now go across tiles - enjoy your "3d torus" drawing plane.
- Added a keybind for onionskinning
- Improved Noise to use the adjustment percentage and channel
- Added keybinds to adjust adjustment percentage


### Tilemap maker
#### Basic controls
- Click a tile on the right then left click to place
- Shift click a tile to select
- Click 'e' to edit
- When a tile is selected 'l' to draw a line from the selected tile to the cursor
- Similarly, 'b' for box & 'o' for circle. Hold alt to fill.
- 2 finger press (right click) to cancel draw.
- Control-click to copy a tile
- Press r to rotate by 90 degrees, or f to flip,
- Arrow keys to test the level with the cat
- 0 resets the cat's position to (0,0), or 'c' to teleport the cat to the cursor
- You can open the .tar file it exports in most file managers to get the tile designs, or export as image for the sheets.
- The basic house design is perfectly fine to you to use for whatever you want, i don't care.
  
#### Edit mode
- Press escape to exit edit mode.
- Press 1-4 to change brush size
- Hold control to select a color (works across the entire layer)
- Color picker on the left side
- Warning, make sure to create a new tile, otherwise you will edit every copy of the tile your using.

*There is no undo/redo stack in this mode to warn you, this is just a simple editor.*

#### Collision editor
- Hold 'n' to create points. Press space to turn them into a polygon.
- You can shift click to select (may take a few tries)
- Blender-like controls, g to grab, click a vertex then e to extrude, r to rotate.
- c to copy
- yeah thats about it for this, super simple collision editor/physics sim

  
