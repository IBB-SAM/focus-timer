# Split Focus Timer

A study timer that splits a session into focus blocks with rests between them.

## Features

- **Flexible splits:** set the total session, then split it by number of blocks or by block length, with a rest after each split.
- **Long breaks:** a longer break after every N blocks (the classic Pomodoro pattern). Set "Long break every" to 0 to turn it off.
- **Task labels:** name each focus block in the session plan. The label shows on the timer and is saved to your history.
- **Presets:** built-in setups (Pomodoro 25/5, 50/10, 52/17, Deep 90/20) plus your own saved presets.
- **Daily plan:** add activities with a start time, duration and alert (10 min before, at start, or both). Make them one-off, daily, or on selected weekdays. Start any activity in the timer with one tap, or let it start automatically at its start time. The timer splits the activity using the timer style you pick.
- **Phone calendar alerts:** "Add plan to calendar" exports your plan as a calendar file, so your phone's own calendar reminds you even when the app is closed.
- **History and stats:** focus minutes per day for the last 14 days, a daily streak, time per task over the last 7 days, and recent blocks. Export as JSON from the Stats tab.
- **Installable app (PWA):** add it to your phone's home screen and it works offline.

All data stays in each person's own browser. Nothing is sent to a server, so friends using the same link never see each other's data.

## Hosting on GitHub Pages

1. Create a new public repository on GitHub, for example `focus-timer`.
2. Upload every file in this folder, keeping the `icons` folder.
3. Go to **Settings → Pages**. Under "Build and deployment", set **Source** to **GitHub Actions**. The included workflow (`.github/workflows/pages.yml`) deploys on every push to `main`.
4. After about a minute the app is live at `https://<your-username>.github.io/focus-timer/`.

Live copy: https://ibb-sam.github.io/focus-timer/

## Updating

Edit the files and commit. Then bump the version in two places so browsers and installed copies pick up the change, and never mix old and new files:

- `sw.js`: `VERSION` (for example `sft-v6` to `sft-v7`)
- `index.html`: the `?v=` on `styles.css` and `js/main.js` (for example `?v=6` to `?v=7`)

## Files

- `index.html`: markup only, with a strict Content-Security-Policy.
- `styles.css`: all styles, with light/dark theme tokens.
- `js/`: behaviour, as ES modules. The DOM is built without HTML strings, and everything read from `localStorage` is validated.
  - `main.js`: entry point; loads state and wires the modules.
  - `state.js`, `store.js`, `validate.js`: app state, storage, and validation of stored data.
  - `util.js`, `dom.js`: constants, formatting, and DOM helpers.
  - `setup.js`: session setup, plan maths, presets and quick start.
  - `timer.js`: timer engine, progress ring, session plan, and saving or restoring a running session.
  - `daily.js`: daily plan, alerts and calendar export.
  - `stats.js`: stats view.
  - `feedback.js`: chime, notifications and screen wake lock.
  - `theme.js` + `theme-boot.js`: the light/dark/system toggle (`theme-boot.js` runs first so the page doesn't flash).
  - `toast.js`, `keys.js`, `focusmode.js`, `router.js`: undo toasts, keyboard shortcuts, focus mode and tabs.
  - `stepper.js`: − / + buttons on number inputs (phones have no native arrows). Steps come from each input's `step` attribute.
- `sw.js`: offline cache and notification clicks. If you add a file under `js/`, add it to `MODULES` here too.

## Notes

- In-app alerts and notifications only fire while the app or tab is still open (in the background is fine). A fully closed web app cannot run a timer.
- A running session is saved, so reloading the page or the phone closing the tab doesn't lose it. Time that passed while the app was closed is counted.
- Blocks shorter than one minute are not recorded. Skipped or reset focus blocks are recorded as partial, with the time actually spent.
