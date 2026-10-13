import { isSupabaseConfigured, requireSupabase } from './supabase';
export type UnitStatus='Kosong'|'Dipakai'|'Hampir habis'|'Overtime'|'Dijeda'|'Maintenance';
export type UnitView={dbId?:string;id:string;type:string;room:string;status:UnitStatus;time:string;label:string;customer:string;start:string;end:string;cost:string;progress:number;remainingSeconds?:number;plannedSeconds?:number;startedAt?:string;plannedEndAt?:string|null;sessionId?:string;ratePlanId?:string;note?:string;billingType?:string};
export type RatePlan={id:string;name:string;billing_type:'hourly'|'package'|'open';duration_minutes:number|null;price:number;price_per_hour:number;console_type:string;room:string};
export const demoUnits:UnitView[]=[{id:'PS 01',type:'PS5',room:'VIP',status:'Dipakai',time:'01:42:18',label:'Sisa waktu',customer:'Rizky Pratama',start:'14:00',end:'17:00',cost:'Rp 45.000',progress:43,remainingSeconds:6138,plannedSeconds:10800},{id:'PS 02',type:'PS5',room:'VIP',status:'Hampir habis',time:'00:08:42',label:'Sisa waktu',customer:'Dimas Saputra',start:'15:30',end:'17:00',cost:'Rp 30.000',progress:91,remainingSeconds:522,plannedSeconds:5400},{id:'PS 03',type:'PS4',room:'Reguler',status:'Kosong',time:'Siap main',label:'Tersedia sekarang',customer:'Belum ada sesi',start:'—',end:'—',cost:'Rp 10.000/jam',progress:0},{id:'PS 04',type:'PS4',room:'Reguler',status:'Overtime',time:'+00:12:09',label:'Melewati waktu',customer:'Fajar Nugroho',start:'14:45',end:'16:45',cost:'Rp 22.500',progress:100,remainingSeconds:-729,plannedSeconds:7200},{id:'PS 05',type:'PS5',room:'Reguler',status:'Dijeda',time:'00:47:31',label:'Sisa saat dijeda',customer:'Andi Maulana',start:'15:15',end:'17:15',cost:'Rp 30.000',progress:60,remainingSeconds:2851,plannedSeconds:7200},{id:'PS 06',type:'PS4',room:'Reguler',status:'Maintenance',time:'Tidak aktif',label:'Sejak 13:20',customer:'Stik sedang diperbaiki',start:'—',end:'—',cost:'—',progress:0,note:'Stik sedang diperbaiki'}];
export const formatIDR=(v:number)=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Math.max(0,Math.round(v)));
export const formatTimer=(v:number)=>{const n=Math.abs(Math.trunc(v));return (v<0?'+':'')+[Math.floor(n/3600),Math.floor(n%3600/60),n%60].map(x=>String(x).padStart(2,'0')).join(':')};
const clock=(v?:string|null)=>v?new Intl.DateTimeFormat('id-ID',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Jakarta',hour12:false}).format(new Date(v)):'—';
export async function loadDashboardUnits():Promise<UnitView[]>{if(!isSupabaseConfigured)return demoUnits;const {data,error}=await requireSupabase().from('units').select('id,code,name,console_type,room,status,notes,is_active,default_hourly_rate,sessions(id,customer_name,status,billing_type,started_at,planned_end_at,paused_at,total_paused_seconds,subtotal,total,rate_snapshot,rate_plan_id)').eq('is_active',true).is('deleted_at',null).order('code');if(error)throw error;return (data??[]).map((u:any)=>{const s=(u.sessions??[]).find((x:any)=>['active','paused','overtime'].includes(x.status));if(!s)return {dbId:u.id,id:u.name||u.code,type:u.console_type,room:u.room,status:u.status==='maintenance'?'Maintenance':'Kosong',time:u.status==='maintenance'?'Tidak aktif':'Siap main',label:u.status==='maintenance'?'Tidak tersedia':'Tersedia sekarang',customer:u.status==='maintenance'?(u.notes||'Unit maintenance'):'Belum ada sesi',start:'—',end:'—',cost:formatIDR(Number(u.default_hourly_rate||0))+'/jam',progress:0,note:u.notes||undefined};const paused=s.status==='paused';const remaining=s.planned_end_at?Math.floor((new Date(s.planned_end_at).getTime()-(paused?new Date(s.paused_at).getTime():Date.now()))/1000):undefined;const status:UnitStatus=paused?'Dijeda':s.status==='overtime'||(remaining!==undefined&&remaining<0)?'Overtime':(remaining!==undefined&&remaining<=600)?'Hampir habis':'Dipakai';const plan=Math.max(1,Math.floor((new Date(s.planned_end_at||Date.now()).getTime()-new Date(s.started_at).getTime())/1000));return {dbId:u.id,id:u.name||u.code,type:u.console_type,room:u.room,status,time:remaining===undefined?'Open billing':formatTimer(remaining),label:paused?'Sisa saat dijeda':status==='Overtime'?'Melewati waktu':'Sisa waktu',customer:s.customer_name||'Pelanggan',start:clock(s.started_at),end:clock(s.planned_end_at),cost:formatIDR(Number(s.total??s.subtotal??s.rate_snapshot?.price??0)),progress:remaining===undefined?0:Math.min(100,Math.max(0,Math.round((plan-Math.max(remaining,0))/plan*100))),remainingSeconds:remaining,plannedSeconds:plan,startedAt:s.started_at,plannedEndAt:s.planned_end_at,sessionId:s.id,ratePlanId:s.rate_plan_id,billingType:s.billing_type,note:u.notes||undefined};});}
export async function loadRatePlans():Promise<RatePlan[]>{if(!isSupabaseConfigured)return [{id:'demo-ps4',name:'PS4 Reguler · 1 Jam',billing_type:'package',duration_minutes:60,price:10000,price_per_hour:10000,console_type:'PS4',room:'Reguler'},{id:'demo-ps5',name:'PS5 Reguler · 1 Jam',billing_type:'package',duration_minutes:60,price:15000,price_per_hour:15000,console_type:'PS5',room:'Reguler'},{id:'demo-vip',name:'PS5 VIP · 1 Jam',billing_type:'package',duration_minutes:60,price:20000,price_per_hour:20000,console_type:'PS5',room:'VIP'}];const {data,error}=await requireSupabase().from('rate_plans').select('id,name,billing_type,duration_minutes,price,price_per_hour,console_type,room').eq('is_active',true).order('price');if(error)throw error;return (data??[]) as RatePlan[];}
export async function startSession(i:{unitId:string;ratePlanId?:string;durationMinutes:number;customerName:string;billingType:'package'|'hourly'|'open';ratePerHour:number}){return requireSupabase().rpc('start_rental_session',{p_unit_id:i.unitId,p_rate_plan_id:i.ratePlanId&&!i.ratePlanId.startsWith('demo-')?i.ratePlanId:null,p_customer_name:i.customerName||null,p_billing_type:i.billingType,p_duration_minutes:i.billingType==='open'?null:i.durationMinutes,p_rate_per_hour:i.ratePerHour});}
export async function extendSession(id:string,minutes:number){return requireSupabase().rpc('extend_rental_session',{p_session_id:id,p_minutes:minutes});}
export async function pauseSession(id:string){return requireSupabase().rpc('pause_rental_session',{p_session_id:id,p_reason:null});}
export async function resumeSession(id:string){return requireSupabase().rpc('resume_rental_session',{p_session_id:id});}
export async function endSession(i:{sessionId:string;method:'cash'|'transfer'|'qris'|'other';receivedAmount:number}){return requireSupabase().rpc('end_rental_session',{p_session_id:i.sessionId,p_payment_method:i.method,p_received_amount:i.receivedAmount});}
export async function setUnitMaintenance(id:string,enabled:boolean,note=''){const {error}=await requireSupabase().from('units').update({status:enabled?'maintenance':'available',notes:note||null}).eq('id',id);if(error)throw error;}
export function subscribeToRentalChanges(cb:()=>void){if(!isSupabaseConfigured)return ()=>undefined;const c=requireSupabase().channel('rentalps-live-updates').on('postgres_changes',{event:'*',schema:'public',table:'units'},cb).on('postgres_changes',{event:'*',schema:'public',table:'sessions'},cb).on('postgres_changes',{event:'*',schema:'public',table:'payments'},cb).subscribe();return ()=>{void requireSupabase().removeChannel(c);};}

export type ManagedUnit = {
  id?: string; code: string; name: string; console_type: string; room: string;
  status: 'available'|'maintenance'; default_hourly_rate: number; notes?: string|null;
  is_active?: boolean;
};
export type ManagedRate = RatePlan & {
  business_id?: string; is_active?: boolean; rounding_rule_minutes?: number;
  overtime_tolerance_minutes?: number;
};
export type ManagedMember = {
  user_id: string; role: 'owner'|'admin'|'operator'; is_active: boolean;
  email: string; display_name: string;
};
export type HistoryRecord = {
  id: string; customer: string; unit: string; console_type: string; room: string;
  started_at: string; ended_at: string|null; duration_minutes: number;
  total: number; status: 'Selesai'|'Aktif'|'Dijeda'|'Overtime'|'Dibatalkan';
  payment_status: string; payment_method: string;
};
async function currentBusinessContext() {
  const client = requireSupabase();
  const {data:{user},error:userError} = await client.auth.getUser();
  if(userError) throw userError;
  if(!user) throw new Error('Sesi login berakhir. Silakan masuk kembali.');
  const {data:membership,error} = await client.from('business_members')
    .select('business_id,role').eq('user_id',user.id).eq('is_active',true).limit(1).maybeSingle();
  if(error) throw error;
  if(!membership) throw new Error('Akun ini belum ditautkan ke usaha. Tambahkan akun sebagai anggota di Supabase terlebih dahulu.');
  return {businessId:membership.business_id as string,userId:user.id,role:membership.role as string};
}
export async function loadManagedUnits():Promise<ManagedUnit[]> {
  if(!isSupabaseConfigured) return demoUnits.map((u,i)=>({
    id:'demo-unit-'+(i+1),code:u.id,name:u.id,console_type:u.type,room:u.room,
    status:u.status==='Maintenance'?'maintenance':'available',
    default_hourly_rate:u.type==='PS5'?(u.room==='VIP'?20000:15000):10000,
    notes:u.note??null,is_active:true
  }));
  const {businessId}=await currentBusinessContext();
  const {data,error}=await requireSupabase().from('units')
    .select('id,business_id,code,name,console_type,room,status,default_hourly_rate,notes,is_active')
    .eq('business_id',businessId).is('deleted_at',null).order('code');
  if(error) throw error;
  return (data??[]) as ManagedUnit[];
}
export async function saveManagedUnit(input:ManagedUnit):Promise<void> {
  const client=requireSupabase();
  const {businessId}=await currentBusinessContext();
  const row={business_id:businessId,code:input.code.trim(),name:input.name.trim(),
    console_type:input.console_type,room:input.room.trim()||'Reguler',
    status:input.status,default_hourly_rate:Math.max(0,Math.round(Number(input.default_hourly_rate)||0)),
    notes:input.notes?.trim()||null,is_active:true};
  if(!row.code||!row.name) throw new Error('Kode dan nama unit wajib diisi.');
  const query=input.id&&!input.id.startsWith('demo-') ?
    client.from('units').update(row).eq('id',input.id).eq('business_id',businessId) :
    client.from('units').insert(row);
  const {error}=await query;
  if(error) throw error;
}
export async function deactivateManagedUnit(id:string):Promise<void> {
  const {businessId}=await currentBusinessContext();
  const {error}=await requireSupabase().from('units')
    .update({is_active:false,deleted_at:new Date().toISOString()})
    .eq('id',id).eq('business_id',businessId);
  if(error) throw error;
}
export async function loadManagedRates():Promise<ManagedRate[]> {
  const rates=await loadRatePlans();
  if(!isSupabaseConfigured) return rates.map((r,i)=>({...r,id:r.id||'demo-rate-'+i,is_active:true,rounding_rule_minutes:15,overtime_tolerance_minutes:5}));
  const {businessId}=await currentBusinessContext();
  const {data,error}=await requireSupabase().from('rate_plans')
    .select('id,business_id,name,billing_type,duration_minutes,price,price_per_hour,console_type,room,rounding_rule_minutes,overtime_tolerance_minutes,is_active')
    .eq('business_id',businessId).order('price');
  if(error) throw error;
  return (data??[]) as ManagedRate[];
}
export async function saveManagedRate(input:ManagedRate):Promise<void> {
  const client=requireSupabase();
  const {businessId}=await currentBusinessContext();
  const price=Number(input.price), hourly=Number(input.price_per_hour||input.price);
  if(!input.name.trim()||!Number.isFinite(price)||price<=0||!Number.isFinite(hourly)||hourly<=0) throw new Error('Nama dan harga tarif harus diisi dengan nilai positif.');
  if(input.billing_type==='package'&&(!input.duration_minutes||input.duration_minutes<15)) throw new Error('Paket harus memiliki durasi minimal 15 menit.');
  const row={business_id:businessId,name:input.name.trim(),billing_type:input.billing_type,
    duration_minutes:input.billing_type==='open'?null:input.duration_minutes,
    price:Math.round(price),price_per_hour:Math.round(hourly),console_type:input.console_type||'Lainnya',
    room:input.room||'Reguler',rounding_rule_minutes:input.rounding_rule_minutes??15,
    overtime_tolerance_minutes:input.overtime_tolerance_minutes??5,is_active:true};
  const query=input.id&&!input.id.startsWith('demo-') ?
    client.from('rate_plans').update(row).eq('id',input.id).eq('business_id',businessId) :
    client.from('rate_plans').insert(row);
  const {error}=await query;
  if(error) throw error;
}
export async function deactivateManagedRate(id:string):Promise<void> {
  const {businessId}=await currentBusinessContext();
  const {error}=await requireSupabase().from('rate_plans').update({is_active:false}).eq('id',id).eq('business_id',businessId);
  if(error) throw error;
}
export async function loadManagedMembers():Promise<ManagedMember[]> {
  if(!isSupabaseConfigured) return [
    {user_id:'demo-owner',role:'owner',is_active:true,email:'pemilik@demo.rentalps.id',display_name:'Pemilik Demo'},
    {user_id:'demo-operator',role:'operator',is_active:true,email:'operator@demo.rentalps.id',display_name:'Operator Demo'}
  ];
  const {data,error}=await requireSupabase().functions.invoke('invite-member',{body:{action:'list'}});
  if(error) throw new Error('Fungsi manajemen pengguna belum dideploy di Supabase. Deploy supabase/functions/invite-member lalu coba kembali.');
  if(data?.error) throw new Error(String(data.error));
  return (data?.members??[]) as ManagedMember[];
}
export async function inviteManagedMember(email:string,role:'admin'|'operator'):Promise<void> {
  const {data,error}=await requireSupabase().functions.invoke('invite-member',{body:{action:'invite',email,role}});
  if(error) throw new Error('Gagal mengundang pengguna. Pastikan Edge Function invite-member sudah dideploy.');
  if(data?.error) throw new Error(String(data.error));
}
export async function updateManagedMember(input:{user_id:string;role?:'admin'|'operator';is_active?:boolean}):Promise<void> {
  const {data,error}=await requireSupabase().functions.invoke('invite-member',{body:{action:input.role?'set_role':'set_active',user_id:input.user_id,role:input.role,is_active:input.is_active}});
  if(error) throw new Error('Gagal mengubah anggota. Pastikan Edge Function invite-member sudah dideploy.');
  if(data?.error) throw new Error(String(data.error));
}
const demoHistory:HistoryRecord[]=[
  {id:'SES-DEMO-018',customer:'Budi Santoso',unit:'PS 03',console_type:'PS4',room:'Reguler',started_at:new Date(Date.now()-45*60000).toISOString(),ended_at:new Date(Date.now()-5*60000).toISOString(),duration_minutes:40,total:15000,status:'Selesai',payment_status:'paid',payment_method:'cash'},
  {id:'SES-DEMO-017',customer:'Siti Aisyah',unit:'PS 06',console_type:'PS4',room:'Reguler',started_at:new Date(Date.now()-120*60000).toISOString(),ended_at:new Date(Date.now()-10*60000).toISOString(),duration_minutes:110,total:20000,status:'Selesai',payment_status:'paid',payment_method:'qris'},
  {id:'SES-DEMO-016',customer:'Rizky Pratama',unit:'PS 01',console_type:'PS5',room:'VIP',started_at:new Date(Date.now()-90*60000).toISOString(),ended_at:null,duration_minutes:90,total:45000,status:'Aktif',payment_status:'unpaid',payment_method:'—'},
  {id:'SES-DEMO-015',customer:'Nadia Putri',unit:'PS 02',console_type:'PS5',room:'VIP',started_at:new Date(Date.now()-160*60000).toISOString(),ended_at:new Date(Date.now()-40*60000).toISOString(),duration_minutes:120,total:40000,status:'Selesai',payment_status:'paid',payment_method:'transfer'},
  {id:'SES-DEMO-014',customer:'Andi Maulana',unit:'PS 05',console_type:'PS5',room:'Reguler',started_at:new Date(Date.now()-200*60000).toISOString(),ended_at:null,duration_minutes:120,total:30000,status:'Dijeda',payment_status:'unpaid',payment_method:'—'}
];
function statusLabel(status:string):HistoryRecord['status'] {
  const statuses:Record<string,HistoryRecord['status']>={completed:'Selesai',active:'Aktif',paused:'Dijeda',overtime:'Overtime',cancelled:'Dibatalkan'};
  return statuses[status]??'Aktif';
}
function durationBetween(start:string,end:string|null) {
  return Math.max(0,Math.round(((end?new Date(end).getTime():Date.now())-new Date(start).getTime())/60000));
}
export async function loadHistorySessions():Promise<HistoryRecord[]> {
  if(!isSupabaseConfigured) return demoHistory;
  const {businessId}=await currentBusinessContext();
  const since=new Date(Date.now()-90*24*60*60*1000).toISOString();
  const {data,error}=await requireSupabase().from('sessions')
    .select('id,customer_name,status,billing_type,started_at,planned_end_at,ended_at,total,subtotal,payment_status,units(name,code,console_type,room),payments(method,amount,received_amount,change_amount,paid_at)')
    .eq('business_id',businessId).gte('started_at',since).order('started_at',{ascending:false}).limit(500);
  if(error) throw error;
  return (data??[]).map((s:any)=>({
    id:s.id,customer:s.customer_name||'Pelanggan',unit:s.units?.name||s.units?.code||'Unit',
    console_type:s.units?.console_type||'—',room:s.units?.room||'—',started_at:s.started_at,
    ended_at:s.ended_at??null,duration_minutes:durationBetween(s.started_at,s.ended_at),
    total:Number(s.total??s.subtotal??0),status:statusLabel(s.status),
    payment_status:s.payment_status||'unpaid',payment_method:s.payments?.[0]?.method||'—'
  })) as HistoryRecord[];
}
