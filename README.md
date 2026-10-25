# Mario 3 Together

[Play on GitHub Pages](https://jpdieffe.github.io/mario3/)

An experimental online co-op layer for the complete original Super Mario Bros. 3
USA Revision 1 ROM. Mario hosts; a friend joins as Luigi using a two-character
room code. Both characters run the original game physics, can bump and bounce on
each other, and have independent cameras.

## Play

1. Open the site and choose **Create a room**.
2. Share the two-character code or copy the invitation at the top of the game.
3. Your friend chooses **Join**. They appear beside Mario in the current level.
4. Turn phones sideways. Tap **Sound on** if audio is blocked by the browser.

The host controls the world map. Pipes and level exits take both players together.
A defeated player respawns beside a living partner. **Menu** includes saves stored
on the host device, load, regroup, and leave. The host must keep the tab visible.

Keyboard: arrows move, Z or Space jumps, X runs/holds, Enter starts/pauses, Shift
selects. Touch controls and standard gamepads are supported.

## Implementation and limits

The supplied ROM is preserved in full. A runtime patch coordinates two original
NES simulation contexts on the host, sharing terrain changes and regular actor
state. Each context provides its own camera and player simulation. A compositing
pass draws the partner using the original CHR graphics in world coordinates.
Player collisions update the actual emulated positions and velocities.

PeerJS/WebRTC carries Luigi's controls to the host and Luigi's own rendered video
and audio back. The host sees Mario's view. This is a direct peer connection when
network conditions allow it; PeerJS signaling is external to GitHub Pages. Optional
TURN settings are available in Help for networks that cannot connect directly.

**Co-op remains experimental.** The complete ROM is present, but every world,
boss, special projectile and scripted room has not been validated in co-op.
Special objects outside the regular actor pool can diverge between contexts;
regroup can recover some cases. The two players share room transitions, so they
cannot stay in different pipe subrooms simultaneously. Save before difficult
stages. This is not a standalone hardware-compatible NES patch.

Desktop Chrome and two connected Chrome clients using phone-sized/touch contexts
were tested. Physical Android devices and iOS Safari have not been tested in this
environment. A slower host may reduce game speed because it runs both contexts.

## Development

```sh
npm ci
npm start
npm run check
npm test
npm run test:browser
```

The browser test requires installed Google Chrome and internet access to PeerJS
signaling. It tests real WebRTC media, remote input, separate cameras, suspended
audio at host startup, audio recovery, landscape fit, room capacity, disconnect,
and rejoin. Headless engine tests use the original ROM to exercise drop-in,
collision, terrain/actor synchronization, cameras, death/respawn, alternate-room
state, and saving/loading.

The site is buildless. GitHub Actions runs checks/tests and deploys `site/`.
`node scripts/build-start.mjs` regenerates the initial World 1 map save state
through normal controller input. The runtime uses the vendored emulator source,
including the small patches documented in [THIRD_PARTY.md](THIRD_PARTY.md).

[Initial ROM investigation](docs/feasibility.md) and
[baseline verification](docs/verification.json) are retained as historical records.
The verified ROM SHA-256 is
`4377a7f5e6eb50bdd2ac6f249bf1a7085500aca8eb41f38545c3a2731c51a579`.
