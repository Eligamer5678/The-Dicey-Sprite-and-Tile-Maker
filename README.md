*Note: This web app is designed for chromebooks & laptop touchpads*
#### Game URL: https://eligamer5678.github.io/The-Dicey-Sprite-and-Tile-Maker/

### Welcome to the Dicey pixel art maker!
- This is a web based powerful pixel art tool, designed to speed up asset creation for games, or just have a bit of fun with. 
- There is a lot of hidden functionality via the keyboard - take it slow, you don't need to memorize everything in a day; You ussually only use 20% of a progrmas features to get 95% of the same effect.
- To start of with, left click = draw, right click = erase, shift to select. Click export to export your sprite.
- For tilemaps, hit 't' on your keybaord to enter tilemode, click y to mirror frames to the map, and space to add tiles. When your art is complete, click export, and type 2 in the prompt so it exports as a tilesheet. 


# All controls 
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
- i to keyframe selection (with pixel data)
- shift+i to selected (no pixel data)
- p to swap pallet
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
- f to fill region (or if stuff selected, fill selected)
- ] for vertical mirror, and [ for horizontal mirroring
- shift+f to select region
- a to toggle pixel perfect drawing when the pen size is 1 (i.e. cornercutting)
- ctrl + z = Undo
- ` to resize canvas (instead of 16x16)
- ; grow selection
- ' shrink selection

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
- Made f do fill selected when stuff is selected, as alt+s felt unintuitive
- Make ; grow selection & ' shrink selection

- **Features in development**
- Improved UI
- Selection keyframing, including non 90 degree rotation & flip values
- Multiple tilemaps & tilemap controls
- Synced tilemaps in online colab 
- In-game simulation in tilemode (this will make the previous tilemap maker obsolete, and thus it will be removed)


