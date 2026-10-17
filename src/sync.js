/**
 * sync.js — ÎMPERECHERE + SINCRONIZARE cu baza Supabase existentă (Inspecto).
 * Nu modifică schema: folosește doar tabelele actuale.
 * Tabele: appointments, manual_clients, inspection_photos (photo_1_url..photo_10_url),
 * storage bucket: "inspection-photos".
 */

const MONTHS_EN = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];
const MONTHS_RO = ['ianuarie','februarie','martie','aprilie','mai','iunie',
  'iulie','august','septembrie','octombrie','noiembrie','decembrie'];

function splitCar(s){ s=(s||'').trim(); const i=s.indexOf(' '); return i<0?{make:s,model:''}:{make:s.slice(0,i),model:s.slice(i+1)}; }

export const map = {
  apptFromRow: (r) => ({
    id: r.id,
    date: r.appointment_date || '',
    time: (r.appointment_time || '').slice(0,5),
    nm: r.client_name || '',
    car: [r.vehicle_make, r.vehicle_model].filter(Boolean).join(' '),
    plate: r.license_plate || '',
    phone: r.client_phone || '',
    status: mapStatusIn(r.status),
    result: r.result || '',
    inspectorId: r.inspector_id || null,
  }),
  apptToRow: (a) => {
    const c = splitCar(a.car);
    return {
      appointment_date: a.date || null,
      appointment_time: a.time || null,
      client_name: a.nm || '',
      vehicle_make: c.make,
      vehicle_model: c.model,
      license_plate: a.plate || '',
      client_phone: a.phone || '',
      status: a.status || 'scheduled',
      result: a.result || null,
      inspector_id: a.inspectorId || null,
    };
  },
  clientFromRow: (r) => ({
    id: r.id,
    client_name: r.client_name || '',
    license_plate: r.license_plate || '',
    client_phone: r.client_phone || '',
    itp_expiry_date: r.itp_expiry_date || '',
  }),
  clientToRow: (c, ctx) => ({
    inspector_id: ctx.inspectorId || null,
    service_provider_id: ctx.serviceProviderId || null,
    client_name: c.client_name || '',
    license_plate: (c.license_plate || '').toUpperCase().replace(/\s+/g,''),
    client_phone: c.client_phone || '',
    itp_expiry_date: c.itp_expiry_date || null,
  }),
  photoFromRow: (r) => {
    const imgs=[]; for(let i=1;i<=10;i++) if(r['photo_'+i+'_url']) imgs.push(r['photo_'+i+'_url']);
    return { date:r.inspection_date||'', plate:r.license_plate||'', appointmentId:r.appointment_id||null, n:imgs.length, imgs };
  },
};

// Statusul vechi -> statusul prototipului (azi / finalizat / asteptare)
function mapStatusIn(s){
  s=(s||'').toLowerCase();
  if(/complet|finaliz|done|passed|respins|reject/.test(s)) return 'finalizat';
  if(/wait|astept|pending|hold/.test(s)) return 'asteptare';
  return 'azi';
}

/* ---------------- CITIRE (faza 1) ---------------- */
export async function fetchAppointments(sb, opts={}){
  let q = sb.from('appointments').select('*');
  if(opts.inspectorId) q = q.eq('inspector_id', opts.inspectorId);
  const { data, error } = await q;
  if(error) return { data:[], error };
  return { data:(data||[]).map(map.apptFromRow), error:null };
}

export async function fetchManualClients(sb, opts={}){
  let q = sb.from('manual_clients').select('*');
  if(opts.inspectorId) q = q.eq('inspector_id', opts.inspectorId);
  const { data, error } = await q;
  if(error) return { data:[], error };
  return { data:(data||[]).map(map.clientFromRow), error:null };
}

export async function fetchPhotos(sb, opts={}){
  const { data, error } = await sb.from('inspection_photos').select('*');
  if(error) return { data:[], error };
  return { data:(data||[]).map(map.photoFromRow), error:null };
}

/* ---------------- SCRIERE (faza 2 — folosite doar când nu e read-only) ---------------- */
export async function saveAppointment(sb, a){
  const row = map.apptToRow(a);
  if(a.id) return sb.from('appointments').update(row).eq('id', a.id).select().single();
  return sb.from('appointments').insert(row).select().single();
}
export async function addManualClient(sb, ctx, c){
  return sb.from('manual_clients').insert(map.clientToRow(c, ctx)).select().single();
}
export async function deleteManualClient(sb, id){
  return sb.from('manual_clients').delete().eq('id', id);
}

/* ---------------- Realtime ---------------- */
export function subscribe(sb, table, onChange){
  const ch = sb.channel('sync:'+table)
    .on('postgres_changes', { event:'*', schema:'public', table }, onChange)
    .subscribe();
  return () => sb.removeChannel(ch);
}
