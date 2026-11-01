// Shared contract between the server's scene stream, the 3D compiler, hands and chat.
// The model streams NDJSON: one SpecLine per line. Each complete line renders immediately,
// so an object assembles part by part while the model is still writing.

export type Vec3 = [number, number, number];

export type Shape =
  | { kind: 'tube'; from: Vec3; to: Vec3; radius: number }
  | { kind: 'cylinder'; position: Vec3; rotation?: Vec3; radius: number; length: number }
  | { kind: 'torus'; position: Vec3; rotation?: Vec3; radius: number; tube: number }
  | { kind: 'box'; position: Vec3; rotation?: Vec3; size: Vec3 }
  | { kind: 'sphere'; position: Vec3; radius: number };

export interface SystemSpec {
  id: string;
  label: string;
  summary: string; // one or two sentences, shown when the system is focused
  explode: Vec3; // offset (metres, model space) applied at full explode
  color?: string;
}

export type Action =
  | { op: 'explode'; amount: number } // 0 = assembled, 1 = fully exploded
  | { op: 'focus'; system: string | null } // lift one system out, dim the rest
  | { op: 'rotate'; y: number } // radians, relative
  | { op: 'reset' };

export type SpecLine =
  // Start (or replace) an object. Units are metres; the object is centred near the origin.
  | { t: 'assembly'; id: string; title: string; systems: SystemSpec[] }
  | { t: 'part'; assembly: string; id: string; label: string; system: string; color?: string; shapes: Shape[] }
  // A floating text panel, anchored beside a system or at a position.
  | { t: 'panel'; id: string; title: string; body: string; anchor?: string; position?: Vec3 }
  // Tappable buttons in space that run actions.
  | { t: 'controls'; id: string; anchor?: string; buttons: { label: string; action: Action }[] }
  // Apply an action to the current scene (used for follow-up requests like "show me the brakes").
  | { t: 'action'; action: Action }
  // Spoken / chat reply text from the assistant.
  | { t: 'say'; text: string }
  | { t: 'clear' }
  | { t: 'done' };

export interface PickResult {
  partId: string;
  systemId: string;
  label: string;
}

export interface SceneApi {
  apply(line: SpecLine): void;
  act(action: Action): void;
  clear(): void;
  // ndc: normalised device coords, x/y in [-1, 1], y up (three.js convention)
  pick(ndcX: number, ndcY: number): PickResult | null;
  hover(ndcX: number | null, ndcY?: number): void;
  rotateBy(dx: number, dy: number): void; // radians
  explodeBy(delta: number): void;
  scaleBy(ratio: number): void;
  // Compact description of what is on screen, sent to the model with follow-up requests.
  describe(): string;
}

// Gesture events produced by the hand tracker. Coordinates are NDC in the rendered view.
export type HandEvent =
  | { type: 'pinchstart'; hand: 'Left' | 'Right'; x: number; y: number }
  | { type: 'pinchmove'; hand: 'Left' | 'Right'; x: number; y: number; dx: number; dy: number }
  | { type: 'pinchend'; hand: 'Left' | 'Right'; x: number; y: number }
  | { type: 'twohand'; spread: number; delta: number } // both hands pinching; delta = change in distance (NDC units)
  | { type: 'point'; hand: 'Left' | 'Right'; x: number; y: number } // index tip position, not pinching
  | { type: 'lost' };

export interface ChatApi {
  addUser(text: string): void;
  // Returns a handle to stream assistant text into one message.
  startAssistant(): { append(text: string): void; done(meta?: string): void };
  setStatus(text: string | null): void; // e.g. "Building in 3D…"
  setListening(on: boolean, partial?: string): void;
  onSubmit(cb: (text: string) => void): void;
  onVoiceToggle(cb: () => void): void;
}
