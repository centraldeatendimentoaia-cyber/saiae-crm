import { prisma } from "@/lib/prisma";
import type { CamposLead, LeadStore } from "./lead";

/** Lead no banco (tabela IaLead). */
export const prismaLeads: LeadStore = {
    async garantir(contactKey, origem) {
        await prisma.iaLead.upsert({
            where: { contactKey },
            create: { contactKey, origem },
            update: origem === "panfleto" ? { origem } : {},
        });
    },
    async atualizar(contactKey, campos) {
        const data: CamposLead = {};
        if (campos.nome) data.nome = campos.nome;
        if (campos.negocio) data.negocio = campos.negocio;
        if (campos.cidade) data.cidade = campos.cidade;
        if (Object.keys(data).length === 0) return;
        await prisma.iaLead.upsert({ where: { contactKey }, create: { contactKey, ...data }, update: data });
    },
};
