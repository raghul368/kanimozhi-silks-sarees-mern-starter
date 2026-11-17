import React, { useEffect, useState } from 'react';
import { ArrowLeft, CreditCard, ShieldCheck, Truck, CheckCircle2 } from 'lucide-react';
import { apiUrl } from './api.js';
const currency = amount => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
}).format(amount);

const loadRazorpay = () => new Promise((resolve, reject) => {
  if (window.Razorpay) {
    resolve();
    return;
  }
  const existing = document.querySelector('script[data-razorpay-checkout]');
  if (existing) {
    existing.addEventListener('load', resolve, { once: true });
    existing.addEventListener('error', () => reject(new Error('Unable to load secure checkout. Please try again.')), { once: true });
    return;
  }
  const script = document.createElement('script');
  script.src = 'https://checkout.razorpay.com/v1/checkout.js';
  script.async = true;
  script.dataset.razorpayCheckout = 'true';
  script.onload = () => resolve();
  script.onerror = () => reject(new Error('Unable to load secure checkout. Please try again.'));
  document.body.appendChild(script);
});

export default function Checkout({ cart, total, customer, onBack, onDone, onProfile }) {
  const [form, setForm] = useState({
    name: customer?.name || '',
    email: customer?.email || '',
    phone: '',
    address: '',
    city: '',
    state: '',
    postal: '',
    payment: 'online',
  });
  const [pricedCart, setPricedCart] = useState(cart);
  const [pricedTotal, setPricedTotal] = useState(total);
  const [refreshingPrices, setRefreshingPrices] = useState(true);
  const [onlinePaymentsEnabled, setOnlinePaymentsEnabled] = useState(null);
  const [paymentConfigError, setPaymentConfigError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [completedOrder, setCompletedOrder] = useState(null);
  const [completedOnline, setCompletedOnline] = useState(false);
  const [completedEmailSent, setCompletedEmailSent] = useState(null);

  const update = (key, value) => setForm(previous => ({ ...previous, [key]: value }));
  const applyPriceUpdate = (items, subtotal) => {
    const updatedItems = new Map(items.map(item => [
      item.productId || item.id,
      { name: item.name, price: item.unitPrice ?? item.price, ...(item.image ? { image: item.image } : {}) },
    ]));
    setPricedCart(cart.map(item => ({ ...item, ...updatedItems.get(item.id) })));
    setPricedTotal(subtotal);
  };

  useEffect(() => {
    let active = true;
    fetch(`${apiUrl}/payments/config`)
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Unable to check online payment availability.');
        return result;
      })
      .then(config => {
        if (active) setOnlinePaymentsEnabled(config.onlinePaymentsEnabled === true);
      })
      .catch(error => {
        if (active) {
          setOnlinePaymentsEnabled(false);
          setPaymentConfigError(error.message || 'Unable to check online payment availability.');
        }
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const refreshPrices = async () => {
      setRefreshingPrices(true);
      try {
        const response = await fetch(`${apiUrl}/products`);
        const products = await response.json();
        if (!response.ok) throw new Error(products.message || 'Unable to refresh product prices.');
        const byId = new Map(products.map(product => [product.id, product]));
        const latestCart = cart.map(item => {
          const current = byId.get(item.id);
          return current ? { ...item, name: current.name, price: current.price, image: current.image } : item;
        });
        if (active) {
          setPricedCart(latestCart);
          setPricedTotal(latestCart.reduce((sum, item) => sum + item.price * item.qty, 0));
          setMessage('');
        }
      } catch (error) {
        if (active) setMessage(error.message || 'Unable to refresh product prices.');
      } finally {
        if (active) setRefreshingPrices(false);
      }
    };
    refreshPrices();
    return () => { active = false; };
  }, [cart]);

  const submit = async event => {
    event.preventDefault();
    if (!cart.length) {
      setMessage('Your bag is empty. Add a saree before checking out.');
      return;
    }
    setBusy(true);
    setMessage('');
    const orderBody = {
      delivery: form,
      items: cart.map(item => ({ id: item.id, quantity: item.qty })),
      expectedTotal: pricedTotal,
    };
    try {
      if (form.payment === 'cod') {
        const response = await fetch(`${apiUrl}/orders/cod`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(orderBody),
        });
        const result = await response.json();
        if (!response.ok) {
          if (response.status === 409 && Array.isArray(result.items)) applyPriceUpdate(result.items, result.subtotal);
          throw new Error(result.message || 'Unable to place your order.');
        }
        setCompletedOrder(result.order);
        setCompletedOnline(false);
        setCompletedEmailSent(result.emailSent===true?true:result.emailSent===false?false:null);
        return;
      }

      const response = await fetch(`${apiUrl}/payments/razorpay/order`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderBody),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409 && Array.isArray(result.items)) applyPriceUpdate(result.items, result.subtotal);
        throw new Error(result.message || 'Unable to start online payment.');
      }

      await loadRazorpay();
      const checkout = new window.Razorpay({
        key: result.keyId,
        amount: result.amount,
        currency: result.currency,
        name: 'Kanimozhi Silks & Sarees',
        description: 'Silk saree order',
        order_id: result.orderId,
        prefill: { name: form.name, email: form.email, contact: form.phone },
        theme: { color: '#451521' },
        handler: async payment => {
          setBusy(true);
          setMessage('');
          try {
            const verifyResponse = await fetch(`${apiUrl}/payments/razorpay/verify`, {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payment),
            });
            const verified = await verifyResponse.json();
            if (!verifyResponse.ok) throw new Error(verified.message || 'Unable to verify payment.');
            setCompletedOrder(verified.order);
            setCompletedOnline(true);
            setCompletedEmailSent(verified.emailSent===true?true:verified.emailSent===false?false:null);
          } catch (error) {
            setMessage(error.message || 'Unable to verify payment. Please contact the store with your payment reference.');
          } finally {
            setBusy(false);
          }
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      checkout.on('payment.failed', result => {
        setMessage(result.error?.description || 'Payment was not completed. You can try again.');
        setBusy(false);
      });
      checkout.open();
      setBusy(false);
    } catch (error) {
      setMessage(error.message || 'Unable to place your order. Please try again.');
      setBusy(false);
    }
  };

  if (completedOrder) {
    return <div className="checkout-page">
      <header className="checkout-top"><span className="brand-mark">K</span><b>KANIMOZHI <small>SILKS & SAREES</small></b></header>
      <main className="checkout-complete">
        <CheckCircle2 size={42}/>
        <div className="eyebrow">ORDER CONFIRMED</div>
        <h1>Thank you, <em>{form.name.split(' ')[0]}.</em></h1>
        <p>{completedOnline ? 'Your payment was verified and your order is confirmed.' : 'Your order is confirmed. Payment will be collected on delivery.'}</p>
        {completedEmailSent===false&&<p className="checkout-email-warning" role="status">We could not send your confirmation email. Please save your order reference; contact <a href="mailto:kanimozhisilkss@gmail.com">kanimozhisilkss@gmail.com</a> if you need help.</p>}
        <div className="checkout-order-reference"><span>Order reference</span><b>{completedOrder.id}</b></div>
        <p className="checkout-complete-total">Order total <b>{currency(completedOrder.subtotal)}</b></p>
        <div className="checkout-complete-actions">
          <button className="outline-btn" type="button" onClick={onProfile}>VIEW MY ORDERS</button>
          <button className="gold-btn" type="button" onClick={() => onDone(completedOrder)}>CONTINUE SHOPPING</button>
        </div>
      </main>
    </div>;
  }

  return <div className="checkout-page">
    <button className="text-link" type="button" onClick={onBack}><ArrowLeft size={15}/> BACK TO BAG</button>
    <div className="checkout-heading"><div className="eyebrow">A LITTLE MORE TO MAKE IT YOURS</div><h1>Complete your <em>order.</em></h1></div>
    <div className="checkout-grid">
      <form className="checkout-form" onSubmit={submit}>
        <h2>Delivery details</h2>
        <div className="checkout-fields">
          <label>Full name<input autoComplete="name" required maxLength="100" value={form.name} onChange={event => update('name', event.target.value)}/></label>
          <label>Account email<input type="email" autoComplete="email" value={form.email} readOnly/></label>
          <label>Mobile number<input autoComplete="tel-national" required inputMode="numeric" minLength="10" maxLength="10" pattern="[6-9][0-9]{9}" value={form.phone} onChange={event => update('phone', event.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10-digit Indian number"/></label>
          <label className="wide">Street address<textarea autoComplete="street-address" required maxLength="300" value={form.address} onChange={event => update('address', event.target.value)} placeholder="House number, street, landmark"/></label>
          <label>City<input autoComplete="address-level2" required maxLength="100" value={form.city} onChange={event => update('city', event.target.value)}/></label>
          <label>State<input autoComplete="address-level1" required maxLength="100" value={form.state} onChange={event => update('state', event.target.value)}/></label>
          <label>PIN code<input autoComplete="postal-code" required inputMode="numeric" minLength="6" maxLength="6" pattern="[0-9]{6}" value={form.postal} onChange={event => update('postal', event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit PIN code"/></label>
        </div>
        <h2>Payment</h2>
        <div className="payment-options">
          <label className={`${form.payment === 'online' ? 'chosen' : ''} ${onlinePaymentsEnabled === false ? 'payment-unavailable' : ''}`}><input type="radio" name="payment" value="online" checked={form.payment === 'online'} disabled={onlinePaymentsEnabled !== true} onChange={() => update('payment', 'online')}/><span><b>Pay online{onlinePaymentsEnabled === false ? ' · unavailable' : ''}</b><small>UPI, cards, net banking & wallets</small></span></label>
          <label className={form.payment === 'cod' ? 'chosen' : ''}><input type="radio" name="payment" value="cod" checked={form.payment === 'cod'} onChange={() => update('payment', 'cod')}/><span><b>Cash on delivery</b><small>Pay when your order arrives</small></span></label>
        </div>
        {paymentConfigError&&<p className="checkout-message" role="alert">{paymentConfigError}</p>}
        {onlinePaymentsEnabled === false&&!paymentConfigError&&<p className="checkout-message" role="status">Online payments are not enabled yet. Configure Razorpay keys in backend/.env and restart the backend to accept UPI, card, net banking, and wallet payments. You can still place a Cash on Delivery order.</p>}
        {message && <p className="checkout-message" role="alert">{message}</p>}
        <button className="gold-btn checkout-submit" type="submit" disabled={busy||refreshingPrices||(form.payment==='online'&&onlinePaymentsEnabled!==true)}>
          <CreditCard size={16}/>{busy||refreshingPrices||onlinePaymentsEnabled===null ? 'PLEASE WAIT…' : form.payment === 'online' ? `PAY ${currency(pricedTotal)} SECURELY` : `PLACE COD ORDER · ${currency(pricedTotal)}`}
        </button>
        <p className="checkout-security"><ShieldCheck size={15}/> Online payments are securely processed by Razorpay. Your account email is used for order updates.</p>
      </form>
      <aside className="order-summary">
        <h2>Your order</h2>
        {pricedCart.map(item => <div className="summary-item" key={item.id}><img src={item.image} alt={item.name}/><span>{item.name}<small>Qty: {item.qty}</small></span><b>{currency(item.price * item.qty)}</b></div>)}
        <div className="summary-total"><span>Total{refreshingPrices?' · updating':''}</span><b>{currency(pricedTotal)}</b></div>
        <p><ShieldCheck size={15}/> The server confirms current product prices before accepting payment.</p>
        <p><Truck size={15}/> Delivery is available to addresses in India.</p>
      </aside>
    </div>
  </div>;
}
