import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  deactivateManagedRate, deactivateManagedUnit, formatIDR, inviteManagedMember,
  loadAuditEntries, loadBusinessSettings, loadHistorySessions, loadManagedMembers, settleSessionPayment, createPaymentRequestKey, loadStandaloneFnbOrders, subscribeToRentalChanges,
  loadManagedRates, loadManagedUnits, loadRevenuePayments, resendManagedInvite, saveBusinessSettings, saveManagedRate,
  saveManagedUnit, updateManagedMember, type AuditRecord, type BusinessSettings, type PaymentMethod,
  type HistoryRecord, type ManagedRate, type ManagedUnit, type RevenuePayment,
} from "./lib/rentalApi";
import { isSupabaseConfigured } from "./lib/supabase";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

type ManagerPage = "Unit" | "Tarif" | "Pengguna";
type Row = Record<string, any>;

function exportCsv(filename: string, headers: string[], rows: Array<Array<string | number | null | undefined>>) {
  const quote = (value: string | number | null | undefined) => {
    const text = String(value ?? "");
    return /[",\r\n;]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  const csv = "\uFEFF" + [headers, ...rows].map(row => row.map(quote).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
function exportExcel(filename:string,title:string,headers:string[],rows:Array<Array<string|number|null|undefined>>) {
  // SpreadsheetML is natively readable by Microsoft Excel and avoids a third-party XLSX parser.
  const xmlEscape=(value:unknown)=>String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
  const cell=(value:unknown,style?:string)=> {
    const numeric=typeof value==="number"&&Number.isFinite(value);
    return '<Cell'+(style?' ss:StyleID="'+style+'"':'')+'><Data ss:Type="'+(numeric?'Number':'String')+'">'+xmlEscape(value)+'</Data></Cell>';
  };
  const allRows=[ [title], headers, ...rows ];
  const sheetRows=allRows.map((row,index)=>'<Row>'+row.map(value=>cell(value,index===1?'Header':undefined)).join('')+'</Row>').join('');
  const xml='<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>'+
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">'+
    '<Styles><Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#372D82" ss:Pattern="Solid"/></Style></Styles>'+
    '<Worksheet ss:Name="Laporan"><Table>'+sheetRows+'</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>2</SplitHorizontal><TopRowBottomPane>2</TopRowBottomPane></WorksheetOptions></Worksheet></Workbook>';
  const blob=new Blob(["\uFEFF",xml],{type:"application/vnd.ms-excel;charset=utf-8;"});
  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");
  link.href=url;link.download=filename.replace(/\.(xlsx|xls)$/i,".xls");document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
}
function exportPdf(filename:string,title:string,headers:string[],rows:Array<Array<string|number|null|undefined>>) {
  const doc=new jsPDF({orientation:headers.length>6?"landscape":"portrait",unit:"mm",format:"a4"});
  doc.setFontSize(15);doc.text(title,14,15);
  doc.setFontSize(9);doc.text("Dicetak "+new Date().toLocaleString("id-ID"),14,21);
  autoTable(doc,{startY:27,head:[headers],body:rows.map(row=>row.map(value=>String(value??""))),styles:{fontSize:7,cellPadding:2,overflow:"linebreak"},headStyles:{fillColor:[55,45,130]},margin:{left:12,right:12}});
  doc.save(filename);
}

const prettyTime = (value: string | null) => value ? new Date(value).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : "—";
const durationText = (mins: number) => Math.floor(mins / 60) > 0 ? Math.floor(mins / 60) + "j " + (mins % 60) + "m" : (mins % 60) + "m";

export function HistoryPageV2({onReceipt,paymentMethods}:{onReceipt:(sessionId:string)=>void;paymentMethods:PaymentMethod[]}) {
  const [rows,setRows]=useState<HistoryRecord[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [search,setSearch]=useState("");
  const [status,setStatus]=useState("Semua");
  const [paymentStatus,setPaymentStatus]=useState("Semua");
  const [methodFilter,setMethodFilter]=useState("Semua");
  const [fromDate,setFromDate]=useState("");
  const [toDate,setToDate]=useState("");
  const [page,setPage]=useState(1);
  const [settling,setSettling]=useState<HistoryRecord|null>(null);
  const [settleMethod,setSettleMethod]=useState<PaymentMethod>(paymentMethods[0]||"cash");
  const [settleReceived,setSettleReceived]=useState("");
  const [settleBusy,setSettleBusy]=useState(false);
  const [settleRequestKey,setSettleRequestKey]=useState(createPaymentRequestKey);
  useEffect(()=>{if(paymentMethods.length>0&&!paymentMethods.includes(settleMethod))setSettleMethod(paymentMethods[0]);},[paymentMethods,settleMethod]);
  async function refreshRows(){
    setLoading(true);setError("");
    try{setRows(await loadHistorySessions());}
    catch(e){setError(e instanceof Error?e.message:"Riwayat gagal dimuat.");}
    finally{setLoading(false);}
  }
  useEffect(()=>{
    let alive=true;
    void refreshRows();
    const unsubscribe=subscribeToRentalChanges(()=>{if(alive)void refreshRows();});
    return()=>{alive=false;unsubscribe();};
  },[]);
  const filtered=useMemo(()=>rows.filter(row=>{
    const needle=(row.id+" "+row.customer+" "+row.unit).toLowerCase();
    const time=new Date(row.ended_at??row.started_at);
    const key=`${time.getFullYear()}-${String(time.getMonth()+1).padStart(2,"0")}-${String(time.getDate()).padStart(2,"0")}`;
    return (status==="Semua"||row.status===status)
      &&(paymentStatus==="Semua"||row.payment_status===paymentStatus)
      &&(methodFilter==="Semua"||row.payment_method.toLowerCase()===methodFilter.toLowerCase())
      &&(!fromDate||key>=fromDate)&&(!toDate||key<=toDate)
      &&needle.includes(search.toLowerCase());
  }),[rows,status,paymentStatus,methodFilter,fromDate,toDate,search]);
  const size=10;
  const pages=Math.max(1,Math.ceil(filtered.length/size));
  const visible=filtered.slice((page-1)*size,page*size);
  const exportRows=()=>exportCsv("rentalps-riwayat-transaksi.csv",
    ["ID Sesi","Pelanggan","Unit","Konsol","Ruangan","Mulai","Selesai","Durasi menit","Rental IDR","F&B IDR","Total tagihan IDR","Terbayar IDR","Sisa IDR","Status sesi","Status pembayaran","Metode"],
    filtered.map(r=>[r.id,r.customer,r.unit,r.console_type,r.room,prettyTime(r.started_at),prettyTime(r.ended_at),
      r.duration_minutes,r.rental_total,r.fnb_total,r.total,r.paid_amount,r.outstanding,r.status,r.payment_status,r.payment_method])
  );
  const openSettlement=(row:HistoryRecord)=>{
    if(!row.ended_at||row.outstanding<=0)return;
    setSettling(row);setSettleReceived(String(row.outstanding));setSettleRequestKey(createPaymentRequestKey());
    setError("");setNotice("");
  };
  const submitSettlement=async(e:FormEvent)=>{
    e.preventDefault();if(!settling)return;setSettleBusy(true);setError("");setNotice("");
    try{
      const result=await settleSessionPayment({sessionId:settling.id,method:settleMethod,receivedAmount:Number(settleReceived),idempotencyKey:settleRequestKey});
      if(result.error)throw result.error;
      const data=result.data as {applied?:number;change?:number;outstanding?:number};
      setRows(await loadHistorySessions());
      setSettling(null);setSettleRequestKey(createPaymentRequestKey());
      setNotice("Pembayaran gabungan dibukukan "+formatIDR(Number(data.applied||0))+
        "; kembalian "+formatIDR(Number(data.change||0))+"; sisa transaksi "+formatIDR(Number(data.outstanding||0))+".");
    }catch(e){setError(e instanceof Error?e.message:"Pelunasan gagal.");}
    finally{setSettleBusy(false);}
  };
  return <div className="page-content">
    <div className="page-heading"><div><h2>Riwayat Transaksi</h2><p>Riwayat menggabungkan tagihan rental dan F&B yang terhubung ke sesi yang sama.</p></div><button className="btn btn-secondary" onClick={exportRows}>Ekspor CSV</button></div>
    {!isSupabaseConfigured&&<div className="mode-notice">Mode demo: data belum berasal dari database rental.</div>}
    {error&&<div className="app-alert error" role="alert">{error}</div>}
    {notice&&<div className="app-alert" role="status">{notice}<button onClick={()=>setNotice("")}>×</button></div>}
    <div className="panel filters history-filters">
      <label><span>Cari transaksi</span><div className="field"><input value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} placeholder="ID sesi, pelanggan, atau unit"/></div></label>
      <label><span>Status sesi</span><select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option>Semua</option><option>Selesai</option><option>Aktif</option><option>Dijeda</option><option>Overtime</option><option>Dibatalkan</option></select></label>
      <label><span>Status pembayaran</span><select value={paymentStatus} onChange={e=>{setPaymentStatus(e.target.value);setPage(1);}}><option value="Semua">Semua</option><option value="paid">Lunas</option><option value="partial">Sebagian</option><option value="unpaid">Belum dibayar</option></select></label>
      <label><span>Metode</span><select value={methodFilter} onChange={e=>{setMethodFilter(e.target.value);setPage(1);}}><option>Semua</option><option value="cash">Tunai</option><option value="qris">QRIS</option><option value="transfer">Transfer</option><option value="other">Lainnya</option><option value="campuran">Campuran</option><option value="—">Belum ada</option></select></label>
      <label><span>Tanggal mulai</span><input type="date" value={fromDate} max={toDate||undefined} onChange={e=>{setFromDate(e.target.value);setPage(1);}}/></label>
      <label><span>Tanggal selesai</span><input type="date" value={toDate} min={fromDate||undefined} onChange={e=>{setToDate(e.target.value);setPage(1);}}/></label>
      <span className="history-count">{filtered.length} transaksi</span>
      <button className="btn btn-secondary" onClick={()=>void refreshRows()}>Muat ulang</button>
    </div>
    <div className="panel table-wrap"><table><thead><tr>{["ID Sesi","Pelanggan","Unit","Mulai","Durasi","Rental","F&B","Total","Pembayaran","Aksi"].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>
      {loading?<tr><td colSpan={10} className="empty-cell">Memuat transaksi…</td></tr>:visible.length===0?<tr><td colSpan={10} className="empty-cell">Tidak ada transaksi untuk filter ini.</td></tr>:visible.map(r=><tr key={r.id}>
        <td className="session-id">{r.id.slice(0,14)}</td><td>{r.customer}</td><td>{r.unit}</td><td>{prettyTime(r.started_at)}</td><td>{durationText(r.duration_minutes)}</td>
        <td>{formatIDR(r.rental_total)}</td><td>{formatIDR(r.fnb_total)}</td><td><b>{formatIDR(r.total)}</b><small className="table-subtext">{formatIDR(r.paid_amount)} dibayar · {formatIDR(r.outstanding)} tersisa</small></td>
        <td><span className={"table-status "+r.payment_status}>{r.payment_status==="paid"?"Lunas":r.payment_status==="partial"?"Sebagian":"Belum dibayar"}</span>{r.payment_method!=="—"&&<small className="table-subtext">{r.payment_method==="campuran"?"Metode campuran":r.payment_method.toUpperCase()}</small>}</td>
        <td className="management-actions">{isSupabaseConfigured&&r.ended_at&&<><button type="button" className="btn btn-secondary" onClick={()=>onReceipt(r.id)}>Struk</button>{r.outstanding>0&&<button type="button" className="btn btn-primary" onClick={()=>openSettlement(r)}>Bayar sisa</button>}</>}</td>
      </tr>)}
    </tbody></table><div className="table-footer"><span>{filtered.length===0?0:(page-1)*size+1}–{Math.min(page*size,filtered.length)} dari {filtered.length}</span><div><button disabled={page<=1} onClick={()=>setPage(n=>Math.max(1,n-1))}>‹</button><button className="active">{page}/{pages}</button><button disabled={page>=pages} onClick={()=>setPage(n=>Math.min(pages,n+1))}>›</button></div></div></div>
    {settling&&<div className="modal-backdrop" onClick={()=>{if(!settleBusy)setSettling(null);}}><form className="modal" onClick={e=>e.stopPropagation()} onSubmit={e=>void submitSettlement(e)}>
      <div className="modal-head"><div><span className="eyebrow">{settling.id.slice(0,12)}</span><h2>Pelunasan rental + F&B</h2></div><button type="button" className="icon-btn" disabled={settleBusy} onClick={()=>setSettling(null)}>×</button></div>
      <div className="receipt-lines"><div><span>Biaya rental</span><b>{formatIDR(settling.rental_total)}</b></div><div><span>Total F&B terkait</span><b>{formatIDR(settling.fnb_total)}</b></div><div><span>Total tagihan</span><b>{formatIDR(settling.total)}</b></div><div><span>Sudah dibayar</span><b>{formatIDR(settling.paid_amount)}</b></div><div className="grand"><span>Sisa tagihan gabungan</span><strong>{formatIDR(settling.outstanding)}</strong></div></div>
      <label><span>Metode pembayaran</span><select value={settleMethod} onChange={e=>setSettleMethod(e.target.value as PaymentMethod)}>{paymentMethods.map(m=><option key={m} value={m}>{m==="cash"?"Tunai":m==="transfer"?"Transfer":m==="qris"?"QRIS":"Lainnya"}</option>)}</select></label>
      <label><span>Uang diterima (Rp)</span><input type="number" min="1" required value={settleReceived} onChange={e=>setSettleReceived(e.target.value)}/></label>
      <div className="change"><span>Perkiraan kembalian</span><b>{formatIDR(Math.max(0,Number(settleReceived||0)-settling.outstanding))}</b></div>
      <div className="modal-actions"><button type="button" className="btn btn-secondary" disabled={settleBusy} onClick={()=>setSettling(null)}>Batal</button><button className="btn btn-primary" disabled={settleBusy||Number(settleReceived)<=0}>{settleBusy?"Menyimpan…":"Simpan pelunasan gabungan"}</button></div>
    </form></div>}
  </div>;
}

export function ReportsPageV2() {
  const [rows,setRows]=useState<HistoryRecord[]>([]);
  const [payments,setPayments]=useState<RevenuePayment[]>([]);
  const [standaloneFnb,setStandaloneFnb]=useState<Array<{id:string;total:number;paid_amount:number;outstanding:number;created_at:string}>>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [range,setRange]=useState("30");
  useEffect(()=>{
    let alive=true;
    const refresh=async()=>{
      const since=new Date(Date.now()-100*86400000).toISOString();
      try{
        const [data,paymentRows,standaloneRows]=await Promise.all([loadHistorySessions(),loadRevenuePayments(since),loadStandaloneFnbOrders(since)]);
        if(alive){setRows(data);setPayments(paymentRows);setStandaloneFnb(standaloneRows);setError("");}
      }catch(e){if(alive)setError(e instanceof Error?e.message:"Laporan gagal dimuat.");}
      finally{if(alive)setLoading(false);}
    };
    void refresh();
    const unsubscribe=subscribeToRentalChanges(()=>{if(alive)void refresh();});
    return()=>{alive=false;unsubscribe();};
  },[]);
  const dayKey=(value:string)=>{
    const d=new Date(value);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  };
  const cutoff=Date.now()-Number(range)*86400000;
  const scoped=rows.filter(r=>new Date(r.ended_at??r.started_at).getTime()>=cutoff);
  const completed=scoped.filter(r=>r.status==="Selesai");
  const scopedPayments=payments.filter(p=>new Date(p.paid_at).getTime()>=cutoff);
  const scopedStandalone=standaloneFnb.filter(o=>new Date(o.created_at).getTime()>=cutoff);
  const revenue=scopedPayments.reduce((sum,p)=>sum+p.amount,0);
  const invoiceCount=new Set(scopedPayments.map(p=>p.invoice_id)).size;
  const minutes=completed.reduce((sum,r)=>sum+r.duration_minutes,0);
  const billed=completed.reduce((sum,r)=>sum+r.total,0)+scopedStandalone.reduce((sum,o)=>sum+o.total,0);
  const receivables=completed.reduce((sum,r)=>sum+r.outstanding,0)+scopedStandalone.reduce((sum,o)=>sum+o.outstanding,0);
  const days=Array.from({length:7},(_,i)=>{
    const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-(6-i));
    const key=dayKey(d.toISOString());
    const completedOnDay=rows.filter(r=>r.status==="Selesai"&&dayKey(r.ended_at??r.started_at)===key);
    const standaloneOnDay=standaloneFnb.filter(o=>dayKey(o.created_at)===key);
    const paidOnDay=payments.filter(p=>dayKey(p.paid_at)===key);
    return {
      key,label:d.toLocaleDateString("id-ID",{weekday:"short"}),
      received:paidOnDay.reduce((sum,p)=>sum+p.amount,0),
      billed:completedOnDay.reduce((sum,r)=>sum+r.total,0)+standaloneOnDay.reduce((sum,o)=>sum+o.total,0),
      outstanding:completedOnDay.reduce((sum,r)=>sum+r.outstanding,0)+standaloneOnDay.reduce((sum,o)=>sum+o.outstanding,0),
      count:new Set(paidOnDay.map(p=>p.invoice_id)).size,
      minutes:completedOnDay.reduce((sum,r)=>sum+r.duration_minutes,0)
    };
  });
  const max=Math.max(1,...days.map(d=>d.received));
  const reportHeaders=["Tanggal","Invoice menerima pembayaran","Tagihan tercatat IDR","Uang diterima IDR","Piutang tersisa IDR","Durasi sesi rental (menit)"];
  const reportData=days.map(d=>[d.key,d.count,d.billed,d.received,d.outstanding,d.minutes]);
  const exportRows=()=>exportCsv("rentalps-laporan-keuangan.csv",reportHeaders,reportData);
  return <div className="page-content">
    <div className="page-heading"><div><h2>Laporan Keuangan</h2><p>Pisahkan nilai tagihan, uang yang benar-benar diterima, dan piutang tersisa.</p></div><div className="export-actions"><button className="btn btn-secondary" onClick={exportRows}>CSV</button><button className="btn btn-secondary" onClick={()=>exportExcel("rentalps-laporan-keuangan.xls","Laporan keuangan",reportHeaders,reportData)}>Excel</button><button className="btn btn-secondary" onClick={()=>exportPdf("rentalps-laporan-keuangan.pdf","Laporan keuangan",reportHeaders,reportData)}>PDF</button></div></div>
    {!isSupabaseConfigured&&<div className="mode-notice">Mode demo: angka di bawah merupakan simulasi.</div>}
    {error&&<div className="app-alert error" role="alert">{error}</div>}
    <div className="range-row"><div className="filter-pills">{[{value:"7",label:"7 hari"},{value:"30",label:"30 hari"},{value:"90",label:"3 bulan"}].map(x=><button key={x.value} className={range===x.value?"selected":""} onClick={()=>setRange(x.value)}>{x.label}</button>)}</div><span className="report-range">{loading?"Memuat…":completed.length+" sesi selesai · "+scopedStandalone.length+" pesanan F&B mandiri"}</span></div>
    <div className="summary-grid report">
      <div className="summary-card"><span className="summary-icon indigo">Rp</span><div><small>Total tagihan tercatat</small><strong>{formatIDR(billed)}</strong><span>Sesi selesai + F&B mandiri</span></div></div>
      <div className="summary-card"><span className="summary-icon blue">↙</span><div><small>Uang diterima</small><strong>{formatIDR(revenue)}</strong><span>Berdasarkan waktu pembayaran</span></div></div>
      <div className="summary-card"><span className="summary-icon yellow">◷</span><div><small>Piutang tersisa</small><strong>{formatIDR(receivables)}</strong><span>Transaksi pada periode ini</span></div></div>
      <div className="summary-card"><span className="summary-icon green">#</span><div><small>Invoice menerima uang</small><strong>{invoiceCount}</strong><span>Rental + F&B dihitung satu invoice bila terhubung</span></div></div>
      <div className="summary-card"><span className="summary-icon blue">↗</span><div><small>Rata-rata uang per invoice</small><strong>{formatIDR(invoiceCount?revenue/invoiceCount:0)}</strong><span>Berdasarkan invoice yang menerima pembayaran</span></div></div>
      <div className="summary-card"><span className="summary-icon indigo">◴</span><div><small>Jam rental selesai</small><strong>{(minutes/60).toFixed(1)} jam</strong><span>Durasi sesi selesai pada periode</span></div></div>
    </div>
    <div className="report-grid">
      <div className="panel chart-card wide"><div><h3>Penerimaan harian</h3><p>7 hari terakhir · pembayaran rental dan F&B pada tanggal uang diterima</p></div><div className="bar-chart">{days.map(d=><div key={d.key}><span title={formatIDR(d.received)} style={{height:Math.max(3,d.received/max*100)+"%"}}/><small>{d.label}</small></div>)}</div></div>
      <div className="panel chart-card"><div><h3>Ringkasan status sesi</h3><p>Periode terpilih</p></div><div className="report-status-list">{["Selesai","Aktif","Dijeda","Overtime","Dibatalkan"].map(value=><div key={value}><span>{value}</span><b>{scoped.filter(r=>r.status===value).length}</b></div>)}</div></div>
      <div className="panel chart-card heat"><div><h3>Metode pembayaran</h3><p>Jumlah pencatatan pembayaran pada periode</p></div><div className="report-status-list">{[{key:"cash",name:"Tunai"},{key:"transfer",name:"Transfer"},{key:"qris",name:"QRIS"},{key:"other",name:"Lainnya"}].map(m=><div key={m.key}><span>{m.name}</span><b>{scopedPayments.filter(p=>p.method===m.key).length}</b></div>)}</div></div>
    </div>
  </div>;
}

export function ManagePageV2({ type }: { type: ManagerPage }) {
  const storageKey = "rentalps-demo-management-" + type.toLowerCase();
  const isUnit = type === "Unit";
  const isRate = type === "Tarif";
  const isUser = type === "Pengguna";
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const headers = isUnit ? ["Kode", "Nama unit", "Konsol", "Ruangan", "Tarif/jam", "Status"] : isRate ? ["Nama tarif", "Tipe", "Durasi", "Konsol/Ruangan", "Harga", "Status"] : ["Nama", "Email", "Role", "Status"];
  async function refresh() {
    setLoading(true); setError("");
    try {
      let data: Row[];
      if (isUnit) data = await loadManagedUnits() as unknown as Row[];
      else if (isRate) data = await loadManagedRates() as unknown as Row[];
      else data = await loadManagedMembers() as unknown as Row[];
      if (!isSupabaseConfigured) {
        const saved = localStorage.getItem(storageKey);
        if (saved) data = JSON.parse(saved);
      }
      setRows(data);
    } catch (e) { setError(e instanceof Error ? e.message : "Data gagal dimuat."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, [type]);
  const persistDemo = (next: Row[]) => { setRows(next); try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* optional browser storage */ } };
  const field = (name: string, value: string) => setForm(current => ({ ...current, [name]: value }));
  const openAdd = () => {
    setEditing(null); setError("");
    setForm(isUnit
      ? { code: "", name: "", console_type: "PS5", room: "Reguler", status: "available", default_hourly_rate: "15000", notes: "" }
      : isRate
      ? { name: "", billing_type: "package", duration_minutes: "60", price: "15000", price_per_hour: "15000", console_type: "PS5", room: "Reguler", rounding_rule_minutes: "15", overtime_tolerance_minutes: "5" }
      : { display_name: "", email: "", role: "operator" });
    setDrawer(true);
  };
  const openEdit = (row: Row) => {
    setEditing(row); setError("");
    setForm(isUnit
      ? { code: String(row.code || ""), name: String(row.name || ""), console_type: String(row.console_type || "PS5"), room: String(row.room || "Reguler"), status: String(row.status || "available"), default_hourly_rate: String(row.default_hourly_rate ?? 10000), notes: String(row.notes || "") }
      : isRate
      ? { name: String(row.name || ""), billing_type: String(row.billing_type || "package"), duration_minutes: String(row.duration_minutes ?? 60), price: String(row.price ?? 0), price_per_hour: String(row.price_per_hour ?? row.price ?? 0), console_type: String(row.console_type || "Lainnya"), room: String(row.room || "Reguler"), rounding_rule_minutes: String(row.rounding_rule_minutes ?? 15), overtime_tolerance_minutes: String(row.overtime_tolerance_minutes ?? 5) }
      : { display_name: String(row.display_name || ""), email: String(row.email || ""), role: String(row.role || "operator") });
    setDrawer(true);
  };
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      if (isUnit) {
        const input: ManagedUnit = { id: editing?.id, code: form.code.trim().toUpperCase(), name: form.name.trim(), console_type: form.console_type, room: form.room, status: form.status as ManagedUnit["status"], default_hourly_rate: Number(form.default_hourly_rate), notes: form.notes, is_active: true };
        if (isSupabaseConfigured) { await saveManagedUnit(input); await refresh(); }
        else { const row = { ...input, id: editing?.id || "demo-unit-" + Date.now() }; persistDemo(editing ? rows.map(r => r.id === editing.id ? row as unknown as Row : r) : [...rows, row as unknown as Row]); }
        setNotice(editing ? "Unit diperbarui." : "Unit ditambahkan.");
      } else if (isRate) {
        const input: ManagedRate = { id: editing?.id || "", name: form.name.trim(), billing_type: form.billing_type as ManagedRate["billing_type"], duration_minutes: form.billing_type === "open" ? null : Number(form.duration_minutes), price: Number(form.price), price_per_hour: Number(form.price_per_hour), console_type: form.console_type, room: form.room, rounding_rule_minutes: Number(form.rounding_rule_minutes), overtime_tolerance_minutes: Number(form.overtime_tolerance_minutes) };
        if (isSupabaseConfigured) { await saveManagedRate(input); await refresh(); }
        else { const row = { ...input, id: editing?.id || "demo-rate-" + Date.now(), is_active: true }; persistDemo(editing ? rows.map(r => r.id === editing.id ? row as unknown as Row : r) : [...rows, row as unknown as Row]); }
        setNotice(editing ? "Tarif diperbarui." : "Tarif ditambahkan.");
      } else if (editing) {
        if (isSupabaseConfigured) { await updateManagedMember({ user_id: String(editing.user_id), role: form.role as "admin" | "operator" }); await refresh(); }
        else persistDemo(rows.map(r => r.user_id === editing.user_id ? { ...r, role: form.role, display_name: form.display_name || r.display_name } : r));
        setNotice("Role pengguna diperbarui.");
      } else {
        if (!form.email.trim()) throw new Error("Email pengguna wajib diisi.");
        if (isSupabaseConfigured) { await inviteManagedMember(form.email.trim(), form.role as "admin" | "operator", form.display_name.trim()); await refresh(); }
        else persistDemo([...rows, { user_id: "demo-member-" + Date.now(), display_name: form.display_name || form.email.split("@")[0], email: form.email.trim(), role: form.role, is_active: true }]);
        setNotice(isSupabaseConfigured ? "Undangan dikirim. Minta pengguna memeriksa email." : "Pengguna demo ditambahkan; tidak ada email yang dikirim.");
      }
      setDrawer(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Data gagal disimpan."); }
    finally { setBusy(false); }
  }
  async function resendInvite(row: Row) {
    if (!window.confirm("Kirim undangan baru ke " + row.email + "? Link lama untuk akun pending ini akan diganti.")) return;
    setError(""); setNotice(""); setBusy(true);
    try {
      await resendManagedInvite(String(row.user_id));
      setNotice("Undangan baru terkirim ke " + row.email + ". Minta pengguna membuka email terbaru.");
      await refresh();
    } catch(e) {
      setError(e instanceof Error ? e.message : "Undangan ulang gagal dikirim.");
    } finally { setBusy(false); }
  }
  async function toggle(row: Row) {
    if (!window.confirm((isUser ? (row.is_active ? "Nonaktifkan " : "Aktifkan ") + (row.email || row.user_id) : "Nonaktifkan ") + (isUnit ? row.name || row.code : isRate ? row.name : "") + "?")) return;
    setError(""); setNotice("");
    try {
      if (isUnit && isSupabaseConfigured) await deactivateManagedUnit(String(row.id));
      else if (isRate && isSupabaseConfigured) await deactivateManagedRate(String(row.id));
      else if (isUser && isSupabaseConfigured) await updateManagedMember({ user_id: String(row.user_id), is_active: !row.is_active });
      if (isUser) {
        const next = rows.map(r => r.user_id === row.user_id ? { ...r, is_active: !row.is_active } : r);
        if (!isSupabaseConfigured) persistDemo(next); else await refresh();
        setNotice(row.is_active ? "Pengguna dinonaktifkan." : "Pengguna diaktifkan.");
      } else {
        if (!isSupabaseConfigured) persistDemo(rows.filter(r => r.id !== row.id));
        else await refresh();
        setNotice("Data dinonaktifkan.");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Status gagal diubah."); }
  }
  const visible = rows.filter(r => JSON.stringify(r).toLowerCase().includes(query.toLowerCase()));
  const exportRows = () => exportCsv("rentalps-" + type.toLowerCase() + ".csv", headers, visible.map(r =>
    isUnit ? [r.code, r.name, r.console_type, r.room, r.default_hourly_rate, r.status]
    : isRate ? [r.name, r.billing_type, r.duration_minutes ?? "Open", r.console_type + " / " + r.room, r.price, r.is_active === false ? "Nonaktif" : "Aktif"]
    : [r.display_name, r.email, r.role, r.is_active ? "Aktif" : "Nonaktif"]
  ));
  const statusName = (r: Row) => isUnit ? (r.status === "maintenance" ? "Maintenance" : "Aktif") : r.is_active === false ? "Nonaktif" : isUser && r.email_confirmed === false ? "Undangan dikirim" : "Aktif";
  return <div className="page-content">
    <div className="page-heading"><div><h2>{isUser ? "Pengguna & Akses" : "Kelola " + type}</h2><p>{isUser ? "Undang orang ke usaha dan atur hak aksesnya." : isUnit ? "Tambah, edit dan nonaktifkan unit PlayStation." : "Kelola tarif paket, per jam, dan open billing."}</p></div><button className="btn btn-primary" onClick={openAdd}>{isUser ? "✉ Undang pengguna" : "+ Tambah " + type}</button></div>
    {isUser && <section className="invite-guide" aria-label="Cara menambah pengguna"><div className="invite-guide-heading"><span className="invite-guide-icon">✉</span><div><b>Cara menambahkan akun orang lain</b><p>Pengguna menerima undangan ke emailnya sendiri—tidak perlu berbagi password dengan pemilik.</p></div></div><div className="invite-steps"><div><span>1</span><div><b>Isi email & role</b><small>Masukkan email aktif dan pilih Operator atau Admin.</small></div></div><div><span>2</span><div><b>Kirim undangan</b><small>Link undangan dikirim ke kotak masuk pengguna.</small></div></div><div><span>3</span><div><b>Pengguna membuat akses</b><small>Buka link dari email, selesaikan proses akun, lalu masuk dengan email dan password sendiri.</small></div></div></div><p className="invite-role-note"><b>Operator</b> untuk operasional sesi. <b>Admin</b> dapat mengelola tarif dan anggota; hak Admin hanya bisa diberikan oleh Pemilik.</p></section>}
    {!isSupabaseConfigured && <div className="mode-notice">{isUser ? "Mode demo: perubahan pengguna tersimpan di browser ini dan tidak mengirim email sungguhan." : "Mode demo: perubahan tersimpan di browser ini dan belum masuk database bersama."}</div>}
    {notice && <div className="app-alert" role="status">{notice}<button onClick={() => setNotice("")}>×</button></div>}
    {error && !drawer && <div className="app-alert error" role="alert">{error}<button onClick={() => setError("")}>×</button></div>}
    <div className="panel table-wrap manage-table"><div className="table-search"><div className="field"><input value={query} onChange={e => setQuery(e.target.value)} placeholder={"Cari " + type.toLowerCase() + "..."} /></div><button className="btn btn-secondary" onClick={exportRows}>Ekspor CSV</button></div>
      <table><thead><tr>{headers.map(h => <th key={h}>{isUser && h === "Status" ? "Status undangan" : h}</th>)}<th>Aksi</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={headers.length + 1} className="empty-cell">Memuat…</td></tr> : visible.length === 0 ? <tr><td colSpan={headers.length + 1} className="empty-cell">Belum ada data untuk ditampilkan.</td></tr> : visible.map((r, i) => <tr key={String(r.id || r.user_id || i)}>
          {isUnit && <><td>{r.code}</td><td>{r.name}</td><td>{r.console_type}</td><td>{r.room}</td><td>{formatIDR(Number(r.default_hourly_rate) || 0)}</td><td><span className={"table-status " + statusName(r).toLowerCase().replace(/[^a-z]+/g,"-")}>{statusName(r)}</span></td></>}
          {isRate && <><td>{r.name}</td><td>{r.billing_type === "package" ? "Paket" : r.billing_type === "hourly" ? "Per jam" : "Open billing"}</td><td>{r.duration_minutes ? r.duration_minutes + " menit" : "Terbuka"}</td><td>{r.console_type} · {r.room}</td><td>{formatIDR(Number(r.price) || 0)}</td><td><span className={"table-status " + statusName(r).toLowerCase()}>{statusName(r)}</span></td></>}
          {isUser && <><td>{r.display_name || "—"}</td><td>{r.email || r.user_id}</td><td>{r.role === "owner" ? "Pemilik" : r.role === "admin" ? "Admin" : "Operator"}</td><td><span className={"table-status " + statusName(r).toLowerCase()}>{statusName(r)}</span></td></>}
          <td className="management-actions">{isUser && isSupabaseConfigured && !r.email_confirmed && r.invited_at && !r.last_sign_in_at && r.role !== "owner" && <button className="btn btn-secondary" disabled={busy} onClick={() => void resendInvite(r)}>Kirim ulang undangan</button>}{!(isUser && r.role === "owner") && <><button className="btn btn-ghost" onClick={() => openEdit(r)}>{isUser ? "Edit akses" : "Edit"}</button><button className="btn btn-ghost" onClick={() => void toggle(r)}>{isUser ? (r.is_active ? "Nonaktifkan" : "Aktifkan") : "Nonaktifkan"}</button></>}</td>
        </tr>)}
      </tbody></table>
    </div>
    {drawer && <div className="drawer-backdrop" onClick={() => setDrawer(false)}><aside className="drawer" onClick={e => e.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">{isUser ? (editing ? "KELOLA AKSES" : "UNDANG LEWAT EMAIL") : editing ? "UBAH DATA" : "DATA BARU"}</span><h2>{isUser ? (editing ? "Edit akses pengguna" : "Undang pengguna") : (editing ? "Edit " : "Tambah ") + type}</h2></div><button type="button" className="icon-btn" onClick={() => setDrawer(false)} aria-label="Tutup">×</button></div>
      <form className="form-stack manage-form" onSubmit={submit}>
        {isUnit && <><label><span>Kode unit</span><input required maxLength={10} value={form.code || ""} onChange={e => field("code", e.target.value.toUpperCase())} placeholder="PS 07" /></label><label><span>Nama unit</span><input required maxLength={40} value={form.name || ""} onChange={e => field("name", e.target.value)} placeholder="PS 07" /></label><label><span>Konsol</span><select value={form.console_type || "PS5"} onChange={e => field("console_type", e.target.value)}>{["PS3", "PS4", "PS5", "Lainnya"].map(x => <option key={x}>{x}</option>)}</select></label><label><span>Ruangan</span><select value={form.room || "Reguler"} onChange={e => field("room", e.target.value)}>{["Reguler", "VIP", "Semua"].map(x => <option key={x}>{x}</option>)}</select></label><label><span>Tarif default per jam (Rp)</span><input type="number" required min="0" value={form.default_hourly_rate || "0"} onChange={e => field("default_hourly_rate", e.target.value)} /></label><label><span>Status</span><select value={form.status || "available"} onChange={e => field("status", e.target.value)}><option value="available">Tersedia</option><option value="maintenance">Maintenance</option></select></label><label><span>Catatan</span><input maxLength={200} value={form.notes || ""} onChange={e => field("notes", e.target.value)} /></label></>}
        {isRate && <><label><span>Nama tarif</span><input required maxLength={80} value={form.name || ""} onChange={e => field("name", e.target.value)} placeholder="PS5 Reguler · 1 Jam" /></label><label><span>Jenis tagihan</span><select value={form.billing_type || "package"} onChange={e => field("billing_type", e.target.value)}><option value="package">Paket harga tetap</option><option value="hourly">Per jam / durasi</option><option value="open">Open billing</option></select></label>{form.billing_type !== "open" && <label><span>Durasi paket (menit)</span><select value={form.duration_minutes || "60"} onChange={e => field("duration_minutes", e.target.value)}>{[15,30,60,90,120,180,240,300,360].map(n => <option key={n} value={n}>{n} menit</option>)}</select></label>}<label><span>Konsol</span><select value={form.console_type || "Lainnya"} onChange={e => field("console_type", e.target.value)}>{["PS3","PS4","PS5","Lainnya"].map(x => <option key={x}>{x}</option>)}</select></label><label><span>Ruangan</span><select value={form.room || "Reguler"} onChange={e => field("room", e.target.value)}>{["Reguler","VIP","Semua"].map(x => <option key={x}>{x}</option>)}</select></label><label><span>Harga paket / durasi (Rp)</span><input type="number" required min="1" value={form.price || ""} onChange={e => field("price", e.target.value)} /></label><label><span>Harga per jam (Rp)</span><input type="number" required min="1" value={form.price_per_hour || ""} onChange={e => field("price_per_hour", e.target.value)} /></label><label><span>Pembulatan (menit)</span><select value={form.rounding_rule_minutes || "15"} onChange={e => field("rounding_rule_minutes", e.target.value)}>{[0,15,30,60].map(n => <option key={n} value={n}>{n === 0 ? "Tanpa pembulatan" : n + " menit"}</option>)}</select></label><label><span>Toleransi overtime (menit)</span><input type="number" min="0" max="60" value={form.overtime_tolerance_minutes || "5"} onChange={e => field("overtime_tolerance_minutes", e.target.value)} /></label></>}
        {isUser && <><label><span>Nama pengguna</span><input maxLength={80} value={form.display_name || ""} onChange={e => field("display_name", e.target.value)} placeholder="Nama operator" /></label><label><span>Email</span><input type="email" required disabled={Boolean(editing)} value={form.email || ""} onChange={e => field("email", e.target.value)} placeholder="operator@rentalps.id" /></label><label><span>Hak akses / role</span><select value={form.role || "operator"} onChange={e => field("role", e.target.value)}><option value="operator">Operator — kelola sesi rental</option><option value="admin">Admin — tarif dan anggota juga</option></select></label><div className="invite-howto"><b>{editing ? "Mengubah akses pengguna" : "Setelah undangan dikirim"}</b><ol>{editing ? <><li>Perubahan role berlaku untuk akun yang sama.</li><li>Pemilik tetap menjadi role tertinggi dan tidak bisa diubah dari sini.</li></> : <><li>Periksa email pengguna (termasuk folder Spam).</li><li>Pengguna membuka tautan undangan Supabase untuk menyelesaikan aktivasi.</li><li>Setelah itu, pengguna login menggunakan email dan password miliknya.</li></>}</ol></div>{!isSupabaseConfigured && !editing && <p className="help-text">Mode demo hanya menyimpan data di browser; tidak ada undangan email yang terkirim.</p>}</>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="drawer-actions"><button type="button" className="btn btn-secondary" onClick={() => setDrawer(false)}>Batal</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Menyimpan…" : isUser && !editing && isSupabaseConfigured ? "Kirim undangan" : "Simpan"}</button></div>
      </form>
    </aside></div>}
  </div>;
}

export function AuditPageV2() {
  const [rows,setRows]=useState<AuditRecord[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [search,setSearch]=useState("");
  useEffect(()=>{
    let alive=true;
    loadAuditEntries().then(data=>{if(alive)setRows(data);})
      .catch(e=>{if(alive)setError(e instanceof Error?e.message:"Audit log gagal dimuat.");})
      .finally(()=>{if(alive)setLoading(false);});
    return()=>{alive=false;};
  },[]);
  const visible=rows.filter(r=>(r.action+" "+r.entity+" "+(r.entity_id||"")+" "+r.details).toLowerCase().includes(search.toLowerCase()));
  const label=(action:string)=>{
    const map:Record<string,string>={
      "session.started":"Sesi dimulai","session.ended":"Sesi diakhiri","session.extended":"Tambah waktu",
      "session.role_changed":"Role diubah","member.invited":"Pengguna diundang",
      "member.role_changed":"Role pengguna diubah","member.deactivated":"Pengguna dinonaktifkan",
      "member.activated":"Pengguna diaktifkan","unit.maintenance_changed":"Status unit diubah"
    };
    return map[action]||action.replace(/[._]/g," ");
  };
  const exportRows=()=>exportCsv("rentalps-audit-log.csv",
    ["Waktu","Aksi","Entitas","ID entitas","User ID","Alasan","Detail"],
    visible.map(r=>[prettyTime(r.created_at),r.action,r.entity,r.entity_id,r.user_id,r.reason,r.details]));
  return <div className="page-content">
    <div className="page-heading"><div><h2>Log Audit</h2><p>Rekam jejak perubahan penting dan aktivitas operasional.</p></div><button className="btn btn-secondary" onClick={exportRows}>Ekspor CSV</button></div>
    {!isSupabaseConfigured&&<div className="mode-notice">Mode demo: aktivitas di bawah hanya contoh.</div>}
    {error&&<div className="app-alert error" role="alert">{error}</div>}
    <div className="panel filters"><label><span>Cari aktivitas</span><div className="field"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Aksi, entitas, atau detail"/></div></label><span className="history-count">{visible.length} aktivitas</span></div>
    <div className="panel audit-list">{loading?<div className="empty-cell">Memuat log audit…</div>:visible.length===0?<div className="empty-cell">Belum ada aktivitas yang cocok.</div>:visible.map((r,i)=><div className="audit-row" key={r.id}><span className={"audit-icon a"+(i%5)}>◷</span><time>{prettyTime(r.created_at)}</time><div><b>{label(r.action)}</b><span>{r.entity}{r.entity_id?" · "+r.entity_id:""}</span><small>{r.details||r.reason||("User: "+(r.user_id||"sistem"))}</small></div></div>)}</div>
  </div>;
}

export function SettingsPageV2({dark,setDark,onSaved}:{dark:boolean;setDark:(v:boolean)=>void;onSaved?:(settings:BusinessSettings)=>void}) {
  const [form,setForm]=useState({name:"RentalPS",phone:"",address:"",timezone:"Asia/Jakarta"});
  const [paymentMethods,setPaymentMethods]=useState<PaymentMethod[]>(["cash","transfer","qris","other"]);
  const [paperWidth,setPaperWidth]=useState<"58"|"80">("80");
  const [showPhone,setShowPhone]=useState(true);
  const [showAddress,setShowAddress]=useState(true);
  const [footer,setFooter]=useState("Terima kasih telah bermain.");
  const [section,setSection]=useState<"profile"|"payments"|"appearance">("profile");
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const field=(key:keyof typeof form,value:string)=>setForm(prev=>({...prev,[key]:value}));
  const options:[PaymentMethod,string][]=[["cash","Tunai"],["transfer","Transfer bank"],["qris","QRIS"],["other","Metode lainnya"]];
  useEffect(()=>{
    let alive=true;
    loadBusinessSettings().then((data:BusinessSettings)=>{
      if(!alive)return;
      const profile=(data.settings?.profile||{}) as Record<string,string>;
      const receipt=(data.settings?.receipt||{}) as Record<string,any>;
      const payment=(data.settings?.payment||{}) as Record<string,any>;
      const appearance=(data.settings?.appearance||{}) as Record<string,any>;
      setForm({name:data.name||"RentalPS",phone:profile.phone||"",address:profile.address||"",timezone:data.timezone||"Asia/Jakarta"});
      setFooter(String(receipt.footer||"Terima kasih telah bermain."));
      setPaperWidth(String(receipt.paper_width||"80")==="58"?"58":"80");
      setShowPhone(receipt.show_phone!==false);
      setShowAddress(receipt.show_address!==false);
      setPaymentMethods(Array.isArray(payment.methods)&&payment.methods.length?payment.methods.filter((m:any)=>options.some(([key])=>key===m)) as PaymentMethod[]:["cash","transfer","qris","other"]);
      setDark(appearance.theme==="dark");
    }).catch(e=>{if(alive)setError(e instanceof Error?e.message:"Pengaturan gagal dimuat.");})
      .finally(()=>{if(alive)setLoading(false);});
    return()=>{alive=false;};
  },[]);
  const submit=async(e:FormEvent)=>{
    e.preventDefault();setBusy(true);setError("");setNotice("");
    try{
      if(paymentMethods.length===0)throw new Error("Aktifkan minimal satu metode pembayaran.");
      const previous=await loadBusinessSettings();
      const input:BusinessSettings={...previous,name:form.name.trim(),timezone:form.timezone,currency:"IDR",settings:{
        ...(previous.settings||{}),
        profile:{...(previous.settings?.profile||{}),phone:form.phone.trim(),address:form.address.trim()},
        payment:{...(previous.settings?.payment||{}),methods:paymentMethods},
        receipt:{...(previous.settings?.receipt||{}),footer:footer.trim(),paper_width:paperWidth,show_phone:showPhone,show_address:showAddress},
        appearance:{...(previous.settings?.appearance||{}),theme:dark?"dark":"light"}
      }};
      if(!input.name)throw new Error("Nama usaha wajib diisi.");
      await saveBusinessSettings(input);
      onSaved?.(input);
      setNotice("Pengaturan berhasil disimpan dan berlaku untuk usaha ini.");
    }catch(e){setError(e instanceof Error?e.message:"Pengaturan gagal disimpan.");}
    finally{setBusy(false);}
  };
  const tab=(key:typeof section,label:string)=><button type="button" className={section===key?"active":""} onClick={()=>{setSection(key);setError("");setNotice("");}}>{label}</button>;
  return <div className="page-content settings-page">
    <div className="page-heading"><div><h2>Pengaturan</h2><p>Profil usaha, metode pembayaran, struk transaksi, dan tampilan aplikasi.</p></div><button className="btn btn-primary" type="button" disabled={busy||loading} onClick={()=>document.querySelector<HTMLFormElement>("#rentalps-settings-form")?.requestSubmit()}>{busy?"Menyimpan…":"Simpan pengaturan"}</button></div>
    {!isSupabaseConfigured&&<div className="mode-notice">Mode demo: pengaturan tersimpan lokal di browser, bukan database bersama.</div>}
    {error&&<div className="app-alert error" role="alert">{error}</div>}
    {notice&&<div className="app-alert" role="status">{notice}</div>}
    <div className="settings-grid">
      <div className="panel settings-nav">
        {tab("profile","Profil rental")}
        {tab("payments","Pembayaran & struk")}
        {tab("appearance","Tampilan")}
      </div>
      <form id="rentalps-settings-form" className="panel settings-form" onSubmit={submit}>
        {loading?<div className="empty-cell">Memuat pengaturan…</div>:<>
          {section==="profile"&&<>
            <h3>Profil rental</h3><p>Informasi ini digunakan pada kepala struk pembayaran.</p>
            <div className="form-grid">
              <label><span>Nama rental</span><input required maxLength={100} value={form.name} onChange={e=>field("name",e.target.value)}/></label>
              <label><span>Nomor telepon</span><input maxLength={40} value={form.phone} onChange={e=>field("phone",e.target.value)} placeholder="08xx xxxx xxxx"/></label>
              <label className="span-2"><span>Alamat</span><textarea maxLength={250} value={form.address} onChange={e=>field("address",e.target.value)} placeholder="Alamat rental"/></label>
              <label><span>Zona waktu</span><select value={form.timezone} onChange={e=>field("timezone",e.target.value)}><option value="Asia/Jakarta">WIB (UTC+7)</option><option value="Asia/Makassar">WITA (UTC+8)</option><option value="Asia/Jayapura">WIT (UTC+9)</option></select></label>
              <label><span>Mata uang</span><input value="Rupiah (IDR)" disabled readOnly/></label>
            </div>
          </>}
          {section==="payments"&&<>
            <h3>Pembayaran & struk</h3><p>Pilih metode yang tersedia di kasir. Pengaturan ini disimpan ke database usaha.</p>
            <div className="settings-choice-list">
              {options.map(([key,label])=><label key={key}><input type="checkbox" checked={paymentMethods.includes(key)} onChange={e=>setPaymentMethods(current=>e.target.checked?[...current,key]:current.filter(value=>value!==key))}/><span><b>{label}</b><small>{key==="cash"?"Tunai dan penghitungan kembalian":key==="transfer"?"Pembayaran melalui transfer bank":key==="qris"?"Pembayaran melalui QRIS (pencatatan manual)": "Metode pembayaran lain"}</small></span></label>)}
            </div>
            <hr/>
            <h3>Format cetak struk</h3>
            <div className="form-grid">
              <label><span>Lebar kertas printer</span><select value={paperWidth} onChange={e=>setPaperWidth(e.target.value as "58"|"80")}><option value="58">58 mm</option><option value="80">80 mm</option></select></label>
              <div className="settings-toggle-stack">
                <label><input type="checkbox" checked={showPhone} onChange={e=>setShowPhone(e.target.checked)}/><span>Tampilkan telepon pada struk</span></label>
                <label><input type="checkbox" checked={showAddress} onChange={e=>setShowAddress(e.target.checked)}/><span>Tampilkan alamat pada struk</span></label>
              </div>
              <label className="span-2"><span>Catatan bawah struk</span><input maxLength={160} value={footer} onChange={e=>setFooter(e.target.value)} placeholder="Terima kasih telah bermain."/></label>
            </div>
            <div className="receipt-preview-mini">
              <b>{form.name||"Nama rental"}</b>
              {showPhone&&form.phone&&<span>{form.phone}</span>}
              {showAddress&&form.address&&<span>{form.address}</span>}
              <hr/><b>STRUK RENTAL + F&B</b><span>Biaya rental</span><span>Pesanan makanan/minuman</span><strong>Total pembayaran</strong><hr/><span>{footer||"Terima kasih telah bermain."}</span>
              <small>Pratinjau · kertas {paperWidth} mm</small>
            </div>
          </>}
          {section==="appearance"&&<>
            <h3>Tampilan aplikasi</h3><p>Tema diterapkan langsung dan disimpan untuk usaha ini saat menekan Simpan pengaturan.</p>
            <div className="theme-options">
              <button type="button" className={!dark?"active":""} onClick={()=>setDark(false)}><span className="theme-preview light"><i/><i/><i/></span><b>☀ Mode terang</b></button>
              <button type="button" className={dark?"active":""} onClick={()=>setDark(true)}><span className="theme-preview dark"><i/><i/><i/></span><b>☾ Mode gelap</b></button>
            </div>
            <p className="help-text">Preferensi tema akan dipulihkan dari pengaturan usaha saat aplikasi dibuka kembali.</p>
          </>}
        </>}
        <div className="drawer-actions"><button type="submit" className="btn btn-primary" disabled={busy||loading}>{busy?"Menyimpan…":"Simpan bagian ini"}</button></div>
      </form>
    </div>
  </div>;
}
