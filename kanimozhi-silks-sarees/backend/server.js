import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { OAuth2Client } from 'google-auth-library';
import Customer from './src/models/Customer.js';
import Product from './src/models/Product.js';
import Order from './src/models/Order.js';
import NewsletterSubscriber from './src/models/NewsletterSubscriber.js';
import VirtualTryOnHistory from './src/models/VirtualTryOnHistory.js';
import { demoProducts } from './src/demoProducts.js';

dotenv.config({ path: fileURLToPath(new URL('./.env', import.meta.url)) });
const resendApiKey=process.env.RESEND_API_KEY;
const emailFrom=process.env.EMAIL_FROM;
const emailConfigured=Boolean(resendApiKey&&emailFrom);
const sendResendEmail=async({to,subject,text})=>{
  if(!emailConfigured)return false;
  const response=await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{
      Authorization:`Bearer ${resendApiKey}`,
      'Content-Type':'application/json',
    },
    body:JSON.stringify({from:emailFrom,to:[to],subject,text}),
    signal:AbortSignal.timeout(10000),
  });
  const result=await response.json();
  if(!response.ok)throw new Error(result.message||'Resend could not send the email.');
  return true;
};
const sendOrderEmail=async(order,subject,lines)=>{
  if(!emailConfigured||!order.customer?.email)return false;
  const orderId=String(order._id||order.id);
  const text=[
    `Hello ${order.customer.name},`,
    '',
    ...(Array.isArray(lines)?lines:[lines]),
    '',
    `Order reference: ${orderId}`,
    `Order total: INR ${Number(order.subtotal).toLocaleString('en-IN')}`,
    `Order status: ${order.orderStatus}`,
    ...(order.trackingNumber?[`Carrier: ${order.carrier||'Courier'}`,`Tracking number: ${order.trackingNumber}`]:[]),
    ...(order.trackingUrl?[`Track your order: ${order.trackingUrl}`]:[]),
    '',
    'Kanimozhi Silks & Sarees',
  ].join('\n');
  try{
    return await sendResendEmail({to:order.customer.email,subject,text});
  }catch(error){
    console.error('Unable to send order email:',orderId,error.message);
    return false;
  }
};
const app=express();
const configuredClientOrigin=process.env.CLIENT_URL?.trim();
const clientOrigin=configuredClientOrigin||(process.env.NODE_ENV==='production'?'':'http://localhost:5173');
if(!clientOrigin)throw new Error('CLIENT_URL must be set to the deployed storefront origin in production.');
app.use(cors({origin:clientOrigin,credentials:true}));
app.post('/api/payments/razorpay/webhook',express.raw({type:'application/json',limit:'1mb'}),async(req,res)=>{
  if(!razorpayWebhookSecret)return res.status(503).json({message:'Payment webhook is not configured.'});
  const signature=req.get('x-razorpay-signature')||'';
  if(!Buffer.isBuffer(req.body)||!/^[a-f\d]{64}$/i.test(signature)){
    return res.status(400).json({message:'Invalid payment webhook signature.'});
  }
  const expected=createHmac('sha256',razorpayWebhookSecret).update(req.body).digest();
  const provided=Buffer.from(signature,'hex');
  if(expected.length!==provided.length||!timingSafeEqual(expected,provided)){
    return res.status(400).json({message:'Invalid payment webhook signature.'});
  }
  let event;
  try{
    event=JSON.parse(req.body.toString('utf8'));
  }catch{
    return res.status(400).json({message:'Invalid payment webhook payload.'});
  }
  if(!['payment.captured','order.paid'].includes(event.event))return res.status(200).json({received:true});
  if(!mongoReady)return res.status(503).json({message:'Order database is unavailable.'});
  const payment=event.payload?.payment?.entity;
  const gatewayOrderId=payment?.order_id||event.payload?.order?.entity?.id;
  if(!gatewayOrderId||!payment||payment.status!=='captured'){
    return res.status(200).json({received:true});
  }
  try{
    const order=await Order.findOne({razorpayOrderId:gatewayOrderId});
    if(!order)return res.status(200).json({received:true});
    if(payment.amount!==Math.round(order.subtotal*100)||payment.currency!=='INR'){
      console.error('Razorpay webhook amount did not match order:',order.id);
      return res.status(400).json({message:'Payment amount did not match order.'});
    }
    if(order.paymentStatus!=='paid'){
      const methods={upi:'UPI',card:'Card',netbanking:'Netbanking',wallet:'Wallet'};
      order.paymentMethod=methods[payment.method]||'Razorpay';
      order.razorpayPaymentId=payment.id||order.razorpayPaymentId;
      order.paymentStatus='paid';
      await order.save();
      await sendOrderEmail(order,'Payment confirmed','Your payment has been received and your order is confirmed.');
    }
    res.status(200).json({received:true});
  }catch(error){
    if(isMongoConnectivityError(error))mongoReady=false;
    console.error('Unable to process Razorpay webhook:',error.message);
    res.status(500).json({message:'Unable to process payment webhook.'});
  }
});
app.use(express.json({ limit: '12mb' }));

const scrypt=promisify(scryptCallback);
const googleClientId=process.env.GOOGLE_CLIENT_ID;
const googleAuthClient=googleClientId?new OAuth2Client(googleClientId):null;
const customerSessionSecret=process.env.CUSTOMER_SESSION_SECRET;
const customerAuthConfigured=Boolean(customerSessionSecret&&customerSessionSecret.length>=32);
const customerSessionLifetime=7*24*60*60*1000;
const customerSessionCookie='customer_session';
const customerAuthAttempts=new Map();
const newsletterAttempts=new Map();
const isMongoConnectivityError=error=>[
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoServerSelectionError',
  'MongooseServerSelectionError',
].includes(error.name);

const signCustomerPayload=payload=>createHmac('sha256',customerSessionSecret).update(payload).digest('base64url');
const createCustomerSession=(customer,res)=>{
  const payload=Buffer.from(JSON.stringify({
    id:customer.id,
    role:'customer',
    expiresAt:Date.now()+customerSessionLifetime,
  })).toString('base64url');
  const token=`${payload}.${signCustomerPayload(payload)}`;
  const secure=process.env.NODE_ENV==='production'?'; Secure':'';
  res.setHeader('Set-Cookie',[
    `${customerSessionCookie}=${encodeURIComponent(token)}; HttpOnly; Path=/api; SameSite=Lax; Max-Age=${customerSessionLifetime/1000}${secure}`,
    `${customerSessionCookie}=; HttpOnly; Path=/api/auth; SameSite=Lax; Max-Age=0${secure}`,
  ]);
};
const clearCustomerSession=res=>{
  const secure=process.env.NODE_ENV==='production'?'; Secure':'';
  res.setHeader('Set-Cookie',[
    `${customerSessionCookie}=; HttpOnly; Path=/api; SameSite=Lax; Max-Age=0${secure}`,
    `${customerSessionCookie}=; HttpOnly; Path=/api/auth; SameSite=Lax; Max-Age=0${secure}`,
  ]);
};
const getCustomerSession=req=>{
  const cookie=req.get('cookie')||'';
  const value=cookie.split(';').map(part=>part.trim()).find(part=>part.startsWith(`${customerSessionCookie}=`))?.slice(customerSessionCookie.length+1);
  if(!value)return null;
  try{
    const token=decodeURIComponent(value);
    const [payload,signature]=token.split('.');
    if(!payload||!signature)return null;
    const expected=Buffer.from(signCustomerPayload(payload),'base64url');
    const provided=Buffer.from(signature,'base64url');
    if(expected.length!==provided.length||!timingSafeEqual(expected,provided))return null;
    const session=JSON.parse(Buffer.from(payload,'base64url').toString());
    return session.id&&session.role==='customer'&&session.expiresAt>Date.now()?session:null;
  }catch{
    return null;
  }
};
const requireCustomer=async(req,res,next)=>{
  if(!customerAuthConfigured)return res.status(503).json({message:'Customer sign-in is not configured. Set CUSTOMER_SESSION_SECRET in backend/.env.'});
  const session=getCustomerSession(req);
  if(!session)return res.status(401).json({message:'Please sign in to continue.'});
  try{
    const customer=await Customer.findById(session.id).select('_id username name email');
    if(!customer){
      clearCustomerSession(res);
      return res.status(401).json({message:'Customer account not found. Please sign in again.'});
    }
    req.customer=customer;
    next();
  }catch(error){
    console.error('Unable to verify customer session:',error.message);
    res.status(500).json({message:'Unable to verify sign-in. Please try again.'});
  }
};
const getAuthAttempt=req=>{
  const now=Date.now();
  for(const [ip,attempt] of customerAuthAttempts){
    if(now-attempt.startedAt>=15*60*1000)customerAuthAttempts.delete(ip);
  }
  const attempt=customerAuthAttempts.get(req.ip);
  if(attempt&&attempt.count>=10&&now-attempt.startedAt<15*60*1000)return false;
  if(!attempt||now-attempt.startedAt>=15*60*1000){
    customerAuthAttempts.set(req.ip,{count:1,startedAt:now});
  }else{
    attempt.count+=1;
  }
  return true;
};

app.get('/api/auth/config',(req,res)=>res.json({googleClientId:googleClientId||''}));
app.post('/api/auth/register',async(req,res)=>{
  if(!customerAuthConfigured)return res.status(503).json({message:'Customer sign-in is not configured. Set CUSTOMER_SESSION_SECRET in backend/.env.'});
  if(!mongoReady)return res.status(503).json({message:'Customer accounts require a live MongoDB connection. For Atlas, allow your current IP in Network Access, then restart the backend.'});
  if(!getAuthAttempt(req))return res.status(429).json({message:'Too many sign-in attempts. Try again in 15 minutes.'});

  const username=typeof req.body?.username==='string'?req.body.username.trim().toLowerCase():'';
  const name=typeof req.body?.name==='string'?req.body.name.trim():'';
  const email=typeof req.body?.email==='string'?req.body.email.trim().toLowerCase():'';
  const password=req.body?.password;
  if(!/^[a-z0-9._-]{3,30}$/.test(username)){
    return res.status(400).json({message:'Username must be 3–30 characters and use letters, numbers, dots, underscores, or hyphens.'});
  }
  if(!name||name.length>100||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254){
    return res.status(400).json({message:'Enter your name and a valid email address.'});
  }
  if(typeof password!=='string'||password.length<8||password.length>128){
    return res.status(400).json({message:'Password must be between 8 and 128 characters.'});
  }
  try{
    const existing=await Customer.findOne({$or:[{email},{username}]});
    if(existing)return res.status(409).json({message:'That username or email is already registered.'});
    const salt=randomBytes(16).toString('base64url');
    const passwordHash=`${salt}:${Buffer.from(await scrypt(password,salt,64)).toString('base64url')}`;
    const customer=await Customer.create({username,name,email,passwordHash});
    customerAuthAttempts.delete(req.ip);
    createCustomerSession(customer,res);
    res.status(201).json({customer:{username:customer.username,name:customer.name,email:customer.email}});
  }catch(error){
    if(error.code===11000)return res.status(409).json({message:'That username or email is already registered.'});
    console.error('Customer registration failed:',error.message);
    if(isMongoConnectivityError(error)){
      mongoReady=false;
      return res.status(503).json({message:'Cannot reach MongoDB. In Atlas, allow your current IP in Network Access, then restart the backend.'});
    }
    res.status(500).json({message:'Unable to create your account. Please try again.'});
  }
});
app.post('/api/auth/login',async(req,res)=>{
  if(!customerAuthConfigured)return res.status(503).json({message:'Customer sign-in is not configured. Set CUSTOMER_SESSION_SECRET in backend/.env.'});
  if(!mongoReady)return res.status(503).json({message:'Customer accounts require a live MongoDB connection. For Atlas, allow your current IP in Network Access, then restart the backend.'});
  if(!getAuthAttempt(req))return res.status(429).json({message:'Too many sign-in attempts. Try again in 15 minutes.'});

  const usernameOrEmail=typeof req.body?.usernameOrEmail==='string'?req.body.usernameOrEmail.trim().toLowerCase():'';
  const password=req.body?.password;
  if(!usernameOrEmail||typeof password!=='string'||password.length>128){
    return res.status(400).json({message:'Enter your username or email and password.'});
  }
  try{
    const customer=await Customer.findOne({$or:[{email:usernameOrEmail},{username:usernameOrEmail}]});
    let passwordMatches=false;
    if(customer?.passwordHash){
      const [salt,storedHash]=customer.passwordHash.split(':');
      const expected=Buffer.from(storedHash||'','base64url');
      const actual=Buffer.from(await scrypt(password,salt,64));
      passwordMatches=expected.length===actual.length&&timingSafeEqual(expected,actual);
    }
    if(!customer||!passwordMatches)return res.status(401).json({message:'Incorrect username/email or password.'});
    customerAuthAttempts.delete(req.ip);
    createCustomerSession(customer,res);
    res.json({customer:{username:customer.username||'',name:customer.name,email:customer.email}});
  }catch(error){
    console.error('Customer sign-in failed:',error.message);
    res.status(500).json({message:'Unable to sign in. Please try again.'});
  }
});
app.post('/api/auth/google',async(req,res)=>{
  if(!customerAuthConfigured)return res.status(503).json({message:'Customer sign-in is not configured. Set CUSTOMER_SESSION_SECRET in backend/.env.'});
  if(!googleAuthClient)return res.status(503).json({message:'Google sign-in is not configured. Add GOOGLE_CLIENT_ID to backend/.env.'});
  if(!mongoReady)return res.status(503).json({message:'Customer accounts require a live MongoDB connection. For Atlas, allow your current IP in Network Access, then restart the backend.'});
  if(!getAuthAttempt(req))return res.status(429).json({message:'Too many sign-in attempts. Try again in 15 minutes.'});
  if(typeof req.body?.credential!=='string'||req.body.credential.length>10000){
    return res.status(400).json({message:'Google did not return a valid sign-in credential.'});
  }
  let identity;
  try{
    const ticket=await googleAuthClient.verifyIdToken({idToken:req.body.credential,audience:googleClientId});
    identity=ticket.getPayload();
  }catch(error){
    console.error('Google customer credential verification failed:',error.message);
    return res.status(401).json({message:'Google sign-in could not be verified. Please try again.'});
  }
  if(!identity?.sub||!identity.email||identity.email_verified!==true){
    return res.status(401).json({message:'Google did not provide a verified email address.'});
  }
  try{
    let customer=await Customer.findOne({$or:[{googleId:identity.sub},{email:identity.email.toLowerCase()}]});
    if(customer){
      if(customer.googleId&&customer.googleId!==identity.sub){
        return res.status(409).json({message:'This email is already linked to a different Google account.'});
      }
      if(!customer.googleId){
        customer.googleId=identity.sub;
        await customer.save();
      }
    }else{
      customer=await Customer.create({
        googleId:identity.sub,
        name:identity.name||identity.email,
        email:identity.email.toLowerCase(),
      });
    }
    customerAuthAttempts.delete(req.ip);
    createCustomerSession(customer,res);
    res.json({customer:{username:customer.username||'',name:customer.name,email:customer.email}});
  }catch(error){
    if(error.code===11000)return res.status(409).json({message:'This email is already linked to a different Google account.'});
    console.error('Google customer sign-in failed:',error.message);
    res.status(500).json({message:'Unable to complete Google sign-in. Please try again.'});
  }
});
app.get('/api/auth/session',async(req,res)=>{
  const session=getCustomerSession(req);
  if(!customerAuthConfigured||!session)return res.json({customer:null});
  try{
    const customer=await Customer.findById(session.id).select('_id username name email');
    if(!customer){
      clearCustomerSession(res);
      return res.json({customer:null});
    }
    res.json({customer:{username:customer.username||'',name:customer.name,email:customer.email}});
  }catch(error){
    console.error('Unable to verify customer session:',error.message);
    res.status(500).json({message:'Unable to verify sign-in. Please try again.'});
  }
});
app.post('/api/auth/logout',(req,res)=>{
  clearCustomerSession(res);
  res.status(204).end();
});

const adminConfig = {
  username: process.env.ADMIN_USERNAME,
  password: process.env.ADMIN_PASSWORD,
  sessionSecret: process.env.ADMIN_SESSION_SECRET,
};
const adminConfigured = Boolean(
  adminConfig.username &&
  adminConfig.password &&
  adminConfig.sessionSecret &&
  adminConfig.sessionSecret.length >= 32
);
const loginAttempts = new Map();
const adminSessionLifetime = 8 * 60 * 60 * 1000;

const constantTimeEqual = (left, right) => timingSafeEqual(
  createHash('sha256').update(left).digest(),
  createHash('sha256').update(right).digest()
);

const signAdminPayload = payload => createHmac('sha256', adminConfig.sessionSecret)
  .update(payload)
  .digest('base64url');

const requireAdmin = (req, res, next) => {
  const authorization = req.get('authorization') || '';
  const tokenMatch = authorization.match(/^Bearer ([A-Za-z0-9._-]+)$/);
  if (!adminConfigured || !tokenMatch) {
    return res.status(401).json({ message: 'Admin sign-in required' });
  }

  const [payload, signature] = tokenMatch[1].split('.');
  if (!payload || !signature) {
    return res.status(401).json({ message: 'Invalid admin session' });
  }

  const expectedSignature = Buffer.from(signAdminPayload(payload), 'base64url');
  const providedSignature = Buffer.from(signature, 'base64url');
  if (
    expectedSignature.length !== providedSignature.length ||
    !timingSafeEqual(expectedSignature, providedSignature)
  ) {
    return res.status(401).json({ message: 'Invalid admin session' });
  }

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (session.username !== adminConfig.username || session.role !== 'admin' || session.expiresAt <= Date.now()) {
      return res.status(401).json({ message: 'Admin session expired; please sign in again' });
    }
  } catch {
    return res.status(401).json({ message: 'Invalid admin session' });
  }

  next();
};

app.post('/api/admin/login',(req,res)=>{
  if(!adminConfigured){
    return res.status(503).json({message:'Admin sign-in is not configured. Set ADMIN_USERNAME, ADMIN_PASSWORD, and an ADMIN_SESSION_SECRET of at least 32 characters.'});
  }

  const now=Date.now();
  for(const [ip,attempt] of loginAttempts){
    if(now-attempt.startedAt>=15*60*1000)loginAttempts.delete(ip);
  }
  const attempt=loginAttempts.get(req.ip);
  if(attempt&&attempt.count>=5&&now-attempt.startedAt<15*60*1000){
    return res.status(429).json({message:'Too many sign-in attempts. Try again in 15 minutes.'});
  }

  const {username,password}=req.body||{};
  if(typeof username!=='string'||typeof password!=='string'||
    !constantTimeEqual(username,adminConfig.username)||
    !constantTimeEqual(password,adminConfig.password)){
    if(!attempt||now-attempt.startedAt>=15*60*1000){
      loginAttempts.set(req.ip,{count:1,startedAt:now});
    }else{
      attempt.count+=1;
    }
    return res.status(401).json({message:'Incorrect username or password'});
  }

  loginAttempts.delete(req.ip);
  const payload=Buffer.from(JSON.stringify({
    username:adminConfig.username,
    role:'admin',
    expiresAt:now+adminSessionLifetime,
  })).toString('base64url');
  res.json({token:`${payload}.${signAdminPayload(payload)}`});
});

app.get('/api/admin/session',requireAdmin,(req,res)=>res.json({authenticated:true}));
app.get('/api/admin/orders',requireAdmin,async(req,res)=>{
  if(!mongoReady)return res.status(503).json({message:'Order management requires a connected database.'});
  try{
    const orders=await Order.find().sort({createdAt:-1}).limit(100).lean();
    res.json(orders.map(order=>({
      id:String(order._id),
      customer:order.customer,
      shippingAddress:order.shippingAddress,
      items:order.items,
      subtotal:order.subtotal,
      paymentMethod:order.paymentMethod,
      paymentStatus:order.paymentStatus,
      orderStatus:order.orderStatus,
      carrier:order.carrier,
      trackingNumber:order.trackingNumber,
      trackingUrl:order.trackingUrl,
      createdAt:order.createdAt,
    })));
  }catch(error){
    if(isMongoConnectivityError(error))mongoReady=false;
    console.error('Unable to load admin orders:',error.message);
    res.status(500).json({message:'Unable to load orders. Please try again.'});
  }
});
app.patch('/api/admin/orders/:id',requireAdmin,async(req,res)=>{
  if(!mongoReady)return res.status(503).json({message:'Order management requires a connected database.'});
  const {orderStatus,carrier,trackingNumber,trackingUrl}=req.body||{};
  const statuses=['placed','processing','shipped','delivered','cancelled'];
  if(!statuses.includes(orderStatus))return res.status(400).json({message:'Choose a valid order status.'});
  if(typeof carrier!=='string'||carrier.trim().length>100||
    typeof trackingNumber!=='string'||trackingNumber.trim().length>100||
    typeof trackingUrl!=='string'||trackingUrl.length>500){
    return res.status(400).json({message:'Enter valid courier and tracking details.'});
  }
  if(trackingUrl){
    try{
      const url=new URL(trackingUrl);
      if(!['http:','https:'].includes(url.protocol))throw new Error('Invalid protocol');
    }catch{
      return res.status(400).json({message:'Tracking link must be a valid HTTP or HTTPS URL.'});
    }
  }
  try{
    const order=await Order.findById(req.params.id);
    if(!order)return res.status(404).json({message:'Order not found.'});
    const allowedTransitions={
      placed:['placed','processing','cancelled'],
      processing:['processing','shipped','cancelled'],
      shipped:['shipped','delivered'],
      delivered:['delivered'],
      cancelled:['cancelled'],
    };
    if(!allowedTransitions[order.orderStatus]?.includes(orderStatus)){
      return res.status(409).json({message:`Cannot change an order from ${order.orderStatus} to ${orderStatus}.`});
    }
    if(orderStatus==='cancelled'&&order.paymentStatus==='paid'){
      return res.status(409).json({message:'Paid orders cannot be cancelled here. Contact the customer to arrange a refund.'});
    }
    const nextTrackingNumber=trackingNumber.trim();
    if(orderStatus==='shipped'&&!nextTrackingNumber){
      return res.status(400).json({message:'Add a tracking number before marking the order as shipped.'});
    }
    const changed=order.orderStatus!==orderStatus||
      order.carrier!==carrier.trim()||
      order.trackingNumber!==nextTrackingNumber||
      order.trackingUrl!==trackingUrl.trim();
    order.orderStatus=orderStatus;
    order.carrier=carrier.trim();
    order.trackingNumber=nextTrackingNumber;
    order.trackingUrl=trackingUrl.trim();
    await order.save();
    const emailSent=changed?await sendOrderEmail(
      order,
      `Order update: ${order.orderStatus}`,
      `Your order status has been updated to ${order.orderStatus.toUpperCase()}.`,
    ):null;
    res.json({order:publicOrder(order),emailSent});
  }catch(error){
    if(error.name==='CastError')return res.status(404).json({message:'Order not found.'});
    if(isMongoConnectivityError(error))mongoReady=false;
    console.error('Unable to update order fulfilment:',error.message);
    res.status(500).json({message:'Unable to update order fulfilment. Please try again.'});
  }
});
app.get('/api/admin/newsletter',requireAdmin,async(req,res)=>{
  if(!mongoReady)return res.status(503).json({message:'Newsletter subscribers require a connected database.'});
  try{
    const subscribers=await NewsletterSubscriber.find().sort({createdAt:-1}).limit(1000).lean();
    res.json(subscribers.map(subscriber=>({email:subscriber.email,createdAt:subscriber.createdAt})));
  }catch(error){
    if(isMongoConnectivityError(error))mongoReady=false;
    console.error('Unable to load newsletter subscribers:',error.message);
    res.status(500).json({message:'Unable to load newsletter subscribers.'});
  }
});

const googleDriveFileId = value => {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.hostname !== 'drive.google.com') return null;
    const fileId = url.pathname.match(/^\/file\/d\/([^/]+)/)?.[1] || url.searchParams.get('id');
    return fileId && /^[A-Za-z0-9_-]{10,200}$/.test(fileId) ? fileId : null;
  } catch {
    return null;
  }
};

const normalizeImageUrl = value => {
  const fileId = googleDriveFileId(value);
  return fileId ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w1000` : value;
};

const serializeProduct = (product, req) => {
  const data = typeof product.toObject === 'function' ? product.toObject() : product;
  const image = normalizeImageUrl(data.image);
  const fileId = googleDriveFileId(image);
  return {
    ...data,
    image: fileId
      ? `${req.protocol}://${req.get('host')}/api/product-images/${encodeURIComponent(fileId)}`
      : image,
  };
};

let mongoReady=false;
let mongoIndexesReady=false;
mongoose.connection.on('disconnected',()=>{mongoReady=false;});
mongoose.connection.on('connected',()=>{if(mongoIndexesReady)mongoReady=true;});
if(process.env.MONGO_URI){
  mongoose.connect(process.env.MONGO_URI)
    .then(async()=>{
      await VirtualTryOnHistory.createIndexes();
      mongoIndexesReady=true;
      mongoReady=true;
      console.log('MongoDB connected');
    })
    .catch(err=>console.error('MongoDB connection failed; the catalogue remains empty until the database is available:',err.message));
}

app.get('/api/health',(req,res)=>res.json({status:'ok',database:mongoReady&&mongoose.connection.readyState===1?'connected':'demo-mode'}));
app.post('/api/newsletter',async(req,res)=>{
  const email=typeof req.body?.email==='string'?req.body.email.trim().toLowerCase():'';
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254){
    return res.status(400).json({message:'Enter a valid email address.'});
  }
  if(!mongoReady)return res.status(503).json({message:'Newsletter signup requires a connected database. Please try again later.'});
  const now=Date.now();
  for(const [ip,attempt] of newsletterAttempts){
    if(now-attempt.startedAt>=60*1000)newsletterAttempts.delete(ip);
  }
  const attempt=newsletterAttempts.get(req.ip);
  if(attempt&&attempt.count>=5)return res.status(429).json({message:'Too many signup attempts. Please try again in a minute.'});
  if(!attempt||now-attempt.startedAt>=60*1000)newsletterAttempts.set(req.ip,{count:1,startedAt:now});
  else attempt.count+=1;
  try{
    const result=await NewsletterSubscriber.updateOne({email},{$setOnInsert:{email}},{upsert:true});
    let welcomeEmailSent=null;
    if(result.upsertedCount){
      welcomeEmailSent=false;
      if(emailConfigured){
        try{
          welcomeEmailSent=await sendResendEmail({
            to:email,
            subject:'Welcome to Kanimozhi Silks',
            text:'Thank you for subscribing to Kanimozhi Silks & Sarees. We will share new arrivals and store updates with you.',
          });
        }catch(error){
          console.error('Unable to send newsletter welcome email:',error.message);
        }
      }
    }
    res.status(200).json({
      message:result.upsertedCount?'Thank you for subscribing.':'This email is already subscribed.',
      emailSent:welcomeEmailSent,
    });
  }catch(error){
    if(isMongoConnectivityError(error))mongoReady=false;
    console.error('Unable to save newsletter subscriber:',error.message);
    res.status(500).json({message:'Unable to save your subscription. Please try again.'});
  }
});
app.get('/api/products',async(req,res)=>{
  if(!mongoReady)return res.json(demoProducts.map(product=>serializeProduct(product,req)));
  try{
    const items=await Product.find({active:true}).sort({createdAt:-1});
    res.json((items.length?items:demoProducts).map(product=>serializeProduct(product,req)));
  }catch(err){
    if(isMongoConnectivityError(err))mongoReady=false;
    res.status(500).json({message:'Unable to fetch products'});
  }
});
app.get('/api/products/:id',async(req,res)=>{
  try{
    if(!mongoReady)return res.status(404).json({message:'Product not found'});
    const item=await Product.findOne({id:req.params.id,active:true});
    if(!item)return res.status(404).json({message:'Product not found'});
    res.json(serializeProduct(item,req));
  }catch(err){res.status(500).json({message:'Unable to fetch product'});}
});
const tryOnRequests = new Map();
const imageDataUrlPattern = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const maxTryOnImageBytes = 3 * 1024 * 1024;
const maxGeneratedImageBytes = 8 * 1024 * 1024;
const maxProductImageBytes = 5 * 1024 * 1024;
const imageMimeType = image => {
  if(image.length>=8&&image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(image.length>=3&&image[0]===0xff&&image[1]===0xd8&&image[2]===0xff)return 'image/jpeg';
  if(image.length>=12&&image.toString('ascii',0,4)==='RIFF'&&image.toString('ascii',8,12)==='WEBP')return 'image/webp';
  return null;
};
app.get('/api/product-images/:fileId',async(req,res)=>{
  const {fileId}=req.params;
  if(!/^[A-Za-z0-9_-]{10,200}$/.test(fileId)){
    return res.status(400).json({message:'Invalid product image ID.'});
  }
  try{
    const response=await fetch(`https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w1000`,{
      signal:AbortSignal.timeout(10000),
    });
    if(!response.ok){
      console.error('Google Drive product image request failed:',response.status);
      return res.status(502).json({message:'Unable to load product image.'});
    }
    const contentLength=Number(response.headers.get('content-length'));
    if(Number.isFinite(contentLength)&&contentLength>maxProductImageBytes){
      return res.status(502).json({message:'Product image is too large.'});
    }
    const image=Buffer.from(await response.arrayBuffer());
    const mimeType=imageMimeType(image);
    if(!mimeType||image.length>maxProductImageBytes){
      console.error('Google Drive returned an invalid product image:',fileId);
      return res.status(502).json({message:'Unable to load product image.'});
    }
    res.set('Content-Type',mimeType);
    res.set('Cache-Control','public, max-age=86400');
    res.send(image);
  }catch(error){
    console.error('Unable to fetch Google Drive product image:',error.message);
    res.status(502).json({message:'Unable to load product image.'});
  }
});
const decodeTryOnImage = value => {
  if (typeof value !== 'string') return null;
  const match = value.match(imageDataUrlPattern);
  if (!match) return null;
  const image = Buffer.from(match[2], 'base64');
  const mimeType=`image/${match[1]}`;
  if (!image.length || image.length > maxTryOnImageBytes ||
    image.toString('base64').replace(/=+$/,'')!==match[2].replace(/=+$/,'') ||
    imageMimeType(image)!==mimeType) return null;
  return { dataUrl:value, buffer:image, mimeType:`image/${match[1]}` };
};

app.post('/api/try-on',async(req,res)=>{
  const accountId=process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken=process.env.CLOUDFLARE_API_TOKEN;
  if(!accountId||!apiToken)return res.status(503).json({message:'AI try-on is not configured. Add CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN to backend/.env, then restart the backend.'});
  if(!mongoReady)return res.status(503).json({message:'Try-on history requires a connected MongoDB database. Please try again later.'});

  const now=Date.now();
  for(const [ip,attempt] of tryOnRequests){
    if(now-attempt.startedAt>=60*1000)tryOnRequests.delete(ip);
  }
  const attempt=tryOnRequests.get(req.ip);
  if(attempt&&attempt.count>=3&&now-attempt.startedAt<60*1000){
    return res.status(429).json({message:'Please wait a minute before creating more try-on previews.'});
  }
  if(!attempt||now-attempt.startedAt>=60*1000){
    tryOnRequests.set(req.ip,{count:1,startedAt:now});
  }else{
    attempt.count+=1;
  }

  const personImage=decodeTryOnImage(req.body?.personImage);
  const sareeImage=decodeTryOnImage(req.body?.sareeImage);
  if(req.body?.storeConsent!==true){
    return res.status(400).json({message:'Consent to store the uploaded images for up to 30 days is required.'});
  }
  if(!personImage||!sareeImage){
    return res.status(400).json({message:'Upload both images as JPG, PNG, or WebP files smaller than 3 MB each.'});
  }

  const formData=new FormData();
  formData.set('prompt','Create a realistic virtual saree try-on. Image 1 is the person and image 2 is the saree product. Dress the person in the saree shown in image 2, preserving its colors, border, motifs, and fabric appearance as closely as possible. Preserve the person’s identity, face, skin tone, body proportions, pose, and the original background. Show a natural full saree drape. Do not copy any person or model from image 2 and do not add text or extra people.');
  formData.set('width','1024');
  formData.set('height','1536');
  formData.append('input_image_0',new Blob([personImage.buffer],{type:personImage.mimeType}),'person-image');
  formData.append('input_image_1',new Blob([sareeImage.buffer],{type:sareeImage.mimeType}),'saree-image');

  let response;
  try{
    response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/@cf/black-forest-labs/flux-2-klein-4b`,{
      method:'POST',
      headers:{
        Authorization:`Bearer ${apiToken}`,
      },
      body:formData,
      signal:AbortSignal.timeout(90*1000),
    });
  }catch(error){
    console.error('Cloudflare Workers AI try-on request failed:',error.message);
    res.status(502).json({message:'Unable to reach the AI image service. Please try again later.'});
    return;
  }
  let data;
  try{
    data=await response.json();
  }catch(error){
    console.error('Cloudflare Workers AI returned an invalid response:',error.message);
    return res.status(502).json({message:'The AI image service returned an invalid response. Please try again.'});
  }
  if(!response.ok){
    const details=Array.isArray(data?.errors)?data.errors.map(error=>error.message).filter(Boolean).join('; '):'';
    console.error(`Cloudflare Workers AI try-on failed with HTTP ${response.status}${details?`: ${details}`:''}`);
    const quotaFailure=response.status===402||response.status===429||/quota|neurons|daily limit|rate limit/i.test(details);
    const quotaMessage=quotaFailure
      ?'Cloudflare Workers AI has reached a quota or rate limit. Please try again after the daily limit resets.'
      :'The AI image service could not create a preview. Check your Cloudflare credentials and Workers AI access, then try again.';
    return res.status(502).json({message:quotaMessage});
  }
  const encodedImage=data?.result?.image;
  if(typeof encodedImage!=='string'||!/^([A-Za-z0-9+/]+={0,2})$/.test(encodedImage)){
    console.error('Cloudflare Workers AI try-on returned no valid image data');
    return res.status(502).json({message:'The AI image service returned no preview. Please try again.'});
  }
  const previewImage=Buffer.from(encodedImage,'base64');
  const previewMimeType=imageMimeType(previewImage);
  if(!previewMimeType||previewImage.length>maxGeneratedImageBytes){
    console.error('Cloudflare Workers AI try-on returned an unsupported or oversized image');
    return res.status(502).json({message:'The generated preview could not be saved. Please try another image.'});
  }

  try{
    const history=await VirtualTryOnHistory.create({
      personImage:personImage.buffer,
      personMimeType:personImage.mimeType,
      sareeImage:sareeImage.buffer,
      sareeMimeType:sareeImage.mimeType,
      previewImage,
      previewMimeType,
    });
    res.json({
      id:history.id,
      imageUrl:`data:${previewMimeType};base64,${previewImage.toString('base64')}`,
    });
  }catch(error){
    console.error('Generated try-on could not be saved to MongoDB:',error.message);
    res.status(500).json({message:'The preview was generated but could not be saved to history. Please contact the store admin.'});
  }
});
app.get('/api/admin/try-ons',requireAdmin,async(req,res)=>{
  if(!mongoReady)return res.status(503).json({message:'Connect MongoDB to view saved try-on history.'});
  try{
    const records=await VirtualTryOnHistory.find().select('_id createdAt').sort({createdAt:-1}).limit(30).lean();
    res.json(records.map(record=>({id:record._id.toString(),createdAt:record.createdAt})));
  }catch(error){
    console.error('Unable to load try-on history:',error.message);
    res.status(500).json({message:'Unable to load try-on history.'});
  }
});
app.get('/api/admin/try-ons/:id/images/:kind',requireAdmin,async(req,res)=>{
  if(!mongoReady)return res.status(503).json({message:'Connect MongoDB to view saved try-on images.'});
  const imageFields={
    person:{image:'personImage',mimeType:'personMimeType'},
    saree:{image:'sareeImage',mimeType:'sareeMimeType'},
    preview:{image:'previewImage',mimeType:'previewMimeType'},
  };
  const fields=Object.hasOwn(imageFields,req.params.kind)?imageFields[req.params.kind]:null;
  if(!fields)return res.status(400).json({message:'Unknown try-on image type.'});
  try{
    const record=await VirtualTryOnHistory.findById(req.params.id).select(`${fields.image} ${fields.mimeType}`);
    if(!record)return res.status(404).json({message:'Try-on history entry not found.'});
    res.set('Cache-Control','private, no-store');
    res.type(record[fields.mimeType]).send(record[fields.image]);
  }catch(error){
    if(error.name==='CastError')return res.status(404).json({message:'Try-on history entry not found.'});
    console.error('Unable to load saved try-on image:',error.message);
    res.status(500).json({message:'Unable to load saved try-on image.'});
  }
});
app.delete('/api/admin/try-ons/:id',requireAdmin,async(req,res)=>{
  if(!mongoReady)return res.status(503).json({message:'Connect MongoDB to delete saved try-on history.'});
  try{
    const record=await VirtualTryOnHistory.findByIdAndDelete(req.params.id);
    if(!record)return res.status(404).json({message:'Try-on history entry not found.'});
    res.status(204).end();
  }catch(error){
    if(error.name==='CastError')return res.status(404).json({message:'Try-on history entry not found.'});
    console.error('Unable to delete try-on history:',error.message);
    res.status(500).json({message:'Unable to delete try-on history.'});
  }
});
app.post('/api/products',requireAdmin,async(req,res)=>{
  if(!mongoReady)return res.status(503).json({message:'Connect MongoDB to create persistent products'});
  try{const item=await Product.create({...req.body,image:normalizeImageUrl(req.body.image)});res.status(201).json(serializeProduct(item,req));}
  catch(err){res.status(400).json({message:err.message});}
});
app.patch('/api/products/:id',requireAdmin,async(req,res)=>{
  if(!mongoReady)return res.status(503).json({message:'Connect MongoDB to update persistent products.'});
  const {name,price,image}=req.body||{};
  let imageUrl;
  try{
    if(typeof name!=='string'||!name.trim()||name.trim().length>150||
      typeof price!=='number'||!Number.isFinite(price)||price<=0||
      typeof image!=='string'||image.length>2048){
      return res.status(400).json({message:'Enter a product name, valid positive price, and image URL.'});
    }
    imageUrl=new URL(image);
    if(!['http:','https:'].includes(imageUrl.protocol)){
      return res.status(400).json({message:'Product image URL must use HTTP or HTTPS.'});
    }
  }catch{
    return res.status(400).json({message:'Enter a product name, valid positive price, and image URL.'});
  }

  try{
    const item=await Product.findOne({id:req.params.id,active:true});
    if(!item)return res.status(404).json({message:'Product not found.'});
    const previousImage=normalizeImageUrl(item.image);
    item.name=name.trim();
    item.price=price;
    item.image=normalizeImageUrl(image);
    if(previousImage!==item.image)item.imageCredit=undefined;
    await item.save();
    res.json(serializeProduct(item,req));
  }catch(error){
    if(isMongoConnectivityError(error)){
      mongoReady=false;
      return res.status(503).json({message:'Cannot reach MongoDB. Please try again when the database is available.'});
    }
    console.error('Unable to update product:',error.message);
    res.status(400).json({message:'Unable to update product. Check the price and image URL.'});
  }
});
app.delete('/api/products/:id',requireAdmin,async(req,res)=>{
  if(!mongoReady)return res.status(503).json({message:'Connect MongoDB to remove products from the catalogue.'});
  try{
    const product=await Product.findOneAndUpdate(
      {id:req.params.id,active:true},
      {$set:{active:false}},
      {new:true},
    );
    if(!product)return res.status(404).json({message:'Product not found.'});
    res.status(204).end();
  }catch(error){
    if(isMongoConnectivityError(error)){
      mongoReady=false;
      return res.status(503).json({message:'Cannot reach MongoDB. Please try again when the database is available.'});
    }
    console.error('Unable to remove product from catalogue:',error.message);
    res.status(500).json({message:'Unable to remove product. Please try again.'});
  }
});

const razorpayKeyId=process.env.RAZORPAY_KEY_ID;
const razorpayKeySecret=process.env.RAZORPAY_KEY_SECRET;
const razorpayWebhookSecret=process.env.RAZORPAY_WEBHOOK_SECRET;
const razorpayConfigured=Boolean(razorpayKeyId&&razorpayKeySecret);
const orderInputError=(message,status=400,extra={})=>Object.assign(new Error(message),{status,...extra});
app.get('/api/payments/config',(req,res)=>res.json({onlinePaymentsEnabled:razorpayConfigured}));
const razorpayRequest=async(path,{method='GET',body}={})=>{
  const response=await fetch(`https://api.razorpay.com/v1/${path}`,{
    method,
    headers:{
      Authorization:`Basic ${Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString('base64')}`,
      ...(body?{'Content-Type':'application/json'}:{}),
    },
    ...(body?{body:JSON.stringify(body)}:{}),
  });
  const result=await response.json();
  if(!response.ok)throw new Error(result.error?.description||'The payment provider could not process this request.');
  return result;
};
const buildOrderDetails=async(customer,body)=>{
  if(!mongoReady)throw orderInputError('Orders require a live MongoDB connection. Please try again later.',503);
  const delivery=body?.delivery;
  const name=typeof delivery?.name==='string'?delivery.name.trim():'';
  const phone=typeof delivery?.phone==='string'?delivery.phone.replace(/\D/g,''):'';
  const address=typeof delivery?.address==='string'?delivery.address.trim():'';
  const city=typeof delivery?.city==='string'?delivery.city.trim():'';
  const state=typeof delivery?.state==='string'?delivery.state.trim():'';
  const postal=typeof delivery?.postal==='string'?delivery.postal.trim():'';
  if(!name||name.length>100||!/^[6-9]\d{9}$/.test(phone)||
    !address||address.length>300||!city||city.length>100||
    !state||state.length>100||!/^\d{6}$/.test(postal)){
    throw orderInputError('Enter a valid name, 10-digit Indian mobile number, street address, city, state, and 6-digit PIN code.');
  }
  const requestedItems=body?.items;
  if(!Array.isArray(requestedItems)||requestedItems.length<1||requestedItems.length>20){
    throw orderInputError('Your cart is empty or contains too many different products.');
  }
  const quantities=new Map();
  for(const entry of requestedItems){
    if(typeof entry?.id!=='string'||!entry.id.trim()||
      !Number.isInteger(entry.quantity)||entry.quantity<1||entry.quantity>10){
      throw orderInputError('Your cart contains an invalid product or quantity.');
    }
    quantities.set(entry.id.trim(),(quantities.get(entry.id.trim())||0)+entry.quantity);
  }
  if([...quantities.values()].some(quantity=>quantity>10)){
    throw orderInputError('A maximum of 10 of each product can be ordered at once.');
  }
  const products=await Product.find({id:{$in:[...quantities.keys()]},active:true});
  const productsById=new Map(products.map(product=>[product.id,product]));
  if(productsById.size!==quantities.size){
    throw orderInputError('One or more products are no longer available. Refresh the catalogue and try again.');
  }
  const items=[...quantities].map(([id,quantity])=>{
    const product=productsById.get(id);
    return {productId:id,name:product.name,quantity,unitPrice:product.price};
  });
  const subtotal=items.reduce((sum,item)=>sum+item.unitPrice*item.quantity,0);
  if(!Number.isFinite(subtotal)||subtotal<=0||subtotal>10000000){
    throw orderInputError('The order total is invalid.');
  }
  if(body?.expectedTotal!==undefined&&
    (typeof body.expectedTotal!=='number'||!Number.isFinite(body.expectedTotal)||
      Math.round(body.expectedTotal*100)!==Math.round(subtotal*100))){
    throw orderInputError('Product prices changed. Review the updated total and try again.',409,{
      currentItems:items,
      currentTotal:subtotal,
    });
  }
  return {
    customerId:customer._id,
    customer:{name,email:customer.email,phone},
    shippingAddress:{address,city,state,postal,country:'India'},
    items,
    subtotal,
  };
};
const publicOrder=order=>({
  id:order.id,
  items:order.items,
  subtotal:order.subtotal,
  paymentMethod:order.paymentMethod,
  paymentStatus:order.paymentStatus,
  orderStatus:order.orderStatus,
  carrier:order.carrier||'',
  trackingNumber:order.trackingNumber||'',
  trackingUrl:order.trackingUrl||'',
  createdAt:order.createdAt,
});

app.post('/api/orders/cod',requireCustomer,async(req,res)=>{
  try{
    const details=await buildOrderDetails(req.customer,req.body);
    const order=await Order.create({...details,paymentMethod:'Cash on Delivery'});
    const emailSent=await sendOrderEmail(order,'Order confirmed','Your Cash on Delivery order has been confirmed.');
    res.status(201).json({order:publicOrder(order),emailSent});
  }catch(error){
    if(isMongoConnectivityError(error)){
      mongoReady=false;
      return res.status(503).json({message:'Cannot reach the order database. Please try again later.'});
    }
    res.status(error.status||500).json({
      message:error.message||'Unable to place this order.',
      ...(error.currentItems?{items:error.currentItems,subtotal:error.currentTotal}:{}),
    });
  }
});

app.post('/api/payments/razorpay/order',requireCustomer,async(req,res)=>{
  if(!razorpayConfigured)return res.status(503).json({message:'Online payments are not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in backend/.env.'});
  try{
    const details=await buildOrderDetails(req.customer,req.body);
    const amount=Math.round(details.subtotal*100);
    const gatewayOrder=await razorpayRequest('orders',{method:'POST',body:{
      amount,
      currency:'INR',
      receipt:`KS${Date.now()}`,
      notes:{customerId:String(req.customer._id)},
    }});
    if(!gatewayOrder.id||gatewayOrder.amount!==amount||gatewayOrder.currency!=='INR'){
      console.error('Razorpay returned an invalid order response.');
      return res.status(502).json({message:'The payment provider returned an invalid order. Please try again.'});
    }
    const order=await Order.create({
      ...details,
      paymentMethod:'Razorpay',
      razorpayOrderId:gatewayOrder.id,
    });
    res.status(201).json({
      orderId:gatewayOrder.id,
      amount,
      currency:'INR',
      keyId:razorpayKeyId,
      order:publicOrder(order),
    });
  }catch(error){
    if(isMongoConnectivityError(error)){
      mongoReady=false;
      return res.status(503).json({message:'Cannot reach the order database. Please try again later.'});
    }
    const status=error.status||502;
    if(status===502)console.error('Unable to create Razorpay order:',error.message);
    res.status(status).json({
      message:status>=500?'Unable to start online payment. Please try again.':error.message,
      ...(error.currentItems?{items:error.currentItems,subtotal:error.currentTotal}:{}),
    });
  }
});

app.post('/api/payments/razorpay/verify',requireCustomer,async(req,res)=>{
  if(!razorpayConfigured)return res.status(503).json({message:'Online payments are not configured.'});
  if(!mongoReady)return res.status(503).json({message:'The order database is unavailable. Please try again later.'});
  const {razorpay_order_id:gatewayOrderId,razorpay_payment_id:paymentId,razorpay_signature:signature}=req.body||{};
  if(typeof gatewayOrderId!=='string'||typeof paymentId!=='string'||
    typeof signature!=='string'||!/^[a-f\d]{64}$/i.test(signature)){
    return res.status(400).json({message:'The payment response is incomplete or invalid.'});
  }
  const expectedSignature=createHmac('sha256',razorpayKeySecret)
    .update(`${gatewayOrderId}|${paymentId}`)
    .digest();
  const providedSignature=Buffer.from(signature,'hex');
  if(expectedSignature.length!==providedSignature.length||
    !timingSafeEqual(expectedSignature,providedSignature)){
    return res.status(400).json({message:'Payment verification failed. No order was marked as paid.'});
  }

  try{
    const order=await Order.findOne({razorpayOrderId:gatewayOrderId,customerId:req.customer._id});
    if(!order)return res.status(404).json({message:'This payment order was not found for your account.'});
    if(order.paymentStatus==='paid'){
      if(order.razorpayPaymentId!==paymentId)return res.status(409).json({message:'This order has already been paid with a different payment.'});
      return res.json({order:publicOrder(order)});
    }
    let payment=await razorpayRequest(`payments/${encodeURIComponent(paymentId)}`);
    const expectedAmount=Math.round(order.subtotal*100);
    if(payment.order_id!==gatewayOrderId||payment.amount!==expectedAmount||payment.currency!=='INR'){
      return res.status(400).json({message:'The payment amount does not match this order.'});
    }
    if(payment.status==='authorized'){
      payment=await razorpayRequest(`payments/${encodeURIComponent(paymentId)}/capture`,{
        method:'POST',
        body:{amount:expectedAmount,currency:'INR'},
      });
    }
    if(payment.status!=='captured'){
      return res.status(402).json({message:'Payment has not been captured. Please try another payment method.'});
    }
    const methods={upi:'UPI',card:'Card',netbanking:'Netbanking',wallet:'Wallet'};
    order.paymentMethod=methods[payment.method]||'Razorpay';
    order.razorpayPaymentId=paymentId;
    order.paymentStatus='paid';
    await order.save();
    const emailSent=await sendOrderEmail(order,'Payment confirmed','Your payment has been received and your order is confirmed.');
    res.json({order:publicOrder(order),emailSent});
  }catch(error){
    if(isMongoConnectivityError(error)){
      mongoReady=false;
      return res.status(503).json({message:'Cannot reach the order database to confirm payment. Contact the store with your payment reference.'});
    }
    console.error('Razorpay payment verification failed:',error.message);
    res.status(502).json({message:'Unable to confirm payment right now. Contact the store with your payment reference.'});
  }
});

app.get('/api/orders/mine',requireCustomer,async(req,res)=>{
  if(!mongoReady)return res.status(503).json({message:'Order history requires a connected database.'});
  try{
    const orders=await Order.find({customerId:req.customer._id}).sort({createdAt:-1}).limit(50);
    res.json(orders.map(publicOrder));
  }catch(error){
    if(isMongoConnectivityError(error))mongoReady=false;
    console.error('Unable to load customer orders:',error.message);
    res.status(500).json({message:'Unable to load your order history. Please try again.'});
  }
});
app.post('/api/orders/:id/cancel',requireCustomer,async(req,res)=>{
  if(!mongoReady)return res.status(503).json({message:'Order cancellation requires a connected database.'});
  try{
    const order=await Order.findOneAndUpdate(
      {
        _id:req.params.id,
        customerId:req.customer._id,
        orderStatus:{$in:['placed','processing']},
        paymentMethod:'Cash on Delivery',
        paymentStatus:'pending',
      },
      {$set:{orderStatus:'cancelled'}},
      {new:true,runValidators:true},
    );
    if(order)return res.json({order:publicOrder(order)});

    const existing=await Order.findOne({_id:req.params.id,customerId:req.customer._id}).select('orderStatus paymentStatus paymentMethod');
    if(!existing)return res.status(404).json({message:'Order not found.'});
    if(existing.paymentStatus==='paid')return res.status(409).json({message:'Paid orders cannot be cancelled online. Contact the store to request a cancellation and refund.'});
    if(existing.paymentMethod!=='Cash on Delivery')return res.status(409).json({message:'Online-payment orders cannot be cancelled here. Contact the store for cancellation assistance.'});
    return res.status(409).json({message:'This order can no longer be cancelled.'});
  }catch(error){
    if(error.name==='CastError')return res.status(404).json({message:'Order not found.'});
    if(isMongoConnectivityError(error))mongoReady=false;
    console.error('Unable to cancel customer order:',error.message);
    res.status(500).json({message:'Unable to cancel this order. Please try again.'});
  }
});
app.use((req,res)=>res.status(404).json({message:'Route not found'}));
const port=process.env.PORT||5000;
app.listen(port,()=>console.log(`Kanimozhi API listening on port ${port}`));
