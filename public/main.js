// Shared site behaviour — mobile navigation toggle.
document.addEventListener('DOMContentLoaded', function () {
  var toggle = document.getElementById('nav-toggle');
  var menu = document.getElementById('nav-menu');
  if (!toggle || !menu) return;

  toggle.addEventListener('click', function () {
    var isOpen = menu.classList.toggle('is-open');
    toggle.classList.toggle('is-open', isOpen);
    toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });

  menu.querySelectorAll('a').forEach(function (link) {
    link.addEventListener('click', function () {
      menu.classList.remove('is-open');
      toggle.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });

  // Mark the current page's nav link as active.
  var path = window.location.pathname.split('/').pop() || 'index.html';
  menu.querySelectorAll('a').forEach(function (link) {
    var href = link.getAttribute('href').replace('/', '');
    if (href === path) link.classList.add('is-active');
  });
});
