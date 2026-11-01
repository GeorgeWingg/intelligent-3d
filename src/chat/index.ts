import './chat.css';
import type { ChatApi } from '../contract';
import {
  iconBolt,
  iconChevron,
  iconClose,
  iconCollapse,
  iconExpand,
  iconMic,
  iconMicOff,
  iconPlus,
  iconSend,
  iconSpeaker,
  iconWave,
} from './icons';

export type { ChatApi };

const NEAR_BOTTOM_PX = 96;
const NARROW = '(max-width: 899px)';
const MODEL_LABEL = 'GPT-6.1 Sol';
const MODEL_EFFORT = 'High';
const PLACEHOLDER = 'Ask for anything with parts';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

/**
 * Incremental renderer for streamed assistant text. Supports paragraphs (blank line),
 * line breaks, and **bold**. Text is appended as new nodes; nothing already shown is re-rendered.
 * A trailing "*" or "\n" is held back until the next chunk so markers split across chunks still work.
 */
class StreamWriter {
  private para!: HTMLParagraphElement;
  private target!: HTMLElement; // current inline container (paragraph or <strong>)
  private bold = false;
  private pending = '';
  private paraHasText = false;

  constructor(private readonly host: HTMLElement) {
    this.newPara();
  }

  private newPara(): void {
    this.para = el('p');
    this.host.appendChild(this.para);
    this.paraHasText = false;
    this.target = this.para;
    if (this.bold) this.openBold();
  }

  private openBold(): void {
    const strong = el('strong');
    this.para.appendChild(strong);
    this.target = strong;
  }

  private emit(text: string): void {
    if (!text) return;
    const span = el('span', 'i3d-tok');
    span.textContent = text;
    this.target.appendChild(span);
    this.paraHasText = true;
  }

  write(chunk: string, final = false): void {
    let s = this.pending + chunk;
    this.pending = '';
    if (!final) {
      // Hold back a possibly incomplete marker at the end.
      const m = /(\*|\n)$/.exec(s);
      if (m) {
        this.pending = m[1];
        s = s.slice(0, -1);
      }
    }
    let buf = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '*' && s[i + 1] === '*') {
        this.emit(buf);
        buf = '';
        this.bold = !this.bold;
        if (this.bold) this.openBold();
        else this.target = this.para;
        i++;
      } else if (c === '\n') {
        this.emit(buf);
        buf = '';
        if (s[i + 1] === '\n') {
          while (s[i + 1] === '\n') i++;
          if (this.paraHasText) this.newPara();
        } else if (this.paraHasText) {
          this.target.appendChild(el('br'));
        }
      } else {
        buf += c;
      }
    }
    this.emit(buf);
    if (final) {
      // Drop an empty trailing paragraph.
      if (!this.paraHasText && this.para.parentNode && this.host.childElementCount > 1) this.para.remove();
    }
  }
}

let modeLineEl: HTMLDivElement | null = null;

/** Small honest line bottom-left describing how the demo is running. Empty string hides it. */
export function setModeLine(text: string): void {
  if (!modeLineEl) {
    modeLineEl = el('div', 'i3d-mode');
    modeLineEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(modeLineEl);
  }
  modeLineEl.textContent = text;
}

export interface ChatExtras {
  /** Collapse the panel to just the composer (or expand it). */
  setCollapsed(on: boolean): void;
}

export function createChat(root: HTMLElement): ChatApi & ChatExtras {
  root.classList.add('i3d-chat');
  root.innerHTML = '';
  root.setAttribute('role', 'complementary');
  root.setAttribute('aria-label', 'Chat');

  const iconBtn = (cls: string, html: string, label: string): HTMLButtonElement => {
    const b = el('button', `i3d-icon ${cls}`, html);
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    return b;
  };

  // Collapse control (top-right of the open panel)
  const head = el('div', 'i3d-head');
  const collapseBtn = iconBtn('i3d-collapse', iconCollapse, 'Hide conversation');
  head.appendChild(collapseBtn);

  // Messages
  const scroll = el('div', 'i3d-scroll');
  const log = el('div', 'i3d-log');
  log.setAttribute('aria-live', 'polite');
  const empty = el(
    'div',
    'i3d-empty',
    'What should we build?<span>Ask for anything with parts, like a 7-speed bike, and it assembles in the room with you.</span>',
  );
  log.appendChild(empty);
  scroll.appendChild(log);

  // Footer: peek (collapsed only), status, composer
  const foot = el('div', 'i3d-foot');
  const peek = el('button', 'i3d-peek');
  peek.type = 'button';
  peek.title = 'Show conversation';
  const status = el('div', 'i3d-status');
  const statusText = el('span', 'i3d-status-text');
  status.appendChild(statusText);

  const composer = el('form', 'i3d-composer');
  const input = el('textarea', 'i3d-input');
  input.rows = 1;
  input.placeholder = PLACEHOLDER;
  input.setAttribute('aria-label', 'Message');

  const row = el('div', 'i3d-row');
  const left = el('div', 'i3d-row-l');
  const right = el('div', 'i3d-row-r');
  const plusBtn = iconBtn('i3d-plus', iconPlus, 'Add');
  const expandBtn = iconBtn('i3d-expand', iconExpand, 'Show conversation');
  left.append(plusBtn, expandBtn);

  const model = el('button', 'i3d-model', `${iconBolt}<span class="i3d-model-name">${MODEL_LABEL}</span><span class="i3d-model-effort">${MODEL_EFFORT}</span>${iconChevron}`);
  model.type = 'button';
  model.title = 'Model';
  const speakerBtn = iconBtn('i3d-speaker i3d-voice-only', iconSpeaker, 'Speaker');
  const micBtn = iconBtn('i3d-mic', `<span class="i3d-swap i3d-swap-a">${iconMic}</span><span class="i3d-swap i3d-swap-b">${iconMicOff}</span>`, 'Dictate');
  const voiceBtn = iconBtn('i3d-voice', iconWave + iconSend + iconClose, 'Voice');
  right.append(model, speakerBtn, micBtn, voiceBtn);
  row.append(left, right);
  composer.append(input, row);
  foot.append(peek, status, composer);

  root.append(head, scroll, foot);

  // State
  const submitCbs: Array<(text: string) => void> = [];
  const voiceCbs: Array<() => void> = [];
  let listening = false;
  let draftBeforeListening = '';
  let lastAssistant: HTMLElement | null = null;

  const nearBottom = (): boolean => scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < NEAR_BOTTOM_PX;
  const toBottom = (): void => {
    scroll.scrollTop = scroll.scrollHeight;
  };
  const clearEmpty = (): void => {
    if (empty.parentNode) empty.remove();
  };
  const syncPeek = (): void => {
    const text = lastAssistant?.textContent?.trim() ?? '';
    peek.textContent = text;
    root.classList.toggle('has-peek', text.length > 0);
  };

  const autoGrow = (): void => {
    input.style.height = 'auto';
    const room = root.classList.contains('i3d-in-space') ? root.clientHeight || 640 : window.innerHeight;
    input.style.height = `${Math.min(input.scrollHeight, Math.round(room * 0.4))}px`;
    composer.classList.toggle('has-text', !listening && input.value.trim().length > 0);
  };

  const submit = (): void => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    autoGrow();
    for (const cb of submitCbs) cb(text);
  };

  const toggleVoice = (): void => {
    for (const cb of voiceCbs) cb();
  };

  input.addEventListener('input', autoGrow);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });
  composer.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });
  // Click on empty composer area focuses the text.
  composer.addEventListener('mousedown', (e) => {
    if (e.target === composer || e.target === row) {
      e.preventDefault();
      input.focus();
    }
  });
  voiceBtn.addEventListener('click', () => {
    if (!listening && input.value.trim()) submit();
    else toggleVoice();
  });
  micBtn.addEventListener('click', () => {
    if (listening) {
      const muted = composer.classList.toggle('is-muted');
      micBtn.setAttribute('aria-pressed', String(muted));
    } else toggleVoice();
  });
  speakerBtn.addEventListener('click', () => {
    speakerBtn.setAttribute('aria-pressed', String(speakerBtn.classList.toggle('is-off')));
  });
  plusBtn.addEventListener('click', () => {
    root.dispatchEvent(new CustomEvent('chat:plus', { bubbles: true }));
    input.focus();
  });

  // Collapse: narrow screens start collapsed (composer + a 3-line peek) so the object stays visible.
  // In a spatial window (class i3d-in-space, fixed-size box) the viewport width is irrelevant.
  const mq = window.matchMedia(NARROW);
  const inSpace = (): boolean => root.classList.contains('i3d-in-space');
  let explicit = false;
  const applyCollapsed = (on: boolean): void => {
    root.classList.toggle('is-collapsed', on);
    if (!on) requestAnimationFrame(toBottom);
  };
  const setCollapsed = (on: boolean): void => {
    explicit = true;
    applyCollapsed(on);
  };
  const autoCollapse = (): void => {
    if (!explicit) applyCollapsed(mq.matches && !inSpace());
  };
  autoCollapse();
  mq.addEventListener('change', autoCollapse);
  new MutationObserver(autoCollapse).observe(root, { attributes: true, attributeFilter: ['class'] });
  collapseBtn.addEventListener('click', () => setCollapsed(true));
  expandBtn.addEventListener('click', () => setCollapsed(false));
  peek.addEventListener('click', () => setCollapsed(false));

  return {
    addUser(text: string): void {
      clearEmpty();
      const msg = el('div', 'i3d-user');
      msg.textContent = text;
      log.appendChild(msg);
      toBottom();
    },

    startAssistant() {
      clearEmpty();
      const wrap = el('div', 'i3d-turn');
      const body = el('div', 'i3d-assistant is-streaming');
      wrap.appendChild(body);
      log.appendChild(wrap);
      const writer = new StreamWriter(body);
      let finished = false;
      lastAssistant = body;
      toBottom();
      return {
        append(text: string): void {
          if (finished || !text) return;
          const stick = nearBottom();
          writer.write(text);
          if (lastAssistant === body) syncPeek();
          if (stick) toBottom();
        },
        done(meta?: string): void {
          if (finished) return;
          finished = true;
          const stick = nearBottom();
          writer.write('', true);
          body.classList.remove('is-streaming');
          if (!body.textContent?.trim()) body.remove();
          if (meta) {
            const m = el('div', 'i3d-meta');
            m.textContent = meta;
            wrap.appendChild(m);
          }
          if (!wrap.childElementCount) wrap.remove();
          if (lastAssistant === body) syncPeek();
          if (stick) toBottom();
        },
      };
    },

    setStatus(text: string | null): void {
      if (text) {
        statusText.textContent = text;
        status.classList.add('is-on');
      } else {
        status.classList.remove('is-on');
      }
      root.classList.toggle('has-status', !!text);
    },

    // While listening the composer shows the live partial transcript. Turning off with a
    // partial leaves that text in the composer; turning off without one restores the prior draft.
    setListening(on: boolean, partial?: string): void {
      if (on && !listening) draftBeforeListening = input.value;
      if (!on) {
        composer.classList.remove('is-muted');
        micBtn.setAttribute('aria-pressed', 'false');
      }
      listening = on;
      composer.classList.toggle('is-listening', on);
      voiceBtn.setAttribute('aria-pressed', String(on));
      voiceBtn.title = on ? 'End voice' : 'Voice';
      voiceBtn.setAttribute('aria-label', voiceBtn.title);
      micBtn.title = on ? 'Mute microphone' : 'Dictate';
      micBtn.setAttribute('aria-label', micBtn.title);
      if (on) {
        input.value = partial ?? '';
        input.placeholder = 'Listening';
      } else {
        input.value = partial ?? draftBeforeListening;
        input.placeholder = PLACEHOLDER;
      }
      autoGrow();
    },

    onSubmit(cb: (text: string) => void): void {
      submitCbs.push(cb);
    },

    onVoiceToggle(cb: () => void): void {
      voiceCbs.push(cb);
    },

    setCollapsed,
  };
}
