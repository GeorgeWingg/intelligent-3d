// The camera feed fills the view with "cover" cropping and is mirrored (selfie view).
// Scene background and hand tracking must both use this mapping so fingertips line up with objects.

export interface CoverFit {
  videoW: number;
  videoH: number;
  viewW: number;
  viewH: number;
  mirror: boolean;
}

// Fraction of the video visible on each axis after cover cropping (1 = full axis visible).
export function coverRepeat({ videoW, videoH, viewW, viewH }: CoverFit): { rx: number; ry: number } {
  const videoAspect = videoW / videoH;
  const viewAspect = viewW / viewH;
  return viewAspect > videoAspect ? { rx: 1, ry: videoAspect / viewAspect } : { rx: viewAspect / videoAspect, ry: 1 };
}

// u, v: normalised video coords as MediaPipe returns them (0..1, origin top-left, unmirrored).
// Returns three.js NDC (x right, y up, -1..1) for the rendered view.
export function videoToNdc(u: number, v: number, fit: CoverFit): { x: number; y: number } {
  const { rx, ry } = coverRepeat(fit);
  const uu = fit.mirror ? 1 - u : u;
  const x = ((uu - 0.5) / rx) * 2;
  const y = -((v - 0.5) / ry) * 2;
  return { x, y };
}
