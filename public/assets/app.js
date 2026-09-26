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
  if (!observer) {
    observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12 });
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
  loadSite().catch(function(error){ console.error(error); });
  bindReveal();
});

window.addEventListener('pointermove', function(event) {
  document.documentElement.style.setProperty('--mx', event.clientX + 'px');
  document.documentElement.style.setProperty('--my', event.clientY + 'px');
});