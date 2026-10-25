import {describe,it,expect} from 'vitest';
import {canCreateCheckout,canCreateScopedCheckout,canWriteAsOperator,MCP_OWNER_READ_TOOLS,MCP_ALL_TOOLS} from './clientScope';

describe('Purkins owner client scope',()=>{
  it('never exposes checkout or privileged writes to a dashboard token',()=>{
    for(const value of ['true','false',undefined]){
      expect(canCreateCheckout({readOnly:true})).toBe(false);
      expect(canWriteAsOperator({readOnly:true},value)).toBe(false);
    }
    expect(MCP_OWNER_READ_TOOLS).toContain('review_purkins_draft');
    expect(MCP_OWNER_READ_TOOLS).toContain('list_purkins_stock');
    expect(MCP_OWNER_READ_TOOLS).not.toContain('create_checkout');
    expect(MCP_OWNER_READ_TOOLS).not.toContain('approve_purkins_stock');
  });

  it('full permissions still obey the global checkout/stock kill switch',()=>{
    expect(canCreateScopedCheckout({toolPermissions:MCP_ALL_TOOLS,readOnly:false},'false')).toBe(false);
    expect(canCreateScopedCheckout({toolPermissions:MCP_ALL_TOOLS,readOnly:false},undefined)).toBe(false);
    expect(canCreateScopedCheckout({toolPermissions:MCP_ALL_TOOLS,readOnly:false},'true')).toBe(true);
    expect(canCreateScopedCheckout({toolPermissions:MCP_OWNER_READ_TOOLS,readOnly:true},'true')).toBe(false);
    // Preexisting public buyer/legacy checkout behavior must not be regressed.
    expect(canCreateScopedCheckout(undefined,'false')).toBe(true);
    expect(canCreateScopedCheckout({readOnly:false},'false')).toBe(true);
  });

  it('preserves legacy operator boundaries and buyer checkout',()=>{
    expect(canCreateCheckout({readOnly:false})).toBe(true);
    expect(canCreateCheckout(undefined)).toBe(true);
    expect(canWriteAsOperator({readOnly:false},'true')).toBe(true);
    expect(canWriteAsOperator({readOnly:false},'false')).toBe(false);
    expect(canWriteAsOperator(undefined,'true')).toBe(true);
  });
});
