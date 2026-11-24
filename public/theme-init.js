// Apply the saved theme before first paint (no flash). A file instead of an inline script so the
// Content-Security-Policy can forbid inline scripts.
(function () {
  try {
    var t = localStorage.getItem('pho-theme') || 'system'
    var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  } catch {
    document.documentElement.setAttribute('data-theme', 'light')
  }
})()
