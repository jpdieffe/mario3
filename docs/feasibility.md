# Original-ROM co-op investigation

Investigated 2026-10-25. Preserve the complete original game as the starting point;
a browser-native recreation limited to World 1 was declined.

## Finding

We have a reproducible, editable source baseline for the exact attached ROM.
That establishes a route to ROM modification. It does **not** establish that the
requested co-op features can be made compatible with every level.

The strongest candidate is a patched ROM plus an extended browser emulator/rendering
layer. Ordinary emulator netplay only supplies controllers to the original game;
it cannot provide the missing second player simulation. Streaming the host's NES
framebuffer gives both people the same view.

## Verified evidence

| Check | Result |
| --- | --- |
| Attachment | Super Mario Bros. 3 (USA) (Rev 1), mapper 4 / MMC3 |
| ROM layout | 16-byte header, 262,144-byte program, 131,072-byte graphics |
| Rebuild | All 393,232 bytes match the attachment, including header |
| Emulator | JSNES 2.1.0 enters World 1-1 via normal controls |
| Snapshot | Two identical 30-frame replays produced identical measured results and internal RAM hashes |
| Second controller | ROM reads right+jump as `$81`; measured player/object state matches idle |
| First controller | After 30 frames, Mario moves from `(24,384)` to `(47,313)` |

The [Southbird source](https://github.com/captainsouthbird/smb3/tree/09b1bd81a788de8ceec664a34094e84ddb463117)
was built locally using its bundled NESASM 3.01. This was a binary comparison with
the attachment, not just a filename/revision assumption.

The runtime check uses headless Node.js with sound emulation disabled. It provides
no evidence yet about iPhone/Android frame rates, audio, network reliability,
long-running synchronization, or other levels. It also does not test the original
game's separate two-player battle mode.

## What the source reveals

| Requirement | Existing engine | Work needed |
| --- | --- | --- |
| Drop-in Luigi | One gameplay player position/velocity record; `Player_Current` selects the current turn | A second complete player context, safe spawn placement, separate inputs and persistent power-up state |
| Bumps and head bounces | Gameplay player interactions primarily target enemies and terrain | Player-versus-player collision detection and ordered resolution, including moving platforms and ceilings |
| Independent views | One horizontal/vertical scroll context | Two render views driven by the same simulation; each must have correct terrain, sprites, palettes and effects |
| Players far apart | Enemy lifetime depends on screen bounds; small fixed actor arrays | Activate and retain objects relevant to both players, without duplicate enemies or silent slot overflow |
| Full game | Pipe transitions, death, transformations and map exits use shared state | Audit these paths for two players, including bosses, autoscrollers, water, vertical levels and bonus rooms |

Specific source locations at the pinned revision:

- [Gameplay RAM definitions](https://github.com/captainsouthbird/smb3/blob/09b1bd81a788de8ceec664a34094e84ddb463117/smb3.asm#L770):
  scalar player state interleaved with object arrays. Copying all RAM for Luigi
  would also copy enemies and the world; selectively separating player state is necessary.
- [Player update](https://github.com/captainsouthbird/smb3/blob/09b1bd81a788de8ceec664a34094e84ddb463117/PRG/prg008.asm#L345):
  update, drawing and global halt conditions are coupled. Calling the whole routine
  twice without refactoring risks updating shared systems twice.
- [Object update](https://github.com/captainsouthbird/smb3/blob/09b1bd81a788de8ceec664a34094e84ddb463117/PRG/prg000.asm#L1775)
  and [off-screen deletion](https://github.com/captainsouthbird/smb3/blob/09b1bd81a788de8ceec664a34094e84ddb463117/PRG/prg000.asm#L4166):
  object management uses the shared scrolling window.
- [Scroll update](https://github.com/captainsouthbird/smb3/blob/09b1bd81a788de8ceec664a34094e84ddb463117/PRG/prg030.asm#L5030),
  [player drawing](https://github.com/captainsouthbird/smb3/blob/09b1bd81a788de8ceec664a34094e84ddb463117/PRG/prg029.asm#L400),
  and [level junctions](https://github.com/captainsouthbird/smb3/blob/09b1bd81a788de8ceec664a34094e84ddb463117/PRG/prg026.asm#L1496)
  identify separate rendering and transition work.

## Existing simultaneous-play hack

[ErikHK/smb32p](https://github.com/ErikHK/smb32p/tree/4e05a875b7b3232effca9a858938d9c7ac080d2b)
is relevant prior work, but does not meet the requested behavior. Source inspection
shows a second character implemented through an Orange Cheep object, with separate
movement routines. `OrangeCheep_DoGameplay` is invoked for object slot four when
it contains that object ID. The hack also edits original enemy placements; World
1-1 replaces its first Goomba with that object and removes another enemy entry.

Evidence: [gameplay hook](https://github.com/ErikHK/smb32p/blob/4e05a875b7b3232effca9a858938d9c7ac080d2b/PRG/prg030.asm#L3367),
[level changes](https://github.com/ErikHK/smb32p/blob/4e05a875b7b3232effca9a858938d9c7ac080d2b/PRG/objects/1-1.asm),
and [state aliases](https://github.com/ErikHK/smb32p/blob/4e05a875b7b3232effca9a858938d9c7ac080d2b/smb3.asm#L1).
These are source findings; this investigation did not playtest that hack.

## Proposed implementation path — not yet proven

1. **Player-state experiment:** patch the verified ROM to maintain Mario and Luigi
   concurrently. Initially test them in one view solely to isolate the simulation
   work. Both must use original terrain physics, interact with the same enemies and
   blocks, and collide with each other. A shared-camera experiment is not the final deliverable.
2. **Independent-camera experiment:** expose enough authoritative world state for
   two render passes. Render-only work must not advance gameplay. Confirm that
   both players can be more than a screen apart, with persistent shared enemies,
   coins, blocks and platforms. Merely overriding the NES scroll register is insufficient.
3. **Full-game audit:** exercise power-ups, pipes, deaths, exits, maps, bosses,
   vertical levels and autoscrollers. Resolve what happens when one player changes
   rooms or dies while the other is still playing. Expanded RAM/object capacity
   may require emulator extensions; a stock-NES-compatible patch is not assumed.
4. **Online integration:** host an authoritative simulation and exchange input/state
   over WebRTC. Joining needs a versioned snapshot plus an input/frame boundary so
   Luigi appears in the host's current scene. Each device renders its own view.
   Keep two-character room-code collision retries. Test real Android and iOS hosting,
   not only desktop mobile emulation.
5. **GitHub Pages release:** add landscape touch controls and publish after the
   gameplay and device checks pass.

GitHub Pages can serve the static client. Room discovery still needs signaling;
some networks also need a relay. [WebRTC's connection model](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Connectivity)
describes those external services. A direct peer connection cannot be guaranteed
on every network by static hosting alone.

The next meaningful milestone is the player-state experiment. Until that and the
separate-view experiment pass, the accurate status is **an investigated approach
with a verified ROM baseline**, not working online co-op.
