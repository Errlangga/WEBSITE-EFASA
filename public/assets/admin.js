var $ = function(selector){ return document.querySelector(selector); };
var csrfToken = '';
var storageMode = 'local';
var blobModulePromise;

async function api(url, options) {
  options = options || {};
  var headers = new Headers(options.headers || {});
  if (csrfToken && options.method && options.method !== 'GET') headers.set('x-efasa-csrf', csrfToken);
  var response = await fetch(url, Object.assign({}, options, { headers: headers }));
  var data = await response.json().catch(function(){ return { ok:false, message:'Response server tidak valid.' }; });
  if (!response.ok) throw new Error(data.message || data.error || 'Request gagal.');
  return data;
}

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>'"]/g, function(char){
    return ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]);
  });
}
function setProgress(id,text){ var el=document.getElementById(id); if(el) el.textContent=text||''; }
function adminMediaUrl(url){
  var value=String(url||'');
  if(!value)return '';
  if(value.indexOf('/uploads/')===0)return value;
  if(value.indexOf('/api/media?path=')===0)return value;

  try{
    var parsed=new URL(value,location.origin);
    var validBlob=parsed.protocol==='https:' &&
      (parsed.hostname==='blob.vercel-storage.com'||/\.blob\.vercel-storage\.com$/i.test(parsed.hostname));
    if(!validBlob)return '';

    var pathname=decodeURIComponent(parsed.pathname.replace(/^\//,''));
    if(!/^(logo|portfolio|stock)\//.test(pathname))return '';
    return '/api/media?path='+encodeURIComponent(pathname);
  }catch(e){
    return '';
  }
}

function mediaFallback(el){
  if(!el)return;
  el.style.display='none';
  var fallback=el.parentElement&&el.parentElement.querySelector('.admin-media-fallback');
  if(fallback)fallback.style.display='grid';
}


async function uploadBlob(file,kind,progressId){
  setProgress(progressId,'Menyiapkan upload...');
  const info=await api('/api/blob/upload-url',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      kind:kind,
      fileName:file.name,
      contentType:file.type||((/\\.jpe?g$/i.test(file.name))?'image/jpeg':(/\\.png$/i.test(file.name)?'image/png':(/\\.webp$/i.test(file.name)?'image/webp':''))),
      size:file.size
    })
  });

  if(!info.presignedUrl||!info.mediaPath){
    throw new Error('Server tidak mengembalikan informasi upload Blob.');
  }

  const uploaded=await new Promise(function(resolve,reject){
    var xhr=new XMLHttpRequest();
    xhr.open('PUT',info.presignedUrl,true);
    if(file.type)xhr.setRequestHeader('Content-Type',file.type);

    xhr.upload.onprogress=function(event){
      if(event.lengthComputable){
        setProgress(progressId,'Upload '+Math.round(event.loaded/event.total*100)+'%');
      }
    };

    xhr.onload=function(){
      if(xhr.status<200||xhr.status>=300){
        var detail=String(xhr.responseText||'').trim();
        reject(new Error('Upload ke Vercel Blob gagal (HTTP '+xhr.status+').'+(detail?' '+detail.slice(0,240):'')));
        return;
      }

      var result=null;
      try{
        result=xhr.responseText?JSON.parse(xhr.responseText):null;
      }catch{}

      resolve(result||{});
    };

    xhr.onerror=function(){reject(new Error('Koneksi upload ke Vercel Blob gagal.'));};
    xhr.onabort=function(){reject(new Error('Upload dibatalkan.'));};
    xhr.send(file);
  });

  setProgress(progressId,'Upload tersimpan.');

  return {
    mediaUrl:uploaded.url||info.mediaUrl||'',
    mediaOrigin:'',
    mediaPath:uploaded.pathname||info.mediaPath,
    mediaType:uploaded.contentType
      ? (String(uploaded.contentType).indexOf('video/')===0?'video':'image')
      : info.mediaType
  };
}

async function refresh(){
  var data = await api('/api/public');
  Object.keys(data.settings || {}).forEach(function(key){
    var input = document.querySelector('[name="' + key + '"]'); if(input) input.value=data.settings[key]||'';
  });
  renderList('portfolioAdmin',data.portfolio||[],'portfolio');
  renderList('stockAdmin',data.stock||[],'stock');
}

function renderList(id,items,type){
  var el=$('#'+id);
  if(!items.length){el.innerHTML='<p class="hint">Belum ada data.</p>';return;}
  el.innerHTML=items.map(function(item){
    var title=item.title||item.name||'Data EFASA';
    var meta=type==='portfolio'
      ? (item.location||'')+(item.service?' • '+item.service:'')
      : (item.brand||'AC')+(item.capacity?' • '+item.capacity:'');
    var mediaUrl=adminMediaUrl(item.media);
    var media=mediaUrl
      ? (item.mediaType==='video'
          ? '<video src="'+esc(mediaUrl)+'" controls preload="metadata" onerror="mediaFallback(this)"></video>'
          : '<img src="'+esc(mediaUrl)+'" alt="" onerror="mediaFallback(this)">')
      : '';
    media='<div class="admin-media-wrap">'+media+'<div class="admin-media-fallback" style="display:'+(mediaUrl?'none':'grid')+'">Media tidak tersedia</div></div>';
    return '<div class="admin-item"><div class="media-thumb">'+media+'</div><div><h3>'+esc(title)+'</h3><p>'+esc(meta)+'</p><p>'+esc(item.description||'')+'</p></div><button class="btn danger delete-btn" data-id="'+esc(item.id)+'" data-type="'+type+'">Hapus</button></div>';
  }).join('');
  el.querySelectorAll('.delete-btn').forEach(function(button){
    button.addEventListener('click',async function(){
      if(!confirm('Hapus item ini? File medianya juga akan dihapus.')) return;
      try{await api('/api/admin/'+button.dataset.type+'/'+button.dataset.id,{method:'DELETE'});await refresh();}
      catch(e){alert(e.message);}
    });
  });
}

async function submitMediaForm(form,endpoint,kind,progressId){
  var file=form.querySelector('input[type="file"]').files[0];
  if(!file) throw new Error('File wajib dipilih.');
  if(storageMode==='vercel-blob'){
    var media=await uploadBlob(file,kind,progressId);
    var body=Object.fromEntries(new FormData(form));delete body.media;
    body.mediaUrl=media.mediaUrl;body.mediaOrigin=media.mediaOrigin;body.mediaPath=media.mediaPath;body.mediaType=media.mediaType;
    var response=await api(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    setProgress(progressId,'Selesai.');
    return response;
  }
  setProgress(progressId,'Mengupload...');
  var localResponse=await api(endpoint,{method:'POST',body:new FormData(form)});
  setProgress(progressId,'Selesai.');
  return localResponse;
}

async function boot(){
  var status=await api('/api/admin/status');
  storageMode=status.storageMode||'local';
  $('#storageBadge').textContent=storageMode==='vercel-blob'?'Storage: Vercel Blob + Postgres':'Storage: lokal (JSON + uploads)';
  if(!status.configured){location.href='/admin/setup';return;}
  if(!status.loggedIn){$('#loginRequired').classList.remove('hidden');return;}
  csrfToken=status.csrfToken||'';
  $('#dashboard').classList.remove('hidden');
  await refresh();
}

$('#logoForm').addEventListener('submit',async function(event){
  event.preventDefault();
  try{
    var file=event.target.querySelector('input[type="file"]').files[0];if(!file) throw new Error('Pilih logo terlebih dahulu.');
    setProgress('logoProgress','Mengupload...');
    var response=await api('/api/admin/logo',{method:'POST',body:new FormData(event.target)});
    setProgress('logoProgress',response.ok?'Logo berhasil diperbarui.':'');
    event.target.reset();
  }catch(e){setProgress('logoProgress',e.message);}
});

var passwordForm=$('#passwordForm');if(passwordForm)passwordForm.addEventListener('submit',async function(event){event.preventDefault();var form=event.target;var values=Object.fromEntries(new FormData(form));if(values.password!==values.confirmPassword){setProgress('passwordProgress','Password dan konfirmasi tidak sama.');return;}try{var data=await api('/api/admin/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});setProgress('passwordProgress',data.message||'Password berhasil diubah.');form.reset();}catch(e){setProgress('passwordProgress',e.message);}});

$('#settingsForm').addEventListener('submit',async function(event){
  event.preventDefault();
  try{await api('/api/admin/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(event.target)))});alert('Pengaturan disimpan.');}
  catch(e){alert(e.message);}
});

$('#portfolioForm').addEventListener('submit',async function(event){
  event.preventDefault();
  try{await submitMediaForm(event.target,'/api/admin/portfolio','portfolio','portfolioProgress');event.target.reset();await refresh();}
  catch(e){setProgress('portfolioProgress',e.message);}
});

$('#stockForm').addEventListener('submit',async function(event){
  event.preventDefault();
  try{await submitMediaForm(event.target,'/api/admin/stock','stock','stockProgress');event.target.reset();await refresh();}
  catch(e){setProgress('stockProgress',e.message);}
});

$('#logoutBtn').addEventListener('click',async function(){try{await api('/api/admin/logout',{method:'POST'});}finally{location.href='/admin/login';}});
boot().catch(function(e){console.error(e);alert(e.message);});