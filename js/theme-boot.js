// Runs before first paint (classic script in <head>) so a saved light/dark
// choice applies without a flash of the wrong theme.
try {
  var t = JSON.parse(localStorage.getItem('sft.theme'));
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
} catch (e) { /* storage blocked: follow the system */ }
