import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { D1Database } from '@cloudflare/workers-types';
import { z } from 'zod';
import { getDispatchOverview } from '../../src/features/purkins/dispatchOverview';
import {
  recordGuardedPaidSale,recordGuardedDispatch,settleGuardedCodPayment,
} from '../../src/features/mcp/salesGuard';

const result=(data:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(data,null,2)}]});
const uuid=z.string().uuid();
const money=z.number().int().nonnegative().max(999_999_999);
const channel=z.enum(['walk_in','whatsapp','facebook','phone','other']);
const tender=z.enum(['cash','airtel_money','mtn_momo','zamtel_money','bank_transfer','other']);
const fulfillment=z.enum(['fulfilled','unfulfilled']);
export function registerPurkinsSalesReads(server:McpServer,db:D1Database){
  server.registerTool('get_purkins_dispatch_overview',{
    description:'Read private Facebook/Marketplace delivery queue and status. A courier report never establishes that Purkins received payment. Up to 250 prioritized records.',
    inputSchema:{},
  },async()=>result(await getDispatchOverview(db)));
}
export function registerGuardedPurkinsSalesWrites(
  server:McpServer,db:D1Database,actor:string|undefined,
  allowSales:boolean,allowDispatch:boolean,
){
  if(!actor)return;
  if(allowSales){
    server.registerTool('record_guarded_purkins_paid_sale',{
      description:'OWNER ONLY. Record a FULLY PAID walk-in/Facebook/WhatsApp/manual sale, only AFTER money is counted or confirmed in the receiving account. Creates a canonical paid order and deducts inventory exactly once through the established Admin D1 transaction. Confirm amount in ZMW and use same UUIDv4 on retries. NOT for unpaid cash-on-delivery requests.',
      inputSchema:{
        request_id:uuid,channel,tender,customer_name:z.string().max(120).nullable(),
        email:z.string().email().max(254).nullable(),note:z.string().max(1000).nullable(),
        fulfillment,delivery_method:z.enum(['pickup','shipping']),
        items:z.array(z.object({
          product_id:z.string().regex(/^prod_[0-9a-z]+$/),
          variant_id:z.string().regex(/^var_[0-9a-z]+$/).nullable(),
          quantity:z.number().int().min(1).max(9999),
          unit_price_cents:money,
        })).min(1).max(30),
        expected_total_cents:z.number().int().positive().max(99_999_999_999),
        confirm_funds_received:z.literal(true),
      },
    },async(args)=>{
      try{return result(await recordGuardedPaidSale(db,actor,args));}
      catch{return result({error:'Payment recording uncertain. Inspect orders and retry exactly the SAME request_id and payload, never a fresh ID for the same transaction.'});}
    });
    server.registerTool('settle_guarded_purkins_cod_payment',{
      description:'OWNER ONLY. Convert an already held Facebook/Marketplace order request into one paid order AFTER FULL quoted funds have been verified on the receiving MTN/Airtel/Zamtel/bank account, or physically counted for cash. Requires quote revision and verified receipt note. Never treats rider delivery or buyer screenshot as payment.',
      inputSchema:{
        request_id:uuid,request_public_id:z.string().regex(/^req_[0-9a-z]+$/),
        quote_revision:z.number().int().positive(),tender,channel,
        payment_reference:z.string().min(5).max(120).nullable(),
        confirmation_note:z.string().min(8).max(1000),fulfillment,
        confirm_funds_received:z.literal(true),
        confirm_recipient_account_verified:z.literal(true),
      },
    },async(args)=>{
      try{return result(await settleGuardedCodPayment(db,actor,args));}
      catch{return result({error:'COD settlement uncertain. Check the actual paid order before retrying the SAME request_id and payload.'});}
    });
  }
  if(allowDispatch){
    server.registerTool('record_guarded_purkins_dispatch',{
      description:'OWNER ONLY. Create/update a manually verified Yango Bike courier log for a quoted, allocated order request. Uses optimistic revision, durable receipt and append-only dispatch events; never creates a paid order, stock decrement or evidence of funds.',
      inputSchema:{
        request_id:uuid,request_public_id:z.string().regex(/^req_[0-9a-z]+$/),
        expected_revision:z.number().int().nonnegative(),
        status:z.enum(['planned','dispatched','delivered','delivery_failed','returned']),
        source_channel:z.enum(['facebook_page','facebook_marketplace','whatsapp','website','phone','other']),
        courier:z.enum(['yango_bike','other']),pickup_location:z.string().min(5).max(500),
        dropoff_location:z.string().min(5).max(500),
        recipient_name:z.string().min(2).max(100),recipient_phone:z.string().min(9).max(24),
        rider_name:z.string().max(100).nullable(),rider_phone:z.string().max(24).nullable(),
        booking_reference:z.string().max(120).nullable(),courier_fee_cents:money.nullable(),
        courier_fee_payer:z.enum(['customer_to_rider','purkins','not_agreed']),
        courier_fee_state:z.enum(['unconfirmed','customer_reports_paid','purkins_paid']),
        operator_note:z.string().max(1000).nullable(),
      },
    },async(args)=>{
      try{return result(await recordGuardedDispatch(db,actor,args));}
      catch{return result({error:'Dispatch update uncertain. Refresh the delivery log and retry exactly the SAME request_id.'});}
    });
  }
}
