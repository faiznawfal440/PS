import { useEffect, useMemo, useState, type ReactNode } from "react";

import { demoUnits, loadDashboardUnits, loadRatePlans, subscribeToRentalChanges, startSession, extendSession, pauseSession, resumeSession, endSession, setUnitMaintenance, formatIDR, formatTimer, loadBusinessSettings, loadSessionFnbSummary, loadSessionReceipt, type RatePlan, type UnitView, type PaymentMethod, type SessionFnbSummary, type SessionReceiptData, type BusinessSettings } from "./lib/rentalApi";
import { isSupabaseConfigured, supabase, supabaseConfigError } from "./lib/supabase";
import { loadCurrentMemberInfo, requestPasswordReset, type CurrentMemberInfo } from "./lib/rentalApi";
import { AuditPageV2, HistoryPageV2, ManagePageV2, ReportsPageV2, SettingsPageV2 } from "./OperationalPages";
import { FnbPageV2, ReservationsPageV2 } from "./BusinessModules";

const authParamsAtEntry = new URLSearchParams(window.location.hash.replace(/^#/, ""));
const authTypeAtEntry = authParamsAtEntry.get("type") || new URLSearchParams(window.location.search).get("type");
const authErrorCodeAtEntry = authParamsAtEntry.get("error_code") || new URLSearchParams(window.location.search).get("error_code");
const authErrorDescriptionAtEntry = authParamsAtEntry.get("error_description") || new URLSearchParams(window.location.search).get("error_description");
const authLinkErrorAtEntry = authErrorCodeAtEntry === "otp_expired"
  ? "Tautan undangan sudah kedaluwarsa atau sudah digunakan. Minta Pemilik mengirim undangan baru, lalu buka tautan terbaru."
  : authErrorCodeAtEntry
    ? (authErrorDescriptionAtEntry || "Tautan autentikasi tidak valid. Minta undangan baru dari Pemilik.")
    : "";


type IconName =
  | "grid"
  | "history"
  | "chart"
  | "console"
  | "tag"
  | "users"
  | "shield"
  | "settings"
  | "menu"
  | "bell"
  | "sun"
  | "moon"
  | "search"
  | "play"
  | "pause"
  | "stop"
  | "plus"
  | "clock"
  | "check"
  | "warning"
  | "wrench"
  | "wallet"
  | "chevron"
  | "close"
  | "filter"
  | "download"
  | "arrow"
  | "receipt"
  | "check-circle"
  | "logout";

const paths: Record<IconName, ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
  chart: <><path d="M4 19V9M10 19V5M16 19v-7M22 19H2" /></>,
  console: <><rect x="3" y="6" width="18" height="12" rx="5" /><path d="M8 10v4M6 12h4M16 11h.01M18 13h.01" /></>,
  tag: <><path d="M20 13 13 20 4 11V4h7Z" /><path d="M8 8h.01" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
  shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" /><path d="m9 12 2 2 4-4" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.6-1H3v-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V3h4v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.14.38.5.76 1.6 1v4c-1.1.24-1.46.62-1.6 1Z" /></>,
  menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" /></>,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  play: <path d="m7 4 13 8-13 8Z" />,
  pause: <><path d="M8 5v14M16 5v14" /></>,
  stop: <rect x="5" y="5" width="14" height="14" rx="2" />,
  plus: <path d="M12 5v14M5 12h14" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  warning: <><path d="M10.3 3.7 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>,
  wrench: <path d="M14.7 6.3a4 4 0 0 0-5-5L12 3.6 9.6 6 7.3 3.7a4 4 0 0 0 5 5L4 17l3 3 7.7-8.3a4 4 0 0 0 5-5L17.4 9 15 6.6Z" />,
  wallet: <><path d="M4 5h14a2 2 0 0 1 2 2v12H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12" /><path d="M16 11h6v5h-6a2.5 2.5 0 0 1 0-5Z" /></>,
  chevron: <path d="m9 18 6-6-6-6" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  filter: <path d="M4 5h16M7 12h10M10 19h4" />,
  download: <><path d="M12 3v12M7 10l5 5 5-5M4 21h16" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  receipt: <path d="M6 2v20l3-2 3 2 3-2 3 2V2l-3 2-3-2-3 2ZM9 9h6M9 13h6" />,
  "check-circle": <><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></>,
  logout: <><path d="M10 17l5-5-5-5M15 12H3M14 3h7v18h-7" /></>,
};

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

type Page = "Dashboard" | "Riwayat" | "Laporan" | "F&B" | "Reservasi" | "Unit" | "Tarif" | "Pengguna" | "Log Audit" | "Pengaturan";
type Modal = "start" | "add" | "end" | "cancel" | null;

const nav: { label: Page; icon: IconName }[] = [
  { label: "Dashboard", icon: "grid" }, { label: "Riwayat", icon: "history" },
  { label: "Laporan", icon: "chart" }, { label: "F&B", icon: "wallet" }, { label: "Reservasi", icon: "history" }, { label: "Unit", icon: "console" },
  { label: "Tarif", icon: "tag" }, { label: "Pengguna", icon: "users" },
  { label: "Log Audit", icon: "shield" }, { label: "Pengaturan", icon: "settings" },
];

function Button({ children, variant = "primary", icon, onClick, className = "", disabled = false, block = false }: { children?: ReactNode; variant?: "primary" | "secondary" | "ghost" | "danger"; icon?: IconName; onClick?: () => void; className?: string; disabled?: boolean; block?: boolean }) {
  return <button className={`btn btn-${variant} ${block ? "full" : ""} ${className}`} onClick={onClick} disabled={disabled}>{icon && <Icon name={icon} size={18} />}{children}</button>;
}

function Status({ type }: { type: "Kosong" | "Dipakai" | "Hampir habis" | "Overtime" | "Dijeda" | "Maintenance" }) {
  const icons: Record<string, IconName> = { Kosong: "check", Dipakai: "play", "Hampir habis": "clock", Overtime: "warning", Dijeda: "pause", Maintenance: "wrench" };
  return <span className={`status status-${type.toLowerCase().replace(" ", "-")}`}><Icon name={icons[type]} size={14} />{type}</span>;
}

const units = [
  { id: "PS 01", type: "PS5", room: "VIP", status: "Dipakai" as const, time: "01:42:18", label: "Sisa waktu", customer: "Rizky Pratama", start: "14:00", end: "17:00", cost: "Rp 45.000", progress: 43 },
  { id: "PS 02", type: "PS5", room: "VIP", status: "Hampir habis" as const, time: "00:08:42", label: "Sisa waktu", customer: "Dimas Saputra", start: "15:30", end: "17:00", cost: "Rp 30.000", progress: 91 },
  { id: "PS 03", type: "PS4", room: "Reguler", status: "Kosong" as const, time: "Siap main", label: "Tersedia sekarang", customer: "Belum ada sesi", start: "—", end: "—", cost: "Rp 10.000/jam", progress: 0 },
  { id: "PS 04", type: "PS4", room: "Reguler", status: "Overtime" as const, time: "+00:12:09", label: "Melewati waktu", customer: "Fajar Nugroho", start: "14:45", end: "16:45", cost: "Rp 22.500", progress: 100 },
  { id: "PS 05", type: "PS5", room: "Reguler", status: "Dijeda" as const, time: "00:47:31", label: "Sisa saat dijeda", customer: "Andi Maulana", start: "15:15", end: "17:15", cost: "Rp 30.000", progress: 60 },
  { id: "PS 06", type: "PS4", room: "Reguler", status: "Maintenance" as const, time: "Tidak aktif", label: "Sejak 13:20", customer: "Stik sedang diperbaiki", start: "—", end: "—", cost: "—", progress: 0 },
];

function Sidebar({ page, setPage, onLogout, role, email, businessName }: { page: Page; setPage: (p: Page) => void; onLogout: () => void; role: "owner"|"admin"|"operator"; email: string; businessName: string }) {
  const visibleNav=nav.filter(item=>{
    if(role==="operator")return ["Dashboard","Riwayat","F&B","Reservasi"].includes(item.label);
    if(role==="admin")return item.label!=="Pengaturan";
    return true;
  });
  const displayName=email.split("@")[0]||"Pengguna";
  const roleLabel=role==="owner"?"Pemilik":role==="admin"?"Admin":"Operator";
  return <aside className="sidebar">
    <div className="brand"><span className="brand-mark"><Icon name="console" size={23} /></span><span>RentalPS <b>Manager</b></span></div>
    <nav className="nav-list">{visibleNav.map((item) => <button key={item.label} className={`nav-item ${page === item.label ? "active" : ""}`} onClick={() => setPage(item.label)}><Icon name={item.icon} /><span>{item.label}</span>{item.label === "Dashboard" && <i>6</i>}</button>)}</nav>
    <div className="sidebar-profile"><span className="avatar">{displayName.slice(0,2).toUpperCase()}</span><span><b>{displayName}</b><small>{roleLabel} · {businessName}</small></span><button aria-label="Keluar" onClick={onLogout}><Icon name="logout" size={18} /></button></div>
  </aside>;
}

function Topbar({ page, dark, setDark }: { page: Page; dark: boolean; setDark: (v: boolean) => void }) {
  return <header className="topbar">
    <div><span className="eyebrow">RentalPS Kemang</span><h1>{page === "Dashboard" ? "Dashboard Unit" : page}</h1></div>
    <div className="top-actions">
      <label className="search"><Icon name="search" size={18} /><input placeholder="Cari sesi, pelanggan..." /></label>
      <button className="icon-btn" onClick={() => setDark(!dark)} aria-label="Ganti tema"><Icon name={dark ? "sun" : "moon"} /></button>
      <button className="icon-btn notification" aria-label="Notifikasi"><Icon name="bell" /><span /></button>
      <div className="date"><b>Senin, 24 Juni</b><small>16:57 WIB</small></div>
    </div>
  </header>;
}

function SummaryCard({ label, value, note, icon, tone }: { label: string; value: string; note: string; icon: IconName; tone: string }) {
  return <div className="summary-card"><span className={`summary-icon ${tone}`}><Icon name={icon} /></span><div><small>{label}</small><strong>{value}</strong><span>{note}</span></div></div>;
}

function UnitCard({ unit, open, onResume, onMaintenance }: { unit: UnitView; open: (m: Modal, unitId: string) => void; onResume: (unit: UnitView) => void; onMaintenance: (unit: UnitView) => void }) {
  const empty = unit.status === "Kosong";
  const inactive = unit.status === "Maintenance";
  return <article className={"unit-card unit-" + unit.status.toLowerCase().replace(" ", "-")}>
    <div className="unit-head"><div><b>{unit.id}</b><span>{unit.type} · {unit.room}</span></div><Status type={unit.status} /></div>
    <div className="timer-wrap"><small>{unit.label}</small><strong className="timer">{unit.time}</strong></div>
    {!empty && !inactive && unit.status !== "Dijeda" && <div className="progress"><span style={{ width: unit.progress + "%" }} /></div>}
    <div className="unit-info"><span className="customer">{empty || inactive ? <Icon name={empty ? "check" : "wrench"} size={17} /> : <span className="avatar mini">{unit.customer.split(" ").map(x => x[0]).join("").slice(0, 2)}</span>}<b>{unit.customer}</b></span>
      <div className="meta"><span><small>Mulai</small><b>{unit.start}</b></span><span><small>Selesai</small><b>{unit.end}</b></span><span><small>Biaya</small><b>{unit.cost}</b></span></div>
    </div>
    <div className="card-actions">
      {empty ? <Button icon="play" onClick={() => open("start", unit.id)}>Mulai sesi</Button> :
       inactive ? <Button variant="secondary" icon="wrench" onClick={() => onMaintenance(unit)}>Aktifkan unit</Button> :
       <><Button variant="secondary" icon={unit.status === "Dijeda" ? "play" : "plus"} onClick={() => unit.status === "Dijeda" ? onResume(unit) : open("add", unit.id)}>{unit.status === "Dijeda" ? "Lanjutkan" : "Tambah waktu"}</Button><button className="more-btn" aria-label={"Aksi " + unit.id} onClick={() => open("end", unit.id)}>•••</button></>}
    </div>
  </article>;
}

function Dashboard({ units: liveUnits, open, onResume, onMaintenance, mode }: { units: UnitView[]; open: (m: Modal, unitId: string) => void; onResume: (unit: UnitView) => void; onMaintenance: (unit: UnitView) => void; mode: "demo" | "supabase" }) {
  const [filter, setFilter] = useState<"Semua" | "Aktif" | "Kosong">("Semua");
  const activeCount = liveUnits.filter(unit => !["Kosong", "Maintenance"].includes(unit.status)).length;
  const emptyCount = liveUnits.filter(unit => unit.status === "Kosong").length;
  const attentionCount = liveUnits.filter(unit => ["Hampir habis", "Overtime"].includes(unit.status)).length;
  const shownUnits = liveUnits.filter(unit => filter === "Semua" || (filter === "Aktif" ? !["Kosong", "Maintenance"].includes(unit.status) : unit.status === "Kosong"));
  return <div className="page-content">
    {mode === "demo" && <div className="mode-notice"><Icon name="shield" size={16} /> Mode demo — aksi tersimpan selama halaman terbuka. Hubungkan Supabase untuk data bersama.</div>}
    <div className="summary-grid">
      <SummaryCard label="Unit dipakai" value={activeCount + " dari " + liveUnits.length} note={(liveUnits.length ? Math.round(activeCount / liveUnits.length * 100) : 0) + "% okupansi saat ini"} icon="console" tone="blue" />
      <SummaryCard label="Pendapatan hari ini" value={mode === "demo" ? "Rp 487.500" : "Lihat laporan"} note={mode === "demo" ? "+12,4% dari kemarin" : "Sinkron dari database usaha"} icon="wallet" tone="indigo" />
      <SummaryCard label="Unit kosong" value={emptyCount + " unit"} note="Siap menerima pelanggan" icon="check" tone="green" />
      <SummaryCard label="Perlu perhatian" value={attentionCount + " unit"} note="Hampir habis & overtime" icon="warning" tone="yellow" />
    </div>
    <div className="section-bar"><div><h2>Status unit real-time</h2><p>{mode === "supabase" ? "Sinkron dengan database rental" : "Timer demo berjalan otomatis"}</p></div><div className="filter-pills"><button className={filter === "Semua" ? "selected" : ""} onClick={() => setFilter("Semua")}>Semua <b>{liveUnits.length}</b></button><button className={filter === "Aktif" ? "selected" : ""} onClick={() => setFilter("Aktif")}>Aktif <b>{activeCount}</b></button><button className={filter === "Kosong" ? "selected" : ""} onClick={() => setFilter("Kosong")}>Kosong <b>{emptyCount}</b></button></div></div>
    <div className="unit-grid">{shownUnits.map(unit => <UnitCard key={unit.dbId || unit.id} unit={unit} open={open} onResume={onResume} onMaintenance={onMaintenance} />)}</div>
  </div>;
}

const sessions = [
  ["#SES-240624-018", "Budi Santoso", "PS 03", "15:00–16:30", "1j 30m", "Rp 15.000", "Selesai"],
  ["#SES-240624-017", "Siti Aisyah", "PS 06", "13:20–15:20", "2j 00m", "Rp 20.000", "Selesai"],
  ["#SES-240624-016", "Rizky Pratama", "PS 01", "14:00–17:00", "3j 00m", "Rp 45.000", "Aktif"],
  ["#SES-240624-015", "Nadia Putri", "PS 02", "12:30–14:30", "2j 00m", "Rp 40.000", "Selesai"],
  ["#SES-240624-014", "Andi Maulana", "PS 05", "11:15–13:15", "2j 00m", "Rp 30.000", "Dibatalkan"],
];

function DataToolbar({ title, description, action = "Ekspor" }: { title: string; description: string; action?: string }) {
  return <div className="page-heading"><div><h2>{title}</h2><p>{description}</p></div><Button variant="secondary" icon={action === "Ekspor" ? "download" : "plus"}>{action}</Button></div>;
}

function HistoryPage({ onDetail }: { onDetail: () => void }) {
  return <div className="page-content"><DataToolbar title="Riwayat Sesi" description="Pantau seluruh transaksi rental PlayStation" />
    <div className="panel filters"><label><span>Cari sesi</span><div className="field"><Icon name="search" size={17} /><input placeholder="ID atau nama pelanggan" /></div></label><label><span>Periode</span><select><option>Hari ini, 24 Juni 2024</option></select></label><label><span>Status</span><select><option>Semua status</option><option>Selesai</option><option>Aktif</option></select></label><Button variant="secondary" icon="filter">Filter</Button></div>
    <div className="panel table-wrap"><table><thead><tr>{["ID Sesi", "Pelanggan", "Unit", "Waktu", "Durasi", "Total", "Status", ""].map(x => <th key={x}>{x}</th>)}</tr></thead><tbody>{sessions.map((s) => <tr key={s[0]} onClick={onDetail}>{s.map((v, i) => <td key={i}>{i === 6 ? <span className={`table-status ${v.toLowerCase()}`}>{v}</span> : v}</td>)}<td><Icon name="chevron" size={17} /></td></tr>)}</tbody></table><div className="table-footer"><span>Menampilkan 1–5 dari 18 sesi</span><div><button>‹</button><button className="active">1</button><button>2</button><button>3</button><button>›</button></div></div></div>
  </div>;
}

function DetailPage({ back }: { back: () => void }) {
  return <div className="page-content"><button className="back" onClick={back}>‹ Kembali ke riwayat</button><div className="page-heading"><div><span className="eyebrow">#SES-240624-018</span><h2>Detail Sesi · PS 03</h2><p>Senin, 24 Juni 2024</p></div><span className="table-status selesai">Selesai</span></div>
    <div className="detail-grid"><div className="panel"><h3>Timeline sesi</h3><div className="timeline">{[["15:00", "Sesi dimulai", "Oleh Ardi Rahman · Paket 1 jam"],["15:48", "Tambah waktu 30 menit", "Atas permintaan pelanggan"],["16:30", "Sesi diakhiri", "Durasi akhir 1 jam 30 menit"],["16:32", "Pembayaran diterima", "Tunai · Rp 20.000"]].map((x, i) => <div className="timeline-item" key={x[0]}><span className={i === 3 ? "done" : ""}><Icon name={i === 3 ? "check" : "clock"} size={15} /></span><time>{x[0]}</time><div><b>{x[1]}</b><small>{x[2]}</small></div></div>)}</div></div>
      <div><div className="panel detail-card"><h3>Informasi pelanggan</h3><dl><div><dt>Nama</dt><dd>Budi Santoso</dd></div><div><dt>Unit</dt><dd>PS 03 · PS4 Reguler</dd></div><div><dt>Operator</dt><dd>Ardi Rahman</dd></div></dl></div><div className="panel detail-card payment"><h3>Rincian pembayaran</h3><dl><div><dt>Sewa 1j 30m</dt><dd>Rp 15.000</dd></div><div><dt>Metode</dt><dd>Tunai</dd></div><div className="total"><dt>Total</dt><dd>Rp 15.000</dd></div><div><dt>Dibayar</dt><dd>Rp 20.000</dd></div><div><dt>Kembalian</dt><dd>Rp 5.000</dd></div></dl><Button variant="secondary" icon="receipt" className="full">Cetak ulang struk</Button></div></div>
    </div></div>;
}

function ReportsPage() {
  const bars = [35, 48, 42, 66, 54, 74, 88];
  return <div className="page-content"><DataToolbar title="Laporan" description="Ringkasan performa bisnis rental" />
    <div className="range-row"><div className="filter-pills"><button>7 hari</button><button className="selected">30 hari</button><button>3 bulan</button></div><select><option>1–30 Juni 2024</option></select></div>
    <div className="summary-grid report"><SummaryCard label="Total pendapatan" value="Rp 12.480.000" note="+14,2% dari bulan lalu" icon="wallet" tone="indigo" /><SummaryCard label="Total sesi" value="486" note="+8,7% dari bulan lalu" icon="console" tone="blue" /><SummaryCard label="Rata-rata transaksi" value="Rp 25.679" note="+5,1% dari bulan lalu" icon="receipt" tone="green" /><SummaryCard label="Jam tersewa" value="782 jam" note="68% tingkat okupansi" icon="clock" tone="yellow" /></div>
    <div className="report-grid"><div className="panel chart-card wide"><div><h3>Pendapatan</h3><p>Tren pendapatan 7 hari terakhir</p></div><div className="bar-chart">{bars.map((h, i) => <div key={i}><span style={{ height: `${h}%` }} /><small>{["Sen","Sel","Rab","Kam","Jum","Sab","Min"][i]}</small></div>)}</div></div>
      <div className="panel chart-card"><div><h3>Jam sewa per unit</h3><p>Akumulasi bulan ini</p></div><div className="hbars">{[["PS 01",92],["PS 02",84],["PS 03",68],["PS 04",61],["PS 05",78],["PS 06",54]].map(x => <div key={x[0]}><b>{x[0]}</b><span><i style={{ width: `${x[1]}%` }} /></span><small>{x[1]}j</small></div>)}</div></div>
      <div className="panel chart-card heat"><div><h3>Jam tersibuk</h3><p>Intensitas kunjungan per jam</p></div><div className="heatmap">{["10","11","12","13","14","15","16","17","18","19","20","21"].map((x, i) => <div key={x}><span className={`heat-${Math.min(4, Math.floor(i / 2) + (i > 8 ? -2 : 0))}`} /><small>{x}</small></div>)}</div><div className="legend"><span>Sepi</span><i /><i /><i /><i /><span>Ramai</span></div></div>
    </div></div>;
}

const manageData: Record<"Unit" | "Tarif" | "Pengguna", string[][]> = {
  Unit: [["PS 01","PlayStation 5","VIP","Aktif"],["PS 02","PlayStation 5","VIP","Aktif"],["PS 03","PlayStation 4","Reguler","Aktif"],["PS 04","PlayStation 4","Reguler","Aktif"],["PS 05","PlayStation 5","Reguler","Aktif"],["PS 06","PlayStation 4","Reguler","Maintenance"]],
  Tarif: [["PS4 Reguler","Per jam","Rp 10.000","Aktif"],["PS5 Reguler","Per jam","Rp 15.000","Aktif"],["PS5 VIP","Per jam","Rp 20.000","Aktif"],["Paket Malam","5 jam","Rp 75.000","Terjadwal"]],
  Pengguna: [["Ardi Rahman","ardi@rentalps.id","Operator","Aktif"],["Maya Lestari","maya@rentalps.id","Pemilik","Aktif"],["Deni Kurniawan","deni@rentalps.id","Operator","Aktif"]],
};

function ManagePage({ type }: { type: "Unit" | "Tarif" | "Pengguna" }) {
  const [drawer, setDrawer] = useState(false);
  const heads = type === "Unit" ? ["Nama unit","Konsol","Ruangan","Status"] : type === "Tarif" ? ["Nama tarif","Tipe","Harga","Status"] : ["Nama","Email","Peran","Status"];
  return <div className="page-content"><DataToolbar title={`Kelola ${type}`} description={`Atur data ${type.toLowerCase()} RentalPS Manager`} action={`Tambah ${type}`} />
    <div className="panel table-wrap manage-table"><div className="table-search"><div className="field"><Icon name="search" size={17} /><input placeholder={`Cari ${type.toLowerCase()}...`} /></div><Button variant="secondary" icon="filter">Filter</Button></div><table><thead><tr>{heads.map(x => <th key={x}>{x}</th>)}<th>Aksi</th></tr></thead><tbody>{manageData[type].map(row => <tr key={row[0]}>{row.map((v,i) => <td key={v}>{i === 3 ? <span className={`table-status ${v.toLowerCase()}`}>{v}</span> : <>{i === 0 && type === "Unit" && <span className="unit-table-icon"><Icon name="console" size={17} /></span>}{v}</>}</td>)}<td><Button variant="ghost" onClick={() => setDrawer(true)}>Edit</Button></td></tr>)}</tbody></table></div>
    {drawer && <div className="drawer-backdrop" onClick={() => setDrawer(false)}><aside className="drawer" onClick={e => e.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">PENGATURAN</span><h2>Edit {type}</h2></div><button className="icon-btn" onClick={() => setDrawer(false)}><Icon name="close" /></button></div><div className="form-stack"><label><span>Nama {type.toLowerCase()}</span><input defaultValue={manageData[type][0][0]} /></label><label><span>{type === "Pengguna" ? "Peran" : "Kategori"}</span><select><option>{manageData[type][0][1]}</option><option>Operator</option><option>Pemilik</option></select></label><label><span>Status</span><select><option>Aktif</option><option>Nonaktif</option></select></label></div><div className="drawer-actions"><Button variant="secondary" onClick={() => setDrawer(false)}>Batal</Button><Button onClick={() => setDrawer(false)}>Simpan perubahan</Button></div></aside></div>}
  </div>;
}

function AuditPage() {
  return <div className="page-content"><DataToolbar title="Log Audit" description="Rekam jejak aktivitas pengguna dan perubahan sistem" />
    <div className="panel filters"><label><span>Cari aktivitas</span><div className="field"><Icon name="search" size={17} /><input placeholder="Pengguna atau aktivitas" /></div></label><label><span>Jenis aktivitas</span><select><option>Semua aktivitas</option></select></label><label><span>Tanggal</span><select><option>Hari ini</option></select></label></div>
    <div className="panel audit-list">{[["16:32","Ardi Rahman","Menyelesaikan sesi #SES-240624-018","Pembayaran tunai Rp 15.000"],["16:15","Ardi Rahman","Menambah waktu PS 02","Tambahan 30 menit"],["15:03","Maya Lestari","Mengubah tarif PS5 VIP","Rp 18.000 → Rp 20.000"],["13:20","Deni Kurniawan","Mengubah status PS 06","Aktif → Maintenance"],["09:02","Ardi Rahman","Masuk ke sistem","Perangkat kasir utama"]].map((x,i) => <div className="audit-row" key={x[0]}><span className={`audit-icon a${i}`}><Icon name={i===2 ? "tag" : i===3 ? "wrench" : i===4 ? "shield" : "clock"} /></span><time>{x[0]}</time><div><b>{x[1]}</b><span>{x[2]}</span><small>{x[3]}</small></div></div>)}</div>
  </div>;
}

function SettingsPage({ dark, setDark }: { dark: boolean; setDark: (v:boolean)=>void }) {
  return <div className="page-content settings-page"><DataToolbar title="Pengaturan" description="Sesuaikan profil bisnis dan preferensi aplikasi" action="Simpan" />
    <div className="settings-grid"><div className="panel settings-nav"><button className="active"><Icon name="console" />Profil rental</button><button><Icon name="receipt" />Pembayaran & struk</button><button><Icon name="bell" />Notifikasi</button><button><Icon name="settings" />Tampilan</button></div>
      <div className="panel settings-form"><h3>Profil rental</h3><p>Informasi ini akan tampil pada struk pembayaran.</p><div className="form-grid"><label><span>Nama rental</span><input defaultValue="RentalPS Kemang" /></label><label><span>Nomor telepon</span><input defaultValue="0812 3456 7890" /></label><label className="span-2"><span>Alamat</span><textarea defaultValue="Jl. Kemang Raya No. 24, Jakarta Selatan" /></label><label><span>Zona waktu</span><select><option>WIB (UTC+7)</option></select></label><label><span>Mata uang</span><select><option>Rupiah (IDR)</option></select></label></div><hr/><h3>Tampilan</h3><div className="theme-options"><button className={!dark ? "active" : ""} onClick={() => setDark(false)}><span className="theme-preview light"><i/><i/><i/></span><b><Icon name="sun" />Mode terang</b></button><button className={dark ? "active" : ""} onClick={() => setDark(true)}><span className="theme-preview dark"><i/><i/><i/></span><b><Icon name="moon" />Mode gelap</b></button></div></div>
    </div></div>;
}

function ModalShell({ type, unit, ratePlans, paymentMethods, close, onStart, onExtend, onEnd, onPause }: {
  type: Exclude<Modal, null>; unit: UnitView; ratePlans: RatePlan[]; paymentMethods:PaymentMethod[]; close: () => void;
  onStart: (input: { customerName: string; durationMinutes: number; ratePlanId?: string; billingType: "package" | "hourly" | "open"; ratePerHour: number }) => Promise<void>;
  onExtend: (minutes: number) => Promise<void>; onEnd: (method: "cash" | "transfer" | "qris" | "other", amount: number) => Promise<void>; onPause: () => Promise<void>;
}) {
  const [customerName, setCustomerName] = useState("");
  const [duration, setDuration] = useState(type === "add" ? 30 : 60);
  const [billingType, setBillingType] = useState<"package" | "hourly" | "open">("package");
  const matchingPlans = ratePlans.filter(plan => plan.console_type === unit.type && (plan.room === unit.room || plan.room === "Semua"));
  const exactPlan = matchingPlans.find(plan => plan.duration_minutes === duration);
  const selectedPlan = exactPlan || matchingPlans[0];
  const rate = selectedPlan?.price_per_hour ?? (unit.type === "PS5" ? unit.room === "VIP" ? 20000 : 15000 : 10000);
  const planPrice = billingType === "open" ? 0 : exactPlan ? exactPlan.price : Math.round(rate * duration / 60);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(paymentMethods[0]||"cash");
  const [received, setReceived] = useState(String(Number(unit.cost.replace(/[^0-9]/g, "")) || rate));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fnbSummary,setFnbSummary]=useState<SessionFnbSummary>({total:0,paid:0,outstanding:0,orders:[]});
  const [fnbLoading,setFnbLoading]=useState(false);
  const [fnbLoadFailed,setFnbLoadFailed]=useState(false);
  const [fnbRefresh,setFnbRefresh]=useState(0);
  useEffect(()=>{
    let alive=true;
    if(type!=="end"||!unit.sessionId||!isSupabaseConfigured){setFnbSummary({total:0,paid:0,outstanding:0,orders:[]});setFnbLoading(false);setFnbLoadFailed(false);return()=>{alive=false;};}
    setFnbLoading(true);setFnbLoadFailed(false);setError("");
    setFnbSummary({total:0,paid:0,outstanding:0,orders:[]});
    loadSessionFnbSummary(unit.sessionId).then(summary=>{
      if(!alive)return;
      setFnbSummary(summary);
      const rentalAmount=Number(unit.cost.replace(/[^0-9]/g,""))||0;
      setReceived(String(rentalAmount+summary.outstanding));
    }).catch(err=>{if(alive){setFnbLoadFailed(true);setError(err instanceof Error?err.message:"Tagihan F&B terkait sesi gagal dimuat.");}})
      .finally(()=>{if(alive)setFnbLoading(false);});
    return()=>{alive=false;};
  },[type,unit.sessionId,unit.cost,fnbRefresh]);
  useEffect(()=>{if(paymentMethods.length>0&&!paymentMethods.includes(paymentMethod))setPaymentMethod(paymentMethods[0]);},[paymentMethods,paymentMethod]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await fn(); close(); } catch (err) { setError(err instanceof Error ? err.message : "Aksi gagal. Periksa koneksi."); } finally { setBusy(false); }
  };
  const rentalAmount=Number(unit.cost.replace(/[^0-9]/g,""))||0;
  const combinedInvoiceTotal=rentalAmount+fnbSummary.total;
  const amountDueNow=rentalAmount+fnbSummary.outstanding;
  const title = type === "start" ? "Mulai Sesi Baru" : type === "add" ? "Tambah Waktu" : type === "cancel" ? "Batalkan Sesi?" : "Akhiri dan Bayar";
  if (type === "cancel") return <div className="modal-backdrop" onMouseDown={close}><div className="modal confirm" onMouseDown={e => e.stopPropagation()}><span className="danger-icon"><Icon name="warning" /></span><h2>{title}</h2><p>Gunakan hak Admin/Pemilik untuk pembatalan agar alasan dan audit tercatat.</p><div className="modal-actions"><Button variant="secondary" onClick={close}>Kembali</Button><Button variant="danger" onClick={close}>Tutup</Button></div></div></div>;
  return <div className="modal-backdrop" onMouseDown={close}><div className="modal" onMouseDown={e => e.stopPropagation()}>
    <div className="modal-head"><div><span className="eyebrow">{unit.id} · {unit.type} {unit.room.toUpperCase()}</span><h2>{title}</h2></div><button className="icon-btn" onClick={close} aria-label="Tutup"><Icon name="close" /></button></div>
    {type === "start" && <><div className="form-stack"><label><span>Nama pelanggan <i>opsional</i></span><input placeholder="Masukkan nama pelanggan" value={customerName} maxLength={60} onChange={e => setCustomerName(e.target.value)} /></label><label><span>Jenis sewa</span><div className="duration-grid"><button className={billingType === "package" ? "active" : ""} onClick={() => setBillingType("package")}>Paket<small>Harga tetap</small></button><button className={billingType === "hourly" ? "active" : ""} onClick={() => setBillingType("hourly")}>Per jam<small>Durasi pilihan</small></button><button className={billingType === "open" ? "active" : ""} onClick={() => setBillingType("open")}>Open billing<small>Bayar akhir</small></button></div></label>{billingType !== "open" && <label><span>Pilih durasi</span><div className="duration-grid">{[30,60,120,180].map(min => <button key={min} className={duration === min ? "active" : ""} onClick={() => setDuration(min)}>{min >= 60 ? (min/60) + " jam" : min + " menit"}<small>{formatIDR(Math.round(rate*min/60))}</small></button>)}</div></label>}</div><div className="modal-summary"><span>Unit <b>{unit.id}</b></span><span>Estimasi biaya <strong>{billingType === "open" ? "Sesuai durasi" : formatIDR(planPrice)}</strong></span></div></>}
    {type === "add" && <><div className="current-session"><span><small>Sisa waktu saat ini</small><b className="timer">{unit.time}</b></span><span><small>Selesai pukul</small><b>{unit.end}</b></span></div><div className="form-stack"><label><span>Tambahkan durasi</span><div className="duration-grid">{[15,30,60,120].map(min => <button key={min} className={duration === min ? "active" : ""} onClick={() => setDuration(min)}>{min >= 60 ? (min/60) + " jam" : min + " menit"}<small>{formatIDR(Math.round(rate*min/60))}</small></button>)}</div></label></div><div className="modal-summary"><span>Durasi tambahan <b>{duration} menit</b></span><span>Tambahan biaya <strong>{formatIDR(Math.round(rate*duration/60))}</strong></span></div></>}
    {type === "end" && <><div className="receipt-lines">
      <div><span>Pelanggan</span><b>{unit.customer}</b></div>
      <div><span>Biaya rental</span><b>{formatIDR(rentalAmount)}</b></div>
      {fnbLoading ? <div><span>Tagihan F&B terkait sesi</span><b>Memuat tagihan…</b></div> : fnbSummary.orders.length>0 ? <><div><span>Total F&B ({fnbSummary.orders.length} pesanan)</span><b>{formatIDR(fnbSummary.total)}</b></div><div><span>F&B sudah dibayar</span><b>{formatIDR(fnbSummary.paid)}</b></div><div><span>Sisa tagihan F&B</span><b>{formatIDR(fnbSummary.outstanding)}</b></div>{fnbSummary.orders.map(order=><div key={order.id}><span>{order.order_no}</span><b>{formatIDR(order.outstanding)} sisa</b></div>)}</> : <div><span>Pesanan F&B terkait</span><b>Tidak ada</b></div>}
      <div><span>Status waktu</span><b>{unit.status}</b></div>
      <div className="grand"><span>Total keseluruhan rental + F&B</span><strong>{formatIDR(combinedInvoiceTotal)}</strong></div>
      <div className="grand"><span>Jumlah yang harus dibayar sekarang</span><strong>{formatIDR(amountDueNow)}</strong></div>
    </div>{fnbLoadFailed && <button type="button" className="btn btn-secondary" onClick={()=>setFnbRefresh(v=>v+1)}>Coba muat ulang tagihan F&B</button>}<label className="block-label"><span>Metode pembayaran</span><div className="payment-grid">{([{key:"cash",label:"Tunai",icon:"wallet"},{key:"qris",label:"QRIS",icon:"grid"},{key:"transfer",label:"Transfer",icon:"receipt"},{key:"other",label:"Lainnya",icon:"wallet"}] as const).filter(m=>paymentMethods.includes(m.key)).map(method => <button type="button" key={method.key} className={paymentMethod === method.key ? "active" : ""} onClick={() => setPaymentMethod(method.key)}><Icon name={method.icon} />{method.label}</button>)}</div></label><label className="block-label"><span>Uang diterima (Rp)</span><div className="money-field"><span>Rp</span><input inputMode="numeric" value={received} onChange={e => setReceived(e.target.value.replace(/[^0-9]/g, ""))} /></div></label><div className="change"><span>Perkiraan kembalian</span><b>{formatIDR(Math.max(0, Number(received || 0) - amountDueNow))}</b></div></>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions">
      {type === "start" && <><Button variant="secondary" onClick={close}>Batal</Button><Button disabled={busy} icon="play" onClick={() => void run(() => onStart({ customerName, durationMinutes: duration, ratePlanId: exactPlan?.id, billingType, ratePerHour: rate }))}>{busy ? "Menyimpan…" : "Mulai sesi"}</Button></>}
      {type === "add" && <><Button variant="secondary" onClick={close}>Batal</Button><Button disabled={busy} icon="plus" onClick={() => void run(() => onExtend(duration))}>{busy ? "Menyimpan…" : "Tambah waktu"}</Button></>}
      {type === "end" && <><Button variant="secondary" onClick={() => void run(onPause)} icon="pause">Jeda sesi</Button><Button disabled={busy||fnbLoading||fnbLoadFailed} variant="danger" icon="stop" onClick={() => void run(() => onEnd(paymentMethod, Number(received || 0)))}>{busy ? "Menyimpan…" : fnbLoading ? "Memuat tagihan…" : fnbLoadFailed ? "Tagihan belum siap" : "Akhiri & bayar gabungan"}</Button></>}
    </div>
  </div></div>;
}

function Login({ onLogin, onForgotPassword, dark, setDark }: { onLogin: (email: string, password: string) => Promise<void>; onForgotPassword:(email:string)=>Promise<void>; dark: boolean; setDark:(v:boolean)=>void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(authLinkErrorAtEntry);
  const [busy, setBusy] = useState(false);
  const [forgotBusy,setForgotBusy]=useState(false);
  const [message,setMessage]=useState("");
  const submit = async () => {
    setBusy(true); setError("");
    try { await onLogin(email, password); } catch (err) { setError(err instanceof Error ? err.message : "Login gagal. Periksa email dan kata sandi."); } finally { setBusy(false); }
  };
  return <main className="login-page"><button className="icon-btn login-theme" onClick={() => setDark(!dark)} aria-label="Ganti tema"><Icon name={dark ? "sun" : "moon"} /></button><section className="login-side"><div className="brand light-brand"><span className="brand-mark"><Icon name="console" size={23} /></span><span>RentalPS <b>Manager</b></span></div><div className="login-message"><span className="live-pill"><i /> {isSupabaseConfigured ? "AUTENTIKASI SUPABASE" : "MODE DEMO"}</span><h1>Kelola rental.<br/>Lebih cepat, lebih rapi.</h1><p>Pantau semua unit, sesi, dan pendapatan dalam satu dashboard yang mudah digunakan.</p><div className="mini-dashboard"><div><i/><span/><span/></div><div><i/><span/><span/></div><div><i/><span/><span/></div></div></div><small>© 2026 RentalPS Manager</small></section><section className="login-form"><div className="login-card"><span className="mobile-logo"><Icon name="console" /> RentalPS Manager</span><h2>Selamat datang kembali</h2><p>{isSupabaseConfigured ? "Masuk menggunakan akun Supabase usaha Anda." : "Mode demo aktif. Klik masuk untuk mencoba dashboard."}</p><div className="form-stack"><label><span>Email</span><input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} placeholder={isSupabaseConfigured ? "nama@usaha.id" : "demo@rentalps.id"} /></label><label><span>Kata sandi</span><input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder={isSupabaseConfigured ? "Masukkan kata sandi" : "Tidak diperlukan untuk demo"} /></label><Button className="full" disabled={busy} onClick={() => void submit()}>{busy ? "Memeriksa…" : "Masuk ke dashboard"} <Icon name="arrow" size={18} /></Button>{isSupabaseConfigured && <button className="forgot-password-link" type="button" disabled={forgotBusy} onClick={() => {setError("");setMessage("");setForgotBusy(true);void onForgotPassword(email).then(()=>setMessage("Jika email terdaftar, tautan pemulihan akan dikirim. Periksa kotak masuk dan folder Spam.")).catch(e=>setError(e instanceof Error?e.message:"Pemulihan password gagal.")).finally(()=>setForgotBusy(false));}}>{forgotBusy?"Mengirim tautan…":"Lupa password?"}</button>}{error && <p className="form-error" role="alert">{error}</p>}{message && <p className="login-success" role="status">{message}</p>}</div><div className="demo-note"><Icon name="shield" size={18} /><span><b>{isSupabaseConfigured ? "Login aman" : "Akun demo tanpa backend"}</b><small>{isSupabaseConfigured ? "Kredensial diverifikasi oleh Supabase Auth." : "Data demo tidak dikirim ke server."}</small></span></div></div></section></main>;
}

function BottomNav({ page, setPage }: { page: Page; setPage: (p:Page)=>void }) {
  const items: { label:string; target:Page; icon:IconName }[] = [{label:"Dashboard",target:"Dashboard",icon:"grid"},{label:"Riwayat",target:"Riwayat",icon:"history"},{label:"Laporan",target:"Laporan",icon:"chart"},{label:"Menu",target:"Pengaturan",icon:"menu"}];
  return <nav className="bottom-nav">{items.map(x => <button key={x.label} className={page===x.target ? "active":""} onClick={()=>setPage(x.target)}><Icon name={x.icon}/><span>{x.label}</span></button>)}</nav>;
}

function ReceiptModal({receipt,close}:{receipt:SessionReceiptData;close:()=>void}) {
  const methodName=receipt.method==="cash"?"Tunai":receipt.method==="qris"?"QRIS":receipt.method==="transfer"?"Transfer":"Lainnya";
  const isPaid=receipt.outstanding<=0;
  const isPartial=!isPaid&&receipt.paidAmount>0;
  const shortId=receipt.id.startsWith("DEMO-")?receipt.id:receipt.id.slice(0,8).toUpperCase();
  return <div className="modal-backdrop receipt-print-root" onMouseDown={close}>
    <article className="receipt-paper" style={{width:receipt.business.paperWidth==="58"?"58mm":"80mm",maxWidth:"100%"}} onMouseDown={e=>e.stopPropagation()} aria-label="Struk pembayaran">
      <header className="receipt-header">
        <div className="receipt-logo"><span className="receipt-logo-mark"><Icon name="console" size={23}/></span><div><b>{receipt.business.name||"RentalPS"}</b><span>BUKTI PEMBAYARAN</span></div></div>
        {receipt.business.showPhone&&receipt.business.phone&&<p className="receipt-tagline">{receipt.business.phone}</p>}
        {receipt.business.showAddress&&receipt.business.address&&<p className="receipt-tagline">{receipt.business.address}</p>}
        <span className="receipt-doc-title">STRUK RENTAL + F&B</span>
      </header>
      <div className="receipt-status-row"><span className={"receipt-status"+(isPartial?" is-partial":"")}><Icon name={isPaid?"check-circle":"clock"} size={13}/>{isPaid?"LUNAS":isPartial?"BAYAR SEBAGIAN":"BELUM LUNAS"}</span><span className="receipt-number">#{shortId}</span></div>
      <div className="receipt-meta"><span>Tanggal transaksi</span><b>{receipt.paidAt}</b></div>
      <div className="receipt-section">
        <h4>DETAIL SEWA</h4>
        <div className="receipt-detail-grid"><div><span>Unit</span><b>{receipt.unit}</b></div><div><span>Pelanggan</span><b>{receipt.customer||"Pelanggan umum"}</b></div><div><span>Waktu mulai</span><b>{receipt.started}</b></div><div><span>Waktu selesai</span><b>{receipt.ended}</b></div></div>
        <div className="receipt-line"><span>Biaya rental</span><b>{formatIDR(receipt.rentalTotal)}</b></div>
      </div>
      {receipt.fnbOrders.length>0&&<div className="receipt-section receipt-payment">
        <h4>RINCIAN MAKANAN & MINUMAN</h4>
        {receipt.fnbOrders.map(order=><div key={order.id} className="receipt-fnb-order">
          <div className="receipt-line"><b>{order.orderNo}</b><b>{formatIDR(order.total)}</b></div>
          {order.items.map((item,index)=><div className="receipt-line" key={order.id+"-"+index}><span>{item.quantity} × {item.product_name} <small>{formatIDR(item.unit_price)}</small></span><b>{formatIDR(item.line_total)}</b></div>)}
          {order.paidAmount>0&&<div className="receipt-line"><span>Terbayar</span><b>{formatIDR(order.paidAmount)}</b></div>}
          {order.outstanding>0&&<div className="receipt-line receipt-change"><span>Sisa pesanan</span><b>{formatIDR(order.outstanding)}</b></div>}
        </div>)}
        <div className="receipt-line"><span>Total F&B</span><b>{formatIDR(receipt.fnbTotal)}</b></div>
      </div>}
      <div className="receipt-total-card"><span>TOTAL TAGIHAN GABUNGAN</span><strong>{formatIDR(receipt.total)}</strong><small>Biaya rental + seluruh pesanan F&B terkait sesi</small></div>
      <div className="receipt-section receipt-payment">
        <h4>RINCIAN PEMBAYARAN</h4>
        <div className="receipt-line"><span>Metode pembayaran terakhir</span><b>{methodName}</b></div>
        <div className="receipt-line"><span>Uang diterima</span><b>{formatIDR(receipt.received)}</b></div>
        <div className="receipt-line"><span>Total terbayar</span><b>{formatIDR(receipt.paidAmount)}</b></div>
        {receipt.outstanding>0&&<div className="receipt-line receipt-change"><span>Sisa tagihan</span><b>{formatIDR(receipt.outstanding)}</b></div>}
        <div className={"receipt-line receipt-change"+(receipt.change>0?" is-change":"")}><span>Kembalian</span><b>{formatIDR(receipt.change)}</b></div>
      </div>
      <footer className="receipt-footer"><span className="receipt-footer-icon"><Icon name="console" size={20}/></span><b>{receipt.business.footer||"Terima kasih telah bermain."}</b><p>Simpan struk ini sebagai bukti pembayaran.</p><small>Dicetak melalui RentalPS Manager</small></footer>
      <div className="receipt-actions"><Button variant="secondary" onClick={close}>Tutup</Button><Button icon="receipt" onClick={()=>window.print()}>Cetak struk</Button></div>
    </article>
  </div>;
}
function SetPasswordScreen({dark,onComplete}:{dark:boolean;onComplete:()=>void}) {
  const [password,setPassword]=useState("");
  const [confirmPassword,setConfirmPassword]=useState("");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [done,setDone]=useState(false);
  const submit=async()=>{
    setError("");
    if(password.length<8){setError("Password minimal 8 karakter.");return;}
    if(password!==confirmPassword){setError("Konfirmasi password belum sama.");return;}
    if(!supabase){setError("Koneksi Supabase belum tersedia.");return;}
    setBusy(true);
    try{
      const {error:authError}=await supabase.auth.updateUser({password});
      if(authError)throw authError;
      window.history.replaceState({},document.title,window.location.pathname);
      setDone(true);
    }catch(e){setError(e instanceof Error?e.message:"Password belum bisa disimpan. Minta undangan baru jika tautan sudah kedaluwarsa.");}
    finally{setBusy(false);}
  };
  return <main className={"set-password-page"+(dark?" dark":"")}><div className="set-password-card">
    <span className="set-password-logo"><Icon name="console" size={24}/></span>
    {done?<><h1>Akun siap digunakan</h1><p>Password sudah dibuat. Sekarang kamu bisa masuk ke RentalPS Manager.</p><Button block onClick={onComplete}>Lanjut ke dashboard <Icon name="arrow" size={17}/></Button></>:<>
      <span className="live-pill"><i/> UNDANGAN RENTALPS</span><h1>Buat password akun</h1>
      <p>Atur password pribadi sebelum mulai menggunakan RentalPS Manager. Jangan gunakan password Pemilik.</p>
      <div className="form-stack">
        <label><span>Password baru</span><input type="password" autoComplete="new-password" minLength={8} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Minimal 8 karakter"/></label>
        <label><span>Ulangi password</span><input type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} placeholder="Ketik ulang password"/></label>
        {error&&<p className="form-error" role="alert">{error}</p>}
        <Button block disabled={busy} onClick={()=>void submit()}>{busy?"Menyimpan password…":"Simpan password"}</Button>
      </div>
      <small>Jika tautan dari email lama tidak bisa digunakan, minta Pemilik mengirim undangan baru.</small>
    </>}
  </div></main>;
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(!isSupabaseConfigured);
  const [memberInfo,setMemberInfo]=useState<CurrentMemberInfo|null>(null);
  const [needsPassword, setNeedsPassword] = useState(authTypeAtEntry === "invite" || authTypeAtEntry === "recovery");
  const [dark, setDark] = useState(false);
  const [paymentMethods,setPaymentMethods]=useState<PaymentMethod[]>(["cash","transfer","qris","other"]);
  const [page, setPage] = useState<Page>("Dashboard");
  const [modal, setModal] = useState<Modal>(null);
  const [selectedUnitId, setSelectedUnitId] = useState("PS 03");
  const [detail, setDetail] = useState(false);
  const [liveUnits, setLiveUnits] = useState<UnitView[]>(demoUnits);
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([]);
  const [loadError, setLoadError] = useState(supabaseConfigError);
  const [notice, setNotice] = useState("");
  const [receipt, setReceipt] = useState<SessionReceiptData|null>(null);
  const mode = isSupabaseConfigured ? "supabase" : "demo";
  useEffect(()=>{
    if(!loggedIn)return;
    let mounted=true;
    void loadBusinessSettings().then((business:BusinessSettings)=>{
      if(!mounted)return;
      const configured=business.settings?.payment?.methods;
      if(Array.isArray(configured)){
        const allowed=configured.filter((method:unknown):method is PaymentMethod=>["cash","transfer","qris","other"].includes(String(method)));
        if(allowed.length)setPaymentMethods(allowed);
      }
      setDark(business.settings?.appearance?.theme==="dark");
    }).catch(error=>{if(mounted)console.warn("Pengaturan usaha belum berhasil dimuat.",error);});
    return()=>{mounted=false;};
  },[loggedIn]);
  useEffect(()=>{
    if(!loggedIn||!isSupabaseConfigured)return;
    let mounted=true;
    loadCurrentMemberInfo().then(info=>{if(mounted){setMemberInfo(info);setLoadError("");}})
      .catch(err=>{if(mounted){setMemberInfo(null);setLoadError(err instanceof Error?err.message:"Profil usaha dan role gagal dimuat.");}});
    return()=>{mounted=false;};
  },[loggedIn]);
  const effectiveRole=mode==="demo"?"owner":memberInfo?.role??"operator";
  const effectiveEmail=mode==="demo"?"demo@rentalps.id":memberInfo?.email??"";
  const effectiveBusinessName=mode==="demo"?"RentalPS Demo":memberInfo?.businessName??"RentalPS";
  const handleForgotPassword=async(email:string)=>{await requestPasswordReset(email);};

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    supabase.auth.getSession().then((result: {data:{session:any};error:any}) => { const {data,error}=result; if (mounted) { if (error) setLoadError(String(error.message??error)); setLoggedIn(Boolean(data.session)); if (data.session && (authTypeAtEntry === "invite" || authTypeAtEntry === "recovery")) setNeedsPassword(true); } });
    const {data: listener} = supabase.auth.onAuthStateChange((event:string,session:any) => { if (mounted) { setLoggedIn(Boolean(session)); if(!session)setMemberInfo(null); if(event==="PASSWORD_RECOVERY")setNeedsPassword(true); } });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!loggedIn) return;
    let mounted = true;
    const reload = async () => {
      try {
        const [u,r] = await Promise.all([loadDashboardUnits(),loadRatePlans()]);
        if (mounted) { setLiveUnits(u); setRatePlans(r); setLoadError(""); }
      } catch (err) { if (mounted) setLoadError(err instanceof Error ? err.message : "Data tidak dapat dimuat."); }
    };
    void reload();
    const unsubscribe = subscribeToRentalChanges(() => { void reload(); });
    const timer = window.setInterval(() => setLiveUnits(current => current.map(unit => {
      if (unit.remainingSeconds === undefined || unit.status === "Kosong" || unit.status === "Maintenance" || unit.status === "Dijeda") return unit;
      const next = unit.remainingSeconds - 1;
      const status = next <= 0 ? "Overtime" : next <= 600 ? "Hampir habis" : "Dipakai";
      return {...unit,remainingSeconds:next,time:formatTimer(next),status,label:next < 0 ? "Melewati waktu" : "Sisa waktu",progress:unit.plannedSeconds ? Math.min(100,Math.max(0,Math.round(((unit.plannedSeconds-Math.max(next,0))/unit.plannedSeconds)*100))) : unit.progress};
    })),1000);
    return () => { mounted = false; unsubscribe(); window.clearInterval(timer); };
  }, [loggedIn]);
  const selectedUnit = useMemo(() => liveUnits.find(unit => unit.id === selectedUnitId) ?? demoUnits.find(unit => unit.id === selectedUnitId) ?? liveUnits[0], [liveUnits, selectedUnitId]);
  const openModal = (next: Modal, unitId: string) => { setSelectedUnitId(unitId); setModal(next); };
  const refreshAfterAction = async (message: string) => {
    if (isSupabaseConfigured) setLiveUnits(await loadDashboardUnits());
    setNotice(message); window.setTimeout(() => setNotice(""),3500);
  };
  const onStart = async (input: {customerName:string;durationMinutes:number;ratePlanId?:string;billingType:"package"|"hourly"|"open";ratePerHour:number}) => {
    const unit = selectedUnit; if (!unit) throw new Error("Unit tidak ditemukan.");
    if (isSupabaseConfigured) {
      if (!unit.dbId) throw new Error("Unit ini tidak berasal dari database.");
      const result = await startSession({unitId:unit.dbId,...input}); if (result.error) throw result.error;
      await refreshAfterAction("Sesi baru berhasil dimulai.");
    } else {
      const now = new Date(); const seconds = input.billingType === "open" ? undefined : input.durationMinutes * 60;
      const end = seconds ? new Date(now.getTime()+seconds*1000) : null;
      const plan = ratePlans.find(p => p.id === input.ratePlanId);
      const amount = input.billingType === "open" ? 0 : plan?.price ?? input.ratePerHour*input.durationMinutes/60;
      setLiveUnits(current => current.map(item => item.id !== unit.id ? item : ({...item,status:"Dipakai",customer:input.customerName || "Pelanggan",start:now.toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit",hour12:false}),end:end ? end.toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit",hour12:false}) : "—",time:seconds ? formatTimer(seconds) : "Open billing",label:seconds ? "Sisa waktu" : "Durasi berjalan",cost:formatIDR(amount),remainingSeconds:seconds,plannedSeconds:seconds,progress:0,startedAt:now.toISOString(),plannedEndAt:end?.toISOString() ?? null,sessionId:"demo-"+Date.now(),billingType:input.billingType} as UnitView)));
      await refreshAfterAction("Sesi demo berhasil dimulai.");
    }
  };
  const onExtend = async (minutes:number) => {
    const unit = selectedUnit; if (!unit) throw new Error("Unit tidak ditemukan.");
    if (isSupabaseConfigured) {
      if (!unit.sessionId) throw new Error("Sesi aktif tidak ditemukan.");
      const result = await extendSession(unit.sessionId,minutes); if (result.error) throw result.error;
    } else setLiveUnits(current => current.map(item => {
      if (item.id !== unit.id) return item;
      const seconds = Math.max(0,item.remainingSeconds ?? 0)+minutes*60;
      const oldCost = Number(item.cost.replace(/[^0-9]/g,"")) || 0;
      const rate = item.type === "PS5" ? (item.room === "VIP" ? 20000 : 15000) : 10000;
      return {...item,status:seconds <= 600 ? "Hampir habis" : "Dipakai",remainingSeconds:seconds,plannedSeconds:Math.max(item.plannedSeconds ?? 0,seconds),time:formatTimer(seconds),label:"Sisa waktu",cost:formatIDR(oldCost+rate*minutes/60),end:new Date(Date.now()+seconds*1000).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit",hour12:false})} as UnitView;
    }));
    await refreshAfterAction("Waktu ditambahkan.");
  };
  const onEnd = async (method:"cash"|"transfer"|"qris"|"other",amount:number) => {
    const unit = selectedUnit; if (!unit) throw new Error("Unit tidak ditemukan.");
    const estimatedTotal = Number(unit.cost.replace(/[^0-9]/g,"")) || 0;
    let finalTotal = estimatedTotal;
    let rentalTotal = estimatedTotal;
    let fnbTotal = 0;
    let receiptId = unit.sessionId || "DEMO-" + Date.now();
    let paidAmount = 0;
    let outstanding = estimatedTotal;
    let changeAmount = 0;
    let fnbOrders:SessionReceiptData["fnbOrders"]=[];
    if (isSupabaseConfigured) {
      if (!unit.sessionId) throw new Error("Sesi aktif tidak ditemukan.");
      const result = await endSession({sessionId:unit.sessionId,method,receivedAmount:amount});
      if (result.error) throw result.error;
      const paymentResult = result.data as any;
      finalTotal = Number(paymentResult?.total ?? estimatedTotal);
      rentalTotal = Number(paymentResult?.rental_total ?? estimatedTotal);
      fnbTotal = Number(paymentResult?.fnb_total ?? 0);
      receiptId = String(paymentResult?.session_id ?? unit.sessionId);
      paidAmount = Number(paymentResult?.paid_total ?? paymentResult?.applied ?? 0);
      outstanding = Number(paymentResult?.outstanding ?? Math.max(0, finalTotal-paidAmount));
      changeAmount = Number(paymentResult?.change ?? Math.max(0, amount-finalTotal));
      fnbOrders=(paymentResult?.fnb_orders??[]).map((order:any)=>({
        id:String(order.order_id),orderNo:String(order.order_no),total:Number(order.total||0),
        paidAmount:Number(order.paid_amount||0),outstanding:Number(order.outstanding||0),
        items:(order.items??[]).map((item:any)=>({product_name:String(item.product_name),quantity:Number(item.quantity||0),unit_price:Number(item.unit_price||0),line_total:Number(item.line_total||0)}))
      }));
    } else {
      paidAmount=Math.min(finalTotal,Math.max(0,amount));
      outstanding=Math.max(0,finalTotal-paidAmount);
      changeAmount=Math.max(0,amount-finalTotal);
      setLiveUnits(current => current.map(item => item.id !== unit.id ? item : ({...item,status:"Kosong",time:"Siap main",label:"Tersedia sekarang",customer:"Belum ada sesi",start:"—",end:"—",cost:item.type === "PS5" ? formatIDR(item.room === "VIP" ? 20000 : 15000)+"/jam" : "Rp 10.000/jam",progress:0,remainingSeconds:undefined,plannedSeconds:undefined,sessionId:undefined,plannedEndAt:null} as UnitView)));
    }
    const businessSettings=await loadBusinessSettings().catch(()=>null);
    const rawSettings=businessSettings?.settings||{};
    const profile=rawSettings.profile||{};
    const receiptSettings=rawSettings.receipt||{};
    setReceipt({
      id:receiptId,unit:unit.id,customer:unit.customer,started:unit.start,
      ended:new Date().toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit",hour12:false}),
      total:finalTotal,rentalTotal,fnbTotal,fnbOrders,paidAmount,outstanding,method,
      received:Math.max(0,amount),change:changeAmount,
      paidAt:new Date().toLocaleString("id-ID",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:false}),
      business:{name:businessSettings?.name||"RentalPS",phone:profile.phone||"",address:profile.address||"",
        footer:receiptSettings.footer||"Terima kasih telah bermain.",showPhone:receiptSettings.show_phone!==false,
        showAddress:receiptSettings.show_address!==false,paperWidth:String(receiptSettings.paper_width||"80")==="58"?"58":"80"}
    });
    await refreshAfterAction("Sesi telah diakhiri. Tagihan rental dan F&B diproses dalam satu checkout.");
  };
  const onPause = async () => {
    const unit = selectedUnit; if (!unit) throw new Error("Unit tidak ditemukan.");
    if (isSupabaseConfigured) { if (!unit.sessionId) throw new Error("Sesi aktif tidak ditemukan."); const result=await pauseSession(unit.sessionId); if (result.error) throw result.error; }
    else setLiveUnits(current => current.map(item => item.id !== unit.id ? item : ({...item,status:"Dijeda",label:"Sisa saat dijeda"} as UnitView)));
    await refreshAfterAction("Sesi dijeda.");
  };
  const onResume = async (unit:UnitView) => {
    try {
      if (isSupabaseConfigured) { if (!unit.sessionId) throw new Error("Sesi aktif tidak ditemukan."); const result=await resumeSession(unit.sessionId); if (result.error) throw result.error; }
      else setLiveUnits(current => current.map(item => item.id !== unit.id ? item : ({...item,status:(item.remainingSeconds ?? 0) <= 0 ? "Overtime" : "Dipakai",label:"Sisa waktu"} as UnitView)));
      await refreshAfterAction("Sesi dilanjutkan.");
    } catch (err) { setLoadError(err instanceof Error ? err.message : "Sesi tidak dapat dilanjutkan."); }
  };
  const onMaintenance = async (unit:UnitView) => {
    try {
      if (isSupabaseConfigured) { if (!unit.dbId) throw new Error("Unit tidak ditemukan di database."); await setUnitMaintenance(unit.dbId,unit.status !== "Maintenance","Diubah dari dashboard"); await refreshAfterAction("Status unit diperbarui."); }
      else setLiveUnits(current => current.map(item => item.id !== unit.id ? item : ({...item,status:unit.status === "Maintenance" ? "Kosong" : "Maintenance",time:unit.status === "Maintenance" ? "Siap main" : "Tidak aktif",label:unit.status === "Maintenance" ? "Tersedia sekarang" : "Tidak tersedia",customer:unit.status === "Maintenance" ? "Belum ada sesi" : "Unit maintenance",start:"—",end:"—",cost:"—",progress:0,remainingSeconds:undefined} as UnitView)));
    } catch (err) { setLoadError(err instanceof Error ? err.message : "Status unit tidak dapat diubah."); }
  };
  const handleLogin = async (email:string,password:string) => {
    if (isSupabaseConfigured) { if (!supabase) throw new Error("Supabase belum tersedia."); const {error}=await supabase.auth.signInWithPassword({email,password}); if (error) throw error; }
    else setLoggedIn(true);
  };
  if (!loggedIn) return <div className={dark ? "app dark" : "app"}><Login onLogin={handleLogin} onForgotPassword={handleForgotPassword} dark={dark} setDark={setDark} /></div>;
  if (needsPassword) return <div className={dark ? "app dark" : "app"}><SetPasswordScreen dark={dark} onComplete={() => { setNeedsPassword(false); setPage("Dashboard"); }} /></div>;
  const allowedPages:Page[]=effectiveRole==="owner"?nav.map(item=>item.label):effectiveRole==="admin"?nav.filter(item=>item.label!=="Pengaturan").map(item=>item.label):["Dashboard","Riwayat","F&B","Reservasi"];
  const onShowReceipt=async(sessionId:string)=>{
    try{setReceipt(await loadSessionReceipt(sessionId));setLoadError("");}
    catch(error){setLoadError(error instanceof Error?error.message:"Struk tidak dapat dimuat dari database.");}
  };
  const content = !allowedPages.includes(page) ? <div className="page-content"><div className="app-alert error">Akses halaman ini memerlukan izin yang lebih tinggi.</div></div> : detail ? <DetailPage back={()=>setDetail(false)} /> : page === "Dashboard" ? <Dashboard units={liveUnits} open={openModal} onResume={onResume} onMaintenance={onMaintenance} mode={mode} /> : page === "Riwayat" ? <HistoryPageV2 onReceipt={onShowReceipt} paymentMethods={paymentMethods} /> : page === "Laporan" ? <ReportsPageV2 /> : page === "F&B" ? <FnbPageV2 role={effectiveRole} paymentMethods={paymentMethods} activeRentalUnitIds={liveUnits.filter(unit=>Boolean(unit.dbId&&unit.sessionId)).map(unit=>unit.dbId!)} onEndLinkedRental={(unitId)=>{const unit=liveUnits.find(item=>item.dbId===unitId&&item.sessionId);if(!unit){setLoadError("Sesi rental aktif tidak ditemukan untuk pesanan ini.");return;}setLoadError("");setSelectedUnitId(unit.id);setModal("end");}} /> : page === "Reservasi" ? <ReservationsPageV2 /> : page === "Log Audit" ? <AuditPageV2 /> : page === "Pengaturan" ? <SettingsPageV2 dark={dark} setDark={setDark} onSaved={(settings)=>{const methods=settings.settings?.payment?.methods;if(Array.isArray(methods)&&methods.length)setPaymentMethods(methods as PaymentMethod[]);setDark(settings.settings?.appearance?.theme==="dark");}} /> : <ManagePageV2 type={page as "Unit"|"Tarif"|"Pengguna"} />;
  return <div className={dark ? "app dark" : "app"}><Sidebar page={page} setPage={(p)=>{if(allowedPages.includes(p)){setPage(p);setDetail(false);}else setLoadError("Role akun ini tidak memiliki akses ke halaman tersebut.");}} onLogout={async ()=>{if (supabase) await supabase.auth.signOut();setLoggedIn(false);setMemberInfo(null);}} role={effectiveRole} email={effectiveEmail} businessName={effectiveBusinessName} /><main className="main"><Topbar page={detail ? "Riwayat" : page} dark={dark} setDark={setDark} />{(loadError || notice) && <div className={loadError ? "app-alert error" : "app-alert"} role="status">{loadError || notice}<button onClick={()=>{setLoadError("");setNotice("")}} aria-label="Tutup notifikasi">×</button></div>}{content}</main><BottomNav page={page} setPage={(p)=>{setPage(p);setDetail(false)}} />{modal && selectedUnit && <ModalShell type={modal} unit={selectedUnit} ratePlans={ratePlans} paymentMethods={paymentMethods} close={()=>setModal(null)} onStart={onStart} onExtend={onExtend} onEnd={onEnd} onPause={onPause} />}{receipt && <ReceiptModal receipt={receipt} close={()=>setReceipt(null)} />}</div>;
}
