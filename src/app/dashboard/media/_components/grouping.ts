export interface MediaFile {
    name: string;
    size: number;
    type: "image" | "video" | "audio" | "document";
    ext: string;
    sessionId: string;
    sessionName: string;
    ownerName: string;
    ownerId: string;
    from: string;
    fromName: string | null;
    fromMe: boolean;
    createdAt: string;
    modifiedAt: string;
    url: string;
}

export interface SenderGroup {
    senderKey: string;
    senderDisplay: string;
    files: MediaFile[];
    totalSize: number;
}

export interface SessionGroup {
    sessionId: string;
    sessionName: string;
    totalSize: number;
    senders: SenderGroup[];
}

export interface UserGroup {
    ownerId: string;
    ownerName: string;
    totalSize: number;
    sessions: SessionGroup[];
}

export function formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export function getSenderDisplay(file: MediaFile): string {
    if (file.fromMe) return "Eu (enviado)";
    if (file.fromName) return file.fromName;
    // "Unknown" e o valor que a API devolve quando nao ha remetente
    if (file.from && file.from !== "Unknown") return file.from.split("@")[0];
    return "Desconhecido";
}

export function matchesFilters(f: MediaFile, searchQuery: string, filterType: string): boolean {
    const q = searchQuery.toLowerCase();
    const matchSearch = !q ||
        f.name.toLowerCase().includes(q) ||
        f.sessionId.toLowerCase().includes(q) ||
        f.sessionName.toLowerCase().includes(q) ||
        f.ownerName.toLowerCase().includes(q) ||
        f.from.toLowerCase().includes(q) ||
        (f.fromName || "").toLowerCase().includes(q);
    const matchType = filterType === "all" || f.type === filterType;
    return matchSearch && matchType;
}

// Agrupa em 3 niveis (usuario > sessao > remetente), todos ordenados por tamanho decrescente
export function groupMedia(files: MediaFile[]): UserGroup[] {
    const usersMap: Record<string, UserGroup> = {};

    for (const file of files) {
        if (!usersMap[file.ownerId]) {
            usersMap[file.ownerId] = {
                ownerId: file.ownerId,
                ownerName: file.ownerName,
                totalSize: 0,
                sessions: [],
            };
        }
        const userGroup = usersMap[file.ownerId];
        userGroup.totalSize += file.size;

        let sessionGroup = userGroup.sessions.find(s => s.sessionId === file.sessionId);
        if (!sessionGroup) {
            sessionGroup = {
                sessionId: file.sessionId,
                sessionName: file.sessionName,
                totalSize: 0,
                senders: [],
            };
            userGroup.sessions.push(sessionGroup);
        }
        sessionGroup.totalSize += file.size;

        const senderKey = file.fromMe ? "_me_" : file.from;
        let senderGroup = sessionGroup.senders.find(s => s.senderKey === senderKey);
        if (!senderGroup) {
            senderGroup = {
                senderKey,
                senderDisplay: getSenderDisplay(file),
                files: [],
                totalSize: 0,
            };
            sessionGroup.senders.push(senderGroup);
        }
        senderGroup.files.push(file);
        senderGroup.totalSize += file.size;
    }

    const result = Object.values(usersMap).sort((a, b) => b.totalSize - a.totalSize);
    result.forEach(u => {
        u.sessions.sort((a, b) => b.totalSize - a.totalSize);
        u.sessions.forEach(s => s.senders.sort((a, b) => b.totalSize - a.totalSize));
    });
    return result;
}

// Chaves de todos os nos recolhiveis da arvore (usadas para recolher tudo por padrao)
export function collapsibleKeys(grouped: UserGroup[]): Set<string> {
    const allKeys = new Set<string>();
    grouped.forEach(userGroup => {
        allKeys.add(`user:${userGroup.ownerId}`);
        userGroup.sessions.forEach(sessionGroup => {
            allKeys.add(`session:${userGroup.ownerId}:${sessionGroup.sessionId}`);
            sessionGroup.senders.forEach(sender => {
                allKeys.add(`sender:${userGroup.ownerId}:${sessionGroup.sessionId}:${sender.senderKey}`);
            });
        });
    });
    return allKeys;
}
