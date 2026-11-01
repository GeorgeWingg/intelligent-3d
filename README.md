# Intelligent 3D, an experiment

OpenAI's Intelligent UI idea has the model compose an answer from streamable components instead of plain text. This project tries the same idea in 3D. You chat (or talk) in a floating XR-style window laid over a camera feed. The model streams scene lines (NDJSON, one JSON object per line), and each complete line renders straight away, so an object such as a 7-speed bike assembles part by part while the model is still writing. Hand tracking on the same camera feed lets you rotate, explode and select parts. Follow-ups like "show me the brakes" become actions on the scene that is already there.

Built at the London Codex hackathon, 1 November 2026.

## What is live, simulated or replayed

| Piece | Status |
|---|---|
| Scene composition | **Live.** Codex app-server on the ChatGPT subscription, model `gpt-5.6-sol`, streams scene lines that follow `src/contract.ts`. |
| Voice | **Live** through Codex app-server realtime (WebRTC, ChatGPT subscription). If that fails, it falls back to the browser's Web Speech recognition and `speechSynthesis`, and the mode line on screen says "Voice: browser speech". |
| Hand tracking | **Live.** MediaPipe hand landmarker running in the browser on the camera frames. It handles pinch-drag to rotate, two-hand pinch to explode or scale, and point plus pinch to select. |
| Passthrough | **Simulated.** It is just the camera video drawn behind the 3D scene. There is no world anchoring, no depth and no SLAM. Objects stay fixed to the screen, not to the room. |
| XR | **Not tested on a headset or glasses.** It runs in a desktop browser only. The "floating window" is a 2D/3D layout in the page. |
| Replay | `?replay=bike` plays a pre-built bike fixture (`src/scene/bike-fixture.ts`) through the same renderer. **No model is called.** The mode line says "Replay: pre-built bike, no model". Use it as an offline fallback and as a visual reference for what model output should look like. |

## Setup

You need:

- macOS with Chrome. Tested on a Mac with an iPhone as Continuity Camera.
- Node 22.
- Codex CLI installed and logged in with a ChatGPT account (`codex login`). The server runs `codex` from your `PATH`. Set `CODEX_BIN` to use a different binary.

```sh
npm install
node scripts/copy-mediapipe.mjs   # copies the MediaPipe wasm runtime into public/mediapipe-wasm
npm run build
node server/index.mjs             # http://127.0.0.1:4320
```

Open http://127.0.0.1:4320 and allow camera and microphone access.

The hand model goes in `public/models/hand_landmarker.task`. If it is missing, download it:

```sh
mkdir -p public/models
curl -L -o public/models/hand_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
```

Dev mode with hot reload: run `node server/index.mjs` in one terminal and `npx vite --port 5320` in another, then open http://127.0.0.1:5320. Vite sends `/api` requests to the server on port 4320.

You can change the model, effort and service tier with environment variables: `I3D_MODEL` (default `gpt-5.6-sol`), `I3D_EFFORT` (default `low`) and `I3D_TIER` (default `ultrafast`, `none` to turn it off).

### Camera

If an iPhone is available as a Continuity Camera (wireless, or over USB-C), the app picks it automatically. Otherwise it uses the default camera. The mode line at the bottom shows which camera, hand tracking and voice mode are active.

## How Codex was used

At runtime, Codex is the backend:

- **Scene composition.** `server/codex-rpc.mjs` keeps one warm `codex app-server` process and talks JSON-RPC to it over stdio. It always passes `-c model_provider="openai"` so requests run on the ChatGPT subscription, not an API key (the server also removes `OPENAI_API_KEY` from the child process's environment). Threads are ephemeral, read-only, `approvalPolicy: never`, and use the system prompt in `server/prompt.md`. The server refuses every approval request.
- **Realtime voice.** `server/voice.mjs` starts a second app-server with `features.realtime_conversation=true` and passes the browser's WebRTC offer and answer through `thread/realtime/*`. After each build, a short text description of the scene is pushed into the voice session so that it can talk about what is on screen.

Measured on 1 Nov 2026 with codex app-server 0.146.0 on a ChatGPT account (`evidence/compose-timing.json`, `evidence/voice-realtime.json`):

| Request | First line | First part | Total | Lines (valid / dropped) |
|---|---|---|---|---|
| "break down the design of a 7-speed bike" | 2.5 s | 7.4 s | 24.6 s | 24 / 0 (17 parts, 2 panels, 1 control row) |
| "show me the brakes" (follow-up) | 1.2 s | n/a | 2.7 s | 4 / 0 |
| Realtime voice session start | | | 7.8 s to listening | WebRTC connected, remote audio present |

A new thread's first turn spends 11 to 17 s starting up, so the server keeps a spare thread that has already run a warm-up turn. A real request then lands on that thread's second turn. `gpt-6.1-sol` and `gpt-5.5` were rejected for ChatGPT-account Codex, which is why the default is `gpt-5.6-sol`.

During development, the app was built by several coding agents working in parallel on separate modules (scene compiler, hand tracking, chat surface, voice, orb, server), all sharing the `src/contract.ts` types.

## Architecture

```
 iPhone camera ──► <video> (passthrough background)
        │                 │
        │                 └─► MediaPipe hands ──► gestures ──┐
        ▼                                                    ▼
  chat / voice ──► POST /api/compose ──► server/index.mjs   three.js scene
                                            │                ▲
                                            ▼                │ NDJSON SpecLines
                                codex app-server (stdio)  ───┘ (assembly, part,
                                model_provider=openai          panel, controls,
                                gpt-5.6-sol, ChatGPT sub       action, say, done)

  voice: browser WebRTC ◄──► server/voice.mjs ◄──► codex app-server thread/realtime
         fallback: Web Speech + speechSynthesis
```

## Limitations

- The passthrough is not AR. Objects do not track the room, and nothing has been tried on a headset or glasses.
- Everything is built from primitives (tubes, cylinders, tori, boxes, spheres). Models are rough and the quality depends on the prompt.
- A full build takes about 25 s. The first part shows up after about 7 s.
- If you send requests within about 12 s of each other, the second one can land on a spare thread that is still warming up and has to wait.
- Realtime voice uses an experimental app-server API (`thread/realtime/*`, `experimentalApi: true`), which may change between Codex versions.
- Hand tracking runs on the CPU from a single RGB camera. It loses track in low light and when hands overlap.
- Local only. The server binds to 127.0.0.1 and has no authentication.

See `CREDITS.md` for third-party work and attribution.
