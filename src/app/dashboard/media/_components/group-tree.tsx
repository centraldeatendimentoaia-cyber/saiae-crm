"use client";

import { Card } from "@/components/ui/card";
import {
    CheckSquare,
    Square,
    ChevronDown,
    ChevronRight,
    User as UserIcon,
    Smartphone,
    Contact,
} from "lucide-react";
import { FileCard } from "./file-card";
import { formatFileSize, type MediaFile, type UserGroup } from "./grouping";

export function GroupTree({ grouped, collapsed, selected, onToggleCollapse, onToggleSelect, onSelectAllInGroup, onPreview }: {
    grouped: UserGroup[];
    collapsed: Set<string>;
    selected: Set<string>;
    onToggleCollapse: (key: string) => void;
    onToggleSelect: (name: string) => void;
    onSelectAllInGroup: (files: MediaFile[]) => void;
    onPreview: (file: MediaFile) => void;
}) {
    const ChevronIcon = ({ id }: { id: string }) =>
        collapsed.has(id) ? <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />;

    return (
        <div className="space-y-6">
            {grouped.map((userGroup) => {
                const userId = `user:${userGroup.ownerId}`;
                const isUserCollapsed = collapsed.has(userId);
                const userFileCount = userGroup.sessions.reduce((sum, s) => sum + s.senders.reduce((ss, sn) => ss + sn.files.length, 0), 0);

                return (
                    <div key={userGroup.ownerId} className="flex flex-col gap-3">
                        {/* User Level Header */}
                        <div className="flex items-center justify-between pb-2 border-b border-border">
                            <button className="flex items-center gap-2 hover:opacity-80 transition-opacity" onClick={() => onToggleCollapse(userId)}>
                                <ChevronIcon id={userId} />
                                <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center">
                                    <UserIcon className="h-3.5 w-3.5 text-primary" />
                                </div>
                                <div>
                                    <h2 className="text-sm font-bold text-foreground leading-tight text-left">{userGroup.ownerName}</h2>
                                    <p className="text-[10px] text-muted-foreground text-left">Conta de usuário</p>
                                </div>
                            </button>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground bg-muted/30 px-3 py-1 rounded-full">
                                <span>{userGroup.sessions.length}  Sessão{userGroup.sessions.length !== 1 ? "s" : ""}</span>
                                <span className="w-1 h-1 rounded-full bg-border"></span>
                                <span>{userFileCount}  Mídia</span>
                                <span className="w-1 h-1 rounded-full bg-border"></span>
                                <span className="font-semibold">{formatFileSize(userGroup.totalSize)}</span>
                            </div>
                        </div>

                        {!isUserCollapsed && (
                            <div className="space-y-4 pl-2 sm:pl-4 border-l-2 border-border/30 ml-2">
                                {userGroup.sessions.map((sessionGroup) => {
                                    const sessionKey = `session:${userGroup.ownerId}:${sessionGroup.sessionId}`;
                                    const isSessionCollapsed = collapsed.has(sessionKey);
                                    const sessionFileCount = sessionGroup.senders.reduce((sum, s) => sum + s.files.length, 0);

                                    return (
                                        <Card key={sessionGroup.sessionId} className="overflow-hidden border-border/50 shadow-sm">
                                            {/* Session Level Header */}
                                            <div className="bg-muted/20 px-4 py-3 flex items-center justify-between border-b border-border/50">
                                                <button className="flex items-center gap-2.5 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity" onClick={() => onToggleCollapse(sessionKey)}>
                                                    <ChevronIcon id={sessionKey} />
                                                    <div className="h-6 w-6 rounded bg-zinc-500/10 flex items-center justify-center flex-shrink-0">
                                                        <Smartphone className="h-3 w-3 text-zinc-500" />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-semibold text-foreground truncate">{sessionGroup.sessionName}</p>
                                                        <p className="text-[10px] text-muted-foreground truncate">{sessionGroup.sessionId}</p>
                                                    </div>
                                                </button>
                                                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                                    <span>{sessionFileCount}  Mídia</span>
                                                    <span className="w-1 h-1 rounded-full bg-border"></span>
                                                    <span className="font-medium text-foreground">{formatFileSize(sessionGroup.totalSize)}</span>
                                                </div>
                                            </div>

                                            {/* Senders List */}
                                            {!isSessionCollapsed && (
                                                <div className="divide-y divide-border/20">
                                                    {sessionGroup.senders.map((sender) => {
                                                        const senderKey = `sender:${userGroup.ownerId}:${sessionGroup.sessionId}:${sender.senderKey}`;
                                                        const isSenderCollapsed = collapsed.has(senderKey);
                                                        const allSelected = sender.files.length > 0 && sender.files.every(f => selected.has(f.name));

                                                        return (
                                                            <div key={sender.senderKey} className="bg-background">
                                                                {/* Sender Level Header */}
                                                                <div className="flex items-center gap-2 px-4 py-2 hover:bg-muted/10 transition-colors">
                                                                    <button className="flex items-center gap-2 flex-1 min-w-0 text-left" onClick={() => onToggleCollapse(senderKey)}>
                                                                        <ChevronIcon id={senderKey} />
                                                                        <Contact className="h-3.5 w-3.5 text-muted-foreground/70 flex-shrink-0" />
                                                                        <span className="text-xs font-medium text-foreground truncate">{sender.senderDisplay}</span>
                                                                        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded ml-1">
                                                                            {sender.files.length} • {formatFileSize(sender.totalSize)}
                                                                        </span>
                                                                    </button>
                                                                    <button onClick={() => onSelectAllInGroup(sender.files)} className="p-1 hover:bg-muted rounded transition-colors" title={allSelected ? "Desmarcar todos" : "Selecionar todos"}>
                                                                        {allSelected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-muted-foreground/40" />}
                                                                    </button>
                                                                </div>

                                                                {/* Files Grid */}
                                                                {!isSenderCollapsed && (
                                                                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2 px-4 pb-4 pt-1">
                                                                        {sender.files.map((file) => (
                                                                            <FileCard
                                                                                key={file.name}
                                                                                file={file}
                                                                                selected={selected.has(file.name)}
                                                                                onToggle={onToggleSelect}
                                                                                onPreview={onPreview}
                                                                            />
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </Card>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
