# Painel de Monitoramento MTR

Um sistema web completo para monitoramento de latência e perda de pacotes em tempo real, utilizando a ferramenta MTR (My Traceroute). Ideal para provedores de internet (ISPs), administradores de rede e equipes de NOC.

![Login Screen](public/Logo.png)

## 🚀 Funcionalidades

*   **Monitoramento em Tempo Real**: Executa MTR a cada 30 segundos para todos os hosts cadastrados.
*   **Dashboard Interativo**: Visualize latência, perda de pacotes e histórico de mudanças.
*   **Gestão de Usuários**:
    *   Sistema de convites por link.
    *   Redefinição de senha segura.
    *   Controle de acesso baseado em funções (Admin/Editor/Viewer).
*   **Segurança**:
    *   Autenticação JWT.
    *   Senhas com hash (bcrypt).
    *   Proteção contra força bruta (Rate Limiting).
    *   Logs de auditoria de ações do sistema.
*   **Personalização**: Logo configurável e categorias de hosts.

## 🛠️ Tecnologias Utilizadas

*   **Backend**: Node.js, Express.
*   **Segurança**: Helmet (conceitual), Rate Limit, BCrypt, JWT.
*   **Frontend**: HTML5, CSS3 (Variáveis CSS, Flexbox/Grid), JavaScript (ES6+).
*   **Banco de Dados**: JSON (Flat-file database) para simplicidade e portabilidade.
*   **Ferramentas de Sistema**: `mtr` (Linux).

## 📋 Pré-requisitos

*   **Sistema Operacional**: Linux (Ubuntu/Debian recomendados).
*   **Node.js**: Versão 16 ou superior.
*   **MTR**: Ferramenta de linha de comando instalada.

## 📦 Instalação do Zero

Siga os passos abaixo para colocar o sistema no ar em poucos minutos.

### 1. Instalar Dependências do Sistema

```bash
sudo apt update
sudo apt install nodejs npm mtr -y
```

> **Nota**: O `mtr` requer permissões elevadas. O sistema tenta executá-lo automaticamente, mas verifique se o usuário tem permissão caso encontre erros.

### 2. Clonar e Instalar o Projeto

```bash
git clone https://github.com/seu-usuario/painel-mtr-backend.git
cd painel-mtr-backend
npm install
```

### 3. Configuração (.env)

O sistema gera um arquivo `.env` automaticamente na primeira execução, mas para segurança em produção, recomendamos criar manualmente:

```bash
cp .env.example .env
nano .env
```

Edite as variáveis:

```ini
PORT=3000
# Gere uma chave forte e aleatória para produção!
JWT_SECRET=sua_chave_secreta_super_segura_e_aleatoria
EDITOR_TOKEN=token_de_emergencia_opcional
LOGIN_ICON=./public/Logo.png
```

### 4. Rodar o Servidor

Para desenvolvimento:
```bash
node server.js
```

Para produção (usando PM2):
```bash
sudo npm install -g pm2
pm2 start server.js --name "monitor-mtr"
pm2 save
pm2 startup
```

## 🔐 Primeiro Acesso

1.  Acesse `http://SEU_IP:3000`.
2.  Se for a primeira vez, o sistema criará um usuário **admin** padrão:
    *   **Usuário**: `admin`
    *   **Senha**: `admin123`
3.  **IMPORTANTE**: Faça login, vá em "Gerenciar Usuários" e altere a senha imediatamente.

## 🛡️ Segurança

*   **Rate Limiting**: O sistema bloqueia IPs após 10 tentativas falhas de login em 15 minutos.
*   **Logs**: Todas as ações críticas (criar usuário, resetar senha, apagar host) são registradas em `system_logs.json` e visíveis no painel.

## 📄 Licença

Este projeto é de código aberto e está disponível sob a licença [MIT](LICENSE).
