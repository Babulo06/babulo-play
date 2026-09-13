# BaBuLo Play V10.4.7 — Centro Financeiro do OWNER

## Novo controlo financeiro
- Consulta do saldo de todos os artistas, streams válidos e saldo disponível.
- Criação de ordens de pagamento para artistas.
- Criação de pagamentos de salários/remunerações para ADMINs.
- Aprovação ou rejeição exclusiva pelo OWNER.
- Registo de ordem enviada ao banco e confirmação posterior do pagamento.
- Registo separado de receita de publicidade e saldo de publicidade.
- Resumo de royalties, pagamentos a artistas, salários, publicidade e receita BaBuLo.
- Histórico financeiro do Owner.
- Auditoria das operações financeiras.

## Segurança
- Todas as operações do novo centro financeiro são protegidas por `OWNER`.
- Pagamentos de artistas reservam o valor no ledger do artista; em caso de rejeição a reserva é devolvida.
- A ação "Enviar ao banco" regista a ordem no sistema. A execução bancária real requer integração com o banco/gateway escolhido.

## Base de dados
- Nova migração: `020_owner_finance_control.sql`.
