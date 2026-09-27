require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');
const { put, get, del, issueSignedToken, presignUrl } = require('@vercel/blob');
const archiver = require('archiver');
const { PassThrough, Readable } = require('stream');

const app = express();
const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const UPLOADS = path.join(PUBLIC, 'uploads');
const DB_FILE = path.join(ROOT, 'data', 'db.json');
const IS_VERCEL = Boolean(process.env.VERCEL);
const USE_POSTGRES = Boolean(process.env.DATABASE_URL);
const PERSISTENCE_MODE = USE_POSTGRES ? 'postgres' : (IS_VERCEL ? 'missing-database' : 'local');
const STORAGE_MODE = process.env.VERCEL || process.env.BLOB_READ_WRITE_TOKEN ? 'vercel-blob' : 'local';
const sql = USE_POSTGRES ? neon(process.env.DATABASE_URL) : null;
const DEFAULT_SETTINGS = {
  brand: 'EFASA TEKNIK', tagline: 'Teknik pendingin ruangan',
  heroTitle: 'Layanan Teknik Pendingin Ruangan',
  heroText: 'Melayani AC rumahan, perkantoran, dan industrial.',
  whatsapp: '', email: '', instagram: '', address: 'Malang, Jawa Timur', mapsLink: '',
  serviceArea: 'Malang Raya dan sekitarnya', hours: '08.00 - 17.00', logo: ''
};
const MIME = new Set(['image/jpeg','image/png','image/webp','image/gif','image/avif','video/mp4','video/webm','video/quicktime']);
const localUpload = multer({
  storage: multer.diskStorage({
    destination: (_r,_f,cb) => cb(null, UPLOADS),
    filename: (_r,f,cb) => cb(null, `${Date.now()}-${crypto.randomBytes(7).toString('hex')}${path.extname(f.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_r,f,cb) => cb(null, MIME.has(f.mimetype))
});
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_r,f,cb) => cb(null, ['image/jpeg','image/png','image/webp'].includes(f.mimetype))
});
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_r,f,cb) => cb(null, MIME.has(f.mimetype))
});
function mediaUploadSingle(req,res,next){
  mediaUpload.single('media')(req,res,(err)=>{
    if(!err)return next();
    if(err.code==='LIMIT_FILE_SIZE'){
      return res.status(413).json({ok:false,message:'Ukuran file maksimal 4 MB. Kompres foto/video lalu upload kembali.'});
    }
    return res.status(400).json({ok:false,message:err.message||'File media tidak valid.'});
  });
}
let schemaReady;

if (!USE_POSTGRES) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.mkdirSync(UPLOADS, { recursive: true });
}

function id(){return crypto.randomBytes(16).toString('hex');}
function clean(v,n=500){return String(v??'').trim().slice(0,n);}
function now(){return new Date().toISOString();}
function requirePersistence(){if(PERSISTENCE_MODE==='missing-database'){const e=new Error('Database production belum terhubung. Tambahkan/Hubungkan Neon Postgres di Vercel lalu redeploy project.');e.statusCode=503;throw e;}}
function dbRead(){try{return JSON.parse(fs.readFileSync(DB_FILE,'utf8'));}catch{return {settings:{...DEFAULT_SETTINGS},admin:null,portfolio:[],stock:[]};}}
function dbWrite(db){fs.writeFileSync(`${DB_FILE}.tmp`,JSON.stringify(db,null,2));fs.renameSync(`${DB_FILE}.tmp`,DB_FILE);}
const SESSION_SECRET=process.env.SESSION_SECRET || (!IS_VERCEL ? 'efasa-dev-secret-change-me-please' : '');
function secret(){if(!SESSION_SECRET)throw new Error('SESSION_SECRET belum dikonfigurasi di production.');return SESSION_SECRET;}
function hash(password,salt=crypto.randomBytes(16).toString('hex')){return `${salt}:${crypto.scryptSync(password,salt,64).toString('hex')}`;}
function verifyPassword(password,stored){try{const [s,e]=String(stored||'').split(':');if(!s||!e)return false;const a=crypto.scryptSync(password,s,64).toString('hex');return a.length===e.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(e));}catch{return false;}}
function token(adminId,sessionVersion=1){const p=Buffer.from(JSON.stringify({sub:adminId,sv:Number(sessionVersion)||1,exp:Date.now()+86400000})).toString('base64url');return `${p}.${crypto.createHmac('sha256',secret()).update(p).digest('base64url')}`;}
function session(raw){try{const [p,s]=String(raw||'').split('.');const e=crypto.createHmac('sha256',secret()).update(p).digest('base64url');if(!s||s.length!==e.length||!crypto.timingSafeEqual(Buffer.from(s),Buffer.from(e)))return null;const x=JSON.parse(Buffer.from(p,'base64url'));return x.exp>Date.now()?x:null;}catch{return null;}}
function cookies(header=''){return Object.fromEntries(header.split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),decodeURIComponent(x.slice(i+1))];}));}
function cookie(res,name,value,opts={}){const line=[`${name}=${encodeURIComponent(value)}`,`Path=${opts.path||'/'}`];if(opts.httpOnly)line.push('HttpOnly');if(opts.sameSite)line.push(`SameSite=${opts.sameSite}`);if(opts.maxAge!==undefined)line.push(`Max-Age=${opts.maxAge}`);if(process.env.NODE_ENV==='production'||process.env.VERCEL)line.push('Secure');const cur=res.getHeader('Set-Cookie');res.setHeader('Set-Cookie',[...(cur?Array.isArray(cur)?cur:[cur]:[]),line.join('; ')]);}
function clear(res,n,httpOnly){cookie(res,n,'',{httpOnly,sameSite:'Lax',maxAge:0});}
const rateBuckets=new Map();
function requestIp(req){
  const forwarded=String(req.headers['x-forwarded-for']||'').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}
function rateLimit({limit=10,windowMs=15*60*1000,keyFn=requestIp}={}){
  return (req,res,next)=>{
    const nowMs=Date.now();
    const key=String(keyFn(req)||'unknown');
    let bucket=rateBuckets.get(key);
    if(!bucket || nowMs-bucket.startedAt>=windowMs){
      bucket={startedAt:nowMs,count:0};
      rateBuckets.set(key,bucket);
    }
    bucket.count+=1;
    const remaining=Math.max(0,limit-bucket.count);
    res.setHeader('X-RateLimit-Limit',String(limit));
    res.setHeader('X-RateLimit-Remaining',String(remaining));
    if(bucket.count>limit){
      const retryAfter=Math.max(1,Math.ceil((bucket.startedAt+windowMs-nowMs)/1000));
      res.setHeader('Retry-After',String(retryAfter));
      return res.status(429).json({ok:false,message:'Terlalu banyak percobaan. Coba lagi beberapa saat.'});
    }
    if(rateBuckets.size>5000){
      for(const [bucketKey,value] of rateBuckets){
        if(nowMs-value.startedAt>=windowMs)rateBuckets.delete(bucketKey);
      }
    }
    next();
  };
}
const loginRateLimit=rateLimit({
  limit:10,
  windowMs:15*60*1000,
  keyFn:req=>requestIp(req)+'|'+clean(req.body?.username,64).toLowerCase()
});
const setupRateLimit=rateLimit({limit:5,windowMs:15*60*1000});
const adminMutationRateLimit=rateLimit({limit:60,windowMs:10*60*1000,keyFn:req=>requestIp(req)+'|admin'});
function sameOrigin(req,res,next){
  const origin=req.get('origin');
  if(!origin)return next();
  try{
    const parsed=new URL(origin);
    const host=req.get('host');
    if(host && parsed.host!==host)return res.status(403).json({ok:false,message:'Origin tidak diizinkan.'});
    if(req.secure===false && process.env.VERCEL && parsed.protocol!=='https:'){
      return res.status(403).json({ok:false,message:'Origin tidak aman.'});
    }
  }catch{
    return res.status(403).json({ok:false,message:'Origin tidak valid.'});
  }
  next();
}
function csrf(req,res){const c=cookies(req.headers.cookie||'');if(c.efasa_csrf)return c.efasa_csrf;const t=crypto.randomBytes(24).toString('hex');cookie(res,'efasa_csrf',t,{sameSite:'Lax',maxAge:86400});return t;}
async function auth(req,res,next){try{const s=session(cookies(req.headers.cookie||'').efasa_admin);if(!s)return res.status(401).json({ok:false,message:'Unauthorized'});const a=await adminById(s.sub);if(!a||Number(a.session_version||1)!==Number(s.sv||1))return res.status(401).json({ok:false,message:'Session admin sudah tidak berlaku. Silakan login kembali.'});req.adminId=s.sub;req.admin=a;next();}catch(e){console.error('Admin auth:',e.message);res.status(500).json({ok:false,message:'Autentikasi admin gagal.'});}}
function csrfGuard(req,res,next){const c=cookies(req.headers.cookie||'');if(!c.efasa_csrf||c.efasa_csrf!==req.headers['x-efasa-csrf'])return res.status(403).json({ok:false,message:'CSRF token tidak valid. Muat ulang dashboard.'});next();}
async function browserMediaUrl(url){
  const value=String(url||'');
  if(!value)return '';
  if(value.startsWith('/uploads/'))return value;

  let pathname='';
  if(value.startsWith('/api/media?path=')){
    try{
      const parsed=new URL(value,'https://efasa.local');
      pathname=clean(parsed.searchParams.get('path')||'',1000);
    }catch{}
  }else{
    try{
      const u=new URL(value);
      const validHost=u.protocol==='https:' &&
        (u.hostname==='blob.vercel-storage.com'||/\.blob\.vercel-storage\.com$/i.test(u.hostname));
      if(!validHost)return '';
      pathname=decodeURIComponent(u.pathname.replace(/^\//,''));
    }catch(e){
      console.error('Blob media URL:',e.message);
      return '';
    }
  }

  pathname=decodeURIComponent(String(pathname||'')).replace(/^\//,'');
  if(!/^(logo|portfolio|stock)\//.test(pathname))return '';
  return '/api/media?path='+encodeURIComponent(pathname);
}

async function ready(){if(!USE_POSTGRES)return;if(!schemaReady){schemaReady=(async()=>{await sql`CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)`;await sql`CREATE TABLE IF NOT EXISTS admins(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;await sql`ALTER TABLE admins ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1`;await sql`CREATE TABLE IF NOT EXISTS media_items(id TEXT PRIMARY KEY,item_type TEXT NOT NULL CHECK(item_type IN ('portfolio','stock')),title TEXT,location TEXT,service TEXT,name TEXT,brand TEXT,capacity TEXT,price TEXT,description TEXT,media_url TEXT NOT NULL,media_type TEXT NOT NULL CHECK(media_type IN ('image','video')),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;await sql`CREATE INDEX IF NOT EXISTS media_items_type_idx ON media_items(item_type,created_at DESC)`;for(const [k,v] of Object.entries(DEFAULT_SETTINGS))await sql`INSERT INTO settings(key,value) VALUES(${k},${v}) ON CONFLICT(key) DO NOTHING`;})().catch(e=>{schemaReady=null;throw e;});}await schemaReady;}
async function settings(){requirePersistence();if(!USE_POSTGRES){const d=dbRead();d.settings={...DEFAULT_SETTINGS,...(d.settings||{})};dbWrite(d);return d.settings;}await ready();const r=await sql`SELECT key,value FROM settings`;return r.reduce((a,x)=>(a[x.key]=x.value,a),{...DEFAULT_SETTINGS});}
async function adminById(idv){requirePersistence();if(!USE_POSTGRES){const a=dbRead().admin;if(a&&a.id===idv){a.session_version=Number(a.session_version||1);return a;}return null;}await ready();const r=await sql`SELECT id,username,password_hash,created_at,session_version FROM admins WHERE id=${idv} LIMIT 1`;return r[0]||null;}
async function adminByName(name){requirePersistence();if(!USE_POSTGRES){const a=dbRead().admin;return a&&a.username===name?a:null;}await ready();if(name==='__any__'){const r=await sql`SELECT id,username,password_hash,created_at,session_version FROM admins LIMIT 1`;return r[0]||null;}const r=await sql`SELECT id,username,password_hash,created_at,session_version FROM admins WHERE username=${name} LIMIT 1`;return r[0]||null;}
async function allMedia(type){requirePersistence();if(!USE_POSTGRES){const d=dbRead();return (type==='portfolio'?d.portfolio:d.stock)||[];}await ready();const r=await sql`SELECT id,item_type,title,location,service,name,brand,capacity,price,description,media_url,media_type,created_at FROM media_items WHERE item_type=${type} ORDER BY created_at DESC`;return r.map(x=>({id:x.id,title:x.title||'',location:x.location||'',service:x.service||'',name:x.name||'',brand:x.brand||'',capacity:x.capacity||'',price:x.price||'',description:x.description||'',media:x.media_url,mediaType:x.media_type,createdAt:x.created_at}));}
async function insertMedia(x){requirePersistence();if(!USE_POSTGRES){const d=dbRead();(x.itemType==='portfolio'?d.portfolio:d.stock).unshift(x);dbWrite(d);return;}await ready();await sql`INSERT INTO media_items(id,item_type,title,location,service,name,brand,capacity,price,description,media_url,media_type,created_at) VALUES(${x.id},${x.itemType},${x.title||null},${x.location||null},${x.service||null},${x.name||null},${x.brand||null},${x.capacity||null},${x.price||null},${x.description||null},${x.media},${x.mediaType},${x.createdAt})`;}
async function removeMedia(type,itemId){requirePersistence();if(!USE_POSTGRES){const d=dbRead(),a=type==='portfolio'?d.portfolio:d.stock,i=a.findIndex(x=>x.id===itemId);if(i<0)return null;const [x]=a.splice(i,1);dbWrite(d);return x;}await ready();const r=await sql`DELETE FROM media_items WHERE id=${itemId} AND item_type=${type} RETURNING media_url`;return r[0]||null;}
async function removeFile(url){
  if(!url)return;

  if(url.startsWith('/uploads/')){
    const f=path.join(UPLOADS,path.basename(url));
    if(f.startsWith(UPLOADS)&&fs.existsSync(f))fs.unlinkSync(f);
    return;
  }

  if(STORAGE_MODE==='vercel-blob'){
    try{
      let target=url;
      if(url.startsWith('/api/media?path=')){
        const q=new URL(url,'https://efasa.local').searchParams.get('path')||'';
        if(!/^(logo|portfolio|stock)\//.test(q))return;
        target=q;
      }
      await del(target,{access:'private'});
    }catch(e){
      console.warn('Blob delete:',e.message);
    }
  }
}

app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','SAMEORIGIN');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy','camera=(),microphone=(),geolocation=(),payment=()');
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies','none');
  res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'");
  next();
});
app.use(express.json({limit:'300kb'}));
app.use(express.urlencoded({extended:true,limit:'300kb'}));
app.use(express.static(PUBLIC,{extensions:['html']}));

app.get('/api/media',async(req,res)=>{
  const pathname=clean(req.query?.path,1000).replace(/^\//,'');
  if(!/^(logo|portfolio|stock)\//.test(pathname)){
    return res.status(400).send('Media tidak valid.');
  }

  try{
    const result=await get(pathname,{access:'private',useCache:false});
    if(!result?.blob||!result?.stream){
      return res.status(404).send('Media tidak ditemukan.');
    }

    res.statusCode=200;
    res.setHeader('Content-Type',result.blob.contentType||'application/octet-stream');
    res.setHeader('Cache-Control','public, max-age=300, s-maxage=300, stale-while-revalidate=3600');
    if(result.blob.size!=null)res.setHeader('Content-Length',String(result.blob.size));

    if(typeof result.stream.pipe==='function'){
      result.stream.pipe(res);
      return;
    }

    if(typeof result.stream.getReader==='function'){
      const reader=result.stream.getReader();
      while(true){
        const chunk=await reader.read();
        if(chunk.done)break;
        res.write(Buffer.from(chunk.value));
      }
      res.end();
      return;
    }

    return res.status(500).send('Stream media tidak tersedia.');
  }catch(e){
    console.error('Blob media proxy:',e.message);
    return res.status(e.statusCode===404?404:500).send('Media tidak dapat dimuat.');
  }
});;

app.get('/api/health',async(_req,res)=>{try{await settings();res.json({ok:true});}catch(e){res.status(503).json({ok:false,message:'Service unavailable.'});}});
app.get('/api/public',async(_req,res)=>{try{
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma','no-cache');
  res.setHeader('Expires','0');
  const siteSettings=await settings();
  if(siteSettings.logo)siteSettings.logo=await browserMediaUrl(siteSettings.logo);
  const portfolio=await allMedia('portfolio');
  const stock=await allMedia('stock');
  const media=[...portfolio,...stock];
  for(const item of media)item.media=await browserMediaUrl(item.media);
  res.status(200).json({ok:true,settings:siteSettings,portfolio,stock});
}catch(e){res.status(e.statusCode||500).json({ok:false,message:e.message||'Data website gagal dimuat.',database:PERSISTENCE_MODE});}});
async function buildDatabaseBackup(){
  requirePersistence();

  if(!USE_POSTGRES){
    const d=dbRead();
    return {
      formatVersion:1,
      app:'EFASA TEKNIK',
      backupType:'database-data',
      createdAt:now(),
      storage:{database:'local-json',media:STORAGE_MODE},
      settings:{...DEFAULT_SETTINGS,...(d.settings||{})},
      admin:d.admin ? {id:d.admin.id||'',username:d.admin.username||'',created_at:d.admin.created_at||''} : null,
      portfolio:Array.isArray(d.portfolio)?d.portfolio:[],
      stock:Array.isArray(d.stock)?d.stock:[]
    };
  }

  await ready();
  const settingRows=await sql`SELECT key,value FROM settings ORDER BY key`;
  const adminRows=await sql`SELECT id,username,created_at FROM admins ORDER BY created_at ASC`;
  const mediaRows=await sql`SELECT id,item_type,title,location,service,name,brand,capacity,price,description,media_url,media_type,created_at FROM media_items ORDER BY created_at ASC`;
  const savedSettings=settingRows.reduce((out,row)=>{out[row.key]=row.value;return out;},{});
  const media=mediaRows.map(row=>({
    id:row.id,itemType:row.item_type,title:row.title||'',location:row.location||'',service:row.service||'',
    name:row.name||'',brand:row.brand||'',capacity:row.capacity||'',price:row.price||'',description:row.description||'',
    media:row.media_url,mediaType:row.media_type,createdAt:row.created_at
  }));
  return {
    formatVersion:1,
    app:'EFASA TEKNIK',
    backupType:'database-data',
    createdAt:now(),
    storage:{database:'postgres',media:STORAGE_MODE},
    settings:{...DEFAULT_SETTINGS,...savedSettings},
    admin:adminRows[0] ? {id:adminRows[0].id,username:adminRows[0].username,created_at:adminRows[0].created_at} : null,
    portfolio:media.filter(item=>item.itemType==='portfolio'),
    stock:media.filter(item=>item.itemType==='stock')
  };
}
app.get('/api/admin/status',async(req,res)=>{try{requirePersistence();const c=cookies(req.headers.cookie||''),s=session(c.efasa_admin);let a=null;if(USE_POSTGRES){if(s)a=await adminById(s.sub);}else{a=dbRead().admin;}const loggedIn=Boolean(a&&s&&a.id===s.sub);const configured=Boolean(await adminByName('__any__'));res.json({ok:true,configured,loggedIn,storageMode:STORAGE_MODE,csrfToken:loggedIn?csrf(req,res):(c.efasa_csrf||'')});}catch(e){res.status(500).json({ok:false,message:e.message});}});
app.get('/api/admin/backup',auth,async(_req,res)=>{
  try{
    const backup=await buildDatabaseBackup();
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    const filename=`efasa-database-backup-${stamp}.json`;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
    res.setHeader('Cache-Control','private, no-store, max-age=0');
    res.status(200).send(JSON.stringify(backup,null,2));
  }catch(e){
    console.error('Database backup:',e);
    res.status(e.statusCode||500).json({ok:false,message:e.message||'Backup database gagal.'});
  }
});
function blobPathFromStoredMediaUrl(url){
  const value=String(url||'').trim();
  if(!value)return '';
  if(value.startsWith('/api/media?path=')){
    try{
      const parsed=new URL(value,'https://efasa.local');
      const pathname=decodeURIComponent(parsed.searchParams.get('path')||'').replace(/^\//,'');
      return /^(logo|portfolio|stock)\//.test(pathname) ? pathname : '';
    }catch{return '';}
  }
  try{
    const parsed=new URL(value);
    const validHost=parsed.protocol==='https:' &&
      (parsed.hostname==='blob.vercel-storage.com'||/\.blob\.vercel-storage\.com$/i.test(parsed.hostname)||/\.private\.blob\.vercel-storage\.com$/i.test(parsed.hostname));
    if(!validHost)return '';
    const pathname=decodeURIComponent(parsed.pathname.replace(/^\//,'')).replace(/^\//,'');
    return /^(logo|portfolio|stock)\//.test(pathname) ? pathname : '';
  }catch{return '';}
}

function localPathFromStoredMediaUrl(url){
  const value=String(url||'').trim();
  if(!value.startsWith('/uploads/'))return '';
  const pathname=value.replace(/^\/+/,'');
  const filePath=path.join(PUBLIC,pathname);
  return filePath.startsWith(PUBLIC+path.sep) ? filePath : '';
}

function backupArchiveName(type,id,url){
  const pathname=blobPathFromStoredMediaUrl(url)||path.basename(String(url||''));
  const base=path.basename(pathname||'file').replace(/[^a-zA-Z0-9._-]+/g,'-')||'file';
  return `media/${type}/${id}-${base}`;
}

function appendArchiveBuffer(archive,name,buffer){
  archive.append(buffer,{name});
}

async function appendBackupMedia(archive,item,archiveName,missing){
  const url=String(item.media||'').trim();
  if(!url){missing.push({archiveName,reason:'URL media kosong'});return;}

  if(STORAGE_MODE==='local'){
    const filePath=localPathFromStoredMediaUrl(url);
    if(!filePath||!fs.existsSync(filePath)){missing.push({archiveName,reason:'File lokal tidak ditemukan',source:url});return;}
    archive.file(filePath,{name:archiveName});
    return;
  }

  const pathname=blobPathFromStoredMediaUrl(url);
  if(!pathname){missing.push({archiveName,reason:'Path Vercel Blob tidak valid',source:url});return;}
  const result=await get(pathname,{access:'private',useCache:false});
  if(!result?.stream){missing.push({archiveName,reason:'Media Vercel Blob tidak ditemukan',source:pathname});return;}
  const stream=Readable.fromWeb(result.stream);
  archive.append(stream,{name:archiveName});
  await new Promise((resolve,reject)=>{
    stream.once('end',resolve);
    stream.once('error',reject);
  });
}

async function appendBackupLogo(archive,logoUrl,missing){
  if(!logoUrl)return;
  const archiveName='media/logo/logo-'+path.basename(String(blobPathFromStoredMediaUrl(logoUrl)||logoUrl)).replace(/[^a-zA-Z0-9._-]+/g,'-');
  await appendBackupMedia(archive,{media:logoUrl},archiveName,missing);
}

async function populateFullBackupArchive(archive){
  const backup=await buildDatabaseBackup();
  const missing=[];
  const files=[];
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const filename=`efasa-full-backup-${stamp}.zip`;

  archive.on('warning',err=>console.warn('Full backup archive warning:',err.message));

  appendArchiveBuffer(archive,'database.json',Buffer.from(JSON.stringify(backup,null,2),'utf8'));
  files.push('database.json');
  appendArchiveBuffer(archive,'README.txt',Buffer.from([
    'EFASA TEKNIK - FULL BACKUP',
    '',
    `Dibuat: ${backup.createdAt}`,
    'Isi:',
    '- database.json berisi data website tanpa password admin.',
    '- media/ berisi logo, dokumentasi, dan stok yang masih tersedia.',
    '- File media yang gagal diambil dicatat di manifest.json.',
    '',
    'Catatan: Backup ini adalah salinan data + media, bukan proses restore otomatis.'
  ].join('\\n'),'utf8'));
  files.push('README.txt');

  if(backup.settings?.logo){
    const name='media/logo/'+path.basename(String(blobPathFromStoredMediaUrl(backup.settings.logo)||backup.settings.logo)).replace(/[^a-zA-Z0-9._-]+/g,'-');
    await appendBackupMedia(archive,{media:backup.settings.logo},name,missing);
    if(!missing.some(x=>x.archiveName===name))files.push(name);
  }

  for(const item of [...backup.portfolio,...backup.stock]){
    const type=item.itemType==='stock'?'stock':'portfolio';
    const name=backupArchiveName(type,item.id,item.media);
    await appendBackupMedia(archive,item,name,missing);
    if(!missing.some(x=>x.archiveName===name))files.push(name);
  }

  const manifest={
    formatVersion:1,
    app:'EFASA TEKNIK',
    backupType:'full',
    createdAt:backup.createdAt,
    database:{
      portfolioCount:Array.isArray(backup.portfolio)?backup.portfolio.length:0,
      stockCount:Array.isArray(backup.stock)?backup.stock.length:0,
      adminIncluded:false
    },
    media:{
      expected:files.filter(x=>x.startsWith('media/')).length+missing.length,
      included:files.filter(x=>x.startsWith('media/')).length,
      missing:missing.length
    },
    missingMedia:missing,
    files
  };
  appendArchiveBuffer(archive,'manifest.json',Buffer.from(JSON.stringify(manifest,null,2),'utf8'));

  return {backup,filename,manifest};
}

app.get('/api/admin/backup/full',auth,async(_req,res)=>{
  let output=null;
  try{
    const archive=archiver('zip',{zlib:{level:6}});
    if(STORAGE_MODE==='local'){
      output=new PassThrough();
      archive.pipe(output).pipe(res);
      const full=await populateFullBackupArchive(archive);
      res.setHeader('Content-Type','application/zip');
      res.setHeader('Content-Disposition',`attachment; filename="${full.filename}"`);
      res.setHeader('Cache-Control','private, no-store, max-age=0');
      await archive.finalize();
      return;
    }

    output=new PassThrough();
    archive.pipe(output);
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    const blobPath=`backups/efasa-full-backup-${stamp}-${crypto.randomBytes(6).toString('hex')}.zip`;
    const uploadPromise=put(blobPath,Readable.toWeb(output),{
      access:'private',
      contentType:'application/zip',
      addRandomSuffix:false,
      multipart:true
    });
    const full=await populateFullBackupArchive(archive);
    await archive.finalize();
    const uploaded=await uploadPromise;
    const validUntil=Date.now()+(15*60*1000);
    const token=await issueSignedToken({pathname:uploaded.pathname,operations:['get'],validUntil});
    const signed=await presignUrl(token,{pathname:uploaded.pathname,operation:'get',validUntil});
    return res.redirect(302,signed.presignedUrl);
  }catch(e){
    try{output?.destroy(e);}catch{}
    console.error('Full database/media backup:',e);
    if(!res.headersSent)return res.status(e.statusCode||500).json({ok:false,message:e.message||'Full backup gagal.'});
  }
});
app.post('/api/admin/setup',setupRateLimit,sameOrigin,async(req,res)=>{try{requirePersistence();let existing;if(USE_POSTGRES){await ready();const r=await sql`SELECT id FROM admins LIMIT 1`;existing=r[0]||null;}else{existing=dbRead().admin;}if(existing)return res.status(409).json({ok:false,message:'Admin sudah dibuat. Silakan login.'});const setupSecret=String(process.env.ADMIN_SETUP_SECRET||process.env.SESSION_SECRET||'');if(!setupSecret||String(req.body.setupSecret||'')!==setupSecret)return res.status(403).json({ok:false,message:'Setup secret tidak valid.'});const username=clean(req.body.username,32),password=String(req.body.password||'');if(!/^[a-zA-Z0-9._-]{3,32}$/.test(username))return res.status(400).json({ok:false,message:'Username 3-32 karakter.'});if(password.length<10)return res.status(400).json({ok:false,message:'Password minimal 10 karakter.'});const x={id:id(),username,password_hash:hash(password),session_version:1,created_at:now()};if(USE_POSTGRES){await ready();await sql`INSERT INTO admins(id,username,password_hash,session_version,created_at) VALUES(${x.id},${x.username},${x.password_hash},${x.session_version},${x.created_at})`;}else{const d=dbRead();if(d.admin)return res.status(409).json({ok:false,message:'Admin sudah dibuat.'});d.admin=x;dbWrite(d);}res.json({ok:true,message:'Admin berhasil dibuat.'});}catch(e){res.status(500).json({ok:false,message:e.message});}});
app.post('/api/admin/login',loginRateLimit,sameOrigin,async(req,res)=>{try{const a=await adminByName(clean(req.body.username,32));if(!a||!verifyPassword(String(req.body.password||''),a.password_hash||a.password))return res.status(401).json({ok:false,message:'Username atau password salah.'});cookie(res,'efasa_admin',token(a.id,a.session_version||1),{httpOnly:true,sameSite:'Lax',maxAge:86400});csrf(req,res);res.json({ok:true});}catch(e){res.status(500).json({ok:false,message:e.message});}});
app.post('/api/admin/password',auth,csrfGuard,adminMutationRateLimit,sameOrigin,async(req,res)=>{try{const password=String(req.body.password||''),confirm=String(req.body.confirmPassword||'');if(password.length<10)return res.status(400).json({ok:false,message:'Password baru minimal 10 karakter.'});if(password!==confirm)return res.status(400).json({ok:false,message:'Konfirmasi password tidak sama.'});const newHash=hash(password);let nextVersion=Number(req.admin?.session_version||1)+1;if(!USE_POSTGRES){const d=dbRead();if(!d.admin||d.admin.id!==req.adminId)return res.status(404).json({ok:false,message:'Admin tidak ditemukan.'});d.admin.password_hash=newHash;d.admin.session_version=nextVersion;dbWrite(d);}else{await ready();const r=await sql`UPDATE admins SET password_hash=${newHash},session_version=session_version+1 WHERE id=${req.adminId} RETURNING id,session_version`;if(!r[0])return res.status(404).json({ok:false,message:'Admin tidak ditemukan.'});nextVersion=Number(r[0].session_version||nextVersion);}cookie(res,'efasa_admin',token(req.adminId,nextVersion),{httpOnly:true,sameSite:'Lax',maxAge:86400});res.json({ok:true,message:'Password berhasil diubah. Session lama sudah dibatalkan.'});}catch(e){console.error('Admin password:',e.message);res.status(500).json({ok:false,message:'Password gagal diubah.'});}});
app.post('/api/admin/logout',auth,sameOrigin,(req,res)=>{clear(res,'efasa_admin',true);clear(res,'efasa_csrf',false);res.json({ok:true});});
app.put('/api/admin/settings',auth,csrfGuard,adminMutationRateLimit,sameOrigin,async(req,res)=>{try{const updates={};for(const k of Object.keys(DEFAULT_SETTINGS)){if(typeof req.body[k]==='string')updates[k]=clean(req.body[k],k==='heroText'?1200:500);}if(Object.prototype.hasOwnProperty.call(updates,'mapsLink')&&updates.mapsLink){try{const parsed=new URL(updates.mapsLink);if(parsed.protocol!=='https:')return res.status(400).json({ok:false,message:'Link Google Maps harus menggunakan HTTPS.'});updates.mapsLink=parsed.toString();}catch{return res.status(400).json({ok:false,message:'Link Google Maps tidak valid.'});}}if(!USE_POSTGRES){const d=dbRead();d.settings={...DEFAULT_SETTINGS,...(d.settings||{}),...updates};dbWrite(d);return res.json({ok:true,settings:d.settings});}await ready();for(const [k,v] of Object.entries(updates))await sql`INSERT INTO settings(key,value) VALUES(${k},${v}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;res.json({ok:true,settings:await settings()});}catch(e){res.status(500).json({ok:false,message:e.message});}});


function localMedia(req){
  if(!req.file?.buffer)return '';
  const filename=`${Date.now()}-${crypto.randomBytes(7).toString('hex')}${path.extname(req.file.originalname).toLowerCase()}`;
  const filePath=path.join(UPLOADS,filename);
  fs.writeFileSync(filePath,req.file.buffer);
  return '/uploads/'+filename;
}
async function saveItem(type,req,res){
  if(!req.file)return res.status(400).json({ok:false,message:'File foto/video wajib dipilih.'});

  try{
    let media='';
    let blobPath='';

    if(STORAGE_MODE==='local'){
      media=localMedia(req);
    }else{
      const safeName=path.basename(req.file.originalname)
        .replace(/[^a-zA-Z0-9._-]+/g,'-')
        .replace(/^-+|-+$/g,'')||'file';

      blobPath=type+'/'+Date.now()+'-'+crypto.randomBytes(8).toString('hex')+'-'+safeName;

      const blob=await put(blobPath,req.file.buffer,{
        access:'private',
        contentType:req.file.mimetype,
        addRandomSuffix:false
      });

      blobPath=clean(blob?.pathname||blobPath,1000).replace(/^\//,'');
      if(!/^(portfolio|stock)\//.test(blobPath)){
        throw new Error('Vercel Blob mengembalikan pathname media yang tidak valid.');
      }

      media='/api/media?path='+encodeURIComponent(blobPath);
      console.info('Blob media upload success:',{
        type,
        pathname:blobPath,
        size:req.file.size,
        contentType:req.file.mimetype
      });
    }

    if(!media)throw new Error('Media gagal disimpan.');

    const x={
      id:id(),
      itemType:type,
      title:clean(req.body.title||'',140),
      location:clean(req.body.location,120),
      service:clean(req.body.service||'',120),
      name:clean(req.body.name||'',140),
      brand:clean(req.body.brand,80),
      capacity:clean(req.body.capacity,60),
      price:clean(req.body.price,80),
      description:clean(req.body.description,1200),
      media,
      mediaType:req.file.mimetype.startsWith('video/')?'video':'image',
      createdAt:now()
    };

    if(type==='portfolio'&&!x.title)x.title='Dokumentasi pekerjaan EFASA TEKNIK';
    if(type==='stock'&&!x.name)x.name='Unit AC';

    try{
      await insertMedia(x);
    }catch(e){
      if(STORAGE_MODE==='vercel-blob'&&blobPath){
        try{await del(blobPath,{access:'private'});}catch(cleanupError){
          console.warn('Blob DB failure cleanup:',cleanupError.message);
        }
      }else if(STORAGE_MODE==='local'&&media){
        try{await removeFile(media);}catch(cleanupError){
          console.warn('Local media DB cleanup:',cleanupError.message);
        }
      }
      throw e;
    }

    return res.json({ok:true,item:x});
  }catch(e){
    console.error('Save media item:',e);
    return res.status(e.statusCode||500).json({
      ok:false,
      message:e.message||'Gagal menyimpan media.'
    });
  }
}
app.post('/api/admin/portfolio',auth,csrfGuard,adminMutationRateLimit,sameOrigin,mediaUploadSingle,(req,res)=>saveItem('portfolio',req,res));
app.post('/api/admin/stock',auth,csrfGuard,adminMutationRateLimit,sameOrigin,mediaUploadSingle,(req,res)=>saveItem('stock',req,res));
app.post('/api/admin/logo',auth,csrfGuard,adminMutationRateLimit,sameOrigin,logoUpload.single('media'),async(req,res)=>{
  try{
    if(!req.file)return res.status(400).json({ok:false,message:'File logo wajib dipilih.'});
    let media='';
    if(STORAGE_MODE==='vercel-blob'){
      const result=await put(
        'logo/'+Date.now()+'-'+crypto.randomBytes(8).toString('hex')+'-'+path.basename(req.file.originalname),
        req.file.buffer,
        {
          access:'private',
          contentType:req.file.mimetype,
          addRandomSuffix:false
        }
      );
      media=result.url;
    }else{
      const filename=`${Date.now()}-${crypto.randomBytes(7).toString('hex')}${path.extname(req.file.originalname).toLowerCase()}`;
      const filePath=path.join(UPLOADS,filename);
      fs.writeFileSync(filePath,req.file.buffer);
      media='/uploads/'+filename;
    }

    const st=await settings();
    if(st.logo)await removeFile(st.logo);

    if(!USE_POSTGRES){
      const d=dbRead();
      d.settings={...DEFAULT_SETTINGS,...(d.settings||{}),logo:media};
      dbWrite(d);
    }else{
      await ready();
      await sql`INSERT INTO settings(key,value) VALUES('logo',${media}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
    }
    res.json({ok:true,logo:media});
  }catch(e){
    console.error('Logo upload:',e);
    res.status(500).json({ok:false,message:e.message||'Gagal menyimpan logo.'});
  }
});

async function delItem(type,req,res){try{const x=await removeMedia(type,req.params.id);if(!x)return res.status(404).json({ok:false,message:'Data tidak ditemukan.'});await removeFile(x.media_url||x.media);res.json({ok:true});}catch(e){res.status(500).json({ok:false,message:e.message});}}
app.delete('/api/admin/portfolio/:id',auth,csrfGuard,adminMutationRateLimit,sameOrigin,(req,res)=>delItem('portfolio',req,res));
app.delete('/api/admin/stock/:id',auth,csrfGuard,adminMutationRateLimit,sameOrigin,(req,res)=>delItem('stock',req,res));
app.get('/admin',(req,res)=>res.sendFile(path.join(PUBLIC,'admin','index.html')));
app.get('/admin/setup',(req,res)=>res.sendFile(path.join(PUBLIC,'setup.html')));
app.get('/admin/login',(req,res)=>res.sendFile(path.join(PUBLIC,'login.html')));
app.use((err,_req,res,_next)=>{console.error(err);if(err instanceof multer.MulterError)return res.status(400).json({ok:false,message:`Upload gagal: ${err.message}`});res.status(err.statusCode||500).json({ok:false,message:err.message||'Terjadi kesalahan server.'});});
module.exports=app;
