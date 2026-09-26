function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>'"]/g, function(char) {
    return ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]);
  });
}

function safeMediaUrl(url) {
  var value = String(url || '').trim();
  if (!value) return '';

  try {
    var parsed = new URL(value, location.origin);

    if (parsed.pathname === '/api/media') {
      var proxyPath = parsed.searchParams.get('path') || '';
      proxyPath = decodeURIComponent(proxyPath).replace(/^\//, '');
      if (/^(logo|portfolio|stock)\//.test(proxyPath)) {
        return '/api/media?path=' + encodeURIComponent(proxyPath);
      }
      return '';
    }

    if (parsed.protocol === 'https:' &&
      (parsed.hostname === 'blob.vercel-storage.com' || /\.blob\.vercel-storage\.com$/i.test(parsed.hostname))) {
      var pathname = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
      if (/^(logo|portfolio|stock)\//.test(pathname)) {
        return '/api/media?path=' + encodeURIComponent(pathname);
      }
      return '';
    }

    var raw = parsed.pathname.replace(/^\//, '');
    if (/^(logo|portfolio|stock)\//.test(raw)) {
      return '/api/media?path=' + encodeURIComponent(raw);
    }
  } catch (e) {}

  return '';
}


var motionState = {
  reduce: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  raf: 0,
  px: 0, py: 0,
  targetX: 0, targetY: 0
};

function setupTypewriter() {
  var el = document.getElementById('typedLine');
  if (!el || motionState.reduce) return;
  var phrases = [
    'Perawatan AC',
    'Perbaikan AC',
    'Pasang Baru & Reposisi',
    'AHU • Chiller • VRF',
    'Rumahan • Perkantoran • Industrial'
  ];
  var index = 0, pos = 0, deleting = false;
  function tick() {
    var phrase = phrases[index];
    if (!deleting) {
      pos += 1;
      el.textContent = phrase.slice(0, pos);
      if (pos >= phrase.length) {
        deleting = true;
        setTimeout(tick, 1250);
        return;
      }
      setTimeout(tick, 58);
      return;
    }
    pos -= 1;
    el.textContent = phrase.slice(0, Math.max(0, pos));
    if (pos <= 0) {
      deleting = false;
      index = (index + 1) % phrases.length;
      setTimeout(tick, 280);
      return;
    }
    setTimeout(tick, 32);
  }
  tick();
}

function setupScrollMotion() {
  var bar = document.getElementById('scrollProgress');
  var nav = document.querySelector('.nav-wrap');
  function update() {
    var max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    var progress = Math.min(100, Math.max(0, window.scrollY / max * 100));
    if (bar) bar.style.width = progress + '%';
    if (nav) nav.classList.toggle('scrolled', window.scrollY > 20);
  }
  update();
  window.addEventListener('scroll', update, { passive: true });
}

function setupPointerParallax() {
  if (motionState.reduce) return;
  var heroVisual = document.querySelector('.hero-visual');
  var heroCopy = document.querySelector('.hero-copy');
  var card = document.querySelector('.hero-card');
  var orbs = document.querySelectorAll('.hero-visual .orb');
  window.addEventListener('pointermove', function(event) {
    var x = event.clientX / Math.max(1, window.innerWidth) - .5;
    var y = event.clientY / Math.max(1, window.innerHeight) - .5;
    motionState.targetX = x;
    motionState.targetY = y;
    document.documentElement.style.setProperty('--cursor-x', event.clientX + 'px');
    document.documentElement.style.setProperty('--cursor-y', event.clientY + 'px');
    if (heroVisual) heroVisual.style.transform = 'translate3d(' + (x * -7).toFixed(1) + 'px,' + (y * -7).toFixed(1) + 'px,0)';
    if (heroCopy) heroCopy.style.transform = 'translate3d(' + (x * 3).toFixed(1) + 'px,' + (y * 3).toFixed(1) + 'px,0)';
    if (card) {
      card.style.setProperty('--tilt-x', (x * -10).toFixed(2) + 'px');
      card.style.setProperty('--tilt-y', (y * -10).toFixed(2) + 'px');
      card.style.transform = 'rotateX(' + (y * -3.5).toFixed(2) + 'deg) rotateY(' + (x * 4).toFixed(2) + 'deg) translate3d(' + (x * -9).toFixed(1) + 'px,' + (y * -9).toFixed(1) + 'px,0)';
    }
    orbs.forEach(function(orb, i) {
      var depth = (i + 1) * 8;
      orb.style.transform = 'translate3d(' + (x * depth).toFixed(1) + 'px,' + (y * depth).toFixed(1) + 'px,0)';
    });
  });
}

function setupTiltCards() {
  if (motionState.reduce || !window.matchMedia('(pointer:fine)').matches) return;
  document.addEventListener('pointermove', function(event) {
    var card = event.target.closest('.service-card,.media-card,.stock-card');
    if (!card) return;
    var rect = card.getBoundingClientRect();
    var px = (event.clientX - rect.left) / rect.width;
    var py = (event.clientY - rect.top) / rect.height;
    var ry = ((px - .5) * 7).toFixed(2);
    var rx = ((.5 - py) * 6).toFixed(2);
    card.style.setProperty('--rx', rx + 'deg');
    card.style.setProperty('--ry', ry + 'deg');
    card.style.setProperty('--shine-x', (px * 100).toFixed(1) + '%');
    card.style.setProperty('--shine-y', (py * 100).toFixed(1) + '%');
  });
  document.addEventListener('pointerout', function(event) {
    var card = event.target.closest('.service-card,.media-card,.stock-card');
    if (!card || card.contains(event.relatedTarget)) return;
    card.style.setProperty('--rx', '0deg');
    card.style.setProperty('--ry', '0deg');
  });
}

function setupDragRails() {
  document.querySelectorAll('[data-drag-rail]').forEach(function(track) {
    var pressed = false, startX = 0, startScroll = 0, moved = false;
    track.addEventListener('pointerdown', function(event) {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      pressed = true; moved = false; startX = event.clientX; startScroll = track.scrollLeft;
      track.classList.add('dragging');
      try { track.setPointerCapture(event.pointerId); } catch (_) {}
    });
    track.addEventListener('pointermove', function(event) {
      if (!pressed) return;
      var dx = event.clientX - startX;
      if (Math.abs(dx) > 4) moved = true;
      if (moved) track.scrollLeft = startScroll - dx;
    });
    var release = function(event) {
      if (!pressed) return;
      pressed = false;
      track.classList.remove('dragging');
      try { track.releasePointerCapture(event.pointerId); } catch (_) {}
    };
    track.addEventListener('pointerup', release);
    track.addEventListener('pointercancel', release);
    track.addEventListener('mouseleave', function(){ if (pressed) { pressed = false; track.classList.remove('dragging'); } });
    track.addEventListener('click', function(event) {
      if (moved) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
  });
}

function setupMagneticButtons() {
  if (motionState.reduce || !window.matchMedia('(pointer:fine)').matches) return;
  document.querySelectorAll('.btn,.floating-wa').forEach(function(btn) {
    btn.addEventListener('pointermove', function(event) {
      var rect = btn.getBoundingClientRect();
      var x = (event.clientX - rect.left) / rect.width - .5;
      var y = (event.clientY - rect.top) / rect.height - .5;
      btn.style.transform = 'translate(' + (x * 5).toFixed(1) + 'px,' + (y * 5).toFixed(1) + 'px)';
    });
    btn.addEventListener('pointerleave', function() {
      btn.style.transform = '';
    });
  });
}

function applyRevealStagger() {
  document.querySelectorAll('.service-card,.media-card,.stock-card').forEach(function(card, index) {
    card.setAttribute('data-reveal-delay', String((index % 4) + 1));
  });
}

function waUrl(number, text) {
  var clean = String(number || '').replace(/\D/g, '');
  var message = text || 'Halo EFASA TEKNIK, saya ingin konsultasi service AC.';
  return clean ? 'https://wa.me/' + clean + '?text=' + encodeURIComponent(message) : '#';
}

function mediaHtml(item) {
  var url = safeMediaUrl(item.media);
  if (!url) return '<div class="media-placeholder">Media tidak tersedia</div>';
  if (item.mediaType === 'video') return '<video src="' + esc(url) + '" controls preload="metadata" playsinline></video>';
  return '<img src="' + esc(url) + '" alt="' + esc(item.title || item.name || 'Media EFASA TEKNIK') + '" loading="lazy">';
}

function catalogUrl(id) {
  return location.origin + '/?stock=' + encodeURIComponent(id) + '#stok';
}

function renderPortfolio(items) {
  var el = document.getElementById('portfolioGrid');
  if (!items.length) {
    el.innerHTML = '<div class="empty-state">Belum ada dokumentasi pekerjaan yang ditampilkan.</div>';
    return;
  }
  el.innerHTML = items.map(function(item) {
    var tags = '<span>' + esc(item.service || 'Service AC') + '</span>';
    if (item.location) tags += '<span>' + esc(item.location) + '</span>';
    return '<article class="media-card reveal">' + mediaHtml(item) +
      '<div class="media-body"><div class="tag-row">' + tags + '</div><h3>' +
      esc(item.title || 'Dokumentasi pekerjaan') + '</h3><p>' + esc(item.description || '') +
      '</p></div></article>';
  }).join('');
}

function renderStock(items) {
  var grid = document.getElementById('stockGrid');
  var empty = document.getElementById('emptyStock');
  empty.classList.toggle('hidden', items.length > 0);
  grid.innerHTML = items.map(function(item) {
    var url = catalogUrl(item.id);
    var message = 'Halo EFASA TEKNIK, apakah ' + (item.name || 'unit AC') + ' ' + (item.capacity || '') +
      ' masih tersedia?\n\nSaya melihatnya di katalog EFASA TEKNIK: ' + url;
    var meta = '<span>' + esc(item.brand || 'AC') + '</span>';
    if (item.capacity) meta += '<span>' + esc(item.capacity) + '</span>';
    return '<article id="stock-' + esc(item.id) + '" class="stock-card reveal">' + mediaHtml(item) +
      '<div class="stock-body"><div class="stock-meta">' + meta + '</div><h3>' +
      esc(item.name || 'Unit AC') + '</h3>' +
      (item.price ? '<div class="price">' + esc(item.price) + '</div>' : '') +
      '<p>' + esc(item.description || '') + '</p><a class="btn btn-primary full" target="_blank" rel="noreferrer" href="' +
      esc(waUrl(window.__siteWhatsapp, message)) + '">Tanya ketersediaan</a></div></article>';
  }).join('');
}

var observer;
function bindReveal() {
  applyRevealStagger();
  if (!observer) {
    observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -6% 0px' });
  }
  document.querySelectorAll('.reveal:not(.visible)').forEach(function(el) { observer.observe(el); });
}

async function loadSite() {
  var response = await fetch('/api/public');
  var data = await response.json();
  if (!data.ok) throw new Error(data.message || 'Data gagal dimuat.');
  var s = data.settings || {};
  window.__siteWhatsapp = s.whatsapp || '';
  document.title = (s.brand || 'EFASA TEKNIK') + ' — ' + (s.tagline || 'Teknik Pendingin Ruangan');

  document.getElementById('brandName').textContent = s.brand || 'EFASA TEKNIK';
  document.getElementById('heroTitle').textContent = s.heroTitle || 'Layanan Teknik Pendingin Ruangan';
  document.getElementById('heroText').textContent = s.heroText || 'Melayani AC rumahan, perkantoran, dan industrial.';
  document.getElementById('serviceArea').textContent = s.serviceArea || 'Malang Raya dan sekitarnya';
  document.getElementById('hours').textContent = s.hours || '08.00 - 17.00';
  document.getElementById('address').textContent = s.address || '';

  var wa = waUrl(s.whatsapp);
  ['navWhatsapp','heroWhatsapp','contactWhatsapp','floatingWhatsapp'].forEach(function(id) {
    var el = document.getElementById(id);
    el.href = wa;
    el.classList.toggle('disabled-link', wa === '#');
  });
  var email = String(s.email || '').trim();
  var emailEl = document.getElementById('contactEmail');
  emailEl.href = email ? 'mailto:' + email : '#';
  emailEl.classList.toggle('disabled-link', !email);

  var logo = document.getElementById('siteLogo');
  var fallback = document.getElementById('logoFallback');
  var logoUrl = safeMediaUrl(s.logo);
  logo.style.display = logoUrl ? 'block' : 'none';
  fallback.style.display = logoUrl ? 'none' : 'grid';
  if (logoUrl) logo.src = logoUrl;

  renderPortfolio(data.portfolio || []);
  renderStock(data.stock || []);
  bindReveal();
  setupDragRails();
  setupTiltCards();

  var stockId = new URLSearchParams(location.search).get('stock');
  if (stockId) {
    var stock = document.getElementById('stock-' + stockId);
    if (stock) {
      setTimeout(function() {
        stock.scrollIntoView({ behavior: 'smooth', block: 'center' });
        stock.classList.add('stock-highlight');
        setTimeout(function(){ stock.classList.remove('stock-highlight'); }, 2600);
      }, 250);
    }
  }
}

window.addEventListener('load', function() {
  document.getElementById('year').textContent = new Date().getFullYear();
  setupScrollMotion();
  setupTypewriter();
  setupPointerParallax();
  setupTiltCards();
  setupMagneticButtons();
  loadSite().catch(function(error){ console.error(error); });
  bindReveal();
});

window.addEventListener('pointermove', function(event) {
  document.documentElement.style.setProperty('--mx', event.clientX + 'px');
  document.documentElement.style.setProperty('--my', event.clientY + 'px');
});