'use client';
import { useEffect, useMemo, useRef, useState } from 'react';

type Track={id:string;title:string;artist:string;genre:string;coverUrl:string|null;audioUrl?:string};
type Release={id:string;title:string;type:string;cover_url?:string|null;status?:string};
const API=process.env.NEXT_PUBLIC_API_URL||'http://localhost:4000';
const img={logo:'/media/babulo-play-logo.jpg',cover:'/media/amanha-de-manha.jpeg',face:'/media/young-black-baby-portrait.jpeg',main:'/media/young-black-baby-main.jpg',live:'/media/young-black-baby-live.jpeg'};
const demoTracks:Track[]=[
 {id:'1',title:'Amanhã De Manhã',artist:'Young Black Baby',genre:'Rap / Hip-Hop',coverUrl:img.cover,audioUrl:'/media/amanha-de-manha.mp3'},
 {id:'2',title:'Café',artist:'Young Black Baby',genre:'Rap / Hip-Hop',coverUrl:img.live,audioUrl:'/media/cafe.mp3'},
 {id:'3',title:'Amanhã De Manhã — Remix',artist:'Young Black Baby',genre:'Afro Rap',coverUrl:img.cover},
 {id:'4',title:'Young Black Baby',artist:'Young Black Baby',genre:'Artista em destaque',coverUrl:img.face},
];
const nav=['Início','Explorar','Biblioteca','Playlists','Artistas','Álbuns','Géneros','Premium'];
const releaseTypes=[['SINGLE','Single'],['EP','EP'],['ALBUM','Álbum'],['ALBUM_PRO','Álbum Pro']];
export default function Home(){
 const [tracks,setTracks]=useState<Track[]>(demoTracks),[current,setCurrent]=useState<Track|null>(null),[query,setQuery]=useState(''),[playing,setPlaying]=useState(false),[menu,setMenu]=useState('Início');
 const [authOpen,setAuthOpen]=useState(false),[authMode,setAuthMode]=useState<'login'|'register'>('login'),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[stageName,setStageName]=useState(''),[accountRole,setAccountRole]=useState<'LISTENER'|'ARTIST'>('LISTENER'),[authMsg,setAuthMsg]=useState('');
 const [token,setToken]=useState<string|null>(null),[me,setMe]=useState<any>(null),[dashboard,setDashboard]=useState(false);
 const [sessionReady,setSessionReady]=useState(false);
 const ARTIST_IDLE_LIMIT_MS=30*60*1000;
 const lastActivityWriteRef=useRef(0);

 // Sessão da área de trabalho do artista: encerra após 30 minutos sem atividade.
 useEffect(()=>{
  const role=me?.user?.role||me?.role;
  if(!token||role!=='ARTIST')return;
  const now=Date.now();
  const stored=Number(localStorage.getItem('babulo_artist_last_activity')||0);
  if(stored && now-stored>=ARTIST_IDLE_LIMIT_MS){
   logout();
   alert('A sessão da área do artista terminou por inatividade durante mais de 30 minutos.');
   return;
  }
  if(!stored)localStorage.setItem('babulo_artist_last_activity',String(now));
  let timer:number|null=null;
  let heartbeat:number|null=null;
  const check=()=>{
   const last=Number(localStorage.getItem('babulo_artist_last_activity')||Date.now());
   const remaining=ARTIST_IDLE_LIMIT_MS-(Date.now()-last);
   if(remaining<=0){
    logout();
    alert('A sessão da área do artista terminou por inatividade durante mais de 30 minutos.');
    return;
   }
   if(timer)clearTimeout(timer);
   timer=window.setTimeout(check,Math.min(remaining,30000));
  };
  const touch=()=>{
   const t=Date.now();
   if(t-lastActivityWriteRef.current<60000)return;
   lastActivityWriteRef.current=t;
   localStorage.setItem('babulo_artist_last_activity',String(t));
   fetch(API+'/api/auth/activity',{method:'POST',headers:{Authorization:`Bearer ${token}`}}).catch(()=>{});
   check();
  };
  const events=['pointerdown','keydown','scroll','touchstart','mousemove'];
  events.forEach(ev=>window.addEventListener(ev,touch,{passive:true}));
  heartbeat=window.setInterval(()=>{
   const last=Number(localStorage.getItem('babulo_artist_last_activity')||0);
   if(last && Date.now()-last<120000) fetch(API+'/api/auth/activity',{method:'POST',headers:{Authorization:`Bearer ${token}`}}).catch(()=>{});
   check();
  },60000);
  check();
  return()=>{events.forEach(ev=>window.removeEventListener(ev,touch));if(timer)clearTimeout(timer);if(heartbeat)clearInterval(heartbeat)};
 },[token,me]);

 const [releases,setReleases]=useState<Release[]>([]);
 const draftReleases=useMemo(()=>releases.filter(r=>['DRAFT','FAILED','PENDING_APPROVAL'].includes(String(r.status||'DRAFT'))),[releases]);
const [releaseOpen,setReleaseOpen]=useState(false);
const [editingReleaseId,setEditingReleaseId]=useState<string|null>(null);
const [releaseMsg,setReleaseMsg]=useState('');
const [distOpen,setDistOpen]=useState(false);
 
 const audioRef=useRef<HTMLAudioElement|null>(null);
 useEffect(()=>{
  let cancelled=false;
  const saved=localStorage.getItem('babulo_token');
  const savedDashboard=localStorage.getItem('babulo_dashboard')==='1';
  if(!saved){setSessionReady(true);return;}
  setToken(saved);
  fetch(API+'/api/auth/me',{headers:{Authorization:`Bearer ${saved}`}})
   .then(async r=>{if(!r.ok){const e:any=Error(r.status===401?'Sessão expirada':'Não foi possível validar a sessão');e.status=r.status;throw e;} return r.json();})
   .then(async data=>{
    if(cancelled)return;
    setMe(data);
    localStorage.setItem('babulo_profile',JSON.stringify(data));
    setDashboard(savedDashboard);
    setSessionReady(true);
   })
   .catch((err:any)=>{
    if(cancelled)return;
    if(err?.status===401){
      localStorage.removeItem('babulo_token');
      localStorage.removeItem('babulo_dashboard');
      localStorage.removeItem('babulo_profile');
      localStorage.removeItem('babulo_artist_last_activity');
      setToken(null);setMe(null);setDashboard(false);setSessionReady(true);
      return;
    }
    const cached=localStorage.getItem('babulo_profile');
    if(cached){try{const profile=JSON.parse(cached);setMe(profile);setToken(saved);setDashboard(savedDashboard);setSessionReady(true);return;}catch{}}
    setToken(saved);
    setDashboard(savedDashboard);
    setSessionReady(true);
   });
  return()=>{cancelled=true};
 },[]);
 useEffect(()=>{if(token&&isArtist)loadReleases()},[token]);
 
 const [currentTime,setCurrentTime]=useState(0);
const [duration,setDuration]=useState(0);
const [audioError,setAudioError]=useState('');
 const [volume,setVolume]=useState(1);
 
 useEffect(()=>{
  if(audioRef.current){
    audioRef.current.volume=volume;
  }
},[volume]);
 
useEffect(()=>{
  const audio=audioRef.current;

  if(!audio)return;

  // Para sempre a música anterior
  audio.pause();

  setPlaying(false);
  setCurrentTime(0);
  setDuration(0);
  setAudioError('');

  // Se a nova faixa não tiver áudio, limpa o player
  if(!current?.audioUrl){
    audio.removeAttribute('src');
    audio.load();
    return;
  }

  // Carrega a nova faixa
  audio.src=current.audioUrl;
  audio.currentTime=0;
  audio.load();

  // Reproduz automaticamente
  audio.play()
    .then(()=>{
      setPlaying(true);
    })
    .catch(()=>{
      setPlaying(false);
      setAudioError('Clique em ▶ para reproduzir.');
    });

},[current]);
 
 const filtered=useMemo(()=>tracks.filter(t=>`${t.title} ${t.artist} ${t.genre}`.toLowerCase().includes(query.toLowerCase())),[tracks,query]);
 function play(t:Track){
  setCurrent(t);
  setPlaying(false);
  setCurrentTime(0);
  setAudioError('');
}
 function togglePlay(){
  if(!audioRef.current||!current?.audioUrl)return;
  if(audioRef.current.paused){
    audioRef.current.play()
      .then(()=>setPlaying(true))
      .catch(()=>setAudioError('Não foi possível reproduzir o áudio.'));
  }else{
    audioRef.current.pause();
    setPlaying(false);
  }
}

function previousTrack(){
  if(!current || tracks.length===0)return;

  const index=tracks.findIndex(t=>t.id===current.id);

  for(let i=index-1;i>=0;i--){
    if(tracks[i].audioUrl){
      setCurrent(tracks[i]);
      return;
    }
  }
}

function nextTrack(){
  if(!current || tracks.length===0)return;

  const index=tracks.findIndex(t=>t.id===current.id);

  for(let i=index+1;i<tracks.length;i++){
    if(tracks[i].audioUrl){
      setCurrent(tracks[i]);
      return;
    }
  }
}
 
function formatTime(value:number){
  if(!Number.isFinite(value))return '0:00';
  const minutes=Math.floor(value/60);
  const seconds=Math.floor(value%60).toString().padStart(2,'0');
  return `${minutes}:${seconds}`;
}
 function seek(value:number){
  if(!audioRef.current)return;

  audioRef.current.currentTime=value;
  setCurrentTime(value);
}
 
 async function submitAuth(e:React.FormEvent){e.preventDefault();setAuthMsg(''); const url=authMode==='login'?'/api/auth/login':'/api/auth/register'; const body=authMode==='login'?{email,password}:{email,password,role:accountRole,stageName:accountRole==='ARTIST'?stageName:undefined}; try{const r=await fetch(API+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||'Não foi possível continuar');localStorage.setItem('babulo_token',d.token);setToken(d.token);const mr=await fetch(API+'/api/auth/me',{headers:{Authorization:`Bearer ${d.token}`}});const profile=mr.ok?await mr.json():d;setMe(profile);localStorage.setItem('babulo_profile',JSON.stringify(profile));const artist=profile?.user?.role==='ARTIST'||profile?.role==='ARTIST';if(artist)localStorage.setItem('babulo_artist_last_activity',String(Date.now()));else localStorage.removeItem('babulo_artist_last_activity');setDashboard(Boolean(artist));localStorage.setItem('babulo_dashboard',artist?'1':'0');setAuthOpen(false);setAuthMsg('');}catch(err:any){setAuthMsg(err.message)}}
 function logout(){const currentToken=localStorage.getItem('babulo_token');if(currentToken)fetch(API+'/api/auth/logout',{method:'POST',headers:{Authorization:`Bearer ${currentToken}`}}).catch(()=>{});localStorage.removeItem('babulo_token');localStorage.removeItem('babulo_dashboard');localStorage.removeItem('babulo_profile');localStorage.removeItem('babulo_artist_last_activity');setToken(null);setMe(null);setDashboard(false);setReleases([])}
 async function loadReleases(){if(!token)return;const r=await fetch(API+'/api/artists/me/releases',{headers:{Authorization:`Bearer ${token}`}});const d=await r.json();if(r.ok)setReleases(d.releases||[])}
 const role=me?.user?.role||me?.role||'';
 const isArtist=role==='ARTIST';
 const isAdmin=role==='ADMIN'||role==='OWNER';
 if(!sessionReady)return <main className="app"><section className="content"><div className="authModal" style={{margin:'12vh auto',maxWidth:520,textAlign:'center'}}><img src={img.logo} alt="BaBuLo Play" style={{width:140}}/><h2>A restaurar a tua sessão…</h2><p>Não é necessário fazer login novamente.</p></div></section></main>;
 if(token&&isArtist)return <ArtistWorkspace token={token} me={me} onLogout={logout}/>;
 if(token&&isAdmin)return <AdminWorkspace token={token} me={me} onLogout={logout}/>;
 return <main className="app">
  <aside className="sidebar"><div className="logoWrap"><img src={img.logo} alt="BaBuLo Play"/></div><div className="navGroup">{nav.map((n,i)=><button key={n} className={menu===n?'active':''} onClick={()=>setMenu(n)}><span>{['⌂','◉','▣','♫','♙','◉','♬','★'][i]}</span>{n}</button>)}</div><div className="library"><p>SUA BIBLIOTECA</p><button>♡ Músicas Curtidas</button><button>⇩ Downloads</button><button>◷ Histórico</button></div><div className="sidePremium"><img src={img.logo} alt=""/><b>BaBuLo Premium</b><span>Mais música. Menos anúncios.</span><button>Conhecer Premium</button></div></aside>
  <section className="content"><header className="topbar"><div className="mobileBrand"><img src={img.logo} alt="BaBuLo Play"/></div><div className="search"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Pesquisar artistas, músicas, álbuns, playlists..."/></div><button className="bell">♧</button>{token?<div className="profile clickable" onClick={()=>{const next=!dashboard;setDashboard(next);localStorage.setItem('babulo_dashboard',next?'1':'0');if(next&&isArtist)loadReleases()}}><img src={img.face} alt="Perfil"/><div><b>{me?.user?.email||'Minha conta'}</b><small>{isArtist?'Artista':'Ouvinte'}</small></div><span>⌄</span></div>:<button className="loginTop" onClick={()=>{setAuthMode('login');setAuthOpen(true)}}>Entrar</button>}</header>
   {dashboard&&token&&<section className="dashboard"><div><small>ÁREA AUTENTICADA</small><h2>{isArtist?'Painel do Artista':'Minha conta'}</h2><p>{isArtist?'Prepara, valida e envia os teus lançamentos para a equipa BaBuLo.':'A tua conta de ouvinte está ligada ao backend.'}</p>{isArtist&&<><button className="primary" onClick={()=>{setEditingReleaseId(null);setReleaseOpen(true);setReleaseMsg('')}}>＋ Novo lançamento</button><button className="outline" onClick={()=>setDistOpen(true)}>⇧ Distribuição</button></>}</div>{isArtist&&<><div className="releaseList"><h3>📝 Rascunhos e pendentes</h3>{draftReleases.length?<div>{draftReleases.map(r=><div className="releaseRow draftRow" key={r.id} onClick={()=>{setEditingReleaseId(r.id);setReleaseOpen(true);setReleaseMsg('')}} style={{cursor:'pointer'}}><span><b>{r.title||'Sem título'}</b><small>{r.type} · {r.status||'DRAFT'}</small><em>Clicar para continuar →</em></span><button type="button" className="outline danger smallDanger" onClick={async(e)=>{e.stopPropagation();if(!confirm(`Eliminar o lançamento “${r.title||'Sem título'}” e todas as suas faixas?`))return;try{const rr=await fetch(API+`/api/releases/${r.id}`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`}});const dd=await rr.json();if(!rr.ok)throw Error(dd.error||'Não foi possível eliminar o lançamento');setReleases(v=>v.filter(x=>x.id!==r.id));setReleaseMsg('');}catch(e:any){setReleaseMsg(e.message)}}}>🗑️ Eliminar álbum</button></div>)}</div>:<p>Nenhum lançamento pendente.</p>}</div><div className="releaseList"><h3>Os meus lançamentos</h3>{releases.length?<div>{releases.map(r=><div className="releaseRow" key={r.id}><span>{r.title}</span><small>{r.type} · {r.status||'DRAFT'}</small></div>)}</div>:<p>Nenhum lançamento criado ainda.</p>}</div></>}<button className="outline" onClick={logout}>Sair</button></section>}
   <section className="hero"><div className="heroText"><small>ARTISTA EM DESTAQUE</small><h1>Young<br/><em>Black Baby</em></h1><p>Música • atitude • realidade</p><div className="heroActions"><button className="primary" onClick={()=>play(demoTracks[0])}>▶ Ouvir agora</button><button className="outline">＋ Minha biblioteca</button></div></div><div className="heroImage"><img src={img.main} alt="Young Black Baby" /></div><div className="heroTracks"><h3>Músicas em destaque</h3>{demoTracks.map((t,i)=><button key={t.id} onClick={()=>play(t)}><b>{i+1}</b><img src={t.coverUrl||img.cover} alt=""/><span><strong>{t.title}</strong><small>{t.artist}</small></span><i>{current?.id===t.id&&playing?'Ⅱ':'▶'}</i></button>)}</div></section>
   <SectionTitle title="Lançamentos recentes"/><div className="cards">{filtered.map(t=><button className="card" key={t.id} onClick={()=>play(t)}><div className="cardImg"><img src={t.coverUrl || img.cover} alt="" /><span>▶</span></div><strong>{t.title}</strong><small>{t.artist}</small></button>)}</div>
   <section className="platformBanner"><img src={img.main} alt="BaBuLo Play"/><div><small>A TUA PLATAFORMA MUSICAL</small><h2>A música africana<br/>tem uma nova casa.</h2><p>Ouve, descobre, apoia artistas e promove os teus lançamentos.</p><button className="primary">Explorar BaBuLo Play</button></div></section>
   <SectionTitle title="Artista propaganda" link="Ver artista →"/><section className="artistPromo"><div className="artistPhoto"><img src={img.live} alt="Young Black Baby em atuação"/></div><div><small>ARTISTA EM DESTAQUE</small><h2>Young Black Baby</h2><p>Uma apresentação baseada nas imagens reais fornecidas para a plataforma.</p><button className="outline">Ver perfil do artista</button></div><img className="release" src={img.cover} alt="Amanhã De Manhã"/></section><footer>© 2026 BaBuLo Play · Streaming · Distribuição · Promoção · Publicidade</footer></section>
  {current&&<div className="player">
  <img src={current.coverUrl||img.cover} alt=""/>
  <div className="now">
    <b>{current.title}</b>
    <small>{current.artist}</small>
  </div>

<button
  onClick={previousTrack}
  disabled={!current || tracks.findIndex(t=>t.id===current.id)<=0}
  title="Música anterior"
>
  ⏮
</button>

<button
  onClick={togglePlay}
  disabled={!current.audioUrl}
  title={playing ? 'Pausar' : 'Reproduzir'}
>
  {playing ? 'Ⅱ' : '▶'}
</button>

<button
  onClick={nextTrack}
  disabled={!current || tracks.findIndex(t=>t.id===current.id)>=tracks.length-1}
  title="Próxima música"
>
  ⏭
</button>
    
  <input
  className="progress"
  type="range"
  min="0"
  max={duration || 0}
  step="0.1"
  value={currentTime}
  onChange={(e)=>seek(Number(e.target.value))}
  disabled={!duration}
/>
  <small>{formatTime(currentTime)} / {formatTime(duration)}</small>
  <div className="volumeControl">
  <button onClick={()=>setVolume(v=>Math.max(0,v-0.1))}>−</button>

  <input
    type="range"
    min="0"
    max="1"
    step="0.05"
    value={volume}
    onChange={e=>setVolume(Number(e.target.value))}
  />

  <button onClick={()=>setVolume(v=>Math.min(1,v+0.1))}>+</button>
</div>

  <button onClick={()=>{
    if(audioRef.current) audioRef.current.pause();
    setPlaying(false);
    setCurrent(null);
  }}>✕</button>
</div>}
  
  <audio
  ref={audioRef}
  preload="metadata"
  onLoadedMetadata={e=>setDuration(e.currentTarget.duration)}
  onTimeUpdate={e=>setCurrentTime(e.currentTarget.currentTime)}
  onPlay={()=>setPlaying(true)}
  onPause={()=>setPlaying(false)}
  onEnded={()=>{
  setPlaying(false);
  setCurrentTime(0);

  if(!current || tracks.length===0)return;

  const index=tracks.findIndex(t=>t.id===current.id);

  for(let i=index+1;i<tracks.length;i++){
    if(tracks[i].audioUrl){
      setCurrent(tracks[i]);
      return;
    }
  }
}}
  onError={()=>setAudioError('Não foi possível carregar o áudio.')}
/>
  
  {distOpen&&token&&<DistributionPanel token={token} releases={releases} onClose={()=>setDistOpen(false)}/>}{releaseOpen&&token&&<ReleaseWizard token={token} editReleaseId={editingReleaseId} onClose={()=>{setReleaseOpen(false);setEditingReleaseId(null)}} onDone={()=>{setReleaseOpen(false);setEditingReleaseId(null);loadReleases()}}/>}
  {authOpen&&<div className="modalBackdrop" onMouseDown={()=>setAuthOpen(false)}><div className="authModal" onMouseDown={e=>e.stopPropagation()}><button className="modalClose" onClick={()=>setAuthOpen(false)}>✕</button><img src={img.logo} alt="BaBuLo Play"/><h2>{authMode==='login'?'Entrar na BaBuLo Play':'Criar conta'}</h2><form onSubmit={submitAuth}>{authMode==='register'&&<><div className="roleSwitch"><button type="button" className={accountRole==='LISTENER'?'selected':''} onClick={()=>setAccountRole('LISTENER')}>Ouvinte</button><button type="button" className={accountRole==='ARTIST'?'selected':''} onClick={()=>setAccountRole('ARTIST')}>Artista</button></div>{accountRole==='ARTIST'&&<input value={stageName} onChange={e=>setStageName(e.target.value)} placeholder="Nome artístico" required/>}</>}<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email" required/><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Palavra-passe (mín. 8 caracteres)" required/><button className="primary full">{authMode==='login'?'Entrar':'Criar conta'}</button>{authMsg&&<div className="formError">{authMsg}</div>}</form><button className="switchAuth" onClick={()=>{setAuthMode(authMode==='login'?'register':'login');setAuthMsg('')}}>{authMode==='login'?'Ainda não tenho conta':'Já tenho conta'}</button></div></div>}
 </main>
}


function WorkspaceShell({children,title,subtitle,onLogout}:{children:React.ReactNode;title:string;subtitle:string;onLogout:()=>void}){
 return <main className="workspacePage"><header className="workspaceHeader"><div className="workspaceBrand"><img src={img.logo} alt="BaBuLo Play"/><div><small>BaBuLo Play</small><h1>{title}</h1><p>{subtitle}</p></div></div><button className="outline" onClick={onLogout}>Sair</button></header>{children}</main>
}

function ArtistWorkspace({token,me,onLogout}:{token:string;me:any;onLogout:()=>void}){
 const [releases,setReleases]=useState<Release[]>([]),[editing,setEditing]=useState<string|null>(null),[releaseOpen,setReleaseOpen]=useState(false),[distOpen,setDistOpen]=useState(false);
 const [royalty,setRoyalty]=useState<any>(null),[analytics,setAnalytics]=useState<any>(null),[range,setRange]=useState(30),[loading,setLoading]=useState(true),[msg,setMsg]=useState('');
 const artistName=me?.artist?.stage_name||me?.user?.email||'Artista';
 const load=async()=>{setLoading(true);try{const headers={Authorization:`Bearer ${token}`};const [rr,ry,aa]=await Promise.all([fetch(API+'/api/artists/me/releases',{headers}),fetch(API+'/api/artists/me/royalties',{headers}),fetch(API+`/api/artists/me/analytics?from=${new Date(Date.now()-(range-1)*86400000).toISOString().slice(0,10)}&to=${new Date().toISOString().slice(0,10)}`,{headers})]);const rd=await rr.json(),yd=await ry.json(),ad=await aa.json();if(rr.ok)setReleases(rd.releases||[]);if(ry.ok)setRoyalty(yd);if(aa.ok)setAnalytics(ad.analytics);if(!rr.ok||!aa.ok)setMsg((rd.error||ad.error||'Não foi possível carregar o painel.'));}catch(e:any){setMsg(e.message||'Erro de ligação')}finally{setLoading(false)}};
 useEffect(()=>{load()},[range,token]);
 const drafts=releases.filter(r=>['DRAFT','FAILED','PENDING_APPROVAL'].includes(String(r.status||'DRAFT')));
 const money=(v:number)=>`${Number(v||0).toLocaleString('pt-AO',{maximumFractionDigits:2})} Kz`;
 return <WorkspaceShell title="Área do Artista" subtitle={`Espaço profissional de ${artistName}. A área de ouvinte exige um novo login.`} onLogout={onLogout}>
  <div className="workspaceActions"><button className="primary" onClick={()=>{setEditing(null);setReleaseOpen(true)}}>＋ Novo lançamento</button><button className="outline" onClick={()=>setDistOpen(true)}>⇧ Distribuição</button><select value={range} onChange={e=>setRange(Number(e.target.value))}><option value={7}>Últimos 7 dias</option><option value={30}>Últimos 30 dias</option><option value={90}>Últimos 90 dias</option><option value={365}>Últimos 12 meses</option></select></div>
  {msg&&<div className="formError">{msg}</div>}
  <section className="metricGrid"><div className="metricCard"><small>💰 SALDO DISPONÍVEL</small><strong>{money(royalty?.balance)}</strong><span>Royalties acumulados</span></div><div className="metricCard"><small>🎵 STREAMS VÁLIDOS</small><strong>{Number(analytics?.totals?.validStreams||0).toLocaleString('pt-AO')}</strong><span>No período selecionado</span></div><div className="metricCard"><small>👥 OUVINTES ÚNICOS</small><strong>{Number(analytics?.totals?.uniqueListeners||0).toLocaleString('pt-AO')}</strong><span>Identificadores agregados</span></div><div className="metricCard"><small>💳 LEVANTAMENTO MÍNIMO</small><strong>{money(royalty?.minimumWithdrawal||10000)}</strong><span>Disponível quando elegível</span></div></section>
  <section className="workspaceGrid"><div className="workspacePanel"><div className="panelTitle"><div><small>AUDIÊNCIA</small><h2>Onde te estão a ouvir</h2></div></div>{analytics?.countries?.length?<div className="rankList">{analytics.countries.slice(0,8).map((x:any)=><div className="rankRow" key={x.country}><span><b>{x.country}</b><small>{Number(x.unique_listeners||0).toLocaleString('pt-AO')} ouvintes</small></span><strong>{Number(x.streams||0).toLocaleString('pt-AO')}</strong></div>)}</div>:<p className="emptyState">Ainda não existem dados geográficos suficientes.</p>}</div>
  <div className="workspacePanel"><div className="panelTitle"><div><small>CIDADES</small><h2>Principais cidades</h2></div></div>{analytics?.cities?.length?<div className="rankList">{analytics.cities.slice(0,8).map((x:any)=><div className="rankRow" key={`${x.country}-${x.city}`}><span><b>{x.city}</b><small>{x.country} · {Number(x.unique_listeners||0).toLocaleString('pt-AO')} ouvintes</small></span><strong>{Number(x.streams||0).toLocaleString('pt-AO')}</strong></div>)}</div>:<p className="emptyState">A cidade pode aparecer como desconhecida quando o serviço de geolocalização não a fornece.</p>}</div></section>
  <section className="workspaceGrid"><div className="workspacePanel"><div className="panelTitle"><div><small>TOP FAIXAS</small><h2>As tuas músicas</h2></div></div>{analytics?.tracks?.length?<div className="rankList">{analytics.tracks.slice(0,10).map((x:any,i:number)=><div className="rankRow" key={x.id}><span><b>#{i+1} {x.title}</b><small>{Number(x.unique_listeners||0).toLocaleString('pt-AO')} ouvintes</small></span><strong>{Number(x.streams||0).toLocaleString('pt-AO')}</strong></div>)}</div>:<p className="emptyState">Sem streams válidos no período.</p>}</div>
  <div className="workspacePanel"><div className="panelTitle"><div><small>LANÇAMENTOS</small><h2>Rascunhos e pendentes</h2></div></div>{drafts.length?drafts.map(r=><button className="workspaceRelease" key={r.id} onClick={()=>{setEditing(r.id);setReleaseOpen(true)}}><span><b>{r.title||'Sem título'}</b><small>{r.type} · {r.status}</small></span><strong>Continuar →</strong></button>):<p className="emptyState">Nenhum rascunho pendente.</p>}</div></section>
  <section className="workspacePanel"><div className="panelTitle"><div><small>SALDO E MOVIMENTOS</small><h2>Resumo financeiro</h2></div></div><div className="financeMini"><div><span>Saldo de royalties</span><b>{money(royalty?.balance)}</b></div><div><span>Entradas registadas</span><b>{royalty?.entries?.length||0}</b></div><div><span>Levantamentos</span><b>{royalty?.withdrawals?.length||0}</b></div></div></section>
  {releaseOpen&&<ReleaseWizard token={token} editReleaseId={editing} onClose={()=>{setReleaseOpen(false);setEditing(null)}} onDone={()=>{setReleaseOpen(false);setEditing(null);load()}}/>}{distOpen&&<DistributionPanel token={token} releases={releases} onClose={()=>setDistOpen(false)}/>} 
 </WorkspaceShell>
}

function AdminWorkspace({token,me,onLogout}:{token:string;me:any;onLogout:()=>void}){
 const [finance,setFinance]=useState<any>(null),[analytics,setAnalytics]=useState<any>(null),[pending,setPending]=useState<any[]>([]),[range,setRange]=useState(30),[tab,setTab]=useState<'overview'|'analytics'|'approvals'|'accounts'>('overview'),[msg,setMsg]=useState('');
 const load=async()=>{try{const headers={Authorization:`Bearer ${token}`};const from=new Date(Date.now()-(range-1)*86400000).toISOString().slice(0,10),to=new Date().toISOString().slice(0,10);const [f,a,p]=await Promise.all([fetch(API+'/api/admin/finance/summary',{headers}),fetch(API+`/api/admin/analytics/streams?from=${from}&to=${to}`,{headers}),fetch(API+'/api/admin/releases/pending',{headers})]);const fd=await f.json(),ad=await a.json(),pd=await p.json();if(f.ok)setFinance(fd);if(a.ok)setAnalytics(ad.analytics);if(p.ok)setPending(pd.releases||[]);if(!f.ok||!a.ok)setMsg(fd.error||ad.error||'Não foi possível carregar os dados.')}catch(e:any){setMsg(e.message||'Erro de ligação')}};
 useEffect(()=>{load()},[range,token]);
 const money=(v:number)=>`${Number(v||0).toLocaleString('pt-AO',{maximumFractionDigits:2})} Kz`; const b=finance?.balances||{}; const isOwner=me?.user?.role==='OWNER';
 return <WorkspaceShell title={isOwner?'Área do Owner':'Área Administrativa'} subtitle={isOwner?'Finanças, audiência, contas, aprovações e controlo total.':'Gestão operacional de utilizadores, artistas, lançamentos e audiência.'} onLogout={onLogout}>
  <div className="workspaceActions"><button className={tab==='overview'?'primary':'outline'} onClick={()=>setTab('overview')}>Visão geral</button><button className={tab==='analytics'?'primary':'outline'} onClick={()=>setTab('analytics')}>Audiência</button><button className={tab==='approvals'?'primary':'outline'} onClick={()=>setTab('approvals')}>Aprovações</button><button className={tab==='accounts'?'primary':'outline'} onClick={()=>setTab('accounts')}>👤 Contas</button><select value={range} onChange={e=>setRange(Number(e.target.value))}><option value={1}>Hoje</option><option value={7}>7 dias</option><option value={30}>30 dias</option><option value={90}>90 dias</option><option value={365}>12 meses</option></select></div>
  {msg&&<div className="formError">{msg}</div>}
  {tab==='overview'&&<><section className="metricGrid adminMetrics"><div className="metricCard"><small>🎵 SALDO DE STREAMS</small><strong>{Number(b.streamBalance?.validStreams||0).toLocaleString('pt-AO')}</strong><span>Streams válidos registados</span></div><div className="metricCard"><small>💳 PAGAMENTOS DOS ARTISTAS</small><strong>{money(b.artistPayments?.paid)}</strong><span>Pagamentos concluídos</span></div><div className="metricCard"><small>💰 ROYALTIES DOS ARTISTAS</small><strong>{money(b.artistRoyalties)}</strong><span>Saldo a pagar aos artistas</span></div><div className="metricCard"><small>🏦 DISPONÍVEL PARA LEVANTAMENTOS</small><strong>{money(b.artistPayments?.pending)}</strong><span>Pedidos pendentes de análise</span></div><div className="metricCard"><small>📊 RECEITA BABULO PLAY</small><strong>{money(b.babuloRevenue)}</strong><span>Pagamentos externos líquidos</span></div><div className="metricCard"><small>⏳ PAGAMENTOS PENDENTES</small><strong>{money(b.pendingPayments)}</strong><span>Transações ainda não confirmadas</span></div><div className="metricCard"><small>↩️ ESTORNOS</small><strong>{money(b.refunds)}</strong><span>Transações estornadas</span></div><div className="metricCard"><small>📈 RECEITA LÍQUIDA</small><strong>{money(b.netAfterArtistPayments)}</strong><span>Receita externa menos pagamentos de artistas</span></div></section></>}
  {tab==='analytics'&&<><section className="workspaceGrid"><div className="workspacePanel"><div className="panelTitle"><div><small>AUDIÊNCIA GLOBAL</small><h2>Países</h2></div></div>{analytics?.countries?.length?<div className="rankList">{analytics.countries.slice(0,15).map((x:any)=><div className="rankRow" key={x.country}><span><b>{x.country}</b><small>{Number(x.unique_listeners||0).toLocaleString('pt-AO')} ouvintes</small></span><strong>{Number(x.streams||0).toLocaleString('pt-AO')} streams</strong></div>)}</div>:<p className="emptyState">Sem dados no período.</p>}</div><div className="workspacePanel"><div className="panelTitle"><div><small>AUDIÊNCIA GLOBAL</small><h2>Cidades</h2></div></div>{analytics?.cities?.length?<div className="rankList">{analytics.cities.slice(0,20).map((x:any)=><div className="rankRow" key={`${x.country}-${x.city}`}><span><b>{x.city}</b><small>{x.country}</small></span><strong>{Number(x.streams||0).toLocaleString('pt-AO')}</strong></div>)}</div>:<p className="emptyState">Sem dados no período.</p>}</div></section><section className="workspacePanel"><div className="panelTitle"><div><small>FAIXAS</small><h2>Mais ouvidas</h2></div></div>{analytics?.tracks?.map((x:any,i:number)=><div className="rankRow" key={x.id}><span><b>#{i+1} {x.title}</b><small>{Number(x.unique_listeners||0).toLocaleString('pt-AO')} ouvintes</small></span><strong>{Number(x.streams||0).toLocaleString('pt-AO')}</strong></div>)}</section></>}
  {tab==='approvals'&&<section className="workspacePanel"><div className="panelTitle"><div><small>OPERAÇÃO</small><h2>Lançamentos pendentes</h2></div></div>{pending.length?pending.map((r:any)=><ApprovalRow key={r.id} release={r} token={token} onDone={load}/>):<p className="emptyState">Nenhum lançamento pendente.</p>}</section>}
  {tab==='accounts'&&<AccountManagement token={token} isOwner={isOwner}/>} 
 </WorkspaceShell>
}

function ApprovalRow({release,token,onDone}:{release:any;token:string;onDone:()=>void}){
 const [busy,setBusy]=useState(false),[msg,setMsg]=useState('');
 async function decide(decision:'APPROVED'|'REJECTED'){let reason='';if(decision==='REJECTED'){reason=window.prompt('Motivo da rejeição:')||'';if(!reason.trim())return;}setBusy(true);setMsg('');try{const r=await fetch(API+`/api/admin/releases/${release.id}/decision`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({decision,reason})});const d=await r.json();if(!r.ok)throw Error(d.error||'Não foi possível guardar a decisão');setMsg(decision==='APPROVED'?'✓ Aprovado':'✓ Rejeitado');onDone()}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}
 return <div className="workspaceRelease"><span><b>{release.title}</b><small>{release.stage_name} · {release.type} · {release.status}</small></span><span style={{display:'flex',gap:8,alignItems:'center'}}><button className="primary" disabled={busy} onClick={()=>decide('APPROVED')}>Aprovar</button><button className="outline" disabled={busy} onClick={()=>decide('REJECTED')}>Rejeitar</button>{msg&&<small>{msg}</small>}</span></div>
}

function AccountManagement({token,isOwner}:{token:string;isOwner:boolean}){
 const [users,setUsers]=useState<any[]>([]),[q,setQ]=useState(''),[role,setRole]=useState(''),[status,setStatus]=useState(''),[selected,setSelected]=useState<any>(null),[detail,setDetail]=useState<any>(null),[loading,setLoading]=useState(false),[msg,setMsg]=useState('');
 const [adminOpen,setAdminOpen]=useState(false),[adminEmail,setAdminEmail]=useState(''),[adminPassword,setAdminPassword]=useState('');
 const load=async()=>{setLoading(true);try{const qs=new URLSearchParams();if(q.trim())qs.set('q',q.trim());if(role)qs.set('role',role);if(status)qs.set('status',status);const r=await fetch(API+'/api/admin/users?'+qs.toString(),{headers:{Authorization:`Bearer ${token}`}});const d=await r.json();if(!r.ok)throw Error(d.error||'Não foi possível carregar as contas');setUsers(d.users||[])}catch(e:any){setMsg(e.message)}finally{setLoading(false)}};
 useEffect(()=>{load()},[role,status]);
 async function open(u:any){setSelected(u);setDetail(null);const r=await fetch(API+`/api/admin/users/${u.id}`,{headers:{Authorization:`Bearer ${token}`}});const d=await r.json();if(r.ok)setDetail(d);else setMsg(d.error||'Não foi possível abrir o perfil');}
 async function changeStatus(u:any,next:string){if(u.status===next)return;if(!window.confirm(`${next==='BLOCKED'?'Bloquear':'Alterar estado de'} ${u.stage_name||u.email}?`))return;try{const r=await fetch(API+`/api/admin/users/${u.id}/status`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({status:next})});const d=await r.json();if(!r.ok)throw Error(d.error||'Não foi possível alterar o estado');setMsg('✓ Estado atualizado.');await load();if(selected?.id===u.id)open(d.user)}catch(e:any){setMsg(e.message)}}
 async function verify(a:any,next:string){try{const r=await fetch(API+`/api/admin/artists/${a.id}/verification`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({verificationStatus:next})});const d=await r.json();if(!r.ok)throw Error(d.error||'Não foi possível atualizar a verificação');setMsg('✓ Verificação atualizada.');if(selected?.id===a.user_id)open(selected);await load()}catch(e:any){setMsg(e.message)}}
 async function createAdmin(){try{const r=await fetch(API+'/api/owner/admins',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({email:adminEmail,password:adminPassword})});const d=await r.json();if(!r.ok)throw Error(d.error||'Não foi possível criar o ADMIN');setMsg('✓ Conta ADMIN criada.');setAdminEmail('');setAdminPassword('');setAdminOpen(false);load()}catch(e:any){setMsg(e.message)}}
 return <>
  <section className="workspacePanel"><div className="panelTitle"><div><small>CONTROLO DE CONTAS</small><h2>Utilizadores e artistas</h2><p>Pesquisa perfis, consulta detalhes e administra o estado das contas.</p></div>{isOwner&&<button className="primary" onClick={()=>setAdminOpen(v=>!v)}>＋ Criar ADMIN</button>}</div>
   {adminOpen&&isOwner&&<div className="credits" style={{marginBottom:16}}><h3>Novo administrador</h3><label>Email<input value={adminEmail} onChange={e=>setAdminEmail(e.target.value)} placeholder="admin@babulo.ao"/></label><label>Palavra-passe <small>(mínimo 12 caracteres)</small><input type="password" value={adminPassword} onChange={e=>setAdminPassword(e.target.value)} /></label><button className="primary" disabled={!adminEmail||adminPassword.length<12} onClick={createAdmin}>Criar conta ADMIN</button></div>}
   <div className="workspaceActions"><input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==='Enter'&&load()} placeholder="Pesquisar nome, email ou telefone"/><select value={role} onChange={e=>setRole(e.target.value)}><option value="">Todos os perfis</option><option value="ARTIST">Artistas</option><option value="LISTENER">Ouvintes</option><option value="ADMIN">Admins</option><option value="OWNER">Owners</option></select><select value={status} onChange={e=>setStatus(e.target.value)}><option value="">Todos os estados</option><option value="ACTIVE">Ativos</option><option value="SUSPENDED">Suspensos</option><option value="BLOCKED">Bloqueados</option></select><button className="outline" onClick={load}>Pesquisar</button></div>
   {msg&&<div className="formError">{msg}</div>}
   {loading?<p className="emptyState">A carregar contas…</p>:users.length?<div className="rankList">{users.map(u=><div className="rankRow" key={u.id} style={{cursor:'pointer'}} onClick={()=>open(u)}><span><b>{u.stage_name||u.email||u.phone||'Utilizador'}</b><small>{u.role} · {u.email||u.phone||'sem contacto'} · {u.status}</small></span><span><small>{u.role==='ARTIST'?`${u.release_count||0} lançamentos · ${u.valid_streams||0} streams`:''}</small><strong>{u.status}</strong></span></div>)}</div>:<p className="emptyState">Nenhuma conta encontrada.</p>}
  </section>
  {detail&&selected&&<section className="workspacePanel"><div className="panelTitle"><div><small>PERFIL</small><h2>{detail.artist?.stage_name||detail.user.email||detail.user.phone||'Utilizador'}</h2><p>{detail.user.role} · conta {detail.user.status}</p></div><button className="outline" onClick={()=>{setSelected(null);setDetail(null)}}>Fechar</button></div>
   <div className="metricGrid"><div className="metricCard"><small>ESTADO</small><strong>{detail.user.status}</strong><span>{detail.user.email||detail.user.phone||'Sem contacto'}</span></div>{detail.artist&&<><div className="metricCard"><small>VERIFICAÇÃO</small><strong>{detail.artist.verification_status}</strong><span>{detail.artist.country||'País não definido'} · {detail.artist.city||'Cidade não definida'}</span></div><div className="metricCard"><small>LANÇAMENTOS</small><strong>{detail.releases?.length||0}</strong><span>Registos recentes</span></div><div className="metricCard"><small>LEVANTAMENTOS</small><strong>{detail.withdrawals?.length||0}</strong><span>Histórico recente</span></div></>}</div>
   <div className="workspaceActions"><button className="outline" onClick={()=>changeStatus(detail.user,'ACTIVE')}>🟢 Ativar</button><button className="outline" onClick={()=>changeStatus(detail.user,'SUSPENDED')}>🟠 Suspender</button><button className="outline" onClick={()=>changeStatus(detail.user,'BLOCKED')}>🔴 Bloquear</button>{detail.artist&&<><button className="outline" onClick={()=>verify(detail.artist,'VERIFIED')}>✓ Verificar artista</button><button className="outline" onClick={()=>verify(detail.artist,'REJECTED')}>✕ Recusar verificação</button></>}</div>
   {detail.releases?.length>0&&<div className="releaseList"><h3>Lançamentos</h3>{detail.releases.slice(0,20).map((r:any)=><div className="releaseRow" key={r.id}><span>{r.title}</span><small>{r.type} · {r.status}{r.review_reason?` · ${r.review_reason}`:''}</small></div>)}</div>}
   {detail.logs?.length>0&&<div className="releaseList"><h3>Auditoria</h3>{detail.logs.slice(0,20).map((l:any)=><div className="releaseRow" key={l.id}><span>{l.action}</span><small>{l.actor_email||'Sistema'} · {new Date(l.created_at).toLocaleString('pt-AO')}</small></div>)}</div>}
  </section>}
 </>
}
function DistributionPanel({token,releases,onClose}:{token:string;releases:Release[];onClose:()=>void}){
 const [platforms,setPlatforms]=useState<any[]>([]),[orders,setOrders]=useState<any[]>([]),[releaseId,setReleaseId]=useState(''),[product,setProduct]=useState('DIST_SINGLE'),[selected,setSelected]=useState<string[]>([]),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{Promise.all([fetch(API+'/api/distribution/platforms').then(r=>r.json()),fetch(API+'/api/distribution/orders',{headers:{Authorization:'Bearer '+token}}).then(r=>r.json())]).then(([p,o])=>{setPlatforms(p.platforms||[]);setOrders(o.orders||[])})},[token]);
 async function create(){setBusy(true);setMsg('');try{const r=await fetch(API+'/api/distribution/orders',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({releaseId,productCode:product,platformIds:selected})});const d=await r.json();if(!r.ok)throw Error(d.error||'Erro');setMsg('✓ Pedido criado.');setOrders(x=>[d.order,...x])}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}
 async function submit(id:string){const r=await fetch(API+'/api/distribution/orders/'+id+'/submit',{method:'POST',headers:{Authorization:'Bearer '+token}});const d=await r.json();setMsg(r.ok?'✓ '+d.message:d.error);if(r.ok)setOrders(xs=>xs.map(x=>x.id===id?{...x,status:d.status}:x))}
 return <div className="modalBackdrop"><div className="authModal" style={{maxWidth:760}}><button className="modalClose" onClick={onClose}>✕</button><h2>Distribuição Musical</h2><p>Envia lançamentos aprovados para as plataformas selecionadas. A publicação real depende dos conectores oficiais.</p><label>Lançamento<select value={releaseId} onChange={e=>setReleaseId(e.target.value)}><option value="">Selecionar lançamento aprovado</option>{releases.filter(r=>r.status==='APPROVED').map(r=><option key={r.id} value={r.id}>{r.title} · {r.type}</option>)}</select></label><label>Pacote<select value={product} onChange={e=>setProduct(e.target.value)}><option value="DIST_SINGLE">Single — 5.000 Kz</option><option value="DIST_EP">EP — 10.000 Kz</option><option value="DIST_ALBUM">Álbum — 14.000 Kz</option><option value="DIST_ALBUM_PRO">Álbum Pro — 20.000 Kz</option></select></label><div className="credits"><h3>Plataformas</h3>{platforms.map(p=><label className="check" key={p.id}><input type="checkbox" checked={selected.includes(p.id)} onChange={e=>setSelected(x=>e.target.checked?[...x,p.id]:x.filter(id=>id!==p.id))}/>{p.name}</label>)}</div><button className="primary full" disabled={busy||!releaseId||!selected.length} onClick={create}>{busy?'A criar...':'Criar pedido de distribuição'}</button>{msg&&<div className="formError">{msg}</div>}<div className="releaseList"><h3>Histórico de distribuição</h3>{orders.map(o=><div className="releaseRow" key={o.id}><span>{o.release_title}</span><small>{o.product_code} · {o.status} · {o.published_count||0}/{o.platform_count||0} publicados {['READY','FAILED'].includes(o.status)&&<button className="outline" onClick={()=>submit(o.id)}>Submeter</button>}</small></div>)}</div></div></div>
}

function SectionTitle({title,link}:{title:string;link?:string}){return <div className="sectionTitle"><h2>{title}</h2><a>{link||'Ver tudo →'}</a></div>}

type WizardTrack={
 id:string; title:string; version:string; language:string; genreId:string; isExplicit:boolean; explicitReason:string; isrc:string;
 featuredArtists:string; audioType:string; aiGenerated:string; aiUsage:string; lyrics:string; composer:string; lyricist:string;
 producer:string; performer:string; publisher:string; rightsHolder:string; rightsRole:string; rightsType:string; rightsPercentage:string;
 rightsTerritory:string; audioUrl:string; audioName:string; durationMs:number; promoStartMs:number; promoEndMs:number; serverTrackId?:string; serverRightId?:string;
}
function emptyWizardTrack():WizardTrack{return {id:Math.random().toString(36).slice(2),title:'',version:'',language:'Português',genreId:'',isExplicit:false,explicitReason:'',isrc:'',featuredArtists:'',audioType:'SONG',aiGenerated:'NO',aiUsage:'',lyrics:'',composer:'',lyricist:'',producer:'',performer:'',publisher:'',rightsHolder:'',rightsRole:'RIGHTS_HOLDER',rightsType:'STREAMING',rightsPercentage:'100',rightsTerritory:'WORLDWIDE',audioUrl:'',audioName:'',durationMs:0,promoStartMs:0,promoEndMs:0}}

async function readApiResponse(r:Response){
 const text=await r.text();
 let data:any=null;
 try{data=text?JSON.parse(text):null}catch{
   const compact=text.replace(/\s+/g,' ').slice(0,240);
   throw Error(`A API devolveu uma resposta inválida (${r.status}). Verifica se o serviço API do Render está ativo. ${compact}`);
 }
 if(!r.ok) throw Error(data?.error||`Pedido recusado pela API (${r.status}).`);
 return data||{};
}

function ReleaseWizard({token,onClose,onDone,editReleaseId=null}:{token:string;onClose:()=>void;onDone:()=>void;editReleaseId?:string|null}){
 const [step,setStep]=useState(1); const [releaseId,setReleaseId]=useState<string|null>(editReleaseId);
 const [loadingDraft,setLoadingDraft]=useState(Boolean(editReleaseId)); const [preflight,setPreflight]=useState<any>(null),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false),[genres,setGenres]=useState<any[]>([]);
 const [form,setForm]=useState({title:'',type:'SINGLE',genreId:'',language:'Português',country:'Angola',releaseDate:'',preReleaseDate:'',coverUrl:'',description:'',upc:'',ean:'',labelName:'',phonographicCopyright:'',copyrightText:'',coverName:''});
 const [tracks,setTracks]=useState<WizardTrack[]>([emptyWizardTrack()]);
 const [uploadProgress,setUploadProgress]=useState<Record<string,number>>({});
 const [payment,setPayment]=useState<any>(null),[paymentProduct,setPaymentProduct]=useState<any>(null),[paymentPaid,setPaymentPaid]=useState(false),[paymentMethod,setPaymentMethod]=useState('WALLET'),[fallbackPaymentMethod,setFallbackPaymentMethod]=useState('MULTICAIXA_EXPRESS'),[walletBalance,setWalletBalance]=useState(0),[walletApplied,setWalletApplied]=useState(0),[externalDue,setExternalDue]=useState(0),[distribution,setDistribution]=useState<any>(null),[distributionMode,setDistributionMode]=useState<'MAIN'|'ALL'>('MAIN');
 useEffect(()=>{fetch(`${API}/api/genres`).then(r=>r.json()).then(d=>setGenres(d.genres||[])).catch(()=>{})},[])
 useEffect(()=>{
  if(!editReleaseId)return;
  (async()=>{try{setLoadingDraft(true);setMsg('A abrir o rascunho…');const r=await fetch(API+`/api/releases/${editReleaseId}/editor`,{headers:{Authorization:`Bearer ${token}`}});const d=await r.json();if(!r.ok)throw Error(d.error||'Não foi possível abrir o rascunho');
    const rr=d.release||{};
    setForm({title:rr.title||'',type:rr.type||'SINGLE',genreId:rr.genre_id||'',language:rr.language||'Português',country:rr.country||'Angola',releaseDate:rr.release_date?String(rr.release_date).slice(0,10):'',preReleaseDate:rr.pre_release_date?String(rr.pre_release_date).slice(0,10):'',coverUrl:rr.cover_url?(String(rr.cover_url).startsWith('http')?String(rr.cover_url):API+String(rr.cover_url)):'',description:rr.description||'',upc:rr.upc||'',ean:rr.ean||'',labelName:rr.label_name||'',phonographicCopyright:rr.phonographic_copyright||'',copyrightText:rr.copyright_text||'',coverName:rr.cover_url?String(rr.cover_url).split('/').pop()||'Capa existente':''});
    const loaded=(d.tracks||[]).map((t:any)=>{const audio=t.audioUrl?(String(t.audioUrl).startsWith('http')?String(t.audioUrl):API+String(t.audioUrl)):'';const right=(d.rights||[]).find((x:any)=>String(x.id)===String(t.serverRightId));return {id:Math.random().toString(36).slice(2),title:t.title||'',version:t.version||'',language:t.language||'Português',genreId:t.genre_id||'',isExplicit:Boolean(t.is_explicit),explicitReason:t.explicit_reason||'',isrc:t.isrc||'',featuredArtists:t.featured_artists||'',audioType:t.audio_type||'SONG',aiGenerated:t.ai_generated||'NO',aiUsage:t.ai_usage||'',lyrics:t.lyrics||'',composer:t.composer||'',lyricist:t.lyricist||'',producer:t.producer||'',performer:t.performer||'',publisher:t.publisher||'',rightsHolder:right?.party_name||'',rightsRole:right?.party_role||'RIGHTS_HOLDER',rightsType:right?.right_type||'STREAMING',rightsPercentage:String(right?.percentage??100),rightsTerritory:right?.territory||'WORLDWIDE',audioUrl:audio,audioName:t.audioName||'',durationMs:Number(t.duration_ms||0),promoStartMs:Number(t.promo_start_ms||0),promoEndMs:Number(t.promo_end_ms||0),serverTrackId:t.serverTrackId,serverRightId:t.serverRightId};});
    setTracks(loaded.length?loaded:[emptyWizardTrack()]);setPreflight(rr.preflight_status==='PASSED'?{status:'PASSED',errors:[]}:null);setMsg(`Rascunho “${rr.title||'Sem título'}” aberto. Podes continuar de onde paraste.`);
  }catch(e:any){setMsg(e.message)}finally{setLoadingDraft(false)}})();
 },[editReleaseId,token]);
 const set=(k:string,v:any)=>setForm(f=>({...f,[k]:v}));
 const updateTrack=(index:number,key:string,value:any)=>setTracks(ts=>ts.map((t,i)=>i===index?{...t,[key]:value}:t));
 function addTrack(){setTracks(ts=>[...ts,emptyWizardTrack()]);setMsg('');}
 function removeTrack(index:number){if(tracks.length===1)return;setTracks(ts=>ts.filter((_,i)=>i!==index));setMsg('');}
 function duplicateTrack(index:number){setTracks(ts=>{const copy={...ts[index],id:Math.random().toString(36).slice(2),title:ts[index].title?`${ts[index].title} (Cópia)`:'' ,audioUrl:'',audioName:''};return [...ts.slice(0,index+1),copy,...ts.slice(index+1)]});setMsg('Faixa duplicada.');}
 function moveTrack(index:number,dir:number){const target=index+dir;if(target<0||target>=tracks.length)return;setTracks(ts=>{const a=[...ts];[a[index],a[target]]=[a[target],a[index]];return a});}
 async function upload(file:File,kind:'audio'|'cover',progressKey?:string){
  if(!token)throw Error('Sessão não encontrada. Entra novamente.');
  const fd=new FormData();fd.append('file',file);fd.append('kind',kind);
  return await new Promise<string>((resolve,reject)=>{
   const xhr=new XMLHttpRequest();
   xhr.open('POST',API+'/api/uploads');
   xhr.setRequestHeader('Authorization',`Bearer ${token}`);
   xhr.upload.onprogress=e=>{if(e.lengthComputable&&progressKey)setUploadProgress(v=>({...v,[progressKey]:Math.round((e.loaded/e.total)*100)}));};
   xhr.onload=()=>{try{const d=JSON.parse(xhr.responseText||'{}');if(xhr.status<200||xhr.status>=300)throw Error(d.error||'Falha no upload');if(progressKey)setUploadProgress(v=>({...v,[progressKey]:100}));resolve(String(d.file.url||'').startsWith('http')?String(d.file.url):`${API}${d.file.url}`);}catch(e){reject(e);}};
   xhr.onerror=()=>reject(Error('Falha de ligação durante o upload.'));
   xhr.onabort=()=>reject(Error('Upload cancelado.'));
   xhr.send(fd);
  });
 }
 function validateTracks(){for(let i=0;i<tracks.length;i++){const t=tracks[i];if(!t.title.trim())return `Informe o título da Faixa ${i+1}.`;if(!t.rightsHolder.trim())return `Informe o titular dos direitos da Faixa ${i+1}.`;if(Number(t.rightsPercentage)!==100)return `A participação da Faixa ${i+1} deve totalizar 100%.`;if(!t.audioUrl)return `Adicione o áudio da Faixa ${i+1}.`;if(t.promoEndMs-t.promoStartMs!==59000)return `O trecho promocional da Faixa ${i+1} deve ter exatamente 59 segundos.`;}return ''}
 async function ensureRelease(){if(releaseId)return releaseId;if(!form.title.trim())throw Error('Informe o título do lançamento antes de abrir o pagamento.');const body={...form,coverUrl:form.coverUrl||null};delete (body as any).coverName;const rr=await fetch(API+'/api/releases',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});const rd=await rr.json();if(!rr.ok)throw Error(rd.error||'Não foi possível criar o rascunho');setReleaseId(rd.release.id);return rd.release.id as string}
 async function loadPayment(rid:string){const r=await fetch(API+`/api/releases/${rid}/payment`,{headers:{Authorization:`Bearer ${token}`}});const d=await r.json();if(!r.ok)throw Error(d.error||'Não foi possível carregar o pagamento');setPayment(d.payment);setPaymentProduct(d.product);setPaymentPaid(Boolean(d.paid));setWalletBalance(Number(d.wallet?.balance||0));setWalletApplied(Number(d.wallet?.applied||0));setExternalDue(Number(d.wallet?.externalDue||0));setDistribution(d.distribution||null);setDistributionMode((d.distribution?.mode||'MAIN') as any);}
 async function goPayment(){try{setBusy(true);setMsg('');const rid=await ensureRelease();await loadPayment(rid);setStep(5)}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}
 async function createPayment(){try{setBusy(true);setMsg('');const rid=await ensureRelease();const r=await fetch(API+`/api/releases/${rid}/payment`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({paymentMethod,fallbackPaymentMethod,distributionMode})});const d=await r.json();if(!r.ok)throw Error(d.error||'Não foi possível iniciar o pagamento');setPayment(d.payment);setPaymentPaid(Boolean(d.paid));setWalletBalance(Number(d.wallet?.balance||0));setWalletApplied(Number(d.wallet?.applied||0));setExternalDue(Number(d.wallet?.externalDue||0));setMsg(d.paid?'✓ Pagamento confirmado com o saldo dos streams.':(Number(d.wallet?.externalDue||0)>0?'✓ Saldo dos streams aplicado. Paga agora apenas a diferença.':'Pagamento iniciado. Aguarda a confirmação.'))}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}
 function next(){setMsg('');if(step===1&&!form.title.trim())return setMsg('Informe o título do lançamento.');if(step===2){const e=validateTracks();if(e)return setMsg(e);}setStep(s=>Math.min(4,s+1))}
 async function finish(){setBusy(true);setMsg('');try{
   const releaseBody={...form,coverUrl:form.coverUrl||null};delete (releaseBody as any).coverName;
   let rid=releaseId;
   if(!rid){const rr=await fetch(API+'/api/releases',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(releaseBody)});const rd=await readApiResponse(rr);rid=rd.release.id;setReleaseId(rid);}else{const rr=await fetch(API+`/api/releases/${rid}`,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(releaseBody)});await readApiResponse(rr);}
   for(let i=0;i<tracks.length;i++){
     const t=tracks[i];
     const trackBody={title:t.title,releaseId:rid,trackNumber:i+1,genreId:t.genreId||form.genreId,language:t.language,version:t.version,durationMs:t.durationMs||null,isExplicit:t.isExplicit,isrc:t.isrc,originalReleaseDate:form.releaseDate,fileUrl:t.audioUrl||undefined,fileType:'AUDIO',composer:t.composer,lyricist:t.lyricist,producer:t.producer,performer:t.performer,publisher:t.publisher,explicitReason:t.explicitReason,featuredArtists:t.featuredArtists,audioType:t.audioType,aiGenerated:t.aiGenerated,aiUsage:t.aiUsage,lyrics:t.lyrics,promoStartMs:t.promoStartMs,promoEndMs:t.promoEndMs};
     const tr=t.serverTrackId?await fetch(API+`/api/tracks/${t.serverTrackId}`,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(trackBody)}):await fetch(API+'/api/tracks',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(trackBody)});
     const td=await readApiResponse(tr);const trackId=td.track.id;
     const rightsBody={trackId,partyName:t.rightsHolder.trim(),partyRole:t.rightsRole,rightType:t.rightsType,percentage:Number(t.rightsPercentage),territory:t.rightsTerritory};
     const rrh=t.serverRightId?await fetch(API+`/api/releases/${rid}/rights/${t.serverRightId}`,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(rightsBody)}):await fetch(API+`/api/releases/${rid}/rights`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(rightsBody)});
     await readApiResponse(rrh);
   }
   setPreflight(null);setMsg(`Rascunho guardado com ${tracks.length} ${tracks.length===1?'faixa':'faixas'}.`);setStep(4);
  }catch(e:any){setMsg(e.message)}finally{setBusy(false)}}
 return <div className="modalBackdrop"><div className="releaseWizard"><button className="modalClose" onClick={onClose}>✕</button><div className="wizardHead"><img src={img.logo} alt=""/><div><small>NOVO LANÇAMENTO · V10.3</small><h2>Preparar música para BaBuLo</h2></div></div>
 <div className="steps">{['Lançamento','Faixas','Ficheiros','Revisão','Pagamento'].map((x,i)=><button type="button" className={step===i+1?'active':''} key={x} onClick={()=>{setMsg('');if(i===4){goPayment();}else setStep(i+1)}}><b>{i+1}</b>{x}</button>)}</div>
 {step===1&&<div className="wizardGrid"><label>Título do lançamento *<input value={form.title} onChange={e=>set('title',e.target.value)} placeholder="Ex.: Amanhã De Manhã"/></label><label>Tipo *<select value={form.type} onChange={e=>set('type',e.target.value)}>{releaseTypes.map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></label><label>Género<select value={form.genreId} onChange={e=>set('genreId',e.target.value)}><option value="">Selecionar género</option>{genres.map(g=><option value={g.id} key={g.id}>{g.name}</option>)}</select></label><label>Idioma<input value={form.language} onChange={e=>set('language',e.target.value)}/></label><label>País do artista<input value={form.country} onChange={e=>set('country',e.target.value)}/></label><label>Data de lançamento<input type="date" value={form.releaseDate} onChange={e=>set('releaseDate',e.target.value)}/></label><label>Pré-lançamento<input type="date" value={form.preReleaseDate} onChange={e=>set('preReleaseDate',e.target.value)}/></label><label>Editora / Label<input value={form.labelName} onChange={e=>set('labelName',e.target.value)} placeholder="Opcional"/></label><label className="wide">Descrição<textarea value={form.description} onChange={e=>set('description',e.target.value)} placeholder="Apresentação do lançamento"/></label><label>UPC / EAN<input value={form.upc} onChange={e=>set('upc',e.target.value)}/></label><label>℗ Direitos fonográficos<input value={form.phonographicCopyright} onChange={e=>set('phonographicCopyright',e.target.value)}/></label><label>© Direitos autorais<input value={form.copyrightText} onChange={e=>set('copyrightText',e.target.value)}/></label></div>}
 {step===2&&<div className="tracksWizard"><div className="tracksToolbar"><div><small>FAIXAS DO LANÇAMENTO</small><h3>{tracks.length} {tracks.length===1?'faixa':'faixas'}</h3><p>Adiciona quantas faixas o álbum ou EP precisar. Cada faixa tem os seus próprios dados e o seu próprio áudio.</p></div><button type="button" className="primary" onClick={addTrack}>＋ Adicionar faixa</button></div>
 {tracks.map((t,i)=><div className="trackCard" key={t.id}><div className="trackCardHead"><div><span className="trackNumber">{i+1}</span><div><small>FAIXA {i+1}</small><h3>{t.title||'Nova faixa'}</h3></div></div><div className="trackCardActions"><button type="button" className="outline" onClick={()=>moveTrack(i,-1)} disabled={i===0}>↑</button><button type="button" className="outline" onClick={()=>moveTrack(i,1)} disabled={i===tracks.length-1}>↓</button><button type="button" className="outline" onClick={()=>duplicateTrack(i)}>Duplicar</button><button type="button" className="outline danger" onClick={()=>removeTrack(i)} disabled={tracks.length===1}>Remover</button></div></div>
 <div className="wizardGrid"><label>Título da faixa *<input value={t.title} onChange={e=>updateTrack(i,'title',e.target.value)} placeholder="Título da música"/></label><label>Versão<input value={t.version} onChange={e=>updateTrack(i,'version',e.target.value)} placeholder="Original, Remix, Live..."/></label><label>Idioma da faixa<input value={t.language} onChange={e=>updateTrack(i,'language',e.target.value)}/></label><label>Género da faixa<select value={t.genreId} onChange={e=>updateTrack(i,'genreId',e.target.value)}><option value="">Usar género do lançamento</option>{genres.map(g=><option value={g.id} key={g.id}>{g.name}</option>)}</select></label><label>ISRC<input value={t.isrc} onChange={e=>updateTrack(i,'isrc',e.target.value)} placeholder="Opcional"/></label><label>Participação / Feat.<input value={t.featuredArtists} onChange={e=>updateTrack(i,'featuredArtists',e.target.value)} placeholder="Ex.: Artista 1, Artista 2"/></label><label>Tipo de áudio<select value={t.audioType} onChange={e=>updateTrack(i,'audioType',e.target.value)}><option value="SONG">Música normal</option><option value="INSTRUMENTAL">Instrumental</option><option value="ACAPELLA">Acapella</option><option value="LIVE">Live</option><option value="REMIX">Remix</option><option value="COVER">Cover</option></select></label><label>Uso de IA<select value={t.aiGenerated} onChange={e=>updateTrack(i,'aiGenerated',e.target.value)}><option value="NO">Não usei IA</option><option value="PARTIAL">Usei IA parcialmente</option><option value="FULL">Feita integralmente com IA</option></select></label><label className="wide">Onde a IA foi usada<input value={t.aiUsage} onChange={e=>updateTrack(i,'aiUsage',e.target.value)} placeholder="Ex.: voz, beat, letra, produção, masterização"/></label><label className="wide">Letra da música<textarea value={t.lyrics} onChange={e=>updateTrack(i,'lyrics',e.target.value)} placeholder="Cole aqui a letra. Para instrumental/acapella sem letra, deixe vazio."/></label><label className="wide check"><input type="checkbox" checked={t.isExplicit} onChange={e=>updateTrack(i,'isExplicit',e.target.checked)}/> Conteúdo explícito</label>{t.isExplicit&&<label className="wide">Motivo/descrição do explícito<textarea value={t.explicitReason} onChange={e=>updateTrack(i,'explicitReason',e.target.value)}/></label>}
 <div className="credits wide"><h3>Créditos</h3><label>Compositor(es)<input value={t.composer} onChange={e=>updateTrack(i,'composer',e.target.value)}/></label><label>Letrista(s)<input value={t.lyricist} onChange={e=>updateTrack(i,'lyricist',e.target.value)}/></label><label>Produtor(es)<input value={t.producer} onChange={e=>updateTrack(i,'producer',e.target.value)}/></label><label>Intérprete(s)<input value={t.performer} onChange={e=>updateTrack(i,'performer',e.target.value)}/></label><label>Editor / Publisher<input value={t.publisher} onChange={e=>updateTrack(i,'publisher',e.target.value)}/></label></div>
 <div className="credits wide"><h3>Declaração de direitos</h3><label>Titular principal *<input value={t.rightsHolder} onChange={e=>updateTrack(i,'rightsHolder',e.target.value)} placeholder="Nome do titular / artista"/></label><label>Papel<select value={t.rightsRole} onChange={e=>updateTrack(i,'rightsRole',e.target.value)}><option value="RIGHTS_HOLDER">Titular de direitos</option><option value="ARTIST">Artista</option><option value="COMPOSER">Compositor</option><option value="LYRICIST">Letrista</option><option value="PRODUCER">Produtor</option><option value="PERFORMER">Intérprete</option><option value="PUBLISHER">Publisher</option><option value="LABEL">Label</option></select></label><label>Tipo de direito<select value={t.rightsType} onChange={e=>updateTrack(i,'rightsType',e.target.value)}><option value="STREAMING">Streaming</option><option value="DOWNLOAD">Download</option><option value="DISTRIBUTION">Distribuição</option><option value="VIDEO">Vídeo</option><option value="ADS">Publicidade</option><option value="SYNC">Sync</option></select></label><label>Percentagem<input type="number" min="0" max="100" step="0.01" value={t.rightsPercentage} onChange={e=>updateTrack(i,'rightsPercentage',e.target.value)}/></label><label>Território<input value={t.rightsTerritory} onChange={e=>updateTrack(i,'rightsTerritory',e.target.value)}/></label></div>
 <div className="trackAudio wide"><div><small>ÁUDIO DA FAIXA {i+1}</small><b>{t.audioName||'Ainda não enviado'}</b><p>Depois do upload, o áudio pode ser ouvido, substituído ou apagado.</p>{t.audioUrl&&<AudioTrackEditor track={t} index={i} token={token} onUpdate={updateTrack} onMessage={setMsg} onBusy={setBusy}/>}</div><div className="audioUploadActions"><UploadBox title={t.audioUrl?'Substituir áudio':'Adicionar áudio'} accept="audio/wav,audio/x-wav,audio/flac,audio/mpeg,.wav,.flac,.mp3" name={t.audioName} progress={uploadProgress[t.id]||0} onChange={async f=>{try{setBusy(true);setUploadProgress(v=>({...v,[t.id]:0}));const probe=new Audio();const objectUrl=URL.createObjectURL(f);probe.src=objectUrl;await new Promise<void>(resolve=>{probe.onloadedmetadata=()=>resolve();probe.onerror=()=>resolve()});const dur=Number.isFinite(probe.duration)?Math.round(probe.duration*1000):0;URL.revokeObjectURL(objectUrl);const url=await upload(f,'audio',t.id);updateTrack(i,'audioUrl',url);updateTrack(i,'audioName',f.name);updateTrack(i,'durationMs',dur);updateTrack(i,'promoStartMs',0);updateTrack(i,'promoEndMs',Math.min(dur,59000));setMsg(`Áudio da Faixa ${i+1} enviado e pronto para reprodução.`);}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}}/>{t.audioUrl&&<button type="button" className="outline danger" onClick={async()=>{if(!confirm('Apagar o áudio desta faixa?'))return;try{setBusy(true);const key=String(t.audioUrl||'').split('/').pop()||'';if(key){const r=await fetch(API+`/api/uploads?key=${encodeURIComponent(key)}`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`}});const d=await r.json();if(!r.ok)throw Error(d.error||'Não foi possível apagar o áudio no servidor');}updateTrack(i,'audioUrl','');updateTrack(i,'audioName','');updateTrack(i,'durationMs',0);updateTrack(i,'promoStartMs',0);updateTrack(i,'promoEndMs',0);setMsg(`Áudio da Faixa ${i+1} apagado.`);}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}}>🗑️ Apagar áudio</button>}</div></div></div></div>)}
 <div className="addTrackBottom"><button type="button" className="primary" onClick={addTrack}>＋ Adicionar outra faixa</button><span>{tracks.length} {tracks.length===1?'faixa pronta':'faixas prontas'} para este lançamento</span></div></div>}
 {step===3&&<div className="uploadGrid"><div className="coverUploadPanel"><UploadBox title={form.coverUrl?'Substituir capa':'Capa'} accept="image/jpeg,image/png" name={form.coverName} progress={uploadProgress.cover||0} onChange={async f=>{try{setBusy(true);const url=await upload(f,'cover','cover');set('coverUrl',url);set('coverName',f.name);setMsg('Capa enviada.');}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}}/>{form.coverUrl&&<div className="coverPreview"><img src={form.coverUrl} alt="Pré-visualização da capa"/><div><b>Pré-visualização</b><small>600×600 px · {form.coverName}</small><button type="button" className="outline danger" onClick={()=>{set('coverUrl','');set('coverName','');setMsg('Capa removida do rascunho.')}}>🗑️ Remover capa</button></div></div>}</div><div className="rules"><h3>Ficheiros do lançamento</h3><p>✓ Cada faixa já tem o seu próprio áudio na etapa <b>Faixas</b>.</p><p>✓ Capa: JPG/PNG, exatamente 600×600 px.</p><p>✓ Áudio: WAV/FLAC preferencial; MP3 aceite.</p><p>✓ Evitar QR codes, URLs, preços e logótipos não autorizados na capa.</p><p>✓ O lançamento começa como <b>DRAFT</b> até passar pela análise técnica e de direitos.</p></div></div>}
 {step===4&&<div className="review"><div><small>LANÇAMENTO</small><h3>{form.title||'Sem título'} · {form.type}</h3><p>{form.language} · {form.country} · {form.releaseDate||'Data não definida'}</p></div><div><small>FAIXAS</small><h3>{tracks.length} {tracks.length===1?'faixa':'faixas'}</h3>{tracks.map((t,i)=><div className="reviewTrack" key={t.id}><b>{i+1}. {t.title||'Sem título'}</b><p>{t.audioName?'✓ '+t.audioName:'⚠ Áudio não enviado'} · {t.audioType} · {t.isExplicit?'Explícita':'Sem explícito'}</p><p>{t.composer||'Compositor não informado'} · {t.lyricist||'Letrista não informado'}{t.featuredArtists?' · Feat.: '+t.featuredArtists:''}</p></div>)}</div><div><small>FICHEIROS</small><p>{form.coverName?'✓ '+form.coverName:'⚠ Capa não enviada'}</p></div><div className="reviewNotice"><b>Direitos declarados por faixa</b><p>{tracks.every(t=>t.rightsHolder&&Number(t.rightsPercentage)===100)?'✓ Todas as faixas têm titular e 100% declarado.':'⚠ Verifica as declarações de direitos.'}</p><small>A submissão só será aceite quando o preflight técnico passar e os direitos declarados estiverem completos.</small></div>{preflight&&<div className={preflight.status==='PASSED'?'preflightOk':'preflightFail'}><b>{preflight.status==='PASSED'?'✓ Preflight aprovado':'✕ Preflight encontrou problemas'}</b>{preflight.errors?.map((x:string,i:number)=><p key={i}>{x}</p>)}</div>}<div className="wizardActions"><button className="outline" onClick={onClose}>Fechar</button>{releaseId&&<><button className="primary" disabled={busy} onClick={async()=>{setBusy(true);setMsg('A executar preflight...');try{const r=await fetch(API+`/api/releases/${releaseId}/preflight`,{method:'POST',headers:{Authorization:`Bearer ${token}`}});const d=await r.json();if(!r.ok)throw Error(d.error||'Falha no preflight');setPreflight(d.preflight);setMsg(d.preflight.status==='PASSED'?'Preflight concluído. Agora confirma o pagamento na aba 5.':'Corrige os problemas indicados e executa novamente.');}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}}>{busy?'A verificar…':preflight?.status==='PASSED'?'Preflight aprovado':'Executar preflight'}</button>{preflight?.status==='PASSED'&&<button className="primary" disabled={busy||!paymentPaid} onClick={async()=>{setBusy(true);setMsg('A submeter para aprovação...');try{if(!paymentPaid){await loadPayment(releaseId!);if(!paymentPaid)throw Error('O pagamento do lançamento ainda não foi confirmado. Vai à aba Pagamento e conclui o pagamento antes de lançar.');}const r=await fetch(API+`/api/releases/${releaseId}/submit-approval`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}});const d=await r.json();if(!r.ok)throw Error(d.error||'Não foi possível submeter');setMsg('✓ Lançamento enviado para aprovação da equipa BaBuLo Play.');}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}}>{paymentPaid?'Lançar lançamento':'🔒 Pagar primeiro para lançar'}</button>}</>}</div></div>}
 {step===5&&<div className="paymentPanel"><div className="paymentHero"><small>PAGAMENTO DO LANÇAMENTO</small><h3>{form.title||'Novo lançamento'}</h3><p>Escolhe o alcance da distribuição. O pagamento fica associado somente a este lançamento.</p></div>{paymentProduct&&<div className="distributionPlans"><label className={distributionMode==='MAIN'?'planCard selected':'planCard'}><input type="radio" name="distributionMode" checked={distributionMode==='MAIN'} onChange={()=>setDistributionMode('MAIN')}/><div><b>Plataformas principais</b><small>Incluídas no preço base</small><p>Spotify · Apple Music · TikTok · Instagram · Facebook · iTunes Store · Amazon · Shazam · SoundCloud · Deezer · Pandora · Boomplay · JOOX · YouTube</p></div><strong>{Number(paymentProduct.amount).toLocaleString('pt-AO')} {paymentProduct.currency}</strong></label><label className={distributionMode==='ALL'?'planCard selected':'planCard'}><input type="radio" name="distributionMode" checked={distributionMode==='ALL'} onChange={()=>setDistributionMode('ALL')}/><div><b>Todas as 33 plataformas</b><small>Preço base + 50%</small><p>Inclui todas as plataformas e destinos disponíveis no BaBuLo Play.</p></div><strong>{(Number(paymentProduct.amount)*1.5).toLocaleString('pt-AO')} {paymentProduct.currency}</strong></label></div>}{paymentProduct&&<div className="paymentAmount"><span>{distributionMode==='ALL'?'Distribuição completa (+50%)':'Distribuição principal'}</span><strong>{(distributionMode==='ALL'?Number(paymentProduct.amount)*1.5:Number(paymentProduct.amount)).toLocaleString('pt-AO')} {paymentProduct.currency}</strong></div>} {paymentProduct&&<div className="paymentStatus"><b>💰 Saldo dos streams</b><p>Disponível: <strong>{walletBalance.toLocaleString('pt-AO')} AOA</strong></p>{walletBalance>0&&<p>O BaBuLo Play usa primeiro o saldo acumulado dos teus streams. Se não chegar, pagas somente a diferença.</p>}{walletApplied>0&&<p>Saldo já aplicado neste pagamento: <strong>{walletApplied.toLocaleString('pt-AO')} AOA</strong></p>}{externalDue>0&&<p>Diferença a pagar: <strong>{externalDue.toLocaleString('pt-AO')} AOA</strong></p>}</div>}<div className="platformSelection"><h3>Destinos selecionados</h3><div className="platformPills">{(distributionMode==='ALL'?(distribution?.allPlatformCodes||[]):(distribution?.mainPlatformCodes||[])).map((code:string)=><span key={code}>{code.replaceAll('_',' ')}</span>)}</div></div><div className="paymentStatus"><b>{paymentPaid?'✓ Pagamento confirmado':'⏳ Pagamento pendente'}</b><p>{paymentPaid?(distributionMode==='ALL'?'A distribuição completa está paga.':'O pagamento base está confirmado. Se escolheres todas as plataformas, será criado apenas o pagamento adicional de 50%.'):'O pagamento é obrigatório. O sistema usa primeiro o saldo acumulado dos streams e, se necessário, cobra apenas a diferença. Sem pagamento confirmado, o lançamento permanece bloqueado.'}</p></div>{!paymentPaid&&<><label>Forma de pagamento<select value={paymentMethod} onChange={e=>setPaymentMethod(e.target.value)}><option value="WALLET">💰 Saldo dos streams (usar primeiro)</option><option value="MULTICAIXA_EXPRESS">Multicaixa Express</option><option value="MULTICAIXA_REFERENCE">Multicaixa — Referência</option><option value="VISA">Visa</option><option value="MASTERCARD">Mastercard</option></select></label>{paymentMethod==='WALLET'&&walletBalance>0&&<label>Método para a diferença, se necessário<select value={fallbackPaymentMethod} onChange={e=>setFallbackPaymentMethod(e.target.value)}><option value="MULTICAIXA_EXPRESS">Multicaixa Express</option><option value="MULTICAIXA_REFERENCE">Multicaixa — Referência</option><option value="VISA">Visa</option><option value="MASTERCARD">Mastercard</option></select></label>}<button type="button" className="primary" disabled={busy} onClick={createPayment}>{busy?'A processar…':paymentMethod==='WALLET'?(walletBalance>=((distributionMode==='ALL'?Number(paymentProduct?.amount||0)*1.5:Number(paymentProduct?.amount||0)))?'💰 Pagar com saldo dos streams':'💰 Usar saldo + pagar diferença'):(distributionMode==='ALL'?'💳 Pagar distribuição completa':'💳 Pagar lançamento')}</button></>}{payment&&<div className="paymentReceipt"><p><b>Estado:</b> {payment.status}</p><p><b>Referência:</b> {payment.reference}</p><p><b>Valor:</b> {Number(payment.amount).toLocaleString('pt-AO')} {payment.currency}</p><small>Os pagamentos de lançamento não são reembolsáveis. Depois de efetuares o pagamento, aguarda a confirmação e atualiza o estado.</small></div>}<button type="button" className="outline" onClick={async()=>{if(releaseId){try{setBusy(true);await loadPayment(releaseId)}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}}} disabled={busy}>↻ Atualizar estado do pagamento</button><div className="nonRefundable"><b>⚠ Pagamentos não reembolsáveis</b><p>Os valores pagos devem ser utilizados em lançamentos. Se o saldo ou pagamento não for suficiente, o artista deverá acrescentar a diferença.</p></div></div>}
 {msg&&<div className={msg.startsWith('Rascunho criado')||msg.includes('enviado.')?'successMsg':'formError'}>{msg}</div>}
 <div className="wizardActions"><button className="outline" onClick={step===1?onClose:()=>setStep(s=>s-1)}>{step===1?'Cancelar':'← Voltar'}</button>{step<3?<button className="primary" onClick={next}>Continuar →</button>:step===3?<button className="primary" onClick={next} disabled={busy}>Rever lançamento →</button>:step===4?<><button className="outline" onClick={goPayment} disabled={busy}>💳 Ir para pagamento</button><button className="primary" onClick={finish} disabled={busy}>{busy?'A guardar...':'✓ Guardar rascunho'}</button></>:<button className="primary" onClick={()=>setStep(4)}>← Voltar à revisão</button>}</div></div></div>
}
function AudioTrackEditor({track,index,onUpdate,onMessage,onBusy}:{track:WizardTrack;index:number;token:string;onUpdate:(i:number,k:string,v:any)=>void;onMessage:(m:string)=>void;onBusy:(v:boolean)=>void}){
 const ref=useRef<HTMLAudioElement|null>(null);const [playing,setPlaying]=useState(false);const [localDur,setLocalDur]=useState(track.durationMs/1000||0);
 useEffect(()=>{if(!ref.current)return;const a=ref.current;const onMeta=()=>{setLocalDur(a.duration||track.durationMs/1000||0);if(!track.promoEndMs)onUpdate(index,'promoEndMs',Math.min((a.duration||59)*1000,59000))};const onEnd=()=>setPlaying(false);a.addEventListener('loadedmetadata',onMeta);a.addEventListener('ended',onEnd);return()=>{a.removeEventListener('loadedmetadata',onMeta);a.removeEventListener('ended',onEnd)}} ,[track.audioUrl]);
 const toggle=()=>{if(!ref.current)return;if(ref.current.paused){ref.current.play();setPlaying(true)}else{ref.current.pause();setPlaying(false)}};
 const start=track.promoStartMs/1000,end=track.promoEndMs/1000;const maxStart=Math.max(0,Math.floor(localDur-59));const valid=localDur>=59&&Math.round(end-start)===59;
 const setStart=(s:number)=>{const safe=Math.max(0,Math.min(maxStart,Math.round(s)));onUpdate(index,'promoStartMs',safe*1000);onUpdate(index,'promoEndMs',Math.min(localDur,safe+59)*1000)};
 const setEnd=(e:number)=>{const safe=Math.max(59,Math.min(localDur,Math.round(e)));const nextStart=Math.max(0,Math.min(maxStart,safe-59));const nextEnd=Math.min(localDur,nextStart+59);onUpdate(index,'promoStartMs',nextStart*1000);onUpdate(index,'promoEndMs',nextEnd*1000);};
 const preview=()=>{if(!ref.current||!valid)return;ref.current.currentTime=start;ref.current.play();setPlaying(true);};
 return <div className="audioEditor"><audio ref={ref} src={track.audioUrl} preload="metadata"/><div className="audioControls"><button type="button" className="primary" onClick={toggle}>{playing?'⏸ Pausar':'▶ Reproduzir'}</button><button type="button" className="outline" onClick={preview} disabled={!valid}>▶ Pré-visualizar trecho</button><span>{Math.round(localDur/60)}:{String(Math.floor(localDur%60)).padStart(2,'0')}</span></div>
 <div className="clipEditor"><b>✂️ Trecho promocional para TikTok e redes sociais</b><small>Arrasta livremente o marcador 🟢 de início ou o 🔴 de fim. Ao mover qualquer um, o outro acompanha para manter exatamente <strong>59 segundos</strong>.</small>
 <div className="clipTimeline"><div className="clipSelected" style={{left:`${localDur?start/localDur*100:0}%`,width:`${localDur?Math.max(0,end-start)/localDur*100:0}%`}}/><div className="clipMarker start" style={{left:`${localDur?start/localDur*100:0}%`}}/><div className="clipMarker end" style={{left:`${localDur?end/localDur*100:0}%`}}/></div>
 <div className="clipSliders"><label className="clipSliderLabel">🟢 Mover início <input aria-label="Marcador de início" className="clipRange" type="range" min="0" max={maxStart} step="1" value={Math.min(start,maxStart)} onChange={e=>setStart(Number(e.target.value))}/></label><label className="clipSliderLabel">🔴 Mover fim <input aria-label="Marcador de fim" className="clipRange clipRangeEnd" type="range" min="59" max={Math.max(59,localDur)} step="1" value={Math.min(Math.max(end,59),Math.max(59,localDur))} onChange={e=>setEnd(Number(e.target.value))}/></label></div>
 <div className="clipTimes"><label>🟢 Início (seg.)<input type="number" min="0" max={maxStart} step="1" value={start} onChange={e=>setStart(Number(e.target.value))}/></label><label>🔴 Fim (seg.)<input type="number" min="59" max={localDur||59} step="1" value={end} onChange={e=>setEnd(Number(e.target.value))}/></label></div>
 <p className={valid?'clipValid':'clipInvalid'}>{valid?'✓ Trecho válido:':'⚠ Ajusta os marcadores:'} {Math.floor(start/60)}:{String(Math.floor(start%60)).padStart(2,'0')} → {Math.floor(end/60)}:{String(Math.floor(end%60)).padStart(2,'0')} · <strong>{Math.max(0,end-start).toFixed(0)}s</strong></p>
 </div></div>}

function UploadBox({title,accept,name,progress=0,onChange}:{title:string;accept:string;name:string;progress?:number;onChange:(f:File)=>void}){return <label className="uploadBox"><span>＋</span><b>{title}</b><small>{name||'Selecionar ficheiro'}</small><em>{title==='Capa'?'JPG/PNG · quadrado':'WAV / FLAC / MP3'}</em>{progress>0&&progress<100&&<div className="uploadProgress"><div className="uploadProgressTop"><small>A carregar…</small><b>{progress}%</b></div><div className="uploadProgressBar"><span style={{width:`${progress}%`}}/></div></div>}{progress>=100&&<div className="uploadSuccess">✓ Upload concluído</div>}<input type="file" accept={accept} onChange={e=>{const f=e.target.files?.[0];if(f)onChange(f)}}/></label>}
