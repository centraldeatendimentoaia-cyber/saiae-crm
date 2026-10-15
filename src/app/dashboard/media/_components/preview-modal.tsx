"use client";

import { X } from "lucide-react";
import { formatFileSize, type MediaFile } from "./grouping";

export function PreviewModal({ file, onClose }: { file: MediaFile; onClose: () => void }) {
    return (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="relative max-w-5xl max-h-[95vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
                <button onClick={onClose} className="absolute -top-10 right-0 text-white/50 hover:text-white transition-colors bg-white/10 hover:bg-white/20 rounded-full p-1 border border-white/10 m-2">
                    <X className="h-5 w-5" />
                </button>
                <img src={file.url} alt={file.name} className="max-h-[85vh] rounded-lg object-contain shadow-2xl" />
                <div className="bg-black/50 backdrop-blur-sm px-4 py-2 rounded-full mt-4 flex items-center gap-4 text-xs">
                    <span className="text-white font-medium">{file.name}</span>
                    <span className="text-white/60">•</span>
                    <span className="text-white/80">{formatFileSize(file.size)}</span>
                </div>
            </div>
        </div>
    );
}
