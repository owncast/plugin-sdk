// viewer-gate: mount a confirmation modal on page load. The
// companion modal.css scopes every selector under #viewer-gate-overlay
// so the markup below doesn't depend on classes the host page
// defines. Yes removes the modal; No redirects the tab away.
(function () {
  var REDIRECT_TARGET = 'https://www.yahoo.com';
  var OVERLAY_ID = 'viewer-gate-overlay';

  function mount() {
    if (document.getElementById(OVERLAY_ID)) {
      return;
    }

    var overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'viewer-gate-title');

    var modal = document.createElement('div');
    modal.className = 'viewer-gate-modal';

    var title = document.createElement('h2');
    title.className = 'viewer-gate-title';
    title.id = 'viewer-gate-title';
    title.textContent = 'Hold up';

    var body = document.createElement('p');
    body.className = 'viewer-gate-body';
    body.textContent = 'Are you sure you want to view this page?';

    var actions = document.createElement('div');
    actions.className = 'viewer-gate-actions';

    var yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'viewer-gate-button viewer-gate-yes';
    yes.textContent = 'Yes';
    yes.addEventListener('click', function () {
      overlay.remove();
    });

    var no = document.createElement('button');
    no.type = 'button';
    no.className = 'viewer-gate-button viewer-gate-no';
    no.textContent = 'No';
    no.addEventListener('click', function () {
      window.location.replace(REDIRECT_TARGET);
    });

    actions.appendChild(yes);
    actions.appendChild(no);
    modal.appendChild(title);
    modal.appendChild(body);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Move keyboard focus to the Yes button so a viewer can press
    // Enter to dismiss without reaching for the mouse.
    yes.focus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
