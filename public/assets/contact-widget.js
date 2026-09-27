(function(){
  var root=document.getElementById('contactOrbit');
  var toggle=document.getElementById('contactOrbitToggle');
  if(!root||!toggle)return;

  function setOpen(open){
    root.classList.toggle('is-open',open);
    toggle.setAttribute('aria-expanded',open?'true':'false');
    toggle.setAttribute('aria-label',open?'Tutup kontak cepat':'Buka kontak cepat');
  }

  toggle.addEventListener('click',function(){
    setOpen(!root.classList.contains('is-open'));
  });

  root.querySelectorAll('.contact-orbit__item').forEach(function(item){
    item.addEventListener('click',function(){
      setTimeout(function(){setOpen(false);},150);
    });
  });

  document.addEventListener('click',function(event){
    if(!root.contains(event.target))setOpen(false);
  });

  fetch('/api/public',{cache:'no-store'})
    .then(function(response){return response.json();})
    .then(function(data){
      if(!data||!data.ok)return;
      var s=data.settings||{};
      var clean=String(s.whatsapp||'').replace(/\D/g,'');
      var wa=clean?'https://wa.me/'+clean+'?text='+encodeURIComponent('Halo EFASA TEKNIK, saya ingin konsultasi service AC.'):'#';
      var phone=clean?'tel:+'+clean:'#';
      var waEl=document.getElementById('floatingWhatsapp');
      var phoneEl=document.getElementById('floatingPhone');
      if(waEl){
        waEl.href=wa;
        waEl.classList.toggle('disabled-link',wa==='#');
      }
      if(phoneEl){
        phoneEl.href=phone;
        phoneEl.classList.toggle('disabled-link',phone==='#');
      }
    })
    .catch(function(){});
})();