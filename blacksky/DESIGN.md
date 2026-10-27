# BLACKSKY COMMAND — design system (minimum complete set)

**Idea.** Seen from above at night, a grid is the lights it keeps on. BLACKSKY draws every load bus as a small symbolic demand facility whose
roof plates are lit in proportion to the demand the engine says is still served. When the cascade sheds load, those lights go out — the sky
goes black where the model says it does, and nowhere else. Everything else stays dark graphite so the few meaningful signals carry.

## Colour (tokens in `site/index.html` `:root`, mirrored in `site/js/palette.js`)
| token | value | meaning — used only for this |
|---|---|---|
| `--bg` / `--bg-1` / `--bg-2` | `#07080a` / `#0d0f12` / `#14171b` | scene, chrome, panels |
| `--line` / `--line-2` | `#22262c` / `#2f343b` | 1 px separators |
| `--tx-1..3` | `#eef0f2` / `#a9b0b8` / `#808892` (5.35 : 1 on panels) | important values / secondary / helper text |
| `--ice` | `#7cc4e8` | selection, focus, navigation (neutral) |
| `--amber` | `#f2a93b` | actual overloads (> 100 %) and the 80–100 % warning band (dimmer) |
| `--red` | `#e0443a` | actual trips, initial outages, failed states |
| `--green` | `#5fbf86` | generators online, verified checks |
| `--grey` | `#565d66` | inactive, de-energised, unknown, unavailable |
| `--lamp` | `#ffd39a` | served demand (roof plates); intensity = served fraction |

## Type
Archivo (vendored, OFL) for all text; JetBrains Mono (vendored, OFL) for identifiers and numbers with tabular figures. Scale 12 / 13 / 15 /
18 / 28. Sentence case everywhere except the wordmark and 11 px section labels.

## Layout
Full-bleed scene. 52 px command bar (wordmark, three modes, network, status, Overview). 96 px playback dock (transport, scrubber with stage
markers, current event). One contextual panel per mode (Theater: stage card left; Autopsy: inspector right; Arena: builder left). Panels
collapse; the scene always keeps most of the window.

## Visual grammar (procedural, instanced)
bus = octagonal graphite pad with a light cap (energised) or dark cap (de-energised); generator = slender housing with a green status ring
(online) or grey ring (isolated); demand facility = three blocks with lamp plates; transformer = mid-span block; branch = conductor arc
(neutral graphite; amber when loaded ≥ 80 %, thicker above rating; removed and drawn as a red dashed ghost when out — initial outages carry
cut markers and a T0 tag, cascade trips an R n tag); selection = ice outline + label; island = faint ground disc + island tag.

Light pools: an additive radial patch under each facility, intensity = served fraction. It is the only emitted light in the scene and it
encodes data; nothing else glows. Cascade-trip ghosts are thin, short-dashed and dark red so the three bright initial-outage ghosts (with cut
markers and T0 tags) stay dominant (Review 1).

## Chrome
Readout strip (top of the scene, centred in the area no panel covers): Showing (≥ 1500 px), Demand served with a lamp bar, Buses dark,
Branches out, Islands or Components, Round. Theater opens with a computed brief: final unserved share in lamp-coloured 40 px figures plus
one sentence with rank, ties, N, k and rounds (Review 3). Legend collapsible, open from 1600 px, always repeated in Help.

## Motion
Only state changes move: camera transitions (700 ms, disabled under reduced motion), round transitions, and flow chevrons (direction and
loading; frozen on slow renderers, static under reduced motion). No pulses, flashing, particles, shakes or countdowns.
