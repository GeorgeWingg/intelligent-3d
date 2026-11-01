# Intelligent 3D

**Intelligent UI, made spatial.** You talk to an assistant in a floating window in AR glasses. When an answer is easier to see than to read, it arrives as a drawing inside the chat. Pinch it and pull, and it leaves the window and stands in the room as a 3D object you can turn, take apart and ask about.

The experience is designed around AR glasses such as the **XREAL Aura**. For this demo the wearer's view is simulated: an iPhone camera at eye level supplies the passthrough, and the same feed drives hand tracking. It has not yet been run on the glasses themselves.

Built in a day at the London Codex hackathon, 1 November 2026.

## What it does

- **Chat or talk.** A ChatGPT-style window floats in front of you. Voice runs live through Codex realtime on a ChatGPT subscription, with a labelled browser-speech fallback.
- **The model decides.** Most replies are plain words. When seeing something helps ("show me how a bike's drivetrain works", "break down the parts of XR glasses"), the model streams a scene description, line by line.
- **One answer, two forms.** The same stream draws a flat diagram with system tabs inside the chat *and* builds the 3D object. Nothing is pre-made: the model writes the geometry (tubes, wheels, boxes) and the explanations as it goes.
- **Pull it into the room.** Pinch the drawing and drag it out of the window. The object flies out and settles in the room, with info windows and buttons beside it.
- **Hands.** Pinch and drag to rotate, pull two hands apart to explode it into its systems, and pinch a system or a button to focus it. Windows slide on an arc around you by their grab bars, and always turn to face you.
- **Follow-ups act on what is there.** "Show me the brakes" lifts the brakes out and explains them, without regenerating anything.

## Live, simulated or replayed

| | |
|---|---|
| Scene composition | **Live.** Codex app-server on a ChatGPT subscription (`gpt-6.1-sol`, fast tier) streams NDJSON lines that follow `src/contract.ts`. |
| Voice | **Live.** Codex app-server realtime over WebRTC on the same subscription. If that fails, the browser's Web Speech API takes over, and the on-screen label says so. |
| Hand tracking | **Live.** MediaPipe hand landmarker in the browser, on the camera feed. |
| Glasses view | **Simulated.** The camera video is drawn behind the scene (unmirrored for an outward-facing iPhone, labelled "POV"). There is no world anchoring or depth sensing, so objects stay fixed to the view rather than the room. `?room=virtual` swaps the passthrough for a virtual room, and the camera then drives the hands only. |
| Replay | `?replay=bike` plays a pre-built bike through the same renderer **without calling the model**, and the label says so. It is the offline fallback. |

## Run it

You need macOS, Chrome, Node 22, and the Codex CLI (0.166 or newer) logged in with a ChatGPT account (`codex login`).

```sh
npm install
node scripts/copy-mediapipe.mjs   # MediaPipe wasm runtime -> public/mediapipe-wasm
npm run build
node server/index.mjs             # http://127.0.0.1:4320
```

For development, run `node server/index.mjs` and `npx vite --port 5320` together; Vite proxies `/api` to 4320.

**Camera.** An iPhone connected as a Continuity Camera is picked automatically. If Chrome only lists the built-in webcam, turn off any VPN: it blocks Continuity Camera. `?cam=<name>` picks a camera by label, `?pov=1|0` forces the POV/mirror mode, `?glasses=1` shows the view label, and `?nocam` runs without a camera (mouse only).

If `public/models/hand_landmarker.task` is missing:

```sh
curl -L -o public/models/hand_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
```

**Controls.** Mouse: drag the object to rotate it, scroll to explode it, drag a window by its grab bar, and drag the drawing out of the chat. Keyboard: W/A/S/D to walk, Q/E to go down or up, right-drag to look around, R to reset.

## How Codex was used

**Codex is the runtime, not just the dev tool.**

- **Scene composition.** `server/codex-rpc.mjs` keeps a warm `codex app-server` and talks JSON-RPC to it over stdio, with `-c model_provider="openai"` so it runs on the ChatGPT subscription (no API key; `OPENAI_API_KEY` is removed from the child's environment). Threads are ephemeral and read-only, use `approvalPolicy: never`, and take their instructions from `server/prompt.md`. A spare thread is pre-warmed so that each request skips the 11–17 s first-turn start-up.
- **Realtime voice.** `server/voice.mjs` runs a second app-server with `features.realtime_conversation=true` and passes the browser's WebRTC offer and answer through `thread/realtime/*` (protocol v3). After each build, a description of what is on screen is pushed into the voice session, so the voice can talk about it.

Measured on 1 Nov 2026 on a ChatGPT account:

| Request | First line | Done | Lines valid / dropped |
|---|---|---|---|
| "break down the design of a 7-speed bike" (gpt-6.1-sol, Codex 0.166) | 4.7 s | 33.0 s | 26 / 0 |
| same, gpt-5.6-sol (Codex 0.146) | 2.5 s | 24.6 s | 24 / 0 |
| "show me the brakes" follow-up | 1.2 s | 2.7 s | 4 / 0 |
| Realtime voice session, click to connected | | 3.9 s | WebRTC connected, remote audio |

Raw outputs are in `evidence/`.

## Tools used to build it

- **Codex** helped throughout the day. It ran the product backend described above, and it was also used to plan the idea and research the app-server and realtime APIs. The earlier Glint prototype that this grew out of was built with it too.
- **Claude Code** was used alongside Codex to write code. Several agents worked in parallel on separate modules (scene compiler, hand tracking, chat, voice, server), all sharing the `src/contract.ts` types.
- **Dots** was also used during the day.

All code in this repository was written on 1 November 2026.

## Architecture

```
 iPhone camera ─► passthrough background ─► MediaPipe hands ─► gestures ─┐
                                                                          ▼
 chat / voice ─► POST /api/compose ─► codex app-server ─► NDJSON lines ─► flat drawing in chat
                  (server/index.mjs)   gpt-6.1-sol,                       └► 3D object, info windows,
                                       ChatGPT subscription                  buttons (pull out)

 voice: browser WebRTC ◄─► server/voice.mjs ◄─► codex app-server thread/realtime
```

## Limitations

- Not yet run on XREAL Aura or any other glasses. Objects follow the view, not the room.
- Geometry is built from primitives, so objects are recognisable diagrams rather than detailed models. A full build takes 25–35 s.
- Realtime voice uses an experimental app-server API and can be rough: echo without headphones, and occasional slow starts.
- Hand tracking uses a single RGB camera and struggles in low light or when hands overlap.
- Local only: the server binds to 127.0.0.1 with no authentication.

Inspired by OpenAI's "GPT-6 and Intelligent UI" announcement; not affiliated with OpenAI or XREAL. See `CREDITS.md`.
