#!/usr/bin/env python3
"""
Bit layout (10 bits string):
- first 4 bits = edges in order: top, right, bottom, left
- last 4 bits = corners in order: top-left, top-right, bottom-right, bottom-left
- bit 8 = cliff edge
- bit 9 false = top
- bit 9 true = wall
"""
