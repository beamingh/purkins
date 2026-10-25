/** Wrap MCP tool registration for one credential without altering global tool
 * definitions or the shared Durable Object server. Grants only affect this
 * credential's newly initialized session; token permissions are immutable for
 * the entire credential lifetime, so existing sessions can't retain a revoked
 * individual permission after edits. Revoke to invalidate all further requests.
 */
export function filterMcpToolRegistrations<T extends object>(
  server: T,
  permissions: readonly string[] | undefined,
): T {
  if (!permissions) return server; // Legacy bearer, verified Access, buyer tier.
  const granted = new Set(permissions);
  return new Proxy(server, {
    get(target, property, receiver) {
      if (property !== 'registerTool') return Reflect.get(target, property, receiver);
      const register = Reflect.get(target, 'registerTool', target) as
        (name: string, ...args: unknown[]) => unknown;
      return (name: string, ...args: unknown[]) => {
        if (!granted.has(name)) return undefined; // Callers do not use registration result.
        return register.call(target, name, ...args);
      };
    },
  });
}
