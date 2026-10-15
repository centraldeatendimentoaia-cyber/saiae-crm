import { prisma } from "@/lib/prisma";

export interface MidiaSalva {
    data: Buffer;
    mime: string;
    userId: string;
}

/**
 * Onde ficam os BYTES das imagens enviadas pelo painel. Os metadados (dono, nome, tamanho, token público) seguem na
 * tabela MediaFile. Hoje só existe a implementação em banco; trocar por S3/R2 é escrever outra classe e escolhê-la
 * aqui, sem mexer nas rotas (os dados já gravados precisariam ser migrados antes).
 */
export interface MediaStorage {
    save(m: { userId: string; name: string; mime: string; data: Buffer }): Promise<{ id: string }>;
    load(by: { id: string } | { publicToken: string }): Promise<MidiaSalva | null>;
    remove(ids: string[]): Promise<number>;
}

export class DbMediaStorage implements MediaStorage {
    async save({ userId, name, mime, data }: { userId: string; name: string; mime: string; data: Buffer }) {
        return prisma.mediaFile.create({
            data: { userId, name: name.slice(0, 200), mime, size: data.length, data },
            select: { id: true },
        });
    }

    async load(by: { id: string } | { publicToken: string }) {
        const row = "id" in by
            ? await prisma.mediaFile.findUnique({ where: { id: by.id }, select: { data: true, mime: true, userId: true } })
            : await prisma.mediaFile.findFirst({ where: { publicToken: by.publicToken }, select: { data: true, mime: true, userId: true } });
        return row ? { data: Buffer.from(row.data), mime: row.mime, userId: row.userId } : null;
    }

    async remove(ids: string[]) {
        return (await prisma.mediaFile.deleteMany({ where: { id: { in: ids } } })).count;
    }
}

export const mediaStorage: MediaStorage = new DbMediaStorage();
