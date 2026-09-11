import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import crypto from 'node:crypto';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';

const app = express();
const port = Number(process.env.PORT || 4000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';
const uploadDir = process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'storage');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 200 * 1024 * 1024 } });

app.use(cors({ origin: process.env.WEB_ORIGIN || 'http://localhost:3000' }));
app.use(express.json({ limit: '2mb' }));
app.use('/media', express.static(uploadDir));

function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}
function verifyPassword(password: string, stored: string) {
  const [, salt, key] = stored.split('$');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(key, 'hex'));
}
function b64(value: string) { return Buffer.from(value).toString('base64url'); }
function tokenFor(user: { id: string; role: string }) {
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64(JSON.stringify({ sub: user.id, role: user.role, exp: Math.floor(Date.now()/1000) + 60*60*24*7 }));
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}
function decodeToken(token: string) {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) return null;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (!data.exp || data.exp < Math.floor(Date.now()/1000)) return null;
  return data as { sub: string; role: string; exp: number };
}
type AuthedRequest = Request & { user?: { id: string; role: string } };
function auth(req: AuthedRequest, res: Response, next: NextFunction) {
  const value = req.headers.authorization;
  if (!value?.startsWith('Bearer ')) return res.status(401).json({ error: 'Autenticação necessária' });
  const decoded = decodeToken(value.slice(7));
  if (!decoded) return res.status(401).json({ error: 'Sessão inválida ou expirada' });
  req.user = { id: decoded.sub, role: decoded.role }; next();
}
function artistOnly(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!['ARTIST','ADMIN','OWNER'].includes(req.user?.role || '')) return res.status(403).json({ error: 'Acesso reservado a artistas' });
  next();
}

function adminOnly(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!['ADMIN','OWNER'].includes(req.user?.role || '')) return res.status(403).json({ error: 'Acesso reservado à administração' });
  next();
}

async function audit(actorUserId: string | undefined, action: string, entityType: string, entityId: string | undefined, details: unknown = {}) {
  try { await pool.query(`insert into audit_logs(actor_user_id,action,entity_type,entity_id,details) values($1,$2,$3,$4,$5)`, [actorUserId || null, action, entityType, entityId || null, JSON.stringify(details)]); } catch (e) { console.error('audit log failed', e); }
}

const RIGHTS_ROLES=['RIGHTS_HOLDER','ARTIST','COMPOSER','LYRICIST','PRODUCER','PERFORMER','PUBLISHER','LABEL'];
const RIGHT_TYPES=['STREAMING','DOWNLOAD','DISTRIBUTION','VIDEO','ADS','SYNC'];
const PAYMENT_METHODS=['MULTICAIXA_EXPRESS','MULTICAIXA_REFERENCE','VISA','MASTERCARD'];
const PAYMENT_STATUSES=['PENDING','PAID','FAILED','CANCELLED','REFUNDED'];
function makePaymentReference(){ return `BBP-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }

app.get('/api/health', async (_req,res) => { try { await pool.query('select 1'); res.json({ok:true,service:'babulo-api'}); } catch { res.status(503).json({ok:false}); } });

app.post('/api/auth/register', async (req,res) => {
  const { email, phone, password, role = 'LISTENER', stageName } = req.body || {};
  if (!password || String(password).length < 8) return res.status(400).json({error:'A palavra-passe deve ter pelo menos 8 caracteres'});
  if (!email && !phone) return res.status(400).json({error:'Informe email ou telefone'});
  const safeRole = ['LISTENER','ARTIST'].includes(role) ? role : 'LISTENER';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const u = await client.query(`insert into users(email,phone,password_hash,role) values($1,$2,$3,$4) returning id,email,phone,role,created_at`, [email || null, phone || null, hashPassword(password), safeRole]);
    let artist = null;
    if (safeRole === 'ARTIST') {
      if (!stageName) { await client.query('ROLLBACK'); return res.status(400).json({error:'stageName é obrigatório para contas de artista'}); }
      artist = (await client.query(`insert into artists(user_id,stage_name) values($1,$2) returning id,stage_name`, [u.rows[0].id, stageName])).rows[0];
    }
    await client.query('COMMIT');
    res.status(201).json({ user:u.rows[0], artist, token:tokenFor(u.rows[0]) });
  } catch (e:any) { await client.query('ROLLBACK'); res.status(e.code === '23505' ? 409 : 500).json({error:e.code === '23505' ? 'Email ou telefone já registado' : 'Não foi possível criar a conta'}); } finally { client.release(); }
});

app.post('/api/auth/login', async (req,res) => {
  const { email, phone, password } = req.body || {};
  if ((!email && !phone) || !password) return res.status(400).json({error:'Informe os dados de acesso'});
  const q = await pool.query(`select id,email,phone,password_hash,role,status from users where email=$1 or phone=$2 limit 1`, [email || null, phone || null]);
  const user = q.rows[0];
  if (!user || user.status !== 'ACTIVE' || !verifyPassword(password,user.password_hash)) return res.status(401).json({error:'Credenciais inválidas'});
  delete user.password_hash;
  res.json({user,token:tokenFor(user)});
});

app.get('/api/auth/me', auth, async (req:AuthedRequest,res) => {
  const q = await pool.query(`select id,email,phone,role,status,email_verified,phone_verified,created_at from users where id=$1`, [req.user!.id]);
  if (!q.rows[0]) return res.status(404).json({error:'Utilizador não encontrado'});
  const artist = (await pool.query(`select id,stage_name,legal_name,bio,country,city,photo_url,verification_status from artists where user_id=$1`, [req.user!.id])).rows[0] || null;
  res.json({user:q.rows[0],artist});
});

app.get('/api/genres', async (_req,res) => res.json({genres:(await pool.query('select id,name from genres order by name')).rows}));
app.get('/api/artists/:id', async (req,res) => {
  const artist = (await pool.query(`select id,stage_name,legal_name,bio,country,city,photo_url,verification_status from artists where id=$1`, [req.params.id])).rows[0];
  if (!artist) return res.status(404).json({error:'Artista não encontrado'});
  const releases=(await pool.query(`select id,title,type,cover_url,release_date,status from releases where primary_artist_id=$1 order by created_at desc`,[req.params.id])).rows;
  res.json({artist,releases});
});

app.get('/api/tracks', async (_req,res) => {
  try { const q=await pool.query(`select t.id,t.title,coalesce(a.stage_name,'Artista BaBuLo') artist,coalesce(g.name,'Música') genre,r.cover_url "coverUrl" from tracks t left join track_artists ta on ta.track_id=t.id and ta.role='PRIMARY' left join artists a on a.id=ta.artist_id left join genres g on g.id=t.genre_id left join releases r on r.id=t.primary_release_id where t.status='PUBLISHED' order by t.created_at desc limit 24`); res.json({tracks:q.rows}); } catch(e){ console.error(e); res.status(500).json({error:'Não foi possível carregar o catálogo'}); }
});


app.post('/api/releases', auth, artistOnly, async (req:AuthedRequest,res) => {
  const { title, type='SINGLE', genreId, language, country, releaseDate, preReleaseDate, coverUrl, description, upc, ean, labelName, phonographicCopyright, copyrightText } = req.body || {};
  if (!title) return res.status(400).json({error:'O título do lançamento é obrigatório'});
  const artist=(await pool.query('select id from artists where user_id=$1 limit 1',[req.user!.id])).rows[0];
  if(!artist) return res.status(404).json({error:'Perfil de artista não encontrado'});
  if(!['SINGLE','EP','ALBUM','ALBUM_PRO'].includes(type)) return res.status(400).json({error:'Tipo de lançamento inválido'});
  const q=await pool.query(`insert into releases(title,type,primary_artist_id,genre_id,language,country,release_date,pre_release_date,cover_url,description,upc,ean,label_name,phonographic_copyright,copyright_text) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning *`,[title,type,artist.id,genreId||null,language||null,country||null,releaseDate||null,preReleaseDate||null,coverUrl||null,description||null,upc||null,ean||null,labelName||null,phonographicCopyright||null,copyrightText||null]);
  res.status(201).json({release:q.rows[0]});
});

app.get('/api/artists/me/releases', auth, artistOnly, async (req:AuthedRequest,res) => {
  const artist=(await pool.query('select id from artists where user_id=$1 limit 1',[req.user!.id])).rows[0];
  if(!artist) return res.status(404).json({error:'Perfil de artista não encontrado'});
  const q=await pool.query('select id,title,type,cover_url,release_date,status,created_at from releases where primary_artist_id=$1 order by created_at desc',[artist.id]);
  res.json({releases:q.rows});
});

app.post('/api/tracks', auth, artistOnly, async (req:AuthedRequest,res) => {
  const { title, releaseId, genreId, language, version, durationMs, isExplicit=false, explicitReason, isrc, originalReleaseDate, fileUrl, fileType='AUDIO', composer, lyricist, producer, performer, publisher } = req.body || {};
  if(!title || !releaseId) return res.status(400).json({error:'Título e lançamento são obrigatórios'});
  const artist=(await pool.query('select id from artists where user_id=$1 limit 1',[req.user!.id])).rows[0];
  const release=(await pool.query('select id from releases where id=$1 and primary_artist_id=$2',[releaseId,artist?.id])).rows[0];
  if(!release) return res.status(404).json({error:'Lançamento não encontrado'});
  const client=await pool.connect();
  try{ await client.query('begin');
    const t=(await client.query(`insert into tracks(title,version,duration_ms,language,genre_id,is_explicit,explicit_reason,isrc,isrc_status,isrc_source,original_release_date,composer,lyricist,producer,performer,publisher,primary_release_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning *`,[title,version||null,durationMs||null,language||null,genreId||null,Boolean(isExplicit),explicitReason||null,isrc||null,isrc?'ASSIGNED':'PENDING_ASSIGNMENT',isrc?'ARTIST_PROVIDED':'NOT_PROVIDED',originalReleaseDate||null,composer||null,lyricist||null,producer||null,performer||null,publisher||null,releaseId])).rows[0];
    await client.query(`insert into track_artists(track_id,artist_id,role) values($1,$2,'PRIMARY')`,[t.id,artist.id]);
    if(fileUrl){ await client.query(`insert into track_files(track_id,storage_key,file_type,format,status) values($1,$2,$3,$4,'UPLOADED')`,[t.id,fileUrl,fileType,'unknown']); }
    await client.query('commit'); res.status(201).json({track:t});
  }catch(e){await client.query('rollback'); console.error(e); res.status(500).json({error:'Não foi possível criar a música'});}finally{client.release();}
});

app.put('/api/artists/me', auth, artistOnly, async (req:AuthedRequest,res) => {
  const {stageName,legalName,bio,country,city,photoUrl}=req.body||{};
  const q=await pool.query(`update artists set stage_name=coalesce($1,stage_name),legal_name=$2,bio=$3,country=$4,city=$5,photo_url=$6 where user_id=$7 returning id,stage_name,legal_name,bio,country,city,photo_url,verification_status`,[stageName,legalName||null,bio||null,country||null,city||null,photoUrl||null,req.user!.id]);
  if(!q.rows[0]) return res.status(404).json({error:'Perfil de artista não encontrado'}); res.json({artist:q.rows[0]});
});

app.post('/api/uploads', auth, upload.single('file'), async (req:AuthedRequest,res) => {
  if (!req.file) return res.status(400).json({error:'Nenhum ficheiro enviado'});
  const kind=String(req.body?.kind||'file');
  const ext=path.extname(req.file.originalname).toLowerCase();
  const audioExts=['.wav','.flac','.mp3']; const imageExts=['.jpg','.jpeg','.png'];
  if(kind==='audio' && !audioExts.includes(ext)){fs.unlinkSync(req.file.path);return res.status(400).json({error:'Áudio inválido. Use WAV, FLAC ou MP3.'});}
  if(kind==='cover' && !imageExts.includes(ext)){fs.unlinkSync(req.file.path);return res.status(400).json({error:'Capa inválida. Use JPG ou PNG.'});}
  if(kind==='cover'){ const d=imageDimensions(req.file.path); if(!d || d.width!==3000 || d.height!==3000){ fs.unlinkSync(req.file.path); return res.status(400).json({error:d?`Capa inválida: ${d.width}×${d.height}px. A BaBuLo Play exige exatamente 3000×3000px.`:'Não foi possível ler as dimensões da capa.'}); } }
  const finalName=`${req.user!.id}-${Date.now()}-${crypto.randomUUID()}${ext}`;
  const finalPath=path.join(uploadDir,finalName); fs.renameSync(req.file.path,finalPath);
  res.status(201).json({file:{name:req.file.originalname,size:req.file.size,mimeType:req.file.mimetype,storageKey:finalName,url:`/media/${finalName}`,kind}});
});


function imageDimensions(filePath:string): {width:number;height:number}|null {
  const b=fs.readFileSync(filePath);
  if(b.length>=24 && b[0]===0x89 && b[1]===0x50 && b[2]===0x4e && b[3]===0x47) return {width:b.readUInt32BE(16),height:b.readUInt32BE(20)};
  if(b.length>=2 && b[0]===0xff && b[1]===0xd8){
    let i=2; const sof=[0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf];
    while(i+9<b.length){ if(b[i]!==0xff){i++;continue;} const marker=b[i+1]; i+=2; if(marker===0xd8||marker===0xd9) continue; if(i+1>=b.length) break; const len=b.readUInt16BE(i); if(len<2||i+len>b.length) break; if(sof.includes(marker)&&len>=7) return {height:b.readUInt16BE(i+3),width:b.readUInt16BE(i+5)}; i+=len; }
  }
  return null;
}
app.post('/api/releases/:id/preflight', auth, artistOnly, async (req:AuthedRequest,res) => {
  const release=(await pool.query(`select r.*,a.id artist_id from releases r join artists a on a.id=r.primary_artist_id where r.id=$1 and a.user_id=$2`,[req.params.id,req.user!.id])).rows[0];
  if(!release) return res.status(404).json({error:'Lançamento não encontrado'});
  const tracks=(await pool.query(`select t.*,tf.storage_key from tracks t left join track_files tf on tf.track_id=t.id and tf.file_type='AUDIO' where t.primary_release_id=$1`,[release.id])).rows;
  const errors:string[]=[];
  if(!release.title) errors.push('Título do lançamento em falta.');
  if(!release.cover_url) errors.push('Capa não enviada.');
  if(!tracks.length) errors.push('O lançamento precisa de pelo menos uma faixa.');
  for(const t of tracks){ if(!t.title) errors.push('Uma faixa está sem título.'); if(!t.storage_key) errors.push(`A faixa “${t.title}” não tem áudio enviado.`); }
  if(release.cover_url){ const key=String(release.cover_url).split('/').pop(); const fp=path.join(uploadDir,key||''); if(!fs.existsSync(fp)) errors.push('Ficheiro da capa não encontrado no armazenamento.'); else { const d=imageDimensions(fp); if(!d) errors.push('Não foi possível validar as dimensões da capa.'); else if(d.width!==3000||d.height!==3000) errors.push(`A capa tem ${d.width}×${d.height}px. A BaBuLo Play exige 3000×3000px.`); } }
  const status=errors.length?'FAILED':'PASSED';
  await pool.query(`update releases set preflight_status=$1,preflight_reason=$2,status=$3,submitted_at=case when $1='PASSED' then now() else submitted_at end where id=$4`,[status,errors.length?errors.join(' '):null,errors.length?'DRAFT':'PENDING_APPROVAL',release.id]);
  res.json({preflight:{status,errors},releaseId:release.id});
});

// ===== Direitos e aprovação =====
app.get('/api/releases/:id/rights', auth, async (req:AuthedRequest,res) => {
  const q=await pool.query(`select rd.*,u.email as created_by_email from rights_declarations rd left join users u on u.id=rd.created_by join releases r on r.id=rd.release_id join artists a on a.id=r.primary_artist_id where rd.release_id=$1 and (a.user_id=$2 or $3 in ('ADMIN','OWNER')) order by rd.created_at`,[req.params.id,req.user!.id,req.user!.role]);
  res.json({rights:q.rows});
});

app.post('/api/releases/:id/rights', auth, artistOnly, async (req:AuthedRequest,res) => {
  const {trackId,partyName,partyRole='RIGHTS_HOLDER',rightType='STREAMING',percentage,territory='WORLDWIDE',validFrom,validTo,documentUrl}=req.body||{};
  const release=(await pool.query(`select r.id from releases r join artists a on a.id=r.primary_artist_id where r.id=$1 and a.user_id=$2`,[req.params.id,req.user!.id])).rows[0];
  if(!release) return res.status(404).json({error:'Lançamento não encontrado'});
  if(!partyName || percentage===undefined) return res.status(400).json({error:'Nome do titular e percentagem são obrigatórios'});
  if(!RIGHTS_ROLES.includes(String(partyRole))) return res.status(400).json({error:'Papel de direitos inválido'});
  if(!RIGHT_TYPES.includes(String(rightType))) return res.status(400).json({error:'Tipo de direito inválido'});
  const pct=Number(percentage); if(!Number.isFinite(pct)||pct<0||pct>100) return res.status(400).json({error:'A percentagem deve estar entre 0 e 100'});
  if(trackId){ const t=(await pool.query('select id from tracks where id=$1 and primary_release_id=$2',[trackId,release.id])).rows[0]; if(!t) return res.status(400).json({error:'Faixa não pertence a este lançamento'}); }
  const q=await pool.query(`insert into rights_declarations(release_id,track_id,party_name,party_role,right_type,percentage,territory,valid_from,valid_to,document_url,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,[release.id,trackId||null,partyName,partyRole,rightType,pct,territory,validFrom||null,validTo||null,documentUrl||null,req.user!.id]);
  await audit(req.user!.id,'RIGHT_CREATED','RIGHTS',q.rows[0].id,{releaseId:release.id});
  res.status(201).json({right:q.rows[0]});
});

app.delete('/api/releases/:id/rights/:rightId', auth, artistOnly, async (req:AuthedRequest,res) => {
  const q=await pool.query(`delete from rights_declarations rd using releases r,artists a where rd.id=$1 and rd.release_id=r.id and r.primary_artist_id=a.id and r.id=$2 and a.user_id=$3 returning rd.id`,[req.params.rightId,req.params.id,req.user!.id]);
  if(!q.rows[0]) return res.status(404).json({error:'Declaração de direitos não encontrada'});
  await audit(req.user!.id,'RIGHT_DELETED','RIGHTS',req.params.rightId,{releaseId:req.params.id});
  res.json({ok:true});
});

app.post('/api/releases/:id/submit-approval', auth, artistOnly, async (req:AuthedRequest,res) => {
  const release=(await pool.query(`select r.*,a.id artist_id from releases r join artists a on a.id=r.primary_artist_id where r.id=$1 and a.user_id=$2`,[req.params.id,req.user!.id])).rows[0];
  if(!release) return res.status(404).json({error:'Lançamento não encontrado'});
  if(release.preflight_status!=='PASSED') return res.status(400).json({error:'O lançamento precisa passar no preflight técnico antes da aprovação.'});
  const rights=(await pool.query(`select right_type,territory,coalesce(track_id,'00000000-0000-0000-0000-000000000000') track_key,sum(percentage) total from rights_declarations where release_id=$1 and status='PENDING' group by right_type,territory,track_id`,[release.id])).rows;
  if(!rights.length) return res.status(400).json({error:'Declare pelo menos um titular de direitos antes de submeter.'});
  const invalid=rights.find((r:any)=>Number(r.total)!==100);
  if(invalid) return res.status(400).json({error:`Os direitos de ${invalid.right_type} (${invalid.territory}) devem totalizar 100%. Atualmente: ${Number(invalid.total)}%.`});
  await pool.query(`update releases set status='PENDING_APPROVAL',review_reason=null where id=$1`,[release.id]);
  await audit(req.user!.id,'RELEASE_SUBMITTED','RELEASE',release.id,{status:'PENDING_APPROVAL'});
  res.json({ok:true,status:'PENDING_APPROVAL'});
});

app.get('/api/admin/releases/pending', auth, adminOnly, async (req:AuthedRequest,res) => {
  const q=await pool.query(`select r.id,r.title,r.type,r.status,r.preflight_status,r.submitted_at,r.cover_url,a.stage_name from releases r join artists a on a.id=r.primary_artist_id where r.status='PENDING_APPROVAL' order by r.submitted_at asc nulls last`);
  res.json({releases:q.rows});
});

app.get('/api/admin/releases/:id', auth, adminOnly, async (req:AuthedRequest,res) => {
  const release=(await pool.query(`select r.*,a.stage_name from releases r join artists a on a.id=r.primary_artist_id where r.id=$1`,[req.params.id])).rows[0];
  if(!release) return res.status(404).json({error:'Lançamento não encontrado'});
  const tracks=(await pool.query(`select t.*,tf.storage_key from tracks t left join track_files tf on tf.track_id=t.id and tf.file_type='AUDIO' where t.primary_release_id=$1`,[release.id])).rows;
  const rights=(await pool.query(`select * from rights_declarations where release_id=$1 order by created_at`,[release.id])).rows;
  res.json({release,tracks,rights});
});

app.post('/api/admin/releases/:id/decision', auth, adminOnly, async (req:AuthedRequest,res) => {
  const {decision,reason}=req.body||{};
  if(!['APPROVED','REJECTED'].includes(decision)) return res.status(400).json({error:'Decisão inválida'});
  if(decision==='REJECTED' && !String(reason||'').trim()) return res.status(400).json({error:'Informe o motivo da rejeição'});
  const status=decision==='APPROVED'?'APPROVED':'REJECTED';
  const client=await pool.connect();
  try { await client.query('begin');
    const r=(await client.query(`update releases set status=$1,review_reason=$2,reviewed_at=now(),reviewed_by=$3 where id=$4 and status='PENDING_APPROVAL' returning id`,[status,reason||null,req.user!.id,req.params.id])).rows[0];
    if(!r){await client.query('rollback');return res.status(404).json({error:'Lançamento não está pendente de aprovação'});}
    await client.query(`update rights_declarations set status=$1,updated_at=now() where release_id=$2 and status='PENDING'`,[decision==='APPROVED'?'APPROVED':'REJECTED',r.id]);
    await client.query('commit');
    await audit(req.user!.id,decision==='APPROVED'?'RELEASE_APPROVED':'RELEASE_REJECTED','RELEASE',r.id,{reason:reason||null});
    res.json({ok:true,status});
  } catch(e){await client.query('rollback');console.error(e);res.status(500).json({error:'Não foi possível guardar a decisão'});} finally {client.release();}
});

// ===== Reclamações de copyright =====
app.post('/api/copyright-complaints', async (req,res) => {
  const {releaseId,trackId,complainantName,complainantEmail,claimType='COPYRIGHT',description,evidenceUrl}=req.body||{};
  if(!complainantName||!complainantEmail||!description) return res.status(400).json({error:'Nome, email e descrição são obrigatórios'});
  const q=await pool.query(`insert into copyright_complaints(release_id,track_id,complainant_name,complainant_email,claim_type,description,evidence_url) values($1,$2,$3,$4,$5,$6,$7) returning id,status,created_at`,[releaseId||null,trackId||null,complainantName,complainantEmail,claimType,description,evidenceUrl||null]);
  await audit(undefined,'COPYRIGHT_COMPLAINT_CREATED','COPYRIGHT_COMPLAINT',q.rows[0].id,{releaseId:releaseId||null,trackId:trackId||null});
  res.status(201).json({complaint:q.rows[0]});
});

app.get('/api/admin/copyright-complaints', auth, adminOnly, async (_req,res) => {
  const q=await pool.query(`select c.*,r.title release_title,t.title track_title from copyright_complaints c left join releases r on r.id=c.release_id left join tracks t on t.id=c.track_id order by c.created_at desc`);
  res.json({complaints:q.rows});
});

app.post('/api/admin/copyright-complaints/:id/decision', auth, adminOnly, async (req:AuthedRequest,res) => {
  const {decision,reason}=req.body||{};
  if(!['SUSPEND','REJECT','RESOLVE','REACTIVATE','REMOVE'].includes(decision)) return res.status(400).json({error:'Decisão de reclamação inválida'});
  if(!String(reason||'').trim()) return res.status(400).json({error:'Informe o motivo da decisão'});
  const status=['SUSPEND','REMOVE'].includes(decision)?'ACTION_TAKEN':'RESOLVED';
  const client=await pool.connect();
  try { await client.query('begin');
    const c=(await client.query(`update copyright_complaints set status=$1,decision_reason=$2,reviewed_by=$3,reviewed_at=now(),updated_at=now() where id=$4 returning *`,[status,reason,req.user!.id,req.params.id])).rows[0];
    if(!c){await client.query('rollback');return res.status(404).json({error:'Reclamação não encontrada'});}
    if(c.release_id && ['SUSPEND','REMOVE','REACTIVATE'].includes(decision)){
      const newReleaseStatus=decision==='REACTIVATE'?'APPROVED':decision==='SUSPEND'?'SUSPENDED':'REMOVED';
      await client.query(`update releases set status=$1 where id=$2`,[newReleaseStatus,c.release_id]);
    }
    await client.query('commit');
    await audit(req.user!.id,'COPYRIGHT_DECISION','COPYRIGHT_COMPLAINT',c.id,{decision,reason});
    res.json({ok:true,status});
  } catch(e){await client.query('rollback');console.error(e);res.status(500).json({error:'Não foi possível guardar a decisão'});} finally {client.release();}
});

app.get('/api/admin/audit-logs', auth, adminOnly, async (_req,res) => {
  const q=await pool.query(`select al.*,u.email actor_email from audit_logs al left join users u on u.id=al.actor_user_id order by al.created_at desc limit 200`);
  res.json({logs:q.rows});
});

// ===== Streaming events + Royalty Engine =====
app.post('/api/streams/events', async (req,res) => {
  const { trackId, eventType='PLAY_30S', playedSeconds=0, sessionId } = req.body || {};
  if(!trackId) return res.status(400).json({error:'trackId é obrigatório'});
  const track=(await pool.query('select id from tracks where id=$1 and status=\'PUBLISHED\'', [trackId])).rows[0];
  if(!track) return res.status(404).json({error:'Faixa publicada não encontrada'});
  const validEvents=['PLAY_30S','COMPLETED'];
  const isValid=validEvents.includes(String(eventType)) && Number(playedSeconds)>=30;
  const userIdHeader=(req.headers['x-user-id'] as string)||null;
  const q=await pool.query(`insert into stream_events(user_id,track_id,event_type,played_seconds,session_id,is_valid) values($1,$2,$3,$4,$5,$6) returning id,event_type,is_valid,occurred_at`,[userIdHeader,trackId,String(eventType),Number(playedSeconds)||0,sessionId||null,isValid]);
  res.status(201).json({event:q.rows[0]});
});

app.get('/api/artists/me/royalties', auth, artistOnly, async (req:AuthedRequest,res) => {
  const artist=(await pool.query('select id,stage_name from artists where user_id=$1 limit 1',[req.user!.id])).rows[0];
  if(!artist) return res.status(404).json({error:'Perfil de artista não encontrado'});
  const entries=(await pool.query(`select re.id,re.valid_streams,re.stream_share,re.eligible_revenue,re.artist_share_percent,re.artist_amount,re.status,re.created_at,rp.period_start,rp.period_end,rp.currency,t.title track_title from royalty_entries re join royalty_periods rp on rp.id=re.period_id join tracks t on t.id=re.track_id where re.artist_id=$1 order by rp.period_start desc,re.created_at desc`,[artist.id])).rows;
  const balance=(await pool.query(`select coalesce(sum(case when entry_type='CREDIT' then amount when entry_type='DEBIT' then -amount else 0 end),0) balance from financial_ledger where artist_id=$1`,[artist.id])).rows[0];
  const withdrawals=(await pool.query(`select id,amount,currency,method,status,fee,net_amount,created_at from withdrawals where artist_id=$1 order by created_at desc`,[artist.id])).rows;
  res.json({artist, balance:Number(balance.balance||0), minimumWithdrawal:10000, entries, withdrawals});
});

app.get('/api/artists/me/ledger', auth, artistOnly, async (req:AuthedRequest,res) => {
  const artist=(await pool.query('select id from artists where user_id=$1 limit 1',[req.user!.id])).rows[0];
  if(!artist) return res.status(404).json({error:'Perfil de artista não encontrado'});
  const q=await pool.query(`select id,entry_type,reference_type,reference_id,amount,currency,balance_after,description,created_at from financial_ledger where artist_id=$1 order by created_at desc limit 200`,[artist.id]);
  res.json({ledger:q.rows});
});

app.post('/api/artists/me/withdrawals', auth, artistOnly, async (req:AuthedRequest,res) => {
  const { amount, method='BANK', destination }=req.body||{};
  const value=Number(amount);
  if(!Number.isFinite(value)||value<10000) return res.status(400).json({error:'O levantamento mínimo é de 10.000 Kz'});
  if(!destination) return res.status(400).json({error:'Informe o destino do levantamento'});
  if(!['BANK','MULTICAIXA_EXPRESS'].includes(method)) return res.status(400).json({error:'Método de levantamento inválido'});
  const artist=(await pool.query('select id from artists where user_id=$1 limit 1',[req.user!.id])).rows[0];
  if(!artist) return res.status(404).json({error:'Perfil de artista não encontrado'});
  const client=await pool.connect();
  try{
    await client.query('begin');
    const bal=Number((await client.query(`select coalesce(sum(case when entry_type='CREDIT' then amount when entry_type='DEBIT' then -amount else 0 end),0) balance from financial_ledger where artist_id=$1`,[artist.id])).rows[0].balance||0);
    if(value>bal){await client.query('rollback');return res.status(400).json({error:`Saldo insuficiente. Saldo disponível: ${bal.toFixed(2)} Kz.`});}
    const w=(await client.query(`insert into withdrawals(artist_id,amount,method,destination,net_amount) values($1,$2,$3,$4,$5) returning id,amount,currency,method,status,net_amount,created_at`,[artist.id,value,method,String(destination),value])).rows[0];
    const after=bal-value;
    await client.query(`insert into financial_ledger(artist_id,entry_type,reference_type,reference_id,amount,currency,balance_after,description) values($1,'DEBIT','WITHDRAWAL',$2,$3,'AOA',$4,'Levantamento solicitado pelo artista')`,[artist.id,w.id,value,after]);
    await client.query('commit');
    await audit(req.user!.id,'WITHDRAWAL_CREATED','WITHDRAWAL',w.id,{amount:value,method});
    res.status(201).json({withdrawal:w,balance:after});
  }catch(e){await client.query('rollback');console.error(e);res.status(500).json({error:'Não foi possível solicitar o levantamento'});}finally{client.release();}
});

app.get('/api/admin/royalty-periods', auth, adminOnly, async (_req,res) => {
  const q=await pool.query(`select rp.*,u.email calculated_by_email from royalty_periods rp left join users u on u.id=rp.calculated_by order by period_start desc`);
  res.json({periods:q.rows});
});

app.post('/api/admin/royalty-periods/calculate', auth, adminOnly, async (req:AuthedRequest,res) => {
  const {periodStart,periodEnd,grossRevenue=0,paymentFees=0,taxes=0,adjustments=0,artistSharePercent=70}=req.body||{};
  if(!periodStart||!periodEnd) return res.status(400).json({error:'periodStart e periodEnd são obrigatórios'});
  const start=new Date(`${periodStart}T00:00:00Z`), end=new Date(`${periodEnd}T23:59:59Z`);
  if(Number.isNaN(start.getTime())||Number.isNaN(end.getTime())||start>end) return res.status(400).json({error:'Período inválido'});
  const gross=Number(grossRevenue)||0, fees=Number(paymentFees)||0, tax=Number(taxes)||0, adj=Number(adjustments)||0, share=Number(artistSharePercent);
  if(share<0||share>100) return res.status(400).json({error:'A percentagem do artista deve estar entre 0 e 100'});
  const eligible=Math.max(0,gross-fees-tax+adj);
  const streams=(await pool.query(`select t.id,t.primary_release_id,r.primary_artist_id,count(*)::int valid_streams from stream_events se join tracks t on t.id=se.track_id join releases r on r.id=t.primary_release_id where se.is_valid=true and se.occurred_at between $1 and $2 group by t.id,t.primary_release_id,r.primary_artist_id having count(*)>0`,[start,end])).rows;
  const total=streams.reduce((n:any,x:any)=>n+Number(x.valid_streams),0);
  const client=await pool.connect();
  try{
    await client.query('begin');
    const exists=(await client.query('select id from royalty_periods where period_start=$1 and period_end=$2',[periodStart,periodEnd])).rows[0];
    if(exists){await client.query('rollback');return res.status(409).json({error:'Este período já foi calculado',periodId:exists.id});}
    const period=(await client.query(`insert into royalty_periods(period_start,period_end,gross_revenue,payment_fees,taxes,adjustments,eligible_revenue,artist_share_percent,babulo_share_percent,status,calculated_at,calculated_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,'CALCULATED',now(),$10) returning *`,[periodStart,periodEnd,gross,fees,tax,adj,eligible,share,100-share,req.user!.id])).rows[0];
    for(const row of streams){
      const streamShare=total?Number(row.valid_streams)/total:0;
      const allocated=eligible*streamShare;
      const artistAmount=Math.round(allocated*(share/100)*100)/100;
      const entry=(await client.query(`insert into royalty_entries(period_id,artist_id,track_id,valid_streams,stream_share,eligible_revenue,artist_share_percent,artist_amount) values($1,$2,$3,$4,$5,$6,$7,$8) returning id`,[period.id,row.primary_artist_id,row.id,row.valid_streams,streamShare,allocated,share,artistAmount])).rows[0];
      const bal=Number((await client.query(`select coalesce(sum(case when entry_type='CREDIT' then amount when entry_type='DEBIT' then -amount else 0 end),0) balance from financial_ledger where artist_id=$1`,[row.primary_artist_id])).rows[0].balance||0);
      const after=bal+artistAmount;
      await client.query(`insert into financial_ledger(artist_id,entry_type,reference_type,reference_id,amount,currency,balance_after,description) values($1,'CREDIT','ROYALTY_ENTRY',$2,$3,'AOA',$4,'Royalties do período calculado')`,[row.primary_artist_id,entry.id,artistAmount,after]);
    }
    await client.query('commit');
    await audit(req.user!.id,'ROYALTY_PERIOD_CALCULATED','ROYALTY_PERIOD',period.id,{periodStart,periodEnd,eligibleRevenue:eligible,validStreams:total,artistSharePercent:share});
    res.status(201).json({period,validStreams:total,artistEntries:streams.length});
  }catch(e){await client.query('rollback');console.error(e);res.status(500).json({error:'Não foi possível calcular os royalties'});}finally{client.release();}
});

app.get('/api/admin/withdrawals', auth, adminOnly, async (_req,res) => {
  const q=await pool.query(`select w.*,a.stage_name,u.email from withdrawals w join artists a on a.id=w.artist_id left join users u on u.id=a.user_id order by w.created_at desc`);
  res.json({withdrawals:q.rows});
});

app.post('/api/admin/withdrawals/:id/decision', auth, adminOnly, async (req:AuthedRequest,res) => {
  const {decision,reason}=req.body||{};
  if(!['APPROVED','REJECTED'].includes(decision)) return res.status(400).json({error:'Decisão inválida'});
  if(decision==='REJECTED'&&!String(reason||'').trim()) return res.status(400).json({error:'Informe o motivo da rejeição'});
  const client=await pool.connect();
  try{
    await client.query('begin');
    const w=(await client.query(`update withdrawals set status=$1,rejection_reason=$2,reviewed_by=$3,reviewed_at=now() where id=$4 and status='PENDING' returning *`,[decision,reason||null,req.user!.id,req.params.id])).rows[0];
    if(!w){await client.query('rollback');return res.status(404).json({error:'Levantamento pendente não encontrado'});}
    if(decision==='REJECTED'){
      const bal=Number((await client.query(`select coalesce(sum(case when entry_type='CREDIT' then amount when entry_type='DEBIT' then -amount else 0 end),0) balance from financial_ledger where artist_id=$1`,[w.artist_id])).rows[0].balance||0);
      await client.query(`insert into financial_ledger(artist_id,entry_type,reference_type,reference_id,amount,currency,balance_after,description) values($1,'CREDIT','WITHDRAWAL',$2,$3,'AOA',$4,'Estorno de levantamento rejeitado')`,[w.artist_id,w.id,w.amount,bal+Number(w.amount)]);
    }
    await client.query('commit');
    await audit(req.user!.id,'WITHDRAWAL_DECISION','WITHDRAWAL',w.id,{decision,reason:reason||null});
    res.json({ok:true,status:decision});
  }catch(e){await client.query('rollback');console.error(e);res.status(500).json({error:'Não foi possível guardar a decisão'});}finally{client.release();}
});


// ===== V10 Distribution Engine =====
const DIST_PRODUCTS=['DIST_SINGLE','DIST_EP','DIST_ALBUM','DIST_ALBUM_PRO'];
const DIST_STATUSES=['READY','SUBMITTED','PROCESSING','DELIVERED','PUBLISHED','FAILED','CANCELLED'];
const distHistory=async(o:string,d:string|null,old:string|null,nw:string,msg:string,u?:string)=>pool.query(`insert into distribution_history(order_id,delivery_id,old_status,new_status,message,actor_user_id) values($1,$2,$3,$4,$5,$6)`,[o,d,old,nw,msg,u||null]);
app.get('/api/distribution/platforms',async(_q,res)=>res.json({platforms:(await pool.query(`select id,code,name,active,requires_isrc,requires_upc,status from distribution_platforms where active=true order by name`)).rows}));
app.post('/api/distribution/orders',auth,artistOnly,async(req:AuthedRequest,res)=>{const {releaseId,productCode,platformIds=[]}=req.body||{};if(!releaseId||!DIST_PRODUCTS.includes(productCode)||!Array.isArray(platformIds)||!platformIds.length)return res.status(400).json({error:'releaseId, pacote e plataformas são obrigatórios'});const a=(await pool.query('select id from artists where user_id=$1 limit 1',[req.user!.id])).rows[0];if(!a)return res.status(404).json({error:'Perfil de artista não encontrado'});const r=(await pool.query(`select r.*,a.id artist_id from releases r join artists a on a.id=r.primary_artist_id where r.id=$1 and a.user_id=$2`,[releaseId,req.user!.id])).rows[0];if(!r)return res.status(404).json({error:'Lançamento não encontrado'});if(r.status!=='APPROVED'||r.preflight_status!=='PASSED')return res.status(400).json({error:'O lançamento precisa estar aprovado e com preflight aprovado.'});const prod=(await pool.query(`select code,amount,currency from payment_products where code=$1 and service_type='DISTRIBUTION' and active=true`,[productCode])).rows[0];if(!prod)return res.status(400).json({error:'Pacote inválido'});const ps=(await pool.query(`select * from distribution_platforms where id=any($1::uuid[]) and active=true`,[platformIds])).rows;if(ps.length!==platformIds.length)return res.status(400).json({error:'Plataforma inválida'});const tracks=(await pool.query(`select isrc,isrc_status from tracks where primary_release_id=$1`,[r.id])).rows;if(!tracks.length)return res.status(400).json({error:'O lançamento precisa ter faixas'});if(ps.some((x:any)=>x.requires_isrc)&&tracks.some((x:any)=>!x.isrc&&x.isrc_status!=='ASSIGNED'))return res.status(400).json({error:'As plataformas selecionadas exigem ISRC.'});const c=await pool.connect();try{await c.query('begin');const o=(await c.query(`insert into distribution_orders(release_id,artist_id,product_code,amount,currency) values($1,$2,$3,$4,$5) returning *`,[r.id,a.id,prod.code,prod.amount,prod.currency])).rows[0];for(const x of ps){const d=(await c.query(`insert into distribution_deliveries(order_id,platform_id) values($1,$2) returning id`,[o.id,x.id])).rows[0];await c.query(`insert into distribution_history(order_id,delivery_id,new_status,message,actor_user_id) values($1,$2,'READY','Entrega criada para a plataforma',$3)`,[o.id,d.id,req.user!.id])}await c.query('commit');await audit(req.user!.id,'DISTRIBUTION_ORDER_CREATED','DISTRIBUTION_ORDER',o.id,{releaseId,productCode});res.status(201).json({order:o,platforms:ps})}catch(e){await c.query('rollback');res.status(500).json({error:'Não foi possível criar a distribuição'})}finally{c.release()}});
app.get('/api/distribution/orders',auth,artistOnly,async(req:AuthedRequest,res)=>{const a=(await pool.query('select id from artists where user_id=$1 limit 1',[req.user!.id])).rows[0];if(!a)return res.status(404).json({error:'Perfil não encontrado'});res.json({orders:(await pool.query(`select o.*,r.title release_title,r.type release_type,(select count(*) from distribution_deliveries d where d.order_id=o.id)::int platform_count,(select count(*) from distribution_deliveries d where d.order_id=o.id and d.status='PUBLISHED')::int published_count from distribution_orders o join releases r on r.id=o.release_id where o.artist_id=$1 order by o.created_at desc`,[a.id])).rows})});
app.get('/api/distribution/orders/:id',auth,artistOnly,async(req:AuthedRequest,res)=>{const o=(await pool.query(`select o.*,r.title release_title,r.type release_type,r.upc,r.ean,r.release_date,a.stage_name from distribution_orders o join releases r on r.id=o.release_id join artists a on a.id=o.artist_id where o.id=$1 and a.user_id=$2`,[req.params.id,req.user!.id])).rows[0];if(!o)return res.status(404).json({error:'Pedido não encontrado'});res.json({order:o,deliveries:(await pool.query(`select d.*,p.code,p.name,p.status platform_status from distribution_deliveries d join distribution_platforms p on p.id=d.platform_id where d.order_id=$1 order by p.name`,[o.id])).rows,history:(await pool.query(`select h.*,u.email actor_email from distribution_history h left join users u on u.id=h.actor_user_id where h.order_id=$1 order by h.created_at desc`,[o.id])).rows})});
app.post('/api/distribution/orders/:id/submit',auth,artistOnly,async(req:AuthedRequest,res)=>{const o=(await pool.query(`select o.* from distribution_orders o join artists a on a.id=o.artist_id where o.id=$1 and a.user_id=$2`,[req.params.id,req.user!.id])).rows[0];if(!o)return res.status(404).json({error:'Pedido não encontrado'});if(!['READY','FAILED'].includes(o.status))return res.status(400).json({error:'Estado atual não permite submissão'});const ds=(await pool.query(`select d.*,p.name from distribution_deliveries d join distribution_platforms p on p.id=d.platform_id where d.order_id=$1`,[o.id])).rows;await pool.query(`update distribution_orders set status='SUBMITTED',submitted_at=now(),error=null,updated_at=now() where id=$1`,[o.id]);for(const d of ds){await pool.query(`update distribution_deliveries set status='SUBMITTED',submitted_at=now(),error_code=null,error_message=null,updated_at=now() where id=$1`,[d.id]);await distHistory(o.id,d.id,d.status,'SUBMITTED',`Entrega enviada para ${d.name}`,req.user!.id)}await audit(req.user!.id,'DISTRIBUTION_ORDER_SUBMITTED','DISTRIBUTION_ORDER',o.id);res.json({ok:true,status:'SUBMITTED',message:'Submetido. A publicação só avança quando o conector oficial da plataforma estiver configurado.'})});
app.post('/api/distribution/orders/:id/retry/:platformId',auth,artistOnly,async(req:AuthedRequest,res)=>{const d=(await pool.query(`select d.*,o.id order_id,p.name,a.user_id from distribution_deliveries d join distribution_platforms p on p.id=d.platform_id join distribution_orders o on o.id=d.order_id join artists a on a.id=o.artist_id where d.id=$1 and p.id=$2 and a.user_id=$3`,[req.params.id,req.params.platformId,req.user!.id])).rows[0];if(!d)return res.status(404).json({error:'Entrega não encontrada'});if(d.status!=='FAILED')return res.status(400).json({error:'A entrega não está em falha'});await pool.query(`update distribution_deliveries set status='READY',error_code=null,error_message=null,updated_at=now() where id=$1`,[d.id]);await distHistory(d.order_id,d.id,'FAILED','READY',`Reenvio solicitado para ${d.name}`,req.user!.id);res.json({ok:true,status:'READY'})});
app.post('/api/distribution/catalog-migrations',auth,artistOnly,async(req:AuthedRequest,res)=>{const {releaseId,previousDistributor,oldIsrc,oldUpc,originalReleaseDate,platformLinks={},oldStatus}=req.body||{};if(!releaseId||!previousDistributor)return res.status(400).json({error:'releaseId e distribuidor anterior são obrigatórios'});const a=(await pool.query('select id from artists where user_id=$1 limit 1',[req.user!.id])).rows[0];const r=(await pool.query('select id from releases where id=$1 and primary_artist_id=$2',[releaseId,a?.id])).rows[0];if(!r)return res.status(404).json({error:'Lançamento não encontrado'});const q=await pool.query(`insert into catalog_migrations(release_id,artist_id,previous_distributor,old_isrc,old_upc,original_release_date,platform_links,old_status) values($1,$2,$3,$4,$5,$6,$7,$8) returning *`,[releaseId,a.id,previousDistributor,oldIsrc||null,oldUpc||null,originalReleaseDate||null,JSON.stringify(platformLinks),oldStatus||null]);await audit(req.user!.id,'CATALOG_MIGRATION_CREATED','CATALOG_MIGRATION',q.rows[0].id,{preserveIdentity:true});res.status(201).json({migration:q.rows[0]})});
app.get('/api/distribution/catalog-migrations',auth,artistOnly,async(req:AuthedRequest,res)=>{const a=(await pool.query('select id from artists where user_id=$1 limit 1',[req.user!.id])).rows[0];res.json({migrations:(await pool.query(`select cm.*,r.title release_title from catalog_migrations cm join releases r on r.id=cm.release_id where cm.artist_id=$1 order by cm.created_at desc`,[a?.id])).rows})});
app.get('/api/admin/distribution/orders',auth,adminOnly,async(_q,res)=>res.json({orders:(await pool.query(`select o.*,r.title release_title,a.stage_name from distribution_orders o join releases r on r.id=o.release_id join artists a on a.id=o.artist_id order by o.created_at desc`)).rows}));
app.post('/api/admin/distribution/deliveries/:id/status',auth,adminOnly,async(req:AuthedRequest,res)=>{const {status,externalReleaseId,externalUrl,errorCode,errorMessage}=req.body||{};if(!DIST_STATUSES.includes(status))return res.status(400).json({error:'Estado inválido'});const d=(await pool.query(`select d.*,o.id order_id,p.name platform_name from distribution_deliveries d join distribution_orders o on o.id=d.order_id join distribution_platforms p on p.id=d.platform_id where d.id=$1`,[req.params.id])).rows[0];if(!d)return res.status(404).json({error:'Entrega não encontrada'});await pool.query(`update distribution_deliveries set status=$1,external_release_id=coalesce($2,external_release_id),external_url=coalesce($3,external_url),error_code=$4,error_message=$5,delivered_at=case when $1='DELIVERED' then now() else delivered_at end,published_at=case when $1='PUBLISHED' then now() else published_at end,updated_at=now() where id=$6`,[status,externalReleaseId||null,externalUrl||null,errorCode||null,errorMessage||null,d.id]);const c=(await pool.query(`select count(*)::int total,count(*) filter(where status='PUBLISHED')::int published,count(*) filter(where status='FAILED')::int failed from distribution_deliveries where order_id=$1`,[d.order_id])).rows[0];const os=Number(c.published)===Number(c.total)?'PUBLISHED':Number(c.failed)+Number(c.published)===Number(c.total)&&Number(c.failed)>0?'FAILED':'PROCESSING';await pool.query(`update distribution_orders set status=$1,error=$2,completed_at=case when $1 in ('PUBLISHED','FAILED') then now() else completed_at end,updated_at=now() where id=$3`,[os,errorMessage||null,d.order_id]);await distHistory(d.order_id,d.id,d.status,status,`Estado ${d.platform_name}: ${status}`,req.user!.id);await audit(req.user!.id,'DISTRIBUTION_DELIVERY_STATUS','DISTRIBUTION_DELIVERY',d.id,{status});res.json({ok:true,status,orderStatus:os})});

app.listen(port,()=>console.log(`BaBuLo API running on :${port}`));
