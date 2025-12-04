*Note: This web app is designed for chromebooks & laptop touchpads, not mice. Panning will not work correctly with mice.*

# Controls

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

*There is no undo/redo stack to warn you, this is just a simple editor.*

#### Spritesheet maker
- Click the '+' to add a frame.
- Color picker in the bottom left.
- Shift click to select, right click/two finger press to cancel selection
- When one pixel is selected, press b for box, or l for line.
- When 2 pixels are selected, press b to select that region.
- Press c to copy, x to cut. The origin is at the cursor when copying, so be sure to place the cusor where you want the origin
- Hold 'v' to paste, you can left click & drag to change origin
- While holding v, you can use r to rotate & f to flip the selection
- Backspace to delete current frame, and undo works here, yay!
- Exports as 1 animation per row, having empty space to the side of the rightmost frames.
- 
- **Latest update**
- Press 'n' to add a bit of noise to the image
- Shift click multiple frames to layer them in the preview, click m to fully merge.
- Useful for stuff like layering or onion skin
- 1-4 keys change brush size
- h & k to modify color
- 6-9 keys to select property to modify, 6=hue,7=saturation,8=value,9=alpha
- j to grab the average color
- up/down keys to move the frame
- '/' to duplicate frame
- f to fill region
- Press the upper left corner to access the console
- *Console commands* (text box on the bottom of the screen), type exactly to use.
- "clear" - *clears logs*
- "resize(sliceSize,resizeContent=true)" - *resizes the canvas*
- "copy(hex)" - *copys pen color*
- "select(hex,buffer)" - *selects all pixels of this color*
- "grayscale()" - grayscales the frame

#### Collision editor
- Hold 'n' to create points. Press space to turn them into a polygon.
- You can shift click to select (may take a few tries)
- Blender-like controls, g to grab, click a vertex then e to extrude, r to rotate.
- c to copy
- yeah thats about it for this, super simple collision editor.

  
