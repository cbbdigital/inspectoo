/**
 * boot.js — conectează UI-ul la Supabase-ul existent (FAZA 1: DOAR CITIRE).
 * Nu scrie nimic în bază. Datele reale (programări, clienți, poze) sunt citite
 * prin RLS (fiecare inspector vede doar rândurile lui) și injectate în UI.
 */
import { createClient } from '@supabase/supabase-js';
import { fetchAppointments, fetchManualClients, fetchPhotos } from './sync.js';

function cleanUrl(u){
  u = (u||'').trim().replace(/^["']+|["']+$/g,'').replace(/\s+/g,'').replace(/\/+$/,'');
  if(u && !/^https?:\/\//i.test(u)) u = 'https://'+u;
  return u;
}
const URL = cleanUrl(import.meta.env.VITE_SUPABASE_URL);
const KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY||'').trim().replace(/^["']+|["']+$/g,'');

const READONLY = false; // FAZA 2 — scriere activă (creare/editare/ștergere + poze + SMS)

function banner(text, kind){
  let el = document.getElementById('bootBanner');
  if(!el){ el=document.createElement('div'); el.id='bootBanner';
    el.style.cssText='position:fixed;left:50%;transform:translateX(-50%);bottom:84px;z-index:80;max-width:92%;padding:10px 16px;border-radius:12px;font:600 13px/1.4 system-ui,sans-serif;text-align:center;box-shadow:0 8px 28px -10px rgba(0,0,0,.4)';
    document.body.appendChild(el);
  }
  el.textContent=text;
  el.style.background = kind==='err' ? '#d8392b' : (kind==='ok' ? '#15934e' : '#0e1b33');
  el.style.color='#fff';
  if(kind==='ok') setTimeout(()=>{ el && el.remove(); }, 3500);
}

if(!URL || !KEY){
  banner('Lipsesc VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (setează-le în Netlify).', 'err');
  throw new Error('Supabase env vars missing');
}

let sb;
try {
  sb = createClient(URL, KEY, { auth: { persistSession:true, autoRefreshToken:true } });
} catch(e){
  banner('URL Supabase invalid: "'+URL+'". Verifică VITE_SUPABASE_URL în Netlify (ex. https://proiect.supabase.co).', 'err');
  throw e;
}
window.__sb = sb;
window.__inspectoAuth = {
  email: '',
  signOut: async function(){ try{ await sb.auth.signOut(); }catch(e){} try{ localStorage.clear(); }catch(e){} location.reload(); }
};
let INSPECTOR = null; // { id, service_provider_id, is_owner }
let AUTH_UID = null;

// Pune sesiunea Supabase în stocarea partajată (Capacitor Preferences) ca widget-urile
// native (Android/iOS) să poată interoga direct Supabase. No-op în browser normal.
async function exportWidgetSession(){
  try{
    const P = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences);
    if(!P) return;
    const { data } = await sb.auth.getSession();
    const s = data && data.session;
    const blob = { url:URL, anonKey:KEY,
      access_token: s ? s.access_token : '',
      refresh_token: s ? s.refresh_token : '',
      user_id: AUTH_UID || (s && s.user && s.user.id) || '',
      provider_id: (INSPECTOR && INSPECTOR.service_provider_id) || '' };
    await P.set({ key:'inspecto_session', value: JSON.stringify(blob) });
  }catch(e){}
}
try{ sb.auth.onAuthStateChange(function(){ exportWidgetSession(); }); }catch(e){}
async function pushUser(){
  try{
    const { data:{ user } } = await sb.auth.getUser();
    const em = (user && user.email) || '';
    AUTH_UID = (user && user.id) || null;
    window.__inspectoAuth.email = em;
    if(window.InspectoApp && window.InspectoApp.setUser) window.InspectoApp.setUser(em);
    if(user && user.email){
      const { data } = await sb.from('inspectors').select('id, service_provider_id, is_owner').eq('email', user.email).maybeSingle();
      if(data) INSPECTOR = data;
    }
  }catch(e){}
}

/* ---- Sincronizare live telefon ↔ desktop (Realtime Broadcast, fără DB) ---- */
let _rtChannel = null;
function setupRealtime(){
  try{
    if(!INSPECTOR || !INSPECTOR.id || _rtChannel) return;
    const ch = sb.channel('ocr:'+INSPECTOR.id, { config:{ broadcast:{ self:false } } });
    ch.on('broadcast', { event:'ocr' }, function(msg){
      try{ if(window.InspectoApp && window.InspectoApp.onScan) window.InspectoApp.onScan(msg.payload||{}); }catch(e){}
    });
    ch.on('broadcast', { event:'photo' }, function(msg){
      try{ if(window.InspectoApp && window.InspectoApp.onPhoto) window.InspectoApp.onPhoto(msg.payload||{}); }catch(e){}
    });
    ch.subscribe();
    _rtChannel = ch;
    window.__inspectoRT = {
      send: function(payload){ try{ ch.send({ type:'broadcast', event:'ocr', payload:payload }); }catch(e){} }
    };
  }catch(e){}
}

/* ---- FAZA 2: poze — salvare intermediară automată în Storage + upsert (ca aplicația veche) ---- */
function _dataURLtoBlob(u){try{var a=u.split(','),m=(a[0].match(/:(.*?);/)||[])[1]||'image/jpeg',b=atob(a[1]),n=b.length,ar=new Uint8Array(n);while(n--)ar[n]=b.charCodeAt(n);return new Blob([ar],{type:m});}catch(e){return null;}}
const _MON=['January','February','March','April','May','June','July','August','September','October','November','December'];
function _photoPath(uid,plate,date,index){
  var p=String(date).split('-'),y=+p[0],mo=+p[1],da=+p[2];
  var monthYear=_MON[mo-1]+' '+y, dd=('0'+da).slice(-2)+'.'+('0'+mo).slice(-2)+'.'+y;
  return uid+'/'+monthYear+'/'+dd+'/'+String(plate).replace(/\s+/g,'').toUpperCase()+'_'+index+'.jpg';
}
let _photoQ = Promise.resolve();
const _rowCache = {};
window.__inspectoPhotos = {
  // urcă o poză în sesiunea (placă+dată); indexul e calculat din server → continuă corect după pauză/refresh
  add: function(dataUrl, plate, date){
    _photoQ = _photoQ.then(async function(){
      try{
        if(!AUTH_UID){ var u=(await sb.auth.getUser()).data.user; AUTH_UID=u&&u.id; }
        if(!AUTH_UID) return { error:'Nelogat' };
        plate = String(plate||'').replace(/\s+/g,'').toUpperCase();
        if(!plate) return { error:'Lipsește nr. înmatriculare' };
        var blob=_dataURLtoBlob(dataUrl); if(!blob) return { error:'Imagine invalidă' };
        var key=plate+'|'+date, rid=_rowCache[key], row=null;
        if(rid){ row=(await sb.from('inspection_photos').select('*').eq('id',rid).maybeSingle()).data; }
        else{ row=(await sb.from('inspection_photos').select('*').is('appointment_id',null).eq('license_plate',plate).eq('inspection_date',date).maybeSingle()).data; if(row){ rid=row.id; _rowCache[key]=rid; } }
        var nextIdx=1; if(row){ for(var i=1;i<=10;i++){ if(row['photo_'+i+'_url']) nextIdx=i+1; } }
        if(nextIdx>10) return { error:'Maxim 10 poze pe sesiune' };
        var path=_photoPath(AUTH_UID,plate,date,nextIdx);
        var up=await sb.storage.from('inspection-photos').upload(path,blob,{upsert:true,contentType:'image/jpeg'});
        if(up.error) return { error: up.error.message||'Eroare upload' };
        var url=sb.storage.from('inspection-photos').getPublicUrl(path).data.publicUrl;
        var col='photo_'+nextIdx+'_url';
        if(!rid){
          var payload={ appointment_id:null, license_plate:plate, inspection_date:date }; payload[col]=url;
          var ins=await sb.from('inspection_photos').insert(payload).select('id').maybeSingle();
          if(ins.error) return { error: ins.error.message };
          rid=ins.data&&ins.data.id; if(rid)_rowCache[key]=rid;
        } else {
          var u2={}; u2[col]=url;
          var upd=await sb.from('inspection_photos').update(u2).eq('id',rid);
          if(upd.error) return { error: upd.error.message };
        }
        if(_rtChannel){ try{ _rtChannel.send({ type:'broadcast', event:'photo', payload:{ plate:plate, date:date, index:nextIdx, url:url } }); }catch(e){} }
        return { url:url, index:nextIdx };
      }catch(e){ return { error: e.message||String(e) }; }
    });
    return _photoQ;
  }
};

/* ---- FAZA 2: scriere (aceleași operații ca aplicația veche) ---- */
window.__inspectoWrite = {
  // act: 'passed' | 'failed' | 'cancel' ; tpiType: '6_months' | '1_year' | '2_year'
  async setResult(appointmentId, act, tpiType){
    if(!appointmentId || !act) return { error:'Lipsește programarea' };
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(appointmentId)))
      return { error:'Programarea nu e salvată în baza de date încă. Salveaz-o întâi, apoi marchează rezultatul.' };
    try{
      if(act === 'cancel'){
        const { error } = await sb.from('appointments')
          .update({ status:'cancelled', updated_at:new Date().toISOString() })
          .eq('id', appointmentId);
        return { error: error && (error.message||String(error)) };
      }
      const upd = { status:'completed', result:act, updated_at:new Date().toISOString() };
      upd.tpi_type = (act === 'failed') ? null : tpiType;
      const { error } = await sb.from('appointments').update(upd).eq('id', appointmentId);
      if(error) return { error: error.message||String(error) };
      // SMS pe loc, exact ca aplicația veche (funcția edge existentă trimite + programează reminderul din tpi_type)
      let sms = false;
      try{
        const { data:{ session } } = await sb.auth.getSession();
        if(session && session.access_token){
          const res = await fetch(URL + '/functions/v1/send-inspection-completed', {
            method:'POST',
            headers:{ 'Authorization':'Bearer '+session.access_token, 'Content-Type':'application/json' },
            body: JSON.stringify({ appointmentId })
          });
          let b = null; try{ b = await res.json(); }catch(_){}
          sms = res.ok && b && b.success === true;
        }
      }catch(_){}
      return { error:null, sms };
    }catch(e){ return { error: e.message||String(e) }; }
  },
  // c: { plate, phone, itp_expiry_date, nm }
  async addClient(c){
    if(!INSPECTOR || !INSPECTOR.id || !INSPECTOR.service_provider_id) return { error:'Profil inspector negăsit (reloghează-te).' };
    try{
      const { error } = await sb.from('manual_clients').insert({
        inspector_id: INSPECTOR.id,
        service_provider_id: INSPECTOR.service_provider_id,
        license_plate: (c.plate||'').toUpperCase().replace(/\s+/g,'').trim(),
        client_phone: (c.phone||'').trim(),
        itp_expiry_date: c.itp_expiry_date || null,
        client_name: (c.nm||'').trim()
      });
      return { error: error && (error.message||String(error)) };
    }catch(e){ return { error: e.message||String(e) }; }
  },
  // Creare programare nouă → INSERT appointments (ca aplicația veche)
  async saveAppointment(a){
    if(!AUTH_UID) return { error:'Nelogat' };
    try{
      var car=(a.car||'').trim(), sp=car.indexOf(' ');
      var make=sp>0?car.slice(0,sp):car, model=sp>0?car.slice(sp+1):'';
      var time=(a.time||'').trim(); if(/^\d{1,2}:\d{2}$/.test(time)) time=time+':00';
      var row={ inspector_id:AUTH_UID, user_id:(INSPECTOR&&INSPECTOR.service_provider_id)||AUTH_UID,
        client_name:a.nm||'', client_phone:a.phone||'', vehicle_make:make||'', vehicle_model:model||'',
        license_plate:(a.plate||'').toUpperCase().trim(), appointment_date:a.date||null, appointment_time:time||null,
        tpi_type:null, status:'scheduled' };
      var r=await sb.from('appointments').insert(row).select('id').maybeSingle();
      if(r.error) return { error:r.error.message };
      return { error:null, id:r.data&&r.data.id };
    }catch(e){ return { error:e.message||String(e) }; }
  },
  // Editare programare → UPDATE appointments
  async updateAppointment(id, a){
    if(!id) return { error:'Lipsește programarea' };
    try{
      var car=(a.car||'').trim(), sp=car.indexOf(' ');
      var make=sp>0?car.slice(0,sp):car, model=sp>0?car.slice(sp+1):'';
      var time=(a.time||'').trim(); if(/^\d{1,2}:\d{2}$/.test(time)) time=time+':00';
      var patch={ client_name:a.nm, client_phone:a.phone, vehicle_make:make, vehicle_model:model,
        license_plate:(a.plate||'').toUpperCase().trim(), appointment_date:a.date, appointment_time:time,
        updated_at:new Date().toISOString() };
      var smap={azi:'confirmed',asteptare:'scheduled',finalizat:'completed'};
      if(a.status&&smap[a.status]) patch.status=smap[a.status];
      var r=await sb.from('appointments').update(patch).eq('id',id);
      return { error: r.error && r.error.message };
    }catch(e){ return { error:e.message||String(e) }; }
  },
  // Ștergere programare → DELETE appointments
  async deleteAppointment(id){
    if(!id) return { error:'Lipsește programarea' };
    try{ var r=await sb.from('appointments').delete().eq('id',id); return { error:r.error&&r.error.message }; }
    catch(e){ return { error:e.message||String(e) }; }
  },
  // Ștergere client manual → DELETE manual_clients
  async deleteClient(c){
    try{
      var q=sb.from('manual_clients').delete();
      if(c&&c.id&&/^[0-9a-f-]{36}$/i.test(String(c.id))) q=q.eq('id',c.id);
      else q=q.eq('license_plate',((c&&(c.plate||c.license_plate))||'').toUpperCase().replace(/\s+/g,''));
      var r=await q; return { error:r.error&&r.error.message };
    }catch(e){ return { error:e.message||String(e) }; }
  },
  // Salvare setări stație (Date stație + Configurare SMS) → rândul providerului, prin RPC securizat
  async saveSettings(s){
    try{
      s=s||{};
      var st=s.station||{}, sm=s.smsCfg||{};
      var p={
        company_name: (st.name||''),
        itp_station_number: (st.auth||''),
        street: (st.address||''),
        whatsapp_business_name: (sm.company||''),
        whatsapp_business_address: (sm.maps||''),
        phone: (sm.phone||'')
      };
      var r=await sb.rpc('update_station_settings', { p: p });
      if(r.error) return { error: r.error.message||String(r.error) };
      return { error:null, data:r.data };
    }catch(e){ return { error: e.message||String(e) }; }
  }
};

// Citire setări stație din rândul providerului (merge și pt owner, și pt inspector)
async function fetchSettings(){
  try{
    var pid=(INSPECTOR && INSPECTOR.service_provider_id) || AUTH_UID;
    if(!pid) return null;
    var r=await sb.from('users').select('company_name,itp_station_number,street,whatsapp_business_name,whatsapp_business_address,phone').eq('id', pid).maybeSingle();
    var d=r.data; if(!d) return null;
    return {
      station:{ name:d.company_name||'', auth:d.itp_station_number||'', address:d.street||'' },
      smsCfg:{ company:d.whatsapp_business_name||'', maps:d.whatsapp_business_address||'', phone:d.phone||'' }
    };
  }catch(e){ return null; }
}

// Cod de recomandare (ca în aplicația veche: users.referral_code + tabelul referrals)
window.__inspectoRef = async function(){
  try{
    if(!AUTH_UID) return { code:'', completed:0, pending:0, total:0 };
    const { data:u } = await sb.from('users').select('referral_code').eq('id', AUTH_UID).maybeSingle();
    const code = (u && u.referral_code) || '';
    const { data:refs } = await sb.from('referrals').select('status').eq('referrer_user_id', AUTH_UID);
    const arr = refs || [];
    const completed = arr.filter(r=>r.status==='completed').length;
    const pending = arr.filter(r=>r.status==='pending').length;
    return { code, completed, pending, total: arr.length };
  }catch(e){ return { code:'', completed:0, pending:0, total:0, error:e.message||String(e) }; }
};

async function ready(){
  if(window.InspectoApp) return;
  await new Promise(res=>document.addEventListener('inspecto-ready', res, { once:true }));
}

function _ntLabel(t){ t=(t||'').toLowerCase(); if(t.indexOf('itp')>=0||t.indexOf('expir')>=0)return 'Reminder ITP'; if(t.indexOf('complet')>=0||t.indexOf('inspection')>=0)return 'Confirmare inspecție'; if(t.indexOf('reminder')>=0||t.indexOf('appointment')>=0)return 'Reminder programare'; return t||'SMS'; }
function _ntWhen(iso){ try{var d=new Date(iso);return ('0'+d.getDate()).slice(-2)+'.'+('0'+(d.getMonth()+1)).slice(-2)+'.'+d.getFullYear()+' '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);}catch(e){return '';} }
function _mapNotif(r){
  var plate=r.license_plate||r.plate||r.vehicle_plate||r.car_plate||'—';
  var name=r.client_name||r.name||'';
  var car=((r.vehicle_make||'')+' '+(r.vehicle_model||'')).trim()||r.vehicle||'';
  var status=(r.status||'').toLowerCase();
  var sent=(status==='sent'||status==='delivered'||status==='success'||status==='ok');
  var failed=(status==='failed'||status==='error'||status==='undelivered'||status==='rejected');
  var reason=r.error_message||r.error||r.failure_reason||r.reason||r.error_reason||r.status_message||r.status_detail||r.detail||'';
  var typ=_ntLabel(r.message_type||r.type);
  var nm=name||car||plate; if(!nm||!String(nm).length)nm='—';
  return { nm:nm, plate:plate, car:car, type: failed?'Netrimis':(sent?'Trimis':(status||'—')), cls: failed?'bad':(sent?'ok':'warn'),
    when:_ntWhen(r.created_at||r.sent_at||r.inserted_at), desc: failed?('Motiv: '+(reason||'necunoscut'))+(typ?' · '+typ:''):(typ+(name?' · '+name:'')),
    failed:failed, sent:sent };
}
async function fetchNotifs(){
  try{
    const since = new Date(Date.now()-3*864e5).toISOString(); // ~1 zi înainte și una după
    const { data, error } = await sb.from('whatsapp_notifications').select('*').gte('created_at', since).order('created_at',{ascending:false}).limit(100);
    if(error||!data) return [];
    return data.map(_mapNotif);
  }catch(e){ return []; }
}

// Stațiile ITP reale ale providerului (din tabelul inspectors)
async function fetchInspectors(){
  try{
    if(!INSPECTOR || !INSPECTOR.service_provider_id) return [];
    const { data, error } = await sb.from('inspectors').select('*').eq('service_provider_id', INSPECTOR.service_provider_id);
    if(error || !data || !data.length) return [];
    return data.map(function(r){
      var nm=((r.first_name||'')+' '+(r.last_name||'')).trim()||r.name||r.email||'Stație ITP';
      var st=(r.status||'active'); st=(st==='inactive'||st==='inactiv'||st==='disabled')?'inactiv':'activ';
      return { id:r.id, nm:nm, role:r.is_owner?'owner':'inspector', status:st,
        auth:r.authorization_number||r.rar_number||r.rar||r.auth||'', address:r.address||'',
        email:r.email||'', phone:r.phone||'', today:0, week:0 };
    });
  }catch(e){ return []; }
}

async function loadData(){
  const [a, c, p, nf] = await Promise.all([
    fetchAppointments(sb),
    fetchManualClients(sb),
    fetchPhotos(sb),
    fetchNotifs(),
  ]);
  const err = a.error || c.error || p.error;
  await ready();
  await pushUser();
  let insp = await fetchInspectors();
  if(!insp.length && INSPECTOR){
    insp = [{ id:INSPECTOR.id, nm:(window.__inspectoAuth.email||'Stația mea'), role:INSPECTOR.is_owner?'owner':'inspector',
      status:'activ', auth:'', address:'', email:window.__inspectoAuth.email||'', phone:'', today:0, week:0 }];
  }
  setupRealtime();
  exportWidgetSession();
  var settings = await fetchSettings();
  var payload = { appts:a.data, clients:c.data, savedPhotos:p.data, notifs:nf, inspectors:insp };
  if(settings){ payload.station=settings.station; payload.smsCfg=settings.smsCfg; }
  window.InspectoApp.applyData(payload);
  if(READONLY) window.InspectoApp.setReadonly(true);
  if(err){ banner('Unele date nu s-au putut citi: '+(err.message||err), 'err'); }
}

/* ---- Login minimal (necesar pentru RLS) ---- */
function showLogin(){
  const wrap=document.createElement('div');
  wrap.id='loginWrap';
  wrap.style.cssText='position:fixed;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;background:rgba(6,10,18,.72);padding:20px';
  wrap.innerHTML=
    '<form id="loginForm" style="width:100%;max-width:360px;background:#fff;border-radius:20px;padding:24px;font-family:system-ui,sans-serif;box-shadow:0 20px 60px -20px rgba(0,0,0,.5)">'+
    '<div style="font:800 20px/1.2 system-ui;color:#0e1b33;margin-bottom:4px">Inspecto</div>'+
    '<div style="color:#64748b;font-size:13px;margin-bottom:18px">Autentifică-te cu contul tău existent.</div>'+
    '<input id="lg_em" type="email" placeholder="Email" autocomplete="username" required style="width:100%;padding:12px 14px;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:10px;font-size:15px">'+
    '<input id="lg_pw" type="password" placeholder="Parolă" autocomplete="current-password" required style="width:100%;padding:12px 14px;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:14px;font-size:15px">'+
    '<button type="submit" id="lg_go" style="width:100%;padding:13px;border:0;border-radius:12px;background:#1452e6;color:#fff;font-weight:700;font-size:15px;cursor:pointer">Intră în cont</button>'+
    '<div id="lg_err" style="color:#d8392b;font-size:12.5px;margin-top:10px;min-height:16px"></div>'+
    '</form>';
  document.body.appendChild(wrap);
  wrap.querySelector('#loginForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const em=wrap.querySelector('#lg_em').value.trim();
    const pw=wrap.querySelector('#lg_pw').value;
    const btn=wrap.querySelector('#lg_go'); btn.disabled=true; btn.textContent='Se conectează…';
    wrap.querySelector('#lg_err').textContent='';
    const { error } = await sb.auth.signInWithPassword({ email:em, password:pw });
    if(error){ wrap.querySelector('#lg_err').textContent='Autentificare eșuată. Verifică emailul și parola.'; btn.disabled=false; btn.textContent='Intră în cont'; return; }
    wrap.remove();
    loadData();
  });
}

(async ()=>{
  const { data:{ session } } = await sb.auth.getSession();
  if(session) loadData();
  else showLogin();
})();
