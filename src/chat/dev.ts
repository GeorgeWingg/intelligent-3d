// Dev harness for the chat surface: chat-dev.html?state=convo|listen|collapsed|empty|status
import '../styles.css';
import { createChat, setModeLine } from './index';

const stage = document.getElementById('stage')!;
stage.style.background =
  'radial-gradient(ellipse at 30% 60%, #3a3424 0%, #1c1b12 45%, #0e0f08 80%), #0e0f08';

const chat = createChat(document.getElementById('chat')!);
setModeLine('Simulated passthrough · iPhone camera · hand tracking: MediaPipe · Voice: browser speech');

const state = new URLSearchParams(location.search).get('state') ?? 'convo';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function stream(text: string, meta: string): Promise<void> {
  const h = chat.startAssistant();
  const pieces = text.match(/.{1,5}/gs) ?? [];
  for (const p of pieces) {
    h.append(p);
    await sleep(12);
  }
  h.done(meta);
}

chat.onSubmit(async (text) => {
  chat.addUser(text);
  chat.setStatus('Building in 3D…');
  await sleep(600);
  chat.setStatus(null);
  await stream(`Here is **${text}** as a quick sketch.\n\nPinch to turn it, spread both hands to pull it apart.`, 'Built in 3D in 1.2s');
});
let on = false;
chat.onVoiceToggle(() => {
  on = !on;
  chat.setListening(on, on ? 'show me the' : undefined);
});

async function convo(): Promise<void> {
  chat.addUser('Break down the design of a 7-speed bike');
  await stream(
    'A 7-speed bike is five systems working together. I have built it in front of you and pulled the systems slightly apart.\n\n' +
      '**Frame and fork** carry the load: a diamond of tubes, with the fork steering the front wheel.\n\n' +
      '**Drivetrain** turns your legs into wheel speed. One chainring at the cranks drives a 7-sprocket cassette on the rear hub; the derailleur shifts the chain across it.\n\n' +
      '**Brakes** are rim calipers front and rear, pulled by cables from the levers.\n\n' +
      'Pinch to rotate it, spread two hands to explode it, or ask for any system.',
    'Built in 3D in 4.1s',
  );
  chat.addUser('Show me the brakes');
  await stream(
    'Lifting the **brakes** out. Each caliper squeezes two pads onto the rim when you pull the lever; the rear one does most of the steady slowing, the front one most of the hard stopping.',
    'Worked for 2s',
  );
}

(async () => {
  if (state === 'empty') return;
  if (state === 'collapsed') {
    await convo();
    chat.setCollapsed(true);
    return;
  }
  await convo();
  if (state === 'listen') {
    on = true;
    chat.setListening(true, 'show me the drivetrain and how the');
  }
  if (state === 'status') {
    chat.addUser('Now explode it fully');
    chat.setStatus('Building in 3D…');
    const h = chat.startAssistant();
    h.append('Pulling every system **apart** so you can');
  }
})();
