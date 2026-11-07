// Runs before first paint so a saved light/dark choice doesn't flash the other theme.
// (A separate file because the Content Security Policy blocks inline scripts.)
try { var t = localStorage.getItem('om-theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) {}
