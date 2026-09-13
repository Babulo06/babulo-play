# BaBuLo Play V10.4.2

## Administração de contas e artistas
- Novo painel **Contas** na Área do Owner/Admin.
- Pesquisa por nome artístico, email e telefone.
- Filtros por papel e estado.
- Consulta de perfil, lançamentos, levantamentos e auditoria.
- Ativar, suspender e bloquear contas através da API.
- Verificação/recusa de verificação de artistas.
- OWNER protegido contra bloqueio/alteração indevida.
- ADMIN só pode administrar outros ADMINs quando autorizado pelo OWNER.
- OWNER pode criar contas ADMIN com palavra-passe mínima de 12 caracteres.
- Todas as ações administrativas relevantes são registadas em `audit_logs`.
- Migração 015 adicionada.

## Aprovações
- Ações de aprovar/rejeitar lançamentos diretamente no painel.
- Rejeição exige motivo.

## Compatibilidade
- Lógica implementada na API para ser reutilizada pelo Web, Android e iPhone.
