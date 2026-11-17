import mongoose from 'mongoose';
const orderSchema=new mongoose.Schema({
 customerId:{type:mongoose.Schema.Types.ObjectId,required:true,index:true,ref:'Customer'},
 customer:{name:{type:String,required:true},email:{type:String,required:true},phone:{type:String,required:true}},
 shippingAddress:{address:{type:String,required:true},city:{type:String,required:true},state:{type:String,required:true},postal:{type:String,required:true},country:{type:String,required:true,default:'India'}},
 items:[{productId:String,name:String,quantity:Number,unitPrice:Number}],
 subtotal:{type:Number,required:true,min:0},
 paymentMethod:{type:String,enum:['UPI','Card','Netbanking','Wallet','Cash on Delivery','Razorpay'],required:true},
 carrier:{type:String,default:''},
 trackingNumber:{type:String,default:''},
 trackingUrl:{type:String,default:''},
 razorpayOrderId:{type:String,index:true,sparse:true},
 razorpayPaymentId:{type:String,default:''},
 paymentStatus:{type:String,enum:['pending','paid','failed'],default:'pending'},
 orderStatus:{type:String,enum:['placed','processing','shipped','delivered','cancelled'],default:'placed'}
},{timestamps:true});
export default mongoose.model('Order',orderSchema);
