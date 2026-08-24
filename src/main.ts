/** Entry point: build the app, register the screens, open the first route. */

import './ui/styles.css';
import { App } from './ui/app.js';
import { homeScreen } from './ui/home.js';
import { playScreen } from './ui/play.js';
import { chaptersScreen, levelsScreen, galleryScreen, statsScreen, settingsScreen } from './ui/screens.js';
import { assessScreen } from './ui/assess.js';
import { workshopScreen } from './ui/workshop.js';
import { onboarding } from './ui/components.js';
import { ticker } from './render/tween.js';
import { audio } from './render/audio.js';

const root = document.getElementById('app');
if (!root) throw new Error('#app is missing');

const app = new App(root);

app.registerScreen('home', (a) => homeScreen(a));
app.registerScreen('play', (a, r) => playScreen(a, r));
app.registerScreen('chapters', (a, r) => chaptersScreen(a, r));
app.registerScreen('levels', (a, r) => levelsScreen(a, r));
app.registerScreen('gallery', (a) => galleryScreen(a));
app.registerScreen('stats', (a) => statsScreen(a));
app.registerScreen('settings', (a) => settingsScreen(a));
app.registerScreen('assess', (a) => assessScreen(a));
app.registerScreen('workshop', (a) => workshopScreen(a));

// Audio contexts may only start from a gesture.
const wake = () => {
  audio.setTheme(app.theme);
  window.removeEventListener('pointerdown', wake);
};
window.addEventListener('pointerdown', wake, { once: true });

// A tab that comes back should not try to catch up on animation time.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) ticker.cancelAll();
});

if (location.hash) app.readHash();
else app.go({ name: 'home' }, { replace: true });

// First run: one wordless animated example, one sentence, one pill.
const FIRST_RUN = 'thread.seen-intro';
try {
  if (!localStorage.getItem(FIRST_RUN)) {
    onboarding(
      app.classic[0],
      'Drag from peg to peg and let go — the string pulls taut and ties itself. Match the outline.',
      () => {
        try {
          localStorage.setItem(FIRST_RUN, '1');
        } catch {
          /* storage unavailable; the intro will simply show again */
        }
      },
    );
  }
} catch {
  /* storage unavailable */
}

// Expose a small surface for the end-to-end harness. It drives the game
// through real pointer events; this is only for reading state back.
declare global {
  interface Window { __thread?: unknown }
}
window.__thread = {
  app,
  save: () => app.save,
  levelIds: () => ({
    classic: app.classic.map((l) => l.id),
    weave: app.weave.map((l) => l.id),
    assess: app.assess.map((l) => l.id),
  }),
  frameTimes: () => ticker.frameTimes.slice(),
  startRecording: () => ticker.startRecording(),
  stopRecording: () => ticker.stopRecording(),
  current: null as unknown,
};
