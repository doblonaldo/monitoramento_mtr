# Monitoramento MTR

Sistema de monitoramento de rede que executa testes MTR periodicamente, detecta mudanças de rota e coleta métricas de latência e perda de pacotes.

## Funcionalidades

- **Monitoramento Contínuo**: Executa MTR a cada 30 segundos.
- **Detecção de Mudanças**: Registra alterações na rota de rede.
- **Métricas**: Coleta latência média e perda de pacotes, com gráficos históricos.
- **Dashboard em Tempo Real**: Interface web para visualização dos hosts e gráficos.
- **Gestão de Usuários**: Sistema de login com níveis de acesso (Admin, Editor, Viewer).

## Pré-requisitos

- Node.js (v18 ou superior)
- `mtr` instalado no sistema (`sudo apt install mtr`)
- `sqlite3` (opcional, para inspeção manual)

## Instalação

1. **Clone o repositório** (ou extraia os arquivos):
   ```bash
   git clone <url-do-repositorio>
   cd monitoramento_mtr
   ```

2. **Instale as dependências**:
   ```bash
   npm install
   ```

3. **Configure o Banco de Dados**:
   O sistema usa SQLite. Execute a migração inicial para criar o banco e as tabelas:
   ```bash
   npx prisma migrate dev --name init
   ```

4. **(Opcional) Adicione Hosts Iniciais**:
   Crie um arquivo `hosts.txt` na raiz do projeto para importar hosts automaticamente na primeira execução.
   Formato: `IP, Título, Categoria`
   Exemplo:
   ```
   8.8.8.8, Google DNS, DNS
   1.1.1.1, Cloudflare, DNS
   youtube.com, Youtube, Sites
   ```

## Execução

Para iniciar o servidor:

```bash
node server.js
```

O servidor iniciará na porta **3000** (padrão).
Acesse: `http://localhost:3000`

### Login Padrão
- **Usuário**: `admin`
- **Senha**: `admin123`

> **Recomendação**: Altere a senha do admin imediatamente após o primeiro login.

## Estrutura do Projeto

O projeto segue uma arquitetura modular:

- `src/config`: Configurações (Prisma, etc).
- `src/controllers`: Lógica de controle das requisições API.
- `src/services`: Lógica de negócios (Monitoramento MTR).
- `src/routes`: Definição das rotas da API.
- `src/middleware`: Middlewares de autenticação e segurança.
- `src/utils`: Utilitários (Logger).
- `public`: Frontend estático (HTML, CSS, JS).
- `prisma`: Schema do banco de dados e migrações.

## Desenvolvimento

Para rodar em modo de desenvolvimento (com restart automático):
```bash
npm install -g nodemon
nodemon server.js
```
