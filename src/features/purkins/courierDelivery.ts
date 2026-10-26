import { parseSalePrice } from './manualSale';

export const DELIVERY_STATUSES = {
  planned: 'Dispatch planned',
  dispatched: 'Parcel with rider',
  delivered: 'Rider reports delivered — payment checked separately',
  delivery_failed: 'Delivery unsuccessful / parcel whereabouts to confirm',
  returned: 'Parcel physically returned to Purkins',
} as const;
export const DELIVERY_SOURCES = {
  facebook_page: 'Facebook Page',
  facebook_marketplace: 'Facebook Marketplace',
  whatsapp: 'WhatsApp',
  website: 'Website',
  phone: 'Phone',
  other: 'Other',
} as const;
export const COURIERS = { yango_bike: 'Yango Bike', other: 'Other courier' } as const;
export const COURIER_FEE_PAYERS = {
  customer_to_rider: 'Customer pays courier directly (not Purkins revenue)',
  purkins: 'Purkins pays courier (customer delivery charge is in Purkins quote if agreed)',
  not_agreed: 'Not agreed / awaiting fare quote',
} as const;

export type DeliveryStatus = keyof typeof DELIVERY_STATUSES;
export interface CourierDeliveryInput {
  nonce: string;
  expectedRevision: number;
  status: DeliveryStatus;
  sourceChannel: keyof typeof DELIVERY_SOURCES;
  courier: keyof typeof COURIERS;
  pickupLocation: string;
  dropoffLocation: string;
  recipientName: string;
  recipientPhone: string;
  riderName: string | null;
  riderPhone: string | null;
  bookingReference: string | null;
  courierFeeCents: number | null;
  courierFeePayer: keyof typeof COURIER_FEE_PAYERS;
  operatorNote: string | null;
}
export type ParsedCourierDelivery =
  | { ok: true; value: CourierDeliveryInput }
  | { ok: false; error: string };

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHONE=/^\+?[0-9]{9,15}$/;

export function allowedDeliveryTransition(
  before: DeliveryStatus | null, after: DeliveryStatus,
): boolean {
  if (before===null) return after==='planned';
  if (before===after) return before!=='returned';
  switch(before) {
    case 'planned': return after==='dispatched'||after==='returned';
    case 'dispatched': return after==='delivered'||after==='delivery_failed'||after==='returned';
    case 'delivery_failed': return after==='dispatched'||after==='returned';
    case 'delivered': return after==='returned';
    case 'returned': return false;
  }
}

export function parseCourierDelivery(form:FormData):ParsedCourierDelivery {
  const raw=(key:string)=>String(form.get(key)??'').trim();
  const nullable=(key:string)=>raw(key)||null;
  const nonce=raw('delivery_nonce').toLowerCase();
  const revision=raw('delivery_revision');
  const status=raw('delivery_status');
  const sourceChannel=raw('source_channel');
  const courier=raw('courier');
  const pickupLocation=raw('pickup_location');
  const dropoffLocation=raw('dropoff_location');
  const recipientName=raw('recipient_name');
  const recipientPhone=raw('recipient_phone').replace(/[\s()-]/g,'');
  const riderName=nullable('rider_name');
  const riderPhone=nullable('rider_phone')?.replace(/[\s()-]/g,'')??null;
  const bookingReference=nullable('booking_reference');
  const courierFeePayer=raw('courier_fee_payer');
  const feeRaw=raw('courier_fee');
  const courierFeeCents=feeRaw?parseSalePrice(feeRaw):null;
  const operatorNote=nullable('delivery_note');

  if (!UUID.test(nonce)||!/^(?:0|[1-9][0-9]{0,6})$/.test(revision)) {
    return {ok:false,error:'Reload the dispatch form before submitting.'};
  }
  if (!Object.hasOwn(DELIVERY_STATUSES,status)||!Object.hasOwn(DELIVERY_SOURCES,sourceChannel)||
      !Object.hasOwn(COURIERS,courier)||!Object.hasOwn(COURIER_FEE_PAYERS,courierFeePayer)) {
    return {ok:false,error:'Choose a valid dispatch status, source, courier and fee arrangement.'};
  }
  if (pickupLocation.length<5||pickupLocation.length>500||
      dropoffLocation.length<5||dropoffLocation.length>500||
      recipientName.length<2||recipientName.length>100||!PHONE.test(recipientPhone)) {
    return {ok:false,error:'Enter the actual pickup and drop-off places, recipient name and reachable number.'};
  }
  if ((riderName?.length??0)>100||(riderPhone&&!PHONE.test(riderPhone))||
      (bookingReference?.length??0)>120||(operatorNote?.length??0)>1000) {
    return {ok:false,error:'One of the rider or dispatch details is invalid or too long.'};
  }
  if (feeRaw&&courierFeeCents===null) {
    return {ok:false,error:'Enter a valid courier fee in ZMW (up to two decimal places).'};
  }
  if (['dispatched','delivered','delivery_failed'].includes(status) &&
      !bookingReference&&!riderName) {
    return {ok:false,error:'Record a Yango booking reference or rider name before dispatch.'};
  }
  if (status==='returned' && (!operatorNote||operatorNote.length<8)) {
    return {ok:false,error:'For a return, record how you confirmed the parcel was physically received back.'};
  }
  return {ok:true,value:{
    nonce,expectedRevision:Number(revision),status:status as DeliveryStatus,
    sourceChannel:sourceChannel as CourierDeliveryInput['sourceChannel'],
    courier:courier as CourierDeliveryInput['courier'],
    pickupLocation,dropoffLocation,recipientName,recipientPhone,
    riderName,riderPhone,bookingReference,courierFeeCents,
    courierFeePayer:courierFeePayer as CourierDeliveryInput['courierFeePayer'],
    operatorNote,
  }};
}
