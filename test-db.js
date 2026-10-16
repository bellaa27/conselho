
require('dotenv').config();

const mysql = require('mysql2/promise');

async function testarConexao() {
    let conexao;

    try {
        console.log('======================================');
        console.log(' TESTE DE CONEXÃO COM O MYSQL');
        console.log('======================================');

        console.log('Conectando ao banco de dados...');

        conexao = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            port: Number(process.env.DB_PORT || 3306),
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'pre_conselho'
        });

        const [resultado] = await conexao.query(`
            SELECT
                VERSION() AS versao_mysql,
                DATABASE() AS banco_atual
        `);

        console.log('');
        console.log('CONEXÃO REALIZADA COM SUCESSO!');
        console.log('--------------------------------------');
        console.log('Versão do MySQL:', resultado[0].versao_mysql);
        console.log('Banco conectado:', resultado[0].banco_atual);

        const [tabelas] = await conexao.query(`
            SHOW TABLES
        `);

        console.log('');
        console.log('Tabelas encontradas:', tabelas.length);

        if (tabelas.length > 0) {
            console.log('--------------------------------------');

            tabelas.forEach((tabela) => {
                console.log(Object.values(tabela)[0]);
            });
        } else {
            console.log(
                'O banco está conectado, mas ainda não possui tabelas.'
            );
        }

        console.log('');
        console.log('Teste concluído.');

    } catch (erro) {
        console.error('');
        console.error('ERRO AO CONECTAR AO MYSQL');
        console.error('--------------------------------------');

        if (erro.code === 'ECONNREFUSED') {
            console.error(
                'O MySQL não está aceitando conexões nessa porta.'
            );
            console.error(
                'Verifique se o serviço do MySQL está iniciado.'
            );
        } else if (erro.code === 'ER_ACCESS_DENIED_ERROR') {
            console.error(
                'Usuário ou senha incorretos no arquivo .env.'
            );
        } else if (erro.code === 'ER_BAD_DB_ERROR') {
            console.error(
                'O banco pre_conselho não existe.'
            );
            console.error(
                'Crie o banco pelo MySQL Workbench antes de continuar.'
            );
        } else {
            console.error('Código:', erro.code || 'Não identificado');
            console.error('Mensagem:', erro.message);
        }

    } finally {
        if (conexao) {
            await conexao.end();
        }
    }
}

testarConexao();
