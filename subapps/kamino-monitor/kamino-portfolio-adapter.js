export function createKaminoPortfolioAdapter({ inspector }) {
  if (!inspector || typeof inspector.inspect !== "function") throw new TypeError("kamino_inspector_required");
  return { async discover(wallet, protocol = {}) {
    const result = await inspector.inspect(wallet);
    if (!result?.position) return result;
    const legacy = result.position;
    const { name, protocol: _protocol, ...details } = legacy;
    return { ...result, position: { targetId: protocol.targetIds?.[0] || legacy.targetId || null, protocol: "kamino", adapterId: protocol.discoveryAdapterId || "kamino", adapterVersion: protocol.discoveryAdapterVersion ?? 1, display: name || "Kamino position", details } };
  } };
}
