# Chat surface UI spec (close-in-feel, unbranded)

Purpose: rebuild a chat surface that feels like the current ChatGPT/Codex desktop chat in the
user's warm dark olive theme, plus its voice mode. Do not copy logos, product names
("Codex", "ChatGPT", "GPT-x"), or assets. Use your own product name and model label.

## Sources and confidence

- **S1** `images/1.png` (1368x1668 px): chat with inline generated game, composer.
- **S2** `images/2.png` (754x640 px): voice mode active, orb above composer.
- **V** YouTube "GPT-Live-1.1 has new voices and better accents." (GyO8Ao7yKJc, 40.8 s,
  480p, watched muted, frames sampled). Light-theme iPhone voice screens, not the dark theme.
- openai.com/index/gpt-6-for-everyone returned HTTP 403 to fetch; nothing used from it.
- **Scale assumption:** both screenshots are 2x retina. All CSS px below = screenshot px / 2.
  S1 viewport is about 684 CSS px wide.
- Tags: **[measured]** = sampled pixel or measured geometry from S1/S2; **[observed V t=..]** =
  seen in a video frame; **[inferred]** = best guess, not seen. Treat inferred motion
  numbers as starting values to tune.

## 1. Palette [measured from S1/S2 pixels]

| Token | Hex | Where |
|---|---|---|
| `--bg` | `#0d1002` | page background (near-black olive) |
| `--bg-sunken` | `#111305` | chip fill (barely lifted off bg) |
| `--line-faint` | `#191b0b` | chip border, faint dividers |
| `--track` | `#202111` | progress track fill |
| `--rule` | `#232313` | ground line / hr |
| `--composer` | `#32301e` | composer fill |
| `--composer-edge` | `#3f3d2c` | composer 1px border (outer), inner ring `#353322` |
| `--text` | `#cfb896` | body text, bold text, icons, model name. Same tan as accent |
| `--text-muted` | `#81745b` | meta lines ("Worked for 1m 28s"), subtitles ("2 players · same keyboard") |
| `--text-dim` | `#908166` | secondary composer labels (effort "Light/High", chevron, speaker, muted mic) |
| `--placeholder` | `#615942` | composer placeholder |
| `--text-disabled` | `#5b533d` | disabled chip label |
| `--accent` (tan) | `#cfb896` | filled buttons ("Start race"), round voice button, voice-close X button |
| `--on-accent` | `#262616` | icon/text on tan (waveform, X); button text can go to `#0d1002` |
| `--warn` (orange) | `#ef8b57` | permission shield icon + "Full access" label |
| `--orange-art` | `#e79f66` | illustration orange (player 2) |
| `--blue-art` | `#cbe6f3` | illustration pale blue (player 1, frame) |
| `--orb-deep` | `#5b7fe8` | orb rim / deep sky (edge samples `#7090ec`, `#85a0ee`) |
| `--orb-mid` | `#cdd7f8` | orb mid cloud |
| `--orb-light` | `#e8edfc` | orb cloud highlights (near white, faint blue) |

Notes: text and accent are the same tan; hierarchy comes from weight and the muted browns,
not from a second hue. Orange is used only for the permission/warning affordance.

## 2. Typography

- **Face:** everything (body, meta, composer, buttons, chips, numbers) is one transitional
  text serif with sturdy serifs and fairly large x-height. Closest free options:
  **Source Serif 4** (opsz 12-20) first choice, then **Literata** or **Newsreader**.
  Fallback stack: `"Source Serif 4", Charter, "Bitstream Charter", Georgia, serif`. [inferred match]
- Numerals: lining, proportional ("0 / 300 m", "45.0 s"); thin spaces around "/" look like
  normal spaces. Use `font-variant-numeric: lining-nums tabular-nums` for live counters.

| Role | Size | Weight | Line height | Color |
|---|---|---|---|---|
| Body / assistant text | 14px | 400 | 20px (1.43) [measured: baseline step 40 px @2x] | `--text` |
| Bold inline | 14px | 600-700 (S1 looks ~650) | inherit | `--text` |
| Meta line "Worked for 1m 28s" | 13px | 400 | 18px | `--text-muted` |
| Block title "Tandem dash" | 13px | 650 | 18px | `--text` |
| Block subtitle "2 players · same keyboard" | 13px | 400 | 18px | `--text-muted`, 10px left gap |
| Composer placeholder | 13.5px | 400 | 20px | `--placeholder` |
| Composer model label | 12.5px | 400 name / 400 effort | 16px | name `--text`, effort `--text-dim`, 6px gap |
| Buttons / chips | 12px | 400 | 16px | see section 3 |

Paragraph spacing: 12px (baseline-to-baseline across paragraphs ~32 CSS px).
No letter-spacing changes, no uppercase, no eyebrow labels.

## 3. Message layout

- **Column:** single column, left-aligned, content max-width ~660px (S1 content spans 7px to
  666px of a 684px viewport, i.e. ~7-8px gutters in that narrow pane). Use
  `max-width: 680px; margin: 0 auto; padding: 0 16px`.
- **Assistant turn:** no bubble, no avatar, no name. Plain text on `--bg`. [measured]
- **Meta line** ("Worked for 1m 28s") sits between the generated UI and the final reply,
  muted, 12px above / 16px below. It is a collapsed disclosure for the work trace
  (click to expand; inferred).
- **User turn** (not in S1; [inferred] from current ChatGPT/Codex): right-aligned bubble,
  max-width ~70%, fill a step above bg (use `#1d1e10` or `--composer` at 70%), radius 18px,
  padding 8px 14px, same serif 14/20, `--text`.
- **Spacing between turns:** ~32px; between paragraphs 12px; between a generated-UI block
  and surrounding text ~24-28px.
- **Inline generated-UI block:** no card frame, no background. It renders straight onto the
  page bg, as if part of the document. Elements seen:
  - Header row: bold title + muted subtitle on one baseline.
  - Stat row: three values, left / center / right justified, 14px `--text`, 24px below header.
  - Progress bar: full width, height 8px (16 px @2x), radius 999px, track `--track`, fill `--accent`.
  - Illustration: flat vector, tan/blue/orange, thick round-cap strokes (~5-6px), dotted chain.
  - **Chip / ghost button** ("Player 1 · tap A"): height 30px, padding 0 10px, radius 8px,
    border 1px `--line-faint` (`#191b0b`), fill `--bg-sunken` (`#111305`), label 12px
    `--text-disabled` when idle/disabled; active state label `--text`, border `#3f3d2c`.
  - **Primary button** ("Start race"): tan fill `--accent`, label `#0d1002`-ish dark,
    12px/400, height ~25px (50 px @2x), width hugs text (~61px; padding 0 10px), radius 8px.
    Followed by a 12px gap then a plain 14px helper sentence on the same line.

## 4. Composer [measured from S1, S2]

- **Shape:** tall rounded rectangle, two rows, NOT a pill. Width = column width (~659px in S1),
  height 108px (216 px @2x) at rest, grows with text up to ~40vh then scrolls.
- **Radius:** 24px (corner fit to S1 edge pixels: radius ~48 px @2x).
- **Fill/border:** fill `#32301e`; border 1px `#3f3d2c` (outer hairline), optional inner
  1px ring `#353322` via `box-shadow: inset 0 0 0 1px #353322`. No drop shadow visible.
- **Position:** pinned to the bottom with ~8-12px margin below; content scrolls behind it.
  The bg continues under it (no separate footer band).
- **Row 1 (text):** padding 20px 13px 0 13px; placeholder "Ask anything" style text in
  `--placeholder` (S1 says "Work with Codex"; use your own wording). Caret `--text`.
- **Row 2 (controls):** sits 14px above the bottom edge; vertical center ~26px from bottom.
  - Left: `+` icon (16px, stroke 1.5px, `--text`) at x=24px center; then 28px gap; shield
    icon (16px, stroke 1.5px, rounded shield with "!" ) in `--warn` + label "Full access"
    13px `--warn`, 6px gap. Make the label your own ("Full access" is fine generic text).
  - Right, from left to right: bolt icon (filled, 14px, `--text`), model name `--text`,
    effort word `--text-dim`, chevron-down 10px stroke 1.5 `--text-dim` (gap 10px);
    then 28px gap; mic icon 18px stroke 1.6 `--text`; then 24px gap; **voice button**:
    circle 32px (61 px @2x), fill `--accent`, 5-bar waveform glyph in `--on-accent`
    (bars 2px wide, heights ~6/12/16/12/6px, round caps, 2px gaps). Right inset 16px.
  - All controls are icon-only hit targets of 32px even if the glyph is 16-18px.
- **Send:** when text is present the round tan button becomes an up-arrow send (same circle)
  [inferred from current ChatGPT behaviour].
- **Voice-active variant [measured S2]:** composer shape, fill and placeholder unchanged;
  the left shows only `+` and the orange shield icon (label hidden in the narrower pane).
  The right becomes: model label (unchanged) -> **speaker** icon (filled cone + 2 arcs, 18px,
  `--text-dim`) -> **mic with slash** (18px, stroke 1.6, `--text-dim`, means mic muted
  toggle) -> **close button**: 32px tan circle (`--accent`), X glyph 12px stroke 1.6
  `--on-accent`. The tan circle sits where the waveform button was (the waveform morphs to X).

## 5. Voice orb

Observed:
- **Size/placement [measured S2]:** perfect circle, ~100px diameter (200 px @2x), horizontally
  centered over the composer, bottom edge ~22px above the composer's top edge. Chat
  transcript area above is empty/hidden while voice is up (S2 shows only bg).
- **Texture [measured S2]:** a sky: saturated cornflower blue (`#5b7fe8`..`#85a0ee`) at the
  upper-left rim, a soft white cloud mass sweeping diagonally from upper-right to lower-left
  through the center (`#e8edfc`), lighter periwinkle (`#cdd7f8`) at lower right. Feathered
  cloud edges, no hard specular highlight, very thin darker rim (anti-aliased edge, no stroke).
  Reads like a photo of cloudy sky masked into a circle, not a gradient blob.
- **Per-voice colour [observed V t=4, t=10, t=15, t=26]:** the orb keeps the same cloud
  texture but changes palette per voice: blue/white sky (t=4), teal/aqua (t=10),
  black-and-white monochrome (t=15), lilac/purple (t=26). Light theme in the video: white
  screen, orb centered mid-screen at roughly 1/3 of phone width, pill composer
  ("Ask ChatGPT" + mic + blue round button) at the bottom (t=2). End card lilac `#8391f3`
  ("Try ... Voice", t=38.5).

Inferred (not verifiable from stills; tune by eye):
- **Build:** render the orb as a circle with a moving cloud texture: either a 2D canvas /
  WebGL fragment shader (fbm noise, 2-3 octaves, domain-warped, mapped through a 3-stop
  palette deep->mid->light) or a large cloud image panned inside `overflow:hidden;
  border-radius:50%`. Texture drifts slowly (one full traverse ~12-20 s), always on.
- **Idle / connecting:** gentle breathing scale 1.00 <-> 1.03, 3.2 s ease-in-out infinite;
  cloud drift slow.
- **Listening (user speaking):** scale tracks smoothed mic RMS: `scale = 1 + 0.12*level`
  with attack ~60 ms / release ~250 ms (one-pole smoothing), cloud drift speed x1.5.
  When the mic is muted, freeze level at 0 and dim saturation ~20%.
- **Speaking (assistant audio):** same mapping driven by output-audio RMS (AnalyserNode on
  the playback stream), slightly larger gain (0.15) and faster cloud swirl, so the orb
  visibly "talks". Thinking/processing between turns: slow pulse 1.00<->1.05 at 1.2 s.
- **Enter:** orb scales from 0.6 and fades in, 350 ms `cubic-bezier(0.2, 0.8, 0.2, 1)`;
  the waveform button cross-fades/rotates into the X (200 ms). Transcript fades out 200 ms.
- **Exit (X):** orb scales to 0.8 + fades out 250 ms ease-in; composer controls swap back;
  transcript fades in. Spoken turns appear as normal messages afterwards.

## 6. Motion [all inferred unless noted; ChatGPT-like defaults]

| Element | Spec |
|---|---|
| Streaming text | Append tokens as they arrive; each new chunk fades `opacity 0 -> 1` over 180 ms ease-out (optionally `filter: blur(2px) -> 0`). No typewriter caret. Keep scroll pinned to bottom unless the user scrolled up. |
| Status shimmer ("Working…", "Thinking") | Text in `--text-muted` with a moving highlight: `background: linear-gradient(90deg, #81745b 0%, #cfb896 50%, #81745b 100%); background-size: 200% 100%; -webkit-background-clip: text; color: transparent; animation: shimmer 1.8s linear infinite` (background-position 100% -> -100%). Settles into the static "Worked for 1m 28s" line when done. |
| Message entry | New turn: `opacity 0, translateY(6px)` -> `1, 0` over 220 ms `cubic-bezier(0.2,0.8,0.2,1)`. User bubble same, 160 ms. |
| Generated-UI block reveal | Fade + rise 8px, 300 ms; stagger children 40 ms (header, stats, art, controls). |
| Button press | `:active { transform: scale(0.96) }` 100 ms ease-out, release 160 ms; hover on tan buttons lightens fill ~6% (`#d8c3a3`); ghost chips hover border `#3f3d2c`. |
| Composer | Height auto-grows with 120 ms ease; focus adds no glow, at most border `#4a4733`. |
| Icon swaps (send <-> voice <-> X) | Cross-fade + scale 0.8 -> 1, 160-200 ms. |
| Progress bar fill | `transition: width 120 ms linear` while live. |

Respect `prefers-reduced-motion`: disable shimmer sweep (static muted text), orb keeps level
response but no breathing, message entry becomes a plain 120 ms fade.
