import {describe,it,expect} from 'vitest';
import type {D1Database,R2Bucket} from '@cloudflare/workers-types';
import {recordGuardedPaidSale,recordGuardedDispatch,settleGuardedCodPayment} from './salesGuard';
import {uploadGuardedPurkinsMedia} from './photoUploadGuard';
import {fulfillGuardedPurkinsOrder} from './fulfillmentGuard';
const db={} as D1Database;
const uuid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
describe('MCP operator actions fail closed before D1 writes',()=>{
  it('does not accept a paid order whose expected payment total differs from item total',async()=>{
    const result=await recordGuardedPaidSale(db,'owner:bearer',{
      request_id:uuid,channel:'facebook',tender:'cash',customer_name:null,
      email:null,note:null,fulfillment:'unfulfilled',delivery_method:'pickup',
      items:[{product_id:'prod_0123456789',variant_id:null,quantity:1,unit_price_cents:95000}],
      expected_total_cents:1,confirm_funds_received:true,
    });
    expect(result).toMatchObject({ok:false,conflict:true});
  });
  it('rejects courier updates without an existing prefixed request reference',async()=>{
    const result=await recordGuardedDispatch(db,'owner:bearer',{
      request_id:uuid,request_public_id:'not-an-order-request',expected_revision:0,
      status:'planned',source_channel:'facebook_page',courier:'yango_bike',
      pickup_location:'Shop counter',dropoff_location:'Lusaka area',
      recipient_name:'Test Buyer',recipient_phone:'0977000000',
      rider_name:null,rider_phone:null,booking_reference:null,
      courier_fee_cents:null,courier_fee_payer:'not_agreed',
      courier_fee_state:'unconfirmed',operator_note:null,
    });
    expect(result).toMatchObject({ok:false,conflict:true});
  });
  it('rejects COD settlement without explicit recipient-side verification',async()=>{
    const result=await settleGuardedCodPayment(db,'owner:bearer',{
      request_id:uuid,request_public_id:'req_0123456789',quote_revision:1,
      tender:'mtn_momo',channel:'facebook',payment_reference:'REF-123456',
      confirmation_note:'Funds not verified',fulfillment:'unfulfilled',
      confirm_funds_received:true,confirm_recipient_account_verified:false as true,
    });
    expect(result).toMatchObject({ok:false,conflict:true});
  });
  it('rejects unsupported image types before touching media storage',async()=>{
    const result=await uploadGuardedPurkinsMedia(db,{} as R2Bucket,'owner:bearer',{
      request_id:uuid,product_id:'prod_0123456789',original_name:'item.svg',
      mime_type:'image/svg+xml',image_base64:'SGVsbG8sIHdvcmxkIQ==',confirm_upload:true,
    });
    expect(result).toMatchObject({ok:false,conflict:true});
  });
  it('never records a handover with an invalid request UUID',async()=>{
    const result=await fulfillGuardedPurkinsOrder(db,'owner:bearer',{
      request_id:'wrong',order_public_id:'ord_0123456789',tracking_carrier:null,
      tracking_number:null,confirm_handed_over:true,
    });
    expect(result).toMatchObject({ok:false,conflict:true});
  });
});
