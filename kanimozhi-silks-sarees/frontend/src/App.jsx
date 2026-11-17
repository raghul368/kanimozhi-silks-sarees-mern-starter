import React, { useEffect, useMemo, useState } from 'react';
import Auth from './Auth.jsx';
import Admin from './Admin.jsx';
import Checkout from './Checkout.jsx';
import Profile from './Profile.jsx';
import VirtualTryOn from './VirtualTryOn.jsx';
import { apiUrl } from './api.js';
import { Search, ShoppingBag, Heart, Menu, X, ArrowRight, ChevronDown, Instagram, MessageCircle, Plus, Minus, Trash2, Sparkles, ShieldCheck, Truck, Gem, MapPin } from 'lucide-react';
import { categories } from './data';

const money = n => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n);
const fallbackProductImage = 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=900&q=85';
const softSilkFallbackImage = 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/Koorai_silk_saree_6.jpg/960px-Koorai_silk_saree_6.jpg';
const handleImageError = event => {
  event.currentTarget.onerror = null;
  event.currentTarget.src = fallbackProductImage;
};
const readStoredList = key => {
  try {
    const stored=JSON.parse(window.localStorage.getItem(key)||'[]');
    return Array.isArray(stored)?stored:[];
  } catch(error) {
    console.error(`Unable to read ${key} from local storage:`,error);
    return [];
  }
};

function App(){
  const [products,setProducts] = useState([]);
  const [category,setCategory] = useState('All Sarees');
  const [query,setQuery] = useState('');
  const [cart,setCart] = useState(()=>readStoredList('kanimozhi-cart'));
  const [wishlist,setWishlist] = useState(()=>readStoredList('kanimozhi-wishlist'));
  const [cartOpen,setCartOpen] = useState(false);
  const [wishlistOpen,setWishlistOpen] = useState(false);
  const [selectedProduct,setSelectedProduct] = useState(null);
  const [activePolicy,setActivePolicy] = useState('');
  const [menuOpen,setMenuOpen] = useState(false);
  const [searchOpen,setSearchOpen] = useState(false);
  const [notice,setNotice] = useState('');
  const [email,setEmail] = useState('');
  const [newsletterMessage,setNewsletterMessage] = useState('');
  const [newsletterBusy,setNewsletterBusy] = useState(false);
  const [checkoutOpen,setCheckoutOpen] = useState(false);
  const [checkoutAfterLogin,setCheckoutAfterLogin] = useState(false);
  const [profileOpen,setProfileOpen] = useState(()=>window.location.pathname.replace(/\/+$/,'')==='/profile');
  const [adminOpen,setAdminOpen] = useState(()=>window.location.pathname.replace(/\/+$/,'')==='/admin');
  const [adminToken,setAdminToken] = useState('');
  const [loginOpen,setLoginOpen] = useState(()=>window.location.pathname.replace(/\/+$/,'')==='/login');
  const [customer,setCustomer] = useState(null);
  const [customerSessionLoading,setCustomerSessionLoading] = useState(true);
  const [productError,setProductError] = useState('');

  useEffect(()=>{
    const syncPage=()=>{
      const path=window.location.pathname.replace(/\/+$/,'');
      setLoginOpen(path==='/login');
      setProfileOpen(path==='/profile');
      setAdminOpen(path==='/admin');
    };
    window.addEventListener('popstate',syncPage);
    return ()=>window.removeEventListener('popstate',syncPage);
  },[]);
  useEffect(()=>{
    try{
      window.localStorage.removeItem('kanimozhi-bank-statement-history-v1');
    }catch(error){
      console.error('Unable to remove obsolete bank statement history from this browser:',error);
    }
  },[]);
  useEffect(()=>{
    let active=true;
    const refreshProducts=async()=>{
      try{
        const response=await fetch(`${apiUrl}/products`);
        if(!response.ok)throw new Error('Unable to refresh the product catalogue.');
        const data=await response.json();
        if(active&&Array.isArray(data)){
          setProducts(data);
          setProductError('');
        }
      }catch(error){
        if(active){
          setProducts([]);
          setProductError(error.message||'Unable to refresh the product catalogue.');
        }
      }
    };
    refreshProducts();
    const interval=window.setInterval(refreshProducts,15000);
    window.addEventListener('focus',refreshProducts);
    return ()=>{
      active=false;
      window.clearInterval(interval);
      window.removeEventListener('focus',refreshProducts);
    };
  },[]);
  useEffect(()=>{
    let active=true;
    fetch(`${apiUrl}/auth/session`,{credentials:'include'})
      .then(async response=>{
        if(response.status === 401) return null;
        if(!response.ok) throw new Error('Unable to check customer session.');
        return response.json();
      })
      .then(result=>{
        if(!active)return;
        if(result?.customer)setCustomer(result.customer);
        else if(window.location.pathname.replace(/\/+$/,'')==='/profile'){
          window.history.replaceState({},'','/login');
          setProfileOpen(false);
          setLoginOpen(true);
        }
      })
      .catch(()=>{
        if(active&&window.location.pathname.replace(/\/+$/,'')==='/profile'){
          window.history.replaceState({},'','/login');
          setProfileOpen(false);
          setLoginOpen(true);
        }
      })
      .finally(()=>{if(active)setCustomerSessionLoading(false)});
    return ()=>{active=false;};
  },[]);
  useEffect(()=>{
    if(!adminToken)return;
    let active=true;
    const checkSession=async()=>{
      try{
        const response=await fetch(`${apiUrl}/admin/session`,{headers:{Authorization:`Bearer ${adminToken}`}});
        if(!response.ok&&active)setAdminToken('');
      }catch{
        if(active)setAdminToken('');
      }
    };
    checkSession();
    const interval=window.setInterval(checkSession,60*1000);
    return ()=>{active=false;window.clearInterval(interval)};
  },[adminToken]);
  useEffect(()=>{ if(!notice)return; const t=setTimeout(()=>setNotice(''),2400); return ()=>clearTimeout(t); },[notice]);
  useEffect(()=>{
    try{
      window.localStorage.setItem('kanimozhi-cart',JSON.stringify(cart));
    }catch(error){
      console.error('Unable to persist the shopping bag:',error);
      setNotice('Your bag could not be saved on this device.');
    }
  },[cart]);
  useEffect(()=>{
    try{
      window.localStorage.setItem('kanimozhi-wishlist',JSON.stringify(wishlist));
    }catch(error){
      console.error('Unable to persist the wishlist:',error);
      setNotice('Your wishlist could not be saved on this device.');
    }
  },[wishlist]);

  const visible = useMemo(()=>products.filter(p=>(category==='All Sarees'||p.category===category) && (p.name.toLowerCase().includes(query.toLowerCase())||p.category.toLowerCase().includes(query.toLowerCase())||String(p.color||'').toLowerCase().includes(query.toLowerCase()))),[products,category,query]);
  const wishedProducts=products.filter(product=>wishlist.includes(product.id));
  const softSilkCollectionImage=products.find(product=>product.category==='Soft Silk')?.image||softSilkFallbackImage;
  const count = cart.reduce((n,item)=>n+item.qty,0);
  const total = cart.reduce((n,item)=>n+item.price*item.qty,0);
  const add = p => {setCart(old=>{const found=old.find(x=>x.id===p.id);return found?old.map(x=>x.id===p.id?{...x,qty:x.qty+1}:x):[...old,{...p,qty:1}]});setNotice(`${p.name} added to your bag`);};
  const changeQty=(id,delta)=>setCart(old=>old.map(x=>x.id===id?{...x,qty:x.qty+delta}:x).filter(x=>x.qty>0));
  const toggleWish=id=>setWishlist(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id]);
  const subscribe=async event=>{
    event.preventDefault();
    setNewsletterBusy(true);
    setNewsletterMessage('');
    try{
      const response=await fetch(`${apiUrl}/newsletter`,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({email}),
      });
      const result=await response.json();
      if(!response.ok)throw new Error(result.message||'Unable to subscribe right now.');
      setNewsletterMessage(result.emailSent===false
        ?`${result.message} Your signup is saved, but the welcome email could not be sent.`
        :result.message);
      setEmail('');
    }catch(error){
      setNewsletterMessage(error.message||'Unable to subscribe right now. Please try again.');
    }finally{
      setNewsletterBusy(false);
    }
  };
  const openCustomerLogin=()=>{
    setProfileOpen(false);
    if(window.location.pathname.replace(/\/+$/,'')!=='/login')window.history.pushState({},'','/login');
    setLoginOpen(true);
  };
  const closeCustomerLogin=()=>{
    if(window.location.pathname.replace(/\/+$/,'')==='/login')window.history.pushState({},'','/');
    setLoginOpen(false);
    setCheckoutAfterLogin(false);
  };
  const completeCustomerLogin=result=>{
    setCustomer(result);
    if(window.location.pathname.replace(/\/+$/,'')==='/login')window.history.replaceState({},'','/');
    setLoginOpen(false);
    if(checkoutAfterLogin){
      setCheckoutAfterLogin(false);
      setCheckoutOpen(true);
    }
  };
  const openProfile=()=>{
    if(!customer)return openCustomerLogin();
    if(window.location.pathname.replace(/\/+$/,'')!=='/profile')window.history.pushState({},'','/profile');
    setProfileOpen(true);
  };
  const closeProfile=()=>{
    if(window.location.pathname.replace(/\/+$/,'')==='/profile')window.history.pushState({},'','/');
    setProfileOpen(false);
  };
  const openAdmin=()=>{
    setLoginOpen(false);
    setProfileOpen(false);
    if(window.location.pathname.replace(/\/+$/,'')!=='/admin')window.history.pushState({},'','/admin');
    setAdminOpen(true);
  };
  const closeAdmin=()=>{
    if(window.location.pathname.replace(/\/+$/,'')==='/admin')window.history.pushState({},'','/');
    setAdminOpen(false);
    window.dispatchEvent(new Event('focus'));
  };
  const beginCheckout=()=>{
    if(customerSessionLoading){
      setNotice('Checking your account. Please try again in a moment.');
      return;
    }
    if(!customer){
      setCheckoutAfterLogin(true);
      openCustomerLogin();
      return;
    }
    setCheckoutOpen(true);
  };
  if(adminOpen) return <Admin token={adminToken} onSignIn={setAdminToken} onSignOut={()=>setAdminToken('')} onClose={closeAdmin}/>;
  if(loginOpen) return <Auth onSuccess={completeCustomerLogin} onClose={closeCustomerLogin}/>;
  if(profileOpen&&customer) return <Profile customer={customer} onBack={closeProfile} onSignOut={()=>{setCustomer(null);setProfileOpen(false);window.history.replaceState({},'','/');setNotice('You have signed out.')}}/>;
  if(checkoutOpen) return <Checkout cart={cart} total={total} customer={customer} onBack={()=>setCheckoutOpen(false)} onDone={()=>{setCheckoutOpen(false);setCart([]);setNotice('Your order has been placed.')}} onProfile={()=>{setCheckoutOpen(false);openProfile()}}/>;
  return <div className="site">
    <div className="announcement">A LITTLE LUXURY, WOVEN INTO EVERY THREAD <span>✦</span> DELIVERY WITHIN 3 DAYS</div>
    <header className="header">
      <button className="icon-btn mobile-menu" onClick={()=>setMenuOpen(!menuOpen)} aria-label="Toggle menu">{menuOpen?<X/>:<Menu/>}</button>
      <nav className={`nav left-nav ${menuOpen?'show':''}`}><a href="#home" onClick={()=>setMenuOpen(false)}>Home</a><a href="#shop" onClick={()=>setMenuOpen(false)}>Shop all</a><a href="#collections" onClick={()=>setMenuOpen(false)}>Collections <ChevronDown size={13}/></a><a href="#try-on" onClick={()=>setMenuOpen(false)}>AI Try-On</a><button className="admin-link mobile-admin-entry" onClick={()=>{customer?openProfile():openCustomerLogin();setMenuOpen(false)}}>{customer?'My account':'Sign in'}</button></nav>
      <a className="brand" href="#home"><span className="brand-mark">K</span><span className="brand-name">KANIMOZHI<small>SILKS & SAREES</small></span></a>
      <nav className="nav right-nav"><a href="#story">Our story</a><a href="#contact">Contact</a><button className="admin-link" onClick={()=>customer?openProfile():openCustomerLogin()}>{customer?'My account':'Sign in'}</button></nav>
      <div className="header-actions">
        <button className="icon-btn" onClick={()=>setSearchOpen(!searchOpen)} aria-label="Search"><Search/></button>
        <button className="icon-btn wishlist-head" onClick={()=>setWishlistOpen(true)} aria-label="Open wishlist"><Heart/><i>{wishedProducts.length}</i></button>
        <button className="icon-btn bag-btn" onClick={()=>setCartOpen(true)} aria-label="Shopping bag"><ShoppingBag/><i>{count}</i></button>
      </div>
    </header>
    {searchOpen&&<div className="searchbar"><Search size={18}/><input autoFocus placeholder="Search sarees, colours, collections..." value={query} onChange={e=>{setQuery(e.target.value);document.getElementById('shop')?.scrollIntoView({behavior:'smooth'})}}/><button onClick={()=>{setSearchOpen(false);setQuery('')}}><X/></button></div>}

    <main>
      <section className="hero" id="home">
        <div className="hero-image"></div><div className="hero-overlay"></div>
        <div className="hero-content"><div className="eyebrow light"><span></span> THE HERITAGE COLLECTION <span></span></div>
          <h1>Elegance that<br/><em>becomes</em> a legacy.</h1>
          <p>Discover the beauty of handpicked silk sarees, where every weave tells a story and every drape becomes a memory.</p>
          <a className="gold-btn" href="#shop">EXPLORE THE COLLECTION <ArrowRight size={16}/></a>
          <div className="hero-note">TIMELESS WEAVES. TREASURED FOREVER.</div>
        </div>
        <div className="hero-index"><b>01</b><span></span> 03</div>
      </section>

      <section className="promise-strip">
        <div><Gem/><span><b>Timeless craftsmanship</b><small>Tradition in every thread</small></span></div>
        <div><ShieldCheck/><span><b>Curated with care</b><small>Handpicked collections</small></span></div>
        <div><Truck/><span><b>Thoughtful delivery</b><small>Within 3 days</small></span></div>
      </section>

      <section className="intro section-pad" id="story"><div className="eyebrow"><span></span> A LEGACY OF GRACE <span></span></div><h2>Some stories are woven.<br/><em>Ours are worn.</em></h2><p>At Kanimozhi, we celebrate the artistry of Indian silk sarees. From cherished wedding heirlooms to graceful festive drapes, find a piece that feels beautifully yours.</p><a className="text-link" href="#shop">DISCOVER OUR STORY <ArrowRight size={15}/></a></section>

      <section className="collections section-pad" id="collections"><div className="section-heading"><div><div className="eyebrow"><span></span> SHOP BY MOOD <span></span></div><h2>Curated <em>collections</em></h2></div><a className="text-link" href="#shop">VIEW ALL <ArrowRight size={15}/></a></div>
        <div className="collection-grid">
          <a className="collection-card collection-large" href="#shop" onClick={()=>setCategory('Bridal')}><img src="https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?auto=format&fit=crop&w=1000&q=85" onError={handleImageError} alt="Bridal silk saree"/><span className="collection-shade"></span><div><small>FOR YOUR FOREVER MOMENT</small><h3>The Bridal Edit</h3><b>EXPLORE <ArrowRight size={14}/></b></div></a>
          <a className="collection-card" href="#shop" onClick={()=>setCategory('Kanchipuram')}><img src="https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=850&q=85" onError={handleImageError} alt="Kanchipuram silk saree"/><span className="collection-shade"></span><div><small>TIMELESS BY NATURE</small><h3>Kanchipuram Classics</h3><b>EXPLORE <ArrowRight size={14}/></b></div></a>
          <a className="collection-card" href="#shop" onClick={()=>setCategory('Soft Silk')}><img src={softSilkCollectionImage} onError={event=>{event.currentTarget.onerror=null;event.currentTarget.src=softSilkFallbackImage}} alt="Soft silk saree"/><span className="collection-shade"></span><div><small>EVERYDAY, ELEVATED</small><h3>Soft Silk Stories</h3><b>EXPLORE <ArrowRight size={14}/></b></div></a>
        </div>
      </section>

      <VirtualTryOn/>

      <section className="shop section-pad" id="shop"><div className="section-heading"><div><div className="eyebrow"><span></span> THE KANIMOZHI SELECTION <span></span></div><h2>Pieces to <em>treasure</em></h2></div><span className="product-count">{visible.length} BEAUTIFUL FINDS</span></div>
        {productError&&<p className="catalog-error" role="status">{productError} Retrying automatically.</p>}
        <div className="shop-controls"><div className="category-tabs">{categories.map(c=><button key={c} className={category===c?'active':''} onClick={()=>setCategory(c)}>{c}</button>)}</div><div className="inline-search"><Search size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Find your saree"/></div></div>
        <div className="product-grid">{visible.map(p=><article className="product-card" key={p.id}><div className="product-image"><img src={p.image} alt={p.name} onError={handleImageError}/><span className="product-tag">{p.tag}</span><button className={`wish-btn ${wishlist.includes(p.id)?'selected':''}`} onClick={()=>toggleWish(p.id)} aria-label="Toggle wishlist"><Heart size={18} fill={wishlist.includes(p.id)?'currentColor':'none'}/></button><button className="quick-add" onClick={()=>add(p)}>ADD TO BAG <Plus size={15}/></button></div><div className="product-info"><div className="product-category">{p.category} · {p.color}</div><button className="product-detail-link" type="button" onClick={()=>setSelectedProduct(p)}>{p.name}</button><div className="price">{money(p.price)} {p.oldPrice&&<del>{money(p.oldPrice)}</del>}</div>{p.imageCredit&&<div className="image-credit">Image: <a href={p.imageCredit.page} target="_blank" rel="noreferrer">{p.imageCredit.artist}</a> · <a href={p.imageCredit.licenseUrl} target="_blank" rel="noreferrer">{p.imageCredit.license}</a></div>}</div></article>)}</div>
        {visible.length===0&&<div className="empty-state">No sarees found. Try another search or collection.</div>}
        <div className="center"><a className="outline-btn" href="#shop" onClick={()=>{setCategory('All Sarees');setQuery('')}}>EXPLORE ALL SAREES <ArrowRight size={15}/></a></div>
      </section>

      <section className="quote-banner"><div className="quote-bg"></div><div className="quote-content"><div className="eyebrow light"><span></span> WOVEN WITH LOVE <span></span></div><h2>“A saree is not just<br/>an outfit. It is <em>an emotion.</em>”</h2><p>Celebrate the beauty of every occasion with Kanimozhi Silks.</p><a className="gold-btn" href="#shop">FIND YOUR FOREVER SAREE <ArrowRight size={16}/></a></div></section>

      <section className="newsletter section-pad"><div className="eyebrow"><span></span> A NOTE FROM US <span></span></div><h2>Beautiful things, <em>delivered.</em></h2><p>Be the first to discover new arrivals, exclusive edits and stories from the world of silk.</p><form onSubmit={subscribe}><input type="email" placeholder="Your email address" value={email} onChange={e=>setEmail(e.target.value)} required disabled={newsletterBusy}/><button type="submit" disabled={newsletterBusy}>{newsletterBusy?'JOINING…':'JOIN THE LIST'} <ArrowRight size={15}/></button></form><small>By subscribing, you agree to receive updates from Kanimozhi Silks.</small>{newsletterMessage&&<p className="newsletter-message" role="status">{newsletterMessage}</p>}</section>
    </main>

    <footer id="contact"><div className="footer-main"><div className="footer-brand"><a className="brand footer-logo" href="#home"><span className="brand-mark">K</span><span className="brand-name">KANIMOZHI<small>SILKS & SAREES</small></span></a><p>Tradition, thoughtfully draped.<br/>A celebration of timeless Indian elegance.</p><div className="socials"><a href="https://www.instagram.com/kanimozhisilks_arulprakasam?dlrf=OTNyZ3Fkd2QwMDVz" target="_blank" rel="noreferrer" aria-label="Instagram"><Instagram/></a><a href="https://wa.me/919965180542" target="_blank" rel="noreferrer" aria-label="WhatsApp"><MessageCircle/></a></div></div><div><h4>EXPLORE</h4><a href="#shop">Shop all sarees</a><a href="#collections">Our collections</a><a href="#story">Our story</a></div><div><h4>WE'RE HERE TO HELP</h4><button type="button" className="footer-policy-button" onClick={()=>setActivePolicy('shipping')}>Shipping information</button><button type="button" className="footer-policy-button" onClick={()=>setActivePolicy('returns')}>Returns policy</button><button type="button" className="footer-policy-button" onClick={()=>setActivePolicy('faqs')}>FAQs</button><button type="button" className="footer-policy-button" onClick={()=>setActivePolicy('privacy')}>Privacy</button></div><div><h4>GET IN TOUCH</h4><p>We would love to hear from you.</p><a href="mailto:kanimozhisilkss@gmail.com">kanimozhisilkss@gmail.com</a><a href="tel:+919965180542">+91 99651 80542</a><p className="footer-address"><MapPin size={14}/>83, North Mada Street, Nedungunam Village & Post, Chetpet Taluk, Thiruvannamalai, Tamil Nadu, 606807</p><button type="button" className="store-admin-link" onClick={openAdmin}>Store admin sign-in</button></div></div><div className="footer-policies"><section id="shipping-policy"><h4>SHIPPING</h4><p>Orders are delivered within 3 days.</p></section><section id="returns-policy"><h4>RETURNS</h4><p>We do not accept returns.</p></section><section id="faqs"><h4>FREQUENTLY ASKED QUESTIONS</h4><p><b>How can I ask about an order?</b> Email or call us using the contact details above.</p><p><b>When will my order arrive?</b> Within 3 days.</p></section><section id="privacy-policy"><h4>PRIVACY</h4><p>Checkout details are used to process your order and contact you about it. Newsletter email addresses are kept for store updates. Contact us with privacy questions.</p></section></div><div className="footer-bottom"><span>© 2026 KANIMOZHI SILKS SAREES. ALL RIGHTS RESERVED.</span><span>MADE WITH ♥ FOR THE LOVE OF SILK</span></div></footer>

    {cartOpen&&<div className="drawer-backdrop" onClick={()=>setCartOpen(false)}><aside className="cart-drawer" onClick={e=>e.stopPropagation()}><div className="drawer-head"><div><small>YOUR SELECTION</small><h3>Shopping bag ({count})</h3></div><button className="icon-btn" onClick={()=>setCartOpen(false)}><X/></button></div>{cart.length===0?<div className="cart-empty"><ShoppingBag size={38}/><h3>Your bag is waiting</h3><p>Discover a saree that speaks to you.</p><button className="gold-btn" onClick={()=>setCartOpen(false)}>CONTINUE SHOPPING</button></div>:<><div className="cart-items">{cart.map(item=><div className="cart-item" key={item.id}><img src={item.image} alt={item.name} onError={handleImageError}/><div className="cart-item-info"><h4>{item.name}</h4><b>{money(item.price)}</b><div className="qty"><button onClick={()=>changeQty(item.id,-1)}><Minus size={13}/></button><span>{item.qty}</span><button onClick={()=>changeQty(item.id,1)}><Plus size={13}/></button><button className="remove" onClick={()=>setCart(old=>old.filter(x=>x.id!==item.id))}><Trash2 size={14}/></button></div></div></div>)}</div><div className="cart-summary"><div><span>Subtotal</span><b>{money(total)}</b></div><small>Shipping details are confirmed at checkout.</small><button className="gold-btn full" onClick={()=>{setCartOpen(false);beginCheckout()}}>PROCEED TO CHECKOUT <ArrowRight size={16}/></button></div></>}</aside></div>}

    {wishlistOpen&&<div className="drawer-backdrop" onClick={()=>setWishlistOpen(false)}><aside className="cart-drawer wishlist-drawer" role="dialog" aria-modal="true" aria-label="Your wishlist" onClick={event=>event.stopPropagation()}><div className="drawer-head"><div><small>SAVED FOR LATER</small><h3>Your wishlist ({wishedProducts.length})</h3></div><button className="icon-btn" onClick={()=>setWishlistOpen(false)} aria-label="Close wishlist"><X/></button></div>{wishedProducts.length===0?<div className="cart-empty"><Heart size={38}/><h3>Your wishlist is empty</h3><p>Tap the heart on a saree to save it here.</p><button className="gold-btn" onClick={()=>setWishlistOpen(false)}>CONTINUE SHOPPING</button></div>:<div className="cart-items">{wishedProducts.map(item=><div className="cart-item" key={item.id}><img src={item.image} alt={item.name} onError={handleImageError}/><div className="cart-item-info"><h4>{item.name}</h4><b>{money(item.price)}</b><div className="wishlist-actions"><button className="outline-btn" type="button" onClick={()=>{add(item);setWishlistOpen(false)}}>ADD TO BAG</button><button className="remove-wish" type="button" onClick={()=>toggleWish(item.id)}>REMOVE</button></div></div></div>)}</div>}</aside></div>}

    {selectedProduct&&<div className="dialog-backdrop" onClick={()=>setSelectedProduct(null)}><section className="product-dialog" role="dialog" aria-modal="true" aria-label={`${selectedProduct.name} details`} onClick={event=>event.stopPropagation()}><button className="icon-btn product-dialog-close" type="button" onClick={()=>setSelectedProduct(null)} aria-label="Close product details"><X/></button><img src={selectedProduct.image} alt={selectedProduct.name} onError={handleImageError}/><div className="product-dialog-content"><div className="product-category">{selectedProduct.category} · {selectedProduct.color}</div><h2>{selectedProduct.name}</h2><div className="price">{money(selectedProduct.price)}</div><p>{selectedProduct.description||'Contact us for more details about this saree.'}</p><div className="product-dialog-actions"><button className="gold-btn" type="button" onClick={()=>{add(selectedProduct);setSelectedProduct(null)}}>ADD TO BAG <ShoppingBag size={15}/></button><button className="outline-btn" type="button" onClick={()=>toggleWish(selectedProduct.id)}><Heart size={15} fill={wishlist.includes(selectedProduct.id)?'currentColor':'none'}/>{wishlist.includes(selectedProduct.id)?'SAVED':'SAVE TO WISHLIST'}</button></div></div></section></div>}

    {activePolicy&&<div className="dialog-backdrop" onClick={()=>setActivePolicy('')}><section className="policy-dialog" role="dialog" aria-modal="true" aria-labelledby="policy-dialog-title" onClick={event=>event.stopPropagation()}><button className="icon-btn product-dialog-close" type="button" onClick={()=>setActivePolicy('')} aria-label="Close policy details"><X/></button><div className="eyebrow">STORE INFORMATION</div><h2 id="policy-dialog-title">{activePolicy==='shipping'?'Shipping information':activePolicy==='returns'?'Returns policy':activePolicy==='faqs'?'Frequently asked questions':'Privacy'}</h2>{activePolicy==='shipping'&&<p>Orders are delivered within 3 days. For help with delivery, contact <a href="mailto:kanimozhisilkss@gmail.com">kanimozhisilkss@gmail.com</a> or call <a href="tel:+919965180542">+91 99651 80542</a>.</p>}{activePolicy==='returns'&&<p>We do not accept returns. Please contact us before ordering if you need more information about a saree.</p>}{activePolicy==='faqs'&&<><h3>When will my order arrive?</h3><p>Orders are delivered within 3 days.</p><h3>How can I ask about an order?</h3><p>Email <a href="mailto:kanimozhisilkss@gmail.com">kanimozhisilkss@gmail.com</a> or call <a href="tel:+919965180542">+91 99651 80542</a>.</p></>}{activePolicy==='privacy'&&<p>Checkout details are used to process your order and contact you about it. Newsletter email addresses are kept for store updates. Contact <a href="mailto:kanimozhisilkss@gmail.com">kanimozhisilkss@gmail.com</a> with privacy questions.</p>}</section></div>}

    {notice&&<div className="toast"><Sparkles size={16}/>{notice}</div>}
  </div>
}
export default App;
