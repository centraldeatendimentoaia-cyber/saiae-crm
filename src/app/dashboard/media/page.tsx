"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    ImageIcon,
    Video,
    Trash2,
    Search,
    HardDrive,
    Files,
    X,
    RefreshCw,
    FolderOpen,
} from "lucide-react";
import { GroupTree } from "./_components/group-tree";
import { PreviewModal } from "./_components/preview-modal";
import { collapsibleKeys, formatFileSize, groupMedia, matchesFilters, type MediaFile, type UserGroup } from "./_components/grouping";

const FILTROS_TIPO: Record<string, string> = { all: "Todos", image: "Imagens", video: "Vídeos", audio: "Áudios", document: "Documentos" };

export default function MediaPage() {
    const [files, setFiles] = useState<MediaFile[]>([]);
    const [totalSize, setTotalSize] = useState(0);
    const [totalCount, setTotalCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [filterType, setFilterType] = useState<string>("all");
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [deleting, setDeleting] = useState(false);
    const [previewFile, setPreviewFile] = useState<MediaFile | null>(null);
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

    const fetchMedia = async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/media");
            if (!res.ok) throw new Error("Failed to fetch");
            const responseData = await res.json();
            const mediaData = responseData?.data || {};
            setFiles(mediaData.files || []);
            setTotalSize(mediaData.totalSize || 0);
            setTotalCount(mediaData.totalCount || 0);
        } catch (error) {
            logger.error("Midia", "Falha ao carregar os arquivos de mídia", error);
            toast.error("Falha ao carregar os arquivos de mídia");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchMedia(); }, []);

    const filteredFiles = useMemo(
        () => files.filter((f) => matchesFilters(f, searchQuery, filterType)),
        [files, searchQuery, filterType],
    );

    // Agrupamento em 3 niveis: usuario > sessao > remetente
    const grouped = useMemo((): UserGroup[] => groupMedia(filteredFiles), [filteredFiles]);

    // Collapse all by default when grouped dependencies change (e.g on initial load or search)
    useEffect(() => {
        setCollapsed(collapsibleKeys(grouped));
    }, [grouped]);

    const toggleCollapse = (key: string) => {
        setCollapsed(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    };

    const toggleSelect = (name: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name); else next.add(name);
            return next;
        });
    };

    const selectAllInGroup = (groupFiles: MediaFile[]) => {
        setSelected(prev => {
            const next = new Set(prev);
            const allSelected = groupFiles.every(f => next.has(f.name));
            groupFiles.forEach(f => allSelected ? next.delete(f.name) : next.add(f.name));
            return next;
        });
    };

    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const handleDelete = async () => {
        if (selected.size === 0) return;
        setShowDeleteConfirm(false);
        setDeleting(true);
        try {
            const res = await fetch("/api/media", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filenames: Array.from(selected) }),
            });
            if (!res.ok) throw new Error("Failed to delete");
            const responseData = await res.json();
            const data = responseData?.data;
            toast.success(`${data?.deleted || 0} arquivo(s) excluído(s)`);
            if (data?.failed > 0) toast.warning(`Falha ao excluir ${data.failed} arquivo(s)`);
            setSelected(new Set());
            fetchMedia();
        } catch { toast.error("Falha ao excluir os arquivos"); }
        finally { setDeleting(false); }
    };

    const stats = useMemo(() => {
        const r = { image: 0, video: 0, audio: 0, document: 0 };
        files.forEach(f => r[f.type]++);
        return r;
    }, [files]);

    return (
        <div className="space-y-4 max-w-6xl mx-auto">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h1 className="text-xl font-bold text-foreground">Gerenciador de mídia</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">Gerencie os arquivos de mídia baixados</p>
                </div>
                <Button variant="outline" size="sm" className="gap-2 self-start" onClick={fetchMedia} disabled={loading}>
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />  Atualizar
                </Button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                    { icon: <HardDrive className="h-4 w-4 text-primary" />, bg: "bg-primary/10", value: formatFileSize(totalSize), label: "Tamanho total" },
                    { icon: <Files className="h-4 w-4 text-zinc-500" />, bg: "bg-zinc-500/10", value: totalCount, label: "Total de arquivos" },
                    { icon: <ImageIcon className="h-4 w-4 text-zinc-500" />, bg: "bg-zinc-500/10", value: stats.image, label: "Imagens" },
                    { icon: <Video className="h-4 w-4 text-zinc-500" />, bg: "bg-zinc-500/10", value: stats.video + stats.audio + stats.document, label: "Outros" },
                ].map((s) => (
                    <Card key={s.label} className="border-border/40">
                        <CardContent className="p-3 flex items-center gap-3">
                            <div className={`h-9 w-9 rounded-lg ${s.bg} flex items-center justify-center`}>{s.icon}</div>
                            <div>
                                <p className="text-lg font-bold text-foreground">{s.value}</p>
                                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</p>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input placeholder="Buscar por nome do arquivo, sessão, usuário ou remetente..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="h-9 pl-8 text-sm" />
                </div>
                <div className="flex gap-1.5 flex-wrap">
                    {Object.keys(FILTROS_TIPO).map((t) => (
                        <Button key={t} variant={filterType === t ? "default" : "outline"} size="sm" className="h-9 text-xs capitalize px-3" onClick={() => setFilterType(t)}>{FILTROS_TIPO[t]}</Button>
                    ))}
                </div>
            </div>

            {/* Selection Bar */}
            {selected.size > 0 && (
                <div className="flex items-center gap-3 p-2.5 bg-destructive/5 border border-destructive/20 rounded-lg">
                    <span className="text-sm font-medium">{selected.size}  selecionado(s)</span>
                    <Button variant="destructive" size="sm" className="gap-1.5 h-8" onClick={() => setShowDeleteConfirm(true)} disabled={deleting}>
                        <Trash2 className="h-3.5 w-3.5" /> {deleting ? "Excluindo..." : "Excluir"}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8" onClick={() => setSelected(new Set())}><X className="h-3.5 w-3.5 mr-1" />  Limpar</Button>
                </div>
            )}

            {/* Content */}
            {loading ? (
                <div className="space-y-4">
                    {[1, 2].map(i => (
                        <div key={i} className="space-y-2">
                            <Skeleton className="h-12 w-full rounded-lg" />
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 pl-4">
                                {Array.from({ length: 4 }).map((_, j) => <Skeleton key={j} className="h-36 rounded-lg" />)}
                            </div>
                        </div>
                    ))}
                </div>
            ) : grouped.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="h-14 w-14 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
                        <FolderOpen className="h-7 w-7 text-muted-foreground/40" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                        {searchQuery || filterType !== "all" ? "Nenhum arquivo de mídia corresponde aos filtros" : "Nenhum arquivo de mídia baixado ainda"}
                    </p>
                </div>
            ) : (
                <GroupTree
                    grouped={grouped}
                    collapsed={collapsed}
                    selected={selected}
                    onToggleCollapse={toggleCollapse}
                    onToggleSelect={toggleSelect}
                    onSelectAllInGroup={selectAllInGroup}
                    onPreview={setPreviewFile}
                />
            )}

            {previewFile && <PreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Excluir {selected.size}  arquivo(s)?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Esta ação não pode ser desfeita. Os arquivos selecionados serão removidos permanentemente do servidor.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">Excluir</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
