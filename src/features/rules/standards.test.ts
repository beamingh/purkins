import {describe,it,expect} from 'vitest';
import {
  RULE_KINDS,RULE_SCOPES,normalizeRuleKey,validSlug,validateRuleConfig,normalizeReferenceIds,
} from './standards';

describe('general Purkins Rules & Standards validation',()=>{
  it('supports all four inheritance levels and three editorial rule types',()=>{
    expect(RULE_SCOPES).toEqual(['global','preset','category','product']);
    expect(RULE_KINDS).toEqual(['guidance','policy','procedure']);
    expect(normalizeRuleKey('pricing','price-guidelines','global','')).toEqual({
      category_slug:'pricing',rule_slug:'price-guidelines',scope:'global',target_id:'',
    });
    expect(normalizeRuleKey('stock-intake','condition-grading','product','PROD_0000000001').target_id)
      .toBe('prod_0000000001');
    expect(()=>normalizeRuleKey('pricing','price-guidelines','global','foo')).toThrow();
    expect(()=>normalizeRuleKey('pricing','price-guidelines','product','123')).toThrow();
    expect(()=>normalizeRuleKey('pricing','price-guidelines','preset','../bad')).toThrow();
  });
  it('validates structured operational rules without invoking any business logic',()=>{
    const rule=validateRuleConfig({
      title:'Discount authorisation',kind:'policy',
      instructions:'Obtain owner approval before approving a discount.',
      criteria:'A customer asks for a negotiated price',
      fields:{discount_threshold_percent:10,allow_override:false},
      actions:['Check price','Ask owner'],tags:['sales'],
    });
    expect(rule.fields).toEqual({discount_threshold_percent:10,allow_override:false});
    expect(rule.kind).toBe('policy');
    expect(()=>validateRuleConfig({kind:'automatic_enforced'})).toThrow();
    expect(()=>validateRuleConfig({fields:{secret:{nested:true}}})).toThrow();
    expect(()=>validateRuleConfig({unknown:'danger'})).toThrow();
    expect(()=>validateRuleConfig({instructions:'x'.repeat(12001)})).toThrow();
  });
  it('retains photography-specific structure within the same generic system',()=>{
    expect(validateRuleConfig({aspect_ratio:'4:5',target_width:1080,target_height:1350,
      composite_allowed:true,required_shots:['Front','Detail']})).toMatchObject({
      aspect_ratio:'4:5',target_width:1080,target_height:1350,composite_allowed:true,
    });
    expect(()=>validateRuleConfig({aspect_ratio:'16/9'})).toThrow();
    expect(()=>validateRuleConfig({target_height:-1})).toThrow();
  });
  it('only permits approved media IDs and short slugs',()=>{
    expect(validSlug('custom-production')).toBe(true);
    expect(validSlug('A BAD CATEGORY')).toBe(false);
    expect(normalizeReferenceIds(['MED_0000000001','med_0000000001','med_0000000002']))
      .toEqual(['med_0000000001','med_0000000002']);
    expect(()=>normalizeReferenceIds(['https://example.com/anything'])).toThrow();
    expect(()=>normalizeReferenceIds(Array(13).fill('med_0000000001'))).toThrow();
  });
});
