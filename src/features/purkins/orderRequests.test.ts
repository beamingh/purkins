import { describe, expect, it } from 'vitest';
import { parseOrderRequestForm, validateRequestCart } from './orderRequests';
import type { CartLine } from '../cart/cart';

const requestForm = (fields: Record<string,string> = {}) => {
  const form = new FormData();
  const values = {
    request_id: '5f7e6888-4a70-49c3-ae83-688724cd2d9f',
    customer_name: 'Customer Example',
    phone: '+260 97 000 1111',
    payment_preference: 'pay_on_delivery',
    fulfillment_preference: 'delivery',
    area: 'Lusaka',
    acknowledge: 'yes',
    ...fields,
  };
  for(const [key,value] of Object.entries(values))form.set(key,value);
  return form;
};
const item = (qty: number, stock = 4): CartLine => ({
  product: { id: 1, name: 'TY-899',currency:'zmw',stock,active:1,price_cents:95000 },
  variant: null, extras: [], qty,
  unitPriceCents: 95000, lineTotalCents:95000*qty,availableStock:stock,key:'prod_1234567890',
} as CartLine);

describe('Purkins unpaid order-request validation',()=>{
  it('accepts pay on delivery, phone, and a delivery area',()=>{
    const r=parseOrderRequestForm(requestForm());
    expect(r.ok).toBe(true);
    if(r.ok)expect(r.fields).toMatchObject({
      phone:'+260970001111', paymentPreference:'pay_on_delivery', fulfillmentPreference:'delivery',
      area:'Lusaka',
    });
  });
  it('allows bank/mobile payment instructions or a contact-me request',()=>{
    for(const mode of ['pay_after_instructions','contact_me']){
      expect(parseOrderRequestForm(requestForm({payment_preference:mode,fulfillment_preference:'discuss',area:''})).ok).toBe(true);
    }
  });
  it('rejects fake acknowledgements, bad phone, missing area and spam honeypots',()=>{
    for(const fields of [
      {acknowledge:'no'}, {phone:'abc'}, {area:''},
      {website:'https://spam.example'}, {payment_preference:'paid'},
      {customer_name:'a'}, {request_id:'invalid'},
    ])expect(parseOrderRequestForm(requestForm(fields)).ok).toBe(false);
  });
  it('validates stock and subtotal using server-resolved item prices',()=>{
    expect(validateRequestCart([item(2)],190000)).toBeNull();
    expect(validateRequestCart([item(5)],475000)).not.toBeNull();
    expect(validateRequestCart([item(2)],10000)).not.toBeNull();
    expect(validateRequestCart([],0)).not.toBeNull();
    expect(validateRequestCart([item(3),item(2)],475000)).not.toBeNull();
  });
});
