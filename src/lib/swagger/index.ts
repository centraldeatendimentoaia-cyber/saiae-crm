import { createSwaggerSpec } from "next-swagger-doc";
import { info, servers, securitySchemes, security } from "./base";
import { schemas } from "./schemas";
import { responses } from "./responses";
import { pathsAutenticacao } from "./paths/autenticacao";
import { pathsSessoes } from "./paths/sessoes";
import { pathsMensagens } from "./paths/mensagens";
import { pathsConversas } from "./paths/conversas";
import { pathsGrupos } from "./paths/grupos";
import { pathsContatosPerfil } from "./paths/contatos-perfil";
import { pathsAutomacao } from "./paths/automacao";
import { pathsWebhooks } from "./paths/webhooks";
import { pathsUsuarios } from "./paths/usuarios";
import { pathsEtiquetas } from "./paths/etiquetas";
import { pathsNotificacoes } from "./paths/notificacoes";
import { pathsSistema } from "./paths/sistema";

/**
 * Especificação OpenAPI servida em /api/docs e exibida em /swagger.
 * Fonte única da documentação da API: para documentar uma rota, edite o arquivo da área em ./paths.
 * (As rotas não têm anotações @swagger, por isso a spec é escrita à mão e separada por área.)
 */
export const getApiDocs = () =>
    createSwaggerSpec({
        apiFolder: "src/app/api",
        definition: {
            openapi: "3.0.0",
            info,
            servers,
            components: { securitySchemes, schemas, responses },
            security,
            paths: {
            ...pathsAutenticacao,
            ...pathsSessoes,
            ...pathsMensagens,
            ...pathsConversas,
            ...pathsGrupos,
            ...pathsContatosPerfil,
            ...pathsAutomacao,
            ...pathsWebhooks,
            ...pathsUsuarios,
            ...pathsEtiquetas,
            ...pathsNotificacoes,
            ...pathsSistema,
            },
        },
    });
