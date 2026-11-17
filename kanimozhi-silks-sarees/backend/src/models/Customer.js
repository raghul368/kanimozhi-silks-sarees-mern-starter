import mongoose from 'mongoose';

const customerSchema=new mongoose.Schema({
  username:{type:String,trim:true,lowercase:true,unique:true,sparse:true},
  name:{type:String,required:true,trim:true,maxlength:100},
  email:{type:String,required:true,trim:true,lowercase:true,unique:true,maxlength:254},
  passwordHash:{type:String,default:null},
  googleId:{type:String,unique:true,sparse:true},
},{timestamps:true});

export default mongoose.model('Customer',customerSchema);
