const noop=()=>{};globalThis.Path2D=class{moveTo(){}lineTo(){}arc(){}rect(){}closePath(){}};
function fakeCtx(){const t={};return new Proxy(t,{get(o,k){if(k==='createImageData')return (w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)});if(k==='getImageData')return (x,y,w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)});if(k==='measureText')return ()=>({width:10});if(k in o)return o[k];return noop;},set(o,k,v){o[k]=v;return true;}});}
globalThis.window={devicePixelRatio:2,matchMedia:()=>({matches:false})};
globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>fakeCtx()})};
const BENCH=(()=>{
const PI=Math.PI,TAU=PI*2;
const S=Math.round(320*Math.min(2,window.devicePixelRatio||1)),D=S/320;
const WELL='#07090c';
const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- kleuren ---------- */
const PALS={
  fosfor:['#07090c','#132259','#2d56d4','#6cc4ea','#eef4f0'],
  gloed:['#07090c','#3b0f2e','#a8352a','#eea13c','#fff3cf'],
  mos:['#07090c','#0c2a26','#1f7a5c','#9fd67a','#f4f7dc'],
  iris:['#07090c','#2a1250','#7a3fc4','#e27bd0','#fbe8f3'],
  duo:['#6cc4ea','#2d56d4','#07090c','#a8352a','#eea13c'],
};
const hex=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
function mix(pal,t){t=Math.max(0,Math.min(1,t));const st=pal.map(hex),f=t*(st.length-1),i=Math.min(st.length-2,Math.floor(f)),u=f-i;return st[i].map((v,j)=>Math.round(v+(st[i+1][j]-v)*u));}
const LUTS={},CSS={};
for(const k in PALS){const a=new Uint32Array(256);for(let i=0;i<256;i++){const [r,g,b]=mix(PALS[k],i/255);a[i]=(255<<24)|(b<<16)|(g<<8)|r;}LUTS[k]=a;
  CSS[k]=Array.from({length:64},(_,i)=>{const [r,g,b]=mix(PALS[k],i/63);return `rgb(${r},${g},${b})`;});}
const pcol=(pal,t)=>CSS[pal][Math.max(0,Math.min(63,Math.round(t*63)))];

function Grid(n){const c=document.createElement('canvas');c.width=c.height=n;const x=c.getContext('2d');const img=x.createImageData(n,n);return{n,c,x,img,px:new Uint32Array(img.data.buffer)};}
function blit(gr,g,pix){gr.x.putImageData(gr.img,0,0);g.ctx.imageSmoothingEnabled=!pix;g.ctx.drawImage(gr.c,0,0,g.S,g.S);}
function clear(g){g.ctx.fillStyle=WELL;g.ctx.fillRect(0,0,g.S,g.S);}
function fade(g,a){g.ctx.fillStyle=`rgba(7,9,12,${a})`;g.ctx.fillRect(0,0,g.S,g.S);}
const rnd=(a,b)=>a+Math.random()*(b-a);
const gauss=()=>Math.sqrt(-2*Math.log(1-Math.random()))*Math.cos(TAU*Math.random());

/* ---------- ruis (Perlin) ---------- */
const PERM=(()=>{const p=[...Array(256).keys()];for(let i=255;i>0;i--){const j=Math.random()*(i+1)|0;[p[i],p[j]]=[p[j],p[i]];}return new Uint8Array([...p,...p]);})();
const fd=t=>t*t*t*(t*(t*6-15)+10),lp=(t,a,b)=>a+t*(b-a);
function gr(h,x,y){const g=h&7,u=g<4?x:y,v=g<4?y:x;return((g&1)?-u:u)+((g&2)?-2*v:2*v);}
function noise(x,y){const fx=Math.floor(x),fy=Math.floor(y),X=fx&255,Y=fy&255;x-=fx;y-=fy;const u=fd(x),v=fd(y),A=PERM[X]+Y,B=PERM[X+1]+Y;
  return lp(v,lp(u,gr(PERM[A],x,y),gr(PERM[B],x-1,y)),lp(u,gr(PERM[A+1],x,y-1),gr(PERM[B+1],x-1,y-1)))*.5;}

/* ---------- knop-helpers ---------- */
const K=(k,l,min,max,step,v,o={})=>({k,l,min,max,step,v,...o});
const SEL=(k,l,opts,v,o={})=>({k,l,opts,v,sel:1,...o});

/* ---------- isomorfe helpers ---------- */
const AON=()=>AU.on&&AU.ctx&&AU.ctx.state==='running';
function modalBuffer(freqs,amps,taus,dur,noise){const C=AU.ctx,sr=C.sampleRate,len=Math.floor(sr*dur),b=C.createBuffer(1,len,sr),d=b.getChannelData(0);
  for(let k=0;k<freqs.length;k++){const f=freqs[k];if(f<=20||f>sr*.45||!amps[k])continue;const w=TAU*f/sr,cr=Math.cos(w),ci=Math.sin(w),r=Math.exp(-1/(taus[k]*sr)),n=Math.min(len,Math.floor(taus[k]*sr*7));let zr=amps[k],zi=0;
    for(let i=0;i<n;i++){d[i]+=zi;const nr=(zr*cr-zi*ci)*r;zi=(zr*ci+zi*cr)*r;zr=nr;}}
  if(noise){const n=Math.floor(sr*.012);for(let i=0;i<n;i++)d[i]+=(Math.random()*2-1)*noise*(1-i/n);}
  const a=Math.floor(sr*.002);for(let i=0;i<a;i++)d[i]*=i/a;let pk=0;for(let i=0;i<len;i++)pk=Math.max(pk,Math.abs(d[i]));if(pk>0)for(let i=0;i<len;i++)d[i]*=.6/pk;return b;}
function playBuf(b,vol,pan){const C=AU.ctx,s=C.createBufferSource(),g=C.createGain(),p=C.createStereoPanner();s.buffer=b;g.gain.value=vol;p.pan.value=Math.max(-1,Math.min(1,pan));s.connect(g);g.connect(p);p.connect(AU.n.bus);s.start();}
const DRUM=[[0,2.4048],[1,3.8317],[2,5.1356],[0,5.5201],[3,6.3802],[1,7.0156],[4,7.5883],[2,8.4172],[0,8.6537],[5,8.7715],[3,9.761],[6,9.9361],[1,10.1735],[4,11.0647],[7,11.0864],[2,11.6198]];
function besselJ(m,x){let s=0;const N=48;for(let i=0;i<N;i++){const u=(i+.5)/N*PI;s+=Math.cos(m*u-x*Math.sin(u));}return s/N;}
let DCACHE=null;
function drumCache(){if(DCACHE)return DCACHE;const N=110,idx=[],rr=[],th=[];
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){const u=(x+.5)/N*2-1,v=(y+.5)/N*2-1,r=Math.hypot(u,v);if(r<=1){idx.push(y*N+x);rr.push(r);th.push(Math.atan2(v,u));}}
  const C=[],S=[],rmax=[];DRUM.forEach(([m,j])=>{let mx=0;for(let i=0;i<=80;i++)mx=Math.max(mx,Math.abs(besselJ(m,j*i/80)));rmax.push(mx);
    const T=new Float32Array(201);for(let i=0;i<=200;i++)T[i]=besselJ(m,j*i/200)/mx;
    const c=new Float32Array(idx.length),s=new Float32Array(idx.length);for(let q=0;q<idx.length;q++){const R=T[Math.round(rr[q]*200)];c[q]=R*Math.cos(m*th[q]);s[q]=R*Math.sin(m*th[q]);}C.push(c);S.push(s);});
  return DCACHE={N,idx:Int32Array.from(idx),C,S,rmax};}
function resample(pts,M){const P=[...pts,pts[0]],L=[0];for(let i=1;i<P.length;i++)L.push(L[i-1]+Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1]));const T=L[L.length-1]||1,out=[];let j=0;
  for(let k=0;k<M;k++){const d=k/M*T;while(j<L.length-2&&L[j+1]<d)j++;const u=(d-L[j])/((L[j+1]-L[j])||1);out.push([P[j][0]+(P[j+1][0]-P[j][0])*u,P[j][1]+(P[j+1][1]-P[j][1])*u]);}return out;}
function fourier(pts){const N=pts.length;let mx=0,my=0;pts.forEach(([x,y])=>{mx+=x;my+=y;});mx/=N;my/=N;let r=1e-9;const z=pts.map(([x,y])=>{const a=x-mx,b=y-my;r=Math.max(r,Math.hypot(a,b));return[a,b];});
  const out=[];for(let n=-N/2;n<N/2;n++){if(!n)continue;let re=0,im=0;for(let k=0;k<N;k++){const a=-TAU*n*k/N,c=Math.cos(a),s=Math.sin(a);re+=z[k][0]*c-z[k][1]*s;im+=z[k][0]*s+z[k][1]*c;}out.push({n,re:re/N/r,im:im/N/r});}
  return out.sort((a,b)=>Math.hypot(b.re,b.im)-Math.hypot(a.re,a.im));}
function epShape(i){const M=256,f=[];
  if(i===0){const v=[];for(let k=0;k<10;k++){const r=k%2?.42:1,a=-PI/2+k*PI/5;v.push([r*Math.cos(a),r*Math.sin(a)]);}return resample(v,M);}
  if(i===2)return resample([[-1,-1],[1,-1],[1,1],[-1,1]],M);
  for(let k=0;k<M;k++){const t=k/M*TAU;let x,y;
    if(i===1){x=16*Math.sin(t)**3;y=-(13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t));}
    else if(i===3){const d=1+Math.sin(t)**2;x=Math.cos(t)/d;y=Math.sin(t)*Math.cos(t)/d;}
    else if(i===4){const r=Math.cos(4*t);x=r*Math.cos(t);y=r*Math.sin(t);}
    else{x=Math.sin(t)+2*Math.sin(2*t);y=Math.cos(t)-2*Math.cos(2*t);}f.push([x,y]);}return f;}

/* ================= SYSTEMEN ================= */
const SYSTEMS=[
/* ===== ISOMORF: beeld en geluid zijn dezelfde data ===== */
{id:'sn',name:'Trillende snaar',sub:'modale synthese · beeld = geluid',cat:'Isomorf',pal:'gloed',
what:'Een geplukte snaar is een som van boventonen (modi). Je ziet precies de modi die je hoort, alleen zo\'n 200× vertraagd. De balkjes onderaan zijn het spectrum op de plek van de opnemer.',
tip:'<b>Probeer:</b> pluk vlak bij de brug voor een schelle, dunne klank. In het midden verdwijnen alle even boventonen en klinkt hij hol. Met stijfheid wordt het piano of bel.',
hint:'klik = plukken',
knobs:[K('toon','toon (trap)',0,14,1,5),K('pos','plukplek',.03,.5,.005,.2),K('pick','opnemer',.05,.95,.01,.83),K('damp','uitklinktijd',.2,4,.05,1.2),K('B','stijfheid',0,.004,.0001,.0004,{rnd:[0,.003]}),K('hel','helderheid',0,1,.01,.55),K('auto','zelf spelen /s',0,4,.05,.8,{fix:1}),K('vol','volume',0,1,.01,.7,{fix:1})],
presets:[['Gitaar',{pos:.18,B:.0002,hel:.55,damp:1.4}],['Harp',{pos:.5,B:0,hel:.3,damp:2}],['Piano',{pos:.12,B:.0025,hel:.7,damp:1.8}],['Klavecimbel',{pos:.06,B:.0006,hel:.95,damp:.8}],['Bel',{pos:.3,B:.004,hel:.8,damp:3}]],
init(s){const M=24,X=160;s.M=M;s.X=X;s.A=new Float32Array(M);s.tau=new Float32Array(M).fill(1);s.t0=0;s.tab=[];s.deg=0;s.next=0;s.E=0;
  for(let n=1;n<=M;n++){const r=new Float32Array(X+1);for(let i=0;i<=X;i++)r[i]=Math.sin(n*PI*i/X);s.tab.push(r);}},
ratio(n,B){return n*Math.sqrt(1+B*n*n);},
strike(s,p,pos,t){const M=s.M,dt=t-s.t0,deg=Math.round(p.toon)+s.deg,f0=mtof(midiFrom(48+AU.root,deg)),fr=[],am=[],ta=[];
  for(let n=1;n<=M;n++){const k=n-1,old=s.A[k]*Math.exp(-dt/s.tau[k])*Math.cos(TAU*.6*this.ratio(n,p.B)*dt),a=2*Math.sin(n*PI*pos)/(n*n*PI*PI*pos*(1-pos)),tau=p.damp*1.6/(1+(1-p.hel)*(n-1)*.45)/Math.sqrt(n*.6+.4);
    s.A[k]=old*.5+a;s.tau[k]=tau;fr.push(f0*this.ratio(n,p.B));am.push(a*Math.sin(n*PI*p.pick));ta.push(tau*.8);}
  s.t0=t;s.e.aanslag=1;s.note=nname(midiFrom(48+AU.root,deg));
  if(AON())playBuf(modalBuffer(fr,am,ta,Math.min(4.5,ta[0]*5),0),p.vol,(pos-.5)*.6);},
act:{aanslaan(s,p){SYSTEMS_BY.sn.strike(s,p,p.pos,performance.now()/1000);}},
pointer(s,p,x,y,down){if(down)this.strike(s,p,Math.min(.97,Math.max(.03,(x-.08)/.84)),performance.now()/1000);},
step(s,p,g){const t=g.t;if(p.auto>0&&t>=s.next){if(s.next){s.deg=Math.max(-4,Math.min(5,s.deg+[-2,-1,0,0,1,2][Math.random()*6|0]));this.strike(s,p,Math.min(.95,Math.max(.05,p.pos+(Math.random()-.5)*.1)),t);}s.next=t+(1/p.auto)*(.6+Math.random()*.8);}
  clear(g);const ctx=g.ctx,S=g.S,D=g.D,M=s.M,X=s.X,dt=t-s.t0,cy=S*.4,amp=S*.2,cur=new Float32Array(M),env=new Float32Array(M),x0=S*.08,x1=S*.92;
  for(let k=0;k<M;k++){env[k]=s.A[k]*Math.exp(-dt/s.tau[k]);cur[k]=env[k]*Math.cos(TAU*.6*this.ratio(k+1,p.B)*dt);}
  ctx.lineWidth=D;ctx.globalAlpha=.3;for(let k=0;k<4;k++){ctx.strokeStyle=pcol(g.pal,.5);ctx.beginPath();for(let i=0;i<=X;i+=2){const xx=x0+(x1-x0)*i/X,yy=cy-cur[k]*s.tab[k][i]*amp;i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy);}ctx.stroke();}ctx.globalAlpha=1;
  ctx.lineWidth=2.2*D;ctx.strokeStyle=pcol(g.pal,.92);ctx.beginPath();for(let i=0;i<=X;i++){let y=0;for(let k=0;k<M;k++)y+=cur[k]*s.tab[k][i];const xx=x0+(x1-x0)*i/X,yy=cy-y*amp;i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy);}ctx.stroke();
  ctx.fillStyle=pcol(g.pal,.55);ctx.fillRect(x0-4*D,cy-12*D,4*D,24*D);ctx.fillRect(x1,cy-12*D,4*D,24*D);
  const px=x0+(x1-x0)*p.pick;ctx.strokeStyle='rgba(201,211,230,.45)';ctx.lineWidth=D;ctx.setLineDash([3*D,3*D]);ctx.beginPath();ctx.moveTo(px,cy-amp*1.2);ctx.lineTo(px,cy+amp*1.2);ctx.stroke();ctx.setLineDash([]);
  const qx=x0+(x1-x0)*p.pos,qy=cy+amp*1.25;ctx.fillStyle='#eea13c';ctx.beginPath();ctx.moveTo(qx,qy);ctx.lineTo(qx-5*D,qy+8*D);ctx.lineTo(qx+5*D,qy+8*D);ctx.fill();
  const by=S*.86,bh=S*.14,bw=(x1-x0)/M;let E=0;
  for(let k=0;k<M;k++){const v=Math.abs(env[k]*Math.sin((k+1)*PI*p.pick));E+=v*v;const h=Math.min(1,v*1.4)*bh;ctx.fillStyle=pcol(g.pal,.35+.6*(1-k/M));ctx.fillRect(x0+k*bw+D,by-h,bw-2*D,h);}
  ctx.fillStyle='rgba(201,211,230,.7)';ctx.font=`${10*D}px "IBM Plex Mono",monospace`;ctx.fillText('spectrum bij de opnemer',x0,by-bh-6*D);if(s.note)ctx.fillText(s.note,x1-34*D,S*.09);s.E=E;}},

{id:'tv',name:'Trommelvlies',sub:'Bessel-modi · modale synthese',cat:'Isomorf',pal:'duo',
what:'Een rond vel trilt in Bessel-modi. Elke modus heeft een eigen knooplijnpatroon en een eigen, niet-harmonische toon. Waar je slaat bepaalt welke modi meedoen. Blauw is omlaag, oranje omhoog, donker zijn de knooplijnen.',
tip:'<b>Probeer:</b> sla precies in het midden. Dan doen alleen de ronde modi mee en klinkt het dof. Aan de rand komen de taartpunt-modi los. Een harde stok brengt de hoge modi erbij.',
hint:'klik = slaan',
knobs:[K('toon','toon (trap)',0,10,1,3),K('rad','slagstraal',0,.95,.01,.45),K('hard','hardheid stok',0,1,.01,.5),K('damp','uitklinktijd',.2,3,.05,1),K('auto','zelf spelen /s',0,4,.05,.7,{fix:1}),K('vol','volume',0,1,.01,.8,{fix:1})],
presets:[['Pauk',{rad:.3,hard:.3,damp:1.8}],['Tabla',{rad:.7,hard:.7,damp:.8}],['Gong-achtig',{rad:.55,hard:.9,damp:2.8}],['Dof',{rad:.02,hard:.1,damp:.6}]],
init(s){const DC=drumCache();s.DC=DC;s.a=new Float32Array(16);s.b=new Float32Array(16);s.tau=new Float32Array(16).fill(1);s.t0=0;s.next=0;s.E=0;s.g=Grid(DC.N);s.hit=null;},
strike(s,p,rs,th,t){const dt=t-s.t0,f0=mtof(midiFrom(36+AU.root,Math.round(p.toon))),fr=[],am=[],ta=[];
  for(let k=0;k<16;k++){const [m,j]=DRUM[k],ratio=j/DRUM[0][1],dec=Math.exp(-dt/s.tau[k])*Math.cos(TAU*.8*ratio*dt);
    const c=besselJ(m,j*rs)/s.DC.rmax[k]*Math.exp(-(ratio-1)*(1-p.hard)*1.3),tau=p.damp*1.2/Math.pow(ratio,.8);
    s.a[k]=s.a[k]*dec*.5+c*Math.cos(m*th);s.b[k]=s.b[k]*dec*.5+c*Math.sin(m*th);s.tau[k]=tau;fr.push(f0*ratio);am.push(Math.abs(c));ta.push(tau*.7);}
  s.t0=t;s.e.slag=1;s.hit={x:rs*Math.cos(th),y:rs*Math.sin(th),t};
  if(AON())playBuf(modalBuffer(fr,am,ta,Math.min(4,ta[0]*5),.25*p.hard),p.vol,rs*Math.cos(th)*.5);},
act:{slaan(s,p){SYSTEMS_BY.tv.strike(s,p,p.rad,Math.random()*TAU,performance.now()/1000);}},
pointer(s,p,x,y,down){if(!down)return;const u=x*2-1,v=y*2-1;this.strike(s,p,Math.min(.95,Math.hypot(u,v)),Math.atan2(v,u),performance.now()/1000);},
step(s,p,g){const t=g.t;if(p.auto>0&&t>=s.next){if(s.next)this.strike(s,p,Math.min(.95,Math.max(0,p.rad+(Math.random()-.5)*.2)),Math.random()*TAU,t);s.next=t+(1/p.auto)*(.6+Math.random()*.8);}
  const DC=s.DC,dt=t-s.t0,A=new Float32Array(16),B=new Float32Array(16);let E=0,ER=0;
  for(let k=0;k<16;k++){const ratio=DRUM[k][1]/DRUM[0][1],e=Math.exp(-dt/s.tau[k]),c=e*Math.cos(TAU*.8*ratio*dt);A[k]=s.a[k]*c;B[k]=s.b[k]*c;const en=(s.a[k]**2+s.b[k]**2)*e*e;E+=en;ER+=en*ratio;}
  const px=s.g.px,L=g.L,np=DC.idx.length;px.fill(LUTS.fosfor[0]);
  for(let q=0;q<np;q++){let z=0;for(let k=0;k<16;k++)z+=A[k]*DC.C[k][q]+B[k]*DC.S[k][q];px[DC.idx[q]]=L[Math.max(0,Math.min(255,128+z*120|0))];}
  blit(s.g,g);const ctx=g.ctx,S=g.S,D=g.D,R=S/2*(DC.N-1)/DC.N;ctx.strokeStyle='rgba(201,211,230,.35)';ctx.lineWidth=1.5*D;ctx.beginPath();ctx.arc(S/2,S/2,R,0,TAU);ctx.stroke();
  if(s.hit){const a=t-s.hit.t;if(a<1){ctx.strokeStyle=`rgba(238,161,60,${1-a})`;ctx.beginPath();ctx.arc(S/2+s.hit.x*R,S/2+s.hit.y*R,(4+a*30)*D,0,TAU);ctx.stroke();}}
  s.E=E;s.ER=E>1e-6?ER/E:1;}},

{id:'ep',name:'Epicykels',sub:'Fourier · XY-oscilloscoop',cat:'Isomorf',pal:'iris',
what:'Elke vorm is een som van draaiende cirkels. Diezelfde cirkels zijn boventonen: het linkerkanaal speelt x, het rechterkanaal y. Op een oscilloscoop in XY-stand zie je precies deze vorm. Het beeld draait langzaam, het geluid zo\'n honderd keer per seconde.',
tip:'<b>Probeer:</b> teken zelf een vorm in het beeld. Met weinig cirkels klinkt hij zacht en rond, met veel cirkels scherp. Gebruik een koptelefoon: links en rechts zijn x en y.',
hint:'teken = nieuwe vorm',
knobs:[SEL('f','vorm',['Ster','Hart','Vierkant','Lemniscaat','Roos','Klaver'],0,{re:1}),K('K','cirkels',1,48,1,12),K('toon','toon (trap)',0,10,1,2),K('sp','draaisnelheid',.02,.5,.005,.1,{fix:1}),K('vol','volume',0,1,.01,.5,{fix:1})],
presets:[['Zacht',{K:3}],['Ster',{f:0,K:12}],['Hart',{f:1,K:20}],['Scherp',{f:2,K:48}],['Klaver',{f:5,K:8}]],
init(s,p){s.fi=p.f|0;this.load(s,epShape(s.fi));s.ph=0;s.lt=0;s.tr=[];},
load(s,pts){s.list=fourier(pts);s.waveK=-1;s.ghostK=-1;s.tr=[];},
act:{volgende(s){s.fi=(s.fi+1)%6;SYSTEMS_BY.ep.load(s,epShape(s.fi));}},
pointer(s,p,x,y,down){if(down)s.draw=[];if(s.draw)s.draw.push([x*2-1,y*2-1]);},
pointerUp(s){if(s.draw&&s.draw.length>12)this.load(s,resample(s.draw,256));s.draw=null;},
ensure(s){if(s.au||!AON())return;const C=AU.ctx,oL=C.createOscillator(),oR=C.createOscillator(),m=C.createChannelMerger(2),g=C.createGain();g.gain.value=0;oL.connect(m,0,0);oR.connect(m,0,1);m.connect(g);g.connect(AU.n.bus);oL.start();oR.start();s.au={oL,oR,g};s.waveK=-1;},
wave(s,K){const list=s.list.slice(0,K);let H=1;list.forEach(c=>H=Math.max(H,Math.abs(c.n)));const rx=new Float32Array(H+1),ix=new Float32Array(H+1),ry=new Float32Array(H+1),iy=new Float32Array(H+1);
  list.forEach(({n,re,im})=>{const h=Math.abs(n),sg=n>0?1:-1;rx[h]+=re;ix[h]+=-im*sg;ry[h]+=im;iy[h]+=re*sg;});const C=AU.ctx;s.au.oL.setPeriodicWave(C.createPeriodicWave(rx,ix));s.au.oR.setPeriodicWave(C.createPeriodicWave(ry,iy));s.waveK=K;},
gate(s,p,on){if(!s.au)return;const C=AU.ctx;s.au.g.gain.setTargetAtTime(on&&AON()?p.vol*.3:0,C.currentTime,.08);},
step(s,p,g){const t=g.t,dt=Math.min(.1,t-(s.lt||t));s.lt=t;const K=Math.max(1,Math.min(s.list.length,Math.round(p.K)));
  this.ensure(s);if(s.au){if(K!==s.waveK&&t-(s.wt||0)>.08){this.wave(s,K);s.wt=t;}s.au.oL.frequency.setTargetAtTime(mtof(midiFrom(36+AU.root,Math.round(p.toon))),AU.ctx.currentTime,.05);s.au.oR.frequency.setTargetAtTime(mtof(midiFrom(36+AU.root,Math.round(p.toon))),AU.ctx.currentTime,.05);}
  const ph0=s.ph;s.ph+=dt*p.sp;if(Math.floor(s.ph)!==Math.floor(ph0))s.e.rond=1;
  if(K!==s.ghostK){s.ghost=[];for(let i=0;i<=300;i++){const a=i/300*TAU;let x=0,y=0;for(let k=0;k<K;k++){const c=s.list[k];x+=c.re*Math.cos(c.n*a)-c.im*Math.sin(c.n*a);y+=c.re*Math.sin(c.n*a)+c.im*Math.cos(c.n*a);}s.ghost.push([x,y]);}s.ghostK=K;s.tr=[];}
  clear(g);const ctx=g.ctx,S=g.S,D=g.D,sc=S*.36,cx=S/2,cy=S/2,a=s.ph*TAU;
  ctx.strokeStyle='rgba(201,211,230,.14)';ctx.lineWidth=D;ctx.beginPath();s.ghost.forEach(([x,y],i)=>i?ctx.lineTo(cx+x*sc,cy+y*sc):ctx.moveTo(cx+x*sc,cy+y*sc));ctx.stroke();
  let x=0,y=0;ctx.lineWidth=.8*D;
  for(let k=0;k<K;k++){const c=s.list[k],r=Math.hypot(c.re,c.im),nx=x+c.re*Math.cos(c.n*a)-c.im*Math.sin(c.n*a),ny=y+c.re*Math.sin(c.n*a)+c.im*Math.cos(c.n*a);
    if(r*sc>.6){ctx.strokeStyle=`rgba(226,123,208,${.12+.3*(1-k/K)})`;ctx.beginPath();ctx.arc(cx+x*sc,cy+y*sc,r*sc,0,TAU);ctx.stroke();}
    ctx.strokeStyle='rgba(251,232,243,.55)';ctx.beginPath();ctx.moveTo(cx+x*sc,cy+y*sc);ctx.lineTo(cx+nx*sc,cy+ny*sc);ctx.stroke();x=nx;y=ny;}
  s.tr.push([x,y]);if(s.tr.length>240)s.tr.shift();ctx.lineWidth=2*D;for(let i=1;i<s.tr.length;i++){ctx.strokeStyle=pcol(g.pal,.3+.7*i/s.tr.length);ctx.beginPath();ctx.moveTo(cx+s.tr[i-1][0]*sc,cy+s.tr[i-1][1]*sc);ctx.lineTo(cx+s.tr[i][0]*sc,cy+s.tr[i][1]*sc);ctx.stroke();}
  ctx.fillStyle='#fbe8f3';ctx.beginPath();ctx.arc(cx+x*sc,cy+y*sc,3*D,0,TAU);ctx.fill();
  if(s.draw&&s.draw.length>1){ctx.strokeStyle='#eea13c';ctx.lineWidth=2*D;ctx.beginPath();s.draw.forEach(([u,v],i)=>{const X=(u+1)/2*S,Y=(v+1)/2*S;i?ctx.lineTo(X,Y):ctx.moveTo(X,Y);});ctx.stroke();}
  ctx.fillStyle='rgba(201,211,230,.7)';ctx.font=`${10*D}px "IBM Plex Mono",monospace`;ctx.textAlign='right';ctx.fillText(`${K} cirkels · L = x · R = y`,S-12*D,S-14*D);ctx.textAlign='left';s.tip=[x,y];}},

{id:'dw',name:'Korrelwolk',sub:'granulaire synthese · elk deeltje is een korrel',cat:'Isomorf',pal:'fosfor',
what:'Elk deeltje is een luisterpunt in een geluidsbron. Horizontaal is de plek in de bron (en links of rechts in je koptelefoon), verticaal de toonhoogte. Licht een deeltje op, dan hoor je precies die korrel. Elke verticale strook is een ander akkoord.',
tip:'<b>Probeer:</b> sleep om de wolk naar je toe te trekken. Een draaikolk laat de korrels door alle akkoorden cirkelen, beweging maakt er regen van.',
hint:'sleep = aantrekken',
knobs:[K('dens','korrels /s',0,50,.5,14),K('mov','beweging',0,1,.01,.3),K('swirl','draaikolk',-1,1,.01,.35),K('size','korrelgrootte',.03,.4,.005,.14),K('vol','volume',0,1,.01,.7,{fix:1})],
presets:[['Mist',{dens:30,mov:.15,swirl:.1,size:.3}],['Regen',{dens:40,mov:.7,swirl:0,size:.04}],['Draaikolk',{dens:18,mov:.2,swirl:.9,size:.12}],['Stil',{dens:4,mov:.1,swirl:.2,size:.35}]],
init(s){const n=80;s.n=n;s.x=new Float32Array(n).map(()=>.2+Math.random()*.6);s.y=new Float32Array(n).map(()=>.2+Math.random()*.6);s.vx=new Float32Array(n);s.vy=new Float32Array(n);s.f=new Float32Array(n);s.acc=0;s.last=0;},
pointer(s,p,x,y){s.att={x,y,t:performance.now()/1000};},
emit(s,p,i){s.f[i]=1;s.e.korrel=1;if(!AON()||!AU.gbuf)return;const C=AU.ctx,bd=AU.gbuf.duration,dur=p.size,t=C.currentTime+Math.random()*.03;
  const rate=Math.pow(2,midiFrom(0,Math.round((1-s.y[i])*14)-7)/12),pos=Math.max(0,Math.min(bd-dur-.02,s.x[i]*(bd-dur-.02)));
  const src=C.createBufferSource(),g=C.createGain(),pn=C.createStereoPanner();src.buffer=AU.gbuf;src.playbackRate.value=rate;const amp=.45/Math.sqrt(Math.max(1,p.dens*dur));
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(amp*p.vol,t+dur/2);g.gain.linearRampToValueAtTime(0,t+dur);pn.pan.value=s.x[i]*1.6-.8;src.connect(g);g.connect(pn);pn.connect(AU.n.bus);src.start(t,pos,dur+.02);},
act:{uitbarsting(s,p){for(let k=0;k<10;k++)SYSTEMS_BY.dw.emit(s,p,Math.random()*s.n|0);},verstrooi(s){for(let i=0;i<s.n;i++){s.x[i]=.05+Math.random()*.9;s.y[i]=.05+Math.random()*.9;}}},
step(s,p,g){const t=g.t,dt=Math.min(.05,t-(s.last||t));s.last=t;const n=s.n,att=s.att&&t-s.att.t<.4?s.att:null;
  for(let i=0;i<n;i++){const dx=s.x[i]-.5,dy=s.y[i]-.5;let ax=(Math.random()-.5)*p.mov*3-dy*p.swirl*.8-dx*.15,ay=(Math.random()-.5)*p.mov*3+dx*p.swirl*.8-dy*.15;
    if(att){ax+=(att.x-s.x[i])*4;ay+=(att.y-s.y[i])*4;}s.vx[i]=(s.vx[i]+ax*dt)*.97;s.vy[i]=(s.vy[i]+ay*dt)*.97;s.x[i]+=s.vx[i]*dt;s.y[i]+=s.vy[i]*dt;
    if(s.x[i]<.02){s.x[i]=.02;s.vx[i]*=-1;}if(s.x[i]>.98){s.x[i]=.98;s.vx[i]*=-1;}if(s.y[i]<.02){s.y[i]=.02;s.vy[i]*=-1;}if(s.y[i]>.98){s.y[i]=.98;s.vy[i]*=-1;}s.f[i]*=.9;}
  s.acc+=p.dens*dt;while(s.acc>=1){s.acc-=1;this.emit(s,p,Math.random()*n|0);}
  clear(g);const ctx=g.ctx,S=g.S,D=g.D;for(let b=0;b<8;b++)if(b%2){ctx.fillStyle='rgba(45,86,212,.07)';ctx.fillRect(b*S/8,0,S/8,S);}
  ctx.strokeStyle='rgba(201,211,230,.07)';ctx.lineWidth=D;for(let l=0;l<=14;l++){const y=S*(l/14);ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(S,y);ctx.stroke();}
  for(let i=0;i<n;i++){const X=s.x[i]*S,Y=s.y[i]*S;ctx.fillStyle=pcol(g.pal,.45+.5*(1-s.y[i]));ctx.beginPath();ctx.arc(X,Y,2.3*D,0,TAU);ctx.fill();
    if(s.f[i]>.05){ctx.strokeStyle=`rgba(238,244,240,${s.f[i]})`;ctx.beginPath();ctx.arc(X,Y,(3+(1-s.f[i])*16)*D,0,TAU);ctx.stroke();}}
  if(att){ctx.strokeStyle='rgba(238,161,60,.6)';ctx.beginPath();ctx.arc(att.x*S,att.y*S,10*D,0,TAU);ctx.stroke();}
  ctx.fillStyle='rgba(201,211,230,.55)';ctx.font=`${10*D}px "IBM Plex Mono",monospace`;ctx.fillText('↑ toonhoogte',12*D,46*D);ctx.fillText('plek in bron · pan →',S-128*D,S-10*D);}},


/* 1 Gray-Scott */
{id:'gs',name:'Reactie-diffusie',sub:'Gray-Scott · Turing-patronen',cat:'Patronen',pal:'fosfor',
what:'Stof U wordt aangevoerd, stof V vreet U op en vermenigvuldigt zich. Door diffusie ontstaan vlekken, strepen en delende cellen.',
tip:'<b>Probeer:</b> sleep door het beeld om te zaaien. Een stapje van 0,001 in feed of kill geeft al een andere vormfamilie.',
hint:'sleep = zaaien',
knobs:[K('F','feed',.01,.09,.0005,.0545,{rnd:[.02,.07]}),K('K','kill',.045,.07,.0005,.062,{rnd:[.052,.066]}),K('sp','stappen per frame',1,24,1,12,{fix:1})],
presets:[['Koraal',{F:.0545,K:.062}],['Mitose',{F:.0367,K:.0649}],['Labyrint',{F:.029,K:.057}],['Wormen',{F:.078,K:.061}],['Stippen',{F:.025,K:.06}]],
init(s){const n=128;s.n=n;s.g=Grid(n);s.u=new Float32Array(n*n).fill(1);s.v=new Float32Array(n*n);s.u2=new Float32Array(n*n);s.v2=new Float32Array(n*n);
  for(let i=0;i<12;i++)this.seed(s,Math.random(),Math.random(),4+Math.random()*4);},
seed(s,fx,fy,r){const n=s.n,cx=fx*n|0,cy=fy*n|0;for(let y=-r;y<=r;y++)for(let x=-r;x<=r;x++){if(x*x+y*y>r*r)continue;const i=(((cy+y|0)%n+n)%n)*n+(((cx+x|0)%n+n)%n);s.u[i]=.5+Math.random()*.1;s.v[i]=.25+Math.random()*.1;}},
pointer(s,p,x,y){this.seed(s,x,y,3);},
step(s,p,g){const n=s.n,F=p.F,Kk=p.K;
  for(let it=0;it<p.sp;it++){const u=s.u,v=s.v,u2=s.u2,v2=s.v2;
    for(let y=0;y<n;y++){const yc=y*n,ym=((y-1+n)%n)*n,yp=((y+1)%n)*n;
      for(let x=0;x<n;x++){const xm=(x-1+n)%n,xp=(x+1)%n,i=yc+x,U=u[i],V=v[i];
        const lu=.2*(u[yc+xm]+u[yc+xp]+u[ym+x]+u[yp+x])+.05*(u[ym+xm]+u[ym+xp]+u[yp+xm]+u[yp+xp])-U;
        const lv=.2*(v[yc+xm]+v[yc+xp]+v[ym+x]+v[yp+x])+.05*(v[ym+xm]+v[ym+xp]+v[yp+xm]+v[yp+xp])-V;
        const uvv=U*V*V;u2[i]=U+(lu-uvv+F*(1-U));v2[i]=V+(.5*lv+uvv-(F+Kk)*V);}}
    s.u=u2;s.u2=u;s.v=v2;s.v2=v;}
  const px=s.g.px,L=g.L,v=s.v;for(let i=0;i<v.length;i++)px[i]=L[Math.min(255,(v[i]*3*255)|0)];blit(s.g,g);}},

/* 2 Clifford / De Jong */
{id:'cl',name:'Vreemde attractor',sub:'Clifford · De Jong',cat:'Chaos',pal:'iris',
what:'Eén punt springt eindeloos rond volgens twee sinusformules. De chaotische baan vormt toch steeds hetzelfde "wezen".',
tip:'<b>Probeer:</b> drift op 0 en langzaam aan één constante schuiven. Bijna elke combinatie van waarden geeft een ander organisme.',
knobs:[SEL('mode','formule',['Clifford','De Jong'],0),K('a','a',-3,3,.01,-1.4,{rnd:[-2.6,2.6]}),K('b','b',-3,3,.01,1.6,{rnd:[-2.6,2.6]}),K('c','c',-3,3,.01,1,{rnd:[-1.6,1.6]}),K('d','d',-3,3,.01,.7,{rnd:[-1.6,1.6]}),K('drift','drift',0,1,.01,.35,{fix:1})],
presets:[['Rook',{mode:0,a:-1.4,b:1.6,c:1,d:.7}],['Zijde',{mode:0,a:-1.7,b:1.3,c:-.1,d:-1.21,drift:0}],['Vlinder',{mode:0,a:1.5,b:-1.8,c:1.6,d:.9}],['Lint',{mode:0,a:1.7,b:1.7,c:.6,d:1.2}],['De Jong',{mode:1,a:-2,b:-2,c:-1.2,d:2}],['Nevel',{mode:1,a:1.641,b:1.902,c:.316,d:1.525}]],
init(s){s.N=320;s.g=Grid(320);s.h=new Float32Array(320*320);s.x=.1;s.y=.1;},
step(s,p,g){const N=s.N,h=s.h,t=g.t,dr=p.drift;
  const a=p.a+Math.sin(t*.37)*dr*.5,b=p.b+Math.sin(t*.29+1.3)*dr*.5,c=p.c+Math.sin(t*.23+2.1)*dr*.4,d=p.d+Math.sin(t*.31+.7)*dr*.4;
  if(dr>0)for(let i=0;i<h.length;i++)h[i]*=.88;
  const R=p.mode==0?1+Math.max(Math.abs(c),Math.abs(d)):2.05,sc=N*.47/R,o=N/2;let x=s.x,y=s.y;
  for(let k=0;k<70000;k++){let nx,ny;if(p.mode==0){nx=Math.sin(a*y)+c*Math.cos(a*x);ny=Math.sin(b*x)+d*Math.cos(b*y);}else{nx=Math.sin(a*y)-Math.cos(b*x);ny=Math.sin(c*x)-Math.cos(d*y);}
    x=nx;y=ny;const X=(o+x*sc)|0,Y=(o+y*sc)|0;if(X>=0&&X<N&&Y>=0&&Y<N)h[Y*N+X]+=1;}
  if(!isFinite(x)){x=.1;y=.1;}s.x=x;s.y=y;
  let m=1;for(let i=0;i<h.length;i++)if(h[i]>m)m=h[i];const lm=1/Math.log(1+m),px=s.g.px,L=g.L;
  for(let i=0;i<h.length;i++)px[i]=h[i]?L[Math.min(255,(Math.pow(Math.log(1+h[i])*lm,.7)*255)|0)]:L[0];blit(s.g,g);}},

/* 3 Lorenz */
{id:'lz',name:'Lorenz-attractor',sub:'het vlindereffect',cat:'Chaos',pal:'gloed',
what:'Drie gekoppelde vergelijkingen uit een weermodel. Banen die bijna gelijk starten, lopen na een tijdje totaal uit elkaar.',
tip:'<b>Probeer:</b> zet ρ onder de 24. Dan valt de chaos stil in een vast punt. Rond 28 fladdert de vlinder, boven 100 ontstaan periodieke lussen.',
knobs:[K('s','σ (sigma)',1,20,.1,10),K('r','ρ (rho)',1,120,.5,28,{rnd:[14,60]}),K('b','β (beta)',.5,5,.01,2.667,{rnd:[1,4]}),K('n','aantal banen',1,40,1,14,{re:1,fix:1}),K('rot','draaisnelheid',0,1,.01,.3,{fix:1})],
presets:[['Vlinder',{s:10,r:28,b:2.667}],['Stilstand',{s:10,r:20,b:2.667}],['Lus',{s:10,r:100,b:2.667}],['Spiraal',{s:4,r:45,b:1}]],
init(s,p,g){s.P=[];for(let i=0;i<p.n;i++)s.P.push({x:1+i*.02,y:1,z:20,sx:null,sy:null});clear(g);},
step(s,p,g){const ctx=g.ctx,S=g.S;fade(g,.045);const th=g.t*p.rot*.35,co=Math.cos(th),si=Math.sin(th),sc=S*.8/(1.6*Math.max(p.r,4)+12),zc=Math.max(p.r-1,0)*.95;
  ctx.lineWidth=1.2*g.D;ctx.lineCap='round';const n=s.P.length;
  s.P.forEach((q,i)=>{ctx.beginPath();let first=true;for(let k=0;k<5;k++){const dt=.005,dx=p.s*(q.y-q.x),dy=q.x*(p.r-q.z)-q.y,dz=q.x*q.y-p.b*q.z;q.x+=dx*dt;q.y+=dy*dt;q.z+=dz*dt;
    if(!isFinite(q.x)||Math.abs(q.x)>1e4){q.x=1+i*.02;q.y=1;q.z=20;q.sx=null;}const X=q.x*co-q.y*si,sx=S/2+X*sc,sy=S/2-(q.z-zc)*sc;
    if(first){ctx.moveTo(q.sx??sx,q.sy??sy);first=false;}ctx.lineTo(sx,sy);q.sx=sx;q.sy=sy;}
    ctx.strokeStyle=pcol(g.pal,.35+.65*i/Math.max(1,n-1));ctx.stroke();});}},

/* 4 Chladni */
{id:'ch',name:'Chladni-figuren',sub:'cymatica · trillende plaat',cat:'Golven',pal:'gloed',
what:'Zand op een trillende plaat springt weg waar hij beweegt en blijft liggen op de knooplijnen die stilstaan. Elke trillingsmodus geeft een eigen figuur.',
tip:'<b>Probeer:</b> verander n of m tijdens het trillen. Het zand stroomt dan zichtbaar naar het nieuwe patroon. Koppel n en m aan toonhoogte voor echte cymatica.',
knobs:[K('n','modus n',1,14,1,3,{rnd:[1,10]}),K('m','modus m',1,14,1,5,{rnd:[1,12]}),K('amp','trilling',.3,6,.1,2.5,{fix:1}),K('cnt','zandkorrels',2000,16000,500,9000,{re:1,fix:1})],
presets:[['3 · 5',{n:3,m:5}],['2 · 7',{n:2,m:7}],['4 · 9',{n:4,m:9}],['6 · 11',{n:6,m:11}],['1 · 8',{n:1,m:8}]],
init(s,p){const n=p.cnt|0;s.n=n;s.x=new Float32Array(n);s.y=new Float32Array(n);for(let i=0;i<n;i++){s.x[i]=Math.random();s.y[i]=Math.random();}s.g=Grid(256);s.c=new Uint16Array(256*256);},
step(s,p,g){const n=p.n,m=p.m,amp=p.amp*.012,N=256,c=s.c;c.fill(0);
  for(let i=0;i<s.n;i++){let x=s.x[i],y=s.y[i];const a=Math.cos(n*PI*x)*Math.cos(m*PI*y),b=Math.cos(m*PI*x)*Math.cos(n*PI*y);const f=Math.abs(n===m?a:a-b)*amp+.0006;
    x+=(Math.random()-.5)*f;y+=(Math.random()-.5)*f;if(x<0)x=-x;if(x>1)x=2-x;if(y<0)y=-y;if(y>1)y=2-y;s.x[i]=x;s.y[i]=y;c[Math.min(N-1,y*N|0)*N+Math.min(N-1,x*N|0)]++;}
  const px=s.g.px,L=g.L;for(let i=0;i<c.length;i++)px[i]=L[Math.min(255,c[i]*70)];blit(s.g,g);}},

/* 5 Harmonograaf */
{id:'hg',name:'Harmonograaf',sub:'gekoppelde slingers · Lissajous',cat:'Golven',pal:'fosfor',
what:'Twee of meer slingers tekenen samen één lijn. De frequentieverhouding bepaalt de knoop, de demping laat de lijn naar binnen krullen.',
tip:'<b>Probeer:</b> eenvoudige verhoudingen (2:3, 3:4) geven rozetten. Met een piepkleine ontstemming gaat de vorm langzaam draaien.',
knobs:[K('a','frequentie x',1,9,1,3),K('b','frequentie y',1,9,1,2),K('e','ontstemming',0,.03,.0005,.004),K('d','demping',.001,.02,.0005,.004),K('ph','fasedrift',0,1,.01,.3,{fix:1})],
presets:[['2 : 3',{a:2,b:3,e:.004}],['3 : 4',{a:3,b:4,e:.002}],['1 : 3',{a:1,b:3,e:.006}],['5 : 4',{a:5,b:4,e:.001}]],
init(){},
step(s,p,g){clear(g);const ctx=g.ctx,S=g.S,T=Math.min(260,5/p.d),n=6000,dt=T/n,ph=g.t*p.ph*.6,R=S*.42,bands=6;
  ctx.lineWidth=.9*g.D;ctx.globalAlpha=.85;
  for(let bnd=0;bnd<bands;bnd++){ctx.beginPath();const i0=bnd*n/bands|0,i1=(bnd+1)*n/bands|0;
    for(let i=i0;i<=i1;i++){const t=i*dt,e=Math.exp(-p.d*t),x=e*(.6*Math.sin(p.a*t+ph)+.4*Math.sin(p.b*t)),y=e*(.6*Math.sin((p.b+p.e)*t)+.4*Math.sin(p.a*t+ph*.5+1));
      const X=S/2+x*R,Y=S/2+y*R;i===i0?ctx.moveTo(X,Y):ctx.lineTo(X,Y);}
    ctx.strokeStyle=pcol(g.pal,.95-bnd*.11);ctx.stroke();}
  ctx.globalAlpha=1;}},

/* 6 Lenia */
{id:'ln',name:'Lenia',sub:'continu kunstmatig leven',cat:'Automaten',pal:'mos',
what:'Game of Life in vloeiende vorm: elke cel kijkt naar een ring om zich heen en groeit of krimpt volgens een klokcurve. Soms ontstaan er zelfstandig kruipende organismen.',
tip:'<b>Probeer:</b> σ heel iets verhogen (0,017 → 0,02) maakt de wezens dikker en stabieler. Sleep om nieuw leven te zaaien. Sterft alles uit, dan zaait hij opnieuw.',
hint:'sleep = zaaien',
knobs:[K('mu','μ (groeicentrum)',.08,.3,.001,.15,{rnd:[.11,.2]}),K('sg','σ (groeibreedte)',.005,.04,.0005,.017,{rnd:[.013,.03]}),K('R','kernelstraal',6,14,1,10,{re:1,fix:1}),K('dt','tijdstap',.03,.25,.01,.1,{fix:1})],
presets:[['Kruipers',{mu:.15,sg:.017}],['Bellen',{mu:.2,sg:.03}],['Wormen',{mu:.13,sg:.014}],['Koortsig',{mu:.26,sg:.036}]],
init(s,p){const N=88,R=p.R|0,P=N+2*R;s.N=N;s.R=R;s.P=P;s.A=new Float32Array(N*N);s.pad=new Float32Array(P*P);
  const off=[],w=[];let sum=0;for(let dy=-R;dy<=R;dy++)for(let dx=-R;dx<=R;dx++){const r=Math.hypot(dx,dy)/R;if(r>0&&r<1){const k=Math.exp(4-1/(r*(1-r)));if(k>1e-4){off.push(dy*P+dx);w.push(k);sum+=k;}}}
  s.off=Int32Array.from(off);s.w=Float32Array.from(w.map(v=>v/sum));s.g=Grid(N);s.dead=0;for(let b=0;b<5;b++)this.seed(s,Math.random(),Math.random());},
seed(s,fx,fy){const N=s.N,rr=s.R*(1+Math.random()),cx=fx*N|0,cy=fy*N|0;for(let dy=-rr|0;dy<=rr;dy++)for(let dx=-rr|0;dx<=rr;dx++){if(dx*dx+dy*dy>rr*rr)continue;s.A[((cy+dy+N)%N)*N+((cx+dx+N)%N)]=Math.random();}},
pointer(s,p,x,y){if(!s.pl||performance.now()-s.pl>120){this.seed(s,x,y);s.pl=performance.now();}},
step(s,p,g){const {N,R,P,A,pad,off,w}=s,nk=off.length,mu=p.mu,is2=1/(2*p.sg*p.sg),dt=p.dt;
  for(let y=0;y<P;y++){const sy=((y-R)%N+N)%N;for(let x=0;x<P;x++)pad[y*P+x]=A[sy*N+((x-R)%N+N)%N];}
  let mass=0;const px=s.g.px,L=g.L;
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){const base=(y+R)*P+x+R;let u=0;for(let k=0;k<nk;k++)u+=pad[base+off[k]]*w[k];
    const G=2*Math.exp(-(u-mu)*(u-mu)*is2)-1,i=y*N+x;let a=A[i]+dt*G;a=a<0?0:a>1?1:a;A[i]=a;mass+=a;px[i]=L[(a*255)|0];}
  if(mass<2||mass>N*N*.6){if(++s.dead>50){s.A.fill(0);for(let b=0;b<5;b++)this.seed(s,Math.random(),Math.random());s.dead=0;}}else s.dead=0;
  blit(s.g,g);}},

/* 7 Physarum */
{id:'ph',name:'Physarum',sub:'slijmzwam-simulatie',cat:'Zwermen',pal:'gloed',
what:'Duizenden simpele agents ruiken een spoor, draaien ernaartoe en laten zelf spoor achter. Samen bouwen ze netwerken die op aderen en zenuwbanen lijken.',
tip:'<b>Probeer:</b> een grote sensorafstand met een kleine draaihoek geeft lange aderen. Een grote sensorhoek geeft cellen en ringen.',
knobs:[K('sa','sensorhoek °',5,90,1,30),K('so','sensorafstand',2,26,.5,9),K('ra','draaihoek °',3,90,1,20),K('dec','spoorbehoud',.8,.99,.005,.92,{rnd:[.85,.97]})],
presets:[['Netwerk',{sa:30,so:9,ra:20,dec:.92}],['Aderen',{sa:22,so:20,ra:10,dec:.95}],['Cellen',{sa:65,so:6,ra:45,dec:.9}],['Stippen',{sa:45,so:3,ra:80,dec:.88}]],
init(s){const N=160,A=5000;s.N=N;s.n=A;s.ax=new Float32Array(A);s.ay=new Float32Array(A);s.aa=new Float32Array(A);
  for(let i=0;i<A;i++){const r=Math.sqrt(Math.random())*N*.32,an=Math.random()*TAU;s.ax[i]=N/2+Math.cos(an)*r;s.ay[i]=N/2+Math.sin(an)*r;s.aa[i]=an+PI;}
  s.T=new Float32Array(N*N);s.T2=new Float32Array(N*N);s.g=Grid(N);},
step(s,p,g){const N=s.N,T=s.T,sa=p.sa*PI/180,so=p.so,ra=p.ra*PI/180;
  const sn=(x,y)=>T[(((Math.floor(y)%N)+N)%N)*N+(((Math.floor(x)%N)+N)%N)];
  for(let i=0;i<s.n;i++){const x=s.ax[i],y=s.ay[i];let a=s.aa[i];
    const f=sn(x+Math.cos(a)*so,y+Math.sin(a)*so),l=sn(x+Math.cos(a-sa)*so,y+Math.sin(a-sa)*so),r=sn(x+Math.cos(a+sa)*so,y+Math.sin(a+sa)*so);
    if(f>l&&f>r){}else if(f<l&&f<r)a+=(Math.random()<.5?-1:1)*ra;else if(l>r)a-=ra;else if(r>l)a+=ra;
    let nx=x+Math.cos(a),ny=y+Math.sin(a);nx=(nx+N)%N;ny=(ny+N)%N;s.ax[i]=nx;s.ay[i]=ny;s.aa[i]=a;T[(ny|0)*N+(nx|0)]+=4;}
  const T2=s.T2,dec=p.dec/9;
  for(let y=0;y<N;y++){const ym=((y-1+N)%N)*N,yc=y*N,yp=((y+1)%N)*N;for(let x=0;x<N;x++){const xm=(x-1+N)%N,xp=(x+1)%N;
    T2[yc+x]=(T[ym+xm]+T[ym+x]+T[ym+xp]+T[yc+xm]+T[yc+x]+T[yc+xp]+T[yp+xm]+T[yp+x]+T[yp+xp])*dec;}}
  s.T=T2;s.T2=T;const px=s.g.px,L=g.L;for(let i=0;i<T2.length;i++)px[i]=L[((1-Math.exp(-T2[i]*.07))*255)|0];blit(s.g,g);}},

/* 8 Boids */
{id:'bd',name:'Boids',sub:'zwermgedrag · Reynolds',cat:'Zwermen',pal:'fosfor',
what:'Elke vogel volgt drie regels: niet botsen, dezelfde kant op vliegen en bij de groep blijven. Er is geen leider, en toch ontstaat een zwerm.',
tip:'<b>Probeer:</b> cohesie hoog en uitlijning laag geeft kolkende bollen. Uitlijning hoog en scheiding laag geeft lange treinen.',
knobs:[K('sep','scheiding',0,3,.05,1.4),K('ali','uitlijning',0,3,.05,1),K('coh','cohesie',0,3,.05,1),K('vis','zichtafstand',10,90,1,38)],
presets:[['Zwerm',{sep:1.4,ali:1,coh:1,vis:38}],['Draaikolk',{sep:.8,ali:.3,coh:2.6,vis:60}],['Treinen',{sep:.4,ali:2.8,coh:.4,vis:30}],['Gas',{sep:3,ali:0,coh:0,vis:20}]],
init(s,p,g){const n=170;s.n=n;s.x=new Float32Array(n);s.y=new Float32Array(n);s.vx=new Float32Array(n);s.vy=new Float32Array(n);
  for(let i=0;i<n;i++){s.x[i]=Math.random()*320;s.y[i]=Math.random()*320;const a=Math.random()*TAU;s.vx[i]=Math.cos(a)*1.5;s.vy[i]=Math.sin(a)*1.5;}clear(g);},
step(s,p,g){const n=s.n,v2=p.vis*p.vis,sd=(p.vis*.45)**2,ctx=g.ctx,D=g.D;fade(g,.28);
  for(let i=0;i<n;i++){let cx=0,cy=0,ax=0,ay=0,sx=0,sy=0,c=0;
    for(let j=0;j<n;j++){if(i===j)continue;const dx=s.x[j]-s.x[i],dy=s.y[j]-s.y[i],d2=dx*dx+dy*dy;if(d2<v2){cx+=s.x[j];cy+=s.y[j];ax+=s.vx[j];ay+=s.vy[j];c++;if(d2<sd&&d2>0){sx-=dx/d2;sy-=dy/d2;}}}
    let vx=s.vx[i],vy=s.vy[i];if(c){vx+=((ax/c)-vx)*.05*p.ali+((cx/c)-s.x[i])*.0012*p.coh;vy+=((ay/c)-vy)*.05*p.ali+((cy/c)-s.y[i])*.0012*p.coh;}
    vx+=sx*p.sep*.9;vy+=sy*p.sep*.9;const sp=Math.hypot(vx,vy)||1,cl=Math.max(1,Math.min(2.6,sp));s.vx[i]=vx/sp*cl;s.vy[i]=vy/sp*cl;}
  ctx.lineWidth=1.6*D;ctx.lineCap='round';
  for(let i=0;i<n;i++){s.x[i]=(s.x[i]+s.vx[i]+320)%320;s.y[i]=(s.y[i]+s.vy[i]+320)%320;
    ctx.strokeStyle=pcol(g.pal,.45+.55*(i/n));ctx.beginPath();ctx.moveTo(s.x[i]*D,s.y[i]*D);ctx.lineTo((s.x[i]-s.vx[i]*2.5)*D,(s.y[i]-s.vy[i]*2.5)*D);ctx.stroke();}}},

/* 9 Julia */
{id:'jl',name:'Julia-verzameling',sub:'complexe dynamica',cat:'Wiskunde',pal:'iris',
what:'z → z² + c, steeds opnieuw. Elke waarde van het complexe getal c geeft een andere fractal. Beweegt c, dan morpht de vorm vloeiend.',
tip:'<b>Probeer:</b> sleep door het beeld om c zelf te sturen. Rond de rand van de Mandelbrot-verzameling (straal ≈ 0,78) zit de meeste rijkdom.',
hint:'sleep = c sturen',
knobs:[K('r','straal van c',.3,1.1,.001,.7885,{rnd:[.62,.82]}),K('sp','snelheid',0,1,.01,.25,{fix:1}),K('it','iteraties',20,160,1,70,{fix:1}),K('z','zoom',.6,3,.01,1,{fix:1})],
presets:[['Dendriet',{r:.7885}],['Konijn',{r:.78}],['Stof',{r:1.05}],['Schijf',{r:.4}]],
init(s){s.g=Grid(180);s.th=0;},
pointer(s,p,x,y){s.pc=[(x-.5)*2.6,(y-.5)*2.6];s.pt=performance.now();},
step(s,p,g){const N=180,px=s.g.px,L=g.L,mi=p.it|0;let cr,ci;
  if(s.pc&&performance.now()-s.pt<2500){[cr,ci]=s.pc;s.th=Math.atan2(ci,cr);}else{s.th+=p.sp*.008;cr=p.r*Math.cos(s.th);ci=p.r*Math.sin(s.th);}
  const sc=3/(N*p.z);
  for(let Y=0;Y<N;Y++)for(let X=0;X<N;X++){let zx=(X-N/2)*sc,zy=(Y-N/2)*sc,i=0,m=0;
    for(;i<mi;i++){const xx=zx*zx,yy=zy*zy;m=xx+yy;if(m>16)break;zy=2*zx*zy+ci;zx=xx-yy+cr;}
    px[Y*N+X]=i>=mi?L[0]:L[Math.min(255,(Math.sqrt((i+1-Math.log2(Math.log2(m)+1e-9))/mi)*255)|0)];}
  blit(s.g,g);}},

/* 10 L-systeem */
{id:'ls',name:'L-systeem',sub:'Lindenmayer · herschrijfregels',cat:'Groei',pal:'mos',
what:'Een woord wordt steeds herschreven volgens vaste regels en daarna als schildpad-tekening gelezen. Zo ontstaan planten, sneeuwvlokken en draken.',
tip:'<b>Probeer:</b> zet de hoek bij Plant van 25° naar 15° of 40°. Met wind ademt de hele structuur mee.',
knobs:[SEL('f','vorm',['Plant','Struik','Koch-vlok','Draak','Sierpiński'],0,{re:1,on:i=>({ang:[25,22.5,60,90,120][i],it:[5,4,4,11,6][i]})}),K('it','iteraties',1,12,1,5,{re:1,fix:1}),K('ang','hoek °',5,130,.5,25),K('wind','wind',0,12,.1,3,{fix:1})],
presets:[['Varen',{f:0,ang:22,it:5}],['Wilg',{f:1,ang:16,it:4}],['Koch',{f:2,ang:60,it:4}],['Kristal',{f:2,ang:85,it:4}],['Draak',{f:3,ang:90,it:12}]],
DEF:[['X',{X:'F+[[X]-X]-F[-FX]+X',F:'FF'},6],['F',{F:'FF+[+F-F-F]-[-F+F+F]'},4],['F--F--F',{F:'F+F--F+F'},5],['FX',{X:'X+YF+',Y:'-FX-Y'},13],['F-G-G',{F:'F-G+F+G-F',G:'GG'},7]],
init(s,p){const [ax,ru,max]=this.DEF[p.f|0];let str=ax;const it=Math.min(p.it|0,max);for(let i=0;i<it;i++){let o='';for(const ch of str)o+=ru[ch]??ch;str=o;}s.str=str;},
walk(s,p,t,draw,paths){let x=0,y=0,h=-PI/2,dep=0;const st=[],base=p.ang*PI/180,w=p.wind*PI/180;let minx=0,maxx=0,miny=0,maxy=0;
  for(const ch of s.str){if(ch==='F'||ch==='G'){const nx=x+Math.cos(h),ny=y+Math.sin(h);if(draw){paths[Math.min(7,dep)].moveTo(draw.ox+x*draw.k,draw.oy+y*draw.k);paths[Math.min(7,dep)].lineTo(draw.ox+nx*draw.k,draw.oy+ny*draw.k);}x=nx;y=ny;
      if(x<minx)minx=x;if(x>maxx)maxx=x;if(y<miny)miny=y;if(y>maxy)maxy=y;}
    else if(ch==='+'||ch==='-'){const a=base+Math.sin(t*1.1+dep*.6)*w;h+=ch==='+'?a:-a;}
    else if(ch==='['){st.push([x,y,h,dep]);dep++;}else if(ch===']'){[x,y,h,dep]=st.pop();}}
  return[minx,maxx,miny,maxy];},
step(s,p,g){clear(g);const S=g.S,t=g.t,[a,b,c,d]=this.walk(s,p,t,null),k=S*.88/Math.max(b-a,d-c,1e-6),ox=S/2-(a+b)/2*k,oy=S/2-(c+d)/2*k;
  const paths=Array.from({length:8},()=>new Path2D());this.walk(s,p,t,{k,ox,oy},paths);const ctx=g.ctx;ctx.lineWidth=Math.max(.6,Math.min(1.6,k*.35))*g.D/ (g.D>1?1.4:1);ctx.lineCap='round';
  paths.forEach((pa,i)=>{ctx.strokeStyle=pcol(g.pal,.4+i*.085);ctx.stroke(pa);});}},

/* 11 Superformula */
{id:'sf',name:'Superformule',sub:'Gielis · één formule, alle vormen',cat:'Wiskunde',pal:'iris',
what:'Eén formule met vier getallen beschrijft bloemen, sterren, schelpen en diatomeeën. Door de lagen te laten ademen ontstaan bewegende organismen.',
tip:'<b>Probeer:</b> m = 5 met n1 laag (0,3) geeft een zeester. Gelijke n2 en n3 houden de vorm symmetrisch. Verschillende waarden maken hem schever.',
knobs:[K('m','m (symmetrie)',0,20,.5,6),K('n1','n1',.1,12,.05,1,{rnd:[.2,6]}),K('n2','n2',.1,12,.05,1.7,{rnd:[.3,8]}),K('n3','n3',.1,12,.05,1.7,{rnd:[.3,8]}),K('L','lagen',1,28,1,14,{fix:1}),K('br','ademen',0,1,.01,.5,{fix:1})],
presets:[['Bloem',{m:6,n1:1,n2:1.7,n3:1.7}],['Zeester',{m:5,n1:.3,n2:.3,n3:.3}],['Kussen',{m:4,n1:12,n2:15,n3:15}],['Schelp',{m:3,n1:4.5,n2:10,n3:10}],['Diatomee',{m:16,n1:.5,n2:.5,n3:16}]],
init(){},
r(m,n1,n2,n3,ph){const a=Math.abs(Math.cos(m*ph/4))**n2,b=Math.abs(Math.sin(m*ph/4))**n3,r=(a+b)**(-1/n1);return isFinite(r)?r:0;},
step(s,p,g){clear(g);const ctx=g.ctx,S=g.S,t=g.t,L=p.L|0,pts=540,rr=new Float32Array(pts+1);ctx.lineWidth=1.1*g.D;
  for(let l=0;l<L;l++){const f=L>1?l/(L-1):0,n1=p.n1*(1+p.br*.55*Math.sin(t*.8+l*.38)),rot=t*.12*p.br*(l%2?1:-1);let mx=0;
    for(let i=0;i<=pts;i++){rr[i]=this.r(p.m,n1,p.n2,p.n3,i/pts*TAU);if(rr[i]>mx)mx=rr[i];}
    const sc=S*.44*(1-f*.85)/(mx||1);ctx.beginPath();for(let i=0;i<=pts;i++){const ph=i/pts*TAU+rot,X=S/2+Math.cos(ph)*rr[i]*sc,Y=S/2+Math.sin(ph)*rr[i]*sc;i?ctx.lineTo(X,Y):ctx.moveTo(X,Y);}
    ctx.strokeStyle=pcol(g.pal,.3+.7*f);ctx.stroke();}}},

/* 12 Elementaire CA */
{id:'ec',name:'Elementaire automaat',sub:'Wolfram · 256 regels',cat:'Automaten',pal:'fosfor',
what:'Een rij cellen, elke cel kijkt naar zichzelf en zijn twee buren. Eén getal (0–255) is de hele wet. Sommige regels geven orde, andere pure chaos.',
tip:'<b>Probeer:</b> regel 30 (chaos, gebruikt als toevalsgenerator), 90 (Sierpiński), 110 (is Turing-compleet) en 184 (verkeersfiles).',
knobs:[K('rule','regel',0,255,1,30,{re:1}),SEL('start','begin',['Eén cel','Willekeurig'],0,{re:1}),K('sp','rijen per frame',1,6,1,2,{fix:1})],
presets:[['30',{rule:30}],['90',{rule:90}],['110',{rule:110}],['184',{rule:184,start:1}],['73',{rule:73,start:1}]],
init(s,p,g){const W=160;s.W=W;s.g=Grid(W);s.g.px.fill(g.L[0]);s.row=new Uint8Array(W);if(p.start==0)s.row[W>>1]=1;else for(let i=0;i<W;i++)s.row[i]=Math.random()<.5?1:0;},
step(s,p,g){const W=s.W,px=s.g.px,on=g.L[215],off=g.L[0],rule=p.rule|0;
  for(let k=0;k<p.sp;k++){const r=s.row,n=new Uint8Array(W);for(let i=0;i<W;i++){const idx=(r[(i-1+W)%W]<<2)|(r[i]<<1)|r[(i+1)%W];n[i]=(rule>>idx)&1;}s.row=n;
    px.copyWithin(0,W,W*W);for(let i=0;i<W;i++)px[(W-1)*W+i]=n[i]?on:off;}
  blit(s.g,g,true);}},

/* 13 Cyclische CA */
{id:'cc',name:'Cyclische automaat',sub:'Griffeath · BZ-spiralen',cat:'Patronen',pal:'iris',
what:'Elke cel heeft een kleur uit een kringloop en schuift één stap door als genoeg buren al verder zijn. Uit ruis groeien draaiende spiralen, net als in de Belousov-Zhabotinsky-reactie.',
tip:'<b>Probeer:</b> weinig toestanden en een hoge drempel ("313") geven turbulente golven. Veel toestanden en drempel 1 geven klassieke "demonen".',
knobs:[K('n','toestanden',3,20,1,14,{re:1,rnd:[3,18]}),K('T','drempel',1,5,1,1,{rnd:[1,3]}),SEL('nb','buurt',['Moore (8)','Von Neumann (4)'],1),K('sp','stappen per frame',1,4,1,2,{fix:1})],
presets:[['Demonen',{n:14,T:1,nb:1}],['313',{n:3,T:3,nb:0}],['Kristal',{n:5,T:2,nb:0}],['Tapijt',{n:8,T:2,nb:0}]],
init(s,p){const N=128;s.N=N;s.a=new Uint8Array(N*N);s.b=new Uint8Array(N*N);for(let i=0;i<N*N;i++)s.a[i]=Math.random()*p.n|0;s.g=Grid(N);},
step(s,p,g){const N=s.N,n=p.n|0,T=p.T|0,moore=p.nb==0;
  for(let k=0;k<p.sp;k++){const a=s.a,b=s.b;for(let y=0;y<N;y++){const ym=((y-1+N)%N)*N,yc=y*N,yp=((y+1)%N)*N;for(let x=0;x<N;x++){const xm=(x-1+N)%N,xp=(x+1)%N,c=a[yc+x],nx=(c+1)%n;
    let cnt=(a[ym+x]===nx)+(a[yp+x]===nx)+(a[yc+xm]===nx)+(a[yc+xp]===nx);if(moore)cnt+=(a[ym+xm]===nx)+(a[ym+xp]===nx)+(a[yp+xm]===nx)+(a[yp+xp]===nx);b[yc+x]=cnt>=T?nx:c;}}s.a=b;s.b=a;}
  const px=s.g.px,L=g.L,a=s.a;for(let i=0;i<a.length;i++)px[i]=L[20+(a[i]/n*235)|0];blit(s.g,g,true);}},

/* 14 DLA */
{id:'dl',name:'Diffusie-aggregatie',sub:'DLA · groeiende fractals',cat:'Groei',pal:'fosfor',
what:'Deeltjes zwerven willekeurig rond en blijven plakken zodra ze de groei raken. Zo ontstaan koraal, ijsbloemen, bliksem en elektrische bomen.',
tip:'<b>Probeer:</b> een lage plakkans geeft dikke, compacte groei. Met wind richting het zaad krijg je slanke bliksemtakken.',
knobs:[K('st','plakkans',.03,1,.01,1,{rnd:[.1,1]}),K('wind','wind naar zaad',0,.5,.01,.05,{rnd:[0,.35]}),SEL('seed','zaad',['Punt','Bodemlijn'],0,{re:1})],
presets:[['IJsbloem',{st:1,wind:.05,seed:0}],['Koraal',{st:.12,wind:0,seed:0}],['Bliksem',{st:1,wind:.3,seed:0}],['Bos',{st:.6,wind:.1,seed:1}]],
init(s,p,g){const N=200;s.N=N;s.o=new Uint8Array(N*N);s.g=Grid(N);s.g.px.fill(g.L[0]);s.c=N>>1;s.rmax=2;s.top=N-1;s.done=0;s.w=null;
  if(p.seed==0){s.o[s.c*N+s.c]=1;s.g.px[s.c*N+s.c]=g.L[255];}else for(let x=0;x<N;x++){s.o[(N-1)*N+x]=1;s.g.px[(N-1)*N+x]=g.L[255];}},
spawn(s,p){const N=s.N;if(p.seed==0){const a=Math.random()*TAU,r=s.rmax+6;return[Math.round(s.c+Math.cos(a)*r),Math.round(s.c+Math.sin(a)*r)];}return[Math.random()*N|0,Math.max(1,s.top-6)];},
step(s,p,g){const N=s.N,o=s.o,px=s.g.px,L=g.L,pt=p.seed==0;
  if(s.done){if(g.t-s.done>2){this.init(s,p,g);}blit(s.g,g,true);return;}
  let [x,y]=s.w||this.spawn(s,p);
  for(let k=0;k<50000;k++){
    if(Math.random()<p.wind){if(pt){const dx=s.c-x,dy=s.c-y;if(Math.abs(dx)>Math.abs(dy))x+=Math.sign(dx);else y+=Math.sign(dy);}else y++;}
    else{const d=Math.random()*4|0;if(d===0)x++;else if(d===1)x--;else if(d===2)y++;else y--;}
    if(!pt)x=(x+N)%N;
    if(x<1||x>N-2||y<1||y>N-2){[x,y]=this.spawn(s,p);continue;}
    if(pt){const dx=x-s.c,dy=y-s.c;if(dx*dx+dy*dy>(s.rmax+22)**2){[x,y]=this.spawn(s,p);continue;}}
    const i=y*N+x;if((o[i-1]|o[i+1]|o[i-N]|o[i+N])&&Math.random()<p.st){o[i]=1;s.nst=(s.nst||0)+1;
      if(pt){const r=Math.hypot(x-s.c,y-s.c);if(r>s.rmax)s.rmax=r;px[i]=L[Math.min(255,60+(r/(N*.45))*195|0)];if(s.rmax>N*.45){s.done=g.t;break;}}
      else{if(y<s.top)s.top=y;px[i]=L[Math.min(255,60+((N-y)/N)*195|0)];if(s.top<N*.08){s.done=g.t;break;}}
      [x,y]=this.spawn(s,p);}}
  s.w=[x,y];blit(s.g,g,true);}},

/* 15 Kuramoto */
{id:'km',name:'Kuramoto-oscillatoren',sub:'spontane synchronisatie',cat:'Zwermen',pal:'gloed',
what:'Tientallen klokjes met elk een eigen tempo trekken zachtjes aan elkaar. Boven een kritieke koppeling slaan ze ineens in de maat, net als vuurvliegjes of hartcellen.',
tip:'<b>Probeer:</b> zet de koppeling langzaam van 0 naar 2 en kijk naar het omslagpunt. De chaos klapt dan om in een draaiende spiraalarm.',
knobs:[K('K','koppeling',0,4,.01,1.1,{rnd:[.2,2.5]}),K('sg','tempo-spreiding',0,2,.01,.6,{rnd:[.1,1.4]}),K('n','oscillatoren',8,240,1,90,{re:1,fix:1})],
presets:[['Chaos',{K:.1,sg:.8}],['Omslag',{K:1.1,sg:.6}],['Synchroon',{K:3,sg:.4}],['Clusters',{K:.7,sg:.25}]],
init(s,p,g){const n=p.n|0;s.n=n;s.z=Array.from({length:n},gauss).sort((a,b)=>a-b);s.th=new Float32Array(n).map(()=>Math.random()*TAU);clear(g);},
step(s,p,g){const n=s.n,ctx=g.ctx,S=g.S,D=g.D;let cs=0,sn=0;for(let i=0;i<n;i++){cs+=Math.cos(s.th[i]);sn+=Math.sin(s.th[i]);}cs/=n;sn/=n;const R=Math.hypot(cs,sn),psi=Math.atan2(sn,cs);
  for(let k=0;k<3;k++)for(let i=0;i<n;i++)s.th[i]+=.02*(1+p.sg*s.z[i]+p.K*R*Math.sin(psi-s.th[i]));
  fade(g,.16);ctx.lineWidth=.8*D;ctx.beginPath();const pts=[];
  for(let i=0;i<n;i++){const r=S*(.07+.38*i/(n-1)),x=S/2+Math.cos(s.th[i])*r,y=S/2+Math.sin(s.th[i])*r;pts.push([x,y]);i?ctx.lineTo(x,y):ctx.moveTo(x,y);}
  ctx.strokeStyle='rgba(238,161,60,.35)';ctx.stroke();
  pts.forEach(([x,y],i)=>{ctx.fillStyle=pcol(g.pal,.4+.6*i/n);ctx.beginPath();ctx.arc(x,y,2*D,0,TAU);ctx.fill();});
  ctx.fillStyle='rgba(7,9,12,.8)';ctx.fillRect(S-118*D,S-34*D,108*D,22*D);ctx.fillStyle='#c9d3e6';ctx.font=`${11*D}px "IBM Plex Mono",monospace`;ctx.fillText('sync R = '+R.toFixed(2).replace('.',','),S-110*D,S-19*D);}},

/* 16 Curl-noise stroming */
{id:'fl',name:'Stromingsveld',sub:'curl noise · deeltjesstroming',cat:'Zwermen',pal:'fosfor',
what:'Deeltjes volgen een onzichtbaar veld van ruis. Door de "curl" ervan te nemen stroomt alles zonder te klonteren, zoals rook, water of haar.',
tip:'<b>Probeer:</b> een kleine schaal geeft brede rivieren, een grote schaal fijne haarlokken. Zet het spoor laag voor olieverf-achtige vegen.',
knobs:[K('sc','schaal',.002,.03,.0005,.008),K('sp','snelheid',.3,4,.05,1.4),K('ev','evolutie',0,1,.01,.3),K('tr','spoor',.01,.3,.005,.05,{fix:1})],
presets:[['Rook',{sc:.006,sp:1.2,ev:.3,tr:.04}],['Haar',{sc:.02,sp:1,ev:.1,tr:.02}],['Stroom',{sc:.003,sp:2.5,ev:.5,tr:.08}],['Marmer',{sc:.012,sp:.6,ev:.2,tr:.015}]],
init(s,p,g){const n=2200;s.n=n;s.x=new Float32Array(n).map(()=>Math.random()*320);s.y=new Float32Array(n).map(()=>Math.random()*320);s.l=new Float32Array(n).map(()=>Math.random()*200);clear(g);},
step(s,p,g){fade(g,p.tr);const ctx=g.ctx,D=g.D,sc=p.sc,tz=g.t*p.ev*.25,e=1;const F=(x,y)=>noise(x*sc+tz,y*sc)+.5*noise(x*sc*2.1-tz*.7,y*sc*2.1+11);
  const paths=[new Path2D(),new Path2D(),new Path2D(),new Path2D()];
  for(let i=0;i<s.n;i++){const x=s.x[i],y=s.y[i],vx=F(x,y+e)-F(x,y-e),vy=-(F(x+e,y)-F(x-e,y)),m=Math.hypot(vx,vy)||1,nx=x+vx/m*p.sp,ny=y+vy/m*p.sp;
    paths[i&3].moveTo(x*D,y*D);paths[i&3].lineTo(nx*D,ny*D);s.x[i]=nx;s.y[i]=ny;
    if(--s.l[i]<0||nx<0||nx>320||ny<0||ny>320){s.x[i]=Math.random()*320;s.y[i]=Math.random()*320;s.l[i]=80+Math.random()*200;}}
  ctx.lineWidth=D;paths.forEach((pa,i)=>{ctx.strokeStyle=pcol(g.pal,.45+i*.18);ctx.stroke(pa);});}},

/* 17 Logistieke afbeelding */
{id:'lg',name:'Logistieke afbeelding',sub:'bifurcatie · de weg naar chaos',cat:'Chaos',pal:'fosfor',
what:'x → r·x·(1−x), een populatiemodel met één knop. Verhoog r en het evenwicht splitst zich in 2, 4, 8… waarden tot er chaos ontstaat, met daartussen vensters van orde.',
tip:'<b>Probeer:</b> zoom in op r 3,82–3,86. Daar zit een venster met een baan van periode 3, en daarin weer een kopie van het hele diagram.',
knobs:[K('r0','r van',2.4,3.99,.001,2.8,{re:1,rnd:[2.8,3.8]}),K('r1','r tot',2.5,4,.001,4,{re:1,rnd:[3.6,4]}),K('sp','scansnelheid',0,1,.01,.3,{fix:1})],
presets:[['Geheel',{r0:2.8,r1:4}],['Splitsing',{r0:2.95,r1:3.6}],['Venster 3',{r0:3.82,r1:3.86}],['Rand',{r0:3.54,r1:3.6}]],
init(s,p,g){let r0=p.r0,r1=p.r1;if(r1<=r0)r1=Math.min(4,r0+.01);s.r0=r0;s.r1=r1;const N=320;s.g=Grid(N);const h=new Float32Array(N*N);
  for(let c=0;c<N;c++){const r=r0+(r1-r0)*c/(N-1);let x=.5;for(let i=0;i<300;i++)x=r*x*(1-x);for(let i=0;i<260;i++){x=r*x*(1-x);h[Math.min(N-1,((1-x)*(N-1))|0)*N+c]++;}}
  for(let i=0;i<h.length;i++)s.g.px[i]=g.L[Math.min(255,h[i]?60+Math.log(1+h[i])*38:0)|0];},
step(s,p,g){blit(s.g,g);const ctx=g.ctx,S=g.S,D=g.D,f=(g.t*p.sp*.08)%1,r=s.r0+(s.r1-s.r0)*f,X=f*S;
  ctx.strokeStyle='rgba(238,161,60,.5)';ctx.lineWidth=D;ctx.beginPath();ctx.moveTo(X,0);ctx.lineTo(X,S);ctx.stroke();
  let x=.5;for(let i=0;i<400;i++)x=r*x*(1-x);ctx.fillStyle='#eea13c';for(let i=0;i<64;i++){x=r*x*(1-x);ctx.beginPath();ctx.arc(X,(1-x)*S,2.6*D,0,TAU);ctx.fill();}
  ctx.fillStyle='rgba(7,9,12,.8)';ctx.fillRect(10*D,S-34*D,92*D,22*D);ctx.fillStyle='#c9d3e6';ctx.font=`${11*D}px "IBM Plex Mono",monospace`;ctx.fillText('r = '+r.toFixed(4).replace('.',','),18*D,S-19*D);}},

/* 18 Dubbele slinger */
{id:'dp',name:'Dubbele slinger',sub:'deterministische chaos',cat:'Chaos',pal:'iris',
what:'Een slinger aan een slinger. Tientallen exemplaren starten met een piepklein verschil, lopen eerst synchroon en waaieren dan uit als een bloem.',
tip:'<b>Probeer:</b> een verschil van 10⁻⁹ in plaats van 10⁻⁴. De waaier komt dan later, maar hij komt altijd.',
knobs:[K('n','aantal slingers',1,60,1,30,{re:1,fix:1}),K('e','verschil (10^x)',-9,-1,1,-4,{re:1}),K('a0','beginhoek °',20,179,1,130,{re:1,rnd:[90,179]}),K('gv','zwaartekracht',1,25,.1,9.8)],
presets:[['Waaier',{e:-4,a0:130}],['Traag',{e:-9,a0:130}],['Zacht',{e:-3,a0:60}],['Omslag',{e:-5,a0:175}]],
init(s,p,g){const n=p.n|0,eps=10**p.e,a=p.a0*PI/180;s.P=Array.from({length:n},(_,i)=>({a1:a+i*eps,a2:a+i*eps,w1:0,w2:0,tx:null,ty:null}));clear(g);},
step(s,p,g){const ctx=g.ctx,S=g.S,D=g.D,l=S*.22,gv=p.gv,n=s.P.length;fade(g,.2);ctx.lineCap='round';
  s.P.forEach((q,i)=>{for(let k=0;k<10;k++){const dt=.0025,d=q.a1-q.a2,den=3-Math.cos(2*d);
      const al1=(-gv*3*Math.sin(q.a1)-gv*Math.sin(q.a1-2*q.a2)-2*Math.sin(d)*(q.w2*q.w2+q.w1*q.w1*Math.cos(d)))/den;
      const al2=(2*Math.sin(d)*(q.w1*q.w1*2+gv*2*Math.cos(q.a1)+q.w2*q.w2*Math.cos(d)))/den;q.w1+=al1*dt;q.w2+=al2*dt;q.a1+=q.w1*dt;q.a2+=q.w2*dt;}
    const x1=S/2+Math.sin(q.a1)*l,y1=S*.42+Math.cos(q.a1)*l,x2=x1+Math.sin(q.a2)*l,y2=y1+Math.cos(q.a2)*l,c=pcol(g.pal,.35+.65*i/Math.max(1,n-1));
    ctx.strokeStyle=c;ctx.globalAlpha=.35;ctx.lineWidth=D;ctx.beginPath();ctx.moveTo(S/2,S*.42);ctx.lineTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();ctx.globalAlpha=1;
    if(q.tx!==null){ctx.lineWidth=1.6*D;ctx.beginPath();ctx.moveTo(q.tx,q.ty);ctx.lineTo(x2,y2);ctx.stroke();}q.tx=x2;q.ty=y2;});}},

/* 19 Fyllotaxis */
{id:'fy',name:'Fyllotaxis',sub:'de gulden hoek · zonnebloempit',cat:'Groei',pal:'gloed',
what:'Elk nieuw zaadje komt 137,5° verder te liggen dan het vorige. Precies die irrationele hoek pakt alles het dichtst op elkaar. Een paar tiende graad ernaast geeft spaken en spiralen.',
tip:'<b>Probeer:</b> zet drift op 0 en verschuif de hoek met 0,1°. Bij 137,508° vullen de spiralen alles perfect, daarnaast breekt het open in armen.',
knobs:[K('ang','hoek °',90,180,.001,137.508,{rnd:[130,145]}),K('n','zaden',100,3000,10,1400,{fix:1}),K('dr','drift',0,1,.01,.25,{fix:1}),K('sz','zaadgrootte',.3,2,.01,1,{fix:1})],
presets:[['Zonnebloem',{ang:137.508,dr:0}],['Spaken',{ang:137.3,dr:0}],['Armen',{ang:138.2,dr:0}],['Kruis',{ang:90.4,dr:0}],['Ademend',{ang:137.508,dr:.6}]],
init(){},
step(s,p,g){clear(g);const ctx=g.ctx,S=g.S,n=p.n|0,a=(p.ang+Math.sin(g.t*.25)*p.dr*.9)*PI/180,c=S*.46/Math.sqrt(n);
  for(let i=1;i<n;i++){const r=c*Math.sqrt(i),th=i*a;ctx.fillStyle=pcol(g.pal,.3+.7*(i/n));ctx.beginPath();ctx.arc(S/2+Math.cos(th)*r,S/2+Math.sin(th)*r,Math.max(.6,c*.42*p.sz*(.4+.6*Math.sqrt(i/n))),0,TAU);ctx.fill();}}},

/* 20 Golfinterferentie */
{id:'wv',name:'Golfinterferentie',sub:'rimpels die elkaar kruisen',cat:'Golven',pal:'fosfor',
what:'Een paar puntbronnen zenden cirkelgolven uit. Waar toppen samenvallen versterken ze elkaar, waar top en dal elkaar ontmoeten doven ze uit. Zo ontstaan moiré-achtige waaiers.',
tip:'<b>Probeer:</b> 5 of 7 bronnen geven een quasikristal met vijf- of zevenvoudige symmetrie. Sleep in het beeld om één bron te verplaatsen.',
hint:'sleep = bron verplaatsen',
knobs:[K('n','bronnen',1,9,1,3,{re:1}),K('wl','golflengte',3,40,.5,12),K('sp','snelheid',0,4,.05,1.4,{fix:1}),K('rad','bronafstand',0,.45,.005,.18,{re:1})],
presets:[['Twee',{n:2,wl:10,rad:.15}],['Drie',{n:3,wl:12,rad:.18}],['Quasi 5',{n:5,wl:6,rad:.02}],['Quasi 7',{n:7,wl:5,rad:.01}],['Ring',{n:9,wl:14,rad:.4}]],
init(s,p){const N=150;s.N=N;s.g=Grid(N);s.src=[];for(let j=0;j<p.n;j++){const a=j/p.n*TAU;s.src.push([N/2+Math.cos(a)*p.rad*N,N/2+Math.sin(a)*p.rad*N]);}s.d=s.src.map(q=>this.dist(N,q));},
dist(N,[sx,sy]){const d=new Float32Array(N*N);for(let y=0;y<N;y++)for(let x=0;x<N;x++)d[y*N+x]=Math.hypot(x-sx,y-sy);return d;},
pointer(s,p,x,y){s.src[0]=[x*s.N,y*s.N];s.d[0]=this.dist(s.N,s.src[0]);},
step(s,p,g){const N=s.N,k=TAU/p.wl,w=g.t*p.sp*3,n=s.d.length,px=s.g.px,L=g.L;
  for(let i=0;i<N*N;i++){let v=0;for(let j=0;j<n;j++)v+=Math.cos(k*s.d[j][i]-w);v/=n;px[i]=L[Math.min(255,((v*.5+.5)**1.6*255)|0)];}blit(s.g,g);}},

/* 21 Zandhoop */
{id:'sp',name:'Zandhoop',sub:'Abelian sandpile · zelfgeorganiseerde kritikaliteit',cat:'Automaten',pal:'iris',
what:'Leg korrels op een stapel, en elke cel met 4 of meer korrels valt om en verdeelt ze over zijn buren. Lawines van elke grootte laten een fractale mandala groeien.',
tip:'<b>Probeer:</b> Vier punten. De mandala\'s groeien naar elkaar toe en botsen op een manier die je niet kunt voorspellen.',
knobs:[K('gpf','korrels per frame',20,3000,10,600,{fix:1}),SEL('pl','plek',['Midden','Vier punten','Diagonaal'],0,{re:1})],
presets:[['Mandala',{pl:0,gpf:600}],['Vier',{pl:1,gpf:900}],['Diagonaal',{pl:2,gpf:900}]],
init(s,p){const N=129;s.N=N;s.a=new Uint32Array(N*N);s.g=Grid(N);s.done=0;const c=N>>1,q=N>>2;
  s.pts=p.pl==0?[[c,c]]:p.pl==1?[[q,q],[N-1-q,q],[q,N-1-q],[N-1-q,N-1-q]]:[[q,q],[c,c],[N-1-q,N-1-q]];},
step(s,p,g){const N=s.N,a=s.a;
  if(s.done){if(g.t-s.done>2.5)this.init(s,p);}
  else{const add=Math.max(1,(p.gpf/s.pts.length)|0),st=[];for(const [x,y] of s.pts){a[y*N+x]+=add;st.push(y*N+x);}
    while(st.length){const i=st.pop(),v=a[i];if(v<4)continue;const q=v>>2;a[i]=v&3;s.nt=(s.nt||0)+1;const x=i%N,y=(i/N)|0;
      if(x>0){a[i-1]+=q;if(a[i-1]>=4)st.push(i-1);}if(x<N-1){a[i+1]+=q;if(a[i+1]>=4)st.push(i+1);}
      if(y>0){a[i-N]+=q;if(a[i-N]>=4)st.push(i-N);}if(y<N-1){a[i+N]+=q;if(a[i+N]>=4)st.push(i+N);}}
    for(let x=0;x<N;x++)if(a[N+x]||a[x*N+1]){s.done=g.t;break;}}
  const px=s.g.px,C=[g.L[0],g.L[80],g.L[165],g.L[245]];for(let i=0;i<a.length;i++)px[i]=C[Math.min(3,a[i])];blit(s.g,g,true);}},

/* 22 IFS-varen */
{id:'if',name:'IFS-varen',sub:'Barnsley · iterated function system',cat:'Groei',pal:'mos',
what:'Vier kleine transformaties, willekeurig na elkaar toegepast op één punt. Het resultaat is een varen die tot in het kleinste blaadje op zichzelf lijkt.',
tip:'<b>Probeer:</b> draai de kromming naar negatief voor een spiegelvaren. Zet de bladgrootte op 1,3 voor een wilde, bijna tropische vorm.',
knobs:[K('k','kromming',-.12,.12,.001,.04),K('bl','bladgrootte',.4,1.4,.01,1),K('st','stengel',.7,.9,.001,.85),K('wind','wind',0,1,.01,.4,{fix:1})],
presets:[['Varen',{k:.04,bl:1,st:.85}],['Spiegel',{k:-.05,bl:1,st:.85}],['Tropisch',{k:.02,bl:1.3,st:.83}],['Draad',{k:.08,bl:.5,st:.88}]],
init(s){s.N=320;s.g=Grid(320);s.h=new Float32Array(320*320);s.x=0;s.y=0;},
step(s,p,g){const N=s.N,h=s.h,k=p.k+Math.sin(g.t*1.3)*p.wind*.03,b=p.bl,st=p.st;for(let i=0;i<h.length;i++)h[i]*=.78;
  const ymax=1.6/(1-st)*.98+.4,sc=N*.9/ymax;let x=s.x,y=s.y;
  for(let i=0;i<60000;i++){const r=Math.random();let nx,ny;
    if(r<.01){nx=0;ny=.16*y;}else if(r<.86){nx=st*x+k*y;ny=-k*x+st*y+1.6;}else if(r<.93){nx=b*(.2*x-.26*y);ny=b*(.23*x+.22*y)+1.6;}else{nx=b*(-.15*x+.28*y);ny=b*(.26*x+.24*y)+.44;}
    x=nx;y=ny;const X=(N/2+x*sc)|0,Y=(N*.97-y*sc)|0;if(X>=0&&X<N&&Y>=0&&Y<N)h[Y*N+X]+=1;}
  s.x=x;s.y=y;let m=1;for(let i=0;i<h.length;i++)if(h[i]>m)m=h[i];const lm=1/Math.log(1+m),px=s.g.px,L=g.L;
  for(let i=0;i<h.length;i++)px[i]=h[i]>.05?L[Math.min(255,(Math.pow(Math.log(1+h[i])*lm,.6)*255)|0)]:L[0];blit(s.g,g);}},
];
const KL={beats:0,last:0,o:{lfo:.5,ramp:0},e:{}};
const AU={on:false,ctx:null,base:{},mod:{},o:{rms:0,laag:0,mid:0,hoog:0,centroid:0},e:{},root:9,scale:'Mineur pentatonisch',lastP:0,lastB:0,lastOn:0,slow:0};
const NOTE=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const cl01=v=>v<0?0:v>1?1:(v||0);
const SCALES={'Mineur pentatonisch':[0,3,5,7,10],'Majeur pentatonisch':[0,2,4,7,9],'Dorisch':[0,2,3,5,7,9,10],'Lydisch':[0,2,4,6,7,9,11],'Hirajoshi':[0,2,3,7,8],'Heletoon':[0,2,4,6,8,10]};
const midiFrom=(base,deg)=>{const sc=SCALES[AU.scale],L=sc.length,o=Math.floor(deg/L),i=((deg%L)+L)%L;return base+12*o+sc[i];};
const mtof=m=>440*Math.pow(2,(m-69)/12),nname=m=>NOTE[((m%12)+12)%12]+(Math.floor(m/12)-1);
return {SYSTEMS,S,D,LUTS};})();
const {SYSTEMS,S,D,LUTS}=BENCH;
const only=process.argv[2];const N=+process.argv[3]||600;
const rows=[];
for(const sys of SYSTEMS){ if(only&&sys.id!==only)continue;
  const p={};sys.knobs.forEach(k=>p[k.k]=k.v);const s={o:{},e:{}};const g={ctx:fakeCtx(),S,D,t:0,L:LUTS[sys.pal],pal:sys.pal};
  try{sys.init(s,p,g);}catch(e){rows.push([sys.id,'init-fout '+e.message]);continue;}
  let t=0;for(let i=0;i<60;i++){g.t=t+=1/60;sys.step(s,p,g);sys.outFn&&sys.outFn(s,p,g);s.e={};}
  const ts=[];for(let i=0;i<N;i++){g.t=t+=1/60;const a=performance.now();sys.step(s,p,g);sys.outFn&&sys.outFn(s,p,g);ts.push(performance.now()-a);s.e={};}
  ts.sort((a,b)=>a-b);const mean=ts.reduce((a,b)=>a+b,0)/N;
  rows.push([sys.id,sys.name,mean.toFixed(3),ts[Math.floor(N*.5)].toFixed(3),ts[Math.floor(N*.99)].toFixed(3),ts[N-1].toFixed(3)]);
}
for(const r of rows)console.log(r.join('\t'));
