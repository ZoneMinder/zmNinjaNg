#!/usr/bin/env python3
# Regenerates Tests/MjpegKitTests/Fixtures. Frame n has size SIZES[n] and
# byte j = (n*31 + j*7) % 256; the tests and the Android parser tests rebuild
# the same bytes from that formula.
import os

B = b"--ZoneMinderFrame"
SIZES = [300, 1000, 5000]
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Tests/MjpegKitTests/Fixtures")

def frame(n):
    return bytes((n * 31 + j * 7) % 256 for j in range(SIZES[n]))

def with_length(n):
    f = frame(n)
    return B + b"\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n" % len(f) + f + b"\r\n"

def without_length(n):
    return B + b"\r\nContent-Type: image/jpeg\r\n\r\n" + frame(n) + b"\r\n"

files = {
    "clean-three.bin": b"".join(with_length(n) for n in range(3)),
    # the closing boundary lets the parser know frame 1 is complete
    "no-content-length.bin": without_length(0) + without_length(1) + B + b"\r\n",
    "truncated.bin": with_length(0) + with_length(1) + with_length(2)[:-2000],
}
os.makedirs(out, exist_ok=True)
for name, data in files.items():
    with open(os.path.join(out, name), "wb") as fh:
        fh.write(data)
