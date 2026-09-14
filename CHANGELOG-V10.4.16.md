# BaBuLo Play V10.4.16

## Correção de login das contas administrativas

- Contas `ADMIN` e `OWNER` internas não ficam bloqueadas pela verificação de email público.
- Novos `ADMIN` criados pelo Owner passam a ser criados com `email_verified=true`.
- A migração `032_admin_internal_email_verification.sql` corrige automaticamente ADMIN/OWNER existentes que ainda estejam com `email_verified=false`.
- Contas públicas `LISTENER` e `ARTIST` continuam a exigir verificação de email.

Esta correção resolve o erro:
> Verifica primeiro o teu email. Podes pedir um novo link de verificação.

que estava a impedir o acesso do Gestor de Conta/ADMIN.
