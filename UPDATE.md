# Guia de Atualização do Sistema

Este guia explica como atualizar o sistema **Monitoramento MTR** para uma nova versão mantendo seus dados (banco de dados e configurações) seguros.

## ⚠️ Antes de Começar: FAÇA BACKUP

Antes de qualquer atualização, é crucial fazer backup dos arquivos que contém seus dados e configurações.

1.  **Configurações**: Copie o arquivo `.env` para um local seguro.
2.  **Banco de Dados**: Copie a pasta `prisma/` ou pelo menos o arquivo `prisma/dev.db` (ou o arquivo .db configurado no seu .env) para um local seguro.

```bash
# Exemplo de backup manual
cp .env .env.bkp
cp prisma/dev.db prisma/dev.db.bkp
```

## Passo a Passo da Atualização

### 1. Obter a Nova Versão

Se você usa **Git**:
```bash
git pull origin main
```

Se você baixou um **arquivo ZIP**:
1.  Extraia o novo código em uma pasta temporária.
2.  Copie os arquivos novos **sobre** os arquivos antigos.
    *   **CUIDADO**: Não sobrescreva o seu arquivo `.env` nem o seu arquivo de banco de dados (`prisma/dev.db`) se eles estiverem na mesma pasta (geralmente o .env fica na raiz e o db em prisma/).

### 2. Restaurar/Verificar Configurações

Certifique-se de que o seu arquivo `.env` está na raiz do projeto e contém as configurações corretas (Chaves, Porta, URL do Banco).

### 3. Instalar Novas Dependências

A nova versão pode ter bibliotecas novas. Execute:
```bash
npm install
```

### 4. Atualizar o Banco de Dados

Se a nova versão tiver alterações na estrutura do banco de dados (novas tabelas ou colunas), você precisa rodar as migrações.

```bash
npx prisma migrate deploy
```
*Este comando aplica as mudanças pendentes sem apagar seus dados existentes.*

### 5. Reiniciar a Aplicação

#### Se estiver rodando diretamente com Node:
Pare o processo atual (Ctrl+C) e inicie novamente:
```bash
node server.js
```

#### Se estiver usando PM2 (Recomendado):
```bash
pm2 restart monitor-mtr
```

---

## Solução de Problemas

*   **Erro de Banco de Dados**: Se após atualizar houver erros de "tabela não encontrada" ou similar, verifique se rodou o comando de migração (`passo 4`).
*   **Permissões**: Se houve mudança nos arquivos de script ou binários, verifique se as permissões de execução estão corretas (`chmod +x ...`).
