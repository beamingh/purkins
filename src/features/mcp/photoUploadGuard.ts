import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { getProductByPublicId } from '../products/db';
import { getIntake } from '../purkins/db';
import { parsePublicId } from '../ids/publicId';
import { readImageDimensions } from '../media/dimensions';
import { uploadMedia, validateUpload } from '../media/upload';
import { createR2Storage } from '../storage/r2';
import { requireVerifiedOwnerActorShape } from './ownerActor';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME=['image/jpeg','image/png','image/webp','image/gif'];
type Receipt={actor:string;product_public_id:string;payload_sha256:string;
  media_public_id:string|null;completed:number};
const conflict=(error:string)=>({ok:false,error,conflict:true});
export interface PhotoUploadInput {
  request_id:string;product_id:string;original_name:string;
  mime_type:string;image_base64:string;confirm_upload:true;
}
/**
 * Upload an image directly to the private media library, ready for attachment
 * with attach_guarded_purkins_photo. No gallery mutation or publication occurs.
 * Uses a stable UUID + content hash. Failed uncertain storage operations can
 * leave orphaned media to reconcile; they cannot change a customer's listing.
 */
export async function uploadGuardedPurkinsMedia(
  db:D1Database,bucket:R2Bucket,actorRaw:string,input:PhotoUploadInput,
){
  const actor=requireVerifiedOwnerActorShape(actorRaw);
  const id=parsePublicId(input.product_id,'product');
  if(!UUID.test(input.request_id)||!id||input.confirm_upload!==true)return conflict('Valid owner upload ID, prod_ item and confirmation required.');
  if(!MIME.includes(input.mime_type)||!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,99}$/.test(input.original_name))
    return conflict('Use a safe filename and JPEG, PNG, WebP or GIF.');
  const b64=input.image_base64;
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)||b64.length>7_000_000||b64.length<16)
    return conflict('Supply base64 image data (5 MB maximum), without a data URL prefix.');
  const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
  if(bytes.byteLength>5*1024*1024||!readImageDimensions(bytes))
    return conflict('Unsupported, corrupt or oversized image.');
  const filename=input.original_name;
  const file=new File([bytes],filename,{type:input.mime_type});
  const validation=validateUpload(file);
  if(validation)return conflict(validation);
  const product=await getProductByPublicId(db,id);
  const intake=product?await getIntake(db,product.id):null;
  if(!product||!intake||product.active!==0||intake.status!=='draft')
    return conflict('Upload only for an existing unpublished stock draft.');
  const raw=JSON.stringify({id,filename,mime:input.mime_type,b64});
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
  const hash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
  const key=input.request_id.toLowerCase();
  await db.prepare('INSERT INTO purkins_mcp_photo_upload_receipts '+
    '(request_id,actor,product_public_id,payload_sha256) VALUES(?,?,?,?) '+
    'ON CONFLICT(request_id) DO NOTHING').bind(key,actor,id,hash).run();
  const receipt=await db.prepare('SELECT actor,product_public_id,payload_sha256,'+
    'media_public_id,completed FROM purkins_mcp_photo_upload_receipts WHERE request_id=?')
    .bind(key).first<Receipt>();
  if(!receipt||receipt.actor!==actor||receipt.product_public_id!==id||receipt.payload_sha256!==hash)
    return conflict('Request ID belongs to a different image, product or operator.');
  if(receipt.completed===1&&receipt.media_public_id)
    return {ok:true,media_id:receipt.media_public_id,replayed:true,attached:false};
  // On an uncertain failure, retry the identical UUID and payload. Only
  // a completed receipt claims success; the owner may need to remove an orphan.
  const media=await uploadMedia(db,createR2Storage(bucket),file,filename);
  if(!media.public_id)throw Error('Uploaded media is missing public ID.');
  await db.prepare('UPDATE purkins_mcp_photo_upload_receipts SET media_public_id=?,completed=1 '+
    'WHERE request_id=? AND actor=? AND payload_sha256=? AND completed=0')
    .bind(media.public_id,key,actor,hash).run();
  return {ok:true,media_id:media.public_id,replayed:false,attached:false,
    next_step:'attach_guarded_purkins_photo using a new UUID and current gallery_revision'};
}
