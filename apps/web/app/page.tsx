'use client';
import { useEffect, useMemo, useRef, useState } from 'react';

type Track={id:string;title:string;artist:string;genre:string;coverUrl:string|null;audioUrl?:string};
type Release={id:string;title:string;type:string;cover_url?:string|null;status?:string};
const API=process.env.NEXT_PUBLIC_API_URL||'http://localhost:4000';
const img={logo:'/media/babulo-play-logo.jpg',cover:'/media/amanha-de-manha.jpeg',face:'/media/young-black-baby-portrait.jpeg',main:'/media/young-black-baby-main.jpg',live:'/media/young-black-baby-live.jpeg'};
const demoTracks:Track[]=[
 {id:'1',title:'Amanhã De Manhã',artist:'Young Black Baby',genre:'Rap / Hip-Hop',coverUrl:img.cover,audioUrl:'/media/amanha-de-manha.mp3'},
 {id:'2',title:'Ao Vivo',artist:'Young Black Baby',genre:'Performance',coverUrl:img.live},
 {id:'3',title:'Amanhã De Manhã — Remix',artist:'Young Black Baby',genre:'Afro Rap',coverUrl:img.cover},
 {id:'4',title:'Young Black Baby',artist:'Young Black Baby',genre:'Artista em destaque',coverUrl:img.face},
];
const nav=['Início','Explorar','Biblioteca','Playlists','Artistas','Álbuns','Géneros','Premium'];
const releaseTypes=[['SINGLE','Single'],['EP','EP'],['ALBUM','Álbum'],['ALBUM_PRO','Álbum Pro']];
export default function Home(){
 const [tracks,setTracks]=useState<Track[]>(demoTracks),[current,setCurrent]=useState<Track|null>(null),[query,setQuery]=useState(''),[playing,setPlaying]=useState(false),[menu,setMenu]=useState('Início');
 const [authOpen,setAuthOpen]=useState(false),[authMode,setAuthMode]=useState<'login'|'register'>('login'),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[stageName,setStageName]=useState(''),[accountRole,setAccountRole]=useState<'LISTENER'|'ARTIST'>('LISTENER'),[authMsg,setAuthMsg]=useState('');
 const [token,setToken]=useState<string|null>(null),[me,setMe]=useState<any>(null),[dashboard,setDashboard]=useState(false);
 const audioRef=useRef<HTMLAudioElement|null>(null);
const [currentTime,setCurrentTime]=useState(0);
const [duration,setDuration]=useState(0);
const [audioError,setAudioError]=useState('');
 const [releaseOpen,setReleaseOpen]=useState(false),[releases,setReleases]=useState<Release[]>([]),[releaseMsg,setReleaseMsg]=useState(''); const [distOpen,setDistOpen]=useState(false);
 useEffect(()=>{fetch(`${API}/api/tracks`).then(r=>r.json()).then(d=>{if(d.tracks?.length)setTracks(d.tracks.map((t:Track)=>t.title==='Amanhã De Manhã'?{...t,audioUrl:t.audioUrl||'/media/amanha-de-manha.mp3'}:t)))}).catch(()=>{}); const t=localStorage.getItem('babulo_token'); if(t){setToken(t);fetch(`${API}/api/auth/me`,{headers:{Authorization:`Bearer ${t}`}}).then(r=>r.ok?r.json():null).then(setMe).catch(()=>{});}},[]);
 useEffect(()=>{
  if(!audioRef.current||!current?.audioUrl)return;

  audioRef.current.src=current.audioUrl;
  audioRef.current.currentTime=0;

  audioRef.current.play()
    .then(()=>setPlaying(true))
    .catch(()=>setAudioError('Clique novamente em ▶ para iniciar.'));
},[current]);
 
 const filtered=useMemo(()=>tracks.filter(t=>`${t.title} ${t.artist} ${t.genre}`.toLowerCase().includes(query.toLowerCase())),[tracks,query]);
 function play(t:Track){
  setCurrent(t);
  setPlaying(true);
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

function formatTime(value:number){
  if(!Number.isFinite(value))return '0:00';
  const minutes=Math.floor(value/60);
  const seconds=Math.floor(value%60).toString().padStart(2,'0');
  return `${minutes}:${seconds}`;
}
 async function submitAuth(e:React.FormEvent){e.preventDefault();setAuthMsg(''); const url=authMode==='login'?'/api/auth/login':'/api/auth/register'; const body=authMode==='login'?{email,password}:{email,password,role:accountRole,stageName:accountRole==='ARTIST'?stageName:undefined}; try{const r=await fetch(API+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||'Não foi possível continuar');localStorage.setItem('babulo_token',d.token);setToken(d.token);const mr=await fetch(API+'/api/auth/me',{headers:{Authorization:`Bearer ${d.token}`}});setMe(mr.ok?await mr.json():d);setAuthOpen(false);setAuthMsg('');}catch(err:any){setAuthMsg(err.message)}}
 function logout(){localStorage.removeItem('babulo_token');setToken(null);setMe(null);setDashboard(false);setReleases([])}
 async function loadReleases(){if(!token)return;const r=await fetch(API+'/api/artists/me/releases',{headers:{Authorization:`Bearer ${token}`}});const d=await r.json();if(r.ok)setReleases(d.releases||[])}
 const isArtist=me?.user?.role==='ARTIST'||me?.role==='ARTIST';
 return <main className="app">
  <aside className="sidebar"><div className="logoWrap"><img src={img.logo} alt="BaBuLo Play"/></div><div className="navGroup">{nav.map((n,i)=><button key={n} className={menu===n?'active':''} onClick={()=>setMenu(n)}><span>{['⌂','◉','▣','♫','♙','◉','♬','★'][i]}</span>{n}</button>)}</div><div className="library"><p>SUA BIBLIOTECA</p><button>♡ Músicas Curtidas</button><button>⇩ Downloads</button><button>◷ Histórico</button></div><div className="sidePremium"><img src={img.logo} alt=""/><b>BaBuLo Premium</b><span>Mais música. Menos anúncios.</span><button>Conhecer Premium</button></div></aside>
  <section className="content"><header className="topbar"><div className="mobileBrand"><img src={img.logo} alt="BaBuLo Play"/></div><div className="search"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Pesquisar artistas, músicas, álbuns, playlists..."/></div><button className="bell">♧</button>{token?<div className="profile clickable" onClick={()=>{setDashboard(!dashboard);if(!dashboard&&isArtist)loadReleases()}}><img src={img.face} alt="Perfil"/><div><b>{me?.user?.email||'Minha conta'}</b><small>{isArtist?'Artista':'Ouvinte'}</small></div><span>⌄</span></div>:<button className="loginTop" onClick={()=>{setAuthMode('login');setAuthOpen(true)}}>Entrar</button>}</header>
   {dashboard&&token&&<section className="dashboard"><div><small>ÁREA AUTENTICADA</small><h2>{isArtist?'Painel do Artista':'Minha conta'}</h2><p>{isArtist?'Prepara, valida e envia os teus lançamentos para a equipa BaBuLo.':'A tua conta de ouvinte está ligada ao backend.'}</p>{isArtist&&<><button className="primary" onClick={()=>{setReleaseOpen(true);setReleaseMsg('')}}>＋ Novo lançamento</button><button className="outline" onClick={()=>setDistOpen(true)}>⇧ Distribuição</button></>}</div>{isArtist&&<div className="releaseList"><h3>Os meus lançamentos</h3>{releases.length?<div>{releases.map(r=><div className="releaseRow" key={r.id}><span>{r.title}</span><small>{r.type} · {r.status||'DRAFT'}</small></div>)}</div>:<p>Nenhum lançamento criado ainda.</p>}</div>}<button className="outline" onClick={logout}>Sair</button></section>}
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

  <button onClick={togglePlay} disabled={!current.audioUrl}>
    {playing?'Ⅱ':'▶'}
  </button>

  <div className="progress">
    <span style={{width:duration?`${(currentTime/duration)*100}%`:'0%'}}/>
  </div>

  <small>{formatTime(currentTime)} / {formatTime(duration)}</small>

  <button>↗</button>

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
  }}
  onError={()=>setAudioError('Não foi possível carregar o áudio.')}
/>
  
  {distOpen&&token&&<DistributionPanel token={token} releases={releases} onClose={()=>setDistOpen(false)}/>}{releaseOpen&&token&&<ReleaseWizard token={token} onClose={()=>setReleaseOpen(false)} onDone={()=>{setReleaseOpen(false);loadReleases()}}/>}
  {authOpen&&<div className="modalBackdrop" onMouseDown={()=>setAuthOpen(false)}><div className="authModal" onMouseDown={e=>e.stopPropagation()}><button className="modalClose" onClick={()=>setAuthOpen(false)}>✕</button><img src={img.logo} alt="BaBuLo Play"/><h2>{authMode==='login'?'Entrar na BaBuLo Play':'Criar conta'}</h2><form onSubmit={submitAuth}>{authMode==='register'&&<><div className="roleSwitch"><button type="button" className={accountRole==='LISTENER'?'selected':''} onClick={()=>setAccountRole('LISTENER')}>Ouvinte</button><button type="button" className={accountRole==='ARTIST'?'selected':''} onClick={()=>setAccountRole('ARTIST')}>Artista</button></div>{accountRole==='ARTIST'&&<input value={stageName} onChange={e=>setStageName(e.target.value)} placeholder="Nome artístico" required/>}</>}<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email" required/><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Palavra-passe (mín. 8 caracteres)" required/><button className="primary full">{authMode==='login'?'Entrar':'Criar conta'}</button>{authMsg&&<div className="formError">{authMsg}</div>}</form><button className="switchAuth" onClick={()=>{setAuthMode(authMode==='login'?'register':'login');setAuthMsg('')}}>{authMode==='login'?'Ainda não tenho conta':'Já tenho conta'}</button></div></div>}
 </main>
}

function DistributionPanel({token,releases,onClose}:{token:string;releases:Release[];onClose:()=>void}){
 const [platforms,setPlatforms]=useState<any[]>([]),[orders,setOrders]=useState<any[]>([]),[releaseId,setReleaseId]=useState(''),[product,setProduct]=useState('DIST_SINGLE'),[selected,setSelected]=useState<string[]>([]),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{Promise.all([fetch(API+'/api/distribution/platforms').then(r=>r.json()),fetch(API+'/api/distribution/orders',{headers:{Authorization:'Bearer '+token}}).then(r=>r.json())]).then(([p,o])=>{setPlatforms(p.platforms||[]);setOrders(o.orders||[])})},[token]);
 async function create(){setBusy(true);setMsg('');try{const r=await fetch(API+'/api/distribution/orders',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({releaseId,productCode:product,platformIds:selected})});const d=await r.json();if(!r.ok)throw Error(d.error||'Erro');setMsg('✓ Pedido criado.');setOrders(x=>[d.order,...x])}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}
 async function submit(id:string){const r=await fetch(API+'/api/distribution/orders/'+id+'/submit',{method:'POST',headers:{Authorization:'Bearer '+token}});const d=await r.json();setMsg(r.ok?'✓ '+d.message:d.error);if(r.ok)setOrders(xs=>xs.map(x=>x.id===id?{...x,status:d.status}:x))}
 return <div className="modalBackdrop"><div className="authModal" style={{maxWidth:760}}><button className="modalClose" onClick={onClose}>✕</button><h2>Distribuição Musical</h2><p>Envia lançamentos aprovados para as plataformas selecionadas. A publicação real depende dos conectores oficiais.</p><label>Lançamento<select value={releaseId} onChange={e=>setReleaseId(e.target.value)}><option value="">Selecionar lançamento aprovado</option>{releases.filter(r=>r.status==='APPROVED').map(r=><option key={r.id} value={r.id}>{r.title} · {r.type}</option>)}</select></label><label>Pacote<select value={product} onChange={e=>setProduct(e.target.value)}><option value="DIST_SINGLE">Single — 5.000 Kz</option><option value="DIST_EP">EP — 10.000 Kz</option><option value="DIST_ALBUM">Álbum — 14.000 Kz</option><option value="DIST_ALBUM_PRO">Álbum Pro — 20.000 Kz</option></select></label><div className="credits"><h3>Plataformas</h3>{platforms.map(p=><label className="check" key={p.id}><input type="checkbox" checked={selected.includes(p.id)} onChange={e=>setSelected(x=>e.target.checked?[...x,p.id]:x.filter(id=>id!==p.id))}/>{p.name}</label>)}</div><button className="primary full" disabled={busy||!releaseId||!selected.length} onClick={create}>{busy?'A criar...':'Criar pedido de distribuição'}</button>{msg&&<div className="formError">{msg}</div>}<div className="releaseList"><h3>Histórico de distribuição</h3>{orders.map(o=><div className="releaseRow" key={o.id}><span>{o.release_title}</span><small>{o.product_code} · {o.status} · {o.published_count||0}/{o.platform_count||0} publicados {['READY','FAILED'].includes(o.status)&&<button className="outline" onClick={()=>submit(o.id)}>Submeter</button>}</small></div>)}</div></div></div>
}

function SectionTitle({title,link}:{title:string;link?:string}){return <div className="sectionTitle"><h2>{title}</h2><a>{link||'Ver tudo →'}</a></div>}

function ReleaseWizard({token,onClose,onDone}:{token:string;onClose:()=>void;onDone:()=>void}){
 const [step,setStep]=useState(1); const [releaseId,setReleaseId]=useState<string|null>(null); const [preflight,setPreflight]=useState<any>(null),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false),[genres,setGenres]=useState<any[]>([]);
 const [form,setForm]=useState({title:'',type:'SINGLE',genreId:'',language:'Português',country:'Angola',releaseDate:'',preReleaseDate:'',coverUrl:'',description:'',upc:'',ean:'',labelName:'',phonographicCopyright:'',copyrightText:'',trackTitle:'',trackVersion:'',trackLanguage:'Português',trackGenreId:'',isExplicit:false,explicitReason:'',isrc:'',composer:'',lyricist:'',producer:'',performer:'',publisher:'',audioUrl:'',audioName:'',coverName:'',rightsHolder:'',rightsRole:'RIGHTS_HOLDER',rightsType:'STREAMING',rightsPercentage:'100',rightsTerritory:'WORLDWIDE'});
 useEffect(()=>{fetch(`${API}/api/genres`).then(r=>r.json()).then(d=>setGenres(d.genres||[])).catch(()=>{})},[])
  
  const set=(k:string,v:any)=>setForm(f=>({...f,[k]:v}));
 async function upload(file:File,kind:'audio'|'cover'){const fd=new FormData();fd.append('file',file);fd.append('kind',kind);const r=await fetch(API+'/api/uploads',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:fd});const d=await r.json();if(!r.ok)throw Error(d.error||'Falha no upload');return d.file.url as string}
 function next(){setMsg('');if(step===1&&!form.title.trim())return setMsg('Informe o título do lançamento.');if(step===2&&!form.trackTitle.trim())return setMsg('Informe o título da faixa principal.');if(step===2&&!form.rightsHolder.trim())return setMsg('Informe o titular dos direitos da faixa.');if(step===2&&(Number(form.rightsPercentage)!==100))return setMsg('Para esta primeira declaração, a participação deve totalizar 100%.');setStep(s=>Math.min(4,s+1))}
 async function finish(){setBusy(true);setMsg('');try{let releaseCover=form.coverUrl||null;let audio=form.audioUrl||null;const body={...form,coverUrl:releaseCover};delete (body as any).audioName;delete (body as any).coverName;const rr=await fetch(API+'/api/releases',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});const rd=await rr.json();if(!rr.ok)throw Error(rd.error||'Não foi possível criar o lançamento');const tr=await fetch(API+'/api/tracks',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({title:form.trackTitle,releaseId:rd.release.id,genreId:form.trackGenreId||form.genreId,language:form.trackLanguage,version:form.trackVersion,durationMs:null,isExplicit:form.isExplicit,isrc:form.isrc,originalReleaseDate:form.releaseDate,fileUrl:audio,fileType:'AUDIO',composer:form.composer,lyricist:form.lyricist,producer:form.producer,performer:form.performer,publisher:form.publisher,explicitReason:form.explicitReason})});const td=await tr.json();if(!tr.ok)throw Error(td.error||'Lançamento criado, mas a faixa não pôde ser guardada');
 const holder=form.rightsHolder.trim();
 const rrh=await fetch(API+`/api/releases/${rd.release.id}/rights`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({trackId:td.track.id,partyName:holder,partyRole:form.rightsRole,rightType:form.rightsType,percentage:Number(form.rightsPercentage),territory:form.rightsTerritory})});
 const rhd=await rrh.json();if(!rrh.ok)throw Error(rhd.error||'Lançamento criado, mas a declaração de direitos não pôde ser guardada');
 setReleaseId(rd.release.id);setPreflight(null);setMsg('Rascunho criado com declaração de direitos. Executa o preflight e depois submete para aprovação.');setStep(4)}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}
 return <div className="modalBackdrop"><div className="releaseWizard"><button className="modalClose" onClick={onClose}>✕</button><div className="wizardHead"><img src={img.logo} alt=""/><div><small>NOVO LANÇAMENTO</small><h2>Preparar música para BaBuLo</h2></div></div><div className="steps">{['Lançamento','Faixa','Ficheiros','Revisão'].map((x,i)=><div className={step===i+1?'active':''} key={x}><b>{i+1}</b>{x}</div>)}</div>
 {step===1&&<div className="wizardGrid"><label>Título do lançamento *<input value={form.title} onChange={e=>set('title',e.target.value)} placeholder="Ex.: Amanhã De Manhã"/></label><label>Tipo *<select value={form.type} onChange={e=>set('type',e.target.value)}>{releaseTypes.map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></label><label>Género<select value={form.genreId} onChange={e=>set('genreId',e.target.value)}><option value="">Selecionar género</option>{genres.map(g=><option value={g.id} key={g.id}>{g.name}</option>)}</select></label><label>Idioma<input value={form.language} onChange={e=>set('language',e.target.value)}/></label><label>País do artista<input value={form.country} onChange={e=>set('country',e.target.value)}/></label><label>Data de lançamento<input type="date" value={form.releaseDate} onChange={e=>set('releaseDate',e.target.value)}/></label><label>Pré-lançamento<input type="date" value={form.preReleaseDate} onChange={e=>set('preReleaseDate',e.target.value)}/></label><label>Editora / Label<input value={form.labelName} onChange={e=>set('labelName',e.target.value)} placeholder="Opcional"/></label><label className="wide">Descrição<textarea value={form.description} onChange={e=>set('description',e.target.value)} placeholder="Apresentação do lançamento"/></label><label>UPC / EAN<input value={form.upc} onChange={e=>set('upc',e.target.value)}/></label><label>℗ Direitos fonográficos<input value={form.phonographicCopyright} onChange={e=>set('phonographicCopyright',e.target.value)}/></label><label>© Direitos autorais<input value={form.copyrightText} onChange={e=>set('copyrightText',e.target.value)}/></label></div>}
 {step===2&&<div className="wizardGrid"><label>Título da faixa *<input value={form.trackTitle} onChange={e=>set('trackTitle',e.target.value)} placeholder="Título da música"/></label><label>Versão<input value={form.trackVersion} onChange={e=>set('trackVersion',e.target.value)} placeholder="Original, Remix, Live..."/></label><label>Idioma da faixa<input value={form.trackLanguage} onChange={e=>set('trackLanguage',e.target.value)}/></label><label>Género da faixa<select value={form.trackGenreId} onChange={e=>set('trackGenreId',e.target.value)}><option value="">Usar género do lançamento</option>{genres.map(g=><option value={g.id} key={g.id}>{g.name}</option>)}</select></label><label>ISRC<input value={form.isrc} onChange={e=>set('isrc',e.target.value)} placeholder="Opcional se ainda não atribuído"/></label><label className="wide check"><input type="checkbox" checked={form.isExplicit} onChange={e=>set('isExplicit',e.target.checked)}/> Conteúdo explícito</label>{form.isExplicit&&<label className="wide">Motivo/descrição do explícito<textarea value={form.explicitReason} onChange={e=>set('explicitReason',e.target.value)}/></label>}<div className="credits wide"><h3>Declaração de direitos</h3><p>Indica quem detém os direitos desta faixa. Se houver vários titulares, a equipa poderá adicionar as restantes participações na revisão.</p><label>Titular principal<input value={form.rightsHolder} onChange={e=>set('rightsHolder',e.target.value)} placeholder="Nome do titular / artista"/></label><label>Papel<select value={form.rightsRole} onChange={e=>set('rightsRole',e.target.value)}><option value="RIGHTS_HOLDER">Titular de direitos</option><option value="ARTIST">Artista</option><option value="COMPOSER">Compositor</option><option value="LYRICIST">Letrista</option><option value="PRODUCER">Produtor</option><option value="PERFORMER">Intérprete</option><option value="PUBLISHER">Publisher</option><option value="LABEL">Label</option></select></label><label>Tipo de direito<select value={form.rightsType} onChange={e=>set('rightsType',e.target.value)}><option value="STREAMING">Streaming</option><option value="DOWNLOAD">Download</option><option value="DISTRIBUTION">Distribuição</option><option value="VIDEO">Vídeo</option><option value="ADS">Publicidade</option><option value="SYNC">Sync</option></select></label><label>Percentagem<input type="number" min="0" max="100" step="0.01" value={form.rightsPercentage} onChange={e=>set('rightsPercentage',e.target.value)}/></label><label>Território<input value={form.rightsTerritory} onChange={e=>set('rightsTerritory',e.target.value)}/></label></div><div className="credits wide"><h3>Créditos e direitos</h3><label>Compositor(es)<input value={form.composer} onChange={e=>set('composer',e.target.value)}/></label><label>Letrista(s)<input value={form.lyricist} onChange={e=>set('lyricist',e.target.value)}/></label><label>Produtor(es)<input value={form.producer} onChange={e=>set('producer',e.target.value)}/></label><label>Intérprete(s)<input value={form.performer} onChange={e=>set('performer',e.target.value)}/></label><label>Editor / Publisher<input value={form.publisher} onChange={e=>set('publisher',e.target.value)}/></label></div></div>}
 {step===3&&<div className="uploadGrid"><UploadBox title="Capa" accept="image/jpeg,image/png" name={form.coverName} onChange={async f=>{try{setBusy(true);const url=await upload(f,'cover');set('coverUrl',url);set('coverName',f.name);setMsg('Capa enviada.');}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}}/><UploadBox title="Áudio master" accept="audio/wav,audio/x-wav,audio/flac,audio/mpeg,.wav,.flac,.mp3" name={form.audioName} onChange={async f=>{try{setBusy(true);const url=await upload(f,'audio');set('audioUrl',url);set('audioName',f.name);setMsg('Áudio enviado.');}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}}/><div className="rules"><h3>Pré-validação</h3><p>✓ Capa: JPG/PNG, quadrada, recomendação 3000×3000.</p><p>✓ Áudio: WAV/FLAC preferencial; MP3 aceite.</p><p>✓ Evitar QR codes, URLs, preços e logótipos não autorizados na capa.</p><p>✓ O lançamento começa como <b>DRAFT</b> até passar pela análise técnica e de direitos.</p></div></div>}
 {step===4&&<div className="review"><div><small>LANÇAMENTO</small><h3>{form.title||'Sem título'} · {form.type}</h3><p>{form.language} · {form.country} · {form.releaseDate||'Data não definida'}</p></div><div><small>FAIXA PRINCIPAL</small><h3>{form.trackTitle||'Sem título'}</h3><p>{form.composer||'Compositor não informado'} · {form.lyricist||'Letrista não informado'}</p><p>{form.isExplicit?'Conteúdo explícito':'Sem indicação de conteúdo explícito'}</p></div><div><small>FICHEIROS</small><p>{form.coverName?'✓ '+form.coverName:'⚠ Capa não enviada'}</p><p>{form.audioName?'✓ '+form.audioName:'⚠ Áudio não enviado'}</p></div><div className="reviewNotice"><b>Direitos declarados</b><p>{form.rightsHolder||'Titular declarado pelo artista'} · {form.rightsRole} · {form.rightsType} · {form.rightsPercentage}% · {form.rightsTerritory}</p><small>A submissão só será aceite quando o preflight técnico passar e os direitos declarados totalizarem 100%.</small></div>{preflight&&<div className={preflight.status==='PASSED'?'preflightOk':'preflightFail'}><b>{preflight.status==='PASSED'?'✓ Preflight aprovado':'✕ Preflight encontrou problemas'}</b>{preflight.errors?.map((x:string,i:number)=><p key={i}>{x}</p>)}</div>}<div className="wizardActions"><button className="outline" onClick={onClose}>Fechar</button>{releaseId&&<><button className="primary" disabled={busy} onClick={async()=>{setBusy(true);setMsg('A executar preflight...');try{const r=await fetch(API+`/api/releases/${releaseId}/preflight`,{method:'POST',headers:{Authorization:`Bearer ${token}`}});const d=await r.json();if(!r.ok)throw Error(d.error||'Falha no preflight');setPreflight(d.preflight);setMsg(d.preflight.status==='PASSED'?'Preflight concluído. Agora podes submeter para aprovação.':'Corrige os problemas indicados e executa novamente.');}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}}>{busy?'A verificar…':preflight?.status==='PASSED'?'Preflight aprovado':'Executar preflight'}</button>{preflight?.status==='PASSED'&&<button className="primary" disabled={busy} onClick={async()=>{setBusy(true);setMsg('A submeter para aprovação...');try{const r=await fetch(API+`/api/releases/${releaseId}/submit-approval`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}});const d=await r.json();if(!r.ok)throw Error(d.error||'Não foi possível submeter');setMsg('✓ Lançamento enviado para aprovação da equipa BaBuLo Play.');}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}}>Submeter para aprovação</button>}</>}</div></div>}
 {msg&&<div className={msg.startsWith('Lançamento guardado')?'successMsg':'formError'}>{msg}</div>}<div className="wizardActions"><button className="outline" onClick={step===1?onClose:()=>setStep(s=>s-1)}>{step===1?'Cancelar':'← Voltar'}</button>{step<3?<button className="primary" onClick={next}>Continuar →</button>:step===3?<button className="primary" onClick={next} disabled={busy}>Rever lançamento →</button>:<button className="primary" onClick={finish} disabled={busy}>{busy?'A guardar...':'✓ Guardar rascunho'}</button>}</div></div></div>
}
function UploadBox({title,accept,name,onChange}:{title:string;accept:string;name:string;onChange:(f:File)=>void}){return <label className="uploadBox"><span>＋</span><b>{title}</b><small>{name||'Selecionar ficheiro'}</small><em>{title==='Capa'?'JPG/PNG · quadrado':'WAV / FLAC / MP3'}</em><input type="file" accept={accept} onChange={e=>{const f=e.target.files?.[0];if(f)onChange(f)}}/></label>}
