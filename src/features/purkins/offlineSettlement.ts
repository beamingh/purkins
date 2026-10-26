import { MANUAL_CHANNELS, MANUAL_TENDERS } from './manualSale';

export interface OfflineSettlementInput {
  nonce: string;
  quoteRevision: number;
  tender: keyof typeof MANUAL_TENDERS;
  channel: keyof typeof MANUAL_CHANNELS;
  paymentReference: string | null;
  confirmationNote: string;
  fulfillment: 'fulfilled' | 'unfulfilled';
}
export type ParsedOfflineSettlement =
  | { ok:true; value:OfflineSettlementInput }
  | { ok:false; error:string };
const UUID_V4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF=/^[a-zA-Z0-9][a-zA-Z0-9 ._:/#-]{4,119}$/;

export function parseOfflineSettlement(form:FormData):ParsedOfflineSettlement {
  const raw=(name:string)=>String(form.get(name)??'').trim();
  const nonce=raw('payment_nonce').toLowerCase();
  const revisionRaw=raw('payment_quote_revision');
  const tender=raw('tender');
  const channel=raw('channel');
  const paymentReference=raw('payment_reference')||null;
  const confirmationNote=raw('payment_confirmation_note');
  const fulfillment=raw('fulfillment');
  if (!UUID_V4.test(nonce) || !/^[1-9][0-9]{0,6}$/.test(revisionRaw)) {
    return {ok:false,error:'Payment form is stale. Reload the request.'};
  }
  if (!Object.prototype.hasOwnProperty.call(MANUAL_TENDERS,tender) ||
      !Object.prototype.hasOwnProperty.call(MANUAL_CHANNELS,channel)) {
    return {ok:false,error:'Select a valid received-payment method and sales channel.'};
  }
  if (tender==='cash') {
    if (paymentReference) {
      return {ok:false,error:'Do not enter a transfer reference for a cash payment.'};
    }
    if (raw('cash_counted')!=='yes') {
      return {ok:false,error:'Count the cash in hand before recording the paid order.'};
    }
  } else {
    if (!paymentReference || !REF.test(paymentReference)) {
      return {ok:false,error:'Enter the verified recipient-side transaction reference (5–120 characters).'};
    }
    if (raw('recipient_verified')!=='yes') {
      return {ok:false,error:'Verify the money in the actual receiving account or wallet first.'};
    }
  }
  if (fulfillment!=='fulfilled' && fulfillment!=='unfulfilled') {
    return {ok:false,error:'Choose whether the goods have actually been handed over.'};
  }
  if (confirmationNote.length<8 || confirmationNote.length>1000) {
    return {ok:false,error:'Write an 8–1,000 character internal verification note.'};
  }
  if (raw('verified_received')!=='yes') {
    return {ok:false,error:'Independently verify receipt of the full quoted amount.'};
  }
  return {ok:true,value:{
    nonce,quoteRevision:Number(revisionRaw),
    tender:tender as OfflineSettlementInput['tender'],
    channel:channel as OfflineSettlementInput['channel'],
    paymentReference,confirmationNote,
    fulfillment,
  }};
}
