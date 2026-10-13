import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  cancelFbOrder, createFbOrder, createReservation, createPaymentRequestKey, formatIDR, loadFbOrders,
  loadFbProducts, loadManagedUnits, loadReservations, payFbOrder, saveFbProduct, subscribeToFnbChanges,
  updateReservationStatus, type FbOrder, type FbProduct, type ManagedUnit, type PaymentMethod,
  type ReservationRecord,
} from "./lib/rentalApi";
import { isSupabaseConfigured } from "./lib/supabase";

type Role="owner"|"admin"|"operator";
const methodLabel=(m:PaymentMethod)=>m==="cash"?"Tunai":m==="qris"?"QRIS":m==="transfer"?"Transfer":"Lainnya";
const initialLocalProducts:FbProduct[]=[
 {id:"demo-drink-1",code:"AIR01",name:"Air Mineral",category:"Minuman",price:5000,stock_quantity:30,is_active:true},
 {id:"demo-drink-2",code:"TEH01",name:"Teh Botol",category:"Minuman",price:6000,stock_quantity:24,is_active:true},
 {id:"demo-food-1",code:"MIE01",name:"Mi Instan",category:"Makanan",price:8000,stock_quantity:20,is_active:true},
 {id:"demo-snack-1",code:"SNK01",name:"Keripik",category:"Snack",price:5000,stock_quantity:null,is_active:true},
];

export function FnbPageV2({role,paymentMethods,activeRentalUnitIds=[],onEndLinkedRental}:{role:Role;paymentMethods:PaymentMethod[];activeRentalUnitIds?:string[];onEndLinkedRental?:(unitId:string)=>void}) {
  const [products,setProducts]=useState<FbProduct[]>([]);
  const [orders,setOrders]=useState<FbOrder[]>([]);
  const [units,setUnits]=useState<ManagedUnit[]>([]);
  const [cart,setCart]=useState<Record<string,number>>({});
  const [customer,setCustomer]=useState("");
  const [unitId,setUnitId]=useState("");
  const [search,setSearch]=useState("");
  const [category,setCategory]=useState("Semua");
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [productDrawer,setProductDrawer]=useState(false);
  const [productForm,setProductForm]=useState({code:"",name:"",category:"Minuman",price:"5000",stock:""});
  const [paymentOrder,setPaymentOrder]=useState<FbOrder|null>(null);
  const [paymentRequestKey,setPaymentRequestKey]=useState(createPaymentRequestKey);
  const [received,setReceived]=useState("");
  const [method,setMethod]=useState<PaymentMethod>(paymentMethods[0]||"cash");
  const canManage=role==="owner"||role==="admin";
  async function refresh(){
    setLoading(true);setError("");
    try{
      const [ps,os,us]=await Promise.all([loadFbProducts(),loadFbOrders(),loadManagedUnits()]);
      setProducts(ps);setOrders(os);setUnits(us);
    }catch(e){setError(e instanceof Error?e.message:"Data F&B gagal dimuat.");}
    finally{setLoading(false);}
  }
  useEffect(()=>{
    let alive=true;
    void refresh();
    const unsubscribe=subscribeToFnbChanges(()=>{if(alive)void refresh();});
    return()=>{alive=false;unsubscribe();};
  },[]);
  useEffect(()=>{
    if(paymentMethods.length>0&&!paymentMethods.includes(method))setMethod(paymentMethods[0]);
  },[paymentMethods,method]);
  const filtered=products.filter(p=>(category==="Semua"||p.category===category)&&(p.name+" "+p.code).toLowerCase().includes(search.toLowerCase()));
  const cartItems=Object.entries(cart).filter(([,qty])=>qty>0).map(([id,quantity])=>({product:products.find(p=>p.id===id),quantity})).filter((x):x is {product:FbProduct;quantity:number}=>Boolean(x.product));
  const cartTotal=cartItems.reduce((sum,x)=>sum+x.product.price*x.quantity,0);
  const cartChange=(id:string,delta:number)=>setCart(prev=>({...prev,[id]:Math.max(0,Math.min(99,(prev[id]||0)+delta))}));
  const submitProduct=async(e:FormEvent)=>{
    e.preventDefault();setBusy(true);setError("");setNotice("");
    try{
      await saveFbProduct({code:productForm.code,name:productForm.name,category:productForm.category,price:Number(productForm.price),stock_quantity:productForm.stock.trim()===""?null:Number(productForm.stock)});
      setProductDrawer(false);setProductForm({code:"",name:"",category:"Minuman",price:"5000",stock:""});
      setNotice("Produk berhasil disimpan.");await refresh();
    }catch(e){setError(e instanceof Error?e.message:"Produk gagal disimpan.");}
    finally{setBusy(false);}
  };
  const submitOrder=async()=>{
    setBusy(true);setError("");setNotice("");
    try{
      await createFbOrder({items:cartItems.map(x=>({product_id:x.product.id,quantity:x.quantity})),unitId:unitId||undefined,customerName:customer.trim()||undefined});
      setCart({});setCustomer("");setUnitId("");setNotice("Pesanan dibuat. Selesaikan pembayaran dari daftar pesanan.");await refresh();
    }catch(e){setError(e instanceof Error?e.message:"Pesanan gagal dibuat.");}
    finally{setBusy(false);}
  };
  const settle=async(e:FormEvent)=>{
    e.preventDefault();if(!paymentOrder)return;setBusy(true);setError("");setNotice("");
    try{
      const result=await payFbOrder({orderId:paymentOrder.id,method,receivedAmount:Number(received),idempotencyKey:paymentRequestKey});
      if(result.error)throw result.error;
      const data=result.data as {outstanding?:number;change?:number;applied?:number};
      setNotice("Pembayaran diterima. Dibukukan "+formatIDR(Number(data.applied||0))+"; kembalian "+formatIDR(Number(data.change||0))+". Sisa "+formatIDR(Number(data.outstanding||0))+".");
      setPaymentOrder(null);setReceived("");setPaymentRequestKey(createPaymentRequestKey());await refresh();
    }catch(e){setError(e instanceof Error?e.message:"Pembayaran gagal.");}
    finally{setBusy(false);}
  };
  const cancel=async(order:FbOrder)=>{
    if(!window.confirm("Batalkan pesanan "+order.order_no+"? Stok hanya dikembalikan jika belum ada pembayaran."))return;
    setError("");setNotice("");
    try{await cancelFbOrder(order.id);setNotice("Pesanan dibatalkan dan stok dikembalikan.");await refresh();}
    catch(e){setError(e instanceof Error?e.message:"Pesanan tidak dapat dibatalkan.");}
  };
  const totalStock=products.reduce((sum,p)=>sum+(p.stock_quantity??0),0);
  return <div className="page-content">
    <div className="page-heading"><div><h2>F&B / Kasir Tambahan</h2><p>Kelola produk, stok, pesanan, dan pembayaran makanan/minuman.</p></div>{canManage&&<button className="btn btn-primary" onClick={()=>setProductDrawer(true)}>+ Tambah produk</button>}</div>
    {!isSupabaseConfigured&&<div className="mode-notice">Mode demo: katalog contoh tampil, tetapi pembuatan pesanan membutuhkan koneksi Supabase.</div>}
    {notice&&<div className="app-alert" role="status">{notice}<button onClick={()=>setNotice("")}>×</button></div>}
    {error&&<div className="app-alert error" role="alert">{error}<button onClick={()=>setError("")}>×</button></div>}
    <div className="summary-grid report">
      <div className="summary-card"><span className="summary-icon indigo">F&B</span><div><small>Produk aktif</small><strong>{products.length}</strong><span>Katalog usaha</span></div></div>
      <div className="summary-card"><span className="summary-icon blue">Stok</span><div><small>Stok terpantau</small><strong>{totalStock}</strong><span>Unit produk dengan stok</span></div></div>
      <div className="summary-card"><span className="summary-icon green">#</span><div><small>Pesanan terbuka</small><strong>{orders.filter(o=>o.status==="open").length}</strong><span>Belum lunas</span></div></div>
      <div className="summary-card"><span className="summary-icon yellow">Rp</span><div><small>Nilai pesanan terbuka</small><strong>{formatIDR(orders.filter(o=>o.status==="open").reduce((sum,o)=>sum+Math.max(0,o.total-o.paid_amount),0))}</strong><span>Sisa tagihan</span></div></div>
    </div>
    <div className="fnb-layout">
      <section className="panel fnb-products">
        <div className="fnb-toolbar"><div><h3>Katalog produk</h3><p>Pilih produk untuk dimasukkan ke pesanan.</p></div><span className="stock-chip">{products.length} produk</span></div>
        <div className="table-search"><div className="field"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cari produk…"/></div><select value={category} onChange={e=>setCategory(e.target.value)}>{["Semua",...Array.from(new Set(products.map(p=>p.category)))].map(x=><option key={x}>{x}</option>)}</select></div>
        {loading?<div className="empty-cell">Memuat katalog…</div>:filtered.length===0?<div className="empty-cell">Produk belum tersedia.</div>:<div className="fnb-product-grid">{filtered.map(product=><article className="fnb-product" key={product.id}><span className="fnb-product-icon">{product.category==="Minuman"?"◉":product.category==="Makanan"?"▤":"◇"}</span><div className="fnb-product-name"><b>{product.name}</b><small>{product.code} · {product.stock_quantity===null?"Stok tidak dilacak":"Stok "+product.stock_quantity}</small></div><strong>{formatIDR(product.price)}</strong><div className="fnb-product-actions"><button disabled={product.stock_quantity!==null&&product.stock_quantity<=0} onClick={()=>cartChange(product.id,-1)}>−</button><b>{cart[product.id]||0}</b><button disabled={product.stock_quantity!==null&&(cart[product.id]||0)>=product.stock_quantity} onClick={()=>cartChange(product.id,1)}>+</button></div></article>)}</div>}
      </section>
      <aside className="panel fnb-cart"><div><h3>Pesanan baru</h3><p>{cartItems.length} jenis produk · {cartItems.reduce((n,x)=>n+x.quantity,0)} item</p></div>
        <label><span>Nama pelanggan (opsional)</span><input value={customer} onChange={e=>setCustomer(e.target.value)} placeholder="Nama pelanggan"/></label>
        <label><span>Kaitkan ke unit / sesi rental (opsional)</span><select value={unitId} onChange={e=>setUnitId(e.target.value)}><option value="">Tanpa unit</option>{units.map(u=><option key={u.id} value={u.id}>{u.name} · {u.room}</option>)}</select>{unitId&&<small className="help-text">Jika unit sedang dirental, pesanan otomatis masuk ke sesi aktif dan digabung ke struk akhir rental.</small>}</label>
        <div className="fnb-cart-lines">{cartItems.map(x=><div key={x.product.id}><span>{x.quantity} × {x.product.name}</span><b>{formatIDR(x.product.price*x.quantity)}</b></div>)}</div>
        <div className="fnb-cart-total"><span>Total</span><strong>{formatIDR(cartTotal)}</strong></div>
        <button className="btn btn-primary full" disabled={busy||cartItems.length===0||!isSupabaseConfigured} onClick={()=>void submitOrder()}>{busy?"Menyimpan…":"Buat pesanan"}</button>
        {!isSupabaseConfigured&&<small className="help-text">Hubungkan Supabase untuk menyimpan pesanan dan stok bersama.</small>}
      </aside>
    </div>
    <section className="panel table-wrap fnb-orders"><div className="table-heading"><div><h3>Daftar pesanan</h3><p>Pesanan dan status pelunasan.</p></div><button className="btn btn-secondary" onClick={()=>void refresh()}>Muat ulang</button></div>
      <table><thead><tr>{["No. pesanan","Pelanggan/unit","Item","Total","Terbayar","Sisa","Status","Aksi"].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>
        {orders.length===0?<tr><td colSpan={8} className="empty-cell">Belum ada pesanan tersimpan.</td></tr>:orders.map(order=><tr key={order.id}><td className="session-id">{order.order_no}</td><td>{order.customer_name||"Pelanggan umum"}{order.unit_name&&<small className="table-subtext">{order.unit_name}</small>}{order.session_id&&<small className="table-subtext">Terhubung ke sesi rental</small>}</td><td>{order.items.reduce((n,i)=>n+i.quantity,0)} item</td><td>{formatIDR(order.total)}</td><td>{formatIDR(order.paid_amount)}</td><td>{formatIDR(Math.max(0,order.total-order.paid_amount))}</td><td><span className={"table-status "+order.payment_status}>{order.status==="cancelled"?"Batal":order.payment_status==="paid"?"Lunas":order.payment_status==="partial"?"Sebagian":"Belum lunas"}</span></td><td className="management-actions">{order.status==="open"&&<><button className="btn btn-secondary" onClick={()=>{setPaymentOrder(order);setPaymentRequestKey(createPaymentRequestKey());setReceived(String(Math.max(0,order.total-order.paid_amount)));}}>Bayar F&B</button>{order.paid_amount===0&&<button className="btn btn-ghost" onClick={()=>void cancel(order)}>Batalkan</button>}</>}{order.status!=="cancelled"&&order.unit_id&&activeRentalUnitIds.includes(order.unit_id)&&onEndLinkedRental&&<button className="btn btn-primary" onClick={()=>onEndLinkedRental(order.unit_id!)}>Akhiri + bayar gabungan</button>}</td></tr>)}
      </tbody></table>
    </section>
    {productDrawer&&<div className="drawer-backdrop" onClick={()=>setProductDrawer(false)}><aside className="drawer" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">KATALOG F&B</span><h2>Tambah produk</h2></div><button className="icon-btn" onClick={()=>setProductDrawer(false)} aria-label="Tutup">×</button></div><form className="form-stack manage-form" onSubmit={submitProduct}><label><span>Kode produk</span><input required maxLength={24} value={productForm.code} onChange={e=>setProductForm(p=>({...p,code:e.target.value.toUpperCase()}))} placeholder="AIR01"/></label><label><span>Nama produk</span><input required maxLength={100} value={productForm.name} onChange={e=>setProductForm(p=>({...p,name:e.target.value}))}/></label><label><span>Kategori</span><select value={productForm.category} onChange={e=>setProductForm(p=>({...p,category:e.target.value}))}>{["Minuman","Makanan","Snack","Aksesoris","Lainnya"].map(x=><option key={x}>{x}</option>)}</select></label><label><span>Harga (Rp)</span><input type="number" min="0" required value={productForm.price} onChange={e=>setProductForm(p=>({...p,price:e.target.value}))}/></label><label><span>Stok</span><input type="number" min="0" value={productForm.stock} onChange={e=>setProductForm(p=>({...p,stock:e.target.value}))} placeholder="Kosongkan untuk tidak melacak stok"/></label>{error&&<p className="form-error">{error}</p>}<div className="drawer-actions"><button type="button" className="btn btn-secondary" onClick={()=>setProductDrawer(false)}>Batal</button><button className="btn btn-primary" disabled={busy}>{busy?"Menyimpan…":"Simpan produk"}</button></div></form></aside></div>}
    {paymentOrder&&<div className="modal-backdrop" onClick={()=>setPaymentOrder(null)}><form className="modal fnb-payment-modal" onClick={e=>e.stopPropagation()} onSubmit={e=>void settle(e)}><div className="modal-head"><div><span className="eyebrow">{paymentOrder.order_no}</span><h2>Pembayaran F&B</h2></div><button type="button" className="icon-btn" onClick={()=>setPaymentOrder(null)}>×</button></div><div className="receipt-lines"><div><span>Total pesanan</span><b>{formatIDR(paymentOrder.total)}</b></div><div><span>Sudah dibayar</span><b>{formatIDR(paymentOrder.paid_amount)}</b></div><div className="grand"><span>Sisa tagihan</span><strong>{formatIDR(Math.max(0,paymentOrder.total-paymentOrder.paid_amount))}</strong></div></div><label><span>Metode</span><select value={method} onChange={e=>setMethod(e.target.value as PaymentMethod)}>{(["cash","transfer","qris","other"] as const).filter(m=>paymentMethods.includes(m)).map(m=><option key={m} value={m}>{methodLabel(m)}</option>)}</select></label><label><span>Uang diterima (Rp)</span><input type="number" min="1" required value={received} onChange={e=>setReceived(e.target.value)}/></label><div className="change"><span>Perkiraan kembalian</span><b>{formatIDR(Math.max(0,Number(received||0)-(paymentOrder.total-paymentOrder.paid_amount)))}</b></div>{error&&<p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={()=>setPaymentOrder(null)}>Batal</button><button className="btn btn-primary" disabled={busy||Number(received)<=0}>{busy?"Menyimpan…":"Simpan pembayaran"}</button></div></form></div>}
  </div>;
}

export function ReservationsPageV2() {
  const [rows,setRows]=useState<ReservationRecord[]>([]);
  const [units,setUnits]=useState<ManagedUnit[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [search,setSearch]=useState("");
  const [form,setForm]=useState({customer_name:"",phone:"",unit_id:"",starts_at:"",ends_at:"",notes:""});
  async function refresh(){
    setLoading(true);setError("");
    try{const [rs,us]=await Promise.all([loadReservations(),loadManagedUnits()]);setRows(rs);setUnits(us);}
    catch(e){setError(e instanceof Error?e.message:"Reservasi gagal dimuat.");}
    finally{setLoading(false);}
  }
  useEffect(()=>{void refresh();},[]);
  const create=async(e:FormEvent)=>{
    e.preventDefault();setBusy(true);setError("");setNotice("");
    try{
      await createReservation({customer_name:form.customer_name,phone:form.phone,unit_id:form.unit_id||undefined,starts_at:new Date(form.starts_at).toISOString(),ends_at:new Date(form.ends_at).toISOString(),notes:form.notes});
      setNotice("Reservasi disimpan. Unit baru akan dikunci saat status diubah menjadi dikonfirmasi.");
      setForm({customer_name:"",phone:"",unit_id:"",starts_at:"",ends_at:"",notes:""});
      await refresh();
    }catch(e){setError(e instanceof Error?e.message:"Reservasi gagal dibuat.");}
    finally{setBusy(false);}
  };
  const update=async(row:ReservationRecord,status:ReservationRecord["status"])=>{
    setError("");setNotice("");
    try{await updateReservationStatus(row.id,status);setNotice("Status reservasi diperbarui.");await refresh();}
    catch(e){setError(e instanceof Error?e.message:"Status gagal diubah. Periksa bentrok jadwal.");}
  };
  const visible=rows.filter(r=>(r.customer_name+" "+(r.phone||"")+" "+(r.unit_name||"")).toLowerCase().includes(search.toLowerCase()));
  const localDate=(offsetHours:number)=>{const d=new Date(Date.now()+offsetHours*3600000);d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,16);};
  return <div className="page-content">
    <div className="page-heading"><div><h2>Reservasi</h2><p>Jadwalkan kunjungan, tetapkan unit, dan cegah bentrok saat konfirmasi.</p></div><button className="btn btn-secondary" onClick={()=>void refresh()}>Muat ulang</button></div>
    {!isSupabaseConfigured&&<div className="mode-notice">Mode demo: buat reservasi memerlukan koneksi Supabase.</div>}
    {notice&&<div className="app-alert" role="status">{notice}</div>}{error&&<div className="app-alert error" role="alert">{error}</div>}
    <div className="reservation-layout"><form className="panel reservation-form" onSubmit={e=>void create(e)}><div><h3>Reservasi baru</h3><p>Isi waktu mulai/selesai dan informasi pelanggan.</p></div>
      <label><span>Nama pelanggan</span><input required maxLength={100} value={form.customer_name} onChange={e=>setForm(f=>({...f,customer_name:e.target.value}))}/></label>
      <label><span>Nomor telepon</span><input maxLength={40} value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} placeholder="Opsional"/></label>
      <label><span>Unit</span><select value={form.unit_id} onChange={e=>setForm(f=>({...f,unit_id:e.target.value}))}><option value="">Belum ditentukan</option>{units.map(u=><option key={u.id} value={u.id}>{u.name} · {u.console_type} · {u.room}</option>)}</select></label>
      <label><span>Mulai</span><input type="datetime-local" required min={localDate(0)} value={form.starts_at} onChange={e=>setForm(f=>({...f,starts_at:e.target.value}))}/></label>
      <label><span>Selesai</span><input type="datetime-local" required min={form.starts_at||localDate(0)} value={form.ends_at} onChange={e=>setForm(f=>({...f,ends_at:e.target.value}))}/></label>
      <label><span>Catatan</span><textarea rows={2} maxLength={250} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}/></label>
      <button className="btn btn-primary full" disabled={busy||!isSupabaseConfigured}>{busy?"Menyimpan…":"Simpan reservasi"}</button>
    </form><section className="panel table-wrap reservation-list"><div className="table-search"><div><h3>Jadwal reservasi</h3><p>{rows.length} jadwal ditemukan</p></div><div className="field"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cari pelanggan/unit"/></div></div>
      <table><thead><tr>{["Pelanggan","Unit","Mulai","Selesai","Status","Aksi"].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{loading?<tr><td colSpan={6} className="empty-cell">Memuat reservasi…</td></tr>:visible.length===0?<tr><td colSpan={6} className="empty-cell">Belum ada reservasi.</td></tr>:visible.map(r=><tr key={r.id}><td>{r.customer_name}<small className="table-subtext">{r.phone||"Tanpa nomor telepon"}</small></td><td>{r.unit_name||"Belum dipilih"}</td><td>{new Date(r.starts_at).toLocaleString("id-ID",{dateStyle:"short",timeStyle:"short"})}</td><td>{new Date(r.ends_at).toLocaleString("id-ID",{dateStyle:"short",timeStyle:"short"})}</td><td><span className={"table-status "+r.status}>{({pending:"Menunggu",confirmed:"Dikonfirmasi",checked_in:"Check-in",cancelled:"Dibatalkan",completed:"Selesai"} as Record<string,string>)[r.status]}</span></td><td className="management-actions">{r.status==="pending"&&<button className="btn btn-secondary" onClick={()=>void update(r,"confirmed")}>Konfirmasi</button>}{r.status==="confirmed"&&<button className="btn btn-secondary" onClick={()=>void update(r,"checked_in")}>Check-in</button>}{["pending","confirmed"].includes(r.status)&&<button className="btn btn-ghost" onClick={()=>void update(r,"cancelled")}>Batalkan</button>}{r.status==="checked_in"&&<button className="btn btn-ghost" onClick={()=>void update(r,"completed")}>Selesai</button>}</td></tr>)}</tbody></table>
    </section></div>
  </div>;
}
