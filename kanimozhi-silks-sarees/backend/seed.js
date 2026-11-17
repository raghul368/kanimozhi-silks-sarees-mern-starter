import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from './src/models/Product.js';
import { seedProducts } from './src/seedProducts.js';
dotenv.config();
if(!process.env.MONGO_URI){console.error('Set MONGO_URI in .env');process.exit(1);}
try{
  await mongoose.connect(process.env.MONGO_URI);
  const operations=seedProducts.map(product=>({
    updateOne:{
      filter:{id:product.id},
      update:{$setOnInsert:{...product,active:true}},
      upsert:true,
    },
  }));
  const result=await Product.bulkWrite(operations);
  const previousImages=[
    'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=900&q=85',
    'https://images.unsplash.com/photo-1583391733956-6c78276477e7?auto=format&fit=crop&w=900&q=85',
    'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?auto=format&fit=crop&w=900&q=85',
    'https://images.unsplash.com/photo-1610030469668-8e9f641aaf2b?auto=format&fit=crop&w=900&q=85',
    'https://images.unsplash.com/photo-1610189012906-4c7fbd7d8e3f?auto=format&fit=crop&w=900&q=85',
  ];
  const imageUpdates=seedProducts.map(product=>({
    updateOne:{
      filter:{id:product.id,image:{$in:previousImages}},
      update:{$set:{image:product.image,imageCredit:product.imageCredit}},
    },
  }));
  const updated=await Product.bulkWrite(imageUpdates);
  const customProductDetails=[
    {
      id:'KS1794407650043',
      name:'Rust Orange Banarasi Saree with Gold Zari Border',
      color:'Rust Orange',
      description:'Rust-orange saree with a red and gold-toned border, shown in a full-length drape.',
    },
    {
      id:'KS1794233163872',
      name:'Ruby Red Silk Saree with Green and Gold Border',
      color:'Ruby Red',
      description:'Ruby-red saree with a contrasting green and gold-toned border.',
    },
  ];
  const nameUpdates=[
    ...seedProducts.map(product=>({
      updateOne:{
        filter:{id:product.id},
        update:{$set:{name:product.name,color:product.color,description:product.description}},
      },
    })),
    ...customProductDetails.map(product=>({
      updateOne:{
        filter:{id:product.id},
        update:{$set:{name:product.name,color:product.color,description:product.description}},
      },
    })),
  ];
  const renamed=await Product.bulkWrite(nameUpdates);
  console.log(`Added ${result.upsertedCount} new sarees, updated ${updated.modifiedCount} repeated sample images, and renamed ${renamed.modifiedCount} products; existing custom images were kept.`);
}catch(error){
  console.error('Unable to seed sarees:',error.message);
  process.exitCode=1;
}finally{
  await mongoose.disconnect();
}
