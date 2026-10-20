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

const READONLY = true; // FAZA 1 — nu scriem în bază

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
async function pushUser(){
  try{
    const { data:{ user } } = await sb.auth.getUser();
    const em = (user && user.email) || '';
    window.__inspectoAuth.email = em;
    if(window.InspectoApp && window.InspectoApp.setUser) window.InspectoApp.setUser(em);
    if(user && user.email){
      const { data } = await sb.from('inspectors').select('id, service_provider_id, is_owner').eq('email', user.email).maybeSingle();
      if(data) INSPECTOR = data;
    }
  }catch(e){}
}

/* ---- FAZA 2: scriere (aceleași operații ca aplicația veche) ---- */
window.__inspectoWrite = {
  // act: 'passed' | 'failed' | 'cancel' ; tpiType: '6_months' | '1_year' | '2_year'
  async setResult(appointmentId, act, tpiType){
    if(!appointmentId || !act) return { error:'Lipsește programarea' };
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
  }
};

async function ready(){
  if(window.InspectoApp) return;
  await new Promise(res=>document.addEventListener('inspecto-ready', res, { once:true }));
}

async function loadData(){
  banner('Se încarcă datele…');
  const [a, c, p] = await Promise.all([
    fetchAppointments(sb),
    fetchManualClients(sb),
    fetchPhotos(sb),
  ]);
  const err = a.error || c.error || p.error;
  await ready();
  await pushUser();
  window.InspectoApp.applyData({ appts:a.data, clients:c.data, savedPhotos:p.data });
  if(READONLY) window.InspectoApp.setReadonly(true);
  if(err){ banner('Unele date nu s-au putut citi: '+(err.message||err), 'err'); }
  else { banner('Date reale încărcate · '+a.data.length+' programări · '+c.data.length+' clienți (doar citire)', 'ok'); }
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
