import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { cartKey } from '../../../../features/cart/key';
import { resolveCart, type Cart } from '../../../../features/cart/cart';
import { parsePublicId } from '../../../../features/ids/publicId';
import { parseOrderRequestForm } from '../../../../features/purkins/orderRequests';
import { createOrderRequest } from '../../../../features/purkins/orderRequestDb';
import { DELIVERY_SOURCES } from '../../../../features/purkins/courierDelivery';

export const prerender=false;

/** Admin-only intake from Facebook, Marketplace, WhatsApp etc. Never a paid sale. */
export const POST:APIRoute=async({request,redirect})=>{
  const fail=(message:string)=>redirect(
    '/admin/order-requests/new?error='+encodeURIComponent(message),303,
  );
  const form=await request.formData();
  const source=String(form.get('source_channel')??'').trim();
  if(!Object.hasOwn(DELIVERY_SOURCES,source)) return fail('Choose where this order originated.');
  if(form.get('customer_contacted')!=='yes') {
    return fail('Only enter orders from customers you have actually spoken to.');
  }
  const choices=form.getAll('item').map(String);
  const quantities=form.getAll('quantity').map(String);
  if(choices.length<1||choices.length>25||choices.length!==quantities.length) {
    return fail('Add 1–25 complete catalog lines.');
  }
  const cart:Cart={};
  for(let i=0;i<choices.length;i++){
    const pieces=choices[i].split('|');
    if(pieces.length!==2) return fail('Choose a valid product and size.');
    const pid=parsePublicId(pieces[0],'product');
    const vid=pieces[1]?parsePublicId(pieces[1],'variant'):null;
    if(!pid||(pieces[1]&&!vid))return fail('Choose an existing product and size.');
    const quantity=quantities[i];
    if(!/^[1-9][0-9]{0,1}$/.test(quantity)||Number(quantity)>50) {
      return fail('Enter a quantity of 1–50 for each item.');
    }
    const key=cartKey(pid,vid);
    cart[key]=(cart[key]??0)+Number(quantity);
  }
  const {lines,subtotalCents}=await resolveCart(env.DB,cart);
  if(lines.length!==Object.keys(cart).length) {
    return fail('One or more products are not available in the selected size.');
  }
  const parsed=parseOrderRequestForm(form);
  if(!parsed.ok)return fail(parsed.error);
  const prefixedNote='Sales source: '+DELIVERY_SOURCES[source as keyof typeof DELIVERY_SOURCES]+
    (parsed.fields.customerNote?'\n'+parsed.fields.customerNote:'');
  if(prefixedNote.length>500) return fail('Customer note is too long.');
  // Unlike the shopper form, the owner is submitting after speaking to the
  // buyer. Product price and stock are still fully recalculated from D1.
  const fields={...parsed.fields,customerNote:prefixedNote};
  const result=await createOrderRequest(env.DB,fields,lines,subtotalCents);
  return result.ok
    ? redirect('/admin/order-requests/'+result.publicId+'?created=1',303)
    : fail(result.error);
};
