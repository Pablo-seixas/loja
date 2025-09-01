import fs from "node:fs";
import path from "node:path";

import {
  initRecommender,
  listProducts,
  recommendByProductId,
  recommendByQuery,
  registerEvent,
  recommendForUser,
  recommendBlend,
} from "../src/recommender.js";

function ts() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function lineItems(items: Array<{ product_id: string; title: string; score?: number }>) {
  return items
    .map((it, i) => `- ${String(i + 1).padStart(2, "0")}. **${it.title}** (id: ${it.product_id}${it.score !== undefined ? `, score: ${it.score}` : ""})`)
    .join("\n");
}

function lineItemsTxt(items: Array<{ product_id: string; title: string; score?: number }>) {
  return items
    .map((it, i) => `${String(i + 1).padStart(2, "0")}) ${it.title} [id=${it.product_id}${it.score !== undefined ? `, score=${it.score}` : ""}]`)
    .join("\n");
}

async function main() {
  initRecommender();

  // parâmetros do teste
  const seed = "p001";
  const query = "notebook i5";
  const user = "u-relatorio";

  // simula interações p/ CF
  registerEvent({ user_id: user, product_id: "p002", type: "purchase" });
  registerEvent({ user_id: user, product_id: "p010", type: "view" });

  // recomendações
  const recSeed = recommendByProductId(seed, 5);
  const recQuery = recommendByQuery(query, 5);
  const recUser = recommendForUser(user, 5);
  const recBlend = recommendBlend({
    userId: user,
    productId: seed,
    query,
    alpha: 0.6,
    biasCats: ["informatica", "notebooks"],
    beta: 0.15,
    limit: 5,
    excludeSeed: true,
    excludeSeen: true,
  });

  const seedProduct = listProducts().find((p) => p.product_id === seed);

  // diretório e nomes
  const outDir = path.join(process.cwd(), "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = ts();
  const mdPath = path.join(outDir, `ml_relatorio-${stamp}.md`);
  const txtPath = path.join(outDir, `ml_relatorio-${stamp}.txt`);

  // ---------- Markdown ----------
  const md = `# Relatório de Teste — Recomendador (TF-IDF + CF + Blend)

_Gerado em ${new Date().toLocaleString()}_

## 1) Similaridade por produto (content-based)
**Micro-texto:** recomendações parecidas com **${seed}**${seedProduct ? ` — “${seedProduct.title}”` : ""}, usando TF-IDF + cosseno.
${lineItems(recSeed)}

## 2) Busca semântica por texto
**Micro-texto:** resultado para a consulta **"${query}"** baseado em TF-IDF.
${lineItems(recQuery)}

## 3) Filtragem colaborativa (user→item)
**Micro-texto:** itens que usuários parecidos com **${user}** tendem a consumir, a partir de interações (view/cart/purchase).
${lineItems(recUser)}

## 4) Blend (content + CF) com viés de categoria
**Micro-texto:** mistura conteúdo (alpha=0.6) e colaborativo, com viés para _informatica/notebooks_ (beta=0.15), excluindo seed e itens já vistos.
${lineItems(recBlend.map(({score, ...rest}) => ({...rest, score})))}

---

> Observação: dados sintéticos de \`data/catalog.csv\`. Este relatório é apenas para validação rápida do pipeline.
`;
  fs.writeFileSync(mdPath, md, "utf8");

  // ---------- Texto puro ----------
  const sep = (title: string) => `${title}\n${"-".repeat(title.length)}\n`;
  const txt =
`RELATÓRIO DE TESTE — RECOMENDADOR (TF-IDF + CF + BLEND)
Gerado em: ${new Date().toLocaleString()}

${sep("1) Similaridade por produto (content-based)")}
Micro-texto: recomendações parecidas com ${seed}${seedProduct ? ` — "${seedProduct.title}"` : ""}, usando TF-IDF + cosseno.
${lineItemsTxt(recSeed)}

${sep("2) Busca semântica por texto")}
Micro-texto: resultado para a consulta "${query}" baseado em TF-IDF.
${lineItemsTxt(recQuery)}

${sep("3) Filtragem colaborativa (user→item)")}
Micro-texto: itens que usuários parecidos com ${user} tendem a consumir, a partir de interações (view/cart/purchase).
${lineItemsTxt(recUser)}

${sep("4) Blend (content + CF) com viés de categoria")}
Micro-texto: mistura conteúdo (alpha=0.6) e colaborativo, com viés para informatica/notebooks (beta=0.15), excluindo seed e itens já vistos.
${lineItemsTxt(recBlend.map(({score, ...rest}) => ({...rest, score})))}

Observação: dados sintéticos de data/catalog.csv. Este relatório é para validação rápida do pipeline.
`;
  fs.writeFileSync(txtPath, txt, "utf8");

  console.log(`✅ Relatórios gerados:\n- ${mdPath}\n- ${txtPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
