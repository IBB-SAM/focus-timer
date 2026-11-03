// Shared app state. Modules read and write S directly; persistence happens
// at the point of change in each module.
import { store } from './store.js';
import { MAX_PRESETS, MAX_HISTORY, MAX_ACTS } from './util.js';
import { cleanLabels, cleanPreset, cleanHist, cleanAct, cleanDone, cleanFired, cleanSnooze, cleanList, uniqById } from './validate.js';

export const S = {
  // setup / timer
  mode: 'count', plan: [], idx: -1, remaining: 0, running: false, endAt: 0,
  labels: [], presets: [], history: [],
  // daily plan
  acts: [], doneMap: {}, fired: {}, snoozes: [],
  // activity running in the timer; actSession = plan came from an activity
  currentAct: null, currentActDay: null, actSession: false
};

export const sessionActive = () => S.idx >= 0 && S.idx < S.plan.length;

export function loadState() {
  S.labels = cleanLabels(store.get('labels', []));
  S.presets = cleanList(store.get('presets', []), cleanPreset).slice(0, MAX_PRESETS);
  S.history = cleanList(store.get('history', []), cleanHist).slice(-MAX_HISTORY);
  S.acts = uniqById(cleanList(store.get('acts', []), cleanAct)).slice(0, MAX_ACTS);
  S.doneMap = cleanDone(store.get('done', {}));
  S.fired = cleanFired(store.get('fired', {}));
  S.snoozes = cleanList(store.get('snoozes', []), cleanSnooze);
}
