
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

function catalogUrl(id){return location.origin+'/stok/?stock='+encodeURIComponent(id)+'#stok';}
function waUrl(number,text){
  var clean=String(number||'').replace(/\D/g,'');
  return clean?'https://wa.me/'+clean+'?text='+encodeURIComponent(text||'Halo EFASA TEKNIK, saya ingin konsultasi service AC.'):'#';
}
function renderStock(items,whatsapp){
  var grid=document.getElementById('stockGrid');
  var empty=document.getElementById('emptyStock');
  if(!grid||!empty)return;
  empty.classList.toggle('hidden',items.length>0);
  grid.innerHTML=items.map(function(item){
    var url=catalogUrl(item.id);
    var message='Halo EFASA TEKNIK, apakah '+(item.name||'unit AC')+' '+(item.capacity||'')+
      ' masih tersedia?\n\nSaya melihatnya di katalog EFASA TEKNIK: '+url;
    var meta='<span>'+esc(item.brand||'AC')+'</span>';
    if(item.capacity)meta+='<span>'+esc(item.capacity)+'</span>';
    return '<article id="stock-'+esc(item.id)+'" class="stock-card reveal visible">'+mediaHtml(item)+
      '<div class="stock-body"><div class="stock-meta">'+meta+'</div><h3>'+
      esc(item.name||'Unit AC')+'</h3>'+
      (item.price?'<div class="price">'+esc(item.price)+'</div>':'')+
      '<p>'+esc(item.description||'')+'</p>'+
      '<a class="btn btn-primary full" target="_blank" rel="noreferrer" href="'+esc(waUrl(whatsapp,message))+'">Tanya ketersediaan</a></div></article>';
  }).join('');
  var stockId=new URLSearchParams(location.search).get('stock');
  if(stockId){
    var card=document.getElementById('stock-'+stockId);
    if(card){
      setTimeout(function(){card.scrollIntoView({behavior:'smooth',block:'center'});card.classList.add('stock-highlight');},120);
    }
  }
}
window.addEventListener('load',async function(){
  try{
    var data=await getPublicData();
    setupShared(data.settings||{});
    renderStock(data.stock||[],(data.settings||{}).whatsapp||'');
  }catch(error){
    console.error(error);
    var grid=document.getElementById('stockGrid');
    if(grid)grid.innerHTML='<div class="empty-state">Katalog stok gagal dimuat. Silakan refresh halaman.</div>';
  }
});
