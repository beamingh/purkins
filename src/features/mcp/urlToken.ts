/**
 * Purkins URL-token MCP transport compatibility, matching Ulwimbo's combined
 * connection URL workflow. Applies only to the /mcp request path.
 *
 * Query-string credentials can leak into client history, proxy/access logs
 * and browser extensions. Never log or redirect them, and remove them from the
 * request URL before passing anything to the MCP SDK.
 *
 * A URL token is ALWAYS a per-client pmcp_ credential with immutable grants;
 * it must never authenticate via the unscoped legacy Worker MCP_TOKEN secret.
 */
export type McpUrlToken =
  | {kind:'absent'}
  | {kind:'invalid'}
  | {kind:'token';bearer:string;sanitizedUrl:string};

const CLIENT_TOKEN_RE=/^pmcp_[A-Za-z0-9_-]{43}$/;

export function extractMcpUrlToken(request:Request):McpUrlToken{
  const url=new URL(request.url);
  if(url.pathname!=='/mcp' && url.pathname!=='/mcp/')return {kind:'absent'};
  const token=url.searchParams.getAll('token');
  const compatible=url.searchParams.getAll('mcp_token');
  if(!token.length&&!compatible.length)return {kind:'absent'};
  // Reject duplicates/competing credentials; do not let a URL bearer override
  // a different explicit Authorization header.
  if(token.length+compatible.length!==1 || request.headers.has('Authorization')){
    return {kind:'invalid'};
  }
  const raw=(token.length?token:compatible)[0]??'';
  if(!CLIENT_TOKEN_RE.test(raw))return {kind:'invalid'};
  url.searchParams.delete('token');
  url.searchParams.delete('mcp_token');
  return {kind:'token',bearer:'Bearer '+raw,sanitizedUrl:url.toString()};
}
