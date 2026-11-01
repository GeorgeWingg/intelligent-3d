# Credits

## Libraries and assets

- **three.js**, MIT License. 3D rendering. https://threejs.org
- **MediaPipe Tasks Vision** (`@mediapipe/tasks-vision`) and the **hand_landmarker** model, Apache License 2.0, Google. Hand tracking. https://ai.google.dev/edge/mediapipe
- **Vite**, MIT License. Dev server and build.
- **TypeScript**, Apache License 2.0.
- **Newsreader** (Production Type) and **Source Serif 4** (Adobe), SIL Open Font License 1.1, loaded from Google Fonts.

## Shader references

- The voice orb (`src/orb`, not shown in the final build) is an original implementation inspired by the technique in nimitz's "Protean clouds" (Shadertoy 3l23Rh): a deformed periodic-grid noise volume, density-adaptive step size and a camera moving forward through a soft tunnel. No code from that shader is used.
- An earlier version of the orb was adapted from Liam Egan's 2018 domain-warped fbm CodePen, which uses Inigo Quilez's value noise.

## Ideas

- The interaction idea, a model composing its answer from streamable UI components, comes from OpenAI's "GPT-6 and Intelligent UI" announcement. This project carries that idea into 3D.

## Affiliation

This is an independent hackathon experiment. It is not affiliated with, endorsed by, or sponsored by OpenAI. It uses the Codex CLI as a user would, through the author's own ChatGPT subscription.
