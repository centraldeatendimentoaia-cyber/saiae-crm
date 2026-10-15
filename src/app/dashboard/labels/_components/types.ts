export const WAP_COLORS = [
    "#FF0000", "#FF7F00", "#FFFF00", "#00FF00", "#0000FF",
    "#4B0082", "#9400D3", "#FF1493", "#00CED1", "#32CD32",
    "#FFD700", "#FF69B4", "#8B4513", "#2F4F4F", "#696969",
    "#708090", "#778899", "#B0C4DE", "#ADD8E6", "#F0E68C"
];

export interface LabelData {
    id: string;
    sessionId: string;
    name: string;
    color: number;
    colorHex: string;
    _count: {
        chatLabels: number;
    };
}

export interface ChatLabelEntry {
    id: string;
    chatJid: string;
    labelId: string;
    contactName?: string;
}

export interface Contact {
    id: string;
    jid: string;
    name?: string;
    notify?: string;
}
