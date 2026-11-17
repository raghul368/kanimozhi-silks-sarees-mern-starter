import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, LogOut, RefreshCw, ShoppingBag, UserRound, XCircle } from 'lucide-react';
import { apiUrl } from './api.js';
const currency = amount => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
}).format(amount);

export default function Profile({ customer, onBack, onSignOut }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [cancellingOrder, setCancellingOrder] = useState('');
  const [message, setMessage] = useState('');

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch(`${apiUrl}/orders/mine`, { credentials: 'include' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to load your orders.');
      setOrders(Array.isArray(result) ? result : []);
    } catch (error) {
      setMessage(error.message || 'Unable to load your orders.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  const cancelOrder = async order => {
    if (!window.confirm('Cancel this order? This cannot be undone.')) return;
    setCancellingOrder(order.id);
    setMessage('');
    try {
      const response = await fetch(`${apiUrl}/orders/${encodeURIComponent(order.id)}/cancel`, {
        method: 'POST',
        credentials: 'include',
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to cancel this order.');
      setOrders(current => current.map(item => item.id === order.id ? result.order : item));
    } catch (error) {
      setMessage(error.message || 'Unable to cancel this order.');
    } finally {
      setCancellingOrder('');
    }
  };

  const logout = async () => {
    setLoggingOut(true);
    setMessage('');
    try {
      const response = await fetch(`${apiUrl}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.message || 'Unable to sign out.');
      }
      onSignOut();
    } catch (error) {
      setMessage(error.message || 'Unable to sign out. Please check your connection and try again.');
    } finally {
      setLoggingOut(false);
    }
  };

  return <div className="profile-page">
    <header className="checkout-top"><span className="brand-mark">K</span><b>KANIMOZHI <small>SILKS & SAREES</small></b></header>
    <main className="profile-content">
      <button className="text-link" type="button" onClick={onBack}><ArrowLeft size={15}/> BACK TO STORE</button>
      <div className="profile-heading"><div><div className="eyebrow"><span/> YOUR ACCOUNT <span/></div><h1>Welcome, <em>{customer.name}</em></h1></div><button className="outline-btn" type="button" onClick={logout} disabled={loggingOut}><LogOut size={15}/>{loggingOut ? 'SIGNING OUT…' : 'SIGN OUT'}</button></div>
      <section className="profile-card">
        <h2><UserRound size={19}/> Profile details</h2>
        <dl><div><dt>Name</dt><dd>{customer.name}</dd></div><div><dt>Email</dt><dd>{customer.email}</dd></div>{customer.username&&<div><dt>Username</dt><dd>{customer.username}</dd></div>}</dl>
      </section>
      <section className="profile-orders">
        <div className="profile-orders-heading"><h2><ShoppingBag size={19}/> Your orders</h2><button className="outline-btn" type="button" onClick={loadOrders} disabled={loading}><RefreshCw size={14}/> REFRESH</button></div>
        {message&&<p className="admin-message" role="alert">{message}</p>}
        {loading&&<p className="admin-sub">Loading your order history…</p>}
        {!loading&&!message&&orders.length===0&&<p className="profile-empty">You have no orders yet. Find a saree to treasure and it will appear here.</p>}
        {!loading&&orders.map(order=><article className="profile-order" key={order.id}>
          <div className="profile-order-head"><div><small>ORDER · {order.id}</small><time>{new Date(order.createdAt).toLocaleDateString('en-IN',{dateStyle:'long'})}</time></div><span className={`profile-status ${order.paymentStatus==='paid'?'paid':''}`}>{order.orderStatus.toUpperCase()} · {order.paymentStatus==='paid'?'PAID':order.paymentMethod==='Cash on Delivery'?'CASH ON DELIVERY · PENDING':'PAYMENT PENDING'}</span></div>
          <div className="profile-order-items">{order.items.map((item,index)=><span key={`${item.productId}-${index}`}>{item.name} × {item.quantity}</span>)}</div>
          {order.trackingNumber&&<div className="profile-tracking"><b>{order.carrier||'Courier'} tracking</b><span>{order.trackingNumber}</span>{order.trackingUrl&&<a href={order.trackingUrl} target="_blank" rel="noreferrer">TRACK PACKAGE</a>}</div>}
          <div className="profile-order-total"><span>{order.paymentMethod}</span><b>{currency(order.subtotal)}</b></div>
          {['placed','processing'].includes(order.orderStatus)&&order.paymentMethod==='Cash on Delivery'&&order.paymentStatus==='pending'&&<button className="outline-btn profile-cancel-order" type="button" disabled={cancellingOrder===order.id} onClick={()=>cancelOrder(order)}><XCircle size={14}/>{cancellingOrder===order.id?'CANCELLING…':'CANCEL ORDER'}</button>}
          {['placed','processing'].includes(order.orderStatus)&&order.paymentMethod!=='Cash on Delivery'&&<p className="profile-cancel-note">Contact the store to request cancellation of an online-payment order.</p>}
        </article>)}
      </section>
    </main>
  </div>;
}
