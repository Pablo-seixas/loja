import fs from "node:fs";
import path from "node:path";

export type Product = {
  product_id: string;
  title: string;
  categories: string[];
  price: number;
};

type TFIDFModel = {
  vocab: Map<string, number>;
  idf: Float64Array;
  vectors: Map<string, Float64Array>;
};

const tokenize = (s: string) =>
  s.toLowerCase().normalize("NFKD")
    .replace(/[^a-z0-9\sáéíóúãõâêîôûç"]/g, " ")
    .split(/\s+/).filter((t) => t.length > 1);

const cosine = (a: Float64Array, b: Float64Array) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (!na || !nb) return 0;
  return dot / Math.sqrt(na * nb);
};

export function loadCatalog(csvPath = path.join(process.cwd(), "data/catalog.csv")): Product[] {
  const raw = fs.readFileSync(csvPath, "utf8");
  const lines = raw.trim().split(/\r?\n/);
  lines.shift(); // header
  const items: Product[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const [product_id, title, cats, price] = line.split(",");
    items.push({
      product_id: (product_id || "").trim().toLowerCase(),
      title: (title || "").trim(),
      categories: (cats || "").split(";").map((c) => c.trim()).filter(Boolean),
      price: Number(price || 0),
    });
  }
  return items;
}

function buildTFIDF(products: Product[]): TFIDFModel {
  const docs = products.map((p) => ({ id: p.product_id, text: `${p.title} ${p.categories.join(" ")} ${p.price.toFixed(2)}` }));
  const vocab = new Map<string, number>();
  const df = new Map<string, number>();
  const tokenized = docs.map((d) => tokenize(d.text));

  for (const toks of tokenized) {
    const seen = new Set<string>();
    for (const t of toks) {
      if (!vocab.has(t)) vocab.set(t, vocab.size);
      if (!seen.has(t)) { seen.add(t); df.set(t, (df.get(t) || 0) + 1); }
    }
  }

  const N = docs.length;
  const idf = new Float64Array(vocab.size);
  for (const [term, idx] of vocab.entries()) {
    const dfi = df.get(term) || 1;
    idf[idx] = Math.log((N + 1) / (dfi + 1)) + 1;
  }

  const vectors = new Map<string, Float64Array>();
  docs.forEach((d, i) => {
    const toks = tokenized[i];
    const tf = new Map<number, number>();
    for (const t of toks) { const idx = vocab.get(t)!; tf.set(idx, (tf.get(idx) || 0) + 1); }
    const vec = new Float64Array(vocab.size);
    for (const [idx, f] of tf.entries()) vec[idx] = (f / toks.length) * idf[idx];
    let norm = 0; for (const v of vec) norm += v * v; norm = Math.sqrt(norm) || 1;
    for (let j = 0; j < vec.length; j++) vec[j] /= norm;
    vectors.set(d.id, vec);
  });

  return { vocab, idf, vectors };
}

let _cache: { products: Product[]; model: TFIDFModel; byId: Map<string, Product> } | undefined;

export function initRecommender() {
  const products = loadCatalog();
  const model = buildTFIDF(products);
  const byId = new Map(products.map((p) => [p.product_id, p]));
  _cache = { products, model, byId };
  return _cache;
}

function getVectorFromText(text: string, model: TFIDFModel): Float64Array {
  const toks = tokenize(text);
  const tf = new Map<number, number>();
  for (const t of toks) { const idx = model.vocab.get(t); if (idx === undefined) continue; tf.set(idx, (tf.get(idx) || 0) + 1); }
  const vec = new Float64Array(model.idf.length);
  for (const [idx, f] of tf.entries()) vec[idx] = (f / toks.length) * model.idf[idx];
  let norm = 0; for (const v of vec) norm += v * v; norm = Math.sqrt(norm) || 1;
  for (let j = 0; j < vec.length; j++) vec[j] /= norm;
  return vec;
}

export function recommendByProductId(productId: string, limit = 5) {
  if (!_cache) initRecommender();
  const { products, model } = _cache!;
  const pid = productId.trim().toLowerCase();
  const baseVec = model.vectors.get(pid);
  if (!baseVec) return [];
  const scores: Array<{ product: Product; score: number }> = [];
  for (const p of products) {
    if (p.product_id === pid) continue;
    const v = model.vectors.get(p.product_id); if (!v) continue;
    const score = cosine(baseVec, v);
    scores.push({ product: p, score });
  }
  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, limit).map((s) => ({ ...s.product, score: Number(s.score.toFixed(4)) }));
}

export function recommendByQuery(query: string, limit = 5) {
  if (!_cache) initRecommender();
  const { products, model } = _cache!;
  const qvec = getVectorFromText(query, model);
  const scores: Array<{ product: Product; score: number }> = [];
  for (const p of products) {
    const v = model.vectors.get(p.product_id); if (!v) continue;
    const score = cosine(qvec, v);
    scores.push({ product: p, score });
  }
  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, limit).map((s) => ({ ...s.product, score: Number(s.score.toFixed(4)) }));
}

export function listProducts() { if (!_cache) initRecommender(); return _cache!.products; }

// -------- CF --------
export type InteractionType = "view" | "cart" | "purchase";
export type Interaction = { user_id: string; product_id: string; type: InteractionType; ts?: number };
const WEIGHT: Record<InteractionType, number> = { view: 1, cart: 3, purchase: 5 };
const interactions: Interaction[] = [];
const userVectors = new Map<string, Map<string, number>>();

export function registerEvent(ev: Interaction): { ok: boolean; ignored?: boolean } {
  if (!_cache) initRecommender();
  const pid = ev.product_id.trim().toLowerCase();
  const uid = ev.user_id.trim().toLowerCase();
  if (!_cache!.byId.has(pid)) return { ok: false, ignored: true };
  const ts = ev.ts ?? Date.now();
  interactions.push({ user_id: uid, product_id: pid, type: ev.type, ts });
  let vec = userVectors.get(uid); if (!vec) { vec = new Map(); userVectors.set(uid, vec); }
  vec.set(pid, (vec.get(pid) || 0) + WEIGHT[ev.type]);
  return { ok: true };
}

function cosineSparse(a: Map<string, number>, b: Map<string, number>) {
  let dot = 0, na = 0, nb = 0;
  for (const [, va] of a) na += va * va;
  for (const [, vb] of b) nb += vb * vb;
  if (!na || !nb) return 0;
  const smaller = a.size < b.size ? a : b;
  const bigger  = a.size < b.size ? b : a;
  for (const [k, va] of smaller) { const vb = bigger.get(k); if (vb) dot += va * vb; }
  return dot / Math.sqrt(na * nb);
}

function topKNeighbors(userId: string, k = 20): Array<[string, number]> {
  const uid = userId.trim().toLowerCase();
  const target = userVectors.get(uid); if (!target) return [];
  const sims: Array<[string, number]> = [];
  for (const [otherId, vec] of userVectors.entries()) {
    if (otherId === uid) continue;
    const s = cosineSparse(target, vec);
    if (s > 0) sims.push([otherId, s]);
  }
  sims.sort((a, b) => b[1] - a[1]);
  return sims.slice(0, k);
}

function popularItems(limit = 10) {
  const counts = new Map<string, number>();
  for (const ev of interactions) counts.set(ev.product_id, (counts.get(ev.product_id) || 0) + WEIGHT[ev.type]);
  const arr = Array.from(counts.entries()).map(([pid, score]) => ({ product_id: pid, score }));
  arr.sort((a, b) => b.score - a.score);
  return arr.slice(0, limit);
}

export function recommendForUser(userId: string, limit = 5) {
  if (!_cache) initRecommender();
  const uid = userId.trim().toLowerCase();
  const myVec = userVectors.get(uid);
  if (!myVec || myVec.size === 0) {
    const popular = popularItems(limit);
    return popular.map(({ product_id, score }) => ({ ..._cache!.byId.get(product_id)!, score: Number(score.toFixed(4)) }));
  }
  const neigh = topKNeighbors(uid, 30);
  const candidateScore = new Map<string, number>();
  const have = new Set(myVec.keys());
  for (const [nid, sim] of neigh) {
    const v = userVectors.get(nid)!;
    for (const [pid, w] of v) { if (have.has(pid)) continue; candidateScore.set(pid, (candidateScore.get(pid) || 0) + sim * w); }
  }
  if (candidateScore.size === 0) {
    const popular = popularItems(limit);
    return popular.map(({ product_id, score }) => ({ ..._cache!.byId.get(product_id)!, score: Number(score.toFixed(4)) }));
  }
  const arr = Array.from(candidateScore, ([pid, sc]) => ({ product_id: pid, score: sc }));
  arr.sort((a, b) => b.score - a.score);
  return arr.slice(0, limit).map(({ product_id, score }) => ({ ..._cache!.byId.get(product_id)!, score: Number(score.toFixed(4)) }));
}

// -------- Blend + bias + exclusões --------
function toMapFromArray(arr: Array<{ product_id: string; score: number }>) {
  const m = new Map<string, number>(); for (const it of arr) m.set(it.product_id, it.score); return m;
}
function normalize01(m: Map<string, number>) {
  let max = 0; for (const v of m.values()) if (v > max) max = v;
  if (max <= 0) return new Map();
  const out = new Map<string, number>(); for (const [k, v] of m) out.set(k, v / max);
  return out;
}
function contentScoresFromSeed(pid: string) { return toMapFromArray(recommendByProductId(pid, Number.MAX_SAFE_INTEGER)); }
function contentScoresFromQuery(q: string) { return toMapFromArray(recommendByQuery(q, Number.MAX_SAFE_INTEGER)); }

function cfScoresForUser(uid: string) {
  const u = uid.trim().toLowerCase();
  const vec = userVectors.get(u);
  if (!vec || vec.size === 0) return { scores: toMapFromArray(popularItems(Number.MAX_SAFE_INTEGER)), hadVector: false };
  const neigh = topKNeighbors(u, 30);
  const candidateScore = new Map<string, number>();
  const have = new Set(vec.keys());
  for (const [nid, sim] of neigh) {
    const v = userVectors.get(nid)!;
    for (const [pid, w] of v) { if (have.has(pid)) continue; candidateScore.set(pid, (candidateScore.get(pid) || 0) + sim * w); }
  }
  return { scores: candidateScore, hadVector: true };
}

export function recommendBlend(opts: {
  userId?: string;
  productId?: string;
  query?: string;
  alpha?: number;
  limit?: number;
  biasCats?: string[];
  beta?: number;
  excludeSeen?: boolean; // default true
  excludeSeed?: boolean; // default true
}) {
  if (!_cache) initRecommender();
  const limit = Math.max(1, Math.min(50, opts.limit ?? 5));
  const alpha = Math.min(1, Math.max(0, opts.alpha ?? 0.5));
  const biasCats = (opts.biasCats || []).map((c) => c.toLowerCase());
  const beta = Math.min(1, Math.max(0, opts.beta ?? 0));
  const excludeSeen = opts.excludeSeen !== false; // default true
  const excludeSeed = opts.excludeSeed !== false; // default true

  // quem o usuário já viu/comprou
  const haveSeen = new Set<string>();
  if (opts.userId && excludeSeen) {
    const v = userVectors.get(opts.userId.trim().toLowerCase());
    if (v) for (const k of v.keys()) haveSeen.add(k);
  }
  const seedPid = opts.productId ? opts.productId.trim().toLowerCase() : undefined;

  const reasons = new Map<string, Set<string>>();
  const addReason = (pid: string, r: string) => { if (!reasons.has(pid)) reasons.set(pid, new Set()); reasons.get(pid)!.add(r); };

  // CONTENT
  let content = new Map<string, number>();
  if (seedPid) {
    const m = contentScoresFromSeed(seedPid);
    for (const [k, v] of m) { content.set(k, Math.max(content.get(k) || 0, v)); addReason(k, `similar_to:${seedPid}`); }
    content.delete(seedPid); // remove seed do content
  }
  if (opts.query) {
    const m = contentScoresFromQuery(opts.query);
    for (const [k, v] of m) { content.set(k, Math.max(content.get(k) || 0, v)); addReason(k, "match_query"); }
  }

  // CF
  let cf = new Map<string, number>();
  if (opts.userId) {
    const { scores, hadVector } = cfScoresForUser(opts.userId);
    cf = scores;
    for (const k of scores.keys()) addReason(k, hadVector ? "neighbors" : "popular");
  }

  const nContent = normalize01(content);
  const nCF = normalize01(cf);

  const union = new Set<string>([...nContent.keys(), ...nCF.keys()]);
  const combined: Array<{ product_id: string; score: number; reasons: string[] }> = [];
  for (const pid of union) {
    if (excludeSeed && seedPid && pid === seedPid) continue;      // <- não recomendar seed
    if (excludeSeen && haveSeen.has(pid)) continue;               // <- não recomendar já visto

    let sc = alpha * (nContent.get(pid) ?? 0) + (1 - alpha) * (nCF.get(pid) ?? 0);

    // viés por categoria
    if (beta > 0 && biasCats.length > 0) {
      const p = _cache!.byId.get(pid);
      if (p && p.categories.some((c) => biasCats.includes(c.toLowerCase()))) {
        sc = Math.min(1, sc + beta);
        addReason(pid, "bias_category");
      }
    }

    if (sc <= 0) continue;
    const p = _cache!.byId.get(pid); if (!p) continue;
    combined.push({ product_id: pid, score: sc, reasons: Array.from(reasons.get(pid) ?? []) });
  }

  combined.sort((a, b) => b.score - a.score);
  const top = combined.slice(0, limit).map((x) => ({ ..._cache!.byId.get(x.product_id)!, score: Number(x.score.toFixed(4)), reasons: x.reasons }));
  if (top.length === 0 && opts.userId) return popularItems(limit).map(({ product_id, score }) => ({ ..._cache!.byId.get(product_id)!, score: Number((score || 0).toFixed(4)), reasons: ["popular"] }));
  return top;
}
