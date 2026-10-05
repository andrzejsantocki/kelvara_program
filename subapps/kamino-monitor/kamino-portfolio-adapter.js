export function createKaminoPortfolioAdapter({ inspector }) {
  if (!inspector || typeof inspector.inspect !== "function") throw new TypeError("kamino_inspector_required");
  return { async discover(wallet) { return inspector.inspect(wallet); } };
}
