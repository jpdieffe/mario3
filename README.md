# Mario 3 online co-op — original-ROM investigation

Target: the complete Super Mario Bros. 3 ROM, with a second player joining as
Luigi inside Mario's current level, player-to-player bumps and head bounces,
independent cameras, two-character room codes, and landscape phone controls.

**Status: research baseline only. There is no playable co-op build or Pages game
yet.** The original ROM has been rebuilt byte-for-byte and exercised in a
JavaScript emulator. Simultaneous Luigi and independent views are not implemented.

The [investigation](docs/feasibility.md) records what is verified, what needs engine
changes, and the experiments required before promising full-game compatibility.

## Reproduce the baseline

Requires Git, Python 3, Node.js, and npm. The commands below use PowerShell and the
Windows NESASM executable supplied by the pinned Southbird disassembly. On other
platforms, build a compatible [NESASM](https://github.com/camsaul/nesasm) first.

```powershell
npm ci --ignore-scripts
git clone https://github.com/captainsouthbird/smb3.git .research/smb3
git -C .research/smb3 checkout --detach 09b1bd81a788de8ceec664a34094e84ddb463117
Push-Location .research/smb3
.\nesasm.exe smb3.asm
Pop-Location
npm run verify:rom -- "../Super Mario Bros. 3.zip" .research/smb3/smb3.nes --output artifacts/rom-verification.json
npm run probe
```

Substitute your ROM path in the verification command. Both a `.nes` and a ZIP
containing one `.nes` are accepted. `npm run probe -- path/to/verified.nes` accepts
an alternative ROM location. A wrong revision or nonidentical rebuild causes
verification to fail. The probe also checks the ROM hash before running.

The tested ROM is USA Revision 1, 393,232 bytes, SHA-256:

```text
4377a7f5e6eb50bdd2ac6f249bf1a7085500aca8eb41f38545c3a2731c51a579
```

The supplied assembler used for the local rebuild has SHA-256:

```text
d6c16c39e1ffe4b46896726c738b5a8654e9dac3389e4439597582e1b97f4501
```

`artifacts/` holds generated reports. Research checkouts, ROMs, emulator snapshots,
and screenshots stay local and are ignored by Git. The tracked
[verification results](docs/verification.json) contain hashes and measurements only.

## What the runtime probe verifies

It reaches World 1-1 through normal controls, saves a snapshot, and runs three
30-frame branches: idle, controller two holding right+jump, and controller one
holding right+jump. It confirms repeatable snapshot replay and that controller two
is read without changing the measured player/object state. Controller one moves
Mario and makes him jump. This is a stock-ROM control experiment, not a test of
completed co-op or all levels.

Credits: [Southbird's SMB3 disassembly](https://github.com/captainsouthbird/smb3)
([original project](http://www.sonicepoch.com/sm3mix/)),
[ErikHK's simultaneous-play experiment](https://github.com/ErikHK/smb32p), and
[JSNES](https://github.com/bfirsh/jsnes), Apache-2.0.
