# Guia de Instalação - Monitoramento MTR

Este guia descreve como instalar, configurar e rodar o sistema de Monitoramento MTR em um novo ambiente (Linux).

## Pré-requisitos

1.  **Node.js**: Versão 16 ou superior.
2.  **MTR**: Ferramenta de diagnóstico de rede.
3.  **Git**: Para clonar o repositório (opcional).

### Instalando Dependências do Sistema (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install nodejs npm mtr -y
```

> **Nota**: O `mtr` precisa de permissões de root para rodar. O sistema executa o comando `mtr` internamente. Certifique-se de que o usuário que rodará a aplicação tem permissão ou configure o `sudo` sem senha para o mtr (não recomendado para produção sem devida segurança) ou rode a aplicação como root (cuidado).
> *Recomendação*: O sistema tenta rodar `mtr` direto. Se falhar, verifique as permissões.

## Instalação da Aplicação

1.  **Copie os arquivos** para o servidor de destino.
2.  **Instale as dependências do Node.js**:

```bash
cd /caminho/para/o/projeto
npm install
```

## Configuração

1.  Crie um arquivo `.env` na raiz do projeto (ou copie o exemplo se houver):

```bash
cp .env.example .env
```

2.  Edite o arquivo `.env` com suas configurações:

```ini
PORT=3000
JWT_SECRET=sua_chave_secreta_aqui_gere_uma_forte
EDITOR_TOKEN=token_para_acesso_de_emergencia
```

*   `JWT_SECRET`: Uma string longa e aleatória para assinar os tokens de sessão.
*   `EDITOR_TOKEN`: Um token fixo para acessar a rota `/edit` em caso de emergência ou scripts.

## Rodando a Aplicação

### Modo de Desenvolvimento

```bash
npm start
# ou
node server.js
```

### Modo de Produção (Recomendado: PM2)

Instale o PM2 globalmente:

```bash
sudo npm install -g pm2
```

Inicie a aplicação:

```bash
pm2 start server.js --name "monitor-mtr"
pm2 save
pm2 startup
```

## Primeiro Acesso

1.  Acesse `http://SEU_IP:3000`.
2.  O sistema criará automaticamente um usuário **admin** padrão se o banco de dados estiver vazio.
    *   **Usuário**: `admin`
    *   **Senha**: `admin123`
3.  **IMPORTANTE**: Faça login e altere a senha do admin imediatamente em "Gerenciar Usuários".

## Funcionalidades Principais

*   **Dashboard**: Visualização em tempo real da latência e perda de pacotes.
*   **Monitoramento**: O sistema roda MTR a cada 30 segundos para todos os hosts cadastrados.
*   **Logs**: Ações de login, logout e edições são registradas em `system_logs.json` e visíveis no painel de admin.
*   **Convites**: O admin pode gerar links de convite para novos usuários.

## Estrutura de Arquivos Importantes

*   `server.js`: Código principal do backend.
*   `public/`: Arquivos do frontend (HTML, CSS, JS).
*   `db.json`: Banco de dados (Usuários, Hosts, Categorias). **Faça backup deste arquivo!**
*   `system_logs.json`: Logs de auditoria.
*   `hosts.txt`: Lista simples de hosts (sincronizada com o DB).
