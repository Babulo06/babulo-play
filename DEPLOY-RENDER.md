# Deploy BaBuLo Play no Render

## V10.2.1 — migração automática da base de dados

A API agora verifica e aplica automaticamente o schema SQL no arranque. Isto inclui as migrações V9, V10.2 e os campos profissionais de faixas (feat, tipo de áudio, IA e letra).

### API
- Build: `npm install --no-audit --no-fund && npm run build:api`
- Start: `npm --workspace apps/api run start`
- `DATABASE_URL`: usar a variável criada pelo Blueprint (`babulo-play-db`)
- Não é necessário executar `PSQL Command` manualmente para as migrações deste pacote.

### Web
- Build: `npm install --no-audit --no-fund && npm run build:web`
- Start: `npm --workspace apps/web run start`
- `NEXT_PUBLIC_API_URL`: `https://babulo-play-api.onrender.com`

Depois de enviar o projeto para o GitHub, o Auto-Deploy do Render deve iniciar um novo deploy. Aguarde a mensagem `Your service is live` nos logs da API.
