import { describe,it,expect } from 'vitest';
import {
  DOMAINS,DEFAULT_PRESETS,normalizeCreativeKey,validateCreativeConfig,
  normalizeReferenceIds,isDomain,
} from './standards';

describe('Purkins creative standards validation',()=>{
  it('has reusable brand domains and four approved default presets',()=>{
    expect(DOMAINS).toEqual(['photography','naming','descriptions','social']);
    expect(DEFAULT_PRESETS).toEqual(['studio-product','feature-composite','purkins-kitchen','lifestyle']);
    expect(isDomain('photography')).toBe(true);
    expect(isDomain('private')).toBe(false);
  });
  it('enforces stable public IDs and the global target',()=>{
    expect(normalizeCreativeKey('photography','global','')).toEqual({
      domain:'photography',scope:'global',target_id:'',
    });
    expect(()=>normalizeCreativeKey('photography','global','prod_0000000001')).toThrow();
    expect(normalizeCreativeKey('photography','product','PROD_0000000001').target_id)
      .toBe('prod_0000000001');
    expect(()=>normalizeCreativeKey('photography','product','123')).toThrow();
    expect(()=>normalizeCreativeKey('photography','preset','../../admin')).toThrow();
  });
  it('supports partial category and product overrides without altering inherited fields',()=>{
    expect(validateCreativeConfig({background:'White studio',composite_allowed:false}))
      .toEqual({background:'White studio',composite_allowed:false});
    expect(validateCreativeConfig({aspect_ratio:'4:5',target_width:1080,target_height:1350,
      required_shots:['Main','Label close-up']})).toEqual({
      aspect_ratio:'4:5',target_width:1080,target_height:1350,required_shots:['Main','Label close-up'],
    });
    expect(()=>validateCreativeConfig({aspect_ratio:'wrong'})).toThrow();
    expect(()=>validateCreativeConfig({target_width:0})).toThrow();
    expect(()=>validateCreativeConfig({admin_password:'hidden'})).toThrow();
    expect(()=>validateCreativeConfig({required_shots:Array(21).fill('Main')})).toThrow();
  });
  it('accepts only approved media ID shapes, removes duplicates and limits attachments',()=>{
    expect(normalizeReferenceIds(['MED_0000000001','med_0000000001','med_0000000002']))
      .toEqual(['med_0000000001','med_0000000002']);
    expect(()=>normalizeReferenceIds(['https://external.example/photo.png'])).toThrow();
    expect(()=>normalizeReferenceIds(['med_0000000001','prod_0000000001'])).toThrow();
    expect(()=>normalizeReferenceIds(Array.from({length:13},(_,i)=>'med_'+String(i).padStart(10,'0')))).toThrow();
  });
});
