-- Extends 0049 without recreating live credential/audit tables.
-- The original scope='read_only' column remains for backward compatibility;
-- actual authorization is the immutable per-token tool_permissions_json.
-- NULL on existing credentials means the original safe read-only preset.
ALTER TABLE purkins_mcp_client_tokens
  ADD COLUMN tool_permissions_json TEXT DEFAULT NULL
  CHECK (tool_permissions_json IS NULL OR json_valid(tool_permissions_json));
