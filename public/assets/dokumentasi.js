
function esc(value){
  return String(value==null?'':value).replace(/[&<>'"]/g,function(char){
    return ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]);
  });
}
function safeMediaUrl(url){
  var value=String(url||'').trim();
  if(!value)return '';
  try{
    var parsed=new URL(value,location.origin);
    if(parsed.pathname==='/api/media'){
      var pathValue=decodeURIComponent(parsed.searchParams.get('path')||'').replace(/^\//,'');
      return /^(logo|portfolio|stock)\//.test(pathValue) ? '/api/media?path='+encodeURIComponent(pathValue) : '';
    }
    if(parsed.protocol==='https:' && (parsed.hostname==='blob.vercel-storage.com'||/\.blob\.vercel-storage\.com$/i.test(parsed.hostname))){
      var pathname=decodeURIComponent(parsed.pathname.replace(/^\//,''));
      return /^(logo|portfolio|stock)\//.test(pathname) ? '/api/media?path='+encodeURIComponent(pathname) : '';
    }
  }catch(e){}
  return '';
}
function mediaHtml(item){
  var url=safeMediaUrl(item.media);
  if(!url)return '<div class="media-placeholder">Media tidak tersedia</div>';
  if(item.mediaType==='video')return '<video src="'+esc(url)+'" controls preload="metadata" playsinline></video>';
  return '<img src="'+esc(url)+'" alt="'+esc(item.title||item.name||'Media EFASA TEKNIK')+'" loading="lazy">';
}
function setupShared(settings){
  var brand=document.getElementById('brandName');
  if(brand)brand.textContent=settings.brand||'EFASA TEKNIK';
  var address=document.getElementById('address');
  if(address)address.textContent=settings.address||'';
  var logoUrl=safeMediaUrl(settings.logo);
  var navLogo=document.getElementById('navLogo');
  var navFallback=document.getElementById('navLogoFallback');
  if(navLogo&&navFallback){
    navLogo.style.display=logoUrl?'block':'none';
    navFallback.style.display=logoUrl?'none':'grid';
    if(logoUrl)navLogo.src=logoUrl;
  }
  var wa=String(settings.whatsapp||'').replace(/\D/g,'');
  var waUrl=wa?'https://wa.me/'+wa:'/#kontak';
  var waEl=document.getElementById('navWhatsapp');
  if(waEl)waEl.href=waUrl;
  var maps=String(settings.mapsLink||'').trim();
  var mapsEl=document.getElementById('navLocation');
  if(mapsEl){
    mapsEl.href=maps||'#';
    mapsEl.classList.toggle('disabled-link',!maps);
  }
  var year=document.getElementById('year');
  if(year)year.textContent=new Date().getFullYear();
}
async function getPublicData(){
  var response=await fetch('/api/public',{cache:'no-store'});
  var data=await response.json();
  if(!response.ok||!data.ok)throw new Error(data.message||'Data website gagal dimuat.');
  return data;
}

function renderDocs(items){
  var el=document.getElementById('portfolioGrid');
  if(!el)return;
  if(!items.length){
    el.innerHTML='<div class="empty-state">Belum ada dokumentasi pekerjaan yang ditampilkan.</div>';
    return;
  }
  el.innerHTML=items.map(function(item){
    var tags='<span>'+esc(item.service||'Service AC')+'</span>';
    if(item.location)tags+='<span>'+esc(item.location)+'</span>';
    return '<article class="media-card reveal visible">'+mediaHtml(item)+
      '<div class="media-body"><div class="tag-row">'+tags+'</div><h3>'+
      esc(item.title||'Dokumentasi pekerjaan')+'</h3><p>'+esc(item.description||'')+
      '</p></div></article>';
  }).join('');
}
window.addEventListener('load',async function(){
  try{
    var data=await getPublicData();
    setupShared(data.settings||{});
    renderDocs(data.portfolio||[]);
  }catch(error){
    console.error(error);
    var el=document.getElementById('portfolioGrid');
    if(el)el.innerHTML='<div class="empty-state">Dokumentasi gagal dimuat. Silakan refresh halaman.</div>';
  }
});
