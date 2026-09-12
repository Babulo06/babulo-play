# BaBuLo Play V10.3.2

- Corrigido o URL do áudio enviado para apontar para a API de media, permitindo reprodução no site.
- Upload de capa passa a mostrar pré-visualização visual após envio.
- Remoção de áudio funciona também antes da criação da faixa no servidor; ficheiro é removido do armazenamento e da associação quando aplicável.
- Área de Rascunhos e Pendentes no painel do artista para DRAFT, FAILED e PENDING_APPROVAL.
- Corrigidos campos de trecho promocional enviados pela API.
- Mantida validação de capa exatamente 600x600.

### V10.3.3 — uploads, drafts e sessão
- Upload de áudio e capa agora mostra percentagem real de carregamento até 100% e mensagem de sucesso.
- Área **Rascunhos e pendentes** ganhou **🗑️ Eliminar álbum**.
- Eliminação de lançamento remove o registo e os ficheiros associados quando ainda não existe ordem de distribuição/publicação.
- Sessão do artista/ouvinte é restaurada automaticamente a partir do token guardado, evitando novo login ao atualizar a página.
- O estado aberto do painel autenticado também é preservado durante o refresh.
