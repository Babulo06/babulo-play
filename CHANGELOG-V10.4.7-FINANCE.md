# BaBuLo Play V10.4.7 — Aprovação Financeira do Owner

## Controlo financeiro
- Criado fluxo exclusivo de aprovação financeira pelo OWNER.
- Pagamentos pendentes de lançamentos podem ser **Aprovados** ou **Rejeitados** pelo Owner.
- Levantamentos de artistas podem ser **Aprovados** ou **Rejeitados** pelo Owner.
- Rejeições exigem motivo.
- Todas as decisões financeiras ficam registadas na auditoria.
- Quando um pagamento pendente que utilizou saldo dos streams é rejeitado, o valor reservado é devolvido automaticamente ao saldo do artista.
- O ADMIN continua podendo analisar operações conforme as suas permissões, mas não pode executar a aprovação financeira final.

## Painel Owner
- Nova área **Finanças → Aprovações financeiras**.
- Separação entre **Pagamentos** e **Levantamentos**.
- Contadores e valores pendentes.
- Botões de aprovação/rejeição com atualização imediata.
- Proteção backend: somente OWNER pode executar as decisões financeiras.

## Base de dados
- Nova migração `019_financial_approvals.sql` com campos de revisão em `payment_transactions`.
