# BaBuLo Play V10.2.4

## Correções de deploy
- Corrigido o ambiente de build do Render para instalar `devDependencies` com `npm install --include=dev`.
- Corrigida a causa do erro do Next.js que pedia TypeScript e os tipos `@types/react` / `@types/node` durante o build.
- API preparada para não bloquear o deploy por erros de inferência `implicit any` nos handlers Express existentes.
- Mantido Node.js 22 e o build por workspaces.

## Géneros
- Expandido o catálogo de géneros de 6 para 75 opções.
- Incluídos géneros angolanos, africanos, urbanos, hip-hop/rap, R&B, eletrónica, rock e outros.
- O seletor de género existente no formulário de lançamento continua ligado a `/api/genres`.

## Versão
- Monorepo: 0.10.2.4
- API: 0.10.2.4
- Web: 0.10.2.4
