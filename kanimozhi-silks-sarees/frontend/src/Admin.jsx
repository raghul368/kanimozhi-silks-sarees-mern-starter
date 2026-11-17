import React, { useEffect, useState } from 'react';
import { PackagePlus, ShoppingBag, LayoutDashboard, LogOut, LockKeyhole, Sparkles, Trash2, Pencil, X, FileText } from 'lucide-react';
import { apiUrl } from './api.js';
import { extractBankStatement } from './bankStatement.js';
import GstInvoices from './GstInvoices.jsx';

const normalizeProductImageUrl = imageUrl => {
  const image = new URL(imageUrl);
  if (image.hostname !== 'drive.google.com') return imageUrl;

  const fileId = image.pathname.match(/^\/file\/d\/([^/]+)/)?.[1] || image.searchParams.get('id');
  if (!fileId) throw new Error('Use a Google Drive file link or a direct image URL.');

  image.pathname = '/uc';
  image.search = '';
  image.searchParams.set('export', 'view');
  image.searchParams.set('id', fileId);
  return image.toString();
};
const nextOrderStatuses={
  placed:['placed','processing','cancelled'],
  processing:['processing','shipped','cancelled'],
  shipped:['shipped','delivered'],
  delivered:['delivered'],
  cancelled:['cancelled'],
};
export default function Admin({ token, onSignIn, onSignOut, onClose }) {
  const [credentials, setCredentials] = useState({ username: '', password: '' });
  const [items, setItems] = useState([]);
  const [orders, setOrders] = useState([]);
  const [ordersError, setOrdersError] = useState('');
  const [orderForms, setOrderForms] = useState({});
  const [savingOrder, setSavingOrder] = useState('');
  const [orderMessages, setOrderMessages] = useState({});
  const [subscribers, setSubscribers] = useState([]);
  const [subscribersError, setSubscribersError] = useState('');
  const [activeSection, setActiveSection] = useState('overview');
  const [database, setDatabase] = useState('checking');
  const [form, setForm] = useState({ name: '', category: 'Kanchipuram', price: '', color: '', image: '', description: '' });
  const [editingProduct, setEditingProduct] = useState(null);
  const [deletingProduct, setDeletingProduct] = useState('');
  const [editForm, setEditForm] = useState({ name: '', price: '', image: '' });
  const [savingEdit, setSavingEdit] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [tryOns, setTryOns] = useState([]);
  const [historyImages, setHistoryImages] = useState({});
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [deletingTryOn, setDeletingTryOn] = useState('');
  const [statementFile, setStatementFile] = useState(null);
  const [statementFileName, setStatementFileName] = useState('');
  const [statementTransactions, setStatementTransactions] = useState([]);
  const [statementBusy, setStatementBusy] = useState(false);
  const [statementError, setStatementError] = useState('');
  const [statementMessage, setStatementMessage] = useState('');
  const [transactionSearch, setTransactionSearch] = useState('');
  const [transactionDirection, setTransactionDirection] = useState('all');
  const [transactionDateFrom, setTransactionDateFrom] = useState('');
  const [transactionDateTo, setTransactionDateTo] = useState('');

  useEffect(() => {
    if (!token) return;
    let active = true;
    const loadStore = async () => {
      let loadingStep = 'store';
      try {
        const [productsResponse, healthResponse] = await Promise.all([
          fetch(`${apiUrl}/products`),
          fetch(`${apiUrl}/health`),
        ]);
        if (!productsResponse.ok || !healthResponse.ok) {
          throw new Error('Unable to load store data. Please try again.');
        }
        const [products, health] = await Promise.all([productsResponse.json(), healthResponse.json()]);
        if (active) {
          setItems(Array.isArray(products) ? products : []);
          setDatabase(health.database);
        }
        if (health.database !== 'connected') {
          if (active) {
            setOrders([]);
            setOrdersError('Connect MongoDB to view orders.');
            setSubscribers([]);
            setSubscribersError('Connect MongoDB to view newsletter subscribers.');
            setTryOns([]);
            setHistoryError('Connect MongoDB to view saved try-on history.');
          }
          return;
        }
        loadingStep = 'orders';
        const ordersResponse = await fetch(`${apiUrl}/admin/orders`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!ordersResponse.ok) {
          const result = await ordersResponse.json();
          if (ordersResponse.status === 401) onSignOut();
          throw new Error(result.message || 'Unable to load orders.');
        }
        const orderRecords = await ordersResponse.json();
        if (active) {
          setOrders(Array.isArray(orderRecords) ? orderRecords : []);
          setOrderForms(Object.fromEntries(orderRecords.map(order=>[order.id,{
            orderStatus:order.orderStatus,
            carrier:order.carrier||'',
            trackingNumber:order.trackingNumber||'',
            trackingUrl:order.trackingUrl||'',
          }])));
          setOrdersError('');
        }
        loadingStep = 'newsletter';
        const subscribersResponse = await fetch(`${apiUrl}/admin/newsletter`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!subscribersResponse.ok) {
          const result = await subscribersResponse.json();
          if (subscribersResponse.status === 401) onSignOut();
          throw new Error(result.message || 'Unable to load newsletter subscribers.');
        }
        const subscriberRecords = await subscribersResponse.json();
        if (active) {
          setSubscribers(Array.isArray(subscriberRecords) ? subscriberRecords : []);
          setSubscribersError('');
        }
        loadingStep = 'history';
        const historyResponse = await fetch(`${apiUrl}/admin/try-ons`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!historyResponse.ok) {
          const result = await historyResponse.json();
          if (historyResponse.status === 401) onSignOut();
          throw new Error(result.message || 'Unable to load try-on history.');
        }
        const history = await historyResponse.json();
        if (active) {
          setTryOns(Array.isArray(history) ? history : []);
          setHistoryError('');
        }
      } catch (error) {
        if (active) {
          const errorMessage = error.message || 'Unable to load store data.';
          if (loadingStep === 'store') {
            setItems([]);
            setHistoryError(errorMessage);
            setOrdersError(errorMessage);
          } else if (loadingStep === 'orders') {
            setOrdersError(errorMessage);
          } else if (loadingStep === 'newsletter') {
            setSubscribersError(errorMessage);
          } else {
            setHistoryError(errorMessage);
          }
        }
      }
    };
    loadStore();
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (!token || !tryOns.length) {
      setHistoryImages({});
      setHistoryLoading(false);
      return undefined;
    }

    let active = true;
    const objectUrls = [];
    setHistoryImages({});
    setHistoryLoading(true);
    setHistoryError('');
    const loadImages = async () => {
      try {
        const entries = await Promise.all(tryOns.map(async record => {
          const images = await Promise.all(['preview', 'person', 'saree'].map(async kind => {
            const response = await fetch(`${apiUrl}/admin/try-ons/${record.id}/images/${kind}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!response.ok) {
              const result = await response.json();
              if (response.status === 401) onSignOut();
              throw new Error(result.message || 'Unable to load saved try-on photos.');
            }
            const imageUrl = URL.createObjectURL(await response.blob());
            if (!active) {
              URL.revokeObjectURL(imageUrl);
              return [kind, ''];
            }
            objectUrls.push(imageUrl);
            return [kind, imageUrl];
          }));
          return [record.id, Object.fromEntries(images)];
        }));
        if (active) setHistoryImages(Object.fromEntries(entries));
      } catch (error) {
        if (active) {
          objectUrls.forEach(URL.revokeObjectURL);
          objectUrls.length = 0;
          setHistoryImages({});
          setHistoryError(error.message || 'Unable to load saved try-on photos.');
        }
      } finally {
        if (active) setHistoryLoading(false);
      }
    };
    loadImages();
    return () => {
      active = false;
      objectUrls.forEach(URL.revokeObjectURL);
    };
  }, [token, tryOns]);

  const signIn = async event => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`${apiUrl}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || `Request failed (${response.status})`);

      onSignIn(result.token);
      setCredentials({ username: '', password: '' });
    } catch (error) {
      setMessage(error.message || 'Unable to sign in. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const save = async event => {
    event.preventDefault();
    setMessage('');
    try {
      const item = { ...form, image: normalizeProductImageUrl(form.image), id: `KS${Date.now()}`, price: Number(form.price), tag: 'New arrival' };
      const response = await fetch(`${apiUrl}/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(item),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401) onSignOut();
        throw new Error(result.message || `Request failed (${response.status})`);
      }
      setItems(old => [result, ...old]);
      setMessage('Product saved to MongoDB.');
      setForm({ name: '', category: 'Kanchipuram', price: '', color: '', image: '', description: '' });
    } catch (error) {
      setMessage(`Product not saved: ${error.message || 'Please try again.'}`);
    }
  };

  const startEditing = product => {
    setEditingProduct(product.id);
    setEditForm({ name: product.name, price: String(product.price), image: product.image });
    setMessage('');
  };

  const saveEdit = async event => {
    event.preventDefault();
    if (!editingProduct) return;
    setSavingEdit(true);
    setMessage('');
    try {
      const response = await fetch(`${apiUrl}/products/${encodeURIComponent(editingProduct)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: editForm.name, price: Number(editForm.price), image: normalizeProductImageUrl(editForm.image) }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401) onSignOut();
        throw new Error(result.message || `Request failed (${response.status})`);
      }
      setItems(old => old.map(product => product.id === result.id ? result : product));
      setEditingProduct(null);
      setMessage('Product name, price, and image updated.');
    } catch (error) {
      setMessage(`Product not updated: ${error.message || 'Please try again.'}`);
    } finally {
      setSavingEdit(false);
    }
  };

  const deleteProduct = async product => {
    if (!window.confirm(`Remove "${product.name}" from the customer catalogue?`)) return;
    setDeletingProduct(product.id);
    setMessage('');
    try {
      const response = await fetch(`${apiUrl}/products/${encodeURIComponent(product.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const result = await response.json();
        if (response.status === 401) onSignOut();
        throw new Error(result.message || `Request failed (${response.status})`);
      }
      setItems(current => current.filter(item => item.id !== product.id));
      if (editingProduct === product.id) setEditingProduct(null);
      setMessage('Product removed from the customer catalogue.');
    } catch (error) {
      setMessage(`Product not removed: ${error.message || 'Please try again.'}`);
    } finally {
      setDeletingProduct('');
    }
  };

  const deleteTryOn = async id => {
    if (!window.confirm('Delete these uploaded photos and the generated preview now?')) return;
    setDeletingTryOn(id);
    setHistoryError('');
    try {
      const response = await fetch(`${apiUrl}/admin/try-ons/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const result = await response.json();
        if (response.status === 401) onSignOut();
        throw new Error(result.message || 'Unable to delete saved try-on.');
      }
      setTryOns(old => old.filter(record => record.id !== id));
    } catch (error) {
      setHistoryError(error.message || 'Unable to delete saved try-on.');
    } finally {
      setDeletingTryOn('');
    }
  };

  const importBankStatement = async event => {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!statementFile) {
      setStatementError('Choose a PDF transaction statement.');
      return;
    }

    setStatementBusy(true);
    setStatementError('');
    setStatementMessage('');
    setStatementTransactions([]);
    setStatementFileName('');
    try {
      const transactions = await extractBankStatement(statementFile);
      setStatementTransactions(transactions);
      setStatementFileName(statementFile.name);
      setTransactionSearch('');
      setTransactionDirection('all');
      setTransactionDateFrom('');
      setTransactionDateTo('');
      setStatementFile(null);
      formElement.reset();
      setStatementMessage('Statement loaded. Search below to show only the matching transaction history.');
    } catch (error) {
      setStatementError(error.message || 'Unable to read this transaction statement.');
    } finally {
      setStatementBusy(false);
    }
  };

  const updateOrderForm=(order,changes)=>{
    setOrderForms(current=>({
      ...current,
      [order.id]:{
        orderStatus:order.orderStatus,
        carrier:order.carrier||'',
        trackingNumber:order.trackingNumber||'',
        trackingUrl:order.trackingUrl||'',
        ...current[order.id],
        ...changes,
      },
    }));
  };

  const saveOrderUpdate=async(event,order)=>{
    event.preventDefault();
    const form=orderForms[order.id]||{
      orderStatus:order.orderStatus,
      carrier:order.carrier||'',
      trackingNumber:order.trackingNumber||'',
      trackingUrl:order.trackingUrl||'',
    };
    setSavingOrder(order.id);
    setOrderMessages(current=>({...current,[order.id]:''}));
    try{
      const response=await fetch(`${apiUrl}/admin/orders/${encodeURIComponent(order.id)}`,{
        method:'PATCH',
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
        body:JSON.stringify(form),
      });
      const result=await response.json();
      if(!response.ok){
        if(response.status===401)onSignOut();
        throw new Error(result.message||'Unable to update order fulfilment.');
      }
      setOrders(current=>current.map(item=>item.id===result.order.id?result.order:item));
      setOrderForms(current=>({...current,[order.id]:{
        orderStatus:result.order.orderStatus,
        carrier:result.order.carrier,
        trackingNumber:result.order.trackingNumber,
        trackingUrl:result.order.trackingUrl,
      }}));
      setOrderMessages(current=>({...current,[order.id]:result.emailSent===null
        ?'No changes to save.'
        :result.emailSent
          ?'Fulfilment updated and customer email sent.'
          :'Fulfilment saved, but the customer email was not sent. Check Resend configuration and backend logs.'}));
    }catch(error){
      setOrderMessages(current=>({...current,[order.id]:error.message||'Unable to update order fulfilment.'}));
    }finally{
      setSavingOrder('');
    }
  };

  return <div className="admin-page">
    <header className="admin-top">
      <div className="admin-brand"><span className="brand-mark">K</span><div><b>KANIMOZHI</b><small>STORE ADMIN</small></div></div>
      {token ? <div className="admin-session-actions"><button className="outline-btn" onClick={onClose}>BACK TO STORE</button><button className="outline-btn" onClick={onSignOut}><LogOut size={15}/>SIGN OUT</button></div> : <button className="outline-btn" onClick={onClose}><LogOut size={15}/>BACK TO STORE</button>}
    </header>
    {!token ? <main className="admin-login">
      <div className="eyebrow"><span/> PRIVATE STORE MANAGEMENT <span/></div>
      <h1>Admin <em>sign in</em></h1>
      <p>Sign in with the owner credentials configured for this store.</p>
      <form className="admin-form" onSubmit={signIn}>
        <label>Username<input autoComplete="username" required value={credentials.username} onChange={event => setCredentials({ ...credentials, username: event.target.value })}/></label>
        <label>Password<input type="password" autoComplete="current-password" required value={credentials.password} onChange={event => setCredentials({ ...credentials, password: event.target.value })}/></label>
        <button className="gold-btn" type="submit" disabled={busy}><LockKeyhole size={15}/>{busy ? 'SIGNING IN...' : 'SIGN IN'}</button>
      </form>
      {message && <p className="admin-message" role="alert">{message}</p>}
    </main> : <div className="admin-wrap">
      <aside className="admin-side">
        <button type="button" className={activeSection==='overview'?'admin-side-active':''} onClick={()=>setActiveSection('overview')}><LayoutDashboard/> Overview</button>
        <button type="button" className={activeSection==='inventory'?'admin-side-active':''} onClick={()=>setActiveSection('inventory')}><ShoppingBag/> Products & inventory</button>
        <button type="button" className={activeSection==='orders'?'admin-side-active':''} onClick={()=>setActiveSection('orders')}><PackagePlus/> Orders</button>
        <button type="button" className={activeSection==='newsletter'?'admin-side-active':''} onClick={()=>setActiveSection('newsletter')}><Sparkles/> Newsletter</button>
        <button type="button" className={activeSection==='bank-history'?'admin-side-active':''} onClick={()=>setActiveSection('bank-history')}><FileText/> Bank transactions</button>
        <button type="button" className={activeSection==='gst-invoices'?'admin-side-active':''} onClick={()=>setActiveSection('gst-invoices')}><FileText/> GST invoices</button>
      </aside>
      <main className="admin-content">
        <div className="eyebrow">STORE MANAGEMENT</div>
        <h1>{activeSection==='overview'?<>Welcome, <em>Kanimozhi.</em></>:activeSection==='inventory'?'Products & inventory':activeSection==='orders'?'Orders':activeSection==='newsletter'?'Newsletter subscribers':activeSection==='gst-invoices'?'GST invoices':'Bank transactions'}</h1>
        <p className="admin-sub">{activeSection==='orders'?'Review customer orders and their fulfilment details.':activeSection==='newsletter'?'View emails subscribed to store updates.':activeSection==='bank-history'?'Upload a statement, search transaction descriptions by name, and filter debit or credit entries.':activeSection==='gst-invoices'?'Create a checked GST invoice for each date on a price list.':'Manage your collections and keep your boutique up to date.'}</p>
        {activeSection==='overview'&&<>
          <div className="admin-stats"><div><small>PRODUCTS IN CATALOGUE</small><b>{items.length}</b></div><div><small>ORDERS RECEIVED</small><b>{orders.length}</b></div><div><small>STORE STATUS</small><b className="live-label">{database === 'connected' ? 'CONNECTED' : database === 'checking' ? 'CHECKING' : database === 'offline' ? 'OFFLINE' : 'DEMO MODE'}</b></div></div>
          <section className="admin-panel"><h2><Sparkles/> Saved virtual try-ons <span>{tryOns.length} recent · 30-day retention</span></h2><p className="tryon-history-note">Uploaded person photos, saree images, and previews are private to the admin dashboard and automatically deleted after 30 days.</p>
            {historyError && <p className="admin-message" role="alert">{historyError}</p>}
            {historyLoading && <p className="admin-sub">Loading saved images…</p>}
            {!historyLoading && tryOns.length === 0 && !historyError && <p className="admin-sub">No saved try-on previews yet.</p>}
            <div className="tryon-history-grid">{tryOns.map(record => <article className="tryon-history-card" key={record.id}>
              <div className="tryon-history-images">
                {['preview', 'person', 'saree'].map(kind => {
                  const imageUrl=historyImages[record.id]?.[kind];
                  return imageUrl&&<figure key={kind}><img src={imageUrl} alt={`${kind} for saved try-on`} /><figcaption>{kind === 'preview' ? 'AI preview' : kind === 'person' ? 'Person photo' : 'Saree image'}</figcaption></figure>;
                })}
              </div>
              <div className="tryon-history-meta"><time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleString('en-IN')}</time><button className="tryon-delete" type="button" disabled={deletingTryOn === record.id} onClick={() => deleteTryOn(record.id)} aria-label="Delete saved try-on"><Trash2 size={15}/>{deletingTryOn === record.id ? 'DELETING' : 'DELETE'}</button></div>
            </article>)}</div>
          </section>
        </>}
        {activeSection==='inventory'&&<>
          <section className="admin-panel"><h2><PackagePlus/> Add a new saree</h2><form className="admin-form" onSubmit={save}>
            <label>Product name<input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="e.g. Ruby Kanjivaram Silk"/></label>
            <label>Collection<select value={form.category} onChange={event => setForm({ ...form, category: event.target.value })}><option>Kanchipuram</option><option>Bridal</option><option>Soft Silk</option><option>Banarasi</option></select></label>
            <label>Price (INR)<input required type="number" min="1" value={form.price} onChange={event => setForm({ ...form, price: event.target.value })} placeholder="18990"/></label>
            <label>Colour<input value={form.color} onChange={event => setForm({ ...form, color: event.target.value })} placeholder="Ruby red"/></label>
            <label className="wide">Product image URL or Google Drive link<input required type="url" value={form.image} onChange={event => setForm({ ...form, image: event.target.value })} placeholder="https://..."/></label>
            <label className="wide">Description<textarea value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} placeholder="Describe the weave, border and details"/></label>
            <button className="gold-btn" type="submit"><PackagePlus size={16}/> SAVE PRODUCT</button>
          </form>{message && <p className="admin-message" role="alert">{message}</p>}</section>
          <section className="admin-panel"><h2>Current catalogue <span>{items.length} items</span></h2>{items.length===0?<p className="admin-sub">No active products in the catalogue.</p>:<div className="admin-products">{items.map(product => <div className="admin-product-row" key={product.id}><img src={product.image} alt=""/><span><b>{product.name}</b><small>{product.category} · ₹{Number(product.price).toLocaleString('en-IN')}</small></span>{editingProduct === product.id ? <form className="admin-product-edit" onSubmit={saveEdit}><label>Product name<input required maxLength="150" value={editForm.name} onChange={event => setEditForm({ ...editForm, name: event.target.value })}/></label><label>Price (INR)<input required type="number" min="1" step="1" value={editForm.price} onChange={event => setEditForm({ ...editForm, price: event.target.value })}/></label><label>Image URL<input required type="url" value={editForm.image} onChange={event => setEditForm({ ...editForm, image: event.target.value })}/></label><button className="outline-btn" type="submit" disabled={savingEdit}>{savingEdit ? 'SAVING…' : 'SAVE'}</button><button className="outline-btn" type="button" onClick={() => setEditingProduct(null)} disabled={savingEdit} aria-label="Cancel editing"><X size={14}/></button></form> : <div className="admin-product-actions"><button className="outline-btn admin-product-edit-button" type="button" onClick={() => startEditing(product)}><Pencil size={14}/>EDIT</button><button className="outline-btn admin-product-delete-button" type="button" disabled={deletingProduct===product.id} onClick={() => deleteProduct(product)}><Trash2 size={14}/>{deletingProduct===product.id?'REMOVING…':'DELETE'}</button></div>}</div>)}</div>}{message && <p className="admin-message" role="status">{message}</p>}</section>
        </>}
        {activeSection==='orders'&&<section className="admin-panel"><h2><PackagePlus/> Customer orders <span>{orders.length} recent</span></h2>
          {ordersError&&<p className="admin-message" role="alert">{ordersError}</p>}
          {!ordersError&&orders.length===0&&<p className="admin-sub">No orders have been placed yet.</p>}
          <div className="admin-orders">{orders.map(order=><article className="admin-order" key={order.id}>
            <div className="admin-order-heading"><div><b>ORDER · {order.id}</b><time>{new Date(order.createdAt).toLocaleString('en-IN')}</time></div><span className="profile-status">{order.orderStatus.toUpperCase()} · {order.paymentStatus.toUpperCase()}</span></div>
            <p><b>{order.customer.name}</b> · {order.customer.email} · {order.customer.phone}</p>
            <p>{order.shippingAddress.address}, {order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postal}</p>
            <ul>{order.items.map((item,index)=><li key={`${item.productId}-${index}`}>{item.name} × {item.quantity}</li>)}</ul>
            <div className="admin-order-total"><span>{order.paymentMethod}</span><b>₹{Number(order.subtotal).toLocaleString('en-IN')}</b></div>
            <form className="admin-fulfilment-form" onSubmit={event=>saveOrderUpdate(event,order)}>
              <label>Status<select value={orderForms[order.id]?.orderStatus||order.orderStatus} onChange={event=>updateOrderForm(order,{orderStatus:event.target.value})}>{(nextOrderStatuses[order.orderStatus]||[order.orderStatus]).map(status=><option key={status} value={status}>{status.toUpperCase()}</option>)}</select></label>
              <label>Carrier<input maxLength="100" value={orderForms[order.id]?.carrier??order.carrier??''} onChange={event=>updateOrderForm(order,{carrier:event.target.value})} placeholder="Courier name"/></label>
              <label>Tracking number<input maxLength="100" required={(orderForms[order.id]?.orderStatus||order.orderStatus)==='shipped'} value={orderForms[order.id]?.trackingNumber??order.trackingNumber??''} onChange={event=>updateOrderForm(order,{trackingNumber:event.target.value})} placeholder="Tracking number"/></label>
              <label>Tracking link<input type="url" maxLength="500" value={orderForms[order.id]?.trackingUrl??order.trackingUrl??''} onChange={event=>updateOrderForm(order,{trackingUrl:event.target.value})} placeholder="https://..."/></label>
              <button className="outline-btn" type="submit" disabled={savingOrder===order.id}>{savingOrder===order.id?'SAVING…':'SAVE FULFILMENT'}</button>
              {orderMessages[order.id]&&<p className="admin-message" role="status">{orderMessages[order.id]}</p>}
            </form>
          </article>)}</div>
        </section>}
        {activeSection==='newsletter'&&<section className="admin-panel"><h2><Sparkles/> Newsletter subscribers <span>{subscribers.length} saved</span></h2>
          {subscribersError&&<p className="admin-message" role="alert">{subscribersError}</p>}
          {!subscribersError&&subscribers.length===0&&<p className="admin-sub">No subscribers have joined the list yet.</p>}
          <div className="newsletter-subscribers">{subscribers.map(subscriber=><div key={subscriber.email}><b>{subscriber.email}</b><time>{new Date(subscriber.createdAt).toLocaleDateString('en-IN',{dateStyle:'medium'})}</time></div>)}</div>
        </section>}
        {activeSection==='bank-history'&&(()=>{
          const query=transactionSearch.trim().toLocaleLowerCase();
          const dateRangeError=transactionDateFrom&&transactionDateTo&&transactionDateFrom>transactionDateTo;
          const matchingTransactions=dateRangeError?[]:statementTransactions.filter(transaction=>
            (!query||transaction.description.toLocaleLowerCase().includes(query))&&
            (!transactionDateFrom||transaction.date>=transactionDateFrom)&&
            (!transactionDateTo||transaction.date<=transactionDateTo),
          );
          const debitCount=matchingTransactions.filter(transaction=>transaction.debit!==null).length;
          const creditCount=matchingTransactions.filter(transaction=>transaction.credit!==null).length;
          const visibleTransactions=matchingTransactions.filter(transaction=>
            transactionDirection==='all'||
            (transactionDirection==='debit'&&transaction.debit!==null)||
            (transactionDirection==='credit'&&transaction.credit!==null),
          );
          const amount = value => Number(value).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
          return <section className="admin-panel bank-statement-panel">
            <h2><FileText/> Search statement transactions</h2>
            <p className="bank-history-note">The PDF is processed only in this browser and is not uploaded or saved. Search matches the exact text fragment you enter, ignoring letter case; it does not guess names.</p>
            <form className="admin-form bank-import-form" onSubmit={importBankStatement}>
              <label className="wide">Transaction statement PDF<input required type="file" accept=".pdf,application/pdf" onChange={event=>setStatementFile(event.target.files?.[0]||null)}/></label>
              <p className="bank-history-note wide">For accuracy, the statement must contain clearly labeled Date, Debit, Credit, and Balance columns. If they cannot be matched reliably, the import is rejected. Text-based PDFs only; maximum 15 MB and 100 pages.</p>
              <button className="gold-btn" type="submit" disabled={statementBusy}><FileText size={15}/>{statementBusy?'READING PDF…':'LOAD STATEMENT'}</button>
            </form>
            {statementError&&<p className="admin-message" role="alert">{statementError}</p>}
            {statementMessage&&<p className="admin-message" role="status">{statementMessage}</p>}
            {statementFileName&&<div className="bank-statement-loaded"><b>Loaded:</b> {statementFileName}<button type="button" className="outline-btn" onClick={()=>{setStatementTransactions([]);setStatementFileName('');setStatementMessage('');setStatementError('');setTransactionSearch('');setTransactionDirection('all');setTransactionDateFrom('');setTransactionDateTo('');}}>CLEAR</button></div>}
            {statementTransactions.length>0&&<>
              <label className="bank-transaction-search">Search a name or text in transaction descriptions
                <input type="search" maxLength="120" autoComplete="off" value={transactionSearch} onChange={event=>setTransactionSearch(event.target.value)} placeholder="Enter a name or any part of it"/>
                <small>Partial, case-insensitive text matching. For example, 5 consecutive letters can match a longer name.</small>
              </label>
              <div className="bank-date-range">
                <label>From date (optional)<input type="date" value={transactionDateFrom} max={transactionDateTo||undefined} onChange={event=>setTransactionDateFrom(event.target.value)}/></label>
                <label>To date (optional)<input type="date" value={transactionDateTo} min={transactionDateFrom||undefined} onChange={event=>setTransactionDateTo(event.target.value)}/></label>
                <button type="button" className="outline-btn" disabled={!transactionDateFrom&&!transactionDateTo} onClick={()=>{setTransactionDateFrom('');setTransactionDateTo('');}}>CLEAR DATES</button>
                <small>Set either or both dates; selected dates are included.</small>
              </div>
              <div className="bank-direction-filters" role="group" aria-label="Filter by transaction type">
                <button type="button" className={transactionDirection==='all'?'active':''} aria-pressed={transactionDirection==='all'} onClick={()=>setTransactionDirection('all')}>All</button>
                <button type="button" className={transactionDirection==='debit'?'active':''} aria-pressed={transactionDirection==='debit'} onClick={()=>setTransactionDirection('debit')}>Debit only</button>
                <button type="button" className={transactionDirection==='credit'?'active':''} aria-pressed={transactionDirection==='credit'} onClick={()=>setTransactionDirection('credit')}>Credit only</button>
              </div>
              {dateRangeError&&<p className="admin-message" role="alert">From date must be on or before the To date.</p>}
              {!query?<p className="admin-sub">Enter a name or text from a transaction description to see only matching history.</p>:<>
                {!dateRangeError&&<><p className="bank-history-note">{visibleTransactions.length} shown · {matchingTransactions.length} match search/date filters · {debitCount} debits · {creditCount} credits</p>
                  {visibleTransactions.length===0?<p className="admin-sub">{matchingTransactions.length===0?'No transactions match the search and selected date range.':'No transactions match the selected type.'}</p>:<div className="bank-history-table-wrap"><table className="bank-history-table"><thead><tr><th>Date</th><th>Description</th>{transactionDirection!=='credit'&&<th>Debit</th>}{transactionDirection!=='debit'&&<th>Credit</th>}<th>Balance</th></tr></thead><tbody>{visibleTransactions.map((transaction,index)=><tr key={`${transaction.date}-${index}`}><td>{new Date(`${transaction.date}T00:00:00`).toLocaleDateString('en-IN')}</td><td>{transaction.description}</td>{transactionDirection!=='credit'&&<td>{transaction.debit===null?'—':amount(transaction.debit)}</td>}{transactionDirection!=='debit'&&<td>{transaction.credit===null?'—':amount(transaction.credit)}</td>}<td>{amount(transaction.balance)}</td></tr>)}</tbody></table></div>}
                </>}
              </>}
            </>}
          </section>;
        })()}
        <div hidden={activeSection!=='gst-invoices'}><GstInvoices/></div>
      </main>
    </div>}
  </div>;
}
