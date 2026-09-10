# BaBuLo Play — V10 Distribution Engine

Monorepo pronto para instalação com `npm install (o servidor instala `node_modules` automaticamente).

## Requisitos

- Node.js 20 ou 22 (recomendado: Node 22)
- npm 10+
- PostgreSQL 15+

## Instalação local

```bash
npm install
cp apps/api/.env.example apps/api/.env
# edite DATABASE_URL e JWT_SECRET
npm run build
npm run typecheck
npm run dev
```

Web: http://localhost:3000  
API: http://localhost:4000/api/health

## PostgreSQL

Execute o schema e as migrações pela ordem num banco PostgreSQL:

```text
packages/db/schema.sql
packages/db/migrations/001_preflight_isrc.sql
packages/db/migrations/002_rights_approval.sql
packages/db/migrations/003_royalties_ledger.sql
packages/db/migrations/004_payment_engine.sql
packages/db/migrations/005_distribution_engine.sql
```

## Produção / deploy

O deploy deve executar:

```bash
npm install
npm run build
```

> Este projeto ainda não inclui `package-lock.json`; por isso, neste estágio use `npm install`, e não `npm ci`. Depois de gerar e versionar o lockfile, podemos mudar o deploy para `npm ci`.

Para o serviço API:

```bash
npm --workspace apps/api run start
```

Para o serviço Web:

```bash
npm --workspace apps/web run start
```

Configure no ambiente de produção pelo menos `DATABASE_URL`, `JWT_SECRET`, `WEB_ORIGIN`, `PAYMENT_WEBHOOK_SECRET` e `PAYMENT_DEMO_MODE=false`.

> `node_modules` não é versionado nem incluído no ZIP. O servidor/PC instala as dependências através do `package.json` e, quando existir `package-lock.json`, deve preferir `npm ci`.

## V10 — Distribution Engine

Inclui pacotes de distribuição Single/EP/Album/Album Pro, destinos de plataformas, pedidos, entregas por plataforma, histórico, falhas/reenvio, migração de catálogo e endpoints administrativos.

Os conectores oficiais de Spotify, Apple Music, YouTube Music, Deezer, Amazon Music, TikTok, Meta e demais parceiros ainda precisam ser configurados com contratos/credenciais reais. O sistema não simula uma publicação real.

## GitHub + Render

O ficheiro `render.yaml` define a API, o Web e um PostgreSQL. Depois de ligar o repositório GitHub ao Render, o Render instala as dependências e faz o build automaticamente.

Variáveis que precisam de configuração no serviço Web/API: `NEXT_PUBLIC_API_URL`, `WEB_ORIGIN` e, para produção, os segredos gerados pelo próprio Render.

### Migrações PostgreSQL

As migrações devem ser executadas pela ordem: `schema.sql`, `001_preflight_isrc.sql`, `002_rights_approval.sql`, `003_royalties_ledger.sql`, `004_payment_engine.sql`, `005_distribution_engine.sql`.

O armazenamento local de uploads é adequado apenas para desenvolvimento. Em produção, a próxima etapa deve migrar os ficheiros para object storage + CDN.
