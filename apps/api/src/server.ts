// @ts-nocheck
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

async function ensureDatabaseSchema() {
  if (!process.env.DATABASE_URL) {
    console.warn('DATABASE_URL não definido; a API continuará sem inicializar o schema.');
    return;
  }

  const rootDir = path.resolve(__dirname, '../../../');
  const schemaPath = path.join(rootDir, 'packages/db/schema.sql');
  const migrationsDir = path.join(rootDir, 'packages/db/migrations');

  try {
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Schema não encontrado em ${schemaPath}`);
    }

    // O schema principal contém comandos psql \\i, que não são aceites pelo driver pg.
    // Executamos o schema base e, em seguida, as migrações SQL de forma idempotente.
    const schema = fs.readFileSync(schemaPath, 'utf8')
      .replace(/^\s*\\i\s+.*$/gm, '')
      .trim();
    await pool.query(schema);

    for (const file of ['001_preflight_isrc.sql', '002_rights_approval.sql', '003_royalties_ledger.sql', '004_payment_engine.sql', '005_distribution_engine.sql', '006_track_metadata.sql', '007_track_order.sql', '008_release_payment.sql', '009_v103_media_distribution.sql', '010_wallet_release_payments.sql', '011_artist_idle_sessions.sql', '012_artist_auth_sessions.sql', '013_v104_analytics.sql', '014_owner_bootstrap.sql', '015_admin_user_management.sql', '016_admin_permissions.sql', '017_secure_auth.sql', '018_admin_profile.sql', '019_financial_approvals.sql', '020_owner_finance_control.sql', '021_owner_advertising.sql']) {
      const migrationPath = path.join(migrationsDir, file);
      if (!fs.existsSync(migrationPath)) throw new Error(`Migração não encontrada: ${migrationPath}`);
      await pool.query(fs.readFileSync(migrationPath, 'utf8'));
    }

    console.log('BaBuLo DB schema verified and migrations applied.');
  } catch (error) {
    console.error('Database schema initialization failed:', error);
    throw error;
  }
}


async function bootstrapFirstOwner() {
  const enabled = String(process.env.BOOTSTRAP_OWNER_ENABLED || '').toLowerCase() === 'true';
  if (!enabled) return;
  const email = String(process.env.BOOTSTRAP_OWNER_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.BOOTSTRAP_OWNER_PASSWORD || '');
  if (!email || !email.includes('@')) throw new Error('BOOTSTRAP_OWNER_EMAIL inválido.');
  if (password.length < 12) throw new Error('BOOTSTRAP_OWNER_PASSWORD deve ter pelo menos 12 caracteres.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const marker = (await client.query("select key from system_settings where key='owner_bootstrap_completed' limit 1")).rows[0];
    if (marker) {
      await client.query('ROLLBACK');
      console.log('Owner bootstrap já foi concluído anteriormente; nenhum novo OWNER será criado.');
      return;
    }
    const existing = (await client.query("select id from users where role='OWNER' limit 1")).rows[0];
    if (existing) {
      await client.query("insert into system_settings(key,value) values('owner_bootstrap_completed','existing_owner') on conflict (key) do nothing");
      await client.query('COMMIT');
      console.log('Já existe um OWNER; bootstrap inicial não criou outra conta.');
      return;
    }
    const duplicate = (await client.query('select id from users where lower(email)=lower($1) limit 1',[email])).rows[0];
    if (duplicate) throw new Error('BOOTSTRAP_OWNER_EMAIL já pertence a uma conta existente.');
    const user = (await client.query(
      `insert into users(email,password_hash,role,status,email_verified) values($1,$2,'OWNER','ACTIVE',true) returning id,email,role,created_at`,
      [email, hashPassword(password)]
    )).rows[0];
    await client.query("insert into system_settings(key,value) values('owner_bootstrap_completed',$1)", [user.id]);
    await client.query('COMMIT');
    console.log('Primeiro OWNER criado com sucesso pelo bootstrap seguro do Render.');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

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

function randomToken(bytes=32){ return crypto.randomBytes(bytes).toString('hex'); }
function hashToken(value:string){ return crypto.createHash('sha256').update(value).digest('hex'); }
function base32Encode(buf:Buffer){ const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits=0,val=0,out=''; for(const byte of buf){ val=(val<<8)|byte; bits+=8; while(bits>=5){ out+=alphabet[(val>>>(bits-5))&31]; bits-=5; } } if(bits>0) out+=alphabet[(val<<(5-bits))&31]; return out; }
function base32Decode(input:string){ const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits=0,val=0,out:number[]=[]; for(const c of input.replace(/=+$/,'').toUpperCase()){ const n=alphabet.indexOf(c); if(n<0) continue; val=(val<<5)|n; bits+=5; if(bits>=8){ out.push((val>>>(bits-8))&255); bits-=8; } } return Buffer.from(out); }
function totp(secret:string, counter:number){ const key=base32Decode(secret); const msg=Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter)); const h=crypto.createHmac('sha1',key).update(msg).digest(); const off=h[h.length-1]&15; const code=((h[off]&127)<<24)|((h[off+1]&255)<<16)|((h[off+2]&255)<<8)|(h[off+3]&255); return String(code%1000000).padStart(6,'0'); }
function verifyTotp(secret:string,code:string){ const now=Math.floor(Date.now()/1000/30); return [-1,0,1].some(delta=>crypto.timingSafeEqual(Buffer.from(totp(secret,now+delta)),Buffer.from(String(code).padStart(6,'0')))); }
function encryptSecret(value:string){ const key=crypto.createHash('sha256').update(JWT_SECRET).digest(); const iv=crypto.randomBytes(12); const cipher=crypto.createCipheriv('aes-256-gcm',key,iv); const enc=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]); return [iv.toString('hex'),cipher.getAuthTag().toString('hex'),enc.toString('hex')].join('$'); }
function decryptSecret(value:string){ const [ivHex,tagHex,dataHex]=String(value||'').split('$'); if(!ivHex||!tagHex||!dataHex) throw new Error('Segredo 2FA inválido'); const key=crypto.createHash('sha256').update(JWT_SECRET).digest(); const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(ivHex,'hex')); decipher.setAuthTag(Buffer.from(tagHex,'hex')); return Buffer.concat([decipher.update(Buffer.from(dataHex,'hex')),decipher.final()]).toString('utf8'); }
function sessionIdleLimit(role:string){ return role==='ADMIN'||role==='OWNER' ? 20*60*1000 : role==='ARTIST' ? 30*60*1000 : 60*60*1000; }
async function sendEmail(to:string,subject:string,text:string){
  const key=String(process.env.RESEND_API_KEY||''); const from=String(process.env.AUTH_FROM_EMAIL||'');
  if(!key || !from){ console.log(`[BaBuLo AUTH EMAIL DEV] Para: ${to} | ${subject} | ${text}`); return false; }
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({from,to,subject,text})});
  if(!r.ok){ const body=await r.text(); console.error('Falha ao enviar email:',body); return false; } return true;
}
function publicWebUrl(pathname:string,token:string){ return `${String(process.env.WEB_ORIGIN||'http://localhost:3000').replace(/\/$/,'')}${pathname}?token=${encodeURIComponent(token)}`; }
function b64(value: string) { return Buffer.from(value).toString('base64url'); }
function tokenFor(user: { id: string; role: string }, sid: string) {
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64(JSON.stringify({ sub: user.id, role: user.role, sid, exp: Math.floor(Date.now()/1000) + 60*60*24 }));
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
  return data as { sub: string; role: string; sid?: string; exp: number };
}
type AuthedRequest = Request & { user?: { id: string; role: string } };
async function auth(req: AuthedRequest, res: Response, next: NextFunction) {
  const value = req.headers.authorization;
  if (!value?.startsWith('Bearer ')) return res.status(401).json({ error: 'Autenticação necessária' });
  const decoded = decodeToken(value.slice(7));
  if (!decoded?.sid) return res.status(401).json({ error: 'Sessão inválida ou expirada' });
  try {
    const row=(await pool.query('select role,status from users where id=$1 limit 1',[decoded.sub])).rows[0];
    if(!row || row.status!=='ACTIVE') return res.status(401).json({error:'Conta inativa ou não encontrada'});
    const role=String(row.role||decoded.role);
    const session=(await pool.query('select last_activity_at,revoked_at from auth_sessions where id=$1 and user_id=$2 limit 1',[decoded.sid,decoded.sub])).rows[0];
    if(!session || session.revoked_at) return res.status(401).json({error:'Sessão encerrada. Faça login novamente.'});
    const idleLimit=sessionIdleLimit(role); const last=session.last_activity_at?new Date(session.last_activity_at).getTime():0;
    if(last && Date.now()-last>=idleLimit){ await pool.query('update auth_sessions set revoked_at=now() where id=$1',[decoded.sid]); return res.status(401).json({error:'Sessão expirada por inatividade. Faça login novamente.'}); }
    if(!last || Date.now()-last>=60*1000) await pool.query('update auth_sessions set last_activity_at=now() where id=$1 and revoked_at is null',[decoded.sid]);
    req.user = { id: decoded.sub, role }; next();
  } catch (error) { console.error('auth session check failed:',error); return res.status(500).json({error:'Não foi possível validar a sessão'}); }
}

function artistOnly(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!['ARTIST','ADMIN','OWNER'].includes(req.user?.role || '')) return res.status(403).json({ error: 'Acesso reservado a artistas' });
  next();
}

function adminOnly(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!['ADMIN','OWNER'].includes(req.user?.role || '')) return res.status(403).json({ error: 'Acesso reservado à administração' });
  next();
}

function ownerOnly(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== 'OWNER') return res.status(403).json({ error: 'Apenas o OWNER pode aprovar operações financeiras.' });
  next();
}

const ADMIN_PERMISSIONS=['USERS','ARTISTS','TEAM','RELEASES','FINANCE','WITHDRAWALS','MODERATION','ANALYTICS','SETTINGS'];
function requireAnyAdminPermission(permissions:string[]){
  return async (req:AuthedRequest,res:Response,next:NextFunction)=>{
    if(req.user?.role==='OWNER') return next();
    if(req.user?.role!=='ADMIN') return res.status(403).json({error:'Acesso reservado à administração'});
    try{
      const row=(await pool.query('select admin_permissions from users where id=$1 and role=\'ADMIN\'', [req.user.id])).rows[0];
      const current=Array.isArray(row?.admin_permissions)?row.admin_permissions:ADMIN_PERMISSIONS;
      if(!permissions.some(p=>current.includes(p))) return res.status(403).json({error:'Este ADMIN não tem a função necessária para esta operação.'});
      next();
    }catch(e){console.error(e);res.status(500).json({error:'Não foi possível validar as permissões do ADMIN'});}
  };
}

function requireAdminPermission(permission:string){
  return async (req:AuthedRequest,res:Response,next:NextFunction)=>{
    if(req.user?.role==='OWNER') return next();
    if(req.user?.role!=='ADMIN') return res.status(403).json({error:'Acesso reservado à administração'});
    try{
      const row=(await pool.query("select admin_permissions from users where id=$1 and role='ADMIN'", [req.user.id])).rows[0];
      const permissions=Array.isArray(row?.admin_permissions)?row.admin_permissions:ADMIN_PERMISSIONS;
      if(!permissions.includes(permission)) return res.status(403).json({error:`Este ADMIN não tem a função/permissão: ${permission}.`});
      next();
    }catch(e){console.error(e);res.status(500).json({error:'Não foi possível validar as permissões do ADMIN'});}
  };
}

async function audit(actorUserId: string | undefined, action: string, entityType: string, entityId: string | undefined, details: unknown = {}) {
  try { await pool.query(`insert into audit_logs(actor_user_id,action,entity_type,entity_id,details) values($1,$2,$3,$4,$5)`, [actorUserId || null, action, entityType, entityId || null, JSON.stringify(details)]); } catch (e) { console.error('audit log failed', e); }
}

const RIGHTS_ROLES=['RIGHTS_HOLDER','ARTIST','COMPOSER','LYRICIST','PRODUCER','PERFORMER','PUBLISHER','LABEL'];
const RIGHT_TYPES=['STREAMING','DOWNLOAD','DISTRIBUTION','VIDEO','ADS','SYNC'];
const PAYMENT_METHODS=['WALLET','MULTICAIXA_EXPRESS','MULTICAIXA_REFERENCE','VISA','MASTERCARD'];
const PAYMENT_STATUSES=['PENDING','PAID','FAILED','CANCELLED','REFUNDED'];
function makePaymentReference(){ return `BBP-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }

app.get('/api/health', async (_req,res) => { try { await pool.query('select 1'); res.json({ok:true,service:'babulo-api'}); } catch { res.status(503).json({ok:false}); } });

app.post('/api/auth/register', async (req,res) => {
  const { email, phone, password, role = 'LISTENER', stageName } = req.body || {};
  const normalizedEmail=String(email||'').trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes('@')) return res.status(400).json({error:'Informe um email válido'});
  if (!password || String(password).length < 8) return res.status(400).json({error:'A palavra-passe deve ter pelo menos 8 caracteres'});
  const safeRole = ['LISTENER','ARTIST'].includes(role) ? role : 'LISTENER';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const u = await client.query(`insert into users(email,phone,password_hash,role,email_verified) values($1,$2,$3,$4,false) returning id,email,phone,role,created_at`, [normalizedEmail, phone || null, hashPassword(password), safeRole]);
    let artist = null;
    if (safeRole === 'ARTIST') { if (!stageName) { await client.query('ROLLBACK'); return res.status(400).json({error:'stageName é obrigatório para contas de artista'}); } artist = (await client.query(`insert into artists(user_id,stage_name) values($1,$2) returning id,stage_name`, [u.rows[0].id, stageName])).rows[0]; }
    const raw=randomToken(); await client.query(`insert into auth_email_tokens(id,user_id,token_hash,type,expires_at) values($1,$2,$3,'VERIFY_EMAIL',now()+interval '24 hours')`,[crypto.randomUUID(),u.rows[0].id,hashToken(raw)]);
    await client.query('COMMIT');
    const link=publicWebUrl('/',raw).replace('?token=','?verify='); await sendEmail(normalizedEmail,'Verifica o teu email — BaBuLo Play',`Bem-vindo à BaBuLo Play. Confirma o teu email neste link (válido por 24 horas): ${link}`);
    res.status(201).json({ok:true,requiresEmailVerification:true,message:'Conta criada. Verifica o teu email antes de entrar.',user:u.rows[0],artist});
  } catch (e:any) { await client.query('ROLLBACK'); res.status(e.code === '23505' ? 409 : 500).json({error:e.code === '23505' ? 'Email ou telefone já registado' : 'Não foi possível criar a conta'}); } finally { client.release(); }
});

app.post('/api/auth/login', async (req,res) => {
  const { email, phone, password } = req.body || {};
  if ((!email && !phone) || !password) return res.status(400).json({error:'Informe os dados de acesso'});
  const q = await pool.query(`select id,email,phone,password_hash,role,status,email_verified,mfa_enabled,full_name,birth_date,admin_title,admin_permissions from users where (email=$1 or phone=$2) limit 1`, [String(email||'').trim().toLowerCase() || null, phone || null]);
  const user = q.rows[0];
  if (!user || user.status !== 'ACTIVE' || !verifyPassword(password,user.password_hash)) return res.status(401).json({error:'Credenciais inválidas'});
  if(!user.email_verified) return res.status(403).json({error:'Verifica primeiro o teu email. Podes pedir um novo link de verificação.',code:'EMAIL_NOT_VERIFIED'});
  delete user.password_hash;
  if(user.mfa_enabled){ const challenge=randomToken(); await pool.query(`insert into auth_challenges(id,user_id,challenge_hash,type,expires_at) values($1,$2,$3,'LOGIN_2FA',now()+interval '10 minutes')`,[crypto.randomUUID(),user.id,hashToken(challenge)]); return res.json({requires2FA:true,challenge}); }
  const sid=crypto.randomUUID(); await pool.query(`insert into auth_sessions(id,user_id,role,last_activity_at,user_agent_hash) values($1,$2,$3,now(),$4)`,[sid,user.id,user.role,hashToken(String(req.headers['user-agent']||''))]);
  res.json({user,token:tokenFor(user,sid)});
});

app.post('/api/auth/verify-2fa', async (req,res)=>{
  const {challenge,code}=req.body||{}; if(!challenge||!code) return res.status(400).json({error:'Código 2FA obrigatório'});
  const row=(await pool.query(`select c.id,c.user_id,u.email,u.phone,u.role,u.status,u.mfa_secret_enc,u.full_name,u.birth_date,u.admin_title,u.admin_permissions from auth_challenges c join users u on u.id=c.user_id where c.challenge_hash=$1 and c.type='LOGIN_2FA' and c.used_at is null and c.expires_at>now() limit 1`,[hashToken(String(challenge))])).rows[0];
  if(!row || row.status!=='ACTIVE') return res.status(401).json({error:'Desafio 2FA inválido ou expirado'});
  if(!verifyTotp(decryptSecret(row.mfa_secret_enc),String(code))) return res.status(401).json({error:'Código 2FA incorreto'});
  await pool.query('update auth_challenges set used_at=now() where id=$1',[row.id]); const sid=crypto.randomUUID(); await pool.query(`insert into auth_sessions(id,user_id,role,last_activity_at,user_agent_hash) values($1,$2,$3,now(),$4)`,[sid,row.user_id,row.role,hashToken(String(req.headers['user-agent']||''))]);
  res.json({user:{id:row.user_id,email:row.email,phone:row.phone,role:row.role,status:row.status,full_name:row.full_name,birth_date:row.birth_date,admin_title:row.admin_title,admin_permissions:row.admin_permissions},token:tokenFor({id:row.user_id,role:row.role},sid)});
});

app.post('/api/auth/resend-verification', async (req,res)=>{
  const email=String(req.body?.email||'').trim().toLowerCase(); if(!email) return res.status(400).json({error:'Informe o email'});
  const u=(await pool.query(`select id,email,email_verified from users where lower(email)=lower($1) limit 1`,[email])).rows[0];
  if(u && !u.email_verified){ await pool.query(`update auth_email_tokens set used_at=now() where user_id=$1 and type='VERIFY_EMAIL' and used_at is null`,[u.id]); const raw=randomToken(); await pool.query(`insert into auth_email_tokens(id,user_id,token_hash,type,expires_at) values($1,$2,$3,'VERIFY_EMAIL',now()+interval '24 hours')`,[crypto.randomUUID(),u.id,hashToken(raw)]); await sendEmail(email,'Novo link de verificação — BaBuLo Play',`Confirma o teu email: ${publicWebUrl('/verify-email',raw)}`); }
  res.json({ok:true,message:'Se o email existir e ainda não estiver verificado, enviámos um novo link.'});
});

app.post('/api/auth/verify-email', async (req,res)=>{
  const token=String(req.body?.token||''); if(!token) return res.status(400).json({error:'Token de verificação obrigatório'});
  const row=(await pool.query(`select id,user_id from auth_email_tokens where token_hash=$1 and type='VERIFY_EMAIL' and used_at is null and expires_at>now() limit 1`,[hashToken(token)])).rows[0];
  if(!row) return res.status(400).json({error:'Link de verificação inválido ou expirado'});
  await pool.query('update users set email_verified=true,updated_at=now() where id=$1',[row.user_id]); await pool.query('update auth_email_tokens set used_at=now() where id=$1',[row.id]); res.json({ok:true,message:'Email verificado com sucesso. Já podes entrar.'});
});

app.post('/api/auth/forgot-password', async (req,res)=>{
  const email=String(req.body?.email||'').trim().toLowerCase(); if(!email) return res.status(400).json({error:'Informe o email'});
  const u=(await pool.query(`select id,email from users where lower(email)=lower($1) and status<>'BLOCKED' limit 1`,[email])).rows[0];
  if(u){ await pool.query(`update auth_email_tokens set used_at=now() where user_id=$1 and type='RESET_PASSWORD' and used_at is null`,[u.id]); const raw=randomToken(); await pool.query(`insert into auth_email_tokens(id,user_id,token_hash,type,expires_at) values($1,$2,$3,'RESET_PASSWORD',now()+interval '30 minutes')`,[crypto.randomUUID(),u.id,hashToken(raw)]); await sendEmail(email,'Recuperação de palavra-passe — BaBuLo Play',`Redefine a tua palavra-passe (válido por 30 minutos): ${publicWebUrl('/',raw).replace('?token=','?reset=')}`); }
  res.json({ok:true,message:'Se o email existir, receberás instruções para recuperar a palavra-passe.'});
});

app.post('/api/auth/reset-password', async (req,res)=>{
  const {token,password}=req.body||{}; if(!token||!password||String(password).length<8) return res.status(400).json({error:'Token e palavra-passe de pelo menos 8 caracteres são obrigatórios'});
  const row=(await pool.query(`select id,user_id from auth_email_tokens where token_hash=$1 and type='RESET_PASSWORD' and used_at is null and expires_at>now() limit 1`,[hashToken(String(token))])).rows[0]; if(!row) return res.status(400).json({error:'Link de recuperação inválido ou expirado'});
  await pool.query('update users set password_hash=$1,updated_at=now() where id=$2',[hashPassword(String(password)),row.user_id]); await pool.query('update auth_email_tokens set used_at=now() where id=$1',[row.id]); await pool.query('update auth_sessions set revoked_at=now() where user_id=$1 and revoked_at is null',[row.user_id]); res.json({ok:true,message:'Palavra-passe alterada. Todas as sessões anteriores foram encerradas.'});
});

app.get('/api/auth/sessions', auth, async (req:AuthedRequest,res)=>{ const rows=(await pool.query(`select id,role,created_at,last_activity_at,revoked_at from auth_sessions where user_id=$1 order by created_at desc`,[req.user!.id])).rows; res.json({sessions:rows}); });
app.post('/api/auth/sessions/revoke-all', auth, async (req:AuthedRequest,res)=>{ await pool.query(`update auth_sessions set revoked_at=now() where user_id=$1 and revoked_at is null`,[req.user!.id]); res.json({ok:true}); });

app.post('/api/auth/activity', auth, async (req:AuthedRequest,res) => { const decoded=decodeToken(String(req.headers.authorization||'').slice(7)); if(decoded?.sid) await pool.query('update auth_sessions set last_activity_at=now() where id=$1 and user_id=$2 and revoked_at is null',[decoded.sid,req.user!.id]); res.json({ok:true}); });
app.post('/api/auth/logout', auth, async (req:AuthedRequest,res) => { const decoded=decodeToken(String(req.headers.authorization||'').slice(7)); if(decoded?.sid) await pool.query('update auth_sessions set revoked_at=now() where id=$1 and user_id=$2',[decoded.sid,req.user!.id]); res.json({ok:true}); });

app.post('/api/auth/2fa/setup', auth, async (req:AuthedRequest,res)=>{
  if(!['ADMIN','OWNER'].includes(req.user!.role)) return res.status(403).json({error:'2FA é obrigatório apenas para ADMIN/OWNER.'});
  const secret=base32Encode(crypto.randomBytes(20)); const enc=encryptSecret(secret); await pool.query('update users set mfa_secret_enc=$1,mfa_pending=true where id=$2',[enc,req.user!.id]); const u=(await pool.query('select email from users where id=$1',[req.user!.id])).rows[0]; const issuer='BaBuLo Play'; const uri=`otpauth://totp/${encodeURIComponent(issuer+':'+u.email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`; res.json({secret,otpauthUri:uri,message:'Adiciona esta chave no Google Authenticator, Microsoft Authenticator ou app compatível e confirma com o código.'});
});
app.post('/api/auth/2fa/enable', auth, async (req:AuthedRequest,res)=>{ if(!['ADMIN','OWNER'].includes(req.user!.role)) return res.status(403).json({error:'Acesso reservado à administração'}); const row=(await pool.query('select mfa_secret_enc from users where id=$1',[req.user!.id])).rows[0]; if(!row?.mfa_secret_enc) return res.status(400).json({error:'Primeiro inicia a configuração do 2FA'}); if(!verifyTotp(decryptSecret(row.mfa_secret_enc),String(req.body?.code||''))) return res.status(400).json({error:'Código 2FA incorreto'}); await pool.query('update users set mfa_enabled=true,mfa_pending=false where id=$1',[req.user!.id]); res.json({ok:true,message:'2FA ativado com sucesso.'}); });
app.post('/api/auth/2fa/disable', auth, async (req:AuthedRequest,res)=>{ if(!['ADMIN','OWNER'].includes(req.user!.role)) return res.status(403).json({error:'Acesso reservado à administração'}); const row=(await pool.query('select mfa_secret_enc,mfa_enabled from users where id=$1',[req.user!.id])).rows[0]; if(!row?.mfa_enabled) return res.json({ok:true}); if(!verifyTotp(decryptSecret(row.mfa_secret_enc),String(req.body?.code||''))) return res.status(400).json({error:'Código 2FA incorreto'}); await pool.query('update users set mfa_enabled=false,mfa_pending=false,mfa_secret_enc=null where id=$1',[req.user!.id]); res.json({ok:true,message:'2FA desativado.'}); });

app.get('/api/auth/me', auth, async (req:AuthedRequest,res) => {
  const q = await pool.query(`select id,email,phone,role,status,email_verified,phone_verified,mfa_enabled,full_name,birth_date,admin_title,admin_permissions,created_at,updated_at from users where id=$1`, [req.user!.id]);
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
  const q=await pool.query(`insert into releases(title,type,primary_artist_id,genre_id,language,country,release_date,pre_release_date,cover_url,description,upc,ean,label_name,phonographic_copyright,copyright_text) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`,[title,type,artist.id,genreId||null,language||null,country||null,releaseDate||null,preReleaseDate||null,coverUrl||null,description||null,upc||null,ean||null,labelName||null,phonographicCopyright||null,copyrightText||null]);
  res.status(201).json({release:q.rows[0]});
});

app.put('/api/releases/:id', auth, artistOnly, async (req:AuthedRequest,res) => {
  const {title,type='SINGLE',genreId,language,country,releaseDate,preReleaseDate,coverUrl,description,upc,ean,labelName,phonographicCopyright,copyrightText}=req.body||{};
  const q=await pool.query(`update releases r set title=coalesce($1::text,r.title),type=coalesce($2::text,r.type),genre_id=$3::uuid,language=$4::text,country=$5::text,release_date=$6::date,pre_release_date=$7::date,cover_url=$8::text,description=$9::text,upc=$10::text,ean=$11::text,label_name=$12::text,phonographic_copyright=$13::text,copyright_text=$14::text where r.id=$15::uuid and exists(select 1 from artists a where a.id=r.primary_artist_id and a.user_id=$16::uuid) returning r.*`,[title||null,type,genreId||null,language||null,country||null,releaseDate||null,preReleaseDate||null,coverUrl||null,description||null,upc||null,ean||null,labelName||null,phonographicCopyright||null,copyrightText||null,req.params.id,req.user!.id]);
  if(!q.rows[0]) return res.status(404).json({error:'Lançamento não encontrado'});
  res.json({release:q.rows[0]});
});

app.get('/api/releases/:id/editor', auth, artistOnly, async (req:AuthedRequest,res) => {
  const release=(await pool.query(`select r.* from releases r join artists a on a.id=r.primary_artist_id where r.id=$1 and a.user_id=$2`,[req.params.id,req.user!.id])).rows[0];
  if(!release) return res.status(404).json({error:'Lançamento não encontrado'});
  const tracks=(await pool.query(`select t.*,tf.storage_key,tf.format as file_format from tracks t left join track_files tf on tf.track_id=t.id and tf.file_type='AUDIO' where t.primary_release_id=$1 order by t.track_number nulls last,t.created_at`,[release.id])).rows;
  const rights=(await pool.query(`select * from rights_declarations where release_id=$1 order by created_at`,[release.id])).rows;
  const mappedTracks=tracks.map((t:any)=>({...t,audioUrl:t.storage_key?`/media/${String(t.storage_key).split('/').pop()}`:'' ,audioName:t.storage_key?String(t.storage_key).split('/').pop():'',serverTrackId:t.id,serverRightId:(rights.find((r:any)=>String(r.track_id)===String(t.id))||{}).id||undefined}));
  res.json({release,tracks:mappedTracks,rights});
});

app.get('/api/artists/me/releases', auth, artistOnly, async (req:AuthedRequest,res) => {
  const artist=(await pool.query('select id from artists where user_id=$1 limit 1',[req.user!.id])).rows[0];
  if(!artist) return res.status(404).json({error:'Perfil de artista não encontrado'});
  const q=await pool.query('select id,title,type,cover_url,release_date,status,created_at from releases where primary_artist_id=$1 order by created_at desc',[artist.id]);
  res.json({releases:q.rows});
});

app.delete('/api/releases/:id', auth, artistOnly, async (req:AuthedRequest,res) => {
  const release=(await pool.query(`select r.id,r.title,r.type,r.status,r.cover_url from releases r join artists a on a.id=r.primary_artist_id where r.id=$1 and a.user_id=$2`,[req.params.id,req.user!.id])).rows[0];
  if(!release) return res.status(404).json({error:'Lançamento não encontrado'});
  if(['PUBLISHED','TAKEN_DOWN'].includes(String(release.status))) return res.status(409).json({error:'Este lançamento já foi publicado e não pode ser eliminado daqui.'});
  const order=(await pool.query('select id from distribution_orders where release_id=$1 limit 1',[release.id])).rows[0];
  if(order) return res.status(409).json({error:'Este lançamento já tem uma ordem de distribuição e não pode ser eliminado.'});
  const files=(await pool.query(`select tf.storage_key from track_files tf join tracks t on t.id=tf.track_id where t.primary_release_id=$1`,[release.id])).rows;
  const coverKey=release.cover_url?String(release.cover_url).split('/').pop():'';
  await pool.query('delete from releases where id=$1',[release.id]);
  for(const f of files){const key=String(f.storage_key||'').replace(/^.*[\/]/,''); if(key){try{const fp=path.join(uploadDir,key);if(fs.existsSync(fp))fs.unlinkSync(fp);}catch{}}}
  if(coverKey&&coverKey.startsWith(String(req.user!.id)+'-')){try{const fp=path.join(uploadDir,coverKey);if(fs.existsSync(fp))fs.unlinkSync(fp);}catch{}}
  await audit(req.user!.id,'RELEASE_DELETED','RELEASE',release.id,{title:release.title});
  res.json({ok:true,id:release.id});
});

app.post('/api/tracks', auth, artistOnly, async (req:AuthedRequest,res) => {
  const { title, releaseId, trackNumber, genreId, language, version, durationMs, isExplicit=false, explicitReason, isrc, originalReleaseDate, fileUrl, fileType='AUDIO', composer, lyricist, producer, performer, publisher, featuredArtists='', audioType='SONG', promoStartMs=0, promoEndMs=0, aiGenerated='NO', aiUsage='', lyrics='' } = req.body || {};
  if(!title || !releaseId) return res.status(400).json({error:'Título e lançamento são obrigatórios'});
  const safeAudioTypes=['SONG','INSTRUMENTAL','ACAPELLA','LIVE','REMIX','COVER'];
  const safeAi=['NO','PARTIAL','FULL'];
  if(!safeAudioTypes.includes(String(audioType))) return res.status(400).json({error:'Tipo de áudio inválido'});
  if(!safeAi.includes(String(aiGenerated))) return res.status(400).json({error:'Estado de IA inválido'});
  if(Math.max(0,Number(promoEndMs)||0)-Math.max(0,Number(promoStartMs)||0)!==59000) return res.status(400).json({error:'O trecho promocional deve ter exatamente 59 segundos.'});
  const safeFeaturedArtists=Array.isArray(featuredArtists)
    ? featuredArtists.map((x:any)=>String(x).trim()).filter(Boolean).slice(0,20).join(', ')
    : String(featuredArtists||'').trim().slice(0,2000);
  const safeAiUsage=Array.isArray(aiUsage)
    ? aiUsage.map((x:any)=>String(x).trim()).filter(Boolean).slice(0,20).join(', ')
    : String(aiUsage||'').trim().slice(0,2000);
  const safeLyrics=String(lyrics||'').slice(0,100000);
  const artist=(await pool.query('select id from artists where user_id=$1 limit 1',[req.user!.id])).rows[0];
  const release=(await pool.query('select id from releases where id=$1 and primary_artist_id=$2',[releaseId,artist?.id])).rows[0];
  if(!release) return res.status(404).json({error:'Lançamento não encontrado'});
  const client=await pool.connect();
  try{ await client.query('begin');
    const t=(await client.query(`insert into tracks(title,track_number,version,duration_ms,language,genre_id,is_explicit,explicit_reason,isrc,isrc_status,isrc_source,original_release_date,composer,lyricist,producer,performer,publisher,featured_artists,audio_type,ai_generated,ai_usage,lyrics,promo_start_ms,promo_end_ms,primary_release_id) values($1::text,$2::integer,$3::text,$4::integer,$5::text,$6::uuid,$7::boolean,$8::text,$9::text,$10::text,$11::text,$12::date,$13::text,$14::text,$15::text,$16::text,$17::text,$18::text,$19::text,$20::text,$21::text,$22::text,$23::integer,$24::integer,$25::uuid) returning *`,[title,trackNumber?Number(trackNumber):null,version||null,durationMs||null,language||null,genreId||null,Boolean(isExplicit),explicitReason||null,isrc||null,isrc?'ASSIGNED':'PENDING_ASSIGNMENT',isrc?'ARTIST_PROVIDED':'NOT_PROVIDED',originalReleaseDate||null,composer||null,lyricist||null,producer||null,performer||null,publisher||null,safeFeaturedArtists||null,String(audioType),String(aiGenerated),safeAiUsage||null,safeLyrics||null,Math.max(0,Number(promoStartMs)||0),Math.max(0,Number(promoEndMs)||0),releaseId])).rows[0];
    await client.query(`insert into track_artists(track_id,artist_id,role) values($1,$2,'PRIMARY')`,[t.id,artist.id]);
    if(fileUrl){ const storageKey=String(fileUrl).split('/').pop()||String(fileUrl); await client.query(`insert into track_files(track_id,storage_key,file_type,format,status) values($1,$2,$3,$4,'UPLOADED')`,[t.id,storageKey,fileType,'unknown']); }
    await client.query('commit'); res.status(201).json({track:t});
  }catch(e){await client.query('rollback'); console.error(e); res.status(500).json({error:'Não foi possível criar a música'});}finally{client.release();}
});

app.put('/api/tracks/:trackId', auth, artistOnly, async (req:AuthedRequest,res) => {
  const {title,trackNumber,genreId,language,version,durationMs,isExplicit=false,explicitReason,isrc,originalReleaseDate,composer,lyricist,producer,performer,publisher,featuredArtists='',audioType='SONG',promoStartMs=0,promoEndMs=0,aiGenerated='NO',aiUsage='',lyrics='',fileUrl} = req.body || {};
  const t=(await pool.query(`select t.id,t.primary_release_id from tracks t join releases r on r.id=t.primary_release_id join artists a on a.id=r.primary_artist_id where t.id=$1 and a.user_id=$2`,[req.params.trackId,req.user!.id])).rows[0];
  if(!t) return res.status(404).json({error:'Faixa não encontrada'});
  if(Math.max(0,Number(promoEndMs)||0)-Math.max(0,Number(promoStartMs)||0)!==59000) return res.status(400).json({error:'O trecho promocional deve ter exatamente 59 segundos.'});
  const safeFeaturedArtists=Array.isArray(featuredArtists)?featuredArtists.map((x:any)=>String(x).trim()).filter(Boolean).slice(0,20).join(', '):String(featuredArtists||'').trim().slice(0,2000);
  const safeAiUsage=Array.isArray(aiUsage)?aiUsage.map((x:any)=>String(x).trim()).filter(Boolean).slice(0,20).join(', '):String(aiUsage||'').trim().slice(0,2000);
  const q=await pool.query(`update tracks set title=coalesce($1::text,title),track_number=$2::integer,genre_id=$3::uuid,language=$4::text,version=$5::text,duration_ms=$6::integer,is_explicit=$7::boolean,explicit_reason=$8::text,isrc=$9::text,isrc_status=case when $9::text is not null and $9::text<>'' then 'ASSIGNED' else isrc_status end,isrc_source=case when $9::text is not null and $9::text<>'' then 'ARTIST_PROVIDED' else isrc_source end,original_release_date=$10::date,composer=$11::text,lyricist=$12::text,producer=$13::text,performer=$14::text,publisher=$15::text,featured_artists=$16::text,audio_type=$17::text,ai_generated=$18::text,ai_usage=$19::text,lyrics=$20::text,promo_start_ms=$21::integer,promo_end_ms=$22::integer where id=$23::uuid returning *`,[title||null,trackNumber?Number(trackNumber):null,genreId||null,language||null,version||null,durationMs||null,Boolean(isExplicit),explicitReason||null,isrc||null,originalReleaseDate||null,composer||null,lyricist||null,producer||null,performer||null,publisher||null,safeFeaturedArtists||null,String(audioType),String(aiGenerated),safeAiUsage||null,String(lyrics||'').slice(0,100000),Math.max(0,Number(promoStartMs)||0),Math.max(0,Number(promoEndMs)||0),t.id]);
  if(fileUrl){const key=String(fileUrl).split('/').pop()||String(fileUrl); await pool.query(`delete from track_files where track_id=$1 and file_type='AUDIO'`,[t.id]); await pool.query(`insert into track_files(track_id,storage_key,file_type,format,status) values($1,$2,'AUDIO',$3,'UPLOADED')`,[t.id,key,'unknown']);}
  res.json({track:q.rows[0]});
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
  if(kind==='cover'){ const d=imageDimensions(req.file.path); if(!d || d.width!==600 || d.height!==600){ fs.unlinkSync(req.file.path); return res.status(400).json({error:d?`Capa inválida: ${d.width}×${d.height}px. A BaBuLo Play exige exatamente 600×600px.`:'Não foi possível ler as dimensões da capa.'}); } }
  const finalName=`${req.user!.id}-${Date.now()}-${crypto.randomUUID()}${ext}`;
  const finalPath=path.join(uploadDir,finalName); fs.renameSync(req.file.path,finalPath);
  res.status(201).json({file:{name:req.file.originalname,size:req.file.size,mimeType:req.file.mimetype,storageKey:finalName,url:`/media/${finalName}`,kind}});
});


app.delete('/api/uploads', auth, artistOnly, async (req:AuthedRequest,res) => {
  const key=String(req.query.key||'').split('/').pop()||'';
  if(!key || !key.startsWith(String(req.user!.id)+'-')) return res.status(403).json({error:'Ficheiro não pertence à tua conta.'});
  const fp=path.join(uploadDir,key);
  try { if(fs.existsSync(fp)) fs.unlinkSync(fp); } catch {}
  await pool.query(`delete from track_files where storage_key=$1`,[key]);
  res.json({ok:true});
});

app.delete('/api/tracks/:trackId/audio', auth, artistOnly, async (req:AuthedRequest,res) => {
  const q=await pool.query(`select tf.id,tf.storage_key,t.primary_release_id from track_files tf join tracks t on t.id=tf.track_id join releases r on r.id=t.primary_release_id join artists a on a.id=r.primary_artist_id where tf.track_id=$1 and tf.file_type='AUDIO' and a.user_id=$2 order by tf.created_at desc limit 1`,[req.params.trackId,req.user!.id]);
  const f=q.rows[0];
  if(!f) return res.status(404).json({error:'Áudio não encontrado.'});
  const fp=path.join(uploadDir,String(f.storage_key).replace(/^.*[\/]/,''));
  try { if(fs.existsSync(fp)) fs.unlinkSync(fp); } catch {}
  await pool.query(`delete from track_files where id=$1`,[f.id]);
  await audit(req.user!.id,'TRACK_AUDIO_DELETED','TRACK',req.params.trackId);
  res.json({ok:true});
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
  for(const t of tracks){ if(!t.title) errors.push('Uma faixa está sem título.'); if(!t.storage_key) errors.push(`A faixa “${t.title}” não tem áudio enviado.`); if(Number(t.promo_end_ms)-Number(t.promo_start_ms)!==59000) errors.push(`O trecho promocional da faixa “${t.title||'Sem título'}” deve ter exatamente 59 segundos.`); }
  if(release.cover_url){ const key=String(release.cover_url).split('/').pop(); const fp=path.join(uploadDir,key||''); if(!fs.existsSync(fp)) errors.push('Ficheiro da capa não encontrado no armazenamento.'); else { const d=imageDimensions(fp); if(!d) errors.push('Não foi possível validar as dimensões da capa.'); else if(d.width!==600||d.height!==600) errors.push(`A capa tem ${d.width}×${d.height}px. A BaBuLo Play exige exatamente 600×600px.`); } }
  const status=errors.length?'FAILED':'PASSED';
  await pool.query(`update releases set preflight_status=$1,preflight_reason=$2,status=$3,submitted_at=case when $1='PASSED' then now() else submitted_at end where id=$4`,[status,errors.length?errors.join(' '):null,'DRAFT',release.id]);
  res.json({preflight:{status,errors},releaseId:release.id});
});


// ===== Pagamento obrigatório por lançamento · V10.3 =====
const RELEASE_PAYMENT_PRODUCT:Record<string,string>={SINGLE:'DIST_SINGLE',EP:'DIST_EP',ALBUM:'DIST_ALBUM',ALBUM_PRO:'DIST_ALBUM_PRO'};
const MAIN_PLATFORM_CODES=['SPOTIFY','APPLE_MUSIC','YOUTUBE_MUSIC','AMAZON_MUSIC','DEEZER','PANDORA','BOOMPLAY','JOOX','SOUNDCLOUD','SHAZAM','TIKTOK','INSTAGRAM_MUSIC','FACEBOOK_MUSIC','ITUNES_STORE','YOUTUBE_SHORTS'];
const ALL_PLATFORM_CODES=['SPOTIFY','APPLE_MUSIC','YOUTUBE_MUSIC','AMAZON_MUSIC','DEEZER','TIDAL','AUDIOMACK','BOOMPLAY','SOUNDCLOUD','PANDORA','IHEARTRADIO','NAPSTER','QOBUZ','ANGHAMI','JOOX','TENCENT_MUSIC','NETEASE_CLOUD_MUSIC','KKBOX','CLARO_MUSICA','AWA','TIKTOK','INSTAGRAM_MUSIC','FACEBOOK_MUSIC','YOUTUBE_SHORTS','SNAPCHAT','TRILLER','SHAZAM','ITUNES_STORE','AMAZON_DIGITAL_MUSIC','BEATPORT','TRAXSOURCE','7DIGITAL','JUNO_DOWNLOAD'];
function platformPlanCodes(mode:string){ return mode==='ALL'?ALL_PLATFORM_CODES:MAIN_PLATFORM_CODES; }
app.get('/api/releases/:id/payment', auth, artistOnly, async (req:AuthedRequest,res) => {
  const release=(await pool.query(`select r.id,r.title,r.type,r.status,a.id artist_id from releases r join artists a on a.id=r.primary_artist_id where r.id=$1 and a.user_id=$2`,[req.params.id,req.user!.id])).rows[0];
  if(!release) return res.status(404).json({error:'Lançamento não encontrado'});
  const productCode=RELEASE_PAYMENT_PRODUCT[String(release.type)];
  const product=(await pool.query(`select id,code,name,amount,currency,active from payment_products where code=$1 and service_type='DISTRIBUTION'`,[productCode])).rows[0];
  if(!product) return res.status(500).json({error:'Preço do lançamento não configurado'});
  const payment=(await pool.query(`select id,reference,amount,currency,payment_method,gateway,status,metadata,paid_at,created_at from payment_transactions where release_id=$1 order by created_at desc limit 1`,[release.id])).rows[0]||null;
  const selectedCodes=payment?.metadata?.platformCodes || MAIN_PLATFORM_CODES;
  const mode=payment?.metadata?.distributionMode || 'MAIN';
  const fullExtra=Math.round(Number(product.amount)*0.5*100)/100;
  const total=mode==='ALL'?Number(product.amount)+fullExtra:Number(product.amount);
  const wallet=Number((await pool.query(`select coalesce(sum(case when entry_type='CREDIT' then amount when entry_type='DEBIT' then -amount else 0 end),0) balance from financial_ledger where artist_id=$1`,[release.artist_id])).rows[0].balance||0);
  const walletApplied=Number(payment?.metadata?.walletAmount||0);
  const externalDue=Math.max(0,total-walletApplied);
  res.json({release,product,payment,paid:Boolean(payment?.status==='PAID'),wallet:{balance:wallet,applied:walletApplied,externalDue},distribution:{mode,selectedCodes,mainPlatformCodes:MAIN_PLATFORM_CODES,allPlatformCodes:ALL_PLATFORM_CODES,baseAmount:Number(product.amount),extraAllPlatforms:fullExtra,totalAmount:total,surchargePercent:50}});
});

app.post('/api/releases/:id/payment', auth, artistOnly, async (req:AuthedRequest,res) => {
  const {paymentMethod='WALLET',fallbackPaymentMethod='MULTICAIXA_EXPRESS',distributionMode='MAIN'}=req.body||{};
  if(!PAYMENT_METHODS.includes(String(paymentMethod))) return res.status(400).json({error:'Método de pagamento inválido'});
  if(!['MULTICAIXA_EXPRESS','MULTICAIXA_REFERENCE','VISA','MASTERCARD'].includes(String(fallbackPaymentMethod))) return res.status(400).json({error:'Método para a diferença inválido'});
  if(!['MAIN','ALL'].includes(String(distributionMode))) return res.status(400).json({error:'Plano de distribuição inválido'});
  const release=(await pool.query(`select r.id,r.title,r.type,a.id artist_id from releases r join artists a on a.id=r.primary_artist_id where r.id=$1 and a.user_id=$2`,[req.params.id,req.user!.id])).rows[0];
  if(!release) return res.status(404).json({error:'Lançamento não encontrado'});
  const productCode=RELEASE_PAYMENT_PRODUCT[String(release.type)];
  const product=(await pool.query(`select id,code,name,amount,currency from payment_products where code=$1 and service_type='DISTRIBUTION' and active=true`,[productCode])).rows[0];
  if(!product) return res.status(500).json({error:'Preço do lançamento não configurado'});
  const selectedCodes=platformPlanCodes(String(distributionMode));
  const existingPaid=(await pool.query(`select id,reference,amount,currency,payment_method,gateway,status,metadata,paid_at,created_at from payment_transactions where release_id=$1 and service_type='DISTRIBUTION' and status='PAID' order by paid_at desc limit 1`,[release.id])).rows[0];
  const existingMode=existingPaid?.metadata?.distributionMode || null;
  if(existingPaid && existingMode==='ALL') return res.json({payment:existingPaid,paid:true,message:'Pagamento e distribuição completa já confirmados.'});
  let amount=Number(product.amount);
  let paymentType='BASE';
  if(existingPaid && existingMode==='MAIN' && distributionMode==='ALL'){ amount=Math.round(Number(product.amount)*0.5*100)/100; paymentType='PLATFORM_UPGRADE'; }
  else if(existingPaid && distributionMode==='MAIN') return res.json({payment:existingPaid,paid:true,message:'Pagamento base já confirmado.'});
  const pending=(await pool.query(`select id,reference,amount,currency,payment_method,gateway,status,metadata,paid_at,created_at from payment_transactions where release_id=$1 and status='PENDING' order by created_at desc limit 1`,[release.id])).rows[0];
  if(pending) return res.json({payment:pending,paid:false,message:'Já existe um pagamento pendente para este lançamento.'});

  const client=await pool.connect();
  try{
    await client.query('begin');
    await client.query(`select id from artists where id=$1 for update`,[release.artist_id]);
    const bal=Number((await client.query(`select coalesce(sum(case when entry_type='CREDIT' then amount when entry_type='DEBIT' then -amount else 0 end),0) balance from financial_ledger where artist_id=$1`,[release.artist_id])).rows[0].balance||0);
    const walletRequested=String(paymentMethod)==='WALLET';
    const walletAmount=walletRequested?Math.min(Math.max(0,bal),amount):0;
    const externalAmount=Math.max(0,amount-walletAmount);
    if(walletRequested && walletAmount<=0){ await client.query('rollback'); return res.status(400).json({error:'O teu saldo de streams não tem fundos disponíveis para este pagamento. Escolhe um método para pagar o valor.',walletBalance:bal,required:amount}); }
    const effectiveMethod=externalAmount>0?String(fallbackPaymentMethod):'WALLET';
    const reference=makePaymentReference();
    const gateway=effectiveMethod==='WALLET'?'WALLET':effectiveMethod==='MULTICAIXA_EXPRESS'?'MULTICAIXA_EXPRESS':effectiveMethod==='MULTICAIXA_REFERENCE'?'MULTICAIXA':'CARD';
    const metadata={releaseId:release.id,releaseTitle:release.title,productCode,productName:product.name,paymentInstructions:effectiveMethod==='MULTICAIXA_REFERENCE'?'Use a referência apresentada para concluir o pagamento.':effectiveMethod==='WALLET'?'Pagamento efetuado com saldo acumulado dos streams.':'Conclua o pagamento pelo método selecionado e aguarde a confirmação.',distributionMode,platformCodes:selectedCodes,surchargePercent:distributionMode==='ALL'?50:0,paymentType,walletAmount,externalAmount,totalAmount:amount};
    const status=externalAmount===0?'PAID':'PENDING';
    const q=await client.query(`insert into payment_transactions(user_id,product_id,release_id,service_type,payment_method,gateway,reference,idempotency_key,amount,currency,net_amount,status,metadata,paid_at) values($1::uuid,$2::uuid,$3::uuid,'DISTRIBUTION',$4::text,$5::text,$6::text,$7::text,$8::numeric,$9::text,$8::numeric,$10::text,$11::jsonb,case when $10='PAID' then now() else null end) returning id,reference,amount,currency,payment_method,gateway,status,metadata,paid_at,created_at`,[req.user!.id,product.id,release.id,effectiveMethod,gateway,reference,crypto.randomUUID(),externalAmount,product.currency,status,JSON.stringify(metadata)]);
    if(walletAmount>0){
      const after=bal-walletAmount;
      await client.query(`insert into financial_ledger(artist_id,entry_type,reference_type,reference_id,amount,currency,balance_after,description) values($1,'DEBIT','RELEASE_PAYMENT',$2,$3,'AOA',$4,$5)`,[release.artist_id,q.rows[0].id,walletAmount,after,externalAmount>0?'Reserva de saldo dos streams para pagamento do lançamento':'Pagamento do lançamento com saldo dos streams']);
    }
    await client.query('commit');
    await audit(req.user!.id,'RELEASE_PAYMENT_CREATED', 'PAYMENT',q.rows[0].id,{releaseId:release.id,productCode,paymentMethod:effectiveMethod,distributionMode,paymentType,amount,walletAmount,externalAmount});
    res.status(201).json({payment:q.rows[0],paid:status==='PAID',wallet:{balance:bal-walletAmount,applied:walletAmount,externalDue:externalAmount},message:status==='PAID'?'✓ Lançamento pago com o saldo dos streams.':'Saldo dos streams aplicado. Paga agora apenas a diferença.'});
  }catch(e){
    try{await client.query('rollback')}catch{}
    console.error('release wallet payment error',e);
    res.status(500).json({error:'Não foi possível processar o pagamento do lançamento.'});
  }finally{client.release()}
});

app.post('/api/admin/payments/:id/confirm', auth, ownerOnly, async (req:AuthedRequest,res) => {
  const q=await pool.query(`update payment_transactions set status='PAID',paid_at=now(),updated_at=now(),reviewed_by=$2,reviewed_at=now(),review_reason=null where id=$1 and status='PENDING' returning id,release_id,status,paid_at,reference,amount,currency`,[req.params.id,req.user!.id]);
  if(!q.rows[0]) return res.status(404).json({error:'Pagamento pendente não encontrado'});
  await audit(req.user!.id,'RELEASE_PAYMENT_CONFIRMED','PAYMENT',q.rows[0].id,{releaseId:q.rows[0].release_id,approvedByOwner:true});
  res.json({ok:true,payment:q.rows[0]});
});

app.post('/api/owner/payments/:id/decision', auth, ownerOnly, async (req:AuthedRequest,res) => {
  const {decision,reason}=req.body||{};
  if(!['APPROVED','REJECTED'].includes(decision)) return res.status(400).json({error:'Decisão financeira inválida'});
  if(decision==='REJECTED'&&!String(reason||'').trim()) return res.status(400).json({error:'Informe o motivo da rejeição do pagamento'});
  const client=await pool.connect();
  try{
    await client.query('begin');
    const status=decision==='APPROVED'?'PAID':'CANCELLED';
    const q=await client.query(`update payment_transactions set status=$1,paid_at=case when $1='PAID' then now() else null end,updated_at=now(),reviewed_by=$2,reviewed_at=now(),review_reason=$3,metadata=metadata || $4::jsonb where id=$5 and status='PENDING' returning id,release_id,user_id,status,paid_at,reference,amount,currency,payment_method,reviewed_at,review_reason,created_at,metadata`,[status,req.user!.id,reason||null,JSON.stringify(decision==='REJECTED'?{ownerDecision:'REJECTED',ownerDecisionReason:String(reason||'')}:{ownerDecision:'APPROVED'}),req.params.id]);
    if(!q.rows[0]){await client.query('rollback');return res.status(404).json({error:'Pagamento pendente não encontrado'});}
    const payment=q.rows[0];
    if(decision==='REJECTED'){
      const walletAmount=Number(payment.metadata?.walletAmount||0);
      const releaseId=payment.release_id;
      if(walletAmount>0 && releaseId){
        const artist=(await client.query(`select r.primary_artist_id artist_id from releases r where r.id=$1 limit 1`,[releaseId])).rows[0];
        if(artist?.artist_id){
          const bal=Number((await client.query(`select coalesce(sum(case when entry_type='CREDIT' then amount when entry_type='DEBIT' then -amount else 0 end),0) balance from financial_ledger where artist_id=$1`,[artist.artist_id])).rows[0].balance||0);
          await client.query(`insert into financial_ledger(artist_id,entry_type,reference_type,reference_id,amount,currency,balance_after,description) values($1,'CREDIT','RELEASE_PAYMENT',$2,$3,'AOA',$4,'Devolução de saldo dos streams após rejeição do pagamento')`,[artist.artist_id,payment.id,walletAmount,bal+walletAmount]);
        }
      }
    }
    await client.query('commit');
    await audit(req.user!.id,decision==='APPROVED'?'PAYMENT_APPROVED':'PAYMENT_REJECTED','PAYMENT',payment.id,{releaseId:payment.release_id,reason:reason||null,walletRefunded:decision==='REJECTED'?Number(payment.metadata?.walletAmount||0):0});
    res.json({ok:true,payment});
  }catch(e){await client.query('rollback');console.error('owner payment decision error',e);res.status(500).json({error:'Não foi possível guardar a decisão financeira'});}finally{client.release();}
});

app.get('/api/admin/payments/pending', auth, adminOnly, async (_req,res) => {
  const q=await pool.query(`select p.id,p.reference,p.amount,p.currency,p.payment_method,p.status,p.created_at,p.release_id,r.title release_title,a.stage_name from payment_transactions p left join releases r on r.id=p.release_id left join artists a on a.id=r.primary_artist_id where p.service_type='DISTRIBUTION' and p.status='PENDING' order by p.created_at asc`);
  res.json({payments:q.rows});
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
  const q=await pool.query(`insert into rights_declarations(release_id,track_id,party_name,party_role,right_type,percentage,territory,valid_from,valid_to,document_url,created_by) values($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::numeric,$7::text,$8::date,$9::date,$10::text,$11::uuid) returning *`,[release.id,trackId||null,partyName,partyRole,rightType,pct,territory,validFrom||null,validTo||null,documentUrl||null,req.user!.id]);
  await audit(req.user!.id,'RIGHT_CREATED','RIGHTS',q.rows[0].id,{releaseId:release.id});
  res.status(201).json({right:q.rows[0]});
});

app.put('/api/releases/:id/rights/:rightId', auth, artistOnly, async (req:AuthedRequest,res) => {
  const {partyName,partyRole='RIGHTS_HOLDER',rightType='STREAMING',percentage,territory='WORLDWIDE'}=req.body||{};
  const release=(await pool.query(`select r.id from releases r join artists a on a.id=r.primary_artist_id where r.id=$1 and a.user_id=$2`,[req.params.id,req.user!.id])).rows[0];
  if(!release) return res.status(404).json({error:'Lançamento não encontrado'});
  if(!partyName || percentage===undefined) return res.status(400).json({error:'Nome do titular e percentagem são obrigatórios'});
  const pct=Number(percentage); if(!Number.isFinite(pct)||pct<0||pct>100) return res.status(400).json({error:'A percentagem deve estar entre 0 e 100'});
  const q=await pool.query(`update rights_declarations set party_name=$1,party_role=$2,right_type=$3,percentage=$4,territory=$5 where id=$6 and release_id=$7 returning *`,[String(partyName).trim(),partyRole,rightType,pct,territory,req.params.rightId,release.id]);
  if(!q.rows[0]) return res.status(404).json({error:'Declaração de direitos não encontrada'});
  await audit(req.user!.id,'RIGHT_UPDATED','RIGHTS',q.rows[0].id,{releaseId:release.id});
  res.json({right:q.rows[0]});
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
  const paid=(await pool.query(`select id from payment_transactions where release_id=$1 and service_type='DISTRIBUTION' and status='PAID' order by paid_at desc limit 1`,[release.id])).rows[0];
  if(!paid) return res.status(402).json({error:'O pagamento deste lançamento ainda não foi confirmado. O lançamento permanece em rascunho até o pagamento ser confirmado.'});
  const rights=(await pool.query(`select right_type,territory,coalesce(track_id,'00000000-0000-0000-0000-000000000000') track_key,sum(percentage) total from rights_declarations where release_id=$1 and status='PENDING' group by right_type,territory,track_id`,[release.id])).rows;
  if(!rights.length) return res.status(400).json({error:'Declare pelo menos um titular de direitos antes de submeter.'});
  const invalid=rights.find((r:any)=>Number(r.total)!==100);
  if(invalid) return res.status(400).json({error:`Os direitos de ${invalid.right_type} (${invalid.territory}) devem totalizar 100%. Atualmente: ${Number(invalid.total)}%.`});
  await pool.query(`update releases set status='PENDING_APPROVAL',review_reason=null where id=$1`,[release.id]);
  await audit(req.user!.id,'RELEASE_SUBMITTED','RELEASE',release.id,{status:'PENDING_APPROVAL'});
  res.json({ok:true,status:'PENDING_APPROVAL'});
});

app.get('/api/admin/releases/pending', auth, requireAdminPermission('RELEASES'), async (req:AuthedRequest,res) => {
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

app.get('/api/admin/copyright-complaints', auth, requireAdminPermission('MODERATION'), async (_req,res) => {
  const q=await pool.query(`select c.*,r.title release_title,t.title track_title from copyright_complaints c left join releases r on r.id=c.release_id left join tracks t on t.id=c.track_id order by c.created_at desc`);
  res.json({complaints:q.rows});
});

app.post('/api/admin/copyright-complaints/:id/decision', auth, requireAdminPermission('MODERATION'), async (req:AuthedRequest,res) => {
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


// ===== V10.4.2: Gestão de utilizadores, artistas e equipa =====
const ACCOUNT_STATUSES=['ACTIVE','SUSPENDED','BLOCKED'];
const VERIFICATION_STATUSES=['UNVERIFIED','PENDING','VERIFIED','REJECTED'];

app.get('/api/admin/users', auth, requireAnyAdminPermission(['USERS','ARTISTS','TEAM']), async (req:AuthedRequest,res) => {
  const qtext=String(req.query.q||'').trim();
  const role=String(req.query.role||'').trim().toUpperCase();
  const status=String(req.query.status||'').trim().toUpperCase();
  const limit=Math.min(Math.max(Number(req.query.limit)||100,1),200);
  const params:any[]=[]; const where:string[]=[];
  if(qtext){params.push(`%${qtext}%`); where.push(`(coalesce(u.email,'') ilike $${params.length} or coalesce(u.phone,'') ilike $${params.length} or coalesce(a.stage_name,'') ilike $${params.length})`);}
  if(['LISTENER','ARTIST','ADMIN','OWNER'].includes(role)){params.push(role);where.push(`u.role=$${params.length}`);}
  if(ACCOUNT_STATUSES.includes(status)){params.push(status);where.push(`u.status=$${params.length}`);}
  params.push(limit);
  const sql=`select u.id,u.phone,u.role,u.status,u.email_verified,u.phone_verified,u.admin_title,u.admin_permissions,u.full_name,u.birth_date,u.created_at,u.updated_at,
    a.id artist_id,a.stage_name,a.country,a.city,a.photo_url,a.verification_status,a.status artist_status,
    (select count(*)::int from releases r where r.primary_artist_id=a.id) release_count,
    (select count(*)::int from stream_events se join tracks t on t.id=se.track_id where t.primary_release_id in (select r2.id from releases r2 where r2.primary_artist_id=a.id) and se.is_valid=true) valid_streams
    from users u left join artists a on a.user_id=u.id ${where.length?'where '+where.join(' and '):''}
    order by case when u.role='OWNER' then 0 when u.role='ADMIN' then 1 when u.role='ARTIST' then 2 else 3 end,u.created_at desc limit $${params.length}`;
  const rows=(await pool.query(sql,params)).rows;
  res.json({users:rows});
});

app.get('/api/admin/users/:id', auth, requireAnyAdminPermission(['USERS','ARTISTS','TEAM']), async (req:AuthedRequest,res) => {
  const user=(await pool.query(`select id,phone,role,status,email_verified,phone_verified,mfa_enabled,full_name,birth_date,admin_title,admin_permissions,created_at,updated_at from users where id=$1`,[req.params.id])).rows[0];
  if(!user) return res.status(404).json({error:'Utilizador não encontrado'});
  const artist=(await pool.query(`select id,stage_name,legal_name,bio,country,city,photo_url,verification_status,status,created_at from artists where user_id=$1`,[req.params.id])).rows[0]||null;
  const releases=artist?(await pool.query(`select id,title,type,status,preflight_status,submitted_at,reviewed_at,review_reason,created_at from releases where primary_artist_id=$1 order by created_at desc limit 100`,[artist.id])).rows:[];
  const withdrawals=artist?(await pool.query(`select id,amount,currency,method,status,rejection_reason,created_at,reviewed_at from withdrawals where artist_id=$1 order by created_at desc limit 50`,[artist.id])).rows:[];
  const streamStats=artist?(await pool.query(`select count(*) filter(where se.is_valid=true)::int valid_streams,count(distinct se.listener_key) filter(where se.is_valid=true)::int unique_listeners from stream_events se join tracks t on t.id=se.track_id join releases r on r.id=t.primary_release_id where r.primary_artist_id=$1`,[artist.id])).rows[0]:null;
  const listenerStats=!artist?(await pool.query(`select count(*) filter(where se.is_valid=true)::int valid_streams,count(distinct se.listener_key) filter(where se.is_valid=true)::int unique_listeners from stream_events se where se.user_id=$1`,[req.params.id])).rows[0]:null;
  const sessions=(await pool.query(`select id,created_at,last_activity_at,revoked_at from auth_sessions where user_id=$1 order by created_at desc limit 20`,[req.params.id])).rows;
  const logs=(await pool.query(`select al.id,al.action,al.entity_type,al.entity_id,al.details,al.created_at,u.role actor_role,u.full_name actor_name from audit_logs al left join users u on u.id=al.actor_user_id where al.entity_id=$1 or al.actor_user_id=$1 order by al.created_at desc limit 50`,[req.params.id])).rows;
  res.json({user,artist,releases,withdrawals,streamStats:streamStats||listenerStats||{valid_streams:0,unique_listeners:0},sessions,logs});
});

app.post('/api/admin/users/:id/status', auth, requireAnyAdminPermission(['USERS','ARTISTS','TEAM']), async (req:AuthedRequest,res) => {
  const status=String(req.body?.status||'').toUpperCase();
  if(!ACCOUNT_STATUSES.includes(status)) return res.status(400).json({error:'Estado de conta inválido'});
  if(req.params.id===req.user!.id) return res.status(400).json({error:'Não podes alterar o estado da tua própria conta.'});
  const target=(await pool.query(`select id,role,status from users where id=$1`,[req.params.id])).rows[0];
  if(!target) return res.status(404).json({error:'Utilizador não encontrado'});
  if(target.role==='OWNER') return res.status(403).json({error:'A conta OWNER é protegida e não pode ser bloqueada por este painel.'});
  if(target.role==='ADMIN' && req.user!.role!=='OWNER') return res.status(403).json({error:'Apenas o OWNER pode alterar o estado de uma conta ADMIN.'});
  const q=await pool.query(`update users set status=$1,updated_at=now() where id=$2 returning id,email,phone,role,status`,[status,target.id]);
  await audit(req.user!.id,`USER_STATUS_${status}`,'USER',target.id,{from:target.status,to:status});
  res.json({ok:true,user:q.rows[0]});
});

app.post('/api/admin/artists/:id/verification', auth, requireAdminPermission('ARTISTS'), async (req:AuthedRequest,res) => {
  const verificationStatus=String(req.body?.verificationStatus||'').toUpperCase();
  if(!VERIFICATION_STATUSES.includes(verificationStatus)) return res.status(400).json({error:'Estado de verificação inválido'});
  const artist=(await pool.query(`select id,user_id,stage_name,verification_status from artists where id=$1`,[req.params.id])).rows[0];
  if(!artist) return res.status(404).json({error:'Artista não encontrado'});
  const q=await pool.query(`update artists set verification_status=$1 where id=$2 returning id,stage_name,verification_status`,[verificationStatus,artist.id]);
  await audit(req.user!.id,'ARTIST_VERIFICATION_UPDATED','ARTIST',artist.id,{from:artist.verification_status,to:verificationStatus});
  res.json({ok:true,artist:q.rows[0]});
});

app.delete('/api/owner/admins/:id', auth, async (req:AuthedRequest,res:Response) => {
  if(req.user?.role!=='OWNER') return res.status(403).json({error:'Apenas o OWNER pode apagar contas ADMIN.'});
  const target=(await pool.query(`select id,email,role,status,admin_title from users where id=$1`,[req.params.id])).rows[0];
  if(!target) return res.status(404).json({error:'ADMIN não encontrado'});
  if(target.role!=='ADMIN') return res.status(400).json({error:'Só é possível apagar contas ADMIN por esta operação.'});
  if(target.id===req.user!.id) return res.status(400).json({error:'Não podes apagar a tua própria conta.'});
  await audit(req.user!.id,'ADMIN_DELETED','USER',target.id,{email:target.email,adminTitle:target.admin_title,status:target.status});
  await pool.query("delete from users where id=$1 and role='ADMIN'",[target.id]);
  res.json({ok:true,message:'Conta ADMIN apagada com sucesso.'});
});

app.patch('/api/owner/admins/:id', auth, async (req:AuthedRequest,res:Response) => {
  if(req.user?.role!=='OWNER') return res.status(403).json({error:'Apenas o OWNER pode alterar funções de ADMIN.'});
  const target=(await pool.query(`select id,role,admin_title,admin_permissions from users where id=$1`,[req.params.id])).rows[0];
  if(!target) return res.status(404).json({error:'ADMIN não encontrado'});
  if(target.role!=='ADMIN') return res.status(400).json({error:'Só é possível alterar funções de contas ADMIN.'});
  const adminTitle=String(req.body?.adminTitle||'Administrador').trim().slice(0,100)||'Administrador';
  const fullName=String(req.body?.fullName||'').trim().slice(0,160)||null;
  const phone=String(req.body?.phone||'').trim().slice(0,40)||null;
  const birthDate=String(req.body?.birthDate||'').trim()||null;
  if(birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return res.status(400).json({error:'Data de nascimento inválida.'});
  const permissions=Array.isArray(req.body?.permissions)?req.body.permissions.filter((p:any)=>ADMIN_PERMISSIONS.includes(String(p))):[];
  if(!permissions.length) return res.status(400).json({error:'Selecione pelo menos uma função/permissão.'});
  const q=await pool.query(`update users set admin_title=$1,admin_permissions=$2::jsonb,full_name=$3,phone=$4,birth_date=$5,updated_at=now() where id=$6 and role='ADMIN' returning id,phone,role,status,email_verified,phone_verified,mfa_enabled,full_name,birth_date,admin_title,admin_permissions,created_at,updated_at`,[adminTitle,JSON.stringify(permissions),fullName,phone,birthDate,target.id]);
  await pool.query(`update auth_sessions set revoked_at=now() where user_id=$1 and revoked_at is null`,[target.id]);
  await audit(req.user!.id,'ADMIN_ROLE_UPDATED','USER',target.id,{fromTitle:target.admin_title,toTitle:adminTitle,fromPermissions:target.admin_permissions,toPermissions:permissions});
  res.json({ok:true,user:q.rows[0],message:'Função e permissões atualizadas. O ADMIN deverá iniciar uma nova sessão.'});
});

app.patch('/api/admin/me/profile', auth, async (req:AuthedRequest,res:Response) => {
  if(req.user?.role!=='ADMIN') return res.status(403).json({error:'Apenas ADMIN pode atualizar o próprio perfil por esta rota.'});
  const fullName=String(req.body?.fullName||'').trim().slice(0,160)||null;
  const phone=String(req.body?.phone||'').trim().slice(0,40)||null;
  const birthDate=String(req.body?.birthDate||'').trim()||null;
  if(birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return res.status(400).json({error:'Data de nascimento inválida.'});
  try{
    const q=await pool.query(`update users set full_name=$1,phone=$2,birth_date=$3,updated_at=now() where id=$4 and role='ADMIN' returning id,phone,role,status,email_verified,phone_verified,mfa_enabled,full_name,birth_date,admin_title,admin_permissions,created_at,updated_at`,[fullName,phone,birthDate,req.user.id]);
    if(!q.rows[0]) return res.status(404).json({error:'ADMIN não encontrado'});
    await audit(req.user.id,'ADMIN_PROFILE_UPDATED','USER',req.user.id,{phoneChanged:Boolean(phone),profileFields:['full_name','phone','birth_date']});
    res.json({ok:true,user:q.rows[0]});
  }catch(e:any){res.status(e.code==='23505'?409:500).json({error:e.code==='23505'?'Este telefone já está registado.':'Não foi possível atualizar o perfil.'});}
});

app.post('/api/owner/admins', auth, async (req:AuthedRequest,res:Response) => {
  if(req.user?.role!=='OWNER') return res.status(403).json({error:'Apenas o OWNER pode criar contas ADMIN.'});
  const email=String(req.body?.email||'').trim().toLowerCase();
  const password=String(req.body?.password||'');
  const adminTitle=String(req.body?.adminTitle||'Administrador').trim().slice(0,100)||'Administrador';
  const fullName=String(req.body?.fullName||'').trim().slice(0,160)||null;
  const phone=String(req.body?.phone||'').trim().slice(0,40)||null;
  const birthDate=String(req.body?.birthDate||'').trim()||null;
  if(birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return res.status(400).json({error:'Data de nascimento inválida.'});
  const permissions=Array.isArray(req.body?.permissions)?req.body.permissions.filter((p:any)=>ADMIN_PERMISSIONS.includes(String(p))):[];
  if(!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({error:'Informe um email válido.'});
  if(password.length<12) return res.status(400).json({error:'A palavra-passe do ADMIN deve ter pelo menos 12 caracteres.'});
  if(!permissions.length) return res.status(400).json({error:'Selecione pelo menos uma função para o ADMIN.'});
  const duplicate=(await pool.query(`select id from users where lower(email)=lower($1) limit 1`,[email])).rows[0];
  if(duplicate) return res.status(409).json({error:'Este email já está registado.'});
  const q=await pool.query(`insert into users(email,phone,password_hash,role,status,email_verified,full_name,birth_date,admin_title,admin_permissions) values($1,$2,$3,'ADMIN','ACTIVE',false,$4,$5,$6,$7::jsonb) returning id,email,phone,role,status,full_name,birth_date,admin_title,admin_permissions,created_at`,[email,phone,hashPassword(password),fullName,birthDate,adminTitle,JSON.stringify(permissions)]);
  const raw=randomToken(); await pool.query(`insert into auth_email_tokens(id,user_id,token_hash,type,expires_at) values($1,$2,$3,'VERIFY_EMAIL',now()+interval '24 hours')`,[crypto.randomUUID(),q.rows[0].id,hashToken(raw)]);
  await sendEmail(email,'Ativação da conta ADMIN — BaBuLo Play',`A tua conta de administrador foi criada. Confirma o teu email neste link (válido por 24 horas): ${publicWebUrl('/',raw).replace('?token=','?verify=')}`);
  await audit(req.user!.id,'ADMIN_CREATED','USER',q.rows[0].id,{email,adminTitle,permissions});
  res.status(201).json({ok:true,user:q.rows[0],requiresEmailVerification:true});
});

app.get('/api/admin/audit-logs', auth, adminOnly, async (_req,res) => {
  const q=await pool.query(`select al.*,u.role actor_role,u.full_name actor_name from audit_logs al left join users u on u.id=al.actor_user_id order by al.created_at desc limit 200`);
  res.json({logs:q.rows});
});

// ===== Streaming events + Royalty Engine =====
function firstHeader(req:Request, names:string[]){
  for(const name of names){
    const value=req.headers[name.toLowerCase()];
    if(typeof value==='string' && value.trim()) return value.split(',')[0].trim();
  }
  return null;
}
function safeGeo(value:string|null){
  if(!value) return null;
  try { value=decodeURIComponent(value); } catch {}
  return value.replace(/[\x00-\x1f<>]/g,'').trim().slice(0,120)||null;
}
function listenerKey(userId:string|null,sessionId:string|null){
  const raw=userId?`user:${userId}`:(sessionId?`session:${sessionId}`:`anon:${crypto.randomUUID()}`);
  return crypto.createHash('sha256').update(raw+'|'+JWT_SECRET).digest('hex');
}

app.post('/api/streams/events', async (req,res) => {
  const { trackId, eventType='PLAY_30S', playedSeconds=0, sessionId } = req.body || {};
  if(!trackId) return res.status(400).json({error:'trackId é obrigatório'});
  const track=(await pool.query('select id from tracks where id=$1 and status=\'PUBLISHED\'', [trackId])).rows[0];
  if(!track) return res.status(404).json({error:'Faixa publicada não encontrada'});
  const validEvents=['PLAY_30S','COMPLETED'];
  const isValid=validEvents.includes(String(eventType)) && Number(playedSeconds)>=30;
  const userIdHeader=(req.headers['x-user-id'] as string)||null;
  const country=safeGeo(firstHeader(req,['cf-ipcountry','x-country','x-geo-country']));
  const city=safeGeo(firstHeader(req,['cf-ipcity','x-city','x-geo-city']));
  const key=listenerKey(userIdHeader,sessionId||null);
  const q=await pool.query(`insert into stream_events(user_id,track_id,event_type,played_seconds,session_id,is_valid,listener_country,listener_city,listener_key) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id,event_type,is_valid,occurred_at,listener_country,listener_city`,[userIdHeader,trackId,String(eventType),Number(playedSeconds)||0,sessionId||null,isValid,country,city,key]);
  res.status(201).json({event:q.rows[0]});
});

function dateRange(req:Request){
  const now=new Date();
  const toRaw=typeof req.query.to==='string'?req.query.to:'';
  const fromRaw=typeof req.query.from==='string'?req.query.from:'';
  const to=toRaw?new Date(`${toRaw}T23:59:59.999Z`):now;
  const from=fromRaw?new Date(`${fromRaw}T00:00:00Z`):new Date(now.getTime()-29*24*60*60*1000);
  if(Number.isNaN(from.getTime())||Number.isNaN(to.getTime())||from>to) return null;
  return {from,to};
}
async function streamAnalytics(artistId:string|null, from:Date, to:Date){
  const where=artistId?`and r.primary_artist_id=$3`:'';
  const params:any[]=[from,to]; if(artistId) params.push(artistId);
  const totals=(await pool.query(`select count(*) filter(where se.is_valid) valid_streams,count(distinct se.listener_key) filter(where se.is_valid) unique_listeners,count(distinct se.listener_key) filter(where se.is_valid and se.occurred_at >= $1) listeners_in_period from stream_events se join tracks t on t.id=se.track_id join releases r on r.id=t.primary_release_id where se.occurred_at between $1 and $2 ${where}` ,params)).rows[0]||{};
  const countries=(await pool.query(`select coalesce(nullif(se.listener_country,''),'Desconhecido') country,count(*)::int streams,count(distinct se.listener_key)::int unique_listeners from stream_events se join tracks t on t.id=se.track_id join releases r on r.id=t.primary_release_id where se.is_valid=true and se.occurred_at between $1 and $2 ${where} group by 1 order by streams desc limit 20`,params)).rows;
  const cities=(await pool.query(`select coalesce(nullif(se.listener_city,''),'Desconhecida') city,coalesce(nullif(se.listener_country,''),'--') country,count(*)::int streams,count(distinct se.listener_key)::int unique_listeners from stream_events se join tracks t on t.id=se.track_id join releases r on r.id=t.primary_release_id where se.is_valid=true and se.occurred_at between $1 and $2 ${where} group by 1,2 order by streams desc limit 30`,params)).rows;
  const tracks=(await pool.query(`select t.id,t.title,count(*)::int streams,count(distinct se.listener_key)::int unique_listeners from stream_events se join tracks t on t.id=se.track_id join releases r on r.id=t.primary_release_id where se.is_valid=true and se.occurred_at between $1 and $2 ${where} group by t.id,t.title order by streams desc limit 20`,params)).rows;
  const daily=(await pool.query(`select to_char(se.occurred_at,'YYYY-MM-DD') as day_label,count(*) filter(where se.is_valid)::int streams,count(distinct se.listener_key) filter(where se.is_valid)::int unique_listeners from stream_events se join tracks t on t.id=se.track_id join releases r on r.id=t.primary_release_id where se.occurred_at between $1 and $2 ${where} group by 1 order by 1`,params)).rows;
  const hours=(await pool.query(`select extract(hour from se.occurred_at)::int as hour_value,count(*)::int streams from stream_events se join tracks t on t.id=se.track_id join releases r on r.id=t.primary_release_id where se.is_valid=true and se.occurred_at between $1 and $2 ${where} group by 1 order by streams desc`,params)).rows;
  return {from,to,totals:{validStreams:Number(totals.valid_streams||0),uniqueListeners:Number(totals.unique_listeners||0)},countries,cities,tracks,daily,peakHours:hours};
}

app.get('/api/artists/me/analytics', auth, artistOnly, async (req:AuthedRequest,res)=>{
  const artist=(await pool.query('select id,stage_name from artists where user_id=$1 limit 1',[req.user!.id])).rows[0];
  if(!artist) return res.status(404).json({error:'Perfil de artista não encontrado'});
  const range=dateRange(req); if(!range) return res.status(400).json({error:'Período inválido'});
  res.json({artist,analytics:await streamAnalytics(artist.id,range.from,range.to)});
});

app.get('/api/owner/dashboard', auth, adminOnly, async (req:AuthedRequest,res) => {
  if(req.user?.role!=='OWNER') return res.status(403).json({error:'Apenas o OWNER pode consultar o painel principal.'});
  try {
    const counts=(await pool.query(`select
      count(*)::int as total_users,
      count(*) filter(where role='ARTIST')::int as total_artists,
      count(*) filter(where role='LISTENER')::int as total_listeners,
      count(*) filter(where role='ADMIN')::int as total_admins
      from users`)).rows[0]||{};
    const recent=(await pool.query(`select r.id,r.title,r.type,r.status,r.cover_url,r.release_date,r.created_at,a.stage_name
      from releases r join artists a on a.id=r.primary_artist_id
      order by r.created_at desc limit 6`)).rows;
    const topArtists=(await pool.query(`select a.id,a.stage_name,count(se.id)::int streams
      from artists a
      left join releases r on r.primary_artist_id=a.id
      left join tracks t on t.primary_release_id=r.id
      left join stream_events se on se.track_id=t.id and se.is_valid=true
      group by a.id,a.stage_name order by streams desc,a.stage_name asc limit 5`)).rows;
    const pending=(await pool.query(`select count(*)::int as count from releases where status='PENDING_APPROVAL'`)).rows[0]||{};
    res.json({counts:{totalUsers:Number(counts.total_users||0),totalArtists:Number(counts.total_artists||0),totalListeners:Number(counts.total_listeners||0),totalAdmins:Number(counts.total_admins||0)},recent,recentPending:Number(pending.count||0),topArtists});
  } catch(e){ console.error(e); res.status(500).json({error:'Não foi possível carregar o painel do OWNER'}); }
});

app.get('/api/admin/analytics/streams', auth, requireAdminPermission('ANALYTICS'), async (req,res)=>{
  const range=dateRange(req); if(!range) return res.status(400).json({error:'Período inválido'});
  res.json({analytics:await streamAnalytics(null,range.from,range.to)});
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

app.get('/api/admin/finance/summary', auth, requireAdminPermission('FINANCE'), async (_req,res)=>{
  const q=await pool.query(`select
    (select count(*) from stream_events where is_valid=true)::int as valid_streams,
    coalesce((select sum(amount) from payment_transactions where status='PAID' and payment_method<>'WALLET'),0) as external_paid,
    coalesce((select sum(net_amount) from payment_transactions where status='PAID' and payment_method<>'WALLET'),0) as external_net,
    coalesce((select sum(amount) from payment_transactions where status='PENDING'),0) as pending_payments,
    coalesce((select sum(amount) from payment_transactions where status='REFUNDED'),0) as refunds,
    coalesce((select sum(case when entry_type='CREDIT' then amount when entry_type='DEBIT' then -amount else 0 end) from financial_ledger),0) as artist_royalty_balance,
    coalesce((select sum(w.amount) from withdrawals w where w.status='PAID'),0) as artist_payments_paid,
    coalesce((select sum(w.amount) from withdrawals w where w.status='PENDING'),0) as artist_payments_pending,
    coalesce((select sum(case when entry_type='CREDIT' then amount when entry_type='DEBIT' then -amount end) from owner_finance_ledger where account_code='ADVERTISING'),0) as advertising_balance,
    coalesce((select sum(amount) from owner_finance_transactions where transaction_type='AD_REVENUE' and status='PAID'),0) as advertising_revenue,
    coalesce((select sum(amount) from owner_finance_transactions where transaction_type='ADMIN_SALARY' and status in ('APPROVED','SENT_TO_BANK','PAID')),0) as payroll_total,
    coalesce((select sum(amount) from owner_finance_transactions where transaction_type='ARTIST_PAYOUT' and status in ('APPROVED','SENT_TO_BANK','PAID')),0) as owner_artist_payouts,
    coalesce((select sum(amount) from owner_finance_transactions where status='PENDING_APPROVAL'),0) as owner_pending_approvals`);
  const row=q.rows[0];
  const externalNet=Number(row.external_net||0),royalty=Number(row.artist_royalty_balance||0),advertising=Number(row.advertising_balance||0);
  res.json({currency:'AOA',balances:{
    streamBalance:{validStreams:Number(row.valid_streams||0)},
    artistPayments:{paid:Number(row.artist_payments_paid||0),pending:Number(row.artist_payments_pending||0)},
    artistRoyalties:royalty,pendingPayments:Number(row.pending_payments||0),refunds:Number(row.refunds||0),babuloRevenue:externalNet,
    advertisingRevenue:Number(row.advertising_revenue||0),advertisingBalance:advertising,payrollTotal:Number(row.payroll_total||0),ownerArtistPayouts:Number(row.owner_artist_payouts||0),ownerPendingApprovals:Number(row.owner_pending_approvals||0),
    netAfterArtistPayments:externalNet-Number(row.artist_payments_paid||0)-Number(row.payroll_total||0)
  },updatedAt:new Date().toISOString()});
});

// ===== V10.4.7 OWNER — CONTROLO FINANCEIRO CENTRAL =====
app.get('/api/owner/finance/overview', auth, ownerOnly, async (_req,res)=>{
  try{
    const [artists,admins,pending,ledger]=await Promise.all([
      pool.query(`select a.id,a.stage_name,a.country,a.city,u.id user_id,u.full_name,u.phone,
        coalesce((select sum(case when fl.entry_type='CREDIT' then fl.amount when fl.entry_type='DEBIT' then -fl.amount end) from financial_ledger fl where fl.artist_id=a.id),0) balance,
        coalesce((select sum(w.amount) from withdrawals w where w.artist_id=a.id and w.status in ('PAID','APPROVED')),0) paid_withdrawals,
        coalesce((select count(*) from stream_events se join tracks t on t.id=se.track_id join releases r on r.id=t.primary_release_id where r.primary_artist_id=a.id and se.is_valid=true),0) valid_streams
        from artists a left join users u on u.id=a.user_id order by balance desc,a.stage_name asc`),
      pool.query(`select id,full_name,phone,role,status,admin_title,salary_amount,salary_currency from users where role='ADMIN' and status='ACTIVE' order by full_name nulls last,created_at desc`),
      pool.query(`select count(*)::int count,coalesce(sum(amount),0) amount from owner_finance_transactions where status='PENDING_APPROVAL'`),
      pool.query(`select account_code,coalesce(sum(case when entry_type='CREDIT' then amount when entry_type='DEBIT' then -amount end),0) balance from owner_finance_ledger group by account_code order by account_code`)
    ]);
    res.json({artists:artists.rows,admins:admins.rows,pending:pending.rows[0]||{count:0,amount:0},accounts:ledger.rows});
  }catch(e){console.error(e);res.status(500).json({error:'Não foi possível carregar o centro financeiro do OWNER'});}
});

app.get('/api/owner/finance/transactions', auth, ownerOnly, async (_req,res)=>{
  try{const q=await pool.query(`select t.*,coalesce(a.stage_name,u.full_name,u2.full_name,'—') recipient_name from owner_finance_transactions t left join artists a on a.id=t.recipient_artist_id left join users u on u.id=a.user_id left join users u2 on u2.id=t.recipient_user_id order by t.created_at desc limit 200`);res.json({transactions:q.rows});}
  catch(e){console.error(e);res.status(500).json({error:'Não foi possível carregar o histórico financeiro'});}
});

app.post('/api/owner/finance/artist-payout', auth, ownerOnly, async (req:AuthedRequest,res)=>{
  const {artistId,amount,paymentMethod='BANK',destination,description='Pagamento de saldo ao artista'}=req.body||{}; const value=Number(amount);
  if(!artistId||!Number.isFinite(value)||value<=0) return res.status(400).json({error:'Informe artista e valor válidos'});
  if(!destination) return res.status(400).json({error:'Informe o destino bancário ou método de pagamento'});
  if(!['BANK','MULTICAIXA_EXPRESS'].includes(String(paymentMethod))) return res.status(400).json({error:'Método de pagamento inválido'});
  const client=await pool.connect();
  try{await client.query('begin');
    const artist=(await client.query(`select a.id,a.stage_name,a.user_id,coalesce((select sum(case when entry_type='CREDIT' then amount when entry_type='DEBIT' then -amount end) from financial_ledger where artist_id=a.id),0) balance from artists a where a.id=$1 for update`,[artistId])).rows[0];
    if(!artist){await client.query('rollback');return res.status(404).json({error:'Artista não encontrado'});} const bal=Number(artist.balance||0);
    if(value>bal){await client.query('rollback');return res.status(400).json({error:`Saldo insuficiente do artista. Disponível: ${bal.toFixed(2)} Kz.`});}
    const reference='BP-ART-'+crypto.randomBytes(6).toString('hex').toUpperCase();
    const tx=(await client.query(`insert into owner_finance_transactions(transaction_type,status,amount,payment_method,recipient_user_id,recipient_artist_id,destination,reference,description,created_by) values('ARTIST_PAYOUT','PENDING_APPROVAL',$1,$2,$3,$4,$5,$6,$7,$8) returning *`,[value,paymentMethod,artist.user_id,artist.id,String(destination),reference,String(description),req.user!.id])).rows[0];
    const after=bal-value; await client.query(`insert into financial_ledger(artist_id,entry_type,reference_type,reference_id,amount,currency,balance_after,description) values($1,'DEBIT','OWNER_PAYOUT',$2,$3,'AOA',$4,'Reserva para pagamento feito pelo OWNER')`,[artist.id,tx.id,value,after]);
    await client.query('commit'); await audit(req.user!.id,'OWNER_ARTIST_PAYOUT_CREATED','OWNER_FINANCE',tx.id,{artistId,amount:value,reference}); res.status(201).json({transaction:tx,artistBalance:after});
  }catch(e){await client.query('rollback');console.error(e);res.status(500).json({error:'Não foi possível criar o pagamento do artista'});}finally{client.release();}
});

app.post('/api/owner/finance/admin-salary', auth, ownerOnly, async (req:AuthedRequest,res)=>{
  const {adminUserId,amount,paymentMethod='BANK',destination,description='Salário / remuneração do funcionário'}=req.body||{}; const value=Number(amount);
  if(!adminUserId||!Number.isFinite(value)||value<=0) return res.status(400).json({error:'Informe funcionário e valor válidos'}); if(!destination) return res.status(400).json({error:'Informe o destino bancário ou método de pagamento'});
  const admin=(await pool.query(`select id,full_name,role,status from users where id=$1 and role='ADMIN'`,[adminUserId])).rows[0]; if(!admin) return res.status(404).json({error:'Administrador/funcionário não encontrado'});
  try{const reference='BP-SAL-'+crypto.randomBytes(6).toString('hex').toUpperCase(); const q=await pool.query(`insert into owner_finance_transactions(transaction_type,status,amount,payment_method,recipient_user_id,destination,reference,description,created_by) values('ADMIN_SALARY','PENDING_APPROVAL',$1,$2,$3,$4,$5,$6,$7) returning *`,[value,paymentMethod,admin.id,String(destination),reference,String(description),req.user!.id]); await audit(req.user!.id,'OWNER_ADMIN_SALARY_CREATED','OWNER_FINANCE',q.rows[0].id,{adminUserId,amount:value,reference}); res.status(201).json({transaction:q.rows[0]});}
  catch(e){console.error(e);res.status(500).json({error:'Não foi possível criar o pagamento do funcionário'});}
});

app.post('/api/owner/finance/advertising-revenue', auth, ownerOnly, async (req:AuthedRequest,res)=>{
  const {amount,description='Receita de publicidade',reference}=req.body||{}; const value=Number(amount); if(!Number.isFinite(value)||value<=0)return res.status(400).json({error:'Informe um valor válido'});
  const client=await pool.connect(); try{await client.query('begin'); const ref=String(reference||('BP-ADS-'+crypto.randomBytes(6).toString('hex').toUpperCase())); const tx=(await client.query(`insert into owner_finance_transactions(transaction_type,status,amount,payment_method,reference,description,created_by,approved_by,approved_at,executed_at) values('AD_REVENUE','PAID',$1,'BANK',$2,$3,$4,$4,now(),now()) returning *`,[value,ref,String(description),req.user!.id])).rows[0]; await client.query(`insert into owner_finance_ledger(account_code,entry_type,amount,reference_type,reference_id,description,created_by) values('ADVERTISING','CREDIT',$1,'AD_REVENUE',$2,$3,$4)`,[value,tx.id,String(description),req.user!.id]); await client.query('commit'); await audit(req.user!.id,'OWNER_AD_REVENUE_RECORDED','OWNER_FINANCE',tx.id,{amount:value,reference:ref}); res.status(201).json({transaction:tx}); }catch(e){await client.query('rollback');console.error(e);res.status(500).json({error:'Não foi possível registar a receita de publicidade'});}finally{client.release();}
});

app.post('/api/owner/finance/:id/decision', auth, ownerOnly, async (req:AuthedRequest,res)=>{
  const {decision,reason}=req.body||{}; if(!['APPROVED','REJECTED'].includes(decision))return res.status(400).json({error:'Decisão inválida'}); if(decision==='REJECTED'&&!String(reason||'').trim())return res.status(400).json({error:'Informe o motivo da rejeição'});
  const client=await pool.connect(); try{await client.query('begin'); const tx=(await client.query(`update owner_finance_transactions set status=$1,approved_by=$2,approved_at=case when $1='APPROVED' then now() else null end,rejection_reason=$3,updated_at=now() where id=$4 and status='PENDING_APPROVAL' returning *`,[decision==='APPROVED'?'APPROVED':'REJECTED',req.user!.id,reason||null,req.params.id])).rows[0]; if(!tx){await client.query('rollback');return res.status(404).json({error:'Operação pendente não encontrada'});} if(decision==='REJECTED'&&tx.transaction_type==='ARTIST_PAYOUT'&&tx.recipient_artist_id){const bal=Number((await client.query(`select coalesce(sum(case when entry_type='CREDIT' then amount when entry_type='DEBIT' then -amount end),0) balance from financial_ledger where artist_id=$1`,[tx.recipient_artist_id])).rows[0].balance||0);await client.query(`insert into financial_ledger(artist_id,entry_type,reference_type,reference_id,amount,currency,balance_after,description) values($1,'CREDIT','OWNER_PAYOUT',$2,$3,'AOA',$4,'Devolução da reserva de pagamento rejeitada pelo OWNER')`,[tx.recipient_artist_id,tx.id,tx.amount,bal+Number(tx.amount)]);} await client.query('commit'); await audit(req.user!.id,decision==='APPROVED'?'OWNER_FINANCE_APPROVED':'OWNER_FINANCE_REJECTED','OWNER_FINANCE',tx.id,{reason:reason||null,type:tx.transaction_type}); res.json({ok:true,transaction:tx}); }catch(e){await client.query('rollback');console.error(e);res.status(500).json({error:'Não foi possível guardar a decisão financeira'});}finally{client.release();}
});

app.post('/api/owner/finance/:id/execute', auth, ownerOnly, async (req:AuthedRequest,res)=>{
  const client=await pool.connect(); try{await client.query('begin'); const tx=(await client.query(`update owner_finance_transactions set status='SENT_TO_BANK',executed_at=now(),updated_at=now() where id=$1 and status='APPROVED' returning *`,[req.params.id])).rows[0]; if(!tx){await client.query('rollback');return res.status(404).json({error:'Operação aprovada não encontrada'});} if(tx.transaction_type==='AD_REVENUE'){await client.query('commit');return res.json({ok:true,transaction:tx});} if(tx.transaction_type==='ADMIN_SALARY'||tx.transaction_type==='ARTIST_PAYOUT'){await client.query(`insert into owner_finance_ledger(account_code,entry_type,amount,reference_type,reference_id,description,created_by) values('BANK','DEBIT',$1,'OWNER_FINANCE',$2,$3,$4)`,[tx.amount,tx.id,`Ordem bancária ${tx.reference}`,req.user!.id]);} await client.query('commit'); await audit(req.user!.id,'OWNER_FINANCE_SENT_TO_BANK','OWNER_FINANCE',tx.id,{reference:tx.reference}); res.json({ok:true,transaction:tx,message:'Ordem registada como enviada ao banco. A execução bancária real depende da integração com o banco/gateway.'}); }catch(e){await client.query('rollback');console.error(e);res.status(500).json({error:'Não foi possível registar o envio ao banco'});}finally{client.release();}
});

app.post('/api/owner/finance/:id/mark-paid', auth, ownerOnly, async (req:AuthedRequest,res)=>{
  const q=await pool.query(`update owner_finance_transactions set status='PAID',updated_at=now() where id=$1 and status in ('APPROVED','SENT_TO_BANK') returning *`,[req.params.id]); if(!q.rows[0])return res.status(404).json({error:'Operação aprovada/enviada não encontrada'}); await audit(req.user!.id,'OWNER_FINANCE_MARKED_PAID','OWNER_FINANCE',req.params.id,{}); res.json({ok:true,transaction:q.rows[0]});
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

app.get('/api/owner/finance/approvals', auth, ownerOnly, async (_req,res) => {
  try {
    const [payments,withdrawals,summary]=await Promise.all([
      pool.query(`select p.id,p.reference,p.amount,p.currency,p.payment_method,p.gateway,p.status,p.created_at,p.release_id,r.title release_title,a.stage_name,u.full_name from payment_transactions p left join releases r on r.id=p.release_id left join artists a on a.id=r.primary_artist_id left join users u on u.id=a.user_id where p.status='PENDING' order by p.created_at asc`),
      pool.query(`select w.id,w.amount,w.currency,w.method,w.destination,w.status,w.fee,w.net_amount,w.created_at,a.stage_name,u.full_name from withdrawals w join artists a on a.id=w.artist_id left join users u on u.id=a.user_id where w.status='PENDING' order by w.created_at asc`),
      pool.query(`select (select count(*) from payment_transactions where status='PENDING')::int pending_payment_count, coalesce((select sum(amount) from payment_transactions where status='PENDING'),0) pending_payment_amount, (select count(*) from withdrawals where status='PENDING')::int pending_withdrawal_count, coalesce((select sum(amount) from withdrawals where status='PENDING'),0) pending_withdrawal_amount`)
    ]);
    res.json({payments:payments.rows,withdrawals:withdrawals.rows,summary:summary.rows[0]||{}});
  } catch(e){ console.error(e); res.status(500).json({error:'Não foi possível carregar as aprovações financeiras'}); }
});

app.get('/api/admin/withdrawals', auth, adminOnly, async (_req,res) => {
  const q=await pool.query(`select w.*,a.stage_name,u.email from withdrawals w join artists a on a.id=w.artist_id left join users u on u.id=a.user_id order by w.created_at desc`);
  res.json({withdrawals:q.rows});
});

app.post('/api/admin/withdrawals/:id/decision', auth, ownerOnly, async (req:AuthedRequest,res) => {
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




// V10.4.7 — Owner Advertising / BaBuLo Ads
app.get('/api/owner/ads/overview', auth, ownerOnly, async (_req,res)=>{
  const [summary,campaigns,placements]=await Promise.all([
    pool.query(`select count(*) filter(where status='ACTIVE')::int active_campaigns,count(*) filter(where status in ('PENDING_PAYMENT','PENDING_APPROVAL'))::int pending_campaigns,coalesce(sum(budget) filter(where payment_status='PAID'),0) paid_budget,coalesce(sum(spend),0) spend,coalesce(sum(impressions),0)::bigint impressions,coalesce(sum(clicks),0)::bigint clicks,coalesce(sum(video_views),0)::bigint video_views from ad_campaigns`),
    pool.query(`select c.*,coalesce(cr.name,'Sem criativo') creative_name from ad_campaigns c left join lateral (select name from ad_creatives where campaign_id=c.id order by created_at desc limit 1) cr on true order by c.created_at desc limit 100`),
    pool.query(`select * from ad_placements order by active desc,sort_order,name`)
  ]);
  res.json({summary:summary.rows[0],campaigns:campaigns.rows,placements:placements.rows});
});
app.get('/api/owner/ads/pricing', auth, ownerOnly, async (_req,res)=>res.json({pricing:(await pool.query('select * from ad_pricing order by active desc,sort_order,name')).rows}));
app.post('/api/owner/ads/placements/:id/toggle', auth, ownerOnly, async(req:AuthedRequest,res)=>{const q=await pool.query(`update ad_placements set active=not active where id=$1 returning *`,[req.params.id]);if(!q.rows[0])return res.status(404).json({error:'Espaço publicitário não encontrado'});await audit(req.user!.id,'AD_PLACEMENT_TOGGLE','AD_PLACEMENT',req.params.id,{active:q.rows[0].active});res.json({placement:q.rows[0]})});
app.post('/api/owner/ads/pricing', auth, ownerOnly, async (req:AuthedRequest,res)=>{
  const {id,name,format,pricingModel,price,currency='AOA',unit='CAMPAIGN',active=true}=req.body||{};
  if(!name||!format||!['FIXED','CPM','CPC','CPV'].includes(pricingModel)||Number(price)<=0)return res.status(400).json({error:'Preencha nome, formato, modelo e preço válido.'});
  const q=id?await pool.query(`update ad_pricing set name=$1,format=$2,pricing_model=$3,price=$4,currency=$5,unit=$6,active=$7,updated_at=now() where id=$8 returning *`,[String(name).trim(),format,pricingModel,Number(price),currency,unit,Boolean(active),id]):await pool.query(`insert into ad_pricing(name,format,pricing_model,price,currency,unit,active) values($1,$2,$3,$4,$5,$6,$7) returning *`,[String(name).trim(),format,pricingModel,Number(price),currency,unit,Boolean(active)]);
  await audit(req.user!.id,id?'AD_PRICING_UPDATED':'AD_PRICING_CREATED','AD_PRICING',q.rows[0].id,{name,format,pricingModel,price}); res.status(201).json({pricing:q.rows[0]});
});
app.post('/api/owner/ads/campaigns', auth, ownerOnly, async (req:AuthedRequest,res)=>{
  const {id,name,advertiserName,contactEmail,format,pricingModel='FIXED',budget,currency='AOA',startAt,endAt,targetCountry='',targetCity='',targetAudience='FREE_USERS',destinationUrl='',creativeUrl='',creativeName='',headline='',bodyText='',cta='Saiba mais',paymentReference=''}=req.body||{};
  if(!name||!advertiserName||!format||Number(budget)<=0||!startAt||!endAt)return res.status(400).json({error:'Nome, anunciante, formato, orçamento e período são obrigatórios.'});
  if(new Date(endAt)<=new Date(startAt))return res.status(400).json({error:'A data final deve ser posterior à inicial.'});
  const client=await pool.connect(); try{await client.query('begin');
    let campaign;
    if(id){campaign=(await client.query(`update ad_campaigns set name=$1,advertiser_name=$2,contact_email=$3,format=$4,pricing_model=$5,budget=$6,currency=$7,start_at=$8,end_at=$9,target_country=$10,target_city=$11,target_audience=$12,destination_url=$13,payment_reference=$14,updated_at=now() where id=$15 returning *`,[String(name).trim(),String(advertiserName).trim(),contactEmail||null,format,pricingModel,Number(budget),currency,startAt,endAt,targetCountry||null,targetCity||null,targetAudience,destinationUrl||null,paymentReference||null,id])).rows[0]; if(!campaign)throw Error('Campanha não encontrada');}
    else campaign=(await client.query(`insert into ad_campaigns(name,advertiser_name,contact_email,format,pricing_model,budget,currency,start_at,end_at,target_country,target_city,target_audience,destination_url,payment_reference,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`,[String(name).trim(),String(advertiserName).trim(),contactEmail||null,format,pricingModel,Number(budget),currency,startAt,endAt,targetCountry||null,targetCity||null,targetAudience,destinationUrl||null,paymentReference||null,req.user!.id])).rows[0];
    if(creativeUrl){await client.query(`insert into ad_creatives(campaign_id,name,format,asset_url,headline,body_text,cta,destination_url) values($1,$2,$3,$4,$5,$6,$7,$8)`,[campaign.id,creativeName||`${name} — criativo`,format,creativeUrl,headline||null,bodyText||null,cta||null,destinationUrl||null]);}
    await client.query('commit'); await audit(req.user!.id,id?'AD_CAMPAIGN_UPDATED':'AD_CAMPAIGN_CREATED','AD_CAMPAIGN',campaign.id,{advertiserName,format,budget}); res.status(201).json({campaign});
  }catch(e:any){await client.query('rollback');res.status(400).json({error:e.message||'Não foi possível guardar a campanha'});}finally{client.release()}
});
app.post('/api/owner/ads/campaigns/:id/payment', auth, ownerOnly, async(req:AuthedRequest,res)=>{const {status='PAID',reference=''}=req.body||{}; if(!['PENDING','PAID','REFUNDED'].includes(status))return res.status(400).json({error:'Estado de pagamento inválido'}); const q=await pool.query(`update ad_campaigns set payment_status=$1,payment_reference=coalesce(nullif($2,''),payment_reference),paid_at=case when $1='PAID' then coalesce(paid_at,now()) else paid_at end,updated_at=now() where id=$3 returning *`,[status,reference,req.params.id]); if(!q.rows[0])return res.status(404).json({error:'Campanha não encontrada'}); await audit(req.user!.id,'AD_CAMPAIGN_PAYMENT','AD_CAMPAIGN',req.params.id,{status,reference});res.json({campaign:q.rows[0]})});
app.post('/api/owner/ads/campaigns/:id/status', auth, ownerOnly, async(req:AuthedRequest,res)=>{const {status,reason=''}=req.body||{}; if(!['DRAFT','PENDING_PAYMENT','PENDING_APPROVAL','ACTIVE','PAUSED','COMPLETED','REJECTED','CANCELLED'].includes(status))return res.status(400).json({error:'Estado inválido'}); const q=await pool.query(`update ad_campaigns set status=$1,rejection_reason=$2,updated_at=now() where id=$3 returning *`,[status,reason||null,req.params.id]);if(!q.rows[0])return res.status(404).json({error:'Campanha não encontrada'});await audit(req.user!.id,'AD_CAMPAIGN_STATUS','AD_CAMPAIGN',req.params.id,{status,reason});res.json({campaign:q.rows[0]})});
app.post('/api/owner/ads/campaigns/:id/creative', auth, ownerOnly, async(req:AuthedRequest,res)=>{const {name,format,assetUrl,headline='',bodyText='',cta='Saiba mais',destinationUrl=''}=req.body||{};if(!name||!format||!assetUrl)return res.status(400).json({error:'Nome, formato e URL do criativo são obrigatórios'});const q=await pool.query(`insert into ad_creatives(campaign_id,name,format,asset_url,headline,body_text,cta,destination_url) values($1,$2,$3,$4,$5,$6,$7,$8) returning *`,[req.params.id,name,format,assetUrl,headline||null,bodyText||null,cta||null,destinationUrl||null]);res.status(201).json({creative:q.rows[0]})});
app.get('/api/owner/ads/reports', auth, ownerOnly, async(req,res)=>{const from=req.query.from||new Date(Date.now()-29*86400000).toISOString().slice(0,10),to=req.query.to||new Date().toISOString().slice(0,10);const q=await pool.query(`select c.id,c.name,c.advertiser_name,c.format,c.status,c.budget,c.spend,c.impressions,c.clicks,c.video_views,case when c.impressions>0 then round(c.clicks::numeric*100/c.impressions,2) else 0 end ctr,coalesce(sum(e.value),0) event_value from ad_campaigns c left join ad_events e on e.campaign_id=c.id and e.created_at>=($1::date) and e.created_at<($2::date+interval '1 day') where c.created_at<($2::date+interval '1 day') group by c.id order by c.created_at desc`,[from,to]);res.json({from,to,reports:q.rows})});

// API de entrega de anúncios — mesma API para Web, Android e iPhone.
app.get('/api/ads/serve', async(req,res)=>{
  const placement=String(req.query.placement||'HOME_BANNER'); const country=String(req.query.country||req.headers['cf-ipcountry']||req.headers['x-country']||'').toUpperCase(); const city=String(req.query.city||req.headers['cf-ipcity']||req.headers['x-city']||'');
  const token=String(req.headers.authorization||'').startsWith('Bearer ')?String(req.headers.authorization).slice(7):''; let userId=null; let premium=false;
  if(token){try{const d=decodeToken(token);if(d?.sid){const u=(await pool.query(`select id from users where id=$1 and status='ACTIVE'`,[d.sub])).rows[0];if(u){userId=u.id;premium=Boolean((await pool.query(`select 1 from subscriptions where user_id=$1 and status='ACTIVE' and ends_at>now() limit 1`,[u.id])).rows[0]);}}}catch{}}
  if(premium)return res.json({ad:null,premium:true});
  const q=await pool.query(`select c.id,c.name,c.advertiser_name,c.format,c.pricing_model,c.destination_url,c.target_country,c.target_city,c.target_audience,cr.id creative_id,cr.name creative_name,cr.asset_url,cr.headline,cr.body_text,cr.cta,cr.destination_url creative_destination from ad_campaigns c join lateral (select * from ad_creatives where campaign_id=c.id order by created_at desc limit 1) cr on true where c.status='ACTIVE' and c.payment_status='PAID' and now() between c.start_at and c.end_at and c.format=$1 and (c.target_country is null or c.target_country='' or upper(c.target_country)=$2) and (c.target_city is null or c.target_city='' or lower(c.target_city)=lower($3)) and (c.target_audience='ALL' or c.target_audience='FREE_USERS') order by random() limit 1`,[placement,country,city]);
  if(!q.rows[0])return res.json({ad:null,premium:false}); const a=q.rows[0]; await pool.query(`update ad_campaigns set impressions=impressions+1,updated_at=now() where id=$1`,[a.id]); await pool.query(`insert into ad_events(campaign_id,creative_id,event_type,user_id,country,city,visitor_key) values($1,$2,'IMPRESSION',$3,$4,$5,$6)`,[a.id,a.creative_id,userId,country||null,city||null,hashToken(userId||`${req.headers['user-agent']||''}|${country}|${city}`)]); res.json({ad:{id:a.id,creativeId:a.creative_id,format:a.format,assetUrl:a.asset_url,headline:a.headline,bodyText:a.body_text,cta:a.cta,destinationUrl:a.creative_destination||a.destination_url,advertiserName:a.advertiser_name},premium:false});
});
app.post('/api/ads/event', async(req,res)=>{const {campaignId,creativeId,eventType,value=0,country='',city='',visitorKey=''}=req.body||{};if(!campaignId||!['CLICK','VIDEO_VIEW','INTERACTION'].includes(eventType))return res.status(400).json({error:'Evento publicitário inválido'});const key=String(visitorKey||`${req.headers['user-agent']||''}|${country}|${city}`).slice(0,500);const q=await pool.query(`select id,pricing_model from ad_campaigns where id=$1 and status='ACTIVE'`,[campaignId]);if(!q.rows[0])return res.status(404).json({error:'Campanha não encontrada'});const c=q.rows[0];await pool.query(`insert into ad_events(campaign_id,creative_id,event_type,value,country,city,visitor_key) values($1,$2,$3,$4,$5,$6,$7)`,[campaignId,creativeId||null,eventType,Number(value)||0,country||null,city||null,hashToken(key)]);const field=eventType==='CLICK'?'clicks':eventType==='VIDEO_VIEW'?'video_views':null;if(field)await pool.query(`update ad_campaigns set ${field}=${field}+1,updated_at=now() where id=$1`,[campaignId]);res.json({ok:true})});


// Garantir que erros inesperados da API nunca chegam ao frontend como HTML.
// Isto evita o erro "Unexpected token '<', '<!DOCTYPE'..." e permite mostrar a causa real.
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled API error:', err);
  if (res.headersSent) return;
  res.status(Number(err?.statusCode || err?.status || 500)).json({
    error: err?.message || 'Erro interno do servidor.',
    code: err?.code || undefined
  });
});

ensureDatabaseSchema()
  .then(() => bootstrapFirstOwner())
  .then(() => app.listen(port,()=>console.log(`BaBuLo API running on :${port}`)))
  .catch(() => process.exit(1));
