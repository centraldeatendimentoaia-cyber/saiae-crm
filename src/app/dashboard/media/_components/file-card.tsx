"use client";

import { Card, CardContent } from "@/components/ui/card";
import { ImageIcon, Video, Music, FileText, Download, Eye, CheckSquare, Square } from "lucide-react";
import { formatFileSize, type MediaFile } from "./grouping";

function getTypeBg(type: string) {
    switch (type) {
        case "image": return "bg-zinc-500/10";
        case "video": return "bg-zinc-500/10";
        case "audio": return "bg-orange-500/10";
        default: return "bg-emerald-500/10";
    }
}

function getTypeIcon(type: string) {
    switch (type) {
        case "image": return <ImageIcon className="h-5 w-5 text-zinc-500" />;
        case "video": return <Video className="h-5 w-5 text-zinc-500" />;
        case "audio": return <Music className="h-5 w-5 text-orange-500" />;
        default: return <FileText className="h-5 w-5 text-emerald-500" />;
    }
}

export function FileCard({ file, selected, onToggle, onPreview }: {
    file: MediaFile;
    selected: boolean;
    onToggle: (name: string) => void;
    onPreview: (file: MediaFile) => void;
}) {
    return (
        <Card className={`group relative overflow-hidden cursor-pointer transition-all duration-200 hover:shadow-md ${selected ? "ring-2 ring-primary border-primary" : "border-border/40 hover:border-border"}`} onClick={() => onToggle(file.name)}>
            <CardContent className="p-0">
                <div className={`h-24 flex items-center justify-center ${getTypeBg(file.type)} relative`}>
                    {file.type === "image" ? (
                        <img src={file.url} alt={file.name} className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                        <div className="flex flex-col items-center gap-1">
                            {getTypeIcon(file.type)}
                            <span className="text-[9px] text-muted-foreground uppercase font-medium">{file.ext}</span>
                        </div>
                    )}
                    <div className={`absolute top-1 left-1 transition-opacity ${selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                        {selected ? <CheckSquare className="h-4 w-4 text-primary drop-shadow" /> : <Square className="h-4 w-4 text-white/80 drop-shadow" />}
                    </div>
                    <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {file.type === "image" && (
                            <button onClick={(e) => { e.stopPropagation(); onPreview(file); }} className="h-6 w-6 rounded bg-black/50 hover:bg-black/70 flex items-center justify-center text-white">
                                <Eye className="h-3 w-3" />
                            </button>
                        )}
                        <a href={file.url} download={file.name} onClick={(e) => e.stopPropagation()} className="h-6 w-6 rounded bg-black/50 hover:bg-black/70 flex items-center justify-center text-white">
                            <Download className="h-3 w-3" />
                        </a>
                    </div>
                </div>
                <div className="p-1.5 px-2">
                    <p className="text-[10px] font-medium text-foreground truncate" title={file.name}>{file.name}</p>
                    <div className="flex items-center justify-between mt-1">
                        <span className="text-[9px] text-muted-foreground font-medium">{formatFileSize(file.size)}</span>
                        <span className="text-[8px] text-muted-foreground">{new Date(file.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
