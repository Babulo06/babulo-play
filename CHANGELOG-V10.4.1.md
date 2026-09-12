# BaBuLo Play V10.4.1

## Primeiro OWNER via Render
- Adicionado bootstrap seguro do primeiro OWNER usando variáveis privadas do Render.
- Registo público continua limitado a LISTENER e ARTIST.
- O bootstrap só cria OWNER quando não existe nenhum OWNER.
- Bootstrap é one-shot através da marca `owner_bootstrap_completed` na base de dados.
- Password do bootstrap exige no mínimo 12 caracteres.
- Migração `014_owner_bootstrap.sql` adicionada.
- Instruções de configuração incluídas no README.
- Mantido armazenamento persistente de media da V10.4.
