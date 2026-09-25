require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');
const { del, issueSignedToken, presignUrl } = require('@vercel/blob');
const { handleUpload } = require('@vercel/blob/client');

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
  whatsapp: '', email: '', instagram: '', address: 'Malang, Jawa Timur',
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
function secret(){return process.env.SESSION_SECRET || 'efasa-dev-secret-change-me-please';}
function hash(password,salt=crypto.randomBytes(16).toString('hex')){return `${salt}:${crypto.scryptSync(password,salt,64).toString('hex')}`;}
function verifyPassword(password,stored){try{const [s,e]=String(stored||'').split(':');if(!s||!e)return false;const a=crypto.scryptSync(password,s,64).toString('hex');return a.length===e.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(e));}catch{return false;}}
function token(adminId){const p=Buffer.from(JSON.stringify({sub:adminId,exp:Date.now()+86400000})).toString('base64url');return `${p}.${crypto.createHmac('sha256',secret()).update(p).digest('base64url')}`;}
function session(raw){try{const [p,s]=String(raw||'').split('.');const e=crypto.createHmac('sha256',secret()).update(p).digest('base64url');if(!s||s.length!==e.length||!crypto.timingSafeEqual(Buffer.from(s),Buffer.from(e)))return null;const x=JSON.parse(Buffer.from(p,'base64url'));return x.exp>Date.now()?x:null;}catch{return null;}}
function cookies(header=''){return Object.fromEntries(header.split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),decodeURIComponent(x.slice(i+1))];}));}
function cookie(res,name,value,opts={}){const line=[`${name}=${encodeURIComponent(value)}`,`Path=${opts.path||'/'}`];if(opts.httpOnly)line.push('HttpOnly');if(opts.sameSite)line.push(`SameSite=${opts.sameSite}`);if(opts.maxAge!==undefined)line.push(`Max-Age=${opts.maxAge}`);if(process.env.NODE_ENV==='production'||process.env.VERCEL)line.push('Secure');const cur=res.getHeader('Set-Cookie');res.setHeader('Set-Cookie',[...(cur?Array.isArray(cur)?cur:[cur]:[]),line.join('; ')]);}
function clear(res,n,httpOnly){cookie(res,n,'',{httpOnly,sameSite:'Lax',maxAge:0});}
function csrf(req,res){const c=cookies(req.headers.cookie||'');if(c.efasa_csrf)return c.efasa_csrf;const t=crypto.randomBytes(24).toString('hex');cookie(res,'efasa_csrf',t,{sameSite:'Lax',maxAge:86400});return t;}
function auth(req,res,next){const s=session(cookies(req.headers.cookie||'').efasa_admin);if(!s)return res.status(401).json({ok:false,message:'Unauthorized'});req.adminId=s.sub;next();}
function csrfGuard(req,res,next){const c=cookies(req.headers.cookie||'');if(!c.efasa_csrf||c.efasa_csrf!==req.headers['x-efasa-csrf'])return res.status(403).json({ok:false,message:'CSRF token tidak valid. Muat ulang dashboard.'});next();}
function mediaUrlOk(url){try{if(String(url).startsWith('/uploads/'))return true;const u=new URL(url);return u.protocol==='https:'&&(u.hostname==='blob.vercel-storage.com'||/\.blob\.vercel-storage\.com$/i.test(u.hostname));}catch{return false;}}
function blobMediaFromBody(body,kind){
  const supplied=clean(body?.mediaUrl,2000);
  const origin=clean(body?.mediaOrigin,300);
  const pathname=clean(body?.mediaPath,1000).replace(/^\//,'');
  if(pathname&&origin){
    try{
      const u=new URL(origin);
      if(u.protocol!=='https:'||!/\.blob\.vercel-storage\.com$/i.test(u.hostname))return '';
      const normalized=kind+'/'+pathname.split('/').slice(1).join('/');
      if(!pathname.startsWith(kind+'/'))return '';
      return u.origin+'/'+pathname.split('/').map(encodeURIComponent).join('/');
    }catch{return '';}
  }
  return supplied&&mediaUrlOk(supplied)?supplied:'';
}

async function browserMediaUrl(url){
  const value=String(url||'');
  if(!value)return '';
  if(value.startsWith('/uploads/'))return value;
  try{
    const u=new URL(value);
    if(u.protocol!=='https:'||(u.hostname!=='blob.vercel-storage.com'&&!/\.blob\.vercel-storage\.com$/i.test(u.hostname)))return '';
    const pathname=decodeURIComponent(u.pathname.replace(/^\//,''));
    if(!pathname)return '';
    const validUntil=Date.now()+60*60*1000;
    const signedToken=await issueSignedToken({pathname,operations:['get'],validUntil});
    const signed=await presignUrl(signedToken,{pathname,operation:'get',validUntil});
    return signed.presignedUrl;
  }catch(e){
    console.error('Blob read URL:',e.message);
    return '';
  }
}
async function ready(){if(!USE_POSTGRES)return;if(!schemaReady){schemaReady=(async()=>{await sql`CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)`;await sql`CREATE TABLE IF NOT EXISTS admins(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;await sql`CREATE TABLE IF NOT EXISTS media_items(id TEXT PRIMARY KEY,item_type TEXT NOT NULL CHECK(item_type IN ('portfolio','stock')),title TEXT,location TEXT,service TEXT,name TEXT,brand TEXT,capacity TEXT,price TEXT,description TEXT,media_url TEXT NOT NULL,media_type TEXT NOT NULL CHECK(media_type IN ('image','video')),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;await sql`CREATE INDEX IF NOT EXISTS media_items_type_idx ON media_items(item_type,created_at DESC)`;for(const [k,v] of Object.entries(DEFAULT_SETTINGS))await sql`INSERT INTO settings(key,value) VALUES(${k},${v}) ON CONFLICT(key) DO NOTHING`;})().catch(e=>{schemaReady=null;throw e;});}await schemaReady;}
async function settings(){requirePersistence();if(!USE_POSTGRES){const d=dbRead();d.settings={...DEFAULT_SETTINGS,...(d.settings||{})};dbWrite(d);return d.settings;}await ready();const r=await sql`SELECT key,value FROM settings`;return r.reduce((a,x)=>(a[x.key]=x.value,a),{...DEFAULT_SETTINGS});}
async function adminById(idv){requirePersistence();if(!USE_POSTGRES)return dbRead().admin?.id===idv?dbRead().admin:null;await ready();const r=await sql`SELECT id,username,password_hash,created_at FROM admins WHERE id=${idv} LIMIT 1`;return r[0]||null;}
async function adminByName(name){requirePersistence();if(!USE_POSTGRES){const a=dbRead().admin;return a&&a.username===name?a:null;}await ready();if(name==='__any__'){const r=await sql`SELECT id,username,password_hash,created_at FROM admins LIMIT 1`;return r[0]||null;}const r=await sql`SELECT id,username,password_hash,created_at FROM admins WHERE username=${name} LIMIT 1`;return r[0]||null;}
async function allMedia(type){requirePersistence();if(!USE_POSTGRES){const d=dbRead();return (type==='portfolio'?d.portfolio:d.stock)||[];}await ready();const r=await sql`SELECT id,item_type,title,location,service,name,brand,capacity,price,description,media_url,media_type,created_at FROM media_items WHERE item_type=${type} ORDER BY created_at DESC`;return r.map(x=>({id:x.id,title:x.title||'',location:x.location||'',service:x.service||'',name:x.name||'',brand:x.brand||'',capacity:x.capacity||'',price:x.price||'',description:x.description||'',media:x.media_url,mediaType:x.media_type,createdAt:x.created_at}));}
async function insertMedia(x){requirePersistence();if(!USE_POSTGRES){const d=dbRead();(x.itemType==='portfolio'?d.portfolio:d.stock).unshift(x);dbWrite(d);return;}await ready();await sql`INSERT INTO media_items(id,item_type,title,location,service,name,brand,capacity,price,description,media_url,media_type,created_at) VALUES(${x.id},${x.itemType},${x.title||null},${x.location||null},${x.service||null},${x.name||null},${x.brand||null},${x.capacity||null},${x.price||null},${x.description||null},${x.media},${x.mediaType},${x.createdAt})`;}
async function removeMedia(type,itemId){requirePersistence();if(!USE_POSTGRES){const d=dbRead(),a=type==='portfolio'?d.portfolio:d.stock,i=a.findIndex(x=>x.id===itemId);if(i<0)return null;const [x]=a.splice(i,1);dbWrite(d);return x;}await ready();const r=await sql`DELETE FROM media_items WHERE id=${itemId} AND item_type=${type} RETURNING media_url`;return r[0]||null;}
async function removeFile(url){if(!url)return;if(url.startsWith('/uploads/')){const f=path.join(UPLOADS,path.basename(url));if(f.startsWith(UPLOADS)&&fs.existsSync(f))fs.unlinkSync(f);return;}if(STORAGE_MODE==='vercel-blob'){try{await del(url);}catch(e){console.warn('Blob delete:',e.message);}}}

app.use(express.json({limit:'300kb'}));
app.use(express.urlencoded({extended:true,limit:'300kb'}));
app.use(express.static(PUBLIC,{extensions:['html']}));

app.get('/api/health',async(_req,res)=>{const hasDatabaseUrl=Boolean(process.env.DATABASE_URL);try{await settings();res.json({ok:true,database:'postgres',storage:STORAGE_MODE,node:process.version,hasDatabaseUrl});}catch(e){res.status(e.statusCode||500).json({ok:false,database:PERSISTENCE_MODE,storage:STORAGE_MODE,node:process.version,hasDatabaseUrl,message:e.message});}});
app.get('/api/public',async(_req,res)=>{try{
  const siteSettings=await settings();
  if(siteSettings.logo)siteSettings.logo=await browserMediaUrl(siteSettings.logo);
  const portfolio=await allMedia('portfolio');
  const stock=await allMedia('stock');
  const media=[...portfolio,...stock];
  for(const item of media)item.media=await browserMediaUrl(item.media);
  res.json({ok:true,settings:siteSettings,portfolio,stock,storageMode:STORAGE_MODE});
}catch(e){res.status(e.statusCode||500).json({ok:false,message:e.message||'Data website gagal dimuat.',database:PERSISTENCE_MODE});}});
app.get('/api/admin/status',async(req,res)=>{try{requirePersistence();const c=cookies(req.headers.cookie||''),s=session(c.efasa_admin);let a=null;if(USE_POSTGRES){if(s)a=await adminById(s.sub);}else{a=dbRead().admin;}const loggedIn=Boolean(a&&s&&a.id===s.sub);const configured=Boolean(await adminByName('__any__'));res.json({ok:true,configured,loggedIn,storageMode:STORAGE_MODE,csrfToken:loggedIn?csrf(req,res):(c.efasa_csrf||'')});}catch(e){res.status(500).json({ok:false,message:e.message});}});
app.post('/api/admin/setup',async(req,res)=>{try{requirePersistence();let existing;if(USE_POSTGRES){await ready();const r=await sql`SELECT id FROM admins LIMIT 1`;existing=r[0]||null;}else{existing=dbRead().admin;}if(existing)return res.status(409).json({ok:false,message:'Admin sudah dibuat. Silakan login.'});const username=clean(req.body.username,32),password=String(req.body.password||'');if(!/^[a-zA-Z0-9._-]{3,32}$/.test(username))return res.status(400).json({ok:false,message:'Username 3-32 karakter.'});if(password.length<10)return res.status(400).json({ok:false,message:'Password minimal 10 karakter.'});const x={id:id(),username,password_hash:hash(password),created_at:now()};if(USE_POSTGRES){await ready();await sql`INSERT INTO admins(id,username,password_hash,created_at) VALUES(${x.id},${x.username},${x.password_hash},${x.created_at})`;}else{const d=dbRead();if(d.admin)return res.status(409).json({ok:false,message:'Admin sudah dibuat.'});d.admin=x;dbWrite(d);}res.json({ok:true,message:'Admin berhasil dibuat.'});}catch(e){res.status(500).json({ok:false,message:e.message});}});
app.post('/api/admin/login',async(req,res)=>{try{const a=await adminByName(clean(req.body.username,32));if(!a||!verifyPassword(String(req.body.password||''),a.password_hash||a.password))return res.status(401).json({ok:false,message:'Username atau password salah.'});cookie(res,'efasa_admin',token(a.id),{httpOnly:true,sameSite:'Lax',maxAge:86400});csrf(req,res);res.json({ok:true});}catch(e){res.status(500).json({ok:false,message:e.message});}});
app.post('/api/admin/password',auth,csrfGuard,async(req,res)=>{try{const password=String(req.body.password||''),confirm=String(req.body.confirmPassword||'');if(password.length<10)return res.status(400).json({ok:false,message:'Password baru minimal 10 karakter.'});if(password!==confirm)return res.status(400).json({ok:false,message:'Konfirmasi password tidak sama.'});const newHash=hash(password);if(!USE_POSTGRES){const d=dbRead();if(!d.admin||d.admin.id!==req.adminId)return res.status(404).json({ok:false,message:'Admin tidak ditemukan.'});d.admin.password_hash=newHash;dbWrite(d);}else{await ready();const r=await sql`UPDATE admins SET password_hash=${newHash} WHERE id=${req.adminId} RETURNING id`;if(!r[0])return res.status(404).json({ok:false,message:'Admin tidak ditemukan.'});}cookie(res,'efasa_admin',token(req.adminId),{httpOnly:true,sameSite:'Lax',maxAge:86400});res.json({ok:true,message:'Password berhasil diubah.'});}catch(e){res.status(500).json({ok:false,message:e.message});}});
app.post('/api/admin/logout',auth,(req,res)=>{clear(res,'efasa_admin',true);clear(res,'efasa_csrf',false);res.json({ok:true});});
app.put('/api/admin/settings',auth,csrfGuard,async(req,res)=>{try{const updates={};for(const k of Object.keys(DEFAULT_SETTINGS)){if(typeof req.body[k]==='string')updates[k]=clean(req.body[k],k==='heroText'?1200:500);}if(!USE_POSTGRES){const d=dbRead();d.settings={...DEFAULT_SETTINGS,...(d.settings||{}),...updates};dbWrite(d);return res.json({ok:true,settings:d.settings});}await ready();for(const [k,v] of Object.entries(updates))await sql`INSERT INTO settings(key,value) VALUES(${k},${v}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;res.json({ok:true,settings:await settings()});}catch(e){res.status(500).json({ok:false,message:e.message});}});
app.post('/api/blob/upload-url',auth,csrfGuard,async(req,res)=>{try{
  const kind=clean(req.body?.kind,20),fileName=clean(req.body?.fileName,240),contentType=clean(req.body?.contentType,120);
  const size=Number(req.body?.size||0);
  if(!['logo','portfolio','stock'].includes(kind))return res.status(400).json({ok:false,message:'Jenis upload tidak valid.'});
  if(!fileName||!size||!Number.isFinite(size)||size<1)return res.status(400).json({ok:false,message:'Informasi file tidak valid.'});
  const logoTypes=new Set(['image/jpeg','image/png','image/webp']);
  if(kind==='logo'){
    if(!logoTypes.has(contentType))return res.status(400).json({ok:false,message:'Logo harus JPG, PNG, atau WebP.'});
    if(size>5*1024*1024)return res.status(400).json({ok:false,message:'Ukuran logo maksimal 5 MB.'});
  }else{
    if(!MIME.has(contentType))return res.status(400).json({ok:false,message:'Tipe file tidak didukung.'});
    if(size>100*1024*1024)return res.status(400).json({ok:false,message:'Ukuran file maksimal 100 MB.'});
  }

  // Vercel Blob signed URLs are scoped to one pathname + operation + expiry.
  // On current Vercel deployments the SDK can authenticate this server-side
  // through Vercel OIDC; do not pass a stale/static read-write token here.
  const safeName=path.basename(fileName).replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'')||'file';
  const pathname=kind+'/'+Date.now()+'-'+crypto.randomBytes(8).toString('hex')+'-'+safeName;
  const token=await issueSignedToken({
    pathname,
    operations:['put'],
    allowedContentTypes:[contentType],
    maximumSizeInBytes:kind==='logo'?5*1024*1024:100*1024*1024,
    validUntil:Date.now()+15*60*1000
  });
  const signed=await presignUrl(token,{pathname,operation:'put',validUntil:Date.now()+15*60*1000});
  const storeId=String(process.env.BLOB_STORE_ID||'').replace(/^store_/,'').trim();
  if(!storeId)throw new Error('BLOB_STORE_ID tidak tersedia. Pastikan Blob store terhubung ke project Vercel.');
  const signedBlobUrl=new URL(signed.presignedUrl);
  const mediaOrigin=signedBlobUrl.origin;
  signedBlobUrl.search='';
  const mediaUrl=signedBlobUrl.toString();
  res.json({ok:true,presignedUrl:signed.presignedUrl,mediaUrl,mediaOrigin,mediaPath:pathname,mediaType:contentType.startsWith('video/')?'video':'image'});
}catch(e){console.error('Blob presign upload:',e);res.status(400).json({ok:false,message:e.message||'Gagal membuat URL upload Blob.'});}});
app.post('/api/blob/upload',async(req,res)=>{try{const s=session(cookies(req.headers.cookie||'').efasa_admin);if(!s)return res.status(401).json({error:'Unauthorized'});const body=req.body&&typeof req.body==='object'?req.body:null;if(!body||typeof body.type!=='string'||!body.payload)throw new Error('Payload upload Blob tidak valid.');const uploadOptions={body,request:req,...(process.env.BLOB_READ_WRITE_TOKEN?{token:process.env.BLOB_READ_WRITE_TOKEN}:{}),onBeforeGenerateToken:async(_p,payloadRaw)=>{let p={};try{p=payloadRaw?JSON.parse(payloadRaw):{};}catch{throw new Error('Payload upload tidak valid.');}const kind=p.kind;if(!['logo','portfolio','stock'].includes(kind))throw new Error('Jenis upload tidak valid.');return{allowedContentTypes:kind==='logo'?['image/jpeg','image/png','image/webp']:Array.from(MIME),maximumSizeInBytes:kind==='logo'?5*1024*1024:100*1024*1024,addRandomSuffix:true,tokenPayload:JSON.stringify({kind,adminId:s.sub})};},onUploadCompleted:async()=>{}};const out=await handleUpload(uploadOptions);return res.status(200).json(out);}catch(e){console.error('Blob client upload:',e.message);return res.status(400).json({error:e.message||'Gagal membuat token upload.'});}});

function localMedia(req){return req.file?`/uploads/${req.file.filename}`:'';}
async function saveItem(type,req,res){try{const media=STORAGE_MODE==='local'?localMedia(req):blobMediaFromBody(req.body,type);if(!media)return res.status(400).json({ok:false,message:'Media Blob tidak valid. Upload ulang file dari dashboard.'});const x={id:id(),itemType:type,title:clean(req.body.title||'',140),location:clean(req.body.location,120),service:clean(req.body.service||'',120),name:clean(req.body.name||'',140),brand:clean(req.body.brand,80),capacity:clean(req.body.capacity,60),price:clean(req.body.price,80),description:clean(req.body.description,1200),media,mediaType:req.body.mediaType==='video'?'video':(req.file&&req.file.mimetype.startsWith('video/')?'video':'image'),createdAt:now()};if(type==='portfolio'&&!x.title)x.title='Dokumentasi pekerjaan EFASA TEKNIK';if(type==='stock'&&!x.name)x.name='Unit AC';await insertMedia(x);res.json({ok:true,item:x});}catch(e){if(req.file?.path&&fs.existsSync(req.file.path))fs.unlinkSync(req.file.path);res.status(500).json({ok:false,message:e.message});}}
app.post('/api/admin/portfolio',auth,csrfGuard,localUpload.single('media'),(req,res)=>saveItem('portfolio',req,res));
app.post('/api/admin/stock',auth,csrfGuard,localUpload.single('media'),(req,res)=>saveItem('stock',req,res));
app.post('/api/admin/logo',auth,csrfGuard,localUpload.single('media'),async(req,res)=>{try{
  const media=STORAGE_MODE==='local'?localMedia(req):blobMediaFromBody(req.body,'logo');
  const mediaType=String(req.body?.mediaType||'').toLowerCase();
  const mediaPath=String(req.body?.mediaPath||'');
  const isBlobLogo=STORAGE_MODE!=='local'&&media&&mediaPath.startsWith('logo/');
  const isLocalLogo=STORAGE_MODE==='local'&&media;
  if(!(isBlobLogo||isLocalLogo)||(!isBlobLogo&&mediaType!=='image'))return res.status(400).json({ok:false,message:'Logo gagal diproses. Silakan upload ulang gambar JPG/PNG/WebP.'});const st=await settings();if(st.logo)await removeFile(st.logo);if(!USE_POSTGRES){const d=dbRead();d.settings={...DEFAULT_SETTINGS,...(d.settings||{}),logo:media};dbWrite(d);}else{await ready();await sql`INSERT INTO settings(key,value) VALUES('logo',${media}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;}res.json({ok:true,logo:media});}catch(e){if(req.file?.path&&fs.existsSync(req.file.path))fs.unlinkSync(req.file.path);res.status(500).json({ok:false,message:e.message});}});

async function delItem(type,req,res){try{const x=await removeMedia(type,req.params.id);if(!x)return res.status(404).json({ok:false,message:'Data tidak ditemukan.'});await removeFile(x.media_url||x.media);res.json({ok:true});}catch(e){res.status(500).json({ok:false,message:e.message});}}
app.delete('/api/admin/portfolio/:id',auth,csrfGuard,(req,res)=>delItem('portfolio',req,res));
app.delete('/api/admin/stock/:id',auth,csrfGuard,(req,res)=>delItem('stock',req,res));
app.get('/admin',(req,res)=>res.sendFile(path.join(PUBLIC,'admin','index.html')));
app.get('/admin/setup',(req,res)=>res.sendFile(path.join(PUBLIC,'setup.html')));
app.get('/admin/login',(req,res)=>res.sendFile(path.join(PUBLIC,'login.html')));
app.use((err,_req,res,_next)=>{console.error(err);if(err instanceof multer.MulterError)return res.status(400).json({ok:false,message:`Upload gagal: ${err.message}`});res.status(err.statusCode||500).json({ok:false,message:err.message||'Terjadi kesalahan server.'});});
module.exports=app;
