// Plugin-contributed script injected into the viewer page. The
// integration test asserts on the window marker and the console log
// signature so loading is observable without screenshot comparison.
// The script also appends a fixed banner to the page so the effect
// is visible whether or not a stream or chat is currently active.
(function () {
  window.__pluginScriptsDemoLoaded = true;
  console.log('[scripts-demo] plugin script loaded');

  function mount() {
    if (document.getElementById('plugin-scripts-demo-banner')) {
      return;
    }
    var banner = document.createElement('div');
    banner.id = 'plugin-scripts-demo-banner';
    banner.textContent = 'scripts-demo: JavaScript reached the viewer page';
    banner.style.cssText = [
      'position:fixed',
      'bottom:0',
      'left:0',
      'right:0',
      'z-index:999999',
      'padding:4px 8px',
      'background:#3b82f6',
      'color:#fff',
      'font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
      'text-align:center',
      'pointer-events:none',
    ].join(';');
    document.body.appendChild(banner);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
