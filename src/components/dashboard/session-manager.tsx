import { errorMessage } from "@/lib/errors";
import { logger } from "@/lib/logger";
'use client';

import { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import QRCode from 'qrcode';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from "@/components/ui/card";
import { useRouter } from 'next/navigation';
import { toast } from "sonner";
import { Label } from '@/components/ui/label';
import { Smartphone, Plus, Trash2, Settings, RefreshCw, Power, UserPlus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

type Session = {
    id: string;
    name: string;
    sessionId: string;
    status: string;
    qr?: string | null;
    user?: {
        name: string | null;
        email: string;
    } | null;
};

export function SessionManager({ user }: { user?: { id: string } }) {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [newSessionName, setNewSessionName] = useState("");
    const [newSessionId, setNewSessionId] = useState("");
    const [loading, setLoading] = useState(false);
    const [socket, setSocket] = useState<Socket | null>(null);
    const router = useRouter();

    useEffect(() => {
        fetchSessions();

        // Init Socket
        const socketInstance = io({
            path: "/api/socket/io",
            addTrailingSlash: false,
        });

        socketInstance.on('connect', () => {
            logger.info("SessionManager", 'Socket connected');
        });

        socketInstance.on('connection.update', (data: { sessionId: string, status: string, qr: string }) => {
            // Update specific session status if match
            setSessions(prev => prev.map(s => {
                if (s.sessionId === data.sessionId) {
                    return { ...s, status: data.status, qr: data.qr };
                }
                return s;
            }));

            if (data.status === 'CONNECTED') {
                fetchSessions(); // Refresh purely to get updated state from DB if needed
            }
        });

        setSocket(socketInstance);

        return () => {
            socketInstance.disconnect();
        };
    }, []);

    const fetchSessions = () => {
        fetch('/api/sessions').then(res => res.json()).then(responseData => {
            const data = responseData?.data || [];
            if (Array.isArray(data)) setSessions(data);
        });
    }

    const createSession = async () => {
        if (!newSessionName) {
            toast.error("O nome da sessão é obrigatório");
            return;
        }

        // If ID matches existing
        if (newSessionId && sessions.some(s => s.sessionId === newSessionId)) {
            toast.error("Este ID de sessão já existe");
            return;
        }

        setLoading(true);
        try {
            const res = await fetch('/api/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: user?.id,
                    name: newSessionName,
                    sessionId: newSessionId || undefined // Optional, backend will generate if empty
                })
            });
            const responseData = await res.json();
            const session = responseData?.data;

            if (!res.ok || !session) throw new Error(responseData.error || responseData.message || "Failed to create");

            setSessions([...sessions, session]);
            setNewSessionName("");
            setNewSessionId("");
            toast.success("Sessão criada com sucesso");

            // Optionally redirect immediately or let user choose
            // router.push(`/dashboard/sessions/${session.sessionId}`);
        } catch (e) {
            logger.error("SessionManager", "Erro", e);
            toast.error(errorMessage(e, "Falha ao criar a sessão"));
        } finally {
            setLoading(false);
        }
    };

    const handleManageSession = (sessionId: string) => {
        router.push(`/dashboard/sessions/${sessionId}`);
    }

    return (
        <div className="space-y-8">
            {/* Create New Session Card */}
            <Card className="bg-zinc-50 border-dashed border-2">
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                        <Plus className="h-5 w-5" />  Criar nova sessão
                    </CardTitle>
                    <CardDescription>
                        
                        Adicione uma nova conta de WhatsApp para gerenciar.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                        <div className="space-y-2">
                            <Label htmlFor="session-name">Nome da sessão</Label>
                            <Input
                                id="session-name"
                                value={newSessionName}
                                onChange={e => setNewSessionName(e.target.value)}
                                placeholder="WhatsApp da empresa"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="session-id">ID da sessão personalizado (opcional)</Label>
                            <Input
                                id="session-id"
                                value={newSessionId}
                                onChange={e => setNewSessionId(e.target.value.replace(/[^a-zA-Z0-9-_]/g, ''))}
                                placeholder="id-unico-123"
                            />
                            <p className="text-[10px] text-muted-foreground">Somente letras, números e hifens.</p>
                        </div>
                        <Button onClick={createSession} disabled={loading}>
                            {loading ? 'Criando...' : 'Criar sessão'}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Sessions Table Card */}
            <div>
                {sessions.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground bg-zinc-50 dark:bg-zinc-900 rounded-lg border border-border/50">
                        
                        Nenhuma sessão encontrada. Crie uma acima para começar.
                    </div>
                ) : (
                    <Card className="glass-panel border-border/50 shadow-sm overflow-hidden">
                        <CardHeader className="pb-3 pt-5 px-5">
                            <CardTitle className="text-base font-bold text-zinc-800 dark:text-zinc-100 flex items-center gap-2">
                                
                                Sessões ativas ({sessions.length})
                            </CardTitle>
                            <CardDescription>
                                
                                Lista das sessões de WhatsApp ativas e o status atual de conexão.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="p-0 overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead className="px-5 text-xs uppercase tracking-wider font-semibold">Sessão / Aparelho</TableHead>
                                        <TableHead className="text-xs uppercase tracking-wider font-semibold">Status</TableHead>
                                        <TableHead className="text-xs uppercase tracking-wider font-semibold">Proprietário</TableHead>
                                        <TableHead className="text-right px-5 text-xs uppercase tracking-wider font-semibold">Ações</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {sessions.map(session => (
                                        <TableRow key={session.id} className="hover:bg-muted/20 dark:hover:bg-muted/5 transition-colors">
                                            <TableCell className="px-5 py-3 font-medium">
                                                <div className="font-semibold text-zinc-800 dark:text-zinc-200 text-sm">{session.name}</div>
                                                <div className="text-[11px] text-muted-foreground font-mono mt-0.5">{session.sessionId}</div>
                                            </TableCell>
                                            <TableCell className="py-3">
                                                <Badge 
                                                    variant={session.status === 'CONNECTED' ? 'default' : 'secondary'}
                                                    className={`text-[10px] font-semibold transition-all px-2 py-0.5 shrink-0 inline-flex items-center ${
                                                        session.status === 'CONNECTED' 
                                                            ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 hover:bg-emerald-500/20' 
                                                            : 'bg-zinc-100 text-zinc-600 border border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700 hover:bg-zinc-100'
                                                    }`}
                                                >
                                                    <span className={`h-1.5 w-1.5 rounded-full mr-1.5 ${
                                                        session.status === 'CONNECTED' ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-400'
                                                    }`} />
                                                    {session.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="py-3">
                                                {session.user ? (
                                                    <div className="leading-tight">
                                                        <div className="font-semibold text-zinc-700 dark:text-zinc-300 text-xs">{session.user.name || "Sem nome"}</div>
                                                        <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">{session.user.email}</div>
                                                    </div>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground/50">-</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="py-3 text-right px-5">
                                                <div className="flex items-center justify-end gap-2">
                                                    <Button 
                                                        variant="outline" 
                                                        size="sm" 
                                                        className="h-8 px-2.5 text-xs rounded-lg hover:bg-primary/5 transition-colors border-border/50"
                                                        onClick={() => router.push(`/dashboard/sessions/access?session=${session.sessionId}`)}
                                                    >
                                                        <UserPlus className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />  Compartilhar
                                                    </Button>
                                                    <Button 
                                                        variant="outline" 
                                                        size="sm" 
                                                        className="h-8 px-2.5 text-xs rounded-lg hover:bg-primary/5 transition-colors border-border/50"
                                                        onClick={() => handleManageSession(session.sessionId)}
                                                    >
                                                        <Settings className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />  Gerenciar
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    );
}
