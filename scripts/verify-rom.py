"""Verify the user-supplied SMB3 PRG1 ROM against a local disassembly build.

Accepts a .nes file or a ZIP containing exactly one .nes file. Nothing is extracted
to disk and the original file is never modified. No third-party Python packages.
"""

import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile, is_zipfile


EXPECTED_SHA256 = "4377a7f5e6eb50bdd2ac6f249bf1a7085500aca8eb41f38545c3a2731c51a579"


def read_rom(path):
    if is_zipfile(path):
        with ZipFile(path) as archive:
            entries = [entry for entry in archive.infolist()
                       if not entry.is_dir() and entry.filename.lower().endswith(".nes")]
            if len(entries) != 1:
                raise ValueError("ZIP must contain exactly one .nes file")
            if entries[0].file_size > 2_000_000:
                raise ValueError("ROM is too large for this SMB3 revision")
            data = archive.read(entries[0])
    else:
        data = path.read_bytes()
    if len(data) < 16 or data[:4] != b"NES\x1a":
        raise ValueError("Input is not an iNES ROM")
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("original", type=Path)
    parser.add_argument("rebuilt", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    original, rebuilt = read_rom(args.original), read_rom(args.rebuilt)
    original_hash = hashlib.sha256(original).hexdigest()
    rebuilt_hash = hashlib.sha256(rebuilt).hexdigest()
    report = {
        "original_bytes": len(original),
        "rebuilt_bytes": len(rebuilt),
        "original_sha256": original_hash,
        "rebuilt_sha256": rebuilt_hash,
        "expected_revision": original_hash == EXPECTED_SHA256,
        "byte_identical": original == rebuilt,
        "payload_identical": original[16:] == rebuilt[16:],
        "mapper": (original[6] >> 4) | (original[7] & 0xF0),
        "prg_bytes": original[4] * 16384,
        "chr_bytes": original[5] * 8192,
    }
    serialized = json.dumps(report, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized, encoding="utf-8")
    print(serialized, end="")
    return 0 if report["expected_revision"] and report["byte_identical"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
