import Fastify from "fastify";
import { z } from "zod";
import {
  initRecommender, listProducts,
  recommendByProductId, recommendByQuery,
  registerEvent, recommendForUser, recommendBlend
} from "./recommender.js";

const app = Fastify({ logger: true });

initRecommender();
app.log.info(`carregados ${listProducts().length} produtos`);

app.get("/healthz", async () => ({ ok: true }));
app.get("/products", async () => listProducts().map((p) => ({ product_id: p.product_id, title: p.title, categories: p.categories, price: p.price })));
app.get("/ids", async () => listProducts().map((p) => p.product_id));

app.get("/recommend/:id", async (req, reply) => {
  const Params = z.object({ id: z.string().min(1) });
  const p = Params.safeParse(req.params);
  const q = z.object({ limit: z.coerce.number().min(1).max(50).default(5) }).safeParse(req.query);
  if (!p.success || !q.success) return reply.code(400).send({ error: "invalid params" });
  return recommendByProductId(p.data.id, q.data.limit);
});

app.get("/search", async (req, reply) => {
  const Query = z.object({ q: z.string().min(1), limit: z.coerce.number().min(1).max(50).default(5) });
  const parsed = Query.safeParse(req.query);
  if (!parsed.success) return reply.code(400).send({ error: "invalid query" });
  return recommendByQuery(parsed.data.q, parsed.data.limit);
});

app.post("/events", async (req, reply) => {
  const Body = z.object({ user_id: z.string().min(1), product_id: z.string().min(1), type: z.enum(["view", "cart", "purchase"]), ts: z.number().optional() });
  const b = Body.safeParse(req.body);
  if (!b.success) return reply.code(400).send({ error: "invalid body", details: b.error.flatten() });
  const r = registerEvent(b.data);
  return reply.code(r.ok ? 200 : 400).send({ ok: r.ok, ignored: r.ignored ?? false });
});

app.get("/recommend/user/:user_id", async (req, reply) => {
  const Params = z.object({ user_id: z.string().min(1) });
  const p = Params.safeParse(req.params);
  const q = z.object({ limit: z.coerce.number().min(1).max(50).default(5) }).safeParse(req.query);
  if (!p.success || !q.success) return reply.code(400).send({ error: "invalid params" });
  return recommendForUser(p.data.user_id, q.data.limit);
});

// Blend com bias e flags de exclusão
app.get("/recommend/blend", async (req, reply) => {
  const Query = z.object({
    user_id: z.string().optional(),
    seed: z.string().optional(),
    q: z.string().optional(),
    alpha: z.coerce.number().min(0).max(1).default(0.5),
    beta: z.coerce.number().min(0).max(1).default(0),
    bias: z.string().optional(),                     // ex: "informatica,notebooks"
    exclude_seen: z.coerce.boolean().default(true),  // true/false
    exclude_seed: z.coerce.boolean().default(true),  // true/false
    limit: z.coerce.number().min(1).max(50).default(5),
  });
  const parsed = Query.safeParse(req.query);
  if (!parsed.success) return reply.code(400).send({ error: "invalid query" });

  const { user_id, seed, q, alpha, beta, bias, exclude_seen, exclude_seed, limit } = parsed.data;
  if (!user_id && !seed && !q) return reply.code(400).send({ error: "need user_id or seed or q" });

  const biasCats = (bias || "").split(",").map((x) => x.trim()).filter(Boolean);

  const out = recommendBlend({
    userId: user_id,
    productId: seed,
    query: q,
    alpha,
    limit,
    biasCats,
    beta,
    excludeSeen: exclude_seen,
    excludeSeed: exclude_seed,
  });
  return out;
});

const PORT = Number(process.env.PORT || 3000);
app.listen({ port: PORT, host: "0.0.0.0" })
  .then(() => app.log.info(`API pronta em http://localhost:${PORT}`))
  .catch((err) => { app.log.error(err); process.exit(1); });
