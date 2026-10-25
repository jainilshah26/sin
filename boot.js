/* Applies the saved light/dark choice before the page paints (a separate file, because the Content-Security-Policy allows no inline scripts). */
try { var t = localStorage.getItem("sin_theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) { }
