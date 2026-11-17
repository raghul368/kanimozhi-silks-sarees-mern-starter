import mongoose from 'mongoose';

const virtualTryOnHistorySchema=new mongoose.Schema({
  personImage:{type:Buffer,required:true},
  personMimeType:{type:String,required:true},
  sareeImage:{type:Buffer,required:true},
  sareeMimeType:{type:String,required:true},
  previewImage:{type:Buffer,required:true},
  previewMimeType:{type:String,required:true},
},{timestamps:true});

virtualTryOnHistorySchema.index(
  {createdAt:1},
  {expireAfterSeconds:30*24*60*60}
);

export default mongoose.model('VirtualTryOnHistory',virtualTryOnHistorySchema);
