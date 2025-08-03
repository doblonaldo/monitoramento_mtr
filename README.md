# Painel de Monitoramento de Rota (Route-Monitor-Dashboard)

![Badge de Status](https://img.shields.io/badge/status-funcional-green)
![Node.js](https://img.shields.io/badge/Node.js-14.x+-blue?logo=node.js)
![Express.js](https://img.shields.io/badge/Express.js-4.x-orange?logo=express)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-yellow?logo=javascript)

Um dashboard web para monitoramento contínuo da rota de rede (traceroute) para múltiplos destinos. A aplicação detecta e armazena um histórico de mudanças na rota, permitindo a visualização e análise de instabilidades ou alterações de tráfego de rede ao longo do tempo.

## Visão Geral

Este projeto oferece uma solução visual para um problema comum em administração de redes: saber não apenas *se* um destino está acessível, mas *como* o tráfego chega até ele e se essa rota mudou. Ele utiliza o utilitário `mtr` (My Traceroute) para coletar dados da rota e os apresenta em uma interface amigável e interativa.

Exemplo da Interface do Dashboard
<img width="2560" height="1484" alt="image" src="https://github.com/user-attachments/assets/73178990-9a06-420f-86a3-1d02c411c6ff" />

## ✨ Principais Funcionalidades

* **Monitoramento Agendado:** O backend verifica a rota para cada host a cada 10 minutos.
* **Detecção de Mudanças:** A principal funcionalidade é salvar um log apenas quando a saída do `mtr` muda, focando nos eventos de alteração de rota.
* **Dashboard Interativo:** Uma interface web moderna para visualizar todos os hosts monitorados.
* **Linha do Tempo Visual:** Cada host possui uma linha do tempo que marca os momentos exatos em que uma mudança de rota foi detectada.
* **Visualização de Histórico:** Clique em um marcador na linha do tempo para ver o log `mtr` exato daquele momento.
* **Gráficos de Latência:** Gráficos em tempo real (simulados - em desenvolvimento) dão um feedback visual imediato da latência do último salto.
* **Gerenciamento de Hosts:** Adicione ou remova hosts dinamicamente através da interface (requer token de acesso).
* **Tolerância a Falhas:** Hosts que se tornam inacessíveis são marcados e, se a falha persistir, são removidos automaticamente para manter o sistema limpo.

## 🛠️ Tecnologias Utilizadas

### Backend

* **Node.js:** Ambiente de execução JavaScript.
* **Express.js:** Framework para a criação do servidor e da API.
* **Child Process:** Para executar o comando `mtr` do sistema.
* **Dotenv:** Para gerenciar variáveis de ambiente de forma segura.

### Frontend

* **HTML5 / CSS3 / JavaScript (Vanilla):** Estrutura, estilo e interatividade do lado do cliente.
* **Chart.js:** Para a renderização dos gráficos de latência.
* **Flatpickr:** Para a seleção de datas e horários no filtro.

### Banco de Dados

* **Arquivo JSON (`db.json`):** Utilizado como um banco de dados simples para armazenar o estado, o histórico e os resultados do `mtr` para cada host.

## 🚀 Instalação e Uso

Para executar este projeto localmente, siga os passos abaixo.

### Pré-requisitos

1.  **Node.js:** Certifique-se de ter o Node.js (versão 14 ou superior) instalado.
2.  **MTR:** A ferramenta `mtr` **precisa** estar instalada no sistema que irá rodar o servidor.
    * Em sistemas baseados em Debian/Ubuntu: `sudo apt-get update && sudo apt-get install mtr-tiny`
    * Em sistemas baseados em RHEL/CentOS: `sudo yum install mtr`

### Passos

1.  **Clone o repositório:**
    ```bash
    git clone [https://github.com/seu-usuario/seu-repositorio.git](https://github.com/seu-usuario/seu-repositorio.git)
    cd seu-repositorio
    ```

2.  **Instale as dependências do Node.js:**
    *(Observação: O arquivo `package.json` não foi fornecido. Seria necessário criá-lo. Veja as sugestões de melhoria.)*
    ```bash
    npm install express cors dotenv
    ```

3.  **Configure os hosts iniciais (Opcional):**
    [cite_start]Adicione os IPs ou domínios que você deseja monitorar desde o início no arquivo `hosts.txt`, um por linha[cite: 1].

4.  **Inicie o servidor:**
    ```bash
    node server.js
    ```

5.  **Acesse o painel:**
    * O servidor será iniciado na porta 3000.
    * **Modo de Visualização:** Abra seu navegador e acesse `http://localhost:3000`.
    * **Modo de Edição:** Ao iniciar o servidor pela primeira vez, um arquivo `.env` será criado com um `EDITOR_TOKEN`. Use este token para acessar o modo de edição: `http://localhost:3000/edit?editor_token=SEU_TOKEN_AQUI`.

## ⚙️ Como Funciona

O `server.js` é o coração do projeto. Ele inicializa um servidor web e um ciclo de monitoramento.

1.  **Inicialização:** O servidor carrega os hosts do banco de dados `db.json`. Se o arquivo `hosts.txt` existir, ele importa quaisquer hosts novos que não estejam no banco de dados.
2.  **Ciclo de Monitoramento:** A cada 10 minutos, o servidor percorre a lista de hosts monitorados.
3.  **Execução do MTR:** Para cada host, ele executa o comando `mtr -r -n -c 10 -4 -z ${host}`.
4.  **Detecção de Mudança:** O resultado do `mtr` é comparado com o último resultado armazenado.
    * Se for diferente, um novo registro de histórico é criado com o timestamp e o novo log. O `lastMtr` do host é atualizado.
    * Se for igual, nada acontece.
5.  [cite_start]**Interface:** O frontend busca os dados da API do servidor para construir os cards, a linha do tempo e os gráficos, oferecendo uma representação visual dos dados coletados[cite: 2].

## 🔮 Sugestões de Melhoria

Este é um projeto sólido e muito útil. Aqui estão algumas ideias para evoluí-lo:

1.  **Gerenciamento de Dependências:**
    * Criar um arquivo `package.json` (`npm init -y`) para que as dependências (`express`, `cors`, `dotenv`) possam ser instaladas facilmente com um único comando `npm install`.

2.  **Segurança:**
    * O uso de um token via query string é funcional, mas para um ambiente mais robusto, considere um sistema de autenticação mais seguro, como JWT (JSON Web Tokens) com tela de login.

3.  **Persistência de Dados:**
    * O `db.json` funciona bem para um número pequeno de hosts, mas pode se tornar um gargalo de performance e apresentar problemas de concorrência de escrita. Considere migrar para um banco de dados mais robusto como **SQLite** (que ainda é baseado em arquivo e não requer um servidor separado) ou um banco NoSQL como **MongoDB**.

4.  **Frontend e UX:**
    * **WebSockets:** Para os gráficos "em tempo real", em vez de simular a variação no cliente, use WebSockets (com bibliotecas como `Socket.io`) para que o servidor envie atualizações de latência reais para o cliente, criando um monitoramento verdadeiramente ao vivo.
    * **Notificações:** Implemente um sistema de notificações (via e-mail, Telegram, ou notificações do navegador) para alertar o administrador quando uma mudança de rota for detectada em um host crítico.

5.  **Abstração e Testes:**
    * Abstrair a lógica de execução do `mtr` em um módulo separado.
    * Implementar testes unitários (usando `Jest` ou `Mocha`) para as funções críticas, especialmente a lógica de detecção de mudanças e o tratamento de erros.

6.  **Containerização:**
    * Criar um `Dockerfile` para o projeto. Isso simplificaria imensamente a implantação, pois empacotaria o Node.js, a aplicação e a dependência `mtr` em uma única imagem, garantindo que o ambiente seja consistente em qualquer lugar.

7.  **CI/CD (Integração e Deploy Contínuos):**
    * Configurar GitHub Actions para rodar automaticamente testes e linters a cada push, garantindo a qualidade do código.
