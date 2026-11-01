// Inline stroke icons. Kept as strings so the chat needs no assets.
const svg = (body: string, size: number, sw = 1.5, extra = ''): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

// 16px glyph, 1.5 stroke (drawn on a 24 grid, so stroke scaled up to read as 1.5 at 16px).
export const iconPlus = svg('<path d="M12 4.5v15M4.5 12h15"/>', 18, 1.9);

export const iconMic = svg(
  '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/>',
  18,
  1.9,
);

export const iconMicOff = svg(
  '<path d="M15 9.5V6a3 3 0 0 0-5.6-1.5"/><path d="M9 9v2a3 3 0 0 0 4.6 2.5"/><path d="M18.5 11a6.5 6.5 0 0 1-1 3.4M5.5 11a6.5 6.5 0 0 0 10 5.5"/><path d="M12 17.5V21"/><path d="M4 4l16 16"/>',
  18,
  1.9,
);

export const iconSpeaker = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 9.5h3l4.5-4v13L7 14.5H4z" fill="currentColor"/>
  <path d="M15 9a4 4 0 0 1 0 6"/><path d="M17.8 6.5a7.5 7.5 0 0 1 0 11"/>
</svg>`;

export const iconBolt = svg('<path d="M13 3L5.5 13.5H12L11 21l7.5-10.5H12z"/>', 16, 1.8);

export const iconChevron = svg('<path d="M7 10l5 5 5-5"/>', 14, 2);

// 5-bar waveform: bars 2px wide, 2px gaps, heights 6/12/16/12/6.
export const iconWave = `<svg class="i3d-glyph i3d-g-wave" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
  <path d="M1 7v4"/><path d="M5 4v10"/><path d="M9 2v14"/><path d="M13 4v10"/><path d="M17 7v4"/>
</svg>`;

export const iconSend = svg('<path d="M12 19V5M6 11l6-6 6 6"/>', 17, 2.1, 'class="i3d-glyph i3d-g-send"');

export const iconClose = svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>', 16, 1.9, 'class="i3d-glyph i3d-g-close"');

export const iconCollapse = svg('<path d="M6 9l6 6 6-6"/>', 16, 1.8);
export const iconExpand = svg('<path d="M6 15l6-6 6 6"/>', 16, 1.8);
