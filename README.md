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

Optional weapon toggles sit below Select and Start. Each player can equip a
**rocket launcher**, **sniper rifle**, or **assault rifle**; tap the same button
again to put it away. Keyboard shortcuts are **1 / 2 / 3**. While equipped, hold
**B / X** to fire and run. Up/down aims vertically; combine it with left/right to
aim diagonally. Ammunition is unlimited, and each weapon has its own firing rate.
Rockets explode and destroy ordinary bricks, ice blocks and giant breakable bricks.
Sniper shots pierce ordinary enemies at long range; the assault rifle fires rapidly.
Shots stop at terrain. Partners, power-ups, bosses and level mechanisms are protected.
The host simulates all shots and terrain changes for both views, including solo
play before a friend joins. Weapon selection and destroyed terrain survive saves.

If a phone finds the room but cannot connect on the same Wi-Fi, check its browser's
system permissions. On Android 17 or newer, open **Settings > Apps > Chrome (or
your browser) > Permissions** and allow **Nearby devices / Local network**. Then
reopen the game and join again. A browser's site-level permission is separate from
this Android permission. Android can block local traffic while ordinary internet
access continues to work; see [Android's local network permission documentation](https://developer.android.com/privacy-and-security/local-network-permission).
Networks that block direct connections may still require a TURN relay in Help.

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

Desktop Chrome and a physical Pixel 9 running Android 17 / Chrome 155 were tested
over Wi-Fi, with both devices taking turns hosting. After granting Chrome's Android
local-network permission, joining, live video, the audio track, remote jumping and
button release passed in both directions. The Pixel received about 31 video frames
per second and delivered about 29 when hosting in the measured samples. USB was
used for debugging only; gameplay used the Wi-Fi peer connection. iOS Safari has
not been tested here. A slower host may reduce game speed because it runs both contexts.

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
state, and saving/loading. Weapon tests cover firing rates, shared brick removal,
enemy hits, wall collisions, input validation, release/disconnect, and save/scene
cleanup. The two-browser test also fires a rocket with a touch press from Luigi's
client and verifies the brick is removed from both original-ROM simulations.

The site is buildless. GitHub Actions runs checks/tests and deploys `site/`.
`node scripts/build-start.mjs` regenerates the initial World 1 map save state
through normal controller input. The runtime uses the vendored emulator source,
including the small patches documented in [THIRD_PARTY.md](THIRD_PARTY.md).

[Initial ROM investigation](docs/feasibility.md) and
[baseline verification](docs/verification.json) are retained as historical records.
The verified ROM SHA-256 is
`4377a7f5e6eb50bdd2ac6f249bf1a7085500aca8eb41f38545c3a2731c51a579`.
