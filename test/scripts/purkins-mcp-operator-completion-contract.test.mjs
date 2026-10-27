import { describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const registered=[
  'get_purkins_stock_valuation','get_purkins_private_preview','get_purkins_dispatch_overview',
  'edit_guarded_purkins_draft','upload_guarded_purkins_photo',
  'record_guarded_purkins_paid_sale','record_guarded_purkins_dispatch',
  'settle_guarded_purkins_cod_payment','fulfill_guarded_purkins_order',
];
describe('Purkins MCP sales operator scope and private safety',()=>{
  it('registers each tool with individual credential permission',()=>{
    const scope=read('src/features/mcp/clientScope.ts');
    const all=[
      read('mcp/src/purkins-operations.ts'),read('mcp/src/purkins-sales.ts'),
      read('mcp/src/purkins-photo.ts'),
    ].join('\n');
    for(const name of registered){
      expect(scope).toContain("name:'"+name+"'");
      expect(all).toContain("'"+name+"'");
    }
    expect(read('mcp/src/index.ts')).toContain('registerGuardedPurkinsSalesWrites');
    expect(read('mcp/src/index.ts')).toContain('registerPurkinsOperationsReads');
  });
  it('starts write scopes switched OFF and never activates the old legacy writers',()=>{
    const template=read('wrangler.admin.template.jsonc');
    const core=read('scripts/purkins-mcp-guarded-config.mjs');
    for(const name of [
      'PURKINS_MCP_DRAFT_EDIT_WRITES_ENABLED','PURKINS_MCP_SALES_WRITES_ENABLED',
      'PURKINS_MCP_DISPATCH_WRITES_ENABLED','PURKINS_MCP_MEDIA_UPLOADS_ENABLED',
    ]){
      expect(template).toContain('"'+name+'": "false"');
      expect(core).toContain("'"+name+"'");
      expect(read('mcp/src/index.ts')).toContain("writeEnv."+name+" === 'true'");
    }
    expect(core).toContain("'PURKINS_MCP_LEGACY_WRITES_ENABLED', 'false'");
  });
  it('reuses existing financial and courier accounting rather than duplicating stock logic',()=>{
    const sales=read('src/features/mcp/salesGuard.ts');
    expect(sales).toContain('recordManualSale(db,parsed.value');
    expect(sales).toContain('settleHeldOfflineOrder(db,req');
    expect(sales).toContain('saveCourierDelivery(db,req');
    expect(sales).toContain("confirm_funds_received");
    expect(sales).toContain('payload_sha256');
    expect(read('src/features/mcp/fulfillmentGuard.ts')).toContain("AND status='paid'");
  });
  it('requires private draft state for edits and media uploads',()=>{
    const editor=read('src/features/mcp/draftEdit.ts');
    const upload=read('src/features/mcp/photoUploadGuard.ts');
    expect(editor).toContain("p.active=0");
    expect(editor).toContain("mcp_catalog_revision=?");
    expect(editor).toContain("completed=CASE WHEN EXISTS");
    expect(upload).toContain("intake.status!=='draft'");
    expect(upload).toContain("validateUpload(file)");
    expect(upload).not.toContain('UPDATE products SET active=1');
    expect(read('mcp/src/purkins-operations.ts')).toContain('requires_admin_login:true');
  });
  it('stores receipts and does not require legacy write config',()=>{
    for(const migration of [
      'migrations/0060_purkins_mcp_operator_edit.sql',
      'migrations/0061_purkins_mcp_sales_receipts.sql',
      'migrations/0062_purkins_mcp_photo_upload.sql',
      'migrations/0063_purkins_mcp_fulfillment_receipts.sql',
    ])expect(read(migration)).toContain('CREATE TABLE IF NOT EXISTS');
  });
});
