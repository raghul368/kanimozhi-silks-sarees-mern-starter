import mongoose from 'mongoose';
const productSchema=new mongoose.Schema({
  id:{type:String,required:true,unique:true,index:true},
  name:{type:String,required:true,trim:true},
  category:{type:String,required:true},
  price:{type:Number,required:true,min:0},
  oldPrice:{type:Number,default:null},
  tag:{type:String,default:''},
  color:{type:String,default:''},
  image:{type:String,required:true},
  imageCredit:{
    artist:{type:String},
    license:{type:String},
    licenseUrl:{type:String},
    page:{type:String},
  },
  description:{type:String,default:''},
  active:{type:Boolean,default:true}
},{timestamps:true});
export default mongoose.model('Product',productSchema);
