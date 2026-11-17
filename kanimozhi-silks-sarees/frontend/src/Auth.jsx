import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, LockKeyhole, LogIn, UserPlus } from 'lucide-react';
import { apiUrl } from './api.js';

export default function Auth({onSuccess,onClose}){
  const [mode,setMode]=useState('login');
  const [form,setForm]=useState({name:'',username:'',email:'',usernameOrEmail:'',password:''});
  const [googleClientId,setGoogleClientId]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const onSuccessRef=useRef(onSuccess);
  onSuccessRef.current=onSuccess;

  const signInWithGoogle=useCallback(async credential=>{
    setBusy(true);
    setMessage('');
    try{
      const response=await fetch(`${apiUrl}/auth/google`,{
        method:'POST',
        credentials:'include',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({credential}),
      });
      const result=await response.json();
      if(!response.ok)throw new Error(result.message||'Google sign-in failed.');
      onSuccessRef.current(result.customer);
    }catch(error){
      setMessage(error.message||'Google sign-in failed. Please try again.');
      setBusy(false);
    }
  },[]);

  useEffect(()=>{
    let active=true;
    fetch(`${apiUrl}/auth/config`)
      .then(response=>{
        if(!response.ok)throw new Error('Unable to load Google sign-in settings.');
        return response.json();
      })
      .then(config=>{
        if(active)setGoogleClientId(config.googleClientId||'');
      })
      .catch(error=>{if(active)setMessage(error.message);});
    return ()=>{active=false;};
  },[]);

  useEffect(()=>{
    if(!googleClientId)return undefined;
    let active=true;
    const initialize=()=>{
      if(!active||!window.google?.accounts?.id)return;
      const container=document.getElementById('google-signin-button');
      if(!container)return;
      container.replaceChildren();
      window.google.accounts.id.initialize({
        client_id:googleClientId,
        callback:response=>signInWithGoogle(response.credential),
      });
      window.google.accounts.id.renderButton(container,{
        theme:'outline',
        size:'large',
        shape:'rectangular',
        text:'continue_with',
        width:320,
      });
    };
    const existingScript=document.getElementById('google-identity-services');
    if(window.google?.accounts?.id){
      initialize();
    }else if(existingScript){
      existingScript.addEventListener('load',initialize);
    }else{
      const script=document.createElement('script');
      script.id='google-identity-services';
      script.src='https://accounts.google.com/gsi/client';
      script.async=true;
      script.defer=true;
      script.onload=initialize;
      script.onerror=()=>{if(active)setMessage('Unable to load Google sign-in. Please use your username and password.');};
      document.head.appendChild(script);
    }
    return ()=>{
      active=false;
      existingScript?.removeEventListener('load',initialize);
    };
  },[googleClientId,signInWithGoogle]);

  const submit=async event=>{
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const isRegister=mode==='register';
    try{
      const response=await fetch(`${apiUrl}/auth/${isRegister?'register':'login'}`,{
        method:'POST',
        credentials:'include',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(isRegister?form:{usernameOrEmail:form.usernameOrEmail,password:form.password}),
      });
      const result=await response.json();
      if(!response.ok)throw new Error(result.message||'Unable to sign in. Please try again.');
      onSuccess(result.customer);
    }catch(error){
      setMessage(error.message||'Unable to sign in. Please try again.');
    }finally{
      setBusy(false);
    }
  };

  return <div className="admin-page customer-auth-page">
    <header className="admin-top">
      <div className="admin-brand"><span className="brand-mark">K</span><div><b>KANIMOZHI</b><small>SILKS & SAREES</small></div></div>
      <button className="outline-btn" type="button" onClick={onClose}><ArrowLeft size={15}/>BACK TO STORE</button>
    </header>
    <main className="customer-auth-card">
      <div className="eyebrow"><span/> YOUR KANIMOZHI ACCOUNT <span/></div>
      <h1>{mode==='login'?<>Welcome <em>back</em></>:<>Create your <em>account</em></>}</h1>
      <p>{mode==='login'?'Sign in to complete your order or view your account.':'Join us for a more personal shopping experience.'}</p>
      <div className="customer-auth-tabs" role="tablist" aria-label="Account access">
        <button type="button" className={mode==='login'?'active':''} onClick={()=>{setMode('login');setMessage('');}}>Sign in</button>
        <button type="button" className={mode==='register'?'active':''} onClick={()=>{setMode('register');setMessage('');}}>Create account</button>
      </div>
      <form className="customer-auth-form" onSubmit={submit}>
        {mode==='register'&&<>
          <label>Full name<input autoComplete="name" required maxLength={100} value={form.name} onChange={event=>setForm({...form,name:event.target.value})}/></label>
          <label>Username<input autoComplete="username" required minLength={3} maxLength={30} pattern="[A-Za-z0-9._-]+" title="Use 3–30 letters, numbers, dots, underscores, or hyphens." value={form.username} onChange={event=>setForm({...form,username:event.target.value})}/></label>
          <label>Email address<input type="email" autoComplete="email" required maxLength={254} value={form.email} onChange={event=>setForm({...form,email:event.target.value})}/></label>
        </>}
        {mode==='login'&&<label>Username or email<input autoComplete="username" required value={form.usernameOrEmail} onChange={event=>setForm({...form,usernameOrEmail:event.target.value})}/></label>}
        <label>Password<input type="password" autoComplete={mode==='login'?'current-password':'new-password'} required minLength={mode==='register'?8:1} maxLength={128} value={form.password} onChange={event=>setForm({...form,password:event.target.value})}/></label>
        {message&&<p className="customer-auth-message" role="alert">{message}</p>}
        <button className="gold-btn" type="submit" disabled={busy}>{mode==='login'?<LogIn size={15}/>:<UserPlus size={15}/>} {busy?'PLEASE WAIT…':mode==='login'?'SIGN IN':'CREATE ACCOUNT'}</button>
      </form>
      {googleClientId&&<>
        <div className="customer-auth-divider"><span/>OR<span/></div>
        <div className="google-signin-wrap"><div id="google-signin-button"/>{busy&&<span className="google-signin-busy">Completing sign-in…</span>}</div>
      </>}
    </main>
    <p className="customer-auth-privacy"><LockKeyhole size={13}/> Your account credentials are protected and are never shown publicly.</p>
  </div>;
}
