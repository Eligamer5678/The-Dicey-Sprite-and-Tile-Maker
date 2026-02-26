#!/usr/bin/env python3
"""
Scan Assets/tiles.png and produce a JSON mapping from 8-bit keys to tile index.

Bit layout (8 bits string):
- first 4 bits = edges in order: top, right, bottom, left
- last 4 bits = corners in order: top-left, top-right, bottom-right, bottom-left

A pixel is considered "solid" if it equals RGBA #4f4f4fff => (79,79,79,255).
Each tile is 16x16; tiles are arranged in a single row.
"""
import json
import os
import sys

try:
    from PIL import Image
except Exception:
    # Try to install Pillow if missing
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow"])
    from PIL import Image

ROOT = os.path.dirname(os.path.dirname(__file__))
IMG_PATH = os.path.join(ROOT, "Assets", "tiles.png")
OUT_PATH = os.path.join(ROOT, "tiles.json")

if not os.path.exists(IMG_PATH):
    print(f"tiles image not found at {IMG_PATH}")
    sys.exit(2)

img = Image.open(IMG_PATH).convert("RGBA")
W, H = img.size
TILE = 16
if H < TILE:
    print("image height smaller than tile size 16")
    sys.exit(2)

cols = W // TILE

SOLID = (79, 79, 79, 255)

def sample_bits(tile_x):
    x0 = tile_x * TILE
    y0 = 0
    # Coordinates relative to tiles (0..15)
    # Edges: top (8,0), right (15,8), bottom (8,15), left (0,8)
    edges_coords = [(8,0),(15,8),(8,15),(0,8)]
    # Corners: top-left (0,0), top-right (15,0), bottom-right (15,15), bottom-left (0,15)
    corners_coords = [(0,0),(15,0),(15,15),(0,15)]

    bits = []
    for (rx, ry) in edges_coords:
        px = x0 + rx
        py = y0 + ry
        bits.append('1' if img.getpixel((px,py)) == SOLID else '0')
    for (rx, ry) in corners_coords:
        px = x0 + rx
        py = y0 + ry
        bits.append('1' if img.getpixel((px,py)) == SOLID else '0')
    return ''.join(bits)

mapping = {}
for i in range(cols):
    key = sample_bits(i)
    # If duplicate keys occur, keep first occurrence but warn
    if key in mapping:
        print(f"warning: duplicate key {key} for tile {i} (existing {mapping[key]})")
    else:
        mapping[key] = i

# Save mapping sorted by integer value of key for readability
out = {k: mapping[k] for k in sorted(mapping.keys(), key=lambda s: int(s,2))}

with open(OUT_PATH, 'w') as f:
    json.dump(out, f, indent=4)

print(f"Wrote {len(out)} entries to {OUT_PATH}")
