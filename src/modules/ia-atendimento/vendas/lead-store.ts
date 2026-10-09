import { prisma } from "@/lib/prisma";
import type { CamposLead, LeadStore } from "./lead";

/** Lead no banco (tabela IaLead). */
export const prismaLeads: LeadStore = {
    async garantir(contactKey, origem) {
        await prisma.iaLead.upsert({
            where: { contactKey },
            create: { contactKey, origem },
            update: { atualizadoEm: new Date(), ...(origem === "panfleto" ? { origem } : {}) }, // cada contato renova o prazo de guarda
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

/** Retenção do lead (Política de Privacidade): 12 meses sem contato. Apaga o que não foi renovado desde o corte. Devolve quantos. */
export const RETENCAO_LEAD_MESES = 12;
export async function limparLeadsAntigos(meses: number = RETENCAO_LEAD_MESES, agora: Date = new Date()): Promise<number> {
    const corte = new Date(agora);
    corte.setMonth(corte.getMonth() - meses);
    const r = await prisma.iaLead.deleteMany({ where: { atualizadoEm: { lt: corte } } });
    return r.count;
}
