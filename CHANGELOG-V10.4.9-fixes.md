# BaBuLo Play V10.4.9 — Correções de Owner, login e Finanças

- Owner: no modal **Editar ADMIN**, foram removidos os campos para trocar a função/cargo.
- Owner continua a poder gerir as permissões do ADMIN e os dados pessoais permitidos.
- Área de Finanças do ADMIN: removida a mensagem interna sobre ações exclusivas do Owner.
- Login: contas LISTENER/ARTIST existentes no momento da migração 026 deixam de ser bloqueadas pela nova exigência de verificação de email.
- Novas contas continuam a usar a confirmação de email normalmente.

- A migração de email é executada apenas uma vez através de `system_settings`, evitando verificar automaticamente contas ARTIST/LISTENER novas em reinícios futuros.
