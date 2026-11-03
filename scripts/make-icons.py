#!/usr/bin/env python3
"""Draw the College Tracker home-screen icons. Standard library only."""

import os
import struct
import zlib

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
GLYPHS = {
    "C": ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
}


def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path, size, pixels):
    raw = bytearray()
    row = size * 4
    for y in range(size):
        raw.append(0)
        raw.extend(pixels[y * row:(y + 1) * row])
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as handle:
        handle.write(png)


def mix(start, end, ratio):
    return tuple(int(start[index] + (end[index] - start[index]) * ratio) for index in range(3))


def draw(size):
    pixels = bytearray(size * size * 4)
    top = (28, 78, 130)
    bottom = (14, 36, 64)
    for y in range(size):
        color = mix(top, bottom, y / max(1, size - 1))
        for x in range(size):
            index = (y * size + x) * 4
            pixels[index:index + 4] = bytes((*color, 255))

    bar_w = int(size * 0.62)
    bar_h = max(2, int(size * 0.035))
    left = (size - bar_w) // 2
    top_y = (size - bar_h) // 2
    gold = (226, 177, 90, 255)
    for y in range(top_y, top_y + bar_h):
        for x in range(left, left + bar_w):
            index = (y * size + x) * 4
            pixels[index:index + 4] = bytes(gold)

    scale = max(1, round(size * 0.055))
    block_w = 11 * scale
    block_h = 7 * scale
    origin_x = (size - block_w) // 2
    origin_y = (size - block_h) // 2
    ink = (255, 252, 245, 255)

    def stamp(glyph, cell_x):
        for row, bits in enumerate(glyph):
            for col, bit in enumerate(bits):
                if bit != "1":
                    continue
                for dy in range(scale):
                    for dx in range(scale):
                        x = origin_x + cell_x * scale + col * scale + dx
                        y = origin_y + row * scale + dy
                        if 0 <= x < size and 0 <= y < size:
                            index = (y * size + x) * 4
                            pixels[index:index + 4] = bytes(ink)

    stamp(GLYPHS["C"], 0)
    stamp(GLYPHS["T"], 6)
    return pixels


def main():
    os.makedirs(ROOT, exist_ok=True)
    for name, size in (("favicon-32.png", 32), ("apple-touch-icon.png", 180), ("icon-192.png", 192), ("icon-512.png", 512)):
        write_png(os.path.join(ROOT, name), size, draw(size))


if __name__ == "__main__":
    main()
