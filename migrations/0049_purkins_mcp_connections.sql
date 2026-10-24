-- PR #18: owner-controlled, short-lived MCP client credentials.
-- Never persist raw tokens or put bearer credentials in connection URLs.
-- v1 supports read-only operator access ONLY; future scoped write grants need
-- an independent explicit permission model and acceptance tests.
CREATE TABLE purkins_mcp_client_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 3 AND 120),
  token_prefix TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL CHECK (length(token_hash) = 64),
  accountable_email TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'read_only' CHECK (scope = 'read_only'),
  request_id TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  revoked_at INTEGER,
  last_used_at INTEGER,
  call_count INTEGER NOT NULL DEFAULT 0 CHECK (call_count >= 0)
);
CREATE INDEX idx_purkins_mcp_client_tokens_status
  ON purkins_mcp_client_tokens(revoked_at, expires_at);
CREATE INDEX idx_purkins_mcp_client_tokens_accountable
  ON purkins_mcp_client_tokens(accountable_email);
