Sugestão de Venda — Node.js + ML

Projeto de backend em Node.js + TypeScript que implementa um recomendador de produtos focado em varejo. A API gera sugestões personalizadas a partir do conteúdo dos itens e do comportamento dos usuários, mantendo o código enxuto e fácil de entender.

No componente de conteúdo, os produtos são representados por vetores TF-IDF criados a partir de título, categorias e preço; a similaridade é medida por cosseno, permitindo tanto “itens parecidos com X” quanto busca semântica por texto. 
No componente colaborativo, 
eventos implícitos (visualização, adição ao carrinho, compra) formam perfis de usuário e vizinhanças, priorizando itens consumidos por perfis semelhantes.

O sistema combina as duas frentes em um blend ajustável (parâmetro alpha) e aceita viés por categoria (bias/beta) para alinhar recomendações a objetivos de negócio. Também evita sugerir o próprio item semente e itens 
já vistos, além de expor “reasons” explicando por que cada sugestão apareceu (por exemplo, similaridade ao seed, correspondência de consulta, vizinhos, popularidade ou viés).

Acompanha um relatório automático e curto, pensado para leitura executiva, que resume resultados e facilita demonstração em portfólio. Os dados são sintéticos (catálogo pequeno) e servem para POCs rápidas; a arquitetura 
foi pensada para evoluir com persistência, decaimento temporal e métricas offline.
